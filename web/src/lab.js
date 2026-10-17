/* ===== Wadi Ghadir Gravity Lab: chapters, maps and interaction =====
   Written by Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics), Hannover. */
(function () {
"use strict";
document.body.classList.add("appA");
const AUTHOR = "Mohamed Sobh, LIAG";
/* a clean copy of this page, taken before anything is drawn, for "Save this lab as HTML" */
const PAGE_HTML = (() => { const d = document.documentElement.cloneNode(true);
  d.querySelectorAll("script").forEach(sc => { if (!sc.textContent.includes("const WG_DATA")) sc.remove(); });
  return "<!DOCTYPE html>\n" + d.outerHTML; })();

/* ---------------------------------------------------------------- data and state */
const HERO = { t0: performance.now(), vis: true };
const EXAMPLE = {
  name: "Wadi Ghadir example data", example: true, files: WG_DATA.files,
  stations: WG_DATA.stations.map(r => Object.fromEntries(WG_DATA.stationCols.map((c, i) => [c, r[i]]))),
  ref: WG_DATA.ref, hill: WG_DATA.hillshade, python: WG_DATA.python,
};
const PKEY = "wg-lab-params-v1";
function loadParams() { try { return JSON.parse(localStorage.getItem(PKEY) || "{}"); } catch (e) { return {}; } }
const LAB = { input: EXAMPLE, P: ENG.mergeParams(loadParams()), R: null, grid: null, gridKey: "", paint: [], ui: {} };
function saveParams() { try { localStorage.setItem(PKEY, JSON.stringify(LAB.P)); } catch (e) { /* storage unavailable */ } }
function compute() {
  try { LAB.R = ENG.run(LAB.input, LAB.P, GL.longman); LAB.error = null; }
  catch (e) { LAB.error = e.message; console.error(e); }
  LAB.gridKey = "";
}
let pend = 0;
function changed() { saveParams(); clearTimeout(pend); pend = setTimeout(() => { compute(); repaint(); }, 90); }
function repaint() { LAB.paint.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }
function onPaint(f) { LAB.paint.push(f); f(); }
const R = () => LAB.R;
const okSt = () => (R() ? R().st.filter(s => s.ok) : []);
const insts = () => (R() ? [...new Set(R().rows.map(r => r.inst))].sort() : []);
const days = () => (R() ? [...new Set(R().rows.map(r => r.Date))].sort() : []);
const INSTC = ["#2a78d6", "#eb6834", "#1baf7a", "#8a5bd6"];
const INST_FIXED = { "CG6-0640": "#2a78d6", "CG6-0313": "#eb6834" };   // as in the Python maps
const instColor = i => INST_FIXED[i] || INSTC[Math.max(0, insts().indexOf(i)) % INSTC.length];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hhmm = ms => new Date(ms).toISOString().slice(11, 16);
const dayStart = d => Date.parse(d + "T00:00:00Z");
function sel(id, opts, cur, label) { return `<select id="${id}" aria-label="${label || id}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`; }
function bindSel(id, fn) { const el = $(id); if (el) el.onchange = () => fn(el.value); }
function chk(id, label, on) { return `<label class="chk"><input type="checkbox" id="${id}" ${on ? "checked" : ""}> ${label}</label>`; }
function bindChk(id, fn) { const el = $(id); if (el) el.onchange = () => fn(el.checked); }
const P = () => LAB.P;
const rhoFmt = v => v.toFixed(2);

/* ---------------------------------------------------------------- colour maps */
const STOPS = {
  anom: [[0, [11, 47, 99]], [0.2, [57, 135, 229]], [0.42, [212, 230, 249]], [0.5, [246, 245, 241]], [0.58, [251, 212, 196]], [0.8, [224, 90, 60]], [1, [110, 19, 9]]],
  spectral: PALS.spectral, viridis: PALS.viridis, terrain: PALS.terrain,
  heat: [[0, [20, 12, 40]], [0.35, [120, 28, 92]], [0.7, [226, 92, 56]], [1, [252, 236, 160]]],
};
const LUTS = {};
for (const k in STOPS) { const s = STOPS[k], L = new Uint8ClampedArray(768); for (let i = 0; i < 256; i++) { const t = i / 255; let j = 1; while (j < s.length - 1 && t > s[j][0]) j++; const [a, ca] = s[j - 1], [b, cb] = s[j], f = Math.max(0, Math.min(1, (t - a) / (b - a || 1))); for (let q = 0; q < 3; q++) L[i * 3 + q] = ca[q] + (cb[q] - ca[q]) * f; } LUTS[k] = L; }
const lutCol = (pal, t) => { const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3, L = LUTS[pal]; return `rgb(${L[i]},${L[i + 1]},${L[i + 2]})`; };
function range(vals, sym) {
  const s = vals.filter(isF).sort((a, b) => a - b); if (!s.length) return [-1, 1];
  let lo = pctl(s, 0.01), hi = pctl(s, 0.99);
  if (sym && lo < 0 && hi > 0) { const m = Math.max(-lo, hi); lo = -m; hi = m; }
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  return [lo, hi];
}
function colorBar(cv, pal, lo, hi, unit) {
  const { ctx, W } = setup(cv, 36);
  for (let x = 0; x < W; x++) { ctx.fillStyle = lutCol(pal, x / (W - 1)); ctx.fillRect(x, 0, 1.4, 12); }
  ctx.fillStyle = css("--muted"); ctx.font = "500 12px " + css("--disp"); ctx.textBaseline = "top";
  const uw = ctx.measureText(unit).width + 10, t = nice(lo, hi, 6).ticks.filter(v => v >= lo && v <= hi && (v - lo) / (hi - lo) * W < W - uw - 14);
  t.forEach(v => { const x = (v - lo) / (hi - lo) * W; ctx.textAlign = x < 20 ? "left" : "center"; ctx.fillText(fmt(v, Math.abs(hi - lo) < 4 ? 1 : 0), x, 16); });
  ctx.textAlign = "right"; ctx.fillStyle = css("--ink"); ctx.fillText(unit, W, 16);
}

/* ---------------------------------------------------------------- the map */
function mapExtent() {
  const h = LAB.input.hill;
  if (h) return { lon0: h.lon0, lon1: h.lon1, lat0: h.lat0, lat1: h.lat1 };
  let s = R() ? R().occ.filter(o => isF(o.lat) && o.role !== "hotel") : [];   // a distant second base would stretch the map
  if (!s.length && R()) s = R().occ.filter(o => isF(o.lat));
  if (!s.length) return { lon0: 34.7, lon1: 35.03, lat0: 24.66, lat1: 24.85 };
  let lo0 = Math.min(...s.map(o => o.lon)), lo1 = Math.max(...s.map(o => o.lon)), la0 = Math.min(...s.map(o => o.lat)), la1 = Math.max(...s.map(o => o.lat));
  const px = (lo1 - lo0) * 0.08 + 0.005, py = (la1 - la0) * 0.08 + 0.005;
  return { lon0: lo0 - px, lon1: lo1 + px, lat0: la0 - py, lat1: la1 + py };
}
const HILL = {};
function hillImage(cb) {
  const h = LAB.input.hill; if (!h) return null;
  if (HILL.src === h.src && HILL.img.complete) return HILL.img;
  if (HILL.src !== h.src) { HILL.src = h.src; HILL.img = new Image(); HILL.img.onload = () => cb && cb(); HILL.img.src = h.src; }
  return null;
}
/* draws the base map and layers; returns a hover helper */
function drawMap(cv, o) {
  const E = mapExtent(), latc = (E.lat0 + E.lat1) / 2, k = Math.cos(latc * Math.PI / 180);
  const wdeg = (E.lon1 - E.lon0) * k, hdeg = E.lat1 - E.lat0;
  const W0 = cv.clientWidth || cv.parentNode.clientWidth || 700;
  const { ctx, W, H, dpr } = setup(cv, Math.round(Math.min(W0 * hdeg / wdeg + 40, window.innerHeight * 0.78)));
  const pad = { l: 58, r: 10, t: 8, b: 28 }, aw = W - pad.l - pad.r, ah = H - pad.t - pad.b;
  const s = Math.min(aw / wdeg, ah / hdeg), mw = wdeg * s, mh = hdeg * s, ox = pad.l + (aw - mw) / 2, oy = pad.t + (ah - mh) / 2;
  const X = lon => ox + (lon - E.lon0) * k * s, Y = lat => oy + (E.lat1 - lat) * s;
  const inv = (px, py) => [E.lat1 - (py - oy) / s, E.lon0 + (px - ox) / (k * s)];
  ctx.fillStyle = css("--paper2"); ctx.fillRect(ox, oy, mw, mh);
  const img = o.hill !== false ? hillImage(() => drawMap(cv, o)) : null;
  if (img) { ctx.globalAlpha = o.grid ? 0.95 : 0.85; ctx.drawImage(img, X(LAB.input.hill.lon0), Y(LAB.input.hill.lat1), X(LAB.input.hill.lon1) - X(LAB.input.hill.lon0), Y(LAB.input.hill.lat0) - Y(LAB.input.hill.lat1)); ctx.globalAlpha = 1; }
  // grid raster (bilinear, masked)
  if (o.grid) {
    const g = o.grid, L = LUTS[o.pal || "anom"], lo = o.lo, hi = o.hi, pw = Math.round(mw * dpr), ph = Math.round(mh * dpr);
    const im = ctx.createImageData(pw, ph), d = im.data;
    for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
      const [lat, lon] = inv(ox + px / dpr, oy + py / dpr), [gx, gy] = g.local.fwd(lat, lon);
      const fx = (gx - g.x0) / g.cell, fy = (gy - g.y0) / g.cell, c = Math.floor(fx), r = Math.floor(fy);
      if (c < 0 || r < 0 || c >= g.nx - 1 || r >= g.ny - 1) continue;
      const i = r * g.nx + c; if (!g.mask[i] || !g.mask[i + 1] || !g.mask[i + g.nx] || !g.mask[i + g.nx + 1]) continue;
      const a = fx - c, b = fy - r, v = g.z[i] * (1 - a) * (1 - b) + g.z[i + 1] * a * (1 - b) + g.z[i + g.nx] * (1 - a) * b + g.z[i + g.nx + 1] * a * b;
      const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))), li = Math.round(t * 255) * 3, q = (py * pw + px) * 4;
      d[q] = L[li]; d[q + 1] = L[li + 1]; d[q + 2] = L[li + 2]; d[q + 3] = img ? 205 : 255;
    }
    const off = document.createElement("canvas"); off.width = pw; off.height = ph; off.getContext("2d").putImageData(im, 0, 0);
    ctx.drawImage(off, ox, oy, mw, mh);
    if (o.contours) {
      ctx.strokeStyle = "rgba(20,25,30,.55)"; ctx.lineWidth = 0.6;
      for (const c of ENG.contours(g, o.contours)) {
        ctx.beginPath();
        for (const sg of c.segs) {
          const [la1, lo1] = g.local.inv(g.x0 + sg[0] * g.cell, g.y0 + sg[1] * g.cell), [la2, lo2] = g.local.inv(g.x0 + sg[2] * g.cell, g.y0 + sg[3] * g.cell);
          ctx.moveTo(X(lo1), Y(la1)); ctx.lineTo(X(lo2), Y(la2));
        }
        ctx.lineWidth = Math.abs(c.level) < 1e-9 ? 1.4 : 0.6; ctx.stroke();
      }
    }
  }
  // stations
  const pts = (o.pts || []).filter(p => isF(p.lat));
  if (o.stations !== false) for (const p of pts) {
    ctx.beginPath(); ctx.arc(X(p.lon), Y(p.lat), p.r || 3.2, 0, 6.283);
    ctx.fillStyle = p.color || (isF(p.v) ? lutCol(o.pal || "anom", (p.v - o.lo) / (o.hi - o.lo)) : css("--ink"));
    ctx.fill(); if (p.stroke !== false) { ctx.strokeStyle = "rgba(15,20,25,.55)"; ctx.lineWidth = 0.5; ctx.stroke(); }
  }
  // base station
  const b = R() && R().ref.base;
  if (b && isF(b.lat)) { const bx = X(b.lon), by = Y(b.lat); ctx.fillStyle = "#ffd23f"; ctx.strokeStyle = "#1d1d1b"; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 4 : 9.5, a = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(bx + r * Math.cos(a), by + r * Math.sin(a)); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
  // frame, ticks, scale bar, north
  ctx.strokeStyle = css("--ink"); ctx.lineWidth = 1; ctx.strokeRect(ox, oy, mw, mh);
  ctx.fillStyle = css("--muted"); ctx.font = "500 11.5px " + css("--disp");
  const tx = nice(E.lon0, E.lon1, Math.max(3, Math.round(mw / 140))), ty = nice(E.lat0, E.lat1, Math.max(3, Math.round(mh / 110)));
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  tx.ticks.forEach(v => { if (v < E.lon0 || v > E.lon1) return; ctx.fillRect(X(v), oy + mh, 1, 4); ctx.fillText(v.toFixed(2) + "°E", X(v), oy + mh + 6); });
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  ty.ticks.forEach(v => { if (v < E.lat0 || v > E.lat1) return; ctx.fillRect(ox - 4, Y(v), 4, 1); ctx.fillText(v.toFixed(2) + "°N", ox - 6, Y(v)); });
  const kmpx = s * k / 111.32, sb = [1, 2, 5, 10, 20].find(v => v * kmpx > mw * 0.12) || 20;
  ctx.fillStyle = "rgba(255,255,255,.88)"; ctx.fillRect(ox + 8, oy + mh - 30, sb * kmpx + 52, 22);
  ctx.fillStyle = "#111"; ctx.fillRect(ox + 14, oy + mh - 20, sb * kmpx, 4); ctx.font = "700 11px " + css("--disp"); ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(sb + " km", ox + 20 + sb * kmpx, oy + mh - 18);
  ctx.fillStyle = "rgba(255,255,255,.88)"; ctx.beginPath(); ctx.arc(ox + mw - 20, oy + 22, 13, 0, 6.283); ctx.fill(); ctx.fillStyle = "#111"; ctx.beginPath(); ctx.moveTo(ox + mw - 20, oy + 11); ctx.lineTo(ox + mw - 25, oy + 25); ctx.lineTo(ox + mw - 15, oy + 25); ctx.closePath(); ctx.fill(); ctx.font = "800 9px " + css("--disp"); ctx.textAlign = "center"; ctx.fillText("N", ox + mw - 20, oy + 30);
  // hover
  const tip = o.tip;
  if (tip) {
    cv.onpointermove = e => {
      const rc = cv.getBoundingClientRect(), px = e.clientX - rc.left, py = e.clientY - rc.top;
      if (px < ox || px > ox + mw || py < oy || py > oy + mh) { tip.hidden = true; return; }
      const [lat, lon] = inv(px, py); let best = null, bd = 144;
      for (const p of pts) { const d = (X(p.lon) - px) ** 2 + (Y(p.lat) - py) ** 2; if (d < bd) { bd = d; best = p; } }
      let gv = NaN;
      if (o.grid) { const g = o.grid, [gx, gy] = g.local.fwd(lat, lon), c = Math.round((gx - g.x0) / g.cell), r = Math.round((gy - g.y0) / g.cell); if (c >= 0 && r >= 0 && c < g.nx && r < g.ny && g.mask[r * g.nx + c]) gv = g.z[r * g.nx + c]; }
      tip.innerHTML = `<span class="k">${lat.toFixed(4)}°N ${lon.toFixed(4)}°E</span>` + (isF(gv) ? `<br>${o.name || "grid"}: <b>${fmt(gv, 2)}</b> ${o.unit || ""}` : "") +
        (best ? `<br><span class="swatch" style="background:${best.color || lutCol(o.pal || "anom", (best.v - o.lo) / (o.hi - o.lo))}"></span>${esc(best.label || "")}${isF(best.v) ? `<br>value: <b>${fmt(best.v, 2)}</b> ${o.unit || ""}` : ""}` : "");
      tip.hidden = false; const tw = tip.offsetWidth; tip.style.left = Math.min(px + 14, W - tw - 4) + "px"; tip.style.top = (py + 14) + "px";
    };
    cv.onpointerleave = () => { tip.hidden = true; };
  }
  return { X, Y, inv };
}
const mapHTML = (id, extra = "") => `<div class="mapwrap"><canvas class="plot" id="${id}"></canvas><div class="maptip" id="${id}t" hidden></div>${extra}</div>`;
const stLabel = s => `${s.inst} · ${s.date} · line ${s.line} station ${s.station}`;

/* ---------------------------------------------------------------- shared text */
const QTY = { dFA: ["Free-air anomaly", "ΔFA"], SB: ["Simple Bouguer anomaly", "ΔSB"], CB: ["Complete Bouguer anomaly", "ΔCB"], dg: ["Observed gravity", "Δg₁₀₀"] };
function value(s, q, rho) { return q === "dFA" ? s.dFA : q === "SB" ? ENG.SB(s, rho) : q === "CB" ? ENG.CB(s, rho) : s.dgk; }
const hasTerrain = () => okSt().some(s => isF(s.uTopo));

/* ================================================================ CHAPTERS */
const CH = [];

/* ---------- 1.1 overview ---------- */
CH.push({ id: "1.1", sec: "start", short: "The survey", title: "The Wadi Ghadir gravity survey",
  tag: "Two Scintrex CG-6 gravimeters, 985 field stations along the wadis of the Eastern Desert of Egypt, 16–24 January 2026. This lab runs the complete processing chain on these readings in your browser.",
  goal: "see what was measured, where, and which steps turn the readings into anomaly maps.",
  figs: [
    { title: "Stations on the Copernicus relief", sub: "Every occupation with a position, coloured by instrument. The star is base 100, the field base. Move the pointer over a station.",
      html: () => mapHTML("ovMap") + `<div class="legend" id="ovLeg"></div><div class="kpis" id="ovK"></div>`,
      draw() { onPaint(paintOverview); } },
    { title: "The processing chain", sub: "Each step is one chapter. Click a step to open it.",
      html: () => `<div class="chain">${[["2.1", "Load", "CG-6 files and station table"], ["2.2", "Readings", "Time series, days"], ["3.1", "Quality control", "StdDev, tilt, repeats"], ["3.2", "Earth tide", "Longman (1959)"], ["3.3", "Base and drift", "Piecewise linear"], ["3.4", "Calibration", "Scale of each meter"], ["4.1", "Free-air", "WGS84, 2nd order"], ["4.2", "Bouguer and terrain", "Slab and DEM prisms"], ["4.3", "Density", "Nettleton"], ["5.1", "Gridding", "Biharmonic spline"], ["5.2", "Filters", "Residual, derivatives, spectrum"], ["6.1", "Cross-section", "Profile across the map"], ["6.2", "Forward model", "Talwani polygons"], ["6.3", "Inversion", "Depth-weighted 2-D"], ["6.4", "pyGIMLi and SimPEG", "2-D and 3-D inversion"], ["7.2", "Export", "CSV, grid, PNG"]].map(([id, t, d]) => `<div class="go" tabindex="0" role="button" data-go="${id}"><i>${id}</i><b>${t}</b>${d}</div>`).join("")}</div>`,
      draw() { document.querySelectorAll(".chain [data-go]").forEach(el => el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") APPI.go(el.dataset.go, true); }); } },
  ],
  ideas: [["sat", "Relative survey", "No absolute gravity value is available, so every anomaly is given relative to base 100 (line 0, station 100)."],
    ["clock", "Time is UTC", "The CG-6 time stamps are UTC. This was shown by reproducing the on-board tide (chapter 3.2)."],
    ["layers", "Two meters", "CG-6 #0640 (new) and #0313 (old) measured on the same days; #0313 is calibrated against #0640 in chapter 3.4."],
    ["map", "Heights", "Station heights are GNSS heights converted to EGM2008 orthometric heights. The terrain effect comes from the Copernicus GLO-30 DEM."]],
  notes: [NOTE("field", "Your own data", "<p>Chapter 2.1 accepts any Scintrex CG-6 survey export and a CSV table of station coordinates. All steps and parameters then apply to your data.</p>")],
});
function paintOverview() {
  const cv = $("ovMap"); if (!cv || !R()) return;
  const occ = R().occ.filter(o => isF(o.lat));
  drawMap(cv, { pts: occ.map(o => ({ lat: o.lat, lon: o.lon, color: instColor(o.inst), label: stLabel(o), r: o.role === "field" ? 2.8 : 3.6 })), tip: $("ovMapt") });
  legend($("ovLeg"), insts().map(i => ({ dot: true, color: instColor(i), label: `${i} (${R().occ.filter(o => o.inst === i && o.role === "field").length} field occupations)` })).concat([{ dot: true, color: "#ffd23f", label: "base 100" }]));
  const r = R();
  $("ovK").innerHTML = KPI("Readings", r.rows.length) + KPI("Accepted", r.rows.filter(x => x.accepted).length) + KPI("Occupations", r.occ.length) + KPI("Stations with products", okSt().length, "hl") + KPI("Survey days", days().length) + KPI("Instruments", insts().length);
}

/* ---------- 2.1 load data ---------- */
CH.push({ id: "2.1", sec: "data", short: "Load the data", title: "Load gravity readings and station coordinates",
  tag: "Start from the Wadi Ghadir example, or load your own data: Scintrex CG-6 survey exports or a readings table from any gravimeter, plus a CSV of station coordinates. Every chapter then works on your data.",
  goal: "load a new data set, check the inventory and run the whole chain on it.",
  figs: [
    { title: "Data source", sub: "Your files stay in your browser; nothing is uploaded anywhere.",
      html: () => `<div class="drop big" id="dz"><div class="fileline"><b>1 · Gravity readings: CG-6 exports (.dat) or readings tables (.csv)</b><input type="file" id="fDat" multiple accept=".dat,.txt,.csv,.tsv"></div>
        <div class="fileline"><b>2 · Station coordinates (.csv)</b><input type="file" id="fSt" accept=".csv,.txt,.tsv"></div>
        <div class="fileline">${chk("cgGps", "Where the table has no entry, use the CG-6 internal GPS position (heights from that GPS are poor)", P().pos.allowCg6Gps)}</div>
        <div class="row"><button class="tbtn go" type="button" id="bRun">Process my files</button><button class="tbtn" type="button" id="bEx">Reload the Wadi Ghadir example</button><span class="hint">or drop the files on this box</span></div></div>
        <div class="msg" id="loadMsg" aria-live="polite"></div>`,
      draw() {
        const dz = $("dz");
        dz.ondragover = e => { e.preventDefault(); dz.classList.add("over"); }; dz.ondragleave = () => dz.classList.remove("over");
        dz.ondrop = e => { e.preventDefault(); dz.classList.remove("over"); readFiles([...e.dataTransfer.files]); };
        $("bRun").onclick = () => readFiles([...$("fDat").files, ...$("fSt").files]);
        $("bEx").onclick = () => { LAB.input = EXAMPLE; afterLoad("Wadi Ghadir example data reloaded."); };
        bindChk("cgGps", v => { P().pos.allowCg6Gps = v; changed(); });
        onPaint(() => { const m = $("loadMsg"); if (!m) return; if (LAB.error) { m.className = "msg bad"; m.innerHTML = "<b>Could not process the data.</b> " + esc(LAB.error); } else { m.className = "msg ok"; m.innerHTML = `<b>${esc(LAB.input.name)}</b>: ${R().rows.length} readings, ${R().occ.length} occupations, ${okSt().length} stations with position and drift control.`; } });
      } },
    { title: "Inventory", sub: "One row per loaded readings file (CG-6 header values where available).", html: () => `<div class="scroll"><table class="t" id="invT"></table></div>`,
      draw() { onPaint(() => { const t = $("invT"); if (!t || !R()) return; t.innerHTML = `<tr><th>File</th><th>Instrument</th><th>Serial</th><th>Readings</th><th>First</th><th>Last</th><th>Gcal1 [mGal]</th><th>Drift rate [mGal/day]</th><th>Firmware</th></tr>` + R().files.map(f => { const ts = f.rows.map(r => r.t).filter(isF); return `<tr><td>${esc(f.name)}</td><td>${esc(f.inst)}</td><td class="n">${esc(f.serial)}</td><td class="n">${f.rows.length}</td><td class="n">${new Date(Math.min(...ts)).toISOString().slice(0, 16).replace("T", " ")}</td><td class="n">${new Date(Math.max(...ts)).toISOString().slice(0, 16).replace("T", " ")}</td><td class="n">${esc(f.header["Gcal1 [mGal]"] || "–")}</td><td class="n">${esc(f.header["Drift Rate [mGal/day]"] || "–")}</td><td>${esc(f.header["Firmware Version"] || "–")}</td></tr>`; }).join(""); }); } },
    { title: "File formats", sub: "Tables may be comma, semicolon or tab separated; the first row holds the column names (any letter case). Lines starting with # are skipped.",
      html: () => `<p class="ptitle small">Gravity readings, option A: Scintrex CG-6 survey export</p><p class="hint">The .dat file as the CG-6 writes it. The instrument name comes from its serial number.</p>
        <p class="ptitle small">Gravity readings, option B: readings table (any gravimeter)</p>
        <pre class="code">instrument,date,time,line,station,gravity,stddev
CG5-1234,2026-03-02,07:31:10,0,100,4021.317,0.012
CG5-1234,2026-03-02,07:52:40,1,1,4019.882,0.015</pre>
        <p class="hint"><b>Required:</b> date (YYYY-MM-DD), time (UTC), station and gravity in mGal (also accepted: reading, g, corrgrav), or one datetime column. <b>Optional:</b> line, instrument (otherwise the file name), stddev, tilt_x, tilt_y, tidecorr (a tide already contained in gravity, mGal; it is replaced by the tide chosen in 3.2) and lat, lon of each reading. Without lat and lon, the tide is computed at the station position from the station table.</p>
        <p class="ptitle small">Station coordinates</p>
        <pre class="code">line,station,lat,lon,H,u_topo
0,100,24.7867488,34.9337552,99.889,0
1,1,24.8244463,34.9962460,3.85,0.00241</pre>
        <p class="hint"><b>Required:</b> station, lat, lon (WGS84 degrees) and H (orthometric height, m), or h and N (ellipsoidal height and geoid undulation). Include the base station. <b>Optional:</b> line, date and instrument, to tell repeated station numbers apart; u_topo (terrain effect relative to the base, mGal per g/cm³) or tc (terrain correction at 2.67 g/cm³, mGal) for the complete Bouguer anomaly.</p>
        <div class="row"><button class="tbtn" type="button" id="bTplR">Copy an example readings table</button><button class="tbtn" type="button" id="bTpl">Copy the Wadi Ghadir station table</button><span class="hint" id="tplMsg"></span></div>`,
      draw() { $("bTpl").onclick = () => copyText(["instrument,date,line,station,lat,lon,H,u_topo", ...EXAMPLE.stations.map(s => [s.inst, s.date, s.line, s.station, s.lat, s.lon, s.H, s.u].join(","))].join("\n"), $("tplMsg"));
        $("bTplR").onclick = () => copyText(exampleReadings(), $("tplMsg")); } },
  ],
  ideas: [["layers", "Readings", "A CG-6 survey export as it comes from the meter, or a simple table (date, time, station, gravity) from any relative gravimeter. Several files and several instruments can be loaded together."],
    ["map", "Station table", "Positions and heights come from your GNSS processing. The base station must be in the table too, or its position is taken from the CG-6 GPS."],
    ["check", "Base station", "Set the line and station of your field base in chapter 3.3 (Wadi Ghadir: line 0, station 100)."]],
  notes: [NOTE("warn", "Heights decide the accuracy", "<p>1 cm of height error gives about 2 µGal of error in the Bouguer anomaly. The CG-6 internal GPS is accurate only to several metres, so use it only to look at the data, never for final products.</p>")],
});
function readFiles(list) {
  const msg = $("loadMsg"); if (!list.length) { msg.className = "msg bad"; msg.innerHTML = "<b>No files chosen.</b> Choose at least one CG-6 export."; return; }
  Promise.all(list.map(f => f.text().then(t => ({ name: f.name, text: t })))).then(fs => {
    const kind = f => { if (/^\/\s*CG-6|^\/Station\t/m.test(f.text)) return "cg6";
      const h = (f.text.split(/\r?\n/).find(l => l.trim() && !l.startsWith("#")) || "").toLowerCase();
      return /(^|[,;\t])\s*"?(gravity|reading|g|corrgrav|gobs|mgal)"?\s*([,;\t]|$)/.test(h) && /(date|datetime|timestamp)/.test(h) ? "readings" : "stations"; };
    const dat = fs.filter(f => kind(f) !== "stations"), csv = fs.filter(f => kind(f) === "stations");
    if (!dat.length) { msg.className = "msg bad"; msg.innerHTML = "<b>No gravity readings found.</b> Add CG-6 survey exports or a readings table with the columns date, time, station and gravity (see the formats below)."; return; }
    let stations = [];
    try { for (const c of csv) stations = stations.concat(ENG.normaliseStations(ENG.parseCSV(c.text))); }
    catch (e) { msg.className = "msg bad"; msg.innerHTML = "<b>Could not read the station table.</b> " + esc(e.message); return; }
    if (csv.length && !stations.length) { msg.className = "msg bad"; msg.innerHTML = `<b>${esc(csv.map(f => f.name).join(", "))}: no station coordinates found.</b> The station table needs the columns station, lat, lon and H.`; return; }
    LAB.input = { name: dat.map(f => f.name).join(", "), files: dat, stations, ref: null, hill: null, python: null };
    const nC = dat.filter(f => kind(f) === "cg6").length, nR = dat.length - nC;
    afterLoad([nC ? `${nC} CG-6 file(s)` : "", nR ? `${nR} readings table(s)` : ""].filter(Boolean).join(" and ") + (csv.length ? ` and ${stations.length} station coordinates` : ", no station table") + " loaded.");
  });
}
function afterLoad(text) {
  compute(); LAB.gridKey = ""; LAB.grid = null;
  // new data inside the Wadi Ghadir relief window keep the relief background
  if (!LAB.input.example && R()) { const h = EXAMPLE.hill, f = R().occ.filter(o => isF(o.lat) && o.role !== "hotel");
    LAB.input.hill = f.length && f.every(o => o.lon >= h.lon0 && o.lon <= h.lon1 && o.lat >= h.lat0 && o.lat <= h.lat1) ? h : null; }
  updateBadge(); if (HERO.W) heroSize(); repaint();
  if (LAB.error) { const m = $("loadMsg"); if (m) { m.className = "msg bad"; m.innerHTML = "<b>Could not process the data.</b> " + esc(LAB.error); } return; }
  const m = $("loadMsg"); if (m && !LAB.error) { m.className = "msg ok"; m.innerHTML = `<b>${esc(text)}</b> ${R().rows.length} readings, ${R().occ.length} occupations, ${okSt().length} stations ready for reduction.` + (okSt().length ? "" : " No station has a position yet: add a station table or allow the CG-6 GPS.")
    + (R().occ.some(o => o.role === "base") ? "" : ` <b>No reading at the base station (line ${esc(P().base.line || "–")}, station ${esc(P().base.station)}) was found:</b> set your base station in chapter 3.3.`); }
}
function updateBadge() { $("dataBadge").textContent = LAB.input.example ? "· Wadi Ghadir example data" : "· your data: " + LAB.input.files.length + " file(s)"; heroStats(); }
function heroStats() {
  if (!R()) return; const r = R();
  $("heroStats").innerHTML = `<div class="hstat"><b>${r.rows.length.toLocaleString("en-US").replace(",", " ")}</b><span>CG-6 readings</span></div><div class="hstat"><b>${okSt().length}</b><span>field stations</span></div><div class="hstat"><b>${days().length}</b><span>survey days${LAB.input.example ? ", Jan 2026" : ""}</span></div>`;
}
function copyText(text, msgEl) {
  const done = ok => { if (msgEl) msgEl.textContent = ok ? "Copied to the clipboard." : "Copy was blocked here: select the text below and copy it."; };
  try { navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); } catch (e) { done(false); }
}

/* ---------- 2.2 readings ---------- */
CH.push({ id: "2.2", sec: "data", short: "Readings", title: "The readings, day by day",
  tag: "Each dot is one 60-second CG-6 reading. Repeated readings at a station form a short flat run; the base station shows up several times a day.",
  goal: "browse the raw readings of each day and instrument before any correction.",
  figs: [{ title: "Corrected gravity of every reading (CorrGrav)", sub: "Choose the day. Grey: rejected in chapter 3.1. Move the pointer along the curve.",
    html: () => `<div class="row">Day ${sel("rdDay", days().map(d => [d, d]), LAB.ui.day || days()[0], "Day")}</div><canvas class="plot" id="rdCv"></canvas><div class="legend" id="rdLeg"></div><div class="kpis" id="rdK"></div>`,
    draw() { bindSel("rdDay", v => { LAB.ui.day = v; paintReadings(); }); onPaint(paintReadings); } }],
  ideas: [["clock", "Station runs", "Two or more readings at one station form an occupation (chapter 3.3). Gaps longer than 15 minutes start a new occupation."],
    ["level", "On-board corrections", "CorrGrav already contains the tide, tilt, temperature and drift corrections of the meter. Chapter 3.2 replaces the tide."]],
  eqs: [EQ("CorrGrav = RawGrav + TideCorr + TiltCorr + TempCorr + DriftCorr", "CG-6 on-board sum")],
});
function paintReadings() {
  const cv = $("rdCv"); if (!cv || !R()) return; const day = LAB.ui.day && days().includes(LAB.ui.day) ? LAB.ui.day : days()[0], t0 = dayStart(day);
  const series = [], all = [];
  insts().forEach(i => { const rr = R().rows.filter(r => r.inst === i && r.Date === day); if (!rr.length) return; all.push(...rr);
    const a = rr.filter(r => r.accepted), b = rr.filter(r => !r.accepted);
    series.push({ name: i, x: a.map(r => (r.t - t0) / 3.6e6), y: a.map(r => r.CorrGrav), color: instColor(i), dots: true, r: 3, unit: "mGal", dec: 3 });
    if (b.length) series.push({ x: b.map(r => (r.t - t0) / 3.6e6), y: b.map(r => r.CorrGrav), color: "rgba(120,120,120,.6)", dots: true, r: 3, noscale: true }); });
  const ys = all.filter(r => r.accepted).map(r => r.CorrGrav).sort((a, b) => a - b), lo = pctl(ys, 0.01), hi = pctl(ys, 0.99), pad = (hi - lo) * 0.15 + 1;
  const xs = all.map(r => (r.t - t0) / 3.6e6);
  plot(cv, { series, xlim: [Math.floor(Math.min(...xs)), Math.ceil(Math.max(...xs))], ylim: [lo - pad, hi + pad], xlabel: "hour of day (UTC)", ylabel: "CorrGrav [mGal]", xname: "hour", xfmt: v => fmt(v, 1), h: 300 });
  legend($("rdLeg"), insts().map(i => ({ dot: true, color: instColor(i), label: i })).concat([{ dot: true, color: "rgba(120,120,120,.6)", label: "rejected" }]));
  const oc = R().occ.filter(o => o.date === day);
  $("rdK").innerHTML = KPI("Readings this day", all.length) + KPI("Occupations", oc.length) + KPI("Base visits", oc.filter(o => o.role === "base").length) + KPI("Rejected readings", all.filter(r => !r.accepted).length, all.some(r => !r.accepted) ? "bad" : "ok");
}

/* ---------- 3.1 QC ---------- */
CH.push({ id: "3.1", sec: "corr", short: "Quality control", title: "Quality control of every reading",
  tag: "Every reading is kept, with an accept or reject decision and the reason. Change the limits and see how many readings and stations you lose.",
  goal: "set defensible limits for noise, tilt and repeatability.",
  figs: [
    { title: "Rejection limits", sub: "The Wadi Ghadir values are the defaults (report §3.1).",
      html: () => `<div class="ctrls">${slider("qStd", "StdDev reject above", 0.02, 0.2, 0.005, P().qc.stdReject, "mGal", v => v.toFixed(3))}${slider("qTilt", "Tilt reject above", 5, 60, 1, P().qc.tiltReject, "″")}${slider("qRep", "Repeat outlier above", 0.01, 0.2, 0.005, P().qc.repeatOutlier, "mGal", v => v.toFixed(3))}${slider("qGross", "Gross value above", 20, 1000, 10, P().qc.grossRange, "mGal")}</div><div class="kpis" id="qcK"></div>`,
      draw() { bindSlider("qStd", "mGal", v => { P().qc.stdReject = v; changed(); }, v => v.toFixed(3)); bindSlider("qTilt", "″", v => { P().qc.tiltReject = v; changed(); }); bindSlider("qRep", "mGal", v => { P().qc.repeatOutlier = v; changed(); }, v => v.toFixed(3)); bindSlider("qGross", "mGal", v => { P().qc.grossRange = v; changed(); });
        onPaint(() => { if (!$("qcK") || !R()) return; const r = R().rows, n = r.filter(x => !x.accepted).length, st = okSt().length; $("qcK").innerHTML = KPI("Accepted readings", r.length - n, "ok") + KPI("Rejected readings", n, n ? "bad" : "") + KPI("Usable occupations", R().occ.filter(o => o.usable).length) + KPI("Stations with products", st, "hl"); }); } },
    { title: "Reading noise and tilt", sub: "Left: StdDev of each 60-s reading. Right: tilt of the meter in X and Y; the box is the reject limit.",
      html: () => `<div class="dual"><canvas class="plot" id="qH"></canvas><canvas class="plot" id="qT"></canvas></div><div class="legend" id="qLeg"></div>`,
      draw() { onPaint(paintQC); } },
    { title: "Why readings were rejected", sub: "A reading can have more than one reason.", html: () => `<div class="scroll"><table class="t" id="qR"></table></div>`,
      draw() { onPaint(() => { const t = $("qR"); if (!t || !R()) return; const c = {}; R().rows.forEach(r => r.rej.forEach(x => { c[x] = c[x] || {}; c[x][r.inst] = (c[x][r.inst] || 0) + 1; })); t.innerHTML = `<tr><th>Reason</th>${insts().map(i => `<th>${i}</th>`).join("")}</tr>` + (Object.keys(c).length ? Object.keys(c).sort().map(k => `<tr><td>${k.replace(/_/g, " ").toLowerCase()}</td>${insts().map(i => `<td class="n">${c[k][i] || 0}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${insts().length + 1}">No reading rejected.</td></tr>`); }); } },
  ],
  ideas: [["wave", "StdDev", "Scatter of the 1-second samples inside one reading. High values mean wind, traffic or an unstable setup."],
    ["level", "Tilt", "The CG-6 corrects small tilts. Beyond about 30″ the levelling and its correction are not trusted."],
    ["check", "Repeats", "With three or more readings at a station, one that departs from the median of the others by more than the limit is rejected."],
    ["target", "Frozen sensor", "#0313 returned a fixed RawGrav of 8008.3 mGal for an hour on 18 Jan. These readings are rejected by a fixed window."]],
  tries: ["Lower the StdDev limit to 0.03 mGal: how many stations disappear?", "Set the tilt limit to 10″: which instrument loses more readings?"],
});
function paintQC() {
  if (!$("qH") || !R()) return; const ok = R().rows.filter(r => !r.overflow.length);
  const bins = []; for (let b = 0; b < 0.12; b += 0.004) bins.push(b);
  const series = insts().map(i => { const v = ok.filter(r => r.inst === i).map(r => Math.min(r.StdDev, 0.119)); return { name: i, x: bins.map(b => b + 0.002), y: bins.map(b => v.filter(s => s >= b && s < b + 0.004).length), color: instColor(i), w: 2, step: true }; });
  plot($("qH"), { series, xlim: [0, 0.12], xlabel: "StdDev [mGal] (clipped at 0.12)", ylabel: "readings", xname: "StdDev", xfmt: v => v.toFixed(3), vlines: [{ x: P().qc.stdReject, color: css("--warn"), label: "reject", dash: [] }, { x: P().qc.stdWarn, label: "warn" }], h: 260 });
  const t = P().qc.tiltReject, ts = insts().map(i => { const v = ok.filter(r => r.inst === i); return { name: i, x: v.map(r => Math.max(-45, Math.min(45, r.X))), y: v.map(r => Math.max(-45, Math.min(45, r.Y))), color: instColor(i), dots: true, r: 2.2, unit: "″" }; });
  const rj = ok.filter(r => !r.accepted); ts.push({ x: rj.map(r => Math.max(-45, Math.min(45, r.X))), y: rj.map(r => Math.max(-45, Math.min(45, r.Y))), color: css("--warn"), dots: true, r: 4, hollow: true });
  plot($("qT"), { series: ts, xlim: [-46, 46], ylim: [-46, 46], xlabel: "X tilt [″]", ylabel: "Y tilt [″]", xname: "X", h: 260, hlines: [{ y: t, color: css("--warn"), dash: [] }, { y: -t, color: css("--warn"), dash: [] }], vlines: [{ x: t, color: css("--warn"), dash: [] }, { x: -t, color: css("--warn"), dash: [] }], nohover: true });
  legend($("qLeg"), insts().map(i => ({ dot: true, color: instColor(i), label: i })).concat([{ dot: true, color: css("--warn"), label: "rejected (any reason)" }]));
}

/* ---------- 3.2 tide ---------- */
CH.push({ id: "3.2", sec: "corr", short: "Earth tide", title: "Earth tide correction",
  tag: "The Moon and the Sun change gravity by up to 0.25 mGal a day. The CG-6 removes this on board, but only correctly if its position and clock are right.",
  goal: "recompute the tide with the Longman (1959) formula and replace the on-board value.",
  figs: [{ title: "Tide correction during one day", sub: "On board (grey) and recomputed at the CG-6 GPS position and at the position typed into the meter. Times are UTC.",
    html: () => `<div class="row">Tide used ${segHTML("tdM", [["longman_gps", "Longman at GPS position"], ["longman_user", "Longman at typed position"], ["onboard", "CG-6 on board"]], P().tide.model, "Tide model")}</div>
      <div class="row">Day ${sel("tdDay", days().map(d => [d, d]), LAB.ui.day || days()[0], "Day")} Instrument ${sel("tdI", insts().map(i => [i, i]), LAB.ui.inst || insts()[0], "Instrument")}</div>
      <div class="ctrls">${slider("tdF", "Gravimetric factor", 1.10, 1.22, 0.005, P().tide.factor, "", v => v.toFixed(3))}</div>
      <canvas class="plot" id="tdCv"></canvas><div class="legend" id="tdLeg"></div><div class="kpis" id="tdK"></div>`,
    draw() { bindSeg("tdM", v => { P().tide.model = v; changed(); }); bindSel("tdDay", v => { LAB.ui.day = v; paintTide(); }); bindSel("tdI", v => { LAB.ui.inst = v; paintTide(); }); bindSlider("tdF", "", v => { P().tide.factor = v; changed(); }, v => v.toFixed(3)); onPaint(paintTide); } }],
  ideas: [["moon", "Longman (1959)", "Closed formula for the attraction of the Moon and the Sun on a rigid Earth, multiplied by a gravimetric factor of about 1.16 for the elastic Earth."],
    ["map", "Position matters", "The tide depends on latitude and longitude. #0313 still had Toronto typed in as its position, so its on-board tide is wrong by up to 0.2 mGal."],
    ["clock", "Time zone test", "The on-board tide is reproduced to 0.2 µGal with the time stamps taken as UTC; shifting them by hours does not fit."]],
  eqs: [EQ("g<sub>tidefix</sub> = CorrGrav − TideCorr + tide(φ<sub>GPS</sub>, λ<sub>GPS</sub>, t)", "Tide replacement")],
  tries: ["Choose CG6-0313 and compare the typed position with the GPS position.", "Change the gravimetric factor to 1.20: how large is the effect?"],
  notes: [NOTE("key", "ETERNA in the notebook", "<p>The Python notebook 03 computes the tide with ETERNA (pygtide), a full tidal potential catalogue. It differs from Longman by 7 µGal rms here.</p>")],
});
function paintTide() {
  const cv = $("tdCv"); if (!cv || !R()) return; const day = days().includes(LAB.ui.day) ? LAB.ui.day : days()[0], inst = insts().includes(LAB.ui.inst) ? LAB.ui.inst : insts()[0], t0 = dayStart(day);
  const rr = R().rows.filter(r => r.inst === inst && r.Date === day).sort((a, b) => a.t - b.t);
  const r0 = rr.find(r => isF(r.LatGPS)) || rr[0], curve = [], cx = [];
  if (r0) for (let h = 0; h <= 24; h += 0.1) { cx.push(h); curve.push(1000 * GL.longman(r0.LatGPS, r0.LonGPS, 0, t0 + h * 3.6e6, P().tide.factor).total); }
  const X = rr.map(r => (r.t - t0) / 3.6e6);
  plot(cv, { series: [{ name: "Longman at GPS", x: cx, y: curve, color: acc(), w: 1.6, unit: "µGal", dec: 1 },
    { name: "on board", x: X, y: rr.map(r => 1000 * r.TideCorr), color: "rgba(120,120,120,.9)", dots: true, r: 3, unit: "µGal", dec: 1 },
    { name: "typed position", x: X, y: rr.map(r => 1000 * r.tideUser), color: css("--blue"), dots: true, r: 2.2, unit: "µGal", dec: 1 }],
    xlim: [0, 24], xstep: 3, xlabel: "hour of day (UTC)", ylabel: "tide correction [µGal]", xname: "hour", xfmt: v => fmt(v, 1), h: 280 });
  legend($("tdLeg"), [{ color: acc(), label: "Longman at the CG-6 GPS position" }, { dot: true, color: "rgba(120,120,120,.9)", label: "CG-6 on board" }, { dot: true, color: css("--blue"), label: "Longman at the typed position" }]);
  const rms = i => { const v = R().rows.filter(r => r.inst === i).map(r => (r.tideGps - r.TideCorr) * 1000).filter(isF); return Math.sqrt(ENG.mean(v.map(x => x * x))); };
  $("tdK").innerHTML = insts().map(i => KPI(`${i}: GPS − on board (rms)`, fmt(rms(i), 1) + " <small>µGal</small>", rms(i) > 10 ? "bad" : "ok")).join("") + KPI("Tide used", { longman_gps: "Longman, GPS", longman_user: "Longman, typed", onboard: "On board" }[P().tide.model]);
}

/* ---------- 3.3 base and drift ---------- */
CH.push({ id: "3.3", sec: "corr", short: "Base and drift", title: "Base station control and instrument drift",
  tag: "The meter reads the field base several times a day. Between two base readings the drift is taken as linear, and every station becomes a difference to the base.",
  goal: "choose the base, check the drift of each day and see how well it is controlled.",
  figs: [
    { title: "Base stations", sub: "Line and station number of the field base and of an optional second base (Wadi Ghadir: the hotel, line 0 station 0).",
      html: () => `<div class="row">Field base: line <input type="text" id="bL" value="${esc(P().base.line)}" size="4"> station <input type="text" id="bS" value="${esc(P().base.station)}" size="5"> ${chk("hU", "Second base", P().hotel.use)} line <input type="text" id="hL" value="${esc(P().hotel.line)}" size="4"> station <input type="text" id="hS" value="${esc(P().hotel.station)}" size="5"><button class="tbtn" id="bApply" type="button">Apply</button></div>
        <div class="ctrls">${slider("tieH", "Second-base tie, max.", 1, 12, 0.5, P().hotel.tieMaxH, "h", v => v.toFixed(1))}${slider("tare", "Tare threshold", 0.05, 1, 0.05, P().drift.tareMgal, "mGal", v => v.toFixed(2))}</div><div class="kpis" id="dK"></div>`,
      draw() { $("bApply").onclick = () => { Object.assign(P().base, { line: $("bL").value.trim(), station: $("bS").value.trim() }); Object.assign(P().hotel, { line: $("hL").value.trim(), station: $("hS").value.trim() }); changed(); };
        bindChk("hU", v => { P().hotel.use = v; changed(); }); bindSlider("tieH", "h", v => { P().hotel.tieMaxH = v; changed(); }, v => v.toFixed(1)); bindSlider("tare", "mGal", v => { P().drift.tareMgal = v; changed(); }, v => v.toFixed(2));
        onPaint(() => { if (!$("dK") || !R()) return; const b = R().base; $("dK").innerHTML = insts().map(i => KPI(`${i} drift model σ`, fmt(1000 * b.modelSigma[i], 0) + " <small>µGal</small>")).join("") + KPI("Base controls", b.ctrl.filter(c => c.src === "base").length) + KPI("Second-base controls", b.ctrl.filter(c => c.src === "hotel").length) + KPI("No control", R().occ.filter(o => o.drift === "NO_CONTROL").length, R().occ.some(o => o.drift === "NO_CONTROL") ? "bad" : "ok"); }); } },
    { title: "Drift during one day", sub: "Large dots: base controls with their uncertainty, relative to the first base reading of the day. Line: drift model at every occupation. Small dots: field stations, plotted at their drift-model value.",
      html: () => `<div class="row">Instrument ${sel("dI", insts().map(i => [i, i]), LAB.ui.inst || insts()[0], "Instrument")} Day ${sel("dD", days().map(d => [d, d]), LAB.ui.day || days()[0], "Day")}</div><canvas class="plot" id="dCv"></canvas><div class="legend" id="dLeg"></div>`,
      draw() { bindSel("dI", v => { LAB.ui.inst = v; paintDrift(); }); bindSel("dD", v => { LAB.ui.day = v; paintDrift(); }); onPaint(paintDrift); } },
    { title: "Drift over the whole survey", sub: "Base readings of each instrument relative to its first one. The old meter #0313 drifts by about 0.3 mGal a day.",
      html: () => `<canvas class="plot" id="dAll"></canvas>`, draw() { onPaint(paintDriftAll); } },
  ],
  ideas: [["clock", "Piecewise linear", "Between two base readings the drift is a straight line in time. Each station gets the base value interpolated to its reading time."],
    ["network", "Second base", "Hotel readings, converted with the median hotel → base difference (tie), control the start and end of days without a base reading."],
    ["target", "Leave-one-out", "Each interior base reading is predicted from its neighbours. The scatter of these misclosures is the drift-model uncertainty."]],
  eqs: [EQ(`Δg<sub>100</sub>(t) = g(t) − [g<sub>B1</sub> + ${FR("t − t<sub>B1</sub>", "t<sub>B2</sub> − t<sub>B1</sub>")}(g<sub>B2</sub> − g<sub>B1</sub>)]`, "Gravity relative to the base")],
  tries: ["Switch the second base off: which days lose stations?", "Look at CG6-0313 on 18 Jan: why is there a gap without base control?"],
});
function paintDrift() {
  const cv = $("dCv"); if (!cv || !R()) return; const inst = insts().includes(LAB.ui.inst) ? LAB.ui.inst : insts()[0], day = days().includes(LAB.ui.day) ? LAB.ui.day : days()[0], t0 = dayStart(day);
  const c = R().base.ctrl.filter(x => x.inst === inst && x.date === day), o = R().occ.filter(x => x.inst === inst && x.date === day && isF(x.g100)).sort((a, b) => a.t - b.t);
  if (!o.length) { plot(cv, { series: [], xlim: [0, 24], xlabel: "hour of day (UTC)", h: 260 }); legend($("dLeg"), [{ text: "No readings of this instrument on this day." }]); return; }
  const f = o.filter(x => x.role === "field"), cb = c.filter(x => x.src === "base"), ch = c.filter(x => x.src === "hotel"), H = x => (x.t - t0) / 3.6e6;
  const xs = o.map(H), g0 = (cb[0] || c[0] || o[0]).g100, mg = v => 1000 * (v - g0);
  plot(cv, { series: [{ name: "drift model", x: o.map(H), y: o.map(x => mg(x.g100)), color: acc(), w: 2, unit: "µGal", dec: 0 },
    { name: "base", x: cb.map(H), y: cb.map(x => mg(x.g100)), color: css("--ink"), dots: true, r: 4.5, err: cb.map(x => 1000 * x.sigma), unit: "µGal", dec: 0 },
    { name: "second base", x: ch.map(H), y: ch.map(x => mg(x.g100)), color: css("--blue"), dots: true, r: 4.5, err: ch.map(x => 1000 * x.sigma), unit: "µGal", dec: 0 },
    { x: f.map(H), y: f.map(x => mg(x.g100)), color: instColor(inst), dots: true, r: 2.4 }],
    xlim: [Math.floor(Math.min(...xs)) - 0.5, Math.ceil(Math.max(...xs)) + 0.5], xlabel: "hour of day (UTC)", ylabel: "base reading − first base [µGal]", xname: "hour", xfmt: v => fmt(v, 2), h: 290 });
  legend($("dLeg"), [{ color: acc(), label: "drift model" }, { dot: true, color: css("--ink"), label: "base control" }, { dot: true, color: css("--blue"), label: "second-base control" }, { dot: true, color: instColor(inst), label: "field stations" }, { text: f.filter(x => String(x.drift).includes("EXTRAP")).length ? `${f.filter(x => String(x.drift).includes("EXTRAP")).length} stations extrapolated beyond a control` : "all stations bracketed by controls" }]);
}
function paintDriftAll() {
  const cv = $("dAll"); if (!cv || !R()) return; const t0 = Math.min(...R().rows.map(r => r.t));
  const series = insts().map(i => { const c = R().base.ctrl.filter(x => x.inst === i && x.src === "base"); return { name: i, x: c.map(x => (x.t - t0) / 864e5), y: c.map(x => x.g100 - (c[0] ? c[0].g100 : 0)), color: instColor(i), dots: true, r: 3.5, unit: "mGal", dec: 3 }; });
  const xs = series.flatMap(s => s.x);
  plot(cv, { series, xlim: [0, Math.ceil(Math.max(1, ...xs))], xlabel: "days since the first reading", ylabel: "base reading − first [mGal]", xname: "day", xfmt: v => fmt(v, 2), h: 240, hlines: [{ y: 0 }] });
}

/* ---------- 3.4 calibration ---------- */
CH.push({ id: "3.4", sec: "corr", short: "Calibration", title: "Calibrating one meter against the other",
  tag: "Two meters measured the same differences slightly differently. The ratio of their readings is a scale factor; it is found twice, from the base ties and from shared stations.",
  goal: "estimate and apply the scale factor of each meter relative to the reference meter.",
  figs: [{ title: "Shared stations", sub: "Stations read by both meters (closer than the separation limit). The line has the slope of the applied factor k.",
    html: () => `<div class="row">Reference meter ${sel("scR", [["auto", "automatic (most stations)"], ...insts().map(i => [i, i])], P().scale.refInst, "Reference meter")} ${chk("scA", "Apply the scale factor", P().scale.apply)}</div>
      <div class="ctrls">${slider("scS", "Shared station within", 1, 30, 1, P().scale.pairMaxSepM, "m")}</div><canvas class="plot" id="scCv"></canvas><div class="kpis" id="scK"></div>`,
    draw() { bindSel("scR", v => { P().scale.refInst = v; changed(); }); bindChk("scA", v => { P().scale.apply = v; changed(); }); bindSlider("scS", "m", v => { P().scale.pairMaxSepM = v; changed(); }); onPaint(paintScale); } }],
  ideas: [["scale", "Two estimates", "k from the hotel → base differences of both meters, and k from shared stations (regression through the origin). They are combined only if they agree within 2σ."],
    ["check", "Re-tie", "Where the old meter's drift had to be extrapolated, its stations are shifted to match shared stations of the reference meter."]],
  eqs: [EQ("Δg<sub>ref</sub> = k · Δg<sub>other</sub>", "Scale factor"), EQ(`k = ${FR("w<sub>1</sub>k<sub>tie</sub> + w<sub>2</sub>k<sub>pair</sub>", "w<sub>1</sub> + w<sub>2</sub>")},&nbsp; w = 1/σ²`, "Combined estimate")],
});
function paintScale() {
  const cv = $("scCv"); if (!cv || !R()) return; const S = R().scale, others = Object.keys(S.est);
  if (!others.length) { plot(cv, { series: [], xlim: [0, 1], h: 220 }); $("scK").innerHTML = KPIT("Only one meter", "Nothing to calibrate."); return; }
  const inst = others[0], pr = S.pairs[inst] || [], e = S.est[inst], xs = pr.map(p => p.x);
  const xl = xs.length ? [Math.min(...xs) - 2, Math.max(...xs) + 2] : [-1, 1];
  plot(cv, { series: [{ name: "shared stations", x: xs, y: pr.map(p => p.y), color: instColor(inst), dots: true, r: 5, unit: "mGal", dec: 3 },
    { name: "k line", x: xl, y: xl.map(v => v * e.k), color: acc(), w: 1.8 }, { x: xl, y: xl, color: css("--muted"), w: 1, dash: [4, 3] }],
    xlim: xl, xlabel: `Δg₁₀₀ ${inst} [mGal]`, ylabel: `Δg₁₀₀ ${S.ref} [mGal]`, xname: "Δg", xfmt: v => fmt(v, 2), h: 280 });
  $("scK").innerHTML = KPI("Reference meter", S.ref) + KPI("k from ties", isF(e.kTie) ? e.kTie.toFixed(5) + ` <small>± ${e.kTieSe.toFixed(5)}</small>` : "–") + KPI("k from shared stations", isF(e.kPair) ? e.kPair.toFixed(5) + ` <small>± ${e.kPairSe.toFixed(5)}</small>` : "–") + KPI("Agreement z", isF(e.z) ? e.z.toFixed(2) : "–", isF(e.z) && Math.abs(e.z) < 2 ? "ok" : "") + KPI("k applied to " + inst, e.k.toFixed(5), "hl") + KPI("Re-tied days", Object.values(S.retie).filter(x => x.applied).length);
}

/* ---------- 4.1 free-air ---------- */
CH.push({ id: "4.1", sec: "red", short: "Free-air anomaly", title: "Normal gravity and the free-air anomaly",
  tag: "Gravity grows towards the poles and shrinks with height. Removing both leaves the free-air anomaly, which still follows the topography.",
  goal: "compute the free-air anomaly relative to the base and see how it follows height.",
  figs: [
    { title: "Free-air anomaly against station height", sub: "Each dot is a station, coloured by meter. A strong positive trend means the Bouguer correction is still missing.",
      html: () => `<canvas class="plot" id="faCv"></canvas><div class="kpis" id="faK"></div>`, draw() { onPaint(paintFA); } },
    { title: "Free-air anomaly on the map", sub: "Relative to base 100.", html: () => mapHTML("faMap") + `<canvas class="plot" id="faCb"></canvas>`, draw() { onPaint(() => pointMap("faMap", "faCb", s => s.dFA, "ΔFA", false)); } },
  ],
  ideas: [["globe", "Normal gravity", "Somigliana's closed formula for the WGS84 ellipsoid gives the gravity of the reference Earth at each latitude."],
    ["arrow", "Free-air gradient", "About 0.3086 mGal per metre of height. The second-order formula of Hinze et al. (2005) adds the latitude and height dependence."]],
  eqs: [EQ("ΔFA = Δg<sub>100</sub> − [γ(φ) − γ(φ<sub>100</sub>)] + [F(φ, H) − F(φ<sub>100</sub>, H<sub>100</sub>)]", "Free-air anomaly relative to base 100"),
    EQ("F(φ, H) = (0.3087691 − 0.0004398 sin²φ) H − 7.2125·10⁻⁸ H²", "Second-order free-air term")],
});
function paintFA() {
  const cv = $("faCv"); if (!cv || !R()) return; const s = okSt().filter(x => isF(x.dFA) && isF(x.dh));
  plot(cv, { series: insts().map(i => { const v = s.filter(x => x.inst === i); return { name: i, x: v.map(x => x.dh), y: v.map(x => x.dFA), color: instColor(i), dots: true, r: 2.6, unit: "mGal", dec: 2 }; }),
    xlim: s.length ? [Math.min(...s.map(x => x.dh)) - 10, Math.max(...s.map(x => x.dh)) + 10] : [0, 1], xlabel: "height relative to base 100 [m]", ylabel: "ΔFA [mGal]", xname: "ΔH", xfmt: v => fmt(v, 0), h: 280 });
  const r = s.length > 3 ? corrOf(s.map(x => x.dh), s.map(x => x.dFA)) : NaN;
  $("faK").innerHTML = KPI("Stations", s.length) + KPI("Correlation with height", fmt(r, 2), Math.abs(r) > 0.5 ? "bad" : "ok") + KPI("Range", s.length ? fmt(Math.min(...s.map(x => x.dFA)), 1) + " … " + fmt(Math.max(...s.map(x => x.dFA)), 1) + " <small>mGal</small>" : "–");
}
function corrOf(a, b) { const ma = ENG.mean(a), mb = ENG.mean(b); let s = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return s / Math.sqrt(sa * sb); }
function pointMap(id, cbId, f, name, sym) {
  const cv = $(id); if (!cv || !R()) return; const s = okSt().filter(x => isF(f(x))), v = s.map(f), [lo, hi] = range(v, sym);
  drawMap(cv, { pts: s.map((x, i) => ({ lat: x.lat, lon: x.lon, v: v[i], label: stLabel(x), r: 3.3 })), lo, hi, pal: "anom", tip: $(id + "t"), name, unit: "mGal" });
  colorBar($(cbId), "anom", lo, hi, "mGal");
}

/* ---------- 4.2 Bouguer and terrain ---------- */
CH.push({ id: "4.2", sec: "red", short: "Bouguer and terrain", title: "Bouguer correction, terrain and the complete Bouguer anomaly",
  tag: "Remove the rock between each station and the base level. The slab assumes flat ground; the terrain correction uses the real relief from the DEM.",
  goal: "choose a reduction density and remove the topography from the anomaly.",
  figs: [
    { title: "Anomaly against height for your density", sub: "If the density is right, the Bouguer anomaly no longer follows the station height.",
      html: () => `<div class="row">${segHTML("bQ", [["SB", "Simple (slab)"], ["CB", "Complete (slab + terrain)"]], LAB.ui.bq || (hasTerrain() ? "CB" : "SB"), "Anomaly")}</div><div class="ctrls">${slider("bRho", "Reduction density ρ", 1.8, 3.2, 0.01, P().red.rho, "g/cm³", rhoFmt)}</div><canvas class="plot" id="bCv"></canvas><div class="kpis" id="bK"></div>`,
      draw() { bindSeg("bQ", v => { LAB.ui.bq = v; repaint(); }); bindSlider("bRho", "g/cm³", v => { P().red.rho = v; saveParams(); repaint(); }, rhoFmt); onPaint(paintBouguer); } },
    { title: "Bouguer anomaly on the map", sub: "Relative to base 100, for the density above.", html: () => mapHTML("bMap") + `<canvas class="plot" id="bCb"></canvas>`,
      draw() { onPaint(() => { const q = bq(); pointMap("bMap", "bCb", s => value(s, q, P().red.rho), QTY[q][1], true); }); } },
  ],
  ideas: [["layers", "Bouguer slab", "An infinite flat slab of rock of thickness ΔH attracts with 2πGρΔH = 0.04193·ρ·ΔH mGal (ρ in g/cm³, ΔH in m)."],
    ["mountain", "Terrain", "Hills above and valleys below the station both reduce gravity compared with the slab. The DEM prism model (Python chain, Harmonica, to 22 km with Earth curvature) gives u<sub>topo</sub> per g/cm³."],
    ["target", "Density choice", "2.67 g/cm³ is the conventional crustal value. Chapter 4.3 lets the data choose."]],
  eqs: [EQ("ΔSB(ρ) = ΔFA − 0.04193 ρ (H − H<sub>100</sub>)", "Simple Bouguer anomaly"), EQ("ΔCB(ρ) = ΔFA − ρ [g<sub>1</sub>(station) − g<sub>1</sub>(base 100)]", "Complete Bouguer anomaly", "g₁: attraction of the DEM topography for 1 g/cm³")],
  tries: ["Move the density from 2.0 to 3.0 and watch the correlation with height change sign.", "Compare simple and complete: where does the terrain matter most?"],
});
const bq = () => (LAB.ui.bq === "SB" || !hasTerrain() ? "SB" : "CB");
function paintBouguer() {
  const cv = $("bCv"); if (!cv || !R()) return; const q = bq(), rho = P().red.rho, s = okSt().filter(x => isF(value(x, q, rho)) && isF(x.dh)), y = s.map(x => value(x, q, rho));
  plot(cv, { series: insts().map(i => { const idx = s.map((x, k) => k).filter(k => s[k].inst === i); return { name: i, x: idx.map(k => s[k].dh), y: idx.map(k => y[k]), color: instColor(i), dots: true, r: 2.6, unit: "mGal", dec: 2 }; }),
    xlim: s.length ? [Math.min(...s.map(x => x.dh)) - 10, Math.max(...s.map(x => x.dh)) + 10] : [0, 1], xlabel: "height relative to base 100 [m]", ylabel: `${QTY[q][1]} [mGal]`, xname: "ΔH", xfmt: v => fmt(v, 0), h: 280 });
  const r = s.length > 3 ? corrOf(s.map(x => x.dh), y) : NaN;
  const nT = okSt().filter(x => isF(x.uTopo)).length;
  $("bK").innerHTML = KPI("Density", rho.toFixed(2) + " <small>g/cm³</small>", "hl") + KPI("Correlation with height", fmt(r, 2), Math.abs(r) > 0.3 ? "bad" : "ok") + KPIT("Terrain effect", nT ? `${nT} of ${okSt().length} stations` : "not in your station table") + KPI("Range", s.length ? fmt(Math.min(...y), 1) + " … " + fmt(Math.max(...y), 1) + " <small>mGal</small>" : "–");
}

/* ---------- 4.3 Nettleton ---------- */
CH.push({ id: "4.3", sec: "red", short: "Density (Nettleton)", title: "Let the data choose the density: Nettleton's method",
  tag: "Along a profile over hills and valleys, the correct density makes the Bouguer anomaly independent of the topography.",
  goal: "find the density that removes the correlation with topography along each profile.",
  figs: [
    { title: "One profile", sub: "Top: topography. Middle: Bouguer anomaly for trial densities (mean removed). Bottom: correlation between the detrended anomaly and the detrended height; the best density is where it crosses zero.",
      html: () => `<div class="row">Profile ${sel("nP", [], "", "Profile")} ${segHTML("nM", [["complete", "Complete"], ["simple", "Simple"]], LAB.ui.nm || (hasTerrain() ? "complete" : "simple"), "Method")}</div><canvas class="plot" id="nTopo"></canvas><canvas class="plot" id="nAn"></canvas><canvas class="plot" id="nSw"></canvas><div class="kpis" id="nK"></div>`,
      draw() { bindSel("nP", v => { LAB.ui.np = v; paintNettleton(); }); bindSeg("nM", v => { LAB.ui.nm = v; repaint(); }); onPaint(paintNettleton); } },
    { title: "All profiles", sub: "Profiles with at least 15 stations and 40 m of relief.", html: () => `<div class="scroll"><table class="t" id="nT"></table></div>`, draw() { onPaint(paintNetTable); } },
  ],
  ideas: [["ruler", "Detrend first", "A linear trend along the profile (regional field) is removed from both anomaly and height before correlating."],
    ["target", "Regression", "The same density follows from fitting ΔFA = a + b·x + ρ·u, which also gives a standard error."],
    ["warn", "Limits", "Profiles need relief and should cross no density boundary; otherwise the estimate reflects geology, not the topographic load."]],
  eqs: [EQ("ρ* : corr( detrend[ΔFA − ρu], detrend[H] ) = 0", "Nettleton (1939)")],
});
const netMethod = () => (LAB.ui.nm === "simple" || !hasTerrain() ? "simple" : "complete");
function paintNettleton() {
  if (!$("nTopo") || !R()) return; const pr = R().profiles.filter(p => p.eligible), s = $("nP");
  if (!pr.length) { $("nK").innerHTML = KPIT("No profile", "No line has at least 15 stations and 40 m of relief."); return; }
  if (!pr.some(p => p.id === LAB.ui.np)) LAB.ui.np = pr.slice().sort((a, b) => b.relief - a.relief)[0].id;
  s.innerHTML = pr.map(p => `<option value="${esc(p.id)}" ${p.id === LAB.ui.np ? "selected" : ""}>${esc(p.id)} (${p.st.length} st., ${fmt(p.relief, 0)} m)</option>`).join("");
  const p = pr.find(x => x.id === LAB.ui.np), m = netMethod(), N = ENG.nettleton(p, m), x = p.st.map(t => t.ch / 1000);
  plot($("nTopo"), { series: [{ name: "H", x, y: p.st.map(t => t.H), color: "#b48f5c", w: 2, fill: Math.min(...p.st.map(t => t.H)) - 5, fillAlpha: 0.25, unit: "m", dec: 1 }], xlim: [0, Math.max(...x)], ylabel: "H [m]", xlabel: "", xname: "km", xfmt: v => fmt(v, 1), h: 150 });
  const rhos = [2.0, 2.4, 2.67, 3.0], cols = ["#2356C8", "#1baf7a", acc(), "#8f1d1c"];
  plot($("nAn"), { series: rhos.map((r, k) => { const y = p.st.map(t => t.dFA - r * (m === "simple" ? t.uSlab : t.uTopo)), mu = ENG.mean(y); return { name: "ρ " + r, x, y: y.map(v => v - mu), color: cols[k], w: 1.8, unit: "mGal", dec: 2 }; }), xlim: [0, Math.max(...x)], ylabel: "anomaly − mean [mGal]", xlabel: "distance along the profile [km]", xname: "km", xfmt: v => fmt(v, 1), h: 220 });
  if (N) plot($("nSw"), { series: [{ name: "r", x: N.sweep.map(q => q.rho), y: N.sweep.map(q => q.r), color: acc(), w: 2.2, dec: 3 }], xlim: [1.8, 3.2], hlines: [{ y: 0 }], vlines: isF(N.rhoZero) ? [{ x: N.rhoZero, color: acc(), label: "ρ* = " + N.rhoZero.toFixed(2) }] : [], xlabel: "trial density [g/cm³]", ylabel: "correlation", xname: "ρ", xfmt: v => v.toFixed(2), h: 200 });
  $("nK").innerHTML = KPI("Zero-correlation density", N && isF(N.rhoZero) ? N.rhoZero.toFixed(2) + " <small>g/cm³</small>" : "no crossing", "hl") + KPI("Regression density", N && isF(N.rhoReg) ? N.rhoReg.toFixed(2) + ` <small>± ${N.rhoSe.toFixed(2)}</small>` : "–") + KPI("Length", fmt(p.length, 1) + " <small>km</small>") + KPI("Relief", fmt(p.relief, 0) + " <small>m</small>");
}
function paintNetTable() {
  const t = $("nT"); if (!t || !R()) return; const m = netMethod(), pr = R().profiles.filter(p => p.eligible);
  const res = pr.map(p => ({ p, n: ENG.nettleton(p, m) })).filter(x => x.n);
  const z = res.map(x => x.n.rhoZero).filter(isF), w = res.filter(x => isF(x.n.rhoReg) && x.n.rhoSe > 0 && x.n.rhoSe < 1);
  const wm = w.reduce((a, x) => a + x.n.rhoReg / x.n.rhoSe ** 2, 0) / w.reduce((a, x) => a + 1 / x.n.rhoSe ** 2, 0);
  t.innerHTML = `<tr><th>Profile</th><th>Stations</th><th>Length [km]</th><th>Relief [m]</th><th>ρ zero-corr.</th><th>ρ regression</th><th>±</th></tr>` + res.map(({ p, n }) => `<tr class="${p.id === LAB.ui.np ? "sel" : ""}"><td>${esc(p.id)}</td><td class="n">${p.st.length}</td><td class="n">${fmt(p.length, 1)}</td><td class="n">${fmt(p.relief, 0)}</td><td class="n">${isF(n.rhoZero) ? n.rhoZero.toFixed(2) : "–"}</td><td class="n">${isF(n.rhoReg) ? n.rhoReg.toFixed(2) : "–"}</td><td class="n">${isF(n.rhoSe) ? n.rhoSe.toFixed(2) : "–"}</td></tr>`).join("") +
    `<tr><td><b>Median / weighted mean</b></td><td></td><td></td><td></td><td class="n"><b>${z.length ? ENG.median(z).toFixed(2) : "–"}</b></td><td class="n"><b>${isF(wm) ? wm.toFixed(2) : "–"}</b></td><td></td></tr>`;
}

/* ---------- 5.1 gridding ---------- */
CH.push({ id: "5.1", sec: "maps", short: "Gridding and map", title: "From stations to a gridded anomaly map",
  tag: "The stations are interpolated onto a regular grid with a biharmonic spline after a block median, and nodes far from any station are blanked. Every setting is yours.",
  goal: "grid any anomaly with your settings and read the map.",
  figs: [{ title: "Anomaly map", sub: "Press Compute after changing the grid settings. Move the pointer over the map for values.",
    html: () => { const g = gDefaults();
      return `<div class="row">${segHTML("gQ", [["dg", "Δg₁₀₀"], ["dFA", "Free-air"], ["SB", "Simple Bouguer"], ["CB", "Complete Bouguer"]], g.q, "Quantity")}</div>
      <div class="row">Method ${segHTML("gM", [["spline", "Biharmonic spline"], ["idw", "Inverse distance"]], g.method, "Method")} Colours ${segHTML("gP", [["anom", "Blue–red"], ["spectral", "Spectral"], ["viridis", "Viridis"]], g.pal, "Palette")}</div>
      <div class="ctrls tight">${slider("gRho", "Density ρ", 1.8, 3.2, 0.01, P().red.rho, "g/cm³", rhoFmt)}${slider("gCell", "Grid cell", 50, 500, 25, g.cell, "m")}${slider("gBlock", "Block median", 0, 1000, 50, g.block, "m")}${slider("gDamp", "Spline damping (log₁₀)", -4, 2, 0.5, g.damp, "", v => v.toFixed(1))}${slider("gPow", "IDW power", 1, 5, 0.5, g.power, "", v => v.toFixed(1))}${slider("gBlank", "Blank beyond", 0.5, 6, 0.5, g.blank, "km", v => v.toFixed(1))}${slider("gCi", "Contour interval", 0.25, 5, 0.25, g.ci, "mGal", v => v.toFixed(2))}</div>
      <div class="row">${chk("gHill", "Relief", g.hill)}${chk("gSt", "Stations", g.st)}${chk("gCt", "Contours", g.ct)}<button class="tbtn go" type="button" id="gRun">Compute grid</button><button class="tbtn" type="button" id="gCv">Cross-validate</button></div>
      ${mapHTML("gMap", '<div class="busy" id="gBusy" hidden>Computing the grid…</div>')}<canvas class="plot" id="gCb"></canvas><div class="kpis" id="gK"></div>`; },
    draw() { const g = LAB.ui.g;
      bindSeg("gQ", v => { g.q = v; gridNow(); }); bindSeg("gM", v => { g.method = v; gridNow(); }); bindSeg("gP", v => { g.pal = v; paintGrid(); });
      bindSlider("gRho", "g/cm³", v => { P().red.rho = v; saveParams(); gridNow(); }, rhoFmt); bindSlider("gCell", "m", v => { g.cell = v; }); bindSlider("gBlock", "m", v => { g.block = v; }); bindSlider("gDamp", "", v => { g.damp = v; }, v => v.toFixed(1)); bindSlider("gPow", "", v => { g.power = v; }, v => v.toFixed(1));
      bindSlider("gBlank", "km", v => { g.blank = v; }, v => v.toFixed(1)); bindSlider("gCi", "mGal", v => { g.ci = v; paintGrid(); }, v => v.toFixed(2));
      bindChk("gHill", v => { g.hill = v; paintGrid(); }); bindChk("gSt", v => { g.st = v; paintGrid(); }); bindChk("gCt", v => { g.ct = v; paintGrid(); });
      $("gRun").onclick = gridNow; $("gCv").onclick = crossVal; onPaint(() => { if (gridKey() !== LAB.gridKey) gridNow(); else paintGrid(); }); } }],
  ideas: [["grid", "Cell size", "About a quarter to a half of the station spacing along the lines. Smaller cells only look more detailed."],
    ["map", "Blanking", "Grid values more than 1–2 km from any station are invented by the method: they are not shown."],
    ["check", "Cross-validation", "Stations are left out in 2 km blocks and predicted from the rest. The rms error compares methods and settings honestly."]],
  eqs: [EQ("g(x) = a + b·x + c·y + Σ f<sub>j</sub> r<sub>j</sub>²(ln r<sub>j</sub> − 1)", "Biharmonic spline (Sandwell 1987)"), EQ("(G + λI) f = d − trend", "Fit with damping λ")],
  tries: ["Grid the free-air anomaly, then the complete Bouguer anomaly: which features remain?", "Set the block median to 0 and the damping to −4: do bull's-eyes appear?", "Compare the cross-validation error of spline and inverse distance."],
});
function gDefaults() { return LAB.ui.g || (LAB.ui.g = { q: hasTerrain() ? "CB" : "SB", method: "spline", cell: 150, block: 200, damp: -1, blank: 2, ci: 1, pal: "anom", power: 2, hill: true, st: true, ct: true }); }
/* the current grid of 5.1, computed with its settings when it is missing or out of date */
function ensureGrid() {
  gDefaults(); if (LAB.grid && LAB.gridKey === gridKey()) return LAB.grid;
  try { const pts = gridPts(); if (pts.length < 5) return null; const t = Date.now(); LAB.grid = ENG.gridStations(pts, gridOpts()); LAB.grid.ms = Date.now() - t; LAB.grid.q = LAB.ui.g.q; LAB.grid.cv = null; LAB.gridKey = gridKey(); return LAB.grid; }
  catch (e) { console.error(e); return null; }
}
const gridKey = () => { const g = LAB.ui.g; return JSON.stringify([LAB.input.name, JSON.stringify(P()), g.q, g.method, g.cell, g.block, g.damp, g.power, g.blank]); };
function gridOpts() { const g = LAB.ui.g; return { method: g.method, cell: g.cell, block: Math.max(1, g.block), mindist: 50, damping: Math.pow(10, g.damp), power: g.power, blankKm: g.blank }; }
function gridPts() { const g = LAB.ui.g, rho = P().red.rho; return okSt().map(s => ({ lat: s.lat, lon: s.lon, v: value(s, g.q, rho) })).filter(p => isF(p.v)); }
function gridNow() {
  const busy = $("gBusy"); if (busy) busy.hidden = false;
  setTimeout(() => {
    try { const pts = gridPts(); if (pts.length < 5) throw new Error("Fewer than 5 stations have this quantity."); const t = Date.now(); LAB.grid = ENG.gridStations(pts, gridOpts()); LAB.grid.ms = Date.now() - t; LAB.grid.q = LAB.ui.g.q; LAB.grid.cv = null; LAB.gridKey = gridKey(); }
    catch (e) { LAB.grid = null; console.error(e); if ($("gK")) $("gK").innerHTML = KPIT("Grid failed", esc(e.message), "bad"); }
    if (busy) busy.hidden = true; paintGrid();
  }, 30);
}
function crossVal() { const k = $("gK"); if (k) k.insertAdjacentHTML("beforeend", KPIT("Cross-validation", "running…")); setTimeout(() => { if (!LAB.grid) return; LAB.grid.cv = ENG.crossValidate(gridPts(), gridOpts()); paintGrid(); }, 30); }
function paintGrid() {
  const cv = $("gMap"), G = LAB.grid; if (!cv || !G) return; const g = LAB.ui.g, vals = Array.from(G.z).filter((v, i) => G.mask[i]);
  const sym = g.q === "SB" || g.q === "CB", [lo, hi] = range(vals, sym && g.pal === "anom");
  const lev = []; for (let v = Math.ceil(lo / g.ci) * g.ci; v <= hi; v += g.ci) lev.push(+v.toFixed(6));
  drawMap(cv, { grid: G, lo, hi, pal: g.pal, contours: g.ct ? lev : null, hill: g.hill, stations: g.st, pts: g.st ? okSt().map(s => ({ lat: s.lat, lon: s.lon, color: "rgba(20,20,20,.55)", r: 1.3, stroke: false, label: stLabel(s), v: value(s, g.q, P().red.rho) })) : [], tip: $("gMapt"), name: QTY[g.q][1], unit: "mGal" });
  colorBar($("gCb"), g.pal, lo, hi, "mGal");
  $("gK").innerHTML = KPIT("Quantity", QTY[g.q][0] + (g.q === "SB" || g.q === "CB" ? `, ρ = ${P().red.rho.toFixed(2)}` : ""), "hl") + KPI("Grid", `${G.nx} × ${G.ny} <small>nodes</small>`) + KPI("Data after block median", G.nData) + KPI("Computed in", G.ms + " <small>ms</small>") + (G.cv ? KPI("Cross-validation rms", fmt(G.cv, 2) + " <small>mGal</small>") : KPIT("Cross-validation", "press Cross-validate"));
}

/* ---------- 5.2 filters ---------- */
const FILTERS = {
  sep: [["regional", "Regional"], ["residual", "Residual"], ["lowpass", "Low-pass"], ["highpass", "High-pass"], ["bandpass", "Band-pass"], ["polyreg", "Poly trend"], ["polyres", "Poly residual"]],
  edge: [["vd", "1VD"], ["vd2", "2VD"], ["dx", "∂/∂x"], ["dy", "∂/∂y"], ["thg", "THG"], ["as", "Analytic signal"], ["tilt", "Tilt"], ["theta", "Theta"], ["tdx", "TDX"]],
};
const fDefaults = () => LAB.ui.f || (LAB.ui.f = { type: "residual", up: 3000, lp: 3000, hp: 12000, ord: 2, dup: 0 });
const km = v => +(v / 1000).toFixed(2);
/* the filtered grid: {z, name, unit, pal, sym, lim, contours, mgal}; mgal: an anomaly in mGal (usable for modelling) */
function computeFilter(G, f) {
  const key = LAB.gridKey + JSON.stringify(f); if (LAB.fcache && LAB.fcache.key === key) return LAB.fcache.out;
  const gg = { nx: G.nx, ny: G.ny, cell: G.cell, z: G.z };
  const run = F => Float64Array.from(GL.specFilter(gg, F).out), keep = F => { const r = GL.specFilter(gg, F); return Float64Array.from(r.out, v => v + r.mean); };
  const diff = (a, b) => Float64Array.from(a, (v, i) => v - b[i]);
  const ro = k => 1 / (1 + Math.pow(k * 2.5 * G.cell / (2 * Math.PI), 8)) * (f.dup > 0 ? Math.exp(-k * f.dup) : 1);   // roll-off (+ optional upward smoothing)
  const o = { unit: "mGal", pal: "anom", sym: true, mgal: true, lim: null, contours: null };
  const up = () => keep(GL.FILT.up(f.up));
  let out;
  switch (f.type) {
    case "regional": out = { z: up(), name: `regional (upward ${km(f.up)} km)`, sym: false }; break;
    case "residual": out = { z: diff(G.z, up()), name: `residual (grid − upward ${km(f.up)} km)` }; break;
    case "lowpass": out = { z: keep(GL.FILT.lowpass(f.lp)), name: `low-pass (λ > ${km(f.lp)} km)`, sym: false }; break;
    case "highpass": out = { z: run(GL.FILT.highpass(f.hp)), name: `high-pass (λ < ${km(f.hp)} km)` }; break;
    case "bandpass": { const a = GL.FILT.lowpass(f.lp), b = GL.FILT.highpass(f.hp); out = { z: run((kx, ky, k, dc) => [a(kx, ky, k, dc)[0] * b(kx, ky, k, dc)[0], 0]), name: `band-pass (${km(f.lp)}–${km(f.hp)} km)` }; break; }
    case "polyreg": out = { z: MOD.polyTrend(G, f.ord), name: `polynomial trend, order ${f.ord}`, sym: false }; break;
    case "polyres": out = { z: diff(G.z, MOD.polyTrend(G, f.ord)), name: `residual of the order-${f.ord} trend` }; break;
    default: {
      const dx = run((kx, ky, k) => [0, kx * ro(k)]), dy = run((kx, ky, k) => [0, ky * ro(k)]), vd = run((kx, ky, k) => [k * ro(k), 0]);
      const thg = Float64Array.from(dx, (v, i) => Math.hypot(v, dy[i])), D = 180 / Math.PI, n = { mgal: false, unit: "mGal/km" };
      if (f.type === "vd") out = Object.assign(n, { z: vd.map(v => v * 1000), name: "1st vertical derivative" });
      else if (f.type === "vd2") out = Object.assign(n, { z: run((kx, ky, k) => [k * k * ro(k) * ro(k), 0]).map(v => v * 1e6), name: "2nd vertical derivative", unit: "mGal/km²" });
      else if (f.type === "dx") out = Object.assign(n, { z: dx.map(v => v * 1000), name: "∂g/∂x (east)" });
      else if (f.type === "dy") out = Object.assign(n, { z: dy.map(v => v * 1000), name: "∂g/∂y (north)" });
      else if (f.type === "thg") out = Object.assign(n, { z: thg.map(v => v * 1000), name: "total horizontal gradient", pal: "heat", sym: false });
      else if (f.type === "as") out = Object.assign(n, { z: Float64Array.from(vd, (v, i) => 1000 * Math.hypot(v, thg[i])), name: "analytic signal", pal: "heat", sym: false });
      else if (f.type === "tilt") out = Object.assign(n, { z: Float64Array.from(vd, (v, i) => Math.atan2(v, thg[i]) * D), name: "tilt angle", unit: "°", lim: [-90, 90], contours: [0] });
      else if (f.type === "theta") out = Object.assign(n, { z: Float64Array.from(vd, (v, i) => Math.acos(Math.min(1, thg[i] / (Math.hypot(v, thg[i]) || 1))) * D), name: "theta map", unit: "°", pal: "viridis", sym: false, lim: [0, 90] });
      else out = Object.assign(n, { z: Float64Array.from(vd, (v, i) => Math.atan2(thg[i], Math.abs(v)) * D), name: "TDX", unit: "°", pal: "heat", sym: false, lim: [0, 90] });
    }
  }
  out = Object.assign({}, o, out); LAB.fcache = { key, out }; return out;
}
CH.push({ id: "5.2", sec: "maps", short: "Filters and edges", title: "Regional, residual and edge maps",
  tag: "Separate the broad field of deep sources from the short wavelengths of shallow ones, then sharpen the edges of density contrasts with derivatives and their normalised forms.",
  goal: "separate regional and residual fields, read the power spectrum for source depths and outline edges with derivatives.",
  figs: [{ title: "Filtered grid", sub: "Uses the grid of chapter 5.1. Filters act in the wavenumber domain on the whole grid (padded and tapered), then the map is blanked like the grid. 1VD, 2VD: first and second vertical derivative; THG: total horizontal gradient; TDX: horizontal over vertical derivative.",
    html: () => { const f = fDefaults();
      return `<div class="row"><span class="hint" style="margin:0">Separation</span>${segHTML("fT1", FILTERS.sep, f.type, "Separation filters")}</div>
      <div class="row"><span class="hint" style="margin:0">Edges</span>${segHTML("fT2", FILTERS.edge, f.type, "Edge filters")}</div>
      <div class="ctrls">${slider("fUp", "Upward continuation", 250, 10000, 250, f.up, "m")}${slider("fLp", "Low-pass: keep λ longer than", 500, 20000, 250, f.lp, "m")}${slider("fHp", "High-pass: keep λ shorter than", 1000, 40000, 500, f.hp, "m")}${slider("fOrd", "Polynomial order", 1, 4, 1, f.ord, "")}${slider("fDup", "Smooth derivatives (upward)", 0, 1500, 50, f.dup, "m")}</div>
      ${mapHTML("fMap")}<canvas class="plot" id="fCb"></canvas><div class="row"><button class="tbtn" type="button" id="fCsv">Filtered grid (CSV)</button><button class="tbtn go" type="button" data-go="6.1">Take a section of this map →</button><span class="hint" id="fMsg"></span></div><div class="kpis" id="fK"></div>`; },
    draw() { const f = fDefaults();
      const pick = v => { f.type = v; ["fT1", "fT2"].forEach(id => $(id).querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v))); paintFilter(); };
      bindSeg("fT1", pick); bindSeg("fT2", pick);
      bindSlider("fUp", "m", v => { f.up = v; paintFilter(); }); bindSlider("fLp", "m", v => { f.lp = v; paintFilter(); }); bindSlider("fHp", "m", v => { f.hp = v; paintFilter(); });
      bindSlider("fOrd", "", v => { f.ord = v; paintFilter(); }); bindSlider("fDup", "m", v => { f.dup = v; paintFilter(); });
      $("fCsv").onclick = () => { const G = LAB.grid; if (!G) return; const F = computeFilter(G, f); saveFile("wadi_ghadir_filtered_grid.csv", gridCSV(F.z, F.name + " [" + F.unit + "]"), "text/csv"); };
      onPaint(paintFilter); } },
    { title: "Radially averaged power spectrum", sub: "ln P(k) of the grid. A straight segment of slope s belongs to an ensemble of sources at depth h = −s/2 (Spector & Grant 1970). Move the break between the deep and the shallow segment.",
      html: () => { const f = fDefaults(); f.kb = f.kb || 0.6; f.kmax = f.kmax || 4;
        return `<canvas class="plot" id="psCv"></canvas><div class="ctrls">${slider("psKb", "Break wavenumber", 0.1, 3, 0.05, f.kb, "rad/km", v => v.toFixed(2))}${slider("psKm", "Upper end of the shallow fit", 0.5, 15, 0.25, f.kmax, "rad/km", v => v.toFixed(2))}</div><div class="row"><button class="tbtn" type="button" id="psUse">Use 2π/k as the cut-off wavelengths</button></div><div class="kpis" id="psK"></div>`; },
      draw() { const f = fDefaults(); bindSlider("psKb", "rad/km", v => { f.kb = v; paintSpectrum(); }, v => v.toFixed(2)); bindSlider("psKm", "rad/km", v => { f.kmax = v; paintSpectrum(); }, v => v.toFixed(2));
        $("psUse").onclick = () => { const w = Math.round(2 * Math.PI / f.kb * 1000 / 250) * 250; f.hp = Math.min(40000, Math.max(1000, w)); f.lp = Math.min(20000, Math.max(500, Math.round(w / 2 / 250) * 250)); f.type = f.type === "bandpass" ? "bandpass" : "highpass"; APPI.go("5.2"); };
        onPaint(paintSpectrum); } }],
  ideas: [["filter", "Separation", "Upward continuation, low-pass and polynomial trends estimate the regional field; the residual is the grid minus the regional. The choice of the cut-off is a geological decision."],
    ["wave", "Derivatives", "The vertical derivative multiplies each wavelength by k, the second by k²: shallow, sharp sources stand out, and so does noise. Upward smoothing tames it."],
    ["target", "Normalised edges", "Tilt angle (zero over the edges), theta map (minimum over the edges) and TDX (maximum over the edges) balance strong and weak anomalies."],
    ["ruler", "Spectral depth", "Deep sources dominate the low wavenumbers and decay fast; shallow ones dominate high wavenumbers. Each straight segment of ln P gives a mean depth."]],
  eqs: [EQ("F(k) = e<sup>−k h</sup>", "Upward continuation"), EQ("F(k) = |k|<sup>n</sup>", "n-th vertical derivative"), EQ("|A| = √(g<sub>x</sub>² + g<sub>y</sub>² + g<sub>z</sub>²)", "Analytic signal"),
    EQ("θ = atan( g<sub>z</sub> / √(g<sub>x</sub>² + g<sub>y</sub>²) )", "Tilt angle"), EQ("cos φ = √(g<sub>x</sub>² + g<sub>y</sub>²) / |A|", "Theta map"), EQ("ln P(k) ≈ c − 2 h k", "Spectral depth")],
  tries: ["Compare the residual for 2 km and 6 km upward continuation: which anomalies survive?", "Set the high-pass wavelength from the spectral break and compare it with the residual.", "Switch between tilt, theta and TDX: do they outline the same edges?", "Use the second vertical derivative with and without 300 m upward smoothing."],
  notes: [NOTE("key", "Python companion", "<p>Notebook 03 computes the same maps with Harmonica, the SGTool filter engine and PyGMT.</p>")],
});
function noGrid(kpiId) {
  $(kpiId).innerHTML = KPIT("No grid yet", 'Compute a grid in chapter 5.1 first. <button class="tbtn" type="button" data-go="5.1">Open 5.1</button>');
  document.querySelectorAll("#" + kpiId + " [data-go]").forEach(b => b.onclick = () => APPI.go("5.1", true));
}
function paintFilter() {
  const cv = $("fMap"); if (!cv) return; const G = ensureGrid();
  if (!G) { noGrid("fK"); return; }
  const f = fDefaults(), F = computeFilter(G, f), vals = Array.from(F.z).filter((v, i) => G.mask[i]);
  let [lo, hi] = F.lim || range(vals, F.sym);
  drawMap(cv, { grid: Object.assign({}, G, { z: F.z }), lo, hi, pal: F.pal, contours: F.contours, hill: true, pts: okSt().map(s => ({ lat: s.lat, lon: s.lon, color: "rgba(20,20,20,.5)", r: 1.2, stroke: false, label: stLabel(s) })), tip: $("fMapt"), name: F.name, unit: F.unit });
  colorBar($("fCb"), F.pal, lo, hi, F.unit);
  $("fK").innerHTML = KPIT("Input grid", QTY[G.q][0], "hl") + KPIT("Filter", F.name) + KPI("Range", fmt(lo, 2) + " … " + fmt(hi, 2) + ` <small>${F.unit}</small>`);
}
function paintSpectrum() {
  const cv = $("psCv"); if (!cv) return; const G = ensureGrid(); if (!G) { plot(cv, { series: [], xlim: [0, 1], h: 160 }); return; }
  if (!LAB.spec || LAB.spec.key !== LAB.gridKey) LAB.spec = { key: LAB.gridKey, sp: MOD.radialSpectrum(G) };
  const f = fDefaults(), sp = LAB.spec.sp, kmax = Math.min(f.kmax, sp.k[sp.k.length - 1]);
  const d = MOD.depthFit(sp, sp.k[0], f.kb), s = MOD.depthFit(sp, f.kb, kmax), line = (q, col, nm) => q ? [{ name: nm, x: [q.k0, q.k1], y: [q.icpt + q.slope * q.k0, q.icpt + q.slope * q.k1], color: col, w: 2.4, dash: [6, 4], dec: 2 }] : [];
  plot(cv, { series: [{ name: "ln P", x: sp.k, y: sp.lnP, color: css("--ink"), dots: true, r: 2.8, dec: 2 }].concat(line(d, "#2356C8", "deep fit"), line(s, acc(), "shallow fit")),
    xlim: [0, Math.min(sp.k[sp.k.length - 1], Math.max(f.kmax * 1.4, 6))], vlines: [{ x: f.kb, color: "#2356C8", label: "break" }], xlabel: "wavenumber k [rad/km]", ylabel: "ln power", xname: "k", xfmt: v => fmt(v, 1), h: 260 });
  $("psK").innerHTML = KPI("Deep sources", d ? fmt(d.depth, 2) + " <small>km</small>" : "–", "hl") + KPI("Shallow sources", s ? fmt(s.depth, 2) + " <small>km</small>" : "–") + KPI("Wavelength at the break", fmt(2 * Math.PI / f.kb, 1) + " <small>km</small>") + KPIT("Note", "Depths are below the observation surface; the grid spacing limits the shallow estimate.");
}

/* ================================================================ MODELLING: sections, forward model, inversion */
const PYM = WG_DATA.model || null;          // pyGIMLi and SimPEG results of notebook 04 (Wadi Ghadir only)
function sDefaults() {
  const s = LAB.ui.s || (LAB.ui.s = { step: 250, corr: 500, field: "filter", next: "A" });
  const E = mapExtent(), inside = p => p && p[0] > E.lat0 && p[0] < E.lat1 && p[1] > E.lon0 && p[1] < E.lon1;
  if (!inside(s.A) || !inside(s.B)) {
    if (PYM && inside([PYM.A[1], PYM.A[0]]) && inside([PYM.B[1], PYM.B[0]])) { s.A = [PYM.A[1], PYM.A[0]]; s.B = [PYM.B[1], PYM.B[0]]; }
    else { const fx = (E.lon1 - E.lon0) * 0.18, fy = (E.lat1 - E.lat0) * 0.18; s.A = [E.lat0 + fy, E.lon0 + fx]; s.B = [E.lat1 - fy, E.lon1 - fx]; }
  }
  return s;
}
/* the field shown in the sections: the 5.1 grid or the 5.2 filter output */
function sectionField(G) {
  const s = sDefaults();
  if (s.field === "filter") return computeFilter(G, fDefaults());
  return { z: G.z, name: QTY[G.q][0] + (G.q === "SB" || G.q === "CB" ? ` (ρ ${P().red.rho.toFixed(2)})` : ""), unit: "mGal", mgal: true, pal: "anom", sym: G.q === "SB" || G.q === "CB" };
}
function sampleGrid(G, z, x, y) {
  const fx = (x - G.x0) / G.cell, fy = (y - G.y0) / G.cell, c = Math.floor(fx), r = Math.floor(fy);
  if (c < 0 || r < 0 || c >= G.nx - 1 || r >= G.ny - 1) return NaN;
  const i = r * G.nx + c; if (!G.mask[i] || !G.mask[i + 1] || !G.mask[i + G.nx] || !G.mask[i + G.nx + 1]) return NaN;
  const a = fx - c, b = fy - r; return z[i] * (1 - a) * (1 - b) + z[i + 1] * a * (1 - b) + z[i + G.nx] * (1 - a) * b + z[i + G.nx + 1] * a * b;
}
function heightGrid(G) {
  const key = LAB.input.name + "|" + (R() ? R().st.length : 0) + "|" + G.x0 + G.y0;
  if (LAB.hgrid && LAB.hgrid.key === key) return LAB.hgrid.g;
  const pts = okSt().filter(s => isF(s.H)).map(s => ({ lat: s.lat, lon: s.lon, v: s.H }));
  let g = null; try { if (pts.length >= 5) g = ENG.gridStations(pts, Object.assign(gridOpts(), { cell: Math.max(250, LAB.ui.g.cell) })); } catch (e) { console.error(e); }
  LAB.hgrid = { key, g }; return g;
}
/* the section A–B: profile points, field values, topography and the stations in the corridor */
function sectionData() {
  const G = ensureGrid(); if (!G) return null;
  const s = sDefaults(), F = sectionField(G), [xa, ya] = G.local.fwd(s.A[0], s.A[1]), [xb, yb] = G.local.fwd(s.B[0], s.B[1]);
  const L = Math.hypot(xb - xa, yb - ya), ux = (xb - xa) / L, uy = (yb - ya) / L;
  const key = [LAB.gridKey, LAB.fcache && LAB.fcache.key, s.field, s.A, s.B, s.step, s.corr].join("|");
  if (LAB.sec && LAB.sec.key === key) return LAB.sec;
  const HG = heightGrid(G), x = [], v = [], topo = [], lat = [], lon = [];
  for (let t = 0; t <= L + 1e-6; t += s.step) {
    const px = xa + ux * t, py = ya + uy * t, [la, lo] = G.local.inv(px, py);
    x.push(t); v.push(sampleGrid(G, F.z, px, py)); lat.push(la); lon.push(lo);
    if (HG) { const [hx, hy] = HG.local.fwd(la, lo); topo.push(sampleGrid(HG, HG.z, hx, hy)); } else topo.push(NaN);
  }
  const rho = P().red.rho, st = [];
  for (const o of okSt()) {
    const [px, py] = G.local.fwd(o.lat, o.lon), t = (px - xa) * ux + (py - ya) * uy, d = -(px - xa) * uy + (py - ya) * ux;
    if (t >= 0 && t <= L && Math.abs(d) <= s.corr) st.push({ t, d, H: o.H, v: value(o, G.q, rho), label: stLabel(o) });
  }
  LAB.sec = { key, L, x, v, topo, lat, lon, st, name: F.name, unit: F.unit, mgal: F.mgal, az: (Math.atan2(ux, uy) * 180 / Math.PI + 360) % 360 };
  return LAB.sec;
}
/* data for the modelling chapters: the section where it has values (an mGal field), mean removed */
function modelData() {
  const S = sectionData(); if (!S) return null;
  const ok = S.x.map((_, i) => i).filter(i => isF(S.v[i])); if (ok.length < 6) return { S, err: "The section has fewer than 6 points with data: move A and B into the survey area (chapter 6.1)." };
  if (!S.mgal) return { S, err: `The section shows ${S.name} [${S.unit}]. Modelling needs an anomaly in mGal: choose the grid or a separation filter in chapter 6.1.` };
  const x = ok.map(i => S.x[i]), d = MOD.centred(ok.map(i => S.v[i]));
  return { S, x, d, key: S.key };
}
/* the section canvas: depth section with model cells, bodies and handles */
function drawSection(cv, o) {
  const { ctx, W, H } = setup(cv, o.h || 300), pad = { l: 58, r: 12, t: 10, b: 38 }, [x0, x1] = o.xlim, zmax = o.zmax;
  const X = x => pad.l + (x - x0) / (x1 - x0) * (W - pad.l - pad.r), Z = z => pad.t + z / zmax * (H - pad.t - pad.b);
  const inv = (px, py) => [x0 + (px - pad.l) / (W - pad.l - pad.r) * (x1 - x0), (py - pad.t) / (H - pad.t - pad.b) * zmax];
  ctx.fillStyle = css("--paper2"); ctx.fillRect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b);
  ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b); ctx.clip();
  if (o.cells) { const c = o.cells, lim = c.lim;
    for (let iz = 0; iz < c.ze.length - 1; iz++) for (let ix = 0; ix < c.xe.length - 1; ix++) { const v = c.m[iz * (c.xe.length - 1) + ix]; if (v === null || !isF(v)) continue;
      ctx.fillStyle = lutCol("anom", (v + lim) / (2 * lim)); const xa = X(c.xe[ix]), xb = X(c.xe[ix + 1]), za = Z(c.ze[iz]), zb = Z(c.ze[iz + 1]); ctx.fillRect(xa, za, xb - xa + 0.6, zb - za + 0.6); } }
  (o.bodies || []).forEach((b, k) => {
    ctx.beginPath(); b.xy.forEach(([x, z], i) => { if (i) ctx.lineTo(X(x), Z(z)); else ctx.moveTo(X(x), Z(z)); }); ctx.closePath();
    if (!o.outline) { ctx.fillStyle = b.drho >= 0 ? "rgba(214,72,52,.42)" : "rgba(43,110,214,.42)"; ctx.fill(); }
    ctx.strokeStyle = k === o.sel ? css("--ink") : "rgba(20,25,30,.7)"; ctx.lineWidth = k === o.sel ? 2.2 : 1.2; ctx.setLineDash(o.outline ? [5, 3] : []); ctx.stroke(); ctx.setLineDash([]);
    if (o.handles) b.xy.forEach(([x, z]) => { ctx.beginPath(); ctx.arc(X(x), Z(z), k === o.sel ? 5.5 : 3.5, 0, 6.283); ctx.fillStyle = k === o.sel ? acc() : css("--paper"); ctx.fill(); ctx.strokeStyle = css("--ink"); ctx.lineWidth = 1.2; ctx.stroke(); });
    if (!o.outline) { const cx = b.xy.reduce((a, p) => a + p[0], 0) / b.xy.length, cz = b.xy.reduce((a, p) => a + p[1], 0) / b.xy.length; ctx.fillStyle = css("--ink"); ctx.font = "700 12px " + css("--disp"); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText((b.drho > 0 ? "+" : "") + Math.round(b.drho), X(cx), Z(cz)); }
  });
  ctx.restore();
  ctx.strokeStyle = css("--ink"); ctx.lineWidth = 1; ctx.strokeRect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b);
  ctx.fillStyle = css("--muted"); ctx.strokeStyle = css("--rule"); ctx.font = "500 12px " + css("--disp");
  const tx = nice(x0 / 1000, x1 / 1000, W < 480 ? 4 : 7), tz = nice(0, zmax / 1000, 4);
  ctx.textAlign = "center"; ctx.textBaseline = "top"; tx.ticks.forEach(v => { const px = X(v * 1000); if (px < pad.l - 1 || px > W - pad.r + 1) return; ctx.fillRect(px, H - pad.b, 1, 4); ctx.fillText(String(+v.toFixed(3)), px, H - pad.b + 6); });
  ctx.fillText("distance from A [km]", pad.l + (W - pad.l - pad.r) / 2, H - 15);
  ctx.textAlign = "right"; ctx.textBaseline = "middle"; tz.ticks.forEach(v => { const py = Z(v * 1000); if (py > H - pad.b + 1) return; ctx.fillRect(pad.l - 4, py, 4, 1); ctx.fillText(String(+v.toFixed(3)), pad.l - 6, py); });
  ctx.save(); ctx.translate(13, pad.t + (H - pad.t - pad.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText("depth [km]", 0, 0); ctx.restore();
  if (o.label) { ctx.fillStyle = "rgba(255,255,255,.86)"; ctx.font = "700 12px " + css("--disp"); const tw = ctx.measureText(o.label).width; ctx.fillRect(pad.l + 6, H - pad.b - 24, tw + 12, 18); ctx.fillStyle = "#111"; ctx.textAlign = "left"; ctx.fillText(o.label, pad.l + 12, H - pad.b - 15); }
  return { X, Z, inv, pad, W, H };
}
const secXlim = S => [-0.03 * S.L, 1.03 * S.L];
/* the A–B line, corridor and an optional marker, on a transparent canvas over a map */
function drawLineOverlay(ov, T, S, s, at) {
  const { ctx } = setup(ov, ov.parentNode.querySelector("canvas.plot").clientHeight);
  if (!T || !S) return; const pA = [T.X(s.A[1]), T.Y(s.A[0])], pB = [T.X(s.B[1]), T.Y(s.B[0])], len = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]) || 1;
  const kmpx = len / S.L, nx = -(pB[1] - pA[1]) / len, ny = (pB[0] - pA[0]) / len, w = s.corr * kmpx;
  ctx.fillStyle = "rgba(255,210,63,.18)"; ctx.beginPath(); ctx.moveTo(pA[0] + nx * w, pA[1] + ny * w); ctx.lineTo(pB[0] + nx * w, pB[1] + ny * w); ctx.lineTo(pB[0] - nx * w, pB[1] - ny * w); ctx.lineTo(pA[0] - nx * w, pA[1] - ny * w); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#111"; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(...pA); ctx.lineTo(...pB); ctx.stroke(); ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 2.2; ctx.stroke();
  [["A", pA], ["B", pB]].forEach(([t, p]) => { ctx.beginPath(); ctx.arc(p[0], p[1], 10, 0, 6.283); ctx.fillStyle = "#111"; ctx.fill(); ctx.fillStyle = "#ffd23f"; ctx.font = "800 12px " + css("--disp"); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, p[0], p[1] + 0.5); });
  if (isF(at)) { const f = at / S.L, p = [pA[0] + (pB[0] - pA[0]) * f, pA[1] + (pB[1] - pA[1]) * f]; ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, 6.283); ctx.fillStyle = acc(); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); }
}

/* ---------- 6.1 cross-section ---------- */
CH.push({ id: "6.1", sec: "model", short: "Cross-section", title: "A cross-section through the anomaly",
  tag: "Draw a line across the map and read the anomaly, the topography and the nearby stations along it. The section feeds the forward model and the inversion of the next chapters.",
  goal: "place a section across an anomaly and extract its profile.",
  figs: [{ title: "Section line", sub: "Click the map to set A, click again to set B. The yellow band is the corridor from which stations are projected onto the section.",
    html: () => { const s = sDefaults();
      return `<div class="row">Field ${segHTML("sF", [["grid", "Grid of 5.1"], ["filter", "Filter of 5.2"]], s.field, "Field")}<button class="tbtn" type="button" id="sSwap">Swap A and B</button><button class="tbtn" type="button" id="sDef">Default line</button><span class="hint" id="sNext" style="margin:0"></span></div>
      ${mapHTML("sMap", '<canvas class="mapov" id="sOv" aria-hidden="true"></canvas>')}<canvas class="plot" id="sCb"></canvas>
      <div class="ctrls">${slider("sStep", "Point spacing", 50, 1000, 50, s.step, "m")}${slider("sCorr", "Station corridor (±)", 100, 3000, 100, s.corr, "m")}</div>`; },
    draw() { const s = sDefaults();
      bindSeg("sF", v => { s.field = v; paintSection(); }); bindSlider("sStep", "m", v => { s.step = v; paintSection(); }); bindSlider("sCorr", "m", v => { s.corr = v; paintSection(); });
      $("sSwap").onclick = () => { [s.A, s.B] = [s.B, s.A]; paintSection(); }; $("sDef").onclick = () => { s.A = s.B = null; s.next = "A"; paintSection(); };
      $("sMap").onclick = e => { if (!LAB.secT) return; const r = $("sMap").getBoundingClientRect(), [la, lo] = LAB.secT.inv(e.clientX - r.left, e.clientY - r.top); const E = mapExtent(); if (la < E.lat0 || la > E.lat1 || lo < E.lon0 || lo > E.lon1) return;
        if (s.next === "A") { s.A = [la, lo]; s.next = "B"; } else { s.B = [la, lo]; s.next = "A"; } if (Math.hypot(s.A[0] - s.B[0], s.A[1] - s.B[1]) < 1e-3) return; paintSection(); };
      onPaint(paintSection); } },
    { title: "Profile A–B", sub: "Top: the field along the section and the stations in the corridor (grid field only). Bottom: topography from the station heights. Move the pointer along the profile to find the point on the map.",
      html: () => `<canvas class="plot" id="sPr"></canvas><canvas class="plot" id="sTo"></canvas><div class="row"><button class="tbtn" type="button" id="sCsv">Profile (CSV)</button><button class="tbtn go" type="button" data-go="6.2">Model this section →</button><span class="hint" id="sMsg"></span></div><div class="kpis" id="sK"></div>`,
      draw() { $("sCsv").onclick = () => { const S = sectionData(); if (S) saveFile("wadi_ghadir_section.csv", sectionCSV(S), "text/csv"); }; } }],
  ideas: [["ruler", "Across the strike", "Draw the section perpendicular to the elongation of the anomaly: the 2-D models of the next chapters assume bodies infinitely long across the section."],
    ["layers", "Which field", "Model the residual for shallow bodies; the complete Bouguer anomaly also holds the regional trend of deep sources."],
    ["map", "Corridor", "Stations within the corridor are projected perpendicularly onto the line; their scatter shows how well the grid follows the data."]],
  tries: ["Draw a section across the central high and compare the grid and the residual.", "Widen the corridor: do the station values scatter more around the grid profile?", "Does the anomaly follow the topography (a wrong Bouguer density) or not?"],
});
function sectionCSV(S) {
  return [`# Wadi Ghadir Gravity Lab, written by ${AUTHOR}. Section A (${S.lat[0].toFixed(6)}, ${S.lon[0].toFixed(6)}) – B (${S.lat[S.lat.length - 1].toFixed(6)}, ${S.lon[S.lon.length - 1].toFixed(6)}). Field: ${S.name} [${S.unit}].`,
    "distance_m,lat,lon,field,topography_m"].concat(S.x.map((x, i) => [x.toFixed(1), S.lat[i].toFixed(7), S.lon[i].toFixed(7), isF(S.v[i]) ? S.v[i].toFixed(4) : "", isF(S.topo[i]) ? S.topo[i].toFixed(1) : ""].join(","))).join("\n");
}
function paintSection() {
  const cv = $("sMap"); if (!cv) return; const G = ensureGrid(); if (!G) { noGrid("sK"); return; }
  const s = sDefaults(), F = sectionField(G), S = sectionData(), vals = Array.from(F.z).filter((v, i) => G.mask[i]);
  const [lo, hi] = F.lim || range(vals, F.sym);
  LAB.secT = drawMap(cv, { grid: Object.assign({}, G, { z: F.z }), lo, hi, pal: F.pal, contours: F.contours, hill: true, pts: okSt().map(o => ({ lat: o.lat, lon: o.lon, color: "rgba(20,20,20,.5)", r: 1.2, stroke: false, label: stLabel(o) })), tip: $("sMapt"), name: F.name, unit: F.unit });
  drawLineOverlay($("sOv"), LAB.secT, S, s); colorBar($("sCb"), F.pal, lo, hi, F.unit);
  $("sNext").textContent = "Next click sets " + s.next + ".";
  const xk = S.x.map(v => v / 1000), xl = [0, S.L / 1000], hov = x => drawLineOverlay($("sOv"), LAB.secT, S, s, x === null ? NaN : x * 1000);
  const ser = [{ name: F.name, x: xk, y: S.v, color: acc(), w: 2.4, unit: F.unit, dec: 2 }];
  if (s.field === "grid" && S.st.length) ser.push({ name: "stations", x: S.st.map(q => q.t / 1000), y: S.st.map(q => q.v), color: "rgba(20,25,30,.6)", dots: true, r: 2.6, unit: "mGal", dec: 2 });
  if (s.field === "filter" && F.mgal) ser.push({ name: "grid (5.1)", x: xk, y: S.x.map((x, i) => { const [px, py] = G.local.fwd(S.lat[i], S.lon[i]); return sampleGrid(G, G.z, px, py); }), color: "#7f8a93", w: 1.4, dash: [5, 4], unit: "mGal", dec: 2, y2: true });
  plot($("sPr"), { series: ser, xlim: xl, ylabel: F.unit, xlabel: "", xname: "km", xfmt: v => fmt(v, 1), h: 230, y2: ser.some(q => q.y2), y2label: "grid [mGal]", onHover: hov, snap: 0.6 });
  const th = S.topo.filter(isF), base = th.length ? Math.min(...th, ...S.st.map(q => q.H).filter(isF)) - 10 : 0;
  plot($("sTo"), { series: [{ name: "topography", x: xk, y: S.topo, color: "#b48f5c", w: 2, fill: base, fillAlpha: 0.3, unit: "m", dec: 0 }, { name: "station H", x: S.st.map(q => q.t / 1000), y: S.st.map(q => q.H), color: "#6b4f2a", dots: true, r: 2.4, unit: "m", dec: 1 }],
    xlim: xl, ylabel: "H [m]", xlabel: "distance from A [km]", xname: "km", xfmt: v => fmt(v, 1), h: 150, onHover: hov, snap: 0.6 });
  const nv = S.v.filter(isF).length;
  $("sK").innerHTML = KPI("Length", fmt(S.L / 1000, 2) + " <small>km</small>", "hl") + KPI("Azimuth A→B", fmt(S.az, 0) + "°") + KPI("Points with data", nv + " / " + S.x.length) + KPI("Stations in the corridor", S.st.length) + KPIT("Field", esc(S.name));
}

/* ---------- 6.2 forward model ---------- */
const FWD_START = PYM ? PYM.bodies : null;
function fmDefaults(S) {
  const m = LAB.ui.fm || (LAB.ui.fm = { sel: 0, zmax: 6000 });
  if (!m.bodies || m.forL !== Math.round(S.L)) {
    const useNb = FWD_START && PYM && Math.abs(PYM.L - S.L) < 50 && sDefaults().A && Math.abs(sDefaults().A[0] - PYM.A[1]) < 1e-4;
    m.bodies = useNb ? FWD_START.map(b => ({ name: b.name, drho: b.drho, xy: b.xy.map(([x, z]) => [x * 1000, z * 1000]) }))
      : [{ name: "body 1", drho: 150, xy: [[0.4 * S.L, 800], [0.6 * S.L, 800], [0.6 * S.L, 2000], [0.4 * S.L, 2000]] }];
    m.forL = Math.round(S.L); m.sel = 0;
  }
  return m;
}
CH.push({ id: "6.2", sec: "model", short: "Forward model", title: "Forward modelling with 2-D polygons",
  tag: "Build a density model of the section from polygons and compare its gravity effect with the data. Every polygon is a 2-D body that extends without end across the section (Talwani et al. 1959).",
  goal: "test a geological hypothesis: shapes, depths and density contrasts that explain the anomaly.",
  figs: [{ title: "Data and model response", sub: "The data and the response are compared without their means (the absolute level of relative gravity is unknown).",
    html: () => `<canvas class="plot" id="mPr"></canvas><div class="kpis" id="mK"></div>`, draw() { onPaint(paintForward); } },
    { title: "Density model", sub: "Drag a vertex to reshape a body, drag inside a body to move it. Double-click an edge to add a vertex, double-click a vertex to remove it. The numbers are density contrasts in kg/m³.",
      html: () => { const m = LAB.ui.fm || { zmax: 6000 };
        return `<div class="row" id="mSelRow"></div><canvas class="plot" id="mSec" style="touch-action:none;cursor:grab"></canvas>
        <div class="ctrls">${slider("mRho", "Density contrast of the body", -800, 800, 10, 0, "kg/m³")}${slider("mZ", "Depth of the section", 2000, 15000, 500, m.zmax, "m")}</div>
        <div class="row"><button class="tbtn go" type="button" id="mFit">Fit the densities</button><button class="tbtn" type="button" id="mAdd">Add a body</button><button class="tbtn" type="button" id="mDel">Delete the body</button><button class="tbtn" type="button" id="mReset">Start again</button><button class="tbtn" type="button" id="mCsv">Model (CSV)</button><span class="hint" id="mMsg"></span></div>`; },
      draw() { bindSlider("mRho", "kg/m³", v => { const m = LAB.ui.fm; if (m && m.bodies[m.sel]) { m.bodies[m.sel].drho = v; paintForward(); } });
        bindSlider("mZ", "m", v => { LAB.ui.fm.zmax = v; paintForward(); });
        $("mFit").onclick = () => { const D = modelData(), m = LAB.ui.fm; if (!D || D.err || !m.bodies.length) return; try { const r = MOD.fitDensities(D.x, D.d, m.bodies); m.bodies.forEach((b, k) => { b.drho = Math.round(r[k]); }); $("mMsg").textContent = "Densities fitted by least squares."; } catch (e) { $("mMsg").textContent = "The bodies cannot be fitted separately (they are too similar)."; } paintForward(); };
        $("mAdd").onclick = () => { const m = LAB.ui.fm, S = sectionData(); if (!S) return; const c = S.L * (0.3 + 0.4 * Math.random()), w = S.L * 0.08, z = m.zmax * 0.15; m.bodies.push({ name: "body " + (m.bodies.length + 1), drho: 100, xy: [[c - w, z], [c + w, z], [c + w, 2.5 * z], [c - w, 2.5 * z]] }); m.sel = m.bodies.length - 1; paintForward(); };
        $("mDel").onclick = () => { const m = LAB.ui.fm; if (!m.bodies.length) return; m.bodies.splice(m.sel, 1); m.sel = Math.max(0, m.sel - 1); paintForward(); };
        $("mReset").onclick = () => { LAB.ui.fm.bodies = null; paintForward(); };
        $("mCsv").onclick = () => { const m = LAB.ui.fm; if (m) saveFile("wadi_ghadir_forward_model.csv", [`# Wadi Ghadir Gravity Lab, written by ${AUTHOR}. 2-D bodies along the section: distance from A [m], depth [m], density contrast [kg/m³].`, "body,vertex,distance_m,depth_m,drho_kgm3"].concat(m.bodies.flatMap((b, k) => b.xy.map((p, i) => [k + 1, i + 1, p[0].toFixed(1), p[1].toFixed(1), b.drho].join(",")))).join("\n"), "text/csv"); };
        bindSectionDrag(); } }],
  ideas: [["cube", "2-D bodies", "Each polygon extends infinitely across the section. This is a good approximation where the anomaly is at least two to three times longer than it is wide."],
    ["scale", "Ambiguity", "A deep, dense body and a shallow, wide body can give the same anomaly. The data fix the excess mass, not its shape: add geology to decide."],
    ["target", "Linear in density", "The response is linear in the density contrasts, so for fixed shapes the best densities follow from least squares (button Fit)."]],
  eqs: [EQ("Δg(x) = 2Gρ Σ<sub>k</sub> f(x<sub>k</sub>, z<sub>k</sub>, x<sub>k+1</sub>, z<sub>k+1</sub>)", "Talwani et al. (1959)"), EQ("Δg<sub>max</sub> ≈ 2πGΔρ t", "Wide slab of thickness t")],
  tries: ["Move the dense block 1 km deeper: how must its density change to keep the amplitude?", "Delete all bodies but one and press Fit: can one body explain the whole profile?", "Make the light basin fill thinner and press Fit. Which density does it need?"],
  notes: [NOTE("key", "Python companion", "<p>Notebook 04 runs the same polygons with pyGIMLi (<code>solveGravimetry</code>); chapter 6.4 shows its results.</p>")],
});
function paintForward() {
  const pr = $("mPr"); if (!pr) return; const D = modelData();
  if (!D) { noGrid("mK"); return; }
  if (D.err) { plot(pr, { series: [], xlim: [0, 1], h: 140 }); $("mK").innerHTML = KPIT("Section", esc(D.err), "bad"); return; }
  const S = D.S, m = fmDefaults(S), resp = MOD.centred(MOD.forward(D.x, m.bodies)), xl = secXlim(S).map(v => v / 1000);
  plot(pr, { series: [{ name: "data", x: D.x.map(v => v / 1000), y: D.d, color: css("--ink"), dots: true, r: 2.6, unit: "mGal", dec: 2 }, { name: "model", x: D.x.map(v => v / 1000), y: resp, color: acc(), w: 2.6, unit: "mGal", dec: 2 }, { name: "residual", x: D.x.map(v => v / 1000), y: D.d.map((v, i) => v - resp[i]), color: "#7f8a93", w: 1.2, dash: [4, 3], unit: "mGal", dec: 2 }],
    xlim: xl, ylabel: "mGal", xlabel: "", xname: "km", xfmt: v => fmt(v, 1), h: 220, hlines: [{ y: 0 }] });
  const sec = $("mSec"); if (sec) { LAB.fmT = drawSection(sec, { xlim: secXlim(S), zmax: m.zmax, bodies: m.bodies, sel: m.sel, handles: true, h: Math.min(360, Math.max(240, sec.clientWidth * 0.42)) }); }
  const row = $("mSelRow"); if (row) { row.innerHTML = m.bodies.length ? "Body " + segHTML("mSel", m.bodies.map((b, k) => [k, `${k + 1}: ${(b.drho > 0 ? "+" : "") + b.drho}`]), m.sel, "Selected body") : '<span class="hint">No bodies: press Add a body.</span>'; bindSeg("mSel", v => { m.sel = +v; paintForward(); }); }
  const rs = $("mRho"); if (rs && m.bodies[m.sel]) { rs.value = m.bodies[m.sel].drho; $("mRhoo").textContent = m.bodies[m.sel].drho + " kg/m³"; }
  const r = MOD.rms(resp, D.d), r0 = MOD.rms(D.d.map(() => 0), D.d);
  $("mK").innerHTML = KPI("rms misfit", fmt(r, 2) + " <small>mGal</small>", r < 0.3 * r0 ? "ok" : "hl") + KPI("Data rms", fmt(r0, 2) + " <small>mGal</small>") + KPI("Explained", fmt(100 * (1 - (r * r) / (r0 * r0 || 1)), 0) + " <small>%</small>") + KPI("Bodies", m.bodies.length) + KPIT("Field", esc(S.name));
}
function bindSectionDrag() {
  const cv = $("mSec"); if (!cv) return; let drag = null, raf = 0;
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const near = (px, py) => { const T = LAB.fmT, m = LAB.ui.fm; if (!T || !m) return null; let best = null, bd = 13 * 13;
    m.bodies.forEach((b, k) => b.xy.forEach(([x, z], i) => { const d = (T.X(x) - px) ** 2 + (T.Z(z) - py) ** 2 - (k === m.sel ? 20 : 0); if (d < bd) { bd = d; best = { k, i }; } })); return best; };
  const inside = (b, x, z) => { let c = false; for (let i = 0, j = b.xy.length - 1; i < b.xy.length; j = i++) { const [xi, zi] = b.xy[i], [xj, zj] = b.xy[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const clampZ = z => Math.max(0, Math.min(LAB.ui.fm.zmax, z));
  cv.onpointerdown = e => { const [px, py] = pos(e), m = LAB.ui.fm, T = LAB.fmT; if (!m || !T) return; const v = near(px, py);
    if (v) { m.sel = v.k; drag = { type: "v", k: v.k, i: v.i }; }
    else { const [x, z] = T.inv(px, py), k = m.bodies.findIndex(b => inside(b, x, z)); if (k < 0) return; m.sel = k; drag = { type: "b", k, x, z }; }
    cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; paintForward(); };
  cv.onpointermove = e => { if (!drag) return; const [px, py] = pos(e), T = LAB.fmT, b = LAB.ui.fm.bodies[drag.k]; if (!T || !b) return; const [x, z] = T.inv(px, py);
    if (drag.type === "v") b.xy[drag.i] = [x, clampZ(z)];
    else { let dz = z - drag.z; const zs = b.xy.map(p => p[1]); dz = Math.max(-Math.min(...zs), Math.min(LAB.ui.fm.zmax - Math.max(...zs), dz)); b.xy = b.xy.map(([a, c]) => [a + x - drag.x, c + dz]); drag.x = x; drag.z += dz; }
    cancelAnimationFrame(raf); raf = requestAnimationFrame(paintForward); };
  cv.onpointerup = cv.onpointercancel = () => { drag = null; cv.style.cursor = "grab"; };
  cv.ondblclick = e => { const [px, py] = pos(e), m = LAB.ui.fm, T = LAB.fmT; if (!m || !T) return; const v = near(px, py);
    if (v) { const b = m.bodies[v.k]; if (b.xy.length > 3) b.xy.splice(v.i, 1); m.sel = v.k; paintForward(); return; }
    const b = m.bodies[m.sel]; if (!b) return; let best = -1, bd = 14 * 14, at = null;
    b.xy.forEach((p, i) => { const q = b.xy[(i + 1) % b.xy.length], ax = T.X(p[0]), az = T.Z(p[1]), bx = T.X(q[0]), bz = T.Z(q[1]), L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1, t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - az) * (bz - az)) / L2)), d = (ax + t * (bx - ax) - px) ** 2 + (az + t * (bz - az) - py) ** 2; if (d < bd) { bd = d; best = i; at = T.inv(px, py); } });
    if (best >= 0) { b.xy.splice(best + 1, 0, [at[0], clampZ(at[1])]); paintForward(); } };
}

/* ---------- 6.3 inversion ---------- */
const ivDefaults = () => LAB.ui.iv || (LAB.ui.iv = { cw: 400, zmax: 6000, nz: 24, sigma: 0.3, beta: 1, z0: 500, ls: 0, lam: "auto", bodies: true });
CH.push({ id: "6.3", sec: "model", short: "Inversion", title: "Inversion: let the data choose a density model",
  tag: "The section is divided into rectangular cells and the density contrast of every cell is found by regularised least squares: fit the data to their error, with the smallest or smoothest model, weighted with depth.",
  goal: "invert the section for density, choose the regularisation and see what the data can and cannot resolve.",
  figs: [{ title: "Data fit and L-curve", sub: "λ balances data fit against model size. Auto picks the λ for which the misfit equals the data error (χ²/N = 1).",
    html: () => `<canvas class="plot" id="iPr"></canvas><div class="row"><span class="hint" style="margin:0">λ</span>${segHTML("iAuto", [["auto", "Auto (χ²/N = 1)"], ["man", "Manual"]], ivDefaults().lam === "auto" ? "auto" : "man", "Lambda mode")}</div>
      <div class="ctrls">${slider("iLam", "log₁₀ λ (relative)", -9, 3, 0.1, ivDefaults().lam === "auto" ? -3 : ivDefaults().lam, "", v => v.toFixed(1))}</div><canvas class="plot" id="iLc"></canvas><div class="kpis" id="iK"></div>`,
    draw() { const v = ivDefaults(); bindSeg("iAuto", x => { v.lam = x === "auto" ? "auto" : +$("iLam").value; paintInversion(); }); bindSlider("iLam", "", x => { v.lam = x; $("iAuto").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === "man")); paintInversion(); }, x => x.toFixed(1));
      onPaint(paintInversion); } },
    { title: "Density section", sub: "Density contrast of the cells (kg/m³). Dashed: the bodies of the forward model of 6.2 for comparison. The section extends beyond A and B by padding cells.",
      html: () => { const v = ivDefaults();
        return `<div class="mapwrap"><canvas class="plot" id="iSec"></canvas><div class="busy" id="iBusy" hidden>Computing the sensitivities…</div></div><canvas class="plot" id="iCb"></canvas>
        <div class="ctrls">${slider("iSig", "Data error σ", 0.05, 1.5, 0.05, v.sigma, "mGal", x => x.toFixed(2))}${slider("iBeta", "Depth weighting β", 0, 2, 0.1, v.beta, "", x => x.toFixed(1))}${slider("iZ0", "Depth weighting z₀", 100, 3000, 100, v.z0, "m")}${slider("iLs", "Smoothness length", 0, 3000, 100, v.ls, "m")}${slider("iCw", "Cell width", 200, 1500, 50, v.cw, "m")}${slider("iZm", "Depth of the mesh", 2000, 15000, 500, v.zmax, "m")}</div>
        <div class="row">${chk("iBod", "Show the forward-model bodies", v.bodies)}<button class="tbtn" type="button" id="iCsv">Model (CSV)</button><span class="hint" id="iMsg"></span></div>`; },
      draw() { const v = ivDefaults(), re = () => { LAB.invP = null; paintInversion(); };
        bindSlider("iSig", "mGal", x => { v.sigma = x; re(); }, x => x.toFixed(2)); bindSlider("iBeta", "", x => { v.beta = x; re(); }, x => x.toFixed(1)); bindSlider("iZ0", "m", x => { v.z0 = x; re(); });
        bindSlider("iLs", "m", x => { v.ls = x; re(); }); bindSlider("iCw", "m", x => { v.cw = x; re(); }); bindSlider("iZm", "m", x => { v.zmax = x; re(); });
        bindChk("iBod", x => { v.bodies = x; paintInversion(); });
        $("iCsv").onclick = () => { const I = LAB.invR; if (!I) return; const M = I.P.M, out = [`# Wadi Ghadir Gravity Lab, written by ${AUTHOR}. 2-D density inversion of the section; λ(rel) ${I.s.rel.toExponential(2)}, χ²/N ${I.s.chi2n.toFixed(2)}.`, "distance_m,depth_m,drho_kgm3"];
          for (let iz = 0; iz < M.nz; iz++) for (let ix = 0; ix < M.nx; ix++) out.push([((M.xe[ix] + M.xe[ix + 1]) / 2).toFixed(1), ((M.ze[iz] + M.ze[iz + 1]) / 2).toFixed(1), I.s.m[iz * M.nx + ix].toFixed(2)].join(","));
          saveFile("wadi_ghadir_inversion_model.csv", out.join("\n"), "text/csv"); }; } }],
  ideas: [["grid", "Many cells, few data", "There are far more cells than data: infinitely many models fit. Regularisation picks the simplest one in a chosen sense."],
    ["mountain", "Depth weighting", "Without it, all mass is put just below the surface, where cells are most sensitive. (1 + z/z₀)<sup>−β/2</sup> with β ≈ 1 balances the 2-D kernels."],
    ["wave", "Smallest or smoothest", "Smoothness length 0 gives the smallest model; a length of 1–2 km spreads the mass into smooth, broad bodies (like pyGIMLi with cType 1)."],
    ["target", "Discrepancy principle", "Fitting the data better than their error (χ²/N < 1) only fits noise and creates artefacts."]],
  eqs: [EQ("Φ = Σ((Gm − d)/σ)² + λ‖W R m‖²", "Objective function"), EQ("m = L<sup>−T</sup>Ĝ<sup>T</sup>(ĜĜ<sup>T</sup> + λI)<sup>−1</sup> d/σ", "Solution, RᵀR = LLᵀ, Ĝ = GL<sup>−T</sup>/σ"), EQ("w(z) = (1 + z/z₀)<sup>−β/2</sup>", "Depth weighting (Li & Oldenburg 1998)")],
  tries: ["Set β to 0: where does the mass go?", "Increase the smoothness length to 1500 m and compare with the pyGIMLi section of 6.4.", "Lower σ to 0.05 mGal: what happens to the model with Auto λ?", "Turn on the forward-model bodies: does the inversion support your hypothesis?"],
  notes: [NOTE("key", "pyGIMLi and SimPEG", "<p>Notebook 04 inverts the same kind of section with pyGIMLi (2-D) and the gridded residual with SimPEG (3-D). Chapter 6.4 shows both.</p>")],
});
function paintInversion() {
  const pr = $("iPr"); if (!pr) return; const D = modelData();
  if (!D) { noGrid("iK"); return; }
  if (D.err) { plot(pr, { series: [], xlim: [0, 1], h: 140 }); $("iK").innerHTML = KPIT("Section", esc(D.err), "bad"); return; }
  const v = ivDefaults(), key = [D.key, v.cw, v.zmax, v.nz, v.sigma, v.beta, v.z0, v.ls].join("|");
  if (!LAB.invP || LAB.invP.key !== key) {
    const b = $("iBusy"); if (b) b.hidden = false;
    clearTimeout(LAB.invT); LAB.invT = setTimeout(() => {
      try { const t = Date.now(), M = MOD.mesh(D.S.L, { cw: v.cw, zmax: v.zmax, nz: v.nz }); LAB.invP = { key, P: MOD.prepare(D.x, D.d, M, v), ms: Date.now() - t }; }
      catch (e) { console.error(e); LAB.invP = null; $("iK").innerHTML = KPIT("Inversion failed", esc(e.message), "bad"); }
      if (b) b.hidden = true; if (LAB.invP) paintInversion();
    }, 30);
    return;
  }
  const P = LAB.invP.P, rel = v.lam === "auto" ? MOD.autoLambda(P) : Math.pow(10, v.lam), s = MOD.solve(P, rel, true);
  LAB.invR = { P, s }; if (v.lam === "auto" && $("iLam")) { $("iLam").value = Math.log10(rel).toFixed(1); $("iLamo").textContent = Math.log10(rel).toFixed(1) + " "; }
  const xk = D.x.map(x => x / 1000), xl = secXlim(D.S).map(x => x / 1000);
  plot(pr, { series: [{ name: "data", x: xk, y: D.d, color: css("--ink"), dots: true, r: 2.6, unit: "mGal", dec: 2, err: D.d.map(() => v.sigma) }, { name: "inversion", x: xk, y: s.pred, color: acc(), w: 2.6, unit: "mGal", dec: 2 }],
    xlim: xl, ylabel: "mGal", xlabel: "distance from A [km]", xname: "km", xfmt: x => fmt(x, 1), h: 210 });
  const lc = MOD.lcurve(P, Array.from({ length: 25 }, (_, i) => Math.pow(10, -9 + i * 0.5))).filter(q => q.chi2n > 1e-3);
  plot($("iLc"), { series: [{ name: "L-curve", x: lc.map(q => 0.5 * Math.log10(q.phim + 1e-30)), y: lc.map(q => Math.log10(q.chi2n)), color: "#7f8a93", w: 1.6, dec: 2 }],
    markers: [{ x: 0.5 * Math.log10(s.phim + 1e-30), y: Math.log10(s.chi2n), color: acc(), r: 6, label: "λ" }], hlines: [{ y: 0, label: "χ²/N = 1" }],
    xlim: [Math.min(...lc.map(q => 0.5 * Math.log10(q.phim + 1e-30))) - 0.1, Math.max(...lc.map(q => 0.5 * Math.log10(q.phim + 1e-30))) + 0.1], xlabel: "log₁₀ ‖W R m‖ (model size)", ylabel: "log₁₀ χ²/N", xname: "log size", xfmt: x => fmt(x, 1), h: 210, nohover: true });
  const M = P.M, mv = Array.from(s.m), sorted = mv.map(Math.abs).sort((a, b) => a - b), lim = Math.max(1, pctl(sorted, 0.98));
  const sec = $("iSec"); if (sec) drawSection(sec, { xlim: secXlim(D.S), zmax: v.zmax, cells: { xe: M.xe, ze: M.ze, m: mv, lim }, bodies: v.bodies && LAB.ui.fm ? LAB.ui.fm.bodies : [], outline: true, h: Math.min(380, Math.max(240, sec.clientWidth * 0.42)) });
  colorBar($("iCb"), "anom", -lim, lim, "kg/m³");
  $("iK").innerHTML = KPI("χ²/N", fmt(s.chi2n, 2), Math.abs(s.chi2n - 1) < 0.15 ? "ok" : "hl") + KPI("rms misfit", fmt(s.rms, 3) + " <small>mGal</small>") + KPI("λ (relative)", s.rel.toExponential(1)) + KPI("Density", fmt(Math.min(...mv), 0) + " … " + fmt(Math.max(...mv), 0) + " <small>kg/m³</small>") + KPI("Cells × data", `${M.nc} × ${P.nd}`) + KPI("Set-up", LAB.invP.ms + " <small>ms</small>");
}

/* ---------- 6.4 pyGIMLi and SimPEG ---------- */
const edgesOf = c => { const e = [c[0] - (c[1] - c[0]) / 2]; for (let i = 0; i < c.length - 1; i++) e.push((c[i] + c[i + 1]) / 2); e.push(c[c.length - 1] + (c[c.length - 1] - c[c.length - 2]) / 2); return e; };
CH.push({ id: "6.4", sec: "model", short: "pyGIMLi and SimPEG", title: "The same section with pyGIMLi and SimPEG",
  tag: "Notebook 04 models the residual along the section A–B with two open-source inversion frameworks: pyGIMLi in 2-D and SimPEG in 3-D. Their results are embedded here for comparison with your models.",
  goal: "compare the forward model, the 2-D and the 3-D inversion of the same anomaly.",
  figs: [{ title: "Data and responses along A–B", sub: "Wadi Ghadir residual (complete Bouguer, ρ = 2.67, minus the 3 km upward continuation), mean removed.",
    html: () => PYM ? `<canvas class="plot" id="pPr"></canvas><div class="kpis" id="pK"></div><div class="row"><button class="tbtn go" type="button" id="pUse">Use this section in 6.1–6.3</button><span class="hint" id="pMsg"></span></div>` : `<p class="hint">The pyGIMLi and SimPEG results were not available when this lab was built. Run notebook 04 and rebuild the lab.</p>`,
    draw() { if (!PYM) return; const xk = PYM.x.map(v => v / 1000), xl = [-0.03 * PYM.L / 1000, 1.03 * PYM.L / 1000], S = PYM.summary;
      plot($("pPr"), { series: [{ name: "data", x: xk, y: PYM.data, color: css("--ink"), dots: true, r: 2.6, unit: "mGal", dec: 2 }, { name: "forward (polygons)", x: xk, y: PYM.fwd, color: "#8a5bd6", w: 1.6, dash: [6, 4], unit: "mGal", dec: 2 }, { name: "pyGIMLi 2-D", x: xk, y: PYM.pg, color: acc(), w: 2.4, unit: "mGal", dec: 2 }, { name: "SimPEG 3-D", x: xk, y: PYM.sp, color: "#1baf7a", w: 2.2, dash: [3, 2], unit: "mGal", dec: 2 }],
        xlim: xl, ylabel: "mGal", xlabel: "distance from A [km]", xname: "km", xfmt: v => fmt(v, 1), h: 240 });
      $("pK").innerHTML = KPI("pyGIMLi rms", fmt(S.pygimli.rms_mGal, 2) + " <small>mGal</small>", "hl") + KPI("pyGIMLi χ²", fmt(S.pygimli.chi2, 2)) + KPI("SimPEG rms", fmt(S.simpeg.rms_mGal, 3) + " <small>mGal</small>") + KPI("SimPEG cells", S.simpeg.cells.toLocaleString("en-US")) + KPI("Forward rms", fmt(S.forward.rms_mGal, 2) + " <small>mGal</small>");
      $("pUse").onclick = () => { const s = sDefaults(); s.A = [PYM.A[1], PYM.A[0]]; s.B = [PYM.B[1], PYM.B[0]]; s.field = "filter"; const f = fDefaults(); f.type = "residual"; f.up = 3000; LAB.ui.fm = null; $("pMsg").textContent = "Section, field and starting bodies set: open 6.1–6.3."; }; } },
    { title: "Density sections", sub: "Top: pyGIMLi 2-D inversion (depth-weighted, λ from the discrepancy principle). Bottom: SimPEG 3-D inversion cut along A–B. Same colour scale; dashed: the polygons of the forward model.",
      html: () => PYM ? `<canvas class="plot" id="pPg"></canvas><canvas class="plot" id="pSp"></canvas><canvas class="plot" id="pCb"></canvas>` : "",
      draw() { if (!PYM) return; const xl = [-0.03 * PYM.L, 1.03 * PYM.L], all = PYM.pgm.v.flat().concat(PYM.spm.v.flat()).filter(isF).map(Math.abs).sort((a, b) => a - b), lim = Math.max(1, pctl(all, 0.98));
        const bodies = PYM.bodies.map(b => ({ drho: b.drho, xy: b.xy.map(([x, z]) => [x * 1000, z * 1000]) })), h = cv => Math.min(320, Math.max(200, cv.clientWidth * 0.34));
        [["pPg", PYM.pgm, "pyGIMLi 2-D"], ["pSp", PYM.spm, "SimPEG 3-D"]].forEach(([id, g, lab]) => drawSection($(id), { xlim: xl, zmax: 5000, cells: { xe: edgesOf(g.x), ze: edgesOf(g.z), m: g.v.flat(), lim }, bodies, outline: true, label: lab, h: h($(id)) }));
        colorBar($("pCb"), "anom", -lim, lim, "kg/m³"); } },
    { title: "The code", sub: "The essential calls of notebook 04 (open it for every step, with editable parameters).",
      html: () => `<pre class="code" style="white-space:pre;overflow-x:auto;font-size:12.5px"># pyGIMLi: 2-D section, smallest model with depth weighting
fop = GravityModelling2D(points=sensors, mesh=pg.createGrid(x_edges, -z_edges[::-1]))
inv = pg.Inversion(fop=fop)
inv.setRegularization(cType=0, trans="lin")
inv.modelTrans = pg.trans.Trans(); inv.dataTrans = pg.trans.Trans()
inv.setConstraintWeights(depthWeighting(mesh, z0=500, power=0.5, cell=True))
rho = inv.run(d_obs, absoluteError=0.3, lam=lam, startModel=0.0)

# SimPEG: 3-D inversion of the gridded residual
sim = gravity.simulation.Simulation3DIntegral(survey=survey, mesh=mesh3d, rhoMap=maps.IdentityMap(nP=n),
                                               engine="choclo", store_sensitivities="ram")
reg = regularization.WeightedLeastSquares(mesh3d)
opt = optimization.ProjectedGNCG(maxIter=15, lower=-1.0, upper=1.0)
dirs = [directives.UpdateSensitivityWeights(), directives.BetaEstimate_ByEig(beta0_ratio=10),
        directives.BetaSchedule(coolingFactor=5, coolingRate=1), directives.TargetMisfit(chifact=1)]
rho3d = inversion.BaseInversion(inverse_problem.BaseInvProblem(dmis, reg, opt), directiveList=dirs).run(m0)</pre>`,
      draw() {} }],
  ideas: [["layers", "pyGIMLi", "Geophysical Inversion and Modelling Library (Rücker et al. 2017): finite-element meshes, forward operators and a generic Gauss–Newton inversion."],
    ["cube", "SimPEG", "Simulation and Parameter Estimation in Geophysics (Cockett et al. 2015): the 3-D integral gravity simulation with Choclo kernels and Li–Oldenburg sensitivity weighting."],
    ["scale", "2-D against 3-D", "The 2-D inversion sees only the profile and assumes infinite strike. The 3-D inversion fits the whole map, so bodies of finite length and the anomalies beside the line shape its section."]],
  notes: [NOTE("key", "Files", "<p><code>outputs/modelling/</code>: section_profile.csv, pygimli_section_model.csv, simpeg_section_model.csv, simpeg_3d_model.npz and section_models.png.</p>")],
});

/* ---------- 7.1 validation ---------- */
CH.push({ id: "7.1", sec: "out", short: "Check against Python", title: "Check against the Python processing chain",
  tag: "This lab is a port of the wghadir Python chain. For the Wadi Ghadir data with the default parameters, both must give the same anomalies.",
  goal: "verify that the browser chain reproduces the delivered products.",
  figs: [{ title: "Browser against Python", sub: "Complete Bouguer anomaly (ρ = 2.67 g/cm³) of every station. Differences appear when you change parameters.",
    html: () => `<canvas class="plot" id="vCv"></canvas><div class="kpis" id="vK"></div>`, draw() { onPaint(paintValid); } }],
  ideas: [["check", "Same chain", "Tide, QC, occupations, drift model, scale factor, re-ties and reductions follow the Python code line by line."],
    ["layers", "Precomputed parts", "GNSS matching, EGM2008 heights and the DEM terrain effect come from the Python chain through the station table."]],
});
function paintValid() {
  const cv = $("vCv"); if (!cv || !R()) return; const py = LAB.input.python;
  if (!py || !hasTerrain()) { plot(cv, { series: [], xlim: [0, 1], h: 160 }); $("vK").innerHTML = KPIT("Not available", "The comparison needs the Wadi Ghadir example data."); return; }
  const seen = new Set(), pr = okSt().filter(s => py[s.key] && !seen.has(s.key) && seen.add(s.key)).map(s => [py[s.key][1], ENG.CB(s, 2.67)]);
  const d = pr.map(p => p[1] - p[0]), x = pr.map(p => p[0]), lim = [Math.min(...x) - 1, Math.max(...x) + 1];
  plot(cv, { series: [{ name: "station", x, y: d.map(v => 1000 * v), color: acc(), dots: true, r: 2.6, unit: "µGal", dec: 2 }], xlim: lim, xlabel: "Python ΔCB (2.67) [mGal]", ylabel: "browser − Python [µGal]", xname: "ΔCB", xfmt: v => fmt(v, 2), h: 260, hlines: [{ y: 0 }] });
  const a = d.map(Math.abs).sort((p, q) => p - q);
  $("vK").innerHTML = KPI("Stations compared", pr.length) + KPI("Median |difference|", fmt(1000 * ENG.median(a), 3) + " <small>µGal</small>", "ok") + KPI("Within 1 µGal", a.filter(v => v < 0.001).length) + KPI("Largest", fmt(1000 * a[a.length - 1], 1) + " <small>µGal</small>", a[a.length - 1] > 0.01 ? "bad" : "ok") + KPIT("Note", "One station was occupied twice on one day; the Python table keeps the other occupation.");
}

/* ---------- 7.2 export ---------- */
CH.push({ id: "7.2", sec: "out", short: "Export and parameters", title: "Export the results and the parameters",
  tag: "Take the station table, the grid, the map and your parameter set with you. A parameter set pasted back here reproduces the run.",
  goal: "save the results of your run and the settings that produced them.",
  figs: [
    { title: "Results", sub: "Each button offers a file to save. The map image is also shown below the buttons.",
      html: () => `<div class="row"><button class="tbtn go" type="button" id="xSt">Station table (CSV)</button><button class="tbtn" type="button" id="xGr">Grid (XYZ CSV)</button><button class="tbtn" type="button" id="xPng">Map image (PNG)</button><button class="tbtn" type="button" id="xCopy">Copy station table</button><button class="tbtn" type="button" id="xHtml">This lab (HTML)</button></div><p class="hint" id="xMsg"></p><img id="xImg" alt="Exported map" hidden style="width:100%;border-radius:12px;margin-top:8px">` ,
      draw() { $("xSt").onclick = () => saveFile("wadi_ghadir_stations.csv", stationCSV(), "text/csv"); $("xGr").onclick = () => { const t = gridCSV(); if (t) saveFile("wadi_ghadir_grid.csv", t, "text/csv"); else $("xMsg").textContent = "Compute a grid in chapter 5.1 first."; };
        $("xPng").onclick = exportPng; $("xCopy").onclick = () => copyText(stationCSV(), $("xMsg")); $("xHtml").onclick = () => saveFile("Wadi_Ghadir_Gravity_Lab.html", PAGE_HTML, "text/html"); } },
    { title: "Parameter set", sub: "All processing parameters of this run (JSON). Edit or paste a set and press Apply.",
      html: () => `<textarea class="code" id="pJ" spellcheck="false" aria-label="Parameters as JSON"></textarea><div class="row"><button class="tbtn go" type="button" id="pA">Apply</button><button class="tbtn" type="button" id="pC">Copy</button><button class="tbtn" type="button" id="pD">Restore the defaults</button><span class="hint" id="pM"></span></div>`,
      draw() { $("pJ").value = JSON.stringify(Object.assign({ written_by: AUTHOR }, P()), null, 1);
        $("pA").onclick = () => { try { const j = JSON.parse($("pJ").value); delete j.written_by; LAB.P = ENG.mergeParams(j); changed(); $("pM").textContent = "Applied."; } catch (e) { $("pM").textContent = "This is not valid JSON: " + e.message; } };
        $("pC").onclick = () => copyText($("pJ").value, $("pM")); $("pD").onclick = () => { LAB.P = ENG.mergeParams({}); $("pJ").value = JSON.stringify(P(), null, 1); changed(); $("pM").textContent = "Defaults restored."; }; } },
    { title: "Software and sources", sub: "",
      html: () => `<ul class="refs"><li>Processing chain: <i>wghadir</i> Python package (this project), ported to JavaScript for this lab; Python notebooks 01–03 run the same steps with Harmonica, Verde, Boule, Choclo (Fatiando a Terra), pygtide/ETERNA, SGTool and PyGMT; notebook 04 models the section with pyGIMLi and SimPEG.</li><li>Physics core and page design: <i>Static Gravity Lab</i> by Mohamed Sobh, LIAG.</li><li>Longman, I. M. (1959). Formulas for computing the tidal accelerations due to the Moon and the Sun. <i>JGR</i> 64.</li><li>Hinze, W. J. et al. (2005). New standards for reducing gravity data. <i>Geophysics</i> 70.</li><li>Nettleton, L. L. (1939). Determination of density for reduction of gravimeter observations. <i>Geophysics</i> 4.</li><li>Talwani, M., Worzel, J. L. &amp; Landisman, M. (1959). Rapid gravity computations for two-dimensional bodies. <i>JGR</i> 64.</li><li>Spector, A. &amp; Grant, F. S. (1970). Statistical models for interpreting aeromagnetic data. <i>Geophysics</i> 35.</li><li>Li, Y. &amp; Oldenburg, D. W. (1998). 3-D inversion of gravity data. <i>Geophysics</i> 63.</li><li>Rücker, C., Günther, T. &amp; Wagner, F. M. (2017). pyGIMLi. <i>Computers &amp; Geosciences</i> 109. Cockett, R. et al. (2015). SimPEG. <i>Computers &amp; Geosciences</i> 85.</li><li>Sandwell, D. T. (1987). Biharmonic spline interpolation of GEOS-3 and SEASAT altimeter data. <i>GRL</i> 14.</li><li>Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA.</li></ul>`,
      draw() {} },
  ],
  ideas: [["check", "Reproducible", "The parameter set and the input files fully define a run. Keep them with the results."],
    ["layers", "Columns", "The station table holds positions, heights, Δg₁₀₀, ΔFA, ΔSB and ΔCB for the current density, uncertainties and the drift mode of each station."]],
});
/* the CG-6 readings of the example as a generic readings table (CorrGrav without the on-board tide) */
function exampleReadings() {
  const rows = ENG.parseCG6(EXAMPLE.files[0].text, EXAMPLE.files[0].name).rows;
  return ["instrument,date,time,line,station,gravity,stddev,tilt_x,tilt_y,lat,lon"].concat(rows.filter(r => isF(r.CorrGrav)).map(r => [r.inst, r.Date, r.Time, r.Line, r.Station, (r.CorrGrav - r.TideCorr).toFixed(4), r.StdDev, r.X, r.Y, r.LatGPS, r.LonGPS].join(","))).join("\n");
}
function stationCSV() {
  const rho = P().red.rho, head = ["key", "instrument", "date", "line", "station", "lat", "lon", "H_m", "dH_m", "dg100_mGal", "sigma_mGal", "scale_k", "drift_mode", "FA_mGal", `SB_${rho.toFixed(2)}_mGal`, `CB_${rho.toFixed(2)}_mGal`, "u_topo"];
  return [`# Wadi Ghadir Gravity Lab, written by ${AUTHOR}. Data: ${LAB.input.name}. Values relative to the base station.`, head.join(",")].concat(okSt().map(s => [s.key, s.inst, s.date, s.line, s.station, s.lat.toFixed(7), s.lon.toFixed(7), s.H.toFixed(3), s.dh.toFixed(3), s.dgk.toFixed(4), s.dgs.toFixed(4), s.k.toFixed(6), s.drift, s.dFA.toFixed(4), ENG.SB(s, rho).toFixed(4), isF(s.uTopo) ? ENG.CB(s, rho).toFixed(4) : "", isF(s.uTopo) ? s.uTopo.toFixed(5) : ""].join(","))).join("\n");
}
function gridCSV(z, label) {
  const G = LAB.grid; if (!G) return null; z = z || G.z;
  const out = [`# Wadi Ghadir Gravity Lab, written by ${AUTHOR}. Grid of ${label || QTY[G.q][0] + (G.q === "SB" || G.q === "CB" ? ", rho " + P().red.rho.toFixed(2) : "") + " [mGal]"}.`, "lon,lat,x_local_m,y_local_m,value"];
  for (let r = 0; r < G.ny; r++) for (let c = 0; c < G.nx; c++) { const i = r * G.nx + c; if (!G.mask[i]) continue; const x = G.x0 + c * G.cell, y = G.y0 + r * G.cell, [la, lo] = G.local.inv(x, y); out.push([lo.toFixed(6), la.toFixed(6), x.toFixed(1), y.toFixed(1), z[i].toFixed(4)].join(",")); }
  return out.join("\n");
}
/* save a file: through the artifact viewer's downloads capability when the lab runs in claude.ai,
   otherwise as an ordinary browser download (the lab opened from the HTML file) */
let DL = null;
if (window.claude && window.claude.use) window.claude.use("downloads").then(d => { DL = d; }, () => { DL = null; });
function saveFile(name, data, type) {
  const msg = $("xMsg") || $("heroMsg") || { set textContent(v) { /* no message area here */ } };
  if (DL) { DL.save({ filename: name, data }).then(() => { msg.textContent = name + " saved."; }, e => { msg.textContent = e && e.code === "declined" ? "Saving was cancelled." : "This view cannot save files: use Copy."; }); return; }
  if (window.claude) { msg.textContent = "Saving files is not available in this view: use Copy."; return; }
  try { const a = document.createElement("a"); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); msg.textContent = name + " saved."; }
  catch (e) { msg.textContent = "Download is blocked here: use Copy."; }
}
function exportPng() {
  const holder = document.createElement("div"); holder.style.cssText = "position:absolute;left:-9999px;width:1400px"; const c2 = document.createElement("canvas"); c2.className = "plot"; holder.appendChild(c2); document.body.appendChild(holder);
  const G = LAB.grid;
  if (G) { const g = LAB.ui.g, vals = Array.from(G.z).filter((v, i) => G.mask[i]), [lo, hi] = range(vals, g.pal === "anom"); const lev = []; for (let v = Math.ceil(lo / g.ci) * g.ci; v <= hi; v += g.ci) lev.push(v); drawMap(c2, { grid: G, lo, hi, pal: g.pal, contours: g.ct ? lev : null, hill: g.hill, pts: okSt().map(s => ({ lat: s.lat, lon: s.lon, color: "rgba(20,20,20,.55)", r: 1.3, stroke: false })) }); }
  else drawMap(c2, { pts: okSt().map(s => ({ lat: s.lat, lon: s.lon, color: instColor(s.inst), r: 2.6 })) });
  { const cx = c2.getContext("2d"), dpr = Math.min(2, window.devicePixelRatio || 1); cx.save(); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.font = "600 12px " + css("--disp"); cx.fillStyle = css("--muted"); cx.textAlign = "right"; cx.textBaseline = "bottom"; cx.fillText("Wadi Ghadir Gravity Lab · written by " + AUTHOR, c2.width / dpr - 12, c2.height / dpr - 2); cx.restore(); }
  const url = c2.toDataURL("image/png");
  const img = $("xImg"); img.src = url; img.hidden = false;
  c2.toBlob(blob => { holder.remove(); if (blob) saveFile("wadi_ghadir_map.png", blob, "image/png"); }, "image/png");
}

/* ================================================================ hero animation */

function heroBg(dpr) { const bg = $("heroBg"), r = bg.getBoundingClientRect(); bg.width = r.width * dpr; bg.height = r.height * dpr; const c = bg.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, r.width, r.height); const cx = r.width * 0.8, cy = r.height * 1.05; c.lineWidth = 1; for (let i = 1; i < 30; i++) { c.strokeStyle = "rgba(232,144,95," + (0.13 - i * 0.003) + ")"; c.beginPath(); c.arc(cx, cy, i * i * 2.2 + i * 14, 0, 6.283); c.stroke(); } }
function heroSize() { const cv = $("heroCv"); if (!cv) return; const W = cv.clientWidth || 600, E = mapExtent(), k = Math.cos((E.lat0 + E.lat1) / 2 * Math.PI / 180), H = Math.round(W * (E.lat1 - E.lat0) / ((E.lon1 - E.lon0) * k)), dpr = Math.min(2, window.devicePixelRatio || 1); cv.style.height = H + "px"; cv.width = W * dpr; cv.height = H * dpr; Object.assign(HERO, { W, H, dpr }); heroBg(dpr); }
function heroInit() { heroSize(); if ("IntersectionObserver" in window) new IntersectionObserver(es => { HERO.vis = es[0].isIntersecting; }).observe($("heroCv")); document.addEventListener("visibilitychange", () => { HERO.vis = !document.hidden; }); requestAnimationFrame(heroFrame); }
function heroFrame(now) {
  requestAnimationFrame(heroFrame); if (!HERO.vis || !HERO.W || !R()) return;
  const { W, H, dpr } = HERO, ctx = $("heroCv").getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const E = mapExtent(), X = lon => (lon - E.lon0) / (E.lon1 - E.lon0) * W, Y = lat => (E.lat1 - lat) / (E.lat1 - E.lat0) * H;
  ctx.fillStyle = "#0A141A"; ctx.fillRect(0, 0, W, H);
  const img = hillImage(); if (img) { ctx.globalAlpha = 0.55; ctx.drawImage(img, X(LAB.input.hill.lon0), Y(LAB.input.hill.lat1), X(LAB.input.hill.lon1) - X(LAB.input.hill.lon0), Y(LAB.input.hill.lat0) - Y(LAB.input.hill.lat1)); ctx.globalAlpha = 1; }
  const s = okSt().slice().sort((a, b) => a.t - b.t); if (!s.length) return;
  const useCB = hasTerrain(), v = s.map(x => useCB ? ENG.CB(x, 2.67) : x.dFA), [lo, hi] = range(v, true);
  const tA = s[0].t, tB = s[s.length - 1].t, cyc = 14, ph = reduce ? 1 : ((now - HERO.t0) / 1000 % cyc) / (cyc - 2.5), tc = tA + Math.min(1, ph) * (tB - tA);
  for (let i = 0; i < s.length; i++) {
    if (s[i].t > tc) break; const age = (tc - s[i].t) / 3.6e6, x = X(s[i].lon), y = Y(s[i].lat);
    if (age < 2 && !reduce) { ctx.fillStyle = "rgba(255,230,190," + (0.5 * (1 - age / 2)) + ")"; ctx.beginPath(); ctx.arc(x, y, 3 + 9 * (age / 2), 0, 6.283); ctx.fill(); }
    ctx.fillStyle = lutCol("anom", (v[i] - lo) / (hi - lo)); ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 6.283); ctx.fill();
  }
  const d = new Date(tc); ctx.fillStyle = "rgba(10,20,26,.72)"; ctx.fillRect(10, 10, 168, 44);
  ctx.fillStyle = "#E8EFF3"; ctx.font = "700 15px " + css("--disp"); ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(d.toISOString().slice(0, 10) + "  " + d.toISOString().slice(11, 16) + " UTC", 18, 16);
  ctx.fillStyle = "#F0A57B"; ctx.font = "600 12px " + css("--mono"); ctx.fillText(s.filter(x => x.t <= tc).length + " stations · " + (useCB ? "ΔCB 2.67" : "ΔFA"), 18, 36);
  const bw = Math.min(160, W * 0.32); for (let i = 0; i < bw; i++) { ctx.fillStyle = lutCol("anom", i / bw); ctx.fillRect(W - bw - 14 + i, H - 22, 1.2, 8); }
  ctx.fillStyle = "#E8EFF3"; ctx.font = "600 11px " + css("--disp"); ctx.textAlign = "left"; ctx.fillText(fmt(lo, 0), W - bw - 14, H - 12); ctx.textAlign = "right"; ctx.fillText(fmt(hi, 0) + " mGal", W - 14, H - 12);
}

/* ================================================================ start */
function themeToggle() {
  const root = document.documentElement, b = $("themeBtn");
  const cur = () => root.dataset.theme || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const label = () => { b.textContent = cur() === "dark" ? "Light theme" : "Dark theme"; };
  try { const t = localStorage.getItem("wg-lab-theme"); if (t) root.dataset.theme = t; } catch (e) { /* storage unavailable */ }
  label(); b.onclick = () => { root.dataset.theme = cur() === "dark" ? "light" : "dark"; try { localStorage.setItem("wg-lab-theme", root.dataset.theme); } catch (e) { /* storage unavailable */ } label(); APPI.redraw(); };
}
// every chapter render (and redraw) starts with a fresh list of painters
CH.forEach(c => { const d0 = c.figs[0].draw; c.figs[0].draw = function () { LAB.paint = []; d0.call(this); }; });
compute(); updateBadge();
const app = makeApp({ chapters: CH, store: "wadi-ghadir-lab", heroInit, heroSize,
  sections: [["start", "The survey", "globe"], ["data", "Data", "layers"], ["corr", "Corrections", "clock"], ["red", "Reduction", "mountain"], ["maps", "Maps", "map"], ["model", "Modelling", "cube"], ["out", "Results", "check"]] });
themeToggle();
document.getElementById("heroSave").addEventListener("click", () => saveFile("Wadi_Ghadir_Gravity_Lab.html", PAGE_HTML, "text/html"));
document.getElementById("heroOwn").addEventListener("click", () => setTimeout(() => { const f = $("fDat"); if (f) f.focus(); }, 600));
app.init();
})();
