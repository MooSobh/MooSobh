/* ===== Wadi Ghadir Magnetic Lab: chapters, maps and interaction =====
   Written by Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics), Hannover. */
(function () {
"use strict";
document.body.classList.add("appA");
const AUTHOR = "Mohamed Sobh, LIAG";
const PAGE_HTML = (() => { const d = document.documentElement.cloneNode(true);
  d.querySelectorAll("script").forEach(sc => { if (!sc.textContent.includes("const WGM_DATA")) sc.remove(); });
  return "<!DOCTYPE html>\n" + d.outerHTML; })();
MAG.setIGRF(WGM_DATA.igrf);

/* ---------------------------------------------------------------- data and state */
const HERO = { t0: performance.now(), vis: true };
const EXAMPLE = { name: "Wadi Ghadir example data", example: true, table: WGM_DATA.table, hill: WGM_DATA.hillshade, base: WGM_DATA.base, python: WGM_DATA.python };
const PKEY = "wgm-lab-params-v1";
function loadParams() { try { return JSON.parse(localStorage.getItem(PKEY) || "{}"); } catch (e) { return {}; } }
const LAB = { input: EXAMPLE, P: MAG.mergeParams(loadParams()), L: null, grids: {}, paint: [], ui: {} };
const P = () => LAB.P;
function saveParams() { try { localStorage.setItem(PKEY, JSON.stringify(LAB.P)); } catch (e) { /* storage unavailable */ } }
function compute() {
  try {
    const rows = MAG.fromTable(LAB.input.table, LAB.input.name), L = MAG.load(rows, P()); MAG.despike(L, P()); MAG.addIGRF(L, P());
    const ok = L.d.filter(r => r.ok); if (!ok.length) throw new Error("no readings left after the quality control");
    L.local = ENG.makeLocal(MAG.median(ok.map(r => r.lat)), MAG.median(ok.map(r => r.lon)));
    L.days = MAG.daySummary(L); LAB.L = L; LAB.error = null;
  } catch (e) { LAB.error = e.message; console.error(e); }
  LAB.grids = {}; LAB.gkey = {};
}
let pend = 0;
function changed() { saveParams(); clearTimeout(pend); pend = setTimeout(() => { compute(); repaint(); }, 120); }
function repaint() { LAB.paint.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }
function onPaint(f) { LAB.paint.push(f); f(); }
const Lr = () => LAB.L;
const okR = () => (Lr() ? Lr().d.filter(r => r.ok) : []);
const dayList = () => (Lr() ? Lr().days.map(d => d.day) : []);
const DAYC = ["#2a78d6", "#eb6834", "#1baf7a", "#8a5bd6", "#d6a12a", "#d62a6e", "#2ab3c4", "#6b8e23", "#a0522d", "#5c6bc0", "#00897b", "#c0ca33"];
const dayColor = k => DAYC[(k - 1) % DAYC.length];
const dayName = k => { const d = Lr() && Lr().days.find(x => x.day === k); return "Day " + k + (d && d.date ? " (" + d.date + ")" : ""); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hms = s => isF(s) ? [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.round(s % 60)].map(v => String(v).padStart(2, "0")).join(":") : "–";
function chk(id, label, on) { return `<label class="chk"><input type="checkbox" id="${id}" ${on ? "checked" : ""}> ${label}</label>`; }
function bindChk(id, fn) { const el = $(id); if (el) el.onchange = () => fn(el.checked); }
function sel(id, opts, cur, label) { return `<select id="${id}" aria-label="${label || id}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`; }
function bindSel(id, fn) { const el = $(id); if (el) el.onchange = () => fn(el.value); }
const nT = (v, d = 0) => fmt(v, d) + " <small>nT</small>";

/* ---------------------------------------------------------------- colour maps */
const STOPS = {
  anom: [[0, [11, 47, 99]], [0.2, [57, 135, 229]], [0.42, [212, 230, 249]], [0.5, [246, 245, 241]], [0.58, [251, 212, 196]], [0.8, [224, 90, 60]], [1, [110, 19, 9]]],
  mag: [[0, [36, 20, 92]], [0.18, [40, 92, 196]], [0.36, [36, 170, 190]], [0.52, [120, 200, 120]], [0.68, [240, 220, 90]], [0.84, [236, 120, 50]], [1, [180, 24, 40]]],
  spectral: PALS.spectral, viridis: PALS.viridis,
  heat: [[0, [20, 12, 40]], [0.35, [120, 28, 92]], [0.7, [226, 92, 56]], [1, [252, 236, 160]]],
};
const LUTS = {};
for (const k in STOPS) { const s = STOPS[k], L = new Uint8ClampedArray(768); for (let i = 0; i < 256; i++) { const t = i / 255; let j = 1; while (j < s.length - 1 && t > s[j][0]) j++; const [a, ca] = s[j - 1], [b, cb] = s[j], f = Math.max(0, Math.min(1, (t - a) / (b - a || 1))); for (let q = 0; q < 3; q++) L[i * 3 + q] = ca[q] + (cb[q] - ca[q]) * f; } LUTS[k] = L; }
const lutCol = (pal, t) => { const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3, L = LUTS[pal]; return `rgb(${L[i]},${L[i + 1]},${L[i + 2]})`; };
/* colour stretch: linear between percentiles, or histogram-equalised (magnetic maps have a few strong anomalies) */
function range(vals, sym, lo = 0.02, hi = 0.98) {
  const s = vals.filter(isF).sort((a, b) => a - b); if (!s.length) return [-1, 1];
  let a = pctl(s, lo), b = pctl(s, hi);
  if (sym && a < 0 && b > 0) { const m = Math.max(-a, b); a = -m; b = m; }
  if (b - a < 1e-9) { a -= 1; b += 1; } return [a, b];
}
function stretchFn(vals, mode, sym) {
  if (mode !== "eq") { const [lo, hi] = range(vals, sym); return { lo, hi, t: v => (v - lo) / (hi - lo) }; }
  const s = vals.filter(isF).sort((a, b) => a - b), q = Array.from({ length: 101 }, (_, i) => pctl(s, i / 100));
  return { lo: q[0], hi: q[100], q, t: v => { if (v <= q[0]) return 0; if (v >= q[100]) return 1; let i = 0; while (i < 99 && v > q[i + 1]) i++; return (i + (v - q[i]) / ((q[i + 1] - q[i]) || 1)) / 100; } };
}
function colorBar(cv, pal, S, unit, dec) {
  const { ctx, W } = setup(cv, 36);
  for (let x = 0; x < W; x++) { ctx.fillStyle = lutCol(pal, x / (W - 1)); ctx.fillRect(x, 0, 1.4, 12); }
  ctx.fillStyle = css("--muted"); ctx.font = "500 12px " + css("--disp"); ctx.textBaseline = "top";
  const uw = ctx.measureText(unit).width + 10;
  if (S.q) { [0, 25, 50, 75, 100].forEach(p => { const x = p / 100 * W; if (x > W - uw - 14) return; ctx.textAlign = x < 20 ? "left" : "center"; ctx.fillText(fmt(S.q[p], dec ?? (Math.abs(S.hi - S.lo) < 10 ? 1 : 0)), x, 16); }); }
  else { const t = nice(S.lo, S.hi, 6).ticks.filter(v => v >= S.lo && v <= S.hi && (v - S.lo) / (S.hi - S.lo) * W < W - uw - 14);
    t.forEach(v => { const x = (v - S.lo) / (S.hi - S.lo) * W; ctx.textAlign = x < 20 ? "left" : "center"; ctx.fillText(fmt(v, dec ?? (Math.abs(S.hi - S.lo) < 4 ? 1 : 0)), x, 16); }); }
  ctx.textAlign = "right"; ctx.fillStyle = css("--ink"); ctx.fillText(unit, W, 16);
}

/* ---------------------------------------------------------------- the map */
function mapExtent() {
  const h = LAB.input.hill; if (h) return { lon0: h.lon0, lon1: h.lon1, lat0: h.lat0, lat1: h.lat1 };
  const s = okR(); if (!s.length) return { lon0: 34.7, lon1: 35.03, lat0: 24.66, lat1: 24.85 };
  let lo0 = Infinity, lo1 = -Infinity, la0 = Infinity, la1 = -Infinity; for (const r of s) { lo0 = Math.min(lo0, r.lon); lo1 = Math.max(lo1, r.lon); la0 = Math.min(la0, r.lat); la1 = Math.max(la1, r.lat); }
  const px = (lo1 - lo0) * 0.08 + 0.003, py = (la1 - la0) * 0.08 + 0.003; return { lon0: lo0 - px, lon1: lo1 + px, lat0: la0 - py, lat1: la1 + py };
}
const HILL = {};
function hillImage(cb) {
  const h = LAB.input.hill; if (!h) return null;
  if (HILL.src === h.src && HILL.img.complete) return HILL.img;
  if (HILL.src !== h.src) { HILL.src = h.src; HILL.img = new Image(); HILL.img.onload = () => cb && cb(); HILL.img.src = h.src; }
  return null;
}
function drawMap(cv, o) {
  const E = mapExtent(), latc = (E.lat0 + E.lat1) / 2, k = Math.cos(latc * Math.PI / 180), wdeg = (E.lon1 - E.lon0) * k, hdeg = E.lat1 - E.lat0;
  const W0 = cv.clientWidth || cv.parentNode.clientWidth || 700;
  const { ctx, W, H, dpr } = setup(cv, Math.round(Math.min(W0 * hdeg / wdeg + 40, window.innerHeight * 0.78)));
  const pad = { l: 58, r: 10, t: 8, b: 28 }, aw = W - pad.l - pad.r, ah = H - pad.t - pad.b;
  const s = Math.min(aw / wdeg, ah / hdeg), mw = wdeg * s, mh = hdeg * s, ox = pad.l + (aw - mw) / 2, oy = pad.t + (ah - mh) / 2;
  const X = lon => ox + (lon - E.lon0) * k * s, Y = lat => oy + (E.lat1 - lat) * s, inv = (px, py) => [E.lat1 - (py - oy) / s, E.lon0 + (px - ox) / (k * s)];
  ctx.fillStyle = css("--paper2"); ctx.fillRect(ox, oy, mw, mh);
  const img = o.hill !== false ? hillImage(() => drawMap(cv, o)) : null, hh = LAB.input.hill;
  if (img) { ctx.globalAlpha = o.grid ? 0.95 : 0.8; ctx.drawImage(img, X(hh.lon0), Y(hh.lat1), X(hh.lon1) - X(hh.lon0), Y(hh.lat0) - Y(hh.lat1)); ctx.globalAlpha = 1; }
  const S = o.S;
  if (o.grid) {
    const g = o.grid, L = LUTS[o.pal || "mag"], pw = Math.round(mw * dpr), ph = Math.round(mh * dpr), im = ctx.createImageData(pw, ph), d = im.data;
    const lut = new Uint8Array(1024); for (let i = 0; i < 1024; i++) lut[i] = 0;
    for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
      const [lat, lon] = inv(ox + px / dpr, oy + py / dpr), [gx, gy] = g.local.fwd(lat, lon), fx = (gx - g.x0) / g.cell, fy = (gy - g.y0) / g.cell, c = Math.floor(fx), r = Math.floor(fy);
      if (c < 0 || r < 0 || c >= g.nx - 1 || r >= g.ny - 1) continue;
      const i = r * g.nx + c; if (!g.mask[i] || !g.mask[i + 1] || !g.mask[i + g.nx] || !g.mask[i + g.nx + 1]) continue;
      const a = fx - c, b = fy - r, v = g.z[i] * (1 - a) * (1 - b) + g.z[i + 1] * a * (1 - b) + g.z[i + g.nx] * (1 - a) * b + g.z[i + g.nx + 1] * a * b;
      const li = Math.round(Math.max(0, Math.min(1, S.t(v))) * 255) * 3, q = (py * pw + px) * 4; d[q] = L[li]; d[q + 1] = L[li + 1]; d[q + 2] = L[li + 2]; d[q + 3] = img ? 215 : 255;
    }
    const off = document.createElement("canvas"); off.width = pw; off.height = ph; off.getContext("2d").putImageData(im, 0, 0); ctx.drawImage(off, ox, oy, mw, mh);
    if (o.contours) { ctx.strokeStyle = "rgba(20,25,30,.5)";
      for (const c of ENG.contours(g, o.contours)) { ctx.beginPath(); for (const sg of c.segs) { const [a1, b1] = g.local.inv(g.x0 + sg[0] * g.cell, g.y0 + sg[1] * g.cell), [a2, b2] = g.local.inv(g.x0 + sg[2] * g.cell, g.y0 + sg[3] * g.cell); ctx.moveTo(X(b1), Y(a1)); ctx.lineTo(X(b2), Y(a2)); } ctx.lineWidth = Math.abs(c.level) < 1e-9 ? 1.3 : 0.55; ctx.stroke(); } }
  }
  const pts = o.pts || [];
  for (const p of pts) { ctx.fillStyle = p.color || lutCol(o.pal || "mag", S.t(p.v)); if (p.x) { const x = X(p.lon), y = Y(p.lat), r = p.r || 3; ctx.strokeStyle = p.color || "#111"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x - r, y + r); ctx.lineTo(x + r, y - r); ctx.stroke(); continue; }
    ctx.beginPath(); ctx.arc(X(p.lon), Y(p.lat), p.r || 2, 0, 6.283); ctx.fill(); }
  const b = LAB.input.base;
  if (b && isF(b.lat)) { const bx = X(b.lon), by = Y(b.lat); ctx.fillStyle = "#ffd23f"; ctx.strokeStyle = "#1d1d1b"; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 4 : 9.5, a = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(bx + r * Math.cos(a), by + r * Math.sin(a)); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
  ctx.strokeStyle = css("--ink"); ctx.lineWidth = 1; ctx.strokeRect(ox, oy, mw, mh);
  ctx.fillStyle = css("--muted"); ctx.font = "500 11.5px " + css("--disp");
  const tx = nice(E.lon0, E.lon1, Math.max(3, Math.round(mw / 140))), ty = nice(E.lat0, E.lat1, Math.max(3, Math.round(mh / 110)));
  ctx.textAlign = "center"; ctx.textBaseline = "top"; tx.ticks.forEach(v => { if (v < E.lon0 || v > E.lon1) return; ctx.fillRect(X(v), oy + mh, 1, 4); ctx.fillText(v.toFixed(2) + "°E", X(v), oy + mh + 6); });
  ctx.textAlign = "right"; ctx.textBaseline = "middle"; ty.ticks.forEach(v => { if (v < E.lat0 || v > E.lat1) return; ctx.fillRect(ox - 4, Y(v), 4, 1); ctx.fillText(v.toFixed(2) + "°N", ox - 6, Y(v)); });
  const kmpx = s * k / 111.32, sb = [1, 2, 5, 10, 20].find(v => v * kmpx > mw * 0.12) || 20;
  ctx.fillStyle = "rgba(255,255,255,.88)"; ctx.fillRect(ox + 8, oy + mh - 30, sb * kmpx + 52, 22); ctx.fillStyle = "#111"; ctx.fillRect(ox + 14, oy + mh - 20, sb * kmpx, 4); ctx.font = "700 11px " + css("--disp"); ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(sb + " km", ox + 20 + sb * kmpx, oy + mh - 18);
  ctx.fillStyle = "rgba(255,255,255,.88)"; ctx.beginPath(); ctx.arc(ox + mw - 20, oy + 22, 13, 0, 6.283); ctx.fill(); ctx.fillStyle = "#111"; ctx.beginPath(); ctx.moveTo(ox + mw - 20, oy + 11); ctx.lineTo(ox + mw - 25, oy + 25); ctx.lineTo(ox + mw - 15, oy + 25); ctx.closePath(); ctx.fill(); ctx.font = "800 9px " + css("--disp"); ctx.textAlign = "center"; ctx.fillText("N", ox + mw - 20, oy + 30);
  const tip = o.tip;
  if (tip) {
    cv.onpointermove = e => {
      const rc = cv.getBoundingClientRect(), px = e.clientX - rc.left, py = e.clientY - rc.top;
      if (px < ox || px > ox + mw || py < oy || py > oy + mh) { tip.hidden = true; return; }
      const [lat, lon] = inv(px, py); let best = null, bd = 100;
      for (const p of pts) { const d = (X(p.lon) - px) ** 2 + (Y(p.lat) - py) ** 2; if (d < bd) { bd = d; best = p; } }
      let gv = NaN; if (o.grid) { const g = o.grid, [gx, gy] = g.local.fwd(lat, lon), c = Math.round((gx - g.x0) / g.cell), r = Math.round((gy - g.y0) / g.cell); if (c >= 0 && r >= 0 && c < g.nx && r < g.ny && g.mask[r * g.nx + c]) gv = g.z[r * g.nx + c]; }
      tip.innerHTML = `<span class="k">${lat.toFixed(4)}°N ${lon.toFixed(4)}°E</span>` + (isF(gv) ? `<br>${o.name || "grid"}: <b>${fmt(gv, 1)}</b> ${o.unit || ""}` : "") + (best ? `<br>${esc(best.label || "")}${isF(best.v) ? `: <b>${fmt(best.v, 1)}</b> ${o.unit || ""}` : ""}` : "");
      tip.hidden = false; const tw = tip.offsetWidth; tip.style.left = Math.min(px + 14, W - tw - 4) + "px"; tip.style.top = (py + 14) + "px";
    };
    cv.onpointerleave = () => { tip.hidden = true; };
  }
  return { X, Y, inv };
}
const mapHTML = (id, extra = "") => `<div class="mapwrap"><canvas class="plot" id="${id}"></canvas><div class="maptip" id="${id}t" hidden></div>${extra}</div>`;
const rLabel = r => `${dayName(r.day)} · ${hms(r.t)} · row ${r.row}`;
/* readings thinned for drawing (every n-th; all spikes kept) */
function thin(list, max) { const n = Math.max(1, Math.ceil(list.length / max)); return n === 1 ? list : list.filter((r, i) => i % n === 0 || r.spike); }

/* ================================================================ CHAPTERS */
const CH = [];

/* ---------- 1.1 overview ---------- */
CH.push({ id: "1.1", sec: "start", short: "The survey", title: "The Wadi Ghadir ground-magnetic survey",
  tag: "More than twelve thousand total-field readings along the wadis of the Eastern Desert of Egypt, diurnally corrected in the field. This lab runs the complete magnetic processing chain on them in your browser.",
  goal: "see where and when the field was measured and which steps turn the readings into anomaly maps.",
  figs: [
    { title: "Readings on the Copernicus relief", sub: "Every reading, coloured by survey day or by the total field. The star is gravity base 100. Move the pointer over the map.",
      html: () => `<div class="row">${segHTML("ovC", [["day", "Survey day"], ["tmi", "Total field"], ["tma", "Anomaly (TMA)"]], LAB.ui.ovC || "day", "Colour")}</div>${mapHTML("ovMap")}<div class="legend" id="ovLeg"></div><canvas class="plot" id="ovCb"></canvas><div class="kpis" id="ovK"></div>`,
      draw() { bindSeg("ovC", v => { LAB.ui.ovC = v; paintOverview(); }); onPaint(paintOverview); } },
    { title: "The processing chain", sub: "Each step is one chapter; the same eight steps as the Python chain (wghadir.chains.MagneticChain). Click a step to open it.",
      html: () => `<div class="chain">${[["2.1", "Load", "Workbook or CSV"], ["2.2", "Readings and days", "Time series, diurnal"], ["3.1", "Despike", "Hampel filter"], ["3.2", "IGRF-14", "TMA = TMI − IGRF"], ["3.3", "QC statistics", "Days, crossovers"], ["4.1", "Gridding", "Block median + spline"], ["4.2", "Reduction to the pole", "FFT, induced"], ["4.3", "Filters", "Derivatives, spectrum"], ["5.1", "Cross-section", "Profile across the map"], ["5.2", "Forward model", "2-D magnetic polygons"], ["5.3", "Inversion", "Susceptibility section"], ["5.4", "pyGIMLi and SimPEG", "3-D models"], ["6.2", "Export", "CSV, grids, PNG"]].map(([id, t, d]) => `<div class="go" tabindex="0" role="button" data-go="${id}"><i>${id}</i><b>${t}</b>${d}</div>`).join("")}</div>`,
      draw() {} }],
  ideas: [["map", "Ground magnetics", "A total-field magnetometer measures |B| about every 3 m along the tracks. Rocks rich in magnetite add or subtract a few to a few thousand nT."],
    ["clock", "Diurnal correction", "The external field changes during the day by tens of nT. The field team subtracted a base-station record: corrected = reading + correction."],
    ["globe", "IGRF", "The main field of the Earth's core (about 42 000 nT here, inclination 37°) is removed with the IGRF-14 model; what is left is the crustal anomaly."]],
  notes: [NOTE("key", "Python companion", "<p>The same chain in Python: <code>wghadir.chains.MagneticChain</code> and <code>notebooks/02_Magnetic_Processing.ipynb</code>; 3-D modelling with pyGIMLi and SimPEG in <code>notebooks/05_Magnetic_Modelling_pyGIMLi_SimPEG.ipynb</code>.</p>")],
});
function paintOverview() {
  const cv = $("ovMap"); if (!cv || !Lr()) return; const L = Lr(), mode = LAB.ui.ovC || "day", ok = okR(), sp = L.d.filter(r => r.spike);
  let pts, S = null, unit = "nT", pal = "mag";
  if (mode === "day") { pts = thin(ok, 9000).map(r => ({ lat: r.lat, lon: r.lon, color: dayColor(r.day), r: 1.7, label: rLabel(r) })); S = { t: () => 0 }; }
  else { const key = mode === "tmi" ? "tmi" : "tma", v = ok.map(r => r[key]); S = stretchFn(v, "eq"); pts = thin(ok, 9000).map(r => ({ lat: r.lat, lon: r.lon, v: r[key], r: 1.9, label: rLabel(r) })); }
  pts = pts.concat(sp.map(r => ({ lat: r.lat, lon: r.lon, x: true, r: 3, color: "#111", label: "spike · " + rLabel(r), v: r.tmi })));
  drawMap(cv, { pts, S, pal, tip: $("ovMapt"), unit, name: mode });
  if (mode === "day") { legend($("ovLeg"), L.days.map(d => ({ dot: true, color: dayColor(d.day), label: `${dayName(d.day)}: ${d.n}` })).concat([{ text: "✕ rejected spike" }])); setup($("ovCb"), 1); }
  else { $("ovLeg").innerHTML = ""; colorBar($("ovCb"), pal, S, unit); }
  $("ovK").innerHTML = KPI("Readings", L.d.filter(r => r.day > 0).length.toLocaleString("en-US"), "hl") + KPI("Accepted", ok.length.toLocaleString("en-US")) + KPI("Survey days", L.nDays) + KPI("Main field F", nT(L.F)) + KPI("Inclination / declination", `${fmt(L.inc, 1)}° / ${fmt(L.dec, 1)}°`);
}

/* ---------- 2.1 load ---------- */
CH.push({ id: "2.1", sec: "data", short: "Load the data", title: "Load magnetic readings",
  tag: "Start from the Wadi Ghadir example, or load your own total-field readings as a workbook (.xlsx) or a table (.csv). Every chapter then works on your data.",
  goal: "load a data set, check how its columns were read and set the survey date for the IGRF.",
  figs: [
    { title: "Data source", sub: "Your files stay in your browser; nothing is uploaded anywhere.",
      html: () => `<div class="drop big" id="dz"><div class="fileline"><b>Magnetic readings: workbook (.xlsx) or table (.csv, .txt)</b><input type="file" id="fMag" accept=".xlsx,.xls,.csv,.txt,.tsv"></div>
        <div class="row"><label class="chk" style="gap:8px">Survey date (for the IGRF; used when the file has no dates) <input type="date" id="pDate" value="${esc(P().date)}"></label></div>
        <div class="row"><button class="tbtn go" type="button" id="bRun">Process my file</button><button class="tbtn" type="button" id="bEx">Reload the Wadi Ghadir example</button><span class="hint">or drop the file on this box</span></div></div>
        <div class="msg" id="loadMsg" aria-live="polite"></div>`,
      draw() {
        const dz = $("dz"); dz.ondragover = e => { e.preventDefault(); dz.classList.add("over"); }; dz.ondragleave = () => dz.classList.remove("over");
        dz.ondrop = e => { e.preventDefault(); dz.classList.remove("over"); readFile(e.dataTransfer.files[0]); };
        $("bRun").onclick = () => readFile($("fMag").files[0]); $("bEx").onclick = () => { LAB.input = EXAMPLE; afterLoad("Wadi Ghadir example data reloaded."); };
        $("pDate").onchange = e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { P().date = e.target.value; changed(); } };
        onPaint(loadMessage);
      } },
    { title: "How the columns were read", sub: "The first rows of the table as the lab understood them.", html: () => `<div class="scroll"><table class="t" id="prevT"></table></div><div class="kpis" id="prevK"></div>`,
      draw() { onPaint(paintPreview); } },
    { title: "File format", sub: "The first row holds the column names (any letter case); comma, semicolon or tab separated. Lines starting with # are skipped.",
      html: () => `<pre class="code">lat,lon,elev,reading,time,tmi
24.778880,34.859040,234.40,42096.89,11:49:13,42085.89
24.778883,34.859037,235.28,42097.14,11:50:07,42086.14</pre>
        <p class="hint"><b>Required:</b> lat, lon (WGS84 degrees) and the total field in nT (column tmi, corrected, total_field or field; in the Wadi Ghadir workbook "Corrected data (Total Intensity)"), plus time (hh:mm:ss or hhmmss) or date. <b>Optional:</b> elev (m, for the IGRF height), reading (the uncorrected field: the diurnal correction is then shown), date (YYYY-MM-DD; days are otherwise found where the time jumps back by more than 30 min), line. The readings must be in the order they were measured.</p>
        <div class="row"><button class="tbtn" type="button" id="bTpl">Wadi Ghadir readings as CSV</button><span class="hint" id="tplMsg"></span></div>`,
      draw() { $("bTpl").onclick = () => saveFile("wadi_ghadir_magnetic_readings.csv", exampleCSV(), "text/csv", $("tplMsg")); } }],
  ideas: [["layers", "Workbook or table", "The supplied workbook is read by its column order (lat, long, x, y, E, Reading, Time, Corrected data). Any other table needs named columns."],
    ["clock", "Survey date", "The Wadi Ghadir file has times but no dates. The IGRF needs a date: 20 January 2026 is assumed. The field changes by about 30 nT per year, so a few weeks do not matter."],
    ["check", "Diurnally corrected", "The lab expects the external (diurnal) variation already removed. If not, the day-to-day level shifts appear in the crossovers of chapter 3.3."]],
});
function loadMessage() { const m = $("loadMsg"); if (!m) return; if (LAB.error) { m.className = "msg bad"; m.innerHTML = "<b>Could not process the data.</b> " + esc(LAB.error); return; }
  const L = Lr(); m.className = "msg ok"; m.innerHTML = `<b>${esc(LAB.input.name)}</b>: ${L.d.length.toLocaleString("en-US")} rows, ${L.d.filter(r => r.day > 0).length.toLocaleString("en-US")} readings on ${L.nDays} days, ${okR().length.toLocaleString("en-US")} accepted.`; }
function paintPreview() {
  const t = $("prevT"); if (!t || !Lr()) return; const d = Lr().d.slice(0, 8);
  t.innerHTML = `<tr><th>Row</th><th>Lat</th><th>Lon</th><th>Elev [m]</th><th>Reading [nT]</th><th>Time</th><th>Date</th><th>Total field [nT]</th><th>Diurnal [nT]</th><th>Day</th></tr>` + d.map(r => `<tr><td class="n">${r.row}</td><td class="n">${fmt(r.lat, 6)}</td><td class="n">${fmt(r.lon, 6)}</td><td class="n">${fmt(r.elev, 1)}</td><td class="n">${fmt(r.reading, 2)}</td><td class="n">${hms(r.t)}</td><td>${esc(r.date || "–")}</td><td class="n">${fmt(r.tmi, 2)}</td><td class="n">${fmt(r.diurnal, 1)}</td><td class="n">${r.day || "–"}</td></tr>`).join("");
  const nd = Lr().d.filter(r => r.flags.includes("NON_DATA_ROW")).length;
  $("prevK").innerHTML = KPI("Rows", Lr().d.length.toLocaleString("en-US"), "hl") + KPI("Non-data rows", nd) + KPI("Days", Lr().nDays + (Lr().hasDate ? " <small>from dates</small>" : " <small>from time jumps</small>")) + KPIT("IGRF date", esc(P().date) + (Lr().hasDate ? " (only where no date)" : " (assumed)"));
}
function readFile(f) {
  const msg = $("loadMsg"); if (!f) { msg.className = "msg bad"; msg.innerHTML = "<b>No file chosen.</b>"; return; }
  const done = (table, name) => { LAB.input = { name, table, hill: null, base: null, python: null }; afterLoad(name + " loaded."); };
  if (/\.xlsx?$/i.test(f.name)) {
    msg.className = "msg"; msg.textContent = "Reading the workbook…";
    loadXLSX().then(X => f.arrayBuffer().then(buf => { const wb = X.read(buf, { type: "array" }), ws = wb.Sheets[wb.SheetNames[0]]; done(X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }).filter(r => r.some(v => v !== null)), f.name); }))
      .catch(e => { msg.className = "msg bad"; msg.innerHTML = "<b>Could not read the workbook.</b> " + esc(e.message || e) + " Save it as CSV and load that instead."; });
  } else f.text().then(t => done(MAG.parseCSVTable(t), f.name));
}
let XLSXP = null;
function loadXLSX() {   // SheetJS, loaded only when a workbook is opened
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return XLSXP || (XLSXP = new Promise((ok, no) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = () => ok(window.XLSX); s.onerror = () => { XLSXP = null; no(new Error("the workbook reader could not be loaded (no internet?).")); }; document.head.appendChild(s); }));
}
function afterLoad(text) {
  compute();
  if (!LAB.input.example && Lr()) { const h = EXAMPLE.hill, ok = okR(); LAB.input.hill = ok.length && ok.every(r => r.lon >= h.lon0 && r.lon <= h.lon1 && r.lat >= h.lat0 && r.lat <= h.lat1) ? h : null; if (LAB.input.hill) LAB.input.base = EXAMPLE.base; }
  LAB.ui.s = null; LAB.ui.fm = null; LAB.sec = null; LAB.invP = null;
  updateBadge(); if (HERO.W) heroSize(); repaint(); loadMessage();
  const m = $("loadMsg"); if (m && !LAB.error) m.innerHTML = `<b>${esc(text)}</b> ` + m.innerHTML;
}
function updateBadge() { $("dataBadge").textContent = LAB.input.example ? "· Wadi Ghadir example data" : "· your data: " + LAB.input.name; heroStats(); }
function heroStats() { if (!Lr()) return; const L = Lr(); $("heroStats").innerHTML = `<div class="hstat"><b>${L.d.filter(r => r.day > 0).length.toLocaleString("en-US").replace(",", " ")}</b><span>total-field readings</span></div><div class="hstat"><b>${L.nDays}</b><span>survey days</span></div><div class="hstat"><b>${fmt(L.F / 1000, 1)}k</b><span>nT main field, I = ${fmt(L.inc, 0)}°</span></div>`; }
function exampleCSV() { const T = EXAMPLE.table; return ["# Wadi Ghadir ground magnetics, written by " + AUTHOR + ". Total field diurnally corrected (tmi); times local, no dates in the source.", "lat,lon,elev,reading,time,tmi"].concat(T.slice(1).filter(r => isF(r[0]) && isF(r[5])).map(r => [r[0], r[1], r[2] ?? "", r[3] ?? "", hms(MAG.timeSec(r[4])), r[5]].join(","))).join("\n"); }

/* ---------- 2.2 readings and days ---------- */
CH.push({ id: "2.2", sec: "data", short: "Readings and days", title: "The readings, day by day",
  tag: "The file has no dates: a new survey day starts where the time jumps back. Each day is one walk with the magnetometer; the diurnal correction shows how much the external field moved.",
  goal: "browse the readings of each day: the corrected field, the raw reading and the diurnal correction.",
  figs: [{ title: "Total field along the walk", sub: "Choose the day. Top: corrected total field; bottom: the diurnal correction applied in the field (corrected − reading). Move the pointer along the curves.",
    html: () => `<div class="row">Day ${sel("rdDay", dayList().map(k => [k, dayName(k)]), LAB.ui.day || 5, "Day")}</div><canvas class="plot" id="rdCv"></canvas><canvas class="plot" id="rdDi"></canvas><div class="kpis" id="rdK"></div>`,
    draw() { bindSel("rdDay", v => { LAB.ui.day = +v; paintReadings(); }); onPaint(paintReadings); } },
    { title: "The day on the map", sub: "Readings of the chosen day in colour, the other days in grey.", html: () => mapHTML("rdMap"), draw() { onPaint(paintDayMap); } }],
  ideas: [["clock", "Days from the clock", "When the time goes back by more than 30 minutes (the next morning), a new day begins. Ten days are found in the Wadi Ghadir file."],
    ["wave", "Diurnal variation", "Between 0 and −170 nT were applied. A quiet day varies by a few tens of nT; magnetic storms by hundreds."],
    ["map", "Along the wadis", "Readings follow the tracks about every 3 m: anomalies are sampled densely along the lines and sparsely between them."]],
  tries: ["Find the day with the largest diurnal correction. Does its field look noisier?", "Day 5 is the longest walk. Where on the map does the field change most?"],
});
function paintReadings() {
  const cv = $("rdCv"); if (!cv || !Lr()) return; const k = LAB.ui.day && dayList().includes(LAB.ui.day) ? LAB.ui.day : dayList().includes(5) ? 5 : dayList()[0], g = Lr().d.filter(r => r.day === k);
  const x = g.map(r => r.t / 3600), xl = [Math.min(...x), Math.max(...x) + 1e-3];
  plot(cv, { series: [{ name: "corrected", x, y: g.map(r => r.tmi), color: dayColor(k), w: 1.3, unit: "nT", dec: 1 }, { name: "spike", x: g.filter(r => r.spike).map(r => r.t / 3600), y: g.filter(r => r.spike).map(r => r.tmi), color: "#111", dots: true, r: 3.2, unit: "nT", dec: 1 }],
    xlim: xl, ylabel: "total field [nT]", xlabel: "", xname: "time", xfmt: v => hms(v * 3600).slice(0, 5), h: 240, snap: 0.05 });
  const di = g.map(r => r.diurnal);
  plot($("rdDi"), { series: [{ name: "diurnal", x, y: di, color: "#7f8a93", w: 1.6, unit: "nT", dec: 1, fill: 0, fillAlpha: 0.18 }], xlim: xl, ylabel: "correction [nT]", xlabel: "time of day", xname: "time", xfmt: v => hms(v * 3600).slice(0, 5), h: 150, yzero: true });
  const D = Lr().days.find(d => d.day === k);
  $("rdK").innerHTML = KPI("Readings", D.n, "hl") + KPI("Time", `${hms(D.t0).slice(0, 5)}–${hms(D.t1).slice(0, 5)}`) + KPI("Field range", `${fmt(D.tmiMin, 0)} … ${fmt(D.tmiMax, 0)} <small>nT</small>`) + KPI("Diurnal correction", isF(D.diMin) ? `${fmt(D.diMin, 0)} … ${fmt(D.diMax, 0)} <small>nT</small>` : "–") + KPI("Spikes", D.spikes);
}
function paintDayMap() {
  const cv = $("rdMap"); if (!cv || !Lr()) return; const k = LAB.ui.day && dayList().includes(LAB.ui.day) ? LAB.ui.day : dayList().includes(5) ? 5 : dayList()[0];
  const ok = okR(), other = thin(ok.filter(r => r.day !== k), 5000).map(r => ({ lat: r.lat, lon: r.lon, color: "rgba(80,80,80,.35)", r: 1.3, label: rLabel(r) })), mine = ok.filter(r => r.day === k).map(r => ({ lat: r.lat, lon: r.lon, color: dayColor(k), r: 2.2, label: rLabel(r), v: r.tmi }));
  drawMap(cv, { pts: other.concat(mine), S: { t: () => 0 }, tip: $("rdMapt"), unit: "nT" });
}

/* ---------- 3.1 despike ---------- */
CH.push({ id: "3.1", sec: "qc", short: "Despike", title: "Despiking with a Hampel filter",
  tag: "Single wild readings (a passing car, a fence, a sensor glitch) are found by comparing every reading with the running median of its neighbours on the same day.",
  goal: "tune the Hampel filter and see which readings it rejects.",
  figs: [{ title: "Running median and threshold", sub: "Choose a day and a stretch of readings. Grey band: median ± threshold; black crosses: rejected readings.",
    html: () => { const d = P().despike, u = LAB.ui.ds || (LAB.ui.ds = { day: 5, from: 0, n: 600 });
      return `<div class="row">Day ${sel("dsDay", dayList().map(k => [k, dayName(k)]), u.day, "Day")} ${chk("dsOn", "Despike on", d.on)}</div>
      <div class="ctrls">${slider("dsW", "Window (readings)", 3, 41, 2, d.window, "")}${slider("dsK", "Threshold k (× robust σ)", 2, 12, 0.5, d.k, "", v => v.toFixed(1))}${slider("dsF", "Minimum threshold", 5, 100, 5, d.floor, "nT")}${slider("dsFrom", "First reading shown", 0, 6000, 50, u.from, "")}${slider("dsN", "Readings shown", 100, 3000, 100, u.n, "")}</div>
      <canvas class="plot" id="dsCv"></canvas><canvas class="plot" id="dsDev"></canvas><div class="kpis" id="dsK"></div>`; },
    draw() { const d = P().despike, u = LAB.ui.ds;
      bindSel("dsDay", v => { u.day = +v; u.from = 0; paintDespike(); }); bindChk("dsOn", v => { d.on = v; changed(); });
      bindSlider("dsW", "", v => { d.window = v; changed(); }); bindSlider("dsK", "", v => { d.k = v; changed(); }, v => v.toFixed(1)); bindSlider("dsF", "nT", v => { d.floor = v; changed(); });
      bindSlider("dsFrom", "", v => { u.from = v; paintDespike(); }); bindSlider("dsN", "", v => { u.n = v; paintDespike(); });
      onPaint(paintDespike); } },
    { title: "Rejected readings on the map", sub: "Crosses: rejected spikes; dots: accepted readings coloured by day.", html: () => mapHTML("dsMap") + `<div class="scroll"><table class="t" id="dsT"></table></div>`, draw() { onPaint(paintSpikeMap); } }],
  ideas: [["filter", "Hampel filter", "Median and median absolute deviation (MAD) in a moving window: robust against the very outliers it looks for."],
    ["scale", "Threshold", "A reading is rejected when it is further from the running median than k × 1.4826 × MAD, but at least the minimum threshold (30 nT): steep but real anomalies are kept."],
    ["map", "Where the spikes are", "Spikes near roads, villages and fences are culture; a cluster of spikes inside a strong anomaly is often real geology. Check before rejecting."]],
  eqs: [EQ("|T<sub>i</sub> − med<sub>w</sub>(T)| > max(f, k · 1.4826 · MAD<sub>w</sub>)", "Hampel test (window w)")],
  tries: ["Set k to 3: how many more readings are rejected?", "Turn the despike off and look at the anomaly map of chapter 4.1.", "Widen the window to 31 readings: which spikes are now missed?"],
});
function paintDespike() {
  const cv = $("dsCv"); if (!cv || !Lr()) return; const u = LAB.ui.ds, k = dayList().includes(u.day) ? u.day : dayList()[0], all = Lr().d.filter(r => r.day === k);
  const g = all.slice(Math.min(u.from, Math.max(0, all.length - 10)), Math.min(all.length, u.from + u.n)), x = g.map((r, i) => Math.min(u.from, Math.max(0, all.length - 10)) + i);
  const xl = [x[0], x[x.length - 1] + 1e-6], up = g.map(r => r.hmed + r.thr), lo = g.map(r => r.hmed - r.thr);
  plot(cv, { series: [{ name: "median + thr", x, y: up, color: "rgba(127,138,147,.6)", w: 1, noscale: true, dec: 1 }, { name: "median − thr", x, y: lo, color: "rgba(127,138,147,.6)", w: 1, noscale: true, dec: 1 },
    { name: "median", x, y: g.map(r => r.hmed), color: "#7f8a93", w: 1.2, dash: [4, 3], unit: "nT", dec: 1 }, { name: "total field", x, y: g.map(r => r.tmi), color: dayColor(k), w: 1.5, unit: "nT", dec: 1 },
    { name: "spike", x: x.filter((_, i) => g[i].spike), y: g.filter(r => r.spike).map(r => r.tmi), color: "#111", dots: true, r: 3.5, unit: "nT", dec: 1 }],
    xlim: xl, ylabel: "total field [nT]", xlabel: "", xname: "reading", h: 260, snap: 3 });
  plot($("dsDev"), { series: [{ name: "|T − median|", x, y: g.map(r => r.hdev), color: dayColor(k), w: 1.2, unit: "nT", dec: 1 }, { name: "threshold", x, y: g.map(r => r.thr), color: "#111", w: 1.4, dash: [5, 3], unit: "nT", dec: 1 }],
    xlim: xl, ylabel: "deviation [nT]", xlabel: "reading number within the day", xname: "reading", h: 160, snap: 3 });
  const L = Lr(), n = L.d.filter(r => r.spike).length;
  $("dsK").innerHTML = KPI("Rejected spikes", n, "hl") + KPI("On this day", all.filter(r => r.spike).length) + KPI("Accepted readings", okR().length.toLocaleString("en-US")) + KPI("Share rejected", fmt(100 * n / L.d.filter(r => r.day > 0).length, 2) + " <small>%</small>");
}
function paintSpikeMap() {
  const cv = $("dsMap"); if (!cv || !Lr()) return; const sp = Lr().d.filter(r => r.spike);
  drawMap(cv, { pts: thin(okR(), 6000).map(r => ({ lat: r.lat, lon: r.lon, color: dayColor(r.day), r: 1.3, label: rLabel(r), v: r.tmi })).concat(sp.map(r => ({ lat: r.lat, lon: r.lon, x: true, r: 3.5, color: "#111", label: "spike · " + rLabel(r), v: r.hdev }))), S: { t: () => 0 }, tip: $("dsMapt"), unit: "nT" });
  const t = $("dsT"); const top = sp.slice().sort((a, b) => b.hdev - a.hdev).slice(0, 12);
  t.innerHTML = `<tr><th>Row</th><th>Day</th><th>Time</th><th>Field [nT]</th><th>Median [nT]</th><th>Deviation [nT]</th><th>Threshold [nT]</th></tr>` + top.map(r => `<tr><td class="n">${r.row}</td><td class="n">${r.day}</td><td class="n">${hms(r.t)}</td><td class="n">${fmt(r.tmi, 1)}</td><td class="n">${fmt(r.hmed, 1)}</td><td class="n">${fmt(r.hdev, 1)}</td><td class="n">${fmt(r.thr, 1)}</td></tr>`).join("") + (sp.length > 12 ? `<tr><td colspan="7" class="hint">… and ${sp.length - 12} more (largest deviations shown)</td></tr>` : "");
}

/* ---------- 3.2 IGRF ---------- */
CH.push({ id: "3.2", sec: "qc", short: "IGRF-14", title: "Removing the main field: IGRF-14",
  tag: "The International Geomagnetic Reference Field describes the field of the Earth's core. Computed at every reading and subtracted, it leaves the total-field anomaly (TMA) of the crust.",
  goal: "compute the IGRF for the survey date, see the field direction and its effect on the anomaly.",
  figs: [{ title: "Field at the survey", sub: "IGRF-14 (degree 13, linear in time between the 5-year models) at every reading, for the survey date. Change the date to see the secular variation.",
    html: () => `<div class="row"><label class="chk" style="gap:8px">Survey date <input type="date" id="igDate" value="${esc(P().date)}"></label></div><div class="kpis" id="igK"></div><canvas class="plot" id="igDir" style="max-width:520px"></canvas>`,
    draw() { $("igDate").onchange = e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { P().date = e.target.value; changed(); } }; onPaint(paintIGRF); } },
    { title: "Date sensitivity", sub: "IGRF total field, inclination and declination at the survey centre, 2024–2028. The file has no dates, so the assumed date matters only through this drift.",
      html: () => `<canvas class="plot" id="igSens"></canvas><div class="scroll"><table class="t" id="igT"></table></div>`, draw() { onPaint(paintIGRFSens); } },
    { title: "Total-field anomaly at the readings", sub: "TMA = corrected total field − IGRF. Colours: histogram-equalised. Crosses: rejected spikes.",
      html: () => mapHTML("igMap") + `<canvas class="plot" id="igCb"></canvas>`, draw() { onPaint(paintTMAMap); } }],
  ideas: [["globe", "IGRF-14", "Spherical-harmonic model of the core field to degree 13 (IAGA 2024), valid 1900–2030; the 2025–2030 part is a prediction from the secular variation."],
    ["target", "Inclination 37°", "At Wadi Ghadir the field dips 37° below horizontal towards magnetic north (declination 4°E). Anomalies are therefore asymmetric: a high to the south, a low to the north of a body."],
    ["clock", "Secular variation", "The main field changes by tens of nT per year. Within one survey this is a constant shift and does not change the anomaly pattern."]],
  eqs: [EQ("V = a Σ<sub>n</sub> (a/r)<sup>n+1</sup> Σ<sub>m</sub> (g<sub>n</sub><sup>m</sup> cos mλ + h<sub>n</sub><sup>m</sup> sin mλ) P<sub>n</sub><sup>m</sup>(cos θ)", "Main-field potential"), EQ("ΔT ≈ |B<sub>obs</sub>| − |B<sub>IGRF</sub>|", "Total-field anomaly")],
});
function fieldDiagram(cv, I, D) {
  const { ctx, W, H } = setup(cv, 190), cx = W * 0.27, cy = 96, R = 70;
  ctx.strokeStyle = css("--rule"); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.stroke();
  ctx.fillStyle = css("--muted"); ctx.font = "600 12px " + css("--disp"); ctx.textAlign = "center"; ctx.fillText("N", cx, cy - R - 8); ctx.fillText("map view", cx, cy + R + 18);
  arrow(ctx, cx, cy, cx + R * 0.92 * Math.sin(D * Math.PI / 180), cy - R * 0.92 * Math.cos(D * Math.PI / 180), acc(), 2.6, 9);
  const sx = W * 0.72, sy = 50, L2 = Math.min(150, W * 0.36);
  ctx.strokeStyle = css("--ink"); ctx.beginPath(); ctx.moveTo(sx - L2 / 2, sy); ctx.lineTo(sx + L2 / 2, sy); ctx.stroke();
  ctx.fillStyle = css("--muted"); ctx.fillText("ground", sx + L2 / 2 - 18, sy - 8); ctx.fillText("vertical section towards north", sx, 182);
  arrow(ctx, sx - 40, sy + 10, sx - 40 + 110 * Math.cos(I * Math.PI / 180), sy + 10 + 110 * Math.sin(I * Math.PI / 180), acc(), 2.6, 9);
  ctx.fillStyle = css("--ink"); ctx.font = "700 13px " + css("--disp"); ctx.textAlign = "left"; ctx.fillText(`I = ${fmt(I, 1)}°`, sx + 20, sy + 40); ctx.fillText(`D = ${fmt(D, 1)}°`, cx + 16, cy + 4);
}
function paintIGRF() {
  const L = Lr(); if (!$("igK") || !L) return; const ok = okR(), F = ok.map(r => r.F);
  $("igK").innerHTML = KPI("Total field F", nT(L.F, 1), "hl") + KPI("Inclination", fmt(L.inc, 2) + "°") + KPI("Declination", fmt(L.dec, 2) + "°") + KPI("F across the area", `${fmt(Math.min(...F), 0)} … ${fmt(Math.max(...F), 0)} <small>nT</small>`) + KPI("Anomaly median", nT(MAG.median(ok.map(r => r.tma))));
  fieldDiagram($("igDir"), L.inc, L.dec);
}
function paintIGRFSens() {
  const cv = $("igSens"); if (!cv || !Lr()) return; const ok = okR(), lat = MAG.median(ok.map(r => r.lat)), lon = MAG.median(ok.map(r => r.lon));
  const ds = []; for (let y = 2024; y <= 2028; y += 1 / 12) { const yy = Math.floor(y), mm = Math.round((y - yy) * 12) + 1; if (mm > 12) continue; ds.push(`${yy}-${String(mm).padStart(2, "0")}-15`); }
  const s = MAG.igrfSensitivity(lat, lon, ds), x = ds.map(MAG.decYear), cur = MAG.decYear(P().date), F0 = MAG.igrfSensitivity(lat, lon, [P().date])[0];
  plot(cv, { series: [{ name: "F", x, y: s.map(q => q.F), color: acc(), w: 2.4, unit: "nT", dec: 1 }, { name: "I", x, y: s.map(q => q.I), color: "#2356C8", w: 1.6, dash: [5, 3], unit: "°", dec: 3, y2: true }],
    xlim: [2024, 2028], vlines: [{ x: cur, color: acc(), label: P().date }], ylabel: "F [nT]", y2: true, y2label: "inclination [°]", xlabel: "date", xname: "year", xfmt: v => v.toFixed(1), h: 230 });
  const rows = ["2025-01-15", "2025-07-15", P().date, "2026-07-15"].map(d => MAG.igrfSensitivity(lat, lon, [d])[0]);
  $("igT").innerHTML = `<tr><th>Date</th><th>F [nT]</th><th>I [°]</th><th>D [°]</th><th>F − F(survey) [nT]</th></tr>` + rows.map(r => `<tr class="${r.date === P().date ? "sel" : ""}"><td>${r.date}</td><td class="n">${fmt(r.F, 1)}</td><td class="n">${fmt(r.I, 3)}</td><td class="n">${fmt(r.D, 3)}</td><td class="n">${fmt(r.F - F0.F, 1)}</td></tr>`).join("");
}
function paintTMAMap() {
  const cv = $("igMap"); if (!cv || !Lr()) return; const ok = okR(), S = stretchFn(ok.map(r => r.tma), "eq");
  drawMap(cv, { pts: thin(ok, 9000).map(r => ({ lat: r.lat, lon: r.lon, v: r.tma, r: 1.9, label: rLabel(r) })).concat(Lr().d.filter(r => r.spike).map(r => ({ lat: r.lat, lon: r.lon, x: true, r: 3, color: "#111", label: "spike · " + rLabel(r) }))), S, pal: "mag", tip: $("igMapt"), unit: "nT", name: "TMA" });
  colorBar($("igCb"), "mag", S, "nT");
}

/* ---------- 3.3 QC statistics ---------- */
CH.push({ id: "3.3", sec: "qc", short: "QC statistics", title: "Quality statistics: days and crossovers",
  tag: "Where tracks of different days meet, the corrected field must agree. Crossover differences reveal day-to-day level errors of the diurnal correction.",
  goal: "check every day and the agreement between days.",
  figs: [{ title: "Day summary", sub: "One row per survey day.", html: () => `<div class="scroll"><table class="t" id="qdT"></table></div><canvas class="plot" id="qdCv"></canvas>`, draw() { onPaint(paintDays); } },
    { title: "Crossovers between days", sub: "Accepted readings closer than the distance below but measured on different days; difference = later day − earlier day.",
      html: () => `<div class="ctrls">${slider("xoD", "Maximum distance", 1, 50, 1, P().xover.maxM, "m")}</div><canvas class="plot" id="xoCv"></canvas><div class="scroll"><table class="t" id="xoT"></table></div><div class="kpis" id="xoK"></div>`,
      draw() { bindSlider("xoD", "m", v => { P().xover.maxM = v; saveParams(); LAB.xo = null; paintXover(); }); onPaint(paintXover); } }],
  ideas: [["check", "Crossovers", "Two readings within a few metres should see the same crustal field. Their difference measures the error of the diurnal correction and of positioning."],
    ["map", "Few crossings", "Wadi Ghadir tracks rarely cross on different days: with 5 m only 3 pairs exist. Increase the distance to see more, at the cost of including real field gradients."]],
});
function paintDays() {
  const t = $("qdT"); if (!t || !Lr()) return; const D = Lr().days;
  t.innerHTML = `<tr><th>Day</th><th>Readings</th><th>Accepted</th><th>Spikes</th><th>First</th><th>Last</th><th>Diurnal [nT]</th><th>Median field [nT]</th><th>Range [nT]</th></tr>` + D.map(d => `<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${dayColor(d.day)}"></i> ${d.day}${d.date ? " · " + d.date : ""}</td><td class="n">${d.n}</td><td class="n">${d.nOk}</td><td class="n">${d.spikes}</td><td class="n">${hms(d.t0)}</td><td class="n">${hms(d.t1)}</td><td class="n">${isF(d.diMin) ? fmt(d.diMin, 0) + " … " + fmt(d.diMax, 0) : "–"}</td><td class="n">${fmt(d.tmiMed, 1)}</td><td class="n">${fmt(d.tmiMin, 0)} … ${fmt(d.tmiMax, 0)}</td></tr>`).join("");
  plot($("qdCv"), { series: [{ name: "readings", x: D.map(d => d.day), y: D.map(d => d.n), color: acc(), bars: true, bw: 18, dec: 0 }], xlim: [0.4, D.length + 0.6], xstep: 1, ylabel: "readings", xlabel: "survey day", xname: "day", xfmt: v => String(v), h: 170, yzero: true });
}
function paintXover() {
  const cv = $("xoCv"); if (!cv || !Lr()) return; const key = P().xover.maxM + "|" + LAB.L.d.length + "|" + okR().length;
  if (!LAB.xo || LAB.xo.key !== key) LAB.xo = { key, p: MAG.crossovers(Lr(), Lr().local, P().xover.maxM) };
  const p = LAB.xo.p, d = p.map(q => q.dT);
  plot(cv, { series: [{ name: "pair", x: p.map(q => q.dist), y: d, color: acc(), dots: true, r: 3.2, unit: "nT", dec: 1 }], xlim: [0, P().xover.maxM], hlines: [{ y: 0 }], ylabel: "ΔT (later − earlier) [nT]", xlabel: "distance between the readings [m]", xname: "m", xfmt: v => fmt(v, 0), h: 220 });
  const g = new Map(); p.forEach(q => { const k = q.dayA + "–" + q.dayB; if (!g.has(k)) g.set(k, []); g.get(k).push(q.dT); });
  $("xoT").innerHTML = `<tr><th>Days</th><th>Pairs</th><th>Median ΔT [nT]</th><th>MAD [nT]</th></tr>` + [...g].map(([k, v]) => { const m = MAG.median(v); return `<tr><td>${k}</td><td class="n">${v.length}</td><td class="n">${fmt(m, 1)}</td><td class="n">${fmt(MAG.median(v.map(x => Math.abs(x - m))), 1)}</td></tr>`; }).join("");
  $("xoK").innerHTML = KPI("Pairs", p.length, "hl") + KPI("Median |ΔT|", p.length ? nT(MAG.median(d.map(Math.abs)), 1) : "–") + KPI("Day pairs", g.size);
}

/* ---------- 4.1 gridding ---------- */
const gDefaults = () => LAB.ui.g || (LAB.ui.g = { q: "tma", pal: "mag", stretch: "eq", ct: false, ci: 100, st: false, hill: true });
const gkey = q => JSON.stringify([LAB.input.name, P().date, P().despike, P().grid, q, okR().length]);
/* the grid of a quantity (TMI or TMA), computed with the settings of 4.1 when missing or out of date */
function getGrid(q) {
  const k = gkey(q); if (LAB.grids[q] && LAB.gkey[q] === k) return LAB.grids[q];
  const t = Date.now(), G = MAG.gridField(okR().map(r => ({ lat: r.lat, lon: r.lon, v: q === "tmi" ? r.tmi : r.tma })), Object.assign({ local: Lr().local }, P().grid));
  G.ms = Date.now() - t; G.q = q; LAB.grids[q] = G; LAB.gkey[q] = k; return G;
}
const hasGrid = q => LAB.grids[q] && LAB.gkey[q] === gkey(q);
/* run a slow step after the page has shown its busy note */
function busy(id, fn) { const b = $(id); if (b) b.hidden = false; setTimeout(() => { try { fn(); } catch (e) { console.error(e); } if (b) b.hidden = true; }, 40); }
const QN = { tmi: ["Total magnetic intensity", "TMI"], tma: ["Total-field anomaly", "TMA"], rtp: ["Reduced to the pole", "RTP"] };
CH.push({ id: "4.1", sec: "maps", short: "Gridding", title: "From readings to a gridded map",
  tag: "The readings are reduced to one median per block, a linear trend is removed and a biharmonic spline is fitted (Verde, as in the Python chain). Nodes far from any reading are blanked.",
  goal: "grid the total field and the anomaly with your settings and read the map.",
  figs: [{ title: "Gridded map", sub: "A grid of the whole survey takes a few seconds. Move the pointer over the map for values.",
    html: () => { const g = gDefaults(), p = P().grid;
      return `<div class="row">${segHTML("gQ", [["tmi", "Total field (TMI)"], ["tma", "Anomaly (TMA)"]], g.q, "Quantity")} Colours ${segHTML("gS", [["eq", "Equalised"], ["lin", "Linear"]], g.stretch, "Stretch")} ${segHTML("gP", [["mag", "Magnetic"], ["anom", "Blue–red"], ["viridis", "Viridis"]], g.pal, "Palette")}</div>
      <div class="ctrls tight">${slider("gCell", "Grid cell", 25, 400, 25, p.cell, "m")}${slider("gBlock", "Block median", 25, 500, 25, p.block, "m")}${slider("gDamp", "Spline damping (log₁₀)", -9, 1, 0.5, p.damp, "", v => v.toFixed(1))}${slider("gMask", "Blank beyond", 0.5, 5, 0.25, p.maskKm, "km", v => v.toFixed(2))}${slider("gCi", "Contour interval", 10, 500, 10, g.ci, "nT")}</div>
      <div class="row">${chk("gHill", "Relief", g.hill)}${chk("gSt", "Readings", g.st)}${chk("gCt", "Contours", g.ct)}<button class="tbtn go" type="button" id="gRun">Compute the grid</button><button class="tbtn" type="button" id="gCv">Cross-validate (slow)</button></div>
      <div class="mapwrap">${mapHTML("gMap")}<div class="busy" id="gBusy" hidden>Computing the grid…</div></div><canvas class="plot" id="gCb"></canvas><div class="kpis" id="gK"></div>`; },
    draw() { const g = gDefaults(), p = P().grid;
      bindSeg("gQ", v => { g.q = v; gridNow(); }); bindSeg("gS", v => { g.stretch = v; paintGrid(); }); bindSeg("gP", v => { g.pal = v; paintGrid(); });
      bindSlider("gCell", "m", v => { p.cell = v; saveParams(); }); bindSlider("gBlock", "m", v => { p.block = v; saveParams(); }); bindSlider("gDamp", "", v => { p.damp = v; saveParams(); }, v => v.toFixed(1)); bindSlider("gMask", "km", v => { p.maskKm = v; saveParams(); }, v => v.toFixed(2));
      bindSlider("gCi", "nT", v => { g.ci = v; paintGrid(); }); bindChk("gHill", v => { g.hill = v; paintGrid(); }); bindChk("gSt", v => { g.st = v; paintGrid(); }); bindChk("gCt", v => { g.ct = v; paintGrid(); });
      $("gRun").onclick = gridNow; $("gCv").onclick = crossVal; onPaint(() => { if (!hasGrid(gDefaults().q)) gridNow(); else paintGrid(); }); } }],
  ideas: [["grid", "Cell size", "Along the tracks readings are 3 m apart, between tracks up to kilometres. A 50–100 m cell honours the tracks; between them the spline interpolates."],
    ["filter", "Block median", "One median per block thins the 12 000 readings to about 1 100 robust values and removes the remaining small spikes."],
    ["check", "Cross-validation", "Blocks of readings are left out and predicted from the rest: the rms error (about 170 nT here) shows how much the map between the tracks can be trusted."]],
  eqs: [EQ("T(x) = a + b·x + c·y + Σ f<sub>j</sub> φ(|x − x<sub>j</sub>| + δ)", "Biharmonic spline, φ(r) = r²(ln r − 1)"), EQ("(J<sub>s</sub><sup>T</sup>J<sub>s</sub> + αI) f<sub>s</sub> = J<sub>s</sub><sup>T</sup> d", "Damped fit (Verde), J scaled by column")],
  tries: ["Grid the total field and the anomaly: how different are they?", "Set the damping to −2: the map gets smoother. What happens to the cross-validation error?", "Use a 50 m cell (as in the Python maps) and compare."],
});
function gridNow() { const q = gDefaults().q; busy("gBusy", () => { try { getGrid(q); } catch (e) { console.error(e); if ($("gK")) $("gK").innerHTML = KPIT("Grid failed", esc(e.message), "bad"); } paintGrid(); }); }
function crossVal() {
  const q = gDefaults().q; if ($("gK")) $("gK").insertAdjacentHTML("beforeend", KPIT("Cross-validation", "running (about 10–20 s)…"));
  busy("gBusy", () => { const ok = okR(), pts = ok.map(r => ({ lat: r.lat, lon: r.lon, v: q === "tmi" ? r.tmi : r.tma })), L = Lr().local, xy = pts.map(p => L.fwd(p.lat, p.lon));
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, bid = new Map(), fold = xy.map(([x, y]) => { const k = Math.floor(x / 2000) + "|" + Math.floor(y / 2000); if (!bid.has(k)) bid.set(k, Math.floor(rnd() * 5)); return bid.get(k); });
    const err = [], p = P().grid;
    for (let f = 0; f < 5; f++) { const tr = [], te = []; xy.forEach((_, i) => (fold[i] === f ? te : tr).push(i)); if (!te.length) continue;
      const m = MAG.fitSplineVerde(tr.map(i => xy[i][0]), tr.map(i => xy[i][1]), tr.map(i => pts[i].v), p); te.forEach(i => err.push(m.predict(xy[i][0], xy[i][1]) - pts[i].v)); }
    const G = getGrid(q); G.cv = Math.sqrt(err.reduce((s, e) => s + e * e, 0) / err.length); paintGrid(); });
}
function paintGrid() {
  const cv = $("gMap"), g = gDefaults(); if (!cv || !hasGrid(g.q)) return; const G = LAB.grids[g.q], vals = Array.from(G.z).filter((v, i) => G.mask[i]), S = stretchFn(vals, g.stretch, g.q === "tma" && g.pal === "anom");
  const lev = []; if (g.ct) for (let v = Math.ceil(S.lo / g.ci) * g.ci; v <= S.hi && lev.length < 200; v += g.ci) lev.push(+v.toFixed(6));
  drawMap(cv, { grid: G, S, pal: g.pal, contours: g.ct ? lev : null, hill: g.hill, pts: g.st ? thin(okR(), 6000).map(r => ({ lat: r.lat, lon: r.lon, color: "rgba(20,20,20,.5)", r: 0.9, label: rLabel(r), v: g.q === "tmi" ? r.tmi : r.tma })) : [], tip: $("gMapt"), name: QN[g.q][1], unit: "nT" });
  colorBar($("gCb"), g.pal, S, "nT");
  $("gK").innerHTML = KPIT("Quantity", QN[g.q][0], "hl") + KPI("Grid", `${G.nx} × ${G.ny} <small>nodes</small>`) + KPI("Blocks", G.nData.toLocaleString("en-US")) + KPI("Computed in", fmt(G.ms / 1000, 1) + " <small>s</small>") + (G.cv ? KPI("Cross-validation rms", nT(G.cv, 1)) : KPIT("Cross-validation", "press Cross-validate"));
}

/* ---------- 4.2 RTP ---------- */
const rDefaults = () => LAB.ui.r || (LAB.ui.r = { auto: true, I: 36.7, D: 4.2, pal: "mag", stretch: "eq", view: "rtp" });
function rtpDir() { const r = rDefaults(); return r.auto && Lr() ? { I: Lr().inc, D: Lr().dec } : { I: r.I, D: r.D }; }
function getRTP() {
  const G = getGrid("tma"), d = rtpDir(), k = LAB.gkey.tma + "|" + d.I.toFixed(3) + "|" + d.D.toFixed(3) + "|" + P().grid.taperKm;
  if (LAB.rtp && LAB.rtp.key === k) return LAB.rtp.G;
  const z = MAG.rtp(G, d.I, d.D, P()), R = Object.assign({}, G, { z, q: "rtp" }); LAB.rtp = { key: k, G: R }; return R;
}
const hasRTP = () => hasGrid("tma") && LAB.rtp && LAB.rtp.key.startsWith(LAB.gkey.tma + "|");
CH.push({ id: "4.2", sec: "maps", short: "Reduction to the pole", title: "Reduction to the pole",
  tag: "At 37° inclination every magnetic body produces a high on its south side and a low on its north side. Reduction to the pole recomputes the anomaly as if the field were vertical, so highs sit above the bodies.",
  goal: "reduce the anomaly to the pole and compare it with the TMA.",
  figs: [{ title: "Reduced-to-pole anomaly", sub: "FFT reduction of the TMA grid of 4.1, assuming induced magnetisation along the IGRF field. Beyond the blanking distance the grid is tapered to its median.",
    html: () => { const r = rDefaults(), d = rtpDir();
      return `<div class="row">${segHTML("rV", [["rtp", "RTP"], ["tma", "TMA"], ["diff", "RTP − TMA"]], r.view, "View")} ${chk("rAuto", "Field direction from the IGRF", r.auto)} Colours ${segHTML("rS", [["eq", "Equalised"], ["lin", "Linear"]], r.stretch, "Stretch")}</div>
      <div class="ctrls">${slider("rI", "Inclination", 10, 90, 0.5, d.I.toFixed(1), "°", v => v.toFixed(1))}${slider("rD", "Declination", -30, 30, 0.5, d.D.toFixed(1), "°", v => v.toFixed(1))}${slider("rTp", "Taper width", 0.5, 6, 0.5, P().grid.taperKm, "km", v => v.toFixed(1))}</div>
      <div class="mapwrap">${mapHTML("rMap")}<div class="busy" id="rBusy" hidden>Computing…</div></div><canvas class="plot" id="rCb"></canvas><div class="kpis" id="rK"></div>`; },
    draw() { const r = rDefaults();
      bindSeg("rV", v => { r.view = v; paintRTP(); }); bindSeg("rS", v => { r.stretch = v; paintRTP(); }); bindChk("rAuto", v => { r.auto = v; paintRTP(); });
      bindSlider("rI", "°", v => { r.I = v; r.auto = false; $("rAuto").checked = false; paintRTP(); }, v => v.toFixed(1)); bindSlider("rD", "°", v => { r.D = v; r.auto = false; $("rAuto").checked = false; paintRTP(); }, v => v.toFixed(1));
      bindSlider("rTp", "km", v => { P().grid.taperKm = v; saveParams(); LAB.grids = {}; paintRTP(); }, v => v.toFixed(1));
      onPaint(paintRTP); } }],
  ideas: [["target", "Why RTP", "Over a vertical field (the magnetic pole) an induced body gives a single high centred on it, like gravity. RTP makes the map easier to read and to compare with gravity."],
    ["wave", "Low latitudes", "Below about 20° inclination the RTP operator amplifies north–south wavelengths without bound. At 37° it is stable."],
    ["scale", "Remanence", "RTP assumes the magnetisation is parallel to today's field. Bodies with strong remanence (e.g. some dykes) are mislocated."]],
  eqs: [EQ("F<sub>RTP</sub>(k) = |k|² / [(i f̂<sub>h</sub>·k + f<sub>z</sub>|k|)(i m̂<sub>h</sub>·k + m<sub>z</sub>|k|)]", "RTP operator, field f and magnetisation m")],
  tries: ["Switch between TMA and RTP: where do the highs move?", "Set the inclination to 20° and look for north–south stripes.", "Look at RTP − TMA: the difference is largest over strong anomalies."],
});
function paintRTP() {
  const cv = $("rMap"); if (!cv || !Lr()) return; const r = rDefaults();
  const go = () => { const T = getGrid("tma"), R = getRTP(), z = r.view === "rtp" ? R.z : r.view === "tma" ? T.z : Float64Array.from(R.z, (v, i) => v - T.z[i]), G = Object.assign({}, T, { z });
    const vals = Array.from(z).filter((v, i) => T.mask[i]), S = stretchFn(vals, r.view === "diff" ? "lin" : r.stretch, r.view === "diff"), pal = r.view === "diff" ? "anom" : r.pal;
    drawMap(cv, { grid: G, S, pal, hill: true, tip: $("rMapt"), name: r.view.toUpperCase(), unit: "nT" }); colorBar($("rCb"), pal, S, "nT");
    const d = rtpDir(), rv = Array.from(R.z).filter((v, i) => T.mask[i]), tv = Array.from(T.z).filter((v, i) => T.mask[i]);
    $("rK").innerHTML = KPI("Inclination / declination", `${fmt(d.I, 1)}° / ${fmt(d.D, 1)}°`, "hl") + KPI("TMA range", `${fmt(Math.min(...tv), 0)} … ${fmt(Math.max(...tv), 0)} <small>nT</small>`) + KPI("RTP range", `${fmt(Math.min(...rv), 0)} … ${fmt(Math.max(...rv), 0)} <small>nT</small>`) + KPIT("Magnetisation", "induced, parallel to the field"); };
  if (hasGrid("tma")) go(); else busy("rBusy", go);
}

/* ---------- 4.3 filters ---------- */
const FILTERS = {
  sep: [["regional", "Regional"], ["residual", "Residual"], ["lowpass", "Low-pass"], ["highpass", "High-pass"], ["bandpass", "Band-pass"], ["polyres", "Poly residual"]],
  edge: [["vd", "1VD"], ["vd2", "2VD"], ["dx", "∂/∂x"], ["dy", "∂/∂y"], ["thg", "THG"], ["as", "Analytic signal"], ["tilt", "Tilt"], ["theta", "Theta"], ["tdx", "TDX"]],
};
const fDefaults = () => LAB.ui.f || (LAB.ui.f = { src: "rtp", type: "tilt", up: 1000, lp: 1000, hp: 5000, ord: 2, dup: 100, kb: 1.0, kmax: 6 });
const km = v => +(v / 1000).toFixed(2);
function srcGrid(src) { return src === "rtp" ? getRTP() : getGrid(src); }
/* the filtered grid of the source (TMA or RTP): {z, name, unit, pal, sym, lim, contours, nt} */
function computeFilter(G, f) {
  const key = (LAB.gkey.tma || "") + (LAB.rtp ? LAB.rtp.key : "") + JSON.stringify(f); if (LAB.fcache && LAB.fcache.key === key) return LAB.fcache.out;
  const gg = { nx: G.nx, ny: G.ny, cell: G.cell, z: G.z }, run = F => Float64Array.from(GL.specFilter(gg, F).out), keep = F => { const r = GL.specFilter(gg, F); return Float64Array.from(r.out, v => v + r.mean); };
  const diff = (a, b) => Float64Array.from(a, (v, i) => v - b[i]), ro = k => 1 / (1 + Math.pow(k * 2.5 * G.cell / (2 * Math.PI), 8)) * (f.dup > 0 ? Math.exp(-k * f.dup) : 1);
  const o = { unit: "nT", pal: "anom", sym: true, nt: true, lim: null, contours: null }; let out;
  switch (f.type) {
    case "regional": out = { z: keep(GL.FILT.up(f.up)), name: `regional (upward ${km(f.up)} km)`, sym: false, pal: "mag" }; break;
    case "residual": out = { z: diff(G.z, keep(GL.FILT.up(f.up))), name: `residual (− upward ${km(f.up)} km)` }; break;
    case "lowpass": out = { z: keep(GL.FILT.lowpass(f.lp)), name: `low-pass (λ > ${km(f.lp)} km)`, sym: false, pal: "mag" }; break;
    case "highpass": out = { z: run(GL.FILT.highpass(f.hp)), name: `high-pass (λ < ${km(f.hp)} km)` }; break;
    case "bandpass": { const a = GL.FILT.lowpass(f.lp), b = GL.FILT.highpass(f.hp); out = { z: run((kx, ky, k, dc) => [a(kx, ky, k, dc)[0] * b(kx, ky, k, dc)[0], 0]), name: `band-pass (${km(f.lp)}–${km(f.hp)} km)` }; break; }
    case "polyres": out = { z: diff(G.z, MOD.polyTrend(G, f.ord)), name: `residual of the order-${f.ord} trend` }; break;
    default: {
      const dx = run((kx, ky, k) => [0, kx * ro(k)]), dy = run((kx, ky, k) => [0, ky * ro(k)]), vd = run((kx, ky, k) => [k * ro(k), 0]), thg = Float64Array.from(dx, (v, i) => Math.hypot(v, dy[i])), D = 180 / Math.PI, n = { nt: false, unit: "nT/km" };
      if (f.type === "vd") out = Object.assign(n, { z: vd.map(v => v * 1000), name: "1st vertical derivative" });
      else if (f.type === "vd2") out = Object.assign(n, { z: run((kx, ky, k) => [k * k * ro(k) * ro(k), 0]).map(v => v * 1e6), name: "2nd vertical derivative", unit: "nT/km²" });
      else if (f.type === "dx") out = Object.assign(n, { z: dx.map(v => v * 1000), name: "∂T/∂x (east)" });
      else if (f.type === "dy") out = Object.assign(n, { z: dy.map(v => v * 1000), name: "∂T/∂y (north)" });
      else if (f.type === "thg") out = Object.assign(n, { z: thg.map(v => v * 1000), name: "total horizontal gradient", pal: "heat", sym: false });
      else if (f.type === "as") out = Object.assign(n, { z: Float64Array.from(vd, (v, i) => 1000 * Math.hypot(v, thg[i])), name: "analytic signal", pal: "heat", sym: false });
      else if (f.type === "tilt") out = Object.assign(n, { z: Float64Array.from(vd, (v, i) => Math.atan2(v, thg[i]) * D), name: "tilt angle", unit: "°", lim: [-90, 90], contours: [0] });
      else if (f.type === "theta") out = Object.assign(n, { z: Float64Array.from(vd, (v, i) => Math.acos(Math.min(1, thg[i] / (Math.hypot(v, thg[i]) || 1))) * D), name: "theta map", unit: "°", pal: "viridis", sym: false, lim: [0, 90] });
      else out = Object.assign(n, { z: Float64Array.from(vd, (v, i) => Math.atan2(thg[i], Math.abs(v)) * D), name: "TDX", unit: "°", pal: "heat", sym: false, lim: [0, 90] });
    }
  }
  out = Object.assign({}, o, out); LAB.fcache = { key, out }; return out;
}
CH.push({ id: "4.3", sec: "maps", short: "Filters and edges", title: "Filters, edges and source depths",
  tag: "Derivatives and their normalised forms outline the edges of magnetic bodies; wavelength filters separate deep from shallow sources; the power spectrum estimates their depths.",
  goal: "outline magnetic bodies, separate deep and shallow sources and estimate depths from the spectrum.",
  figs: [{ title: "Filtered grid", sub: "Applied to the RTP (default) or the TMA grid, in the wavenumber domain. 1VD, 2VD: vertical derivatives; THG: total horizontal gradient; TDX: horizontal over vertical derivative.",
    html: () => { const f = fDefaults();
      return `<div class="row">Input ${segHTML("fSrc", [["rtp", "RTP"], ["tma", "TMA"]], f.src, "Input grid")}</div><div class="row"><span class="hint" style="margin:0">Separation</span>${segHTML("fT1", FILTERS.sep, f.type, "Separation filters")}</div><div class="row"><span class="hint" style="margin:0">Edges</span>${segHTML("fT2", FILTERS.edge, f.type, "Edge filters")}</div>
      <div class="ctrls">${slider("fUp", "Upward continuation", 100, 5000, 100, f.up, "m")}${slider("fLp", "Low-pass: keep λ longer than", 200, 10000, 100, f.lp, "m")}${slider("fHp", "High-pass: keep λ shorter than", 500, 20000, 250, f.hp, "m")}${slider("fOrd", "Polynomial order", 1, 4, 1, f.ord, "")}${slider("fDup", "Smooth derivatives (upward)", 0, 1000, 25, f.dup, "m")}</div>
      <div class="mapwrap">${mapHTML("fMap")}<div class="busy" id="fBusy" hidden>Computing…</div></div><canvas class="plot" id="fCb"></canvas><div class="row"><button class="tbtn" type="button" id="fCsv">Filtered grid (CSV)</button><button class="tbtn go" type="button" data-go="5.1">Take a section of this map →</button><span class="hint" id="fMsg"></span></div><div class="kpis" id="fK"></div>`; },
    draw() { const f = fDefaults(), pick = v => { f.type = v; ["fT1", "fT2"].forEach(id => $(id).querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v))); paintFilter(); };
      bindSeg("fSrc", v => { f.src = v; paintFilter(); paintSpectrum(); }); bindSeg("fT1", pick); bindSeg("fT2", pick);
      bindSlider("fUp", "m", v => { f.up = v; paintFilter(); }); bindSlider("fLp", "m", v => { f.lp = v; paintFilter(); }); bindSlider("fHp", "m", v => { f.hp = v; paintFilter(); }); bindSlider("fOrd", "", v => { f.ord = v; paintFilter(); }); bindSlider("fDup", "m", v => { f.dup = v; paintFilter(); });
      $("fCsv").onclick = () => { const G = srcGrid(f.src), F = computeFilter(G, f); saveFile("wadi_ghadir_mag_filtered_grid.csv", gridCSV(G, F.z, F.name + " of the " + f.src.toUpperCase() + " [" + F.unit + "]"), "text/csv", $("fMsg")); };
      onPaint(paintFilter); } },
    { title: "Radially averaged power spectrum", sub: "ln P(k) of the input grid. Each straight segment of slope s belongs to an ensemble of sources at depth h = −s/2 below the sensor (Spector & Grant 1970).",
      html: () => { const f = fDefaults(); return `<canvas class="plot" id="psCv"></canvas><div class="ctrls">${slider("psKb", "Break wavenumber", 0.2, 6, 0.1, f.kb, "rad/km", v => v.toFixed(1))}${slider("psKm", "Upper end of the shallow fit", 1, 30, 0.5, f.kmax, "rad/km", v => v.toFixed(1))}</div><div class="kpis" id="psK"></div>`; },
      draw() { const f = fDefaults(); bindSlider("psKb", "rad/km", v => { f.kb = v; paintSpectrum(); }, v => v.toFixed(1)); bindSlider("psKm", "rad/km", v => { f.kmax = v; paintSpectrum(); }, v => v.toFixed(1)); onPaint(paintSpectrum); } }],
  ideas: [["target", "Tilt angle", "atan(∂T/∂z ÷ |∇ₕT|) of the RTP: positive over the bodies, zero over their edges, independent of the anomaly strength."],
    ["wave", "Analytic signal", "Its amplitude peaks over the edges whatever the direction of magnetisation: useful where remanence makes the RTP doubtful."],
    ["ruler", "Spectral depth", "Magnetic sources are shallower than most gravity sources: the steep low-wavenumber segment shows the deeper basement, the flat part shallow sources and noise."]],
  eqs: [EQ("θ = atan( T<sub>z</sub> / √(T<sub>x</sub>² + T<sub>y</sub>²) )", "Tilt angle"), EQ("|A| = √(T<sub>x</sub>² + T<sub>y</sub>² + T<sub>z</sub>²)", "Analytic signal"), EQ("ln P(k) ≈ c − 2 h k", "Spectral depth")],
  tries: ["Compare the tilt of the TMA and of the RTP: which outlines the bodies better?", "Smooth the derivatives by 300 m: what disappears?", "Read the depth of the deep segment of the spectrum and compare it with the gravity lab."],
});
function paintFilter() {
  const cv = $("fMap"); if (!cv || !Lr()) return; const f = fDefaults();
  const go = () => { const G = srcGrid(f.src), F = computeFilter(G, f), vals = Array.from(F.z).filter((v, i) => G.mask[i]), S = F.lim ? { lo: F.lim[0], hi: F.lim[1], t: v => (v - F.lim[0]) / (F.lim[1] - F.lim[0]) } : stretchFn(vals, F.nt && !F.sym ? "eq" : "lin", F.sym);
    drawMap(cv, { grid: Object.assign({}, G, { z: F.z }), S, pal: F.pal, contours: F.contours, hill: true, tip: $("fMapt"), name: F.name, unit: F.unit }); colorBar($("fCb"), F.pal, S, F.unit);
    $("fK").innerHTML = KPIT("Input", QN[f.src][0], "hl") + KPIT("Filter", F.name) + KPI("Range", fmt(Math.min(...vals), 1) + " … " + fmt(Math.max(...vals), 1) + ` <small>${F.unit}</small>`); };
  if (hasRTP() || (f.src === "tma" && hasGrid("tma"))) go(); else busy("fBusy", go);
}
function paintSpectrum() {
  const cv = $("psCv"); if (!cv || !Lr()) return; const f = fDefaults(); if (!hasGrid("tma")) { setTimeout(paintSpectrum, 400); return; }
  const G = srcGrid(f.src), key = LAB.gkey.tma + f.src + (LAB.rtp ? LAB.rtp.key : ""); if (!LAB.spec || LAB.spec.key !== key) LAB.spec = { key, sp: MOD.radialSpectrum(f.src === "tma" ? MAG.tapered(G, P().grid.maskKm, P().grid.taperKm) : G) };
  const sp = LAB.spec.sp, kmax = Math.min(f.kmax, sp.k[sp.k.length - 1]), d = MOD.depthFit(sp, sp.k[0], f.kb), s = MOD.depthFit(sp, f.kb, kmax);
  const line = (q, col, nm) => q ? [{ name: nm, x: [q.k0, q.k1], y: [q.icpt + q.slope * q.k0, q.icpt + q.slope * q.k1], color: col, w: 2.4, dash: [6, 4], dec: 2 }] : [];
  plot(cv, { series: [{ name: "ln P", x: sp.k, y: sp.lnP, color: css("--ink"), dots: true, r: 2.4, dec: 2 }].concat(line(d, "#2356C8", "deep fit"), line(s, acc(), "shallow fit")), xlim: [0, Math.min(sp.k[sp.k.length - 1], Math.max(f.kmax * 1.3, 8))], vlines: [{ x: f.kb, color: "#2356C8", label: "break" }], xlabel: "wavenumber k [rad/km]", ylabel: "ln power", xname: "k", xfmt: v => fmt(v, 0), h: 250 });
  $("psK").innerHTML = KPI("Deep sources", d ? fmt(d.depth * 1000, 0) + " <small>m</small>" : "–", "hl") + KPI("Shallow sources", s ? fmt(s.depth * 1000, 0) + " <small>m</small>" : "–") + KPI("Wavelength at the break", fmt(2 * Math.PI / f.kb, 1) + " <small>km</small>");
}

/* ================================================================ MODELLING */
const sDefaults = () => { const s = LAB.ui.s || (LAB.ui.s = { step: 100, corr: 300, field: "rtp", next: "A" }); const E = mapExtent(), inside = p => p && p[0] > E.lat0 && p[0] < E.lat1 && p[1] > E.lon0 && p[1] < E.lon1;
  if (!inside(s.A) || !inside(s.B)) { const D = WGM_DATA.section; if (D && inside(D.A) && inside(D.B)) { s.A = D.A.slice(); s.B = D.B.slice(); } else { const fx = (E.lon1 - E.lon0) * 0.2, fy = (E.lat1 - E.lat0) * 0.2; s.A = [E.lat0 + fy, E.lon0 + fx]; s.B = [E.lat1 - fy, E.lon1 - fx]; } } return s; };
function sectionField() { const s = sDefaults(); if (s.field === "filter") { const f = fDefaults(), G = srcGrid(f.src); return Object.assign({ G }, computeFilter(G, f)); }
  const G = s.field === "rtp" ? getRTP() : getGrid(s.field); return { G, z: G.z, name: QN[s.field][0], unit: "nT", nt: true, pal: "mag", sym: false }; }
function sampleGrid(G, z, x, y) { const fx = (x - G.x0) / G.cell, fy = (y - G.y0) / G.cell, c = Math.floor(fx), r = Math.floor(fy); if (c < 0 || r < 0 || c >= G.nx - 1 || r >= G.ny - 1) return NaN; const i = r * G.nx + c; if (!G.mask[i] || !G.mask[i + 1] || !G.mask[i + G.nx] || !G.mask[i + G.nx + 1]) return NaN; const a = fx - c, b = fy - r; return z[i] * (1 - a) * (1 - b) + z[i + 1] * a * (1 - b) + z[i + G.nx] * (1 - a) * b + z[i + G.nx + 1] * a * b; }
function sectionData() {
  const s = sDefaults(), F = sectionField(), G = F.G, [xa, ya] = G.local.fwd(s.A[0], s.A[1]), [xb, yb] = G.local.fwd(s.B[0], s.B[1]), L = Math.hypot(xb - xa, yb - ya), ux = (xb - xa) / L, uy = (yb - ya) / L;
  const key = [LAB.gkey.tma, LAB.gkey.tmi, LAB.rtp && LAB.rtp.key, LAB.fcache && LAB.fcache.key, s.field, s.A, s.B, s.step, s.corr].join("|"); if (LAB.sec && LAB.sec.key === key) return LAB.sec;
  const x = [], v = [], lat = [], lon = [], elev = [];
  for (let t = 0; t <= L + 1e-6; t += s.step) { const px = xa + ux * t, py = ya + uy * t, [la, lo] = G.local.inv(px, py); x.push(t); v.push(sampleGrid(G, F.z, px, py)); lat.push(la); lon.push(lo); }
  const st = []; for (const r of okR()) { const [px, py] = G.local.fwd(r.lat, r.lon), t = (px - xa) * ux + (py - ya) * uy, d = -(px - xa) * uy + (py - ya) * ux; if (t >= 0 && t <= L && Math.abs(d) <= s.corr) st.push({ t, d, v: s.field === "tmi" ? r.tmi : r.tma, elev: r.elev }); }
  LAB.sec = { key, L, x, v, lat, lon, st, name: F.name, unit: F.unit, nt: F.nt, az: (Math.atan2(ux, uy) * 180 / Math.PI + 360) % 360 }; return LAB.sec;
}
function modelData() {
  const S = sectionData(), ok = S.x.map((_, i) => i).filter(i => isF(S.v[i]));
  if (ok.length < 6) return { S, err: "The section has fewer than 6 points with data: move A and B into the survey area (chapter 5.1)." };
  if (!S.nt) return { S, err: `The section shows ${S.name} [${S.unit}]. Modelling needs a field in nT: choose TMA, a separation filter or the field of 5.1.` };
  const fld = S.name.startsWith("Reduced") ? { F: Lr().F, I: 90, D: 0 } : { F: Lr().F, I: Lr().inc, D: Lr().dec };
  return { S, x: ok.map(i => S.x[i]), d: MOD.centred(ok.map(i => S.v[i])), key: S.key, fld, rtp: S.name.startsWith("Reduced") };
}
function drawSection(cv, o) {
  const { ctx, W, H } = setup(cv, o.h || 300), pad = { l: 58, r: 12, t: 10, b: 38 }, [x0, x1] = o.xlim, zmax = o.zmax;
  const X = x => pad.l + (x - x0) / (x1 - x0) * (W - pad.l - pad.r), Z = z => pad.t + z / zmax * (H - pad.t - pad.b), inv = (px, py) => [x0 + (px - pad.l) / (W - pad.l - pad.r) * (x1 - x0), (py - pad.t) / (H - pad.t - pad.b) * zmax];
  ctx.fillStyle = css("--paper2"); ctx.fillRect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b); ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b); ctx.clip();
  if (o.cells) { const c = o.cells; for (let iz = 0; iz < c.ze.length - 1; iz++) for (let ix = 0; ix < c.xe.length - 1; ix++) { const v = c.m[iz * (c.xe.length - 1) + ix]; if (!isF(v)) continue; ctx.fillStyle = lutCol(c.pal || "anom", c.pos ? v / c.lim : (v + c.lim) / (2 * c.lim)); const xa = X(c.xe[ix]), xb = X(c.xe[ix + 1]), za = Z(c.ze[iz]), zb = Z(c.ze[iz + 1]); ctx.fillRect(xa, za, xb - xa + 0.6, zb - za + 0.6); } }
  (o.bodies || []).forEach((b, k) => { ctx.beginPath(); b.xy.forEach(([x, z], i) => { if (i) ctx.lineTo(X(x), Z(z)); else ctx.moveTo(X(x), Z(z)); }); ctx.closePath();
    if (!o.outline) { ctx.fillStyle = b.mr > 0 ? "rgba(138,91,214,.45)" : b.chi >= 0 ? "rgba(214,72,52,.42)" : "rgba(43,110,214,.42)"; ctx.fill(); }
    ctx.strokeStyle = k === o.sel ? css("--ink") : "rgba(20,25,30,.7)"; ctx.lineWidth = k === o.sel ? 2.2 : 1.2; ctx.setLineDash(o.outline ? [5, 3] : []); ctx.stroke(); ctx.setLineDash([]);
    if (o.handles) b.xy.forEach(([x, z]) => { ctx.beginPath(); ctx.arc(X(x), Z(z), k === o.sel ? 5.5 : 3.5, 0, 6.283); ctx.fillStyle = k === o.sel ? acc() : css("--paper"); ctx.fill(); ctx.strokeStyle = css("--ink"); ctx.lineWidth = 1.2; ctx.stroke(); });
    if (!o.outline) { const cx = b.xy.reduce((a, p) => a + p[0], 0) / b.xy.length, cz = b.xy.reduce((a, p) => a + p[1], 0) / b.xy.length; ctx.fillStyle = css("--ink"); ctx.font = "700 12px " + css("--disp"); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("χ " + fmt(b.chi, 3) + (b.mr > 0 ? " · Mr " + fmt(b.mr, 1) : ""), X(cx), Z(cz)); } });
  ctx.restore(); ctx.strokeStyle = css("--ink"); ctx.lineWidth = 1; ctx.strokeRect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b);
  ctx.fillStyle = css("--muted"); ctx.font = "500 12px " + css("--disp"); const tx = nice(x0 / 1000, x1 / 1000, W < 480 ? 4 : 7), tz = nice(0, zmax / 1000, 4);
  ctx.textAlign = "center"; ctx.textBaseline = "top"; tx.ticks.forEach(v => { const px = X(v * 1000); if (px < pad.l - 1 || px > W - pad.r + 1) return; ctx.fillRect(px, H - pad.b, 1, 4); ctx.fillText(String(+v.toFixed(3)), px, H - pad.b + 6); });
  ctx.fillText("distance from A [km]", pad.l + (W - pad.l - pad.r) / 2, H - 15); ctx.textAlign = "right"; ctx.textBaseline = "middle"; tz.ticks.forEach(v => { const py = Z(v * 1000); if (py > H - pad.b + 1) return; ctx.fillRect(pad.l - 4, py, 4, 1); ctx.fillText(String(+v.toFixed(3)), pad.l - 6, py); });
  ctx.save(); ctx.translate(13, pad.t + (H - pad.t - pad.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText("depth [km]", 0, 0); ctx.restore();
  if (o.label) { ctx.fillStyle = "rgba(255,255,255,.86)"; ctx.font = "700 12px " + css("--disp"); const tw = ctx.measureText(o.label).width; ctx.fillRect(pad.l + 6, H - pad.b - 24, tw + 12, 18); ctx.fillStyle = "#111"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(o.label, pad.l + 12, H - pad.b - 15); }
  return { X, Z, inv };
}
const secXlim = S => [-0.03 * S.L, 1.03 * S.L];
function drawLineOverlay(ov, T, S, s, at) {
  const { ctx } = setup(ov, ov.parentNode.querySelector("canvas.plot").clientHeight); if (!T || !S) return;
  const pA = [T.X(s.A[1]), T.Y(s.A[0])], pB = [T.X(s.B[1]), T.Y(s.B[0])], len = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]) || 1, w = s.corr * len / S.L, nx = -(pB[1] - pA[1]) / len, ny = (pB[0] - pA[0]) / len;
  ctx.fillStyle = "rgba(255,210,63,.2)"; ctx.beginPath(); ctx.moveTo(pA[0] + nx * w, pA[1] + ny * w); ctx.lineTo(pB[0] + nx * w, pB[1] + ny * w); ctx.lineTo(pB[0] - nx * w, pB[1] - ny * w); ctx.lineTo(pA[0] - nx * w, pA[1] - ny * w); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#111"; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(...pA); ctx.lineTo(...pB); ctx.stroke(); ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 2.2; ctx.stroke();
  [["A", pA], ["B", pB]].forEach(([t, p]) => { ctx.beginPath(); ctx.arc(p[0], p[1], 10, 0, 6.283); ctx.fillStyle = "#111"; ctx.fill(); ctx.fillStyle = "#ffd23f"; ctx.font = "800 12px " + css("--disp"); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, p[0], p[1] + 0.5); });
  if (isF(at)) { const f = at / S.L, p = [pA[0] + (pB[0] - pA[0]) * f, pA[1] + (pB[1] - pA[1]) * f]; ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, 6.283); ctx.fillStyle = acc(); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); }
}
function needGrid(fn, id) { if (hasGrid("tma") && hasRTP()) fn(); else busy(id, () => { getRTP(); fn(); }); }

/* ---------- 5.1 cross-section ---------- */
CH.push({ id: "5.1", sec: "model", short: "Cross-section", title: "A cross-section through the anomaly",
  tag: "Draw a line across the map and read the anomaly along it, with the readings close to the line. The section feeds the magnetic forward model and the inversion.",
  goal: "place a section across a magnetic anomaly and extract its profile.",
  figs: [{ title: "Section line", sub: "Click the map to set A, click again to set B. The yellow band is the corridor from which readings are projected onto the section.",
    html: () => { const s = sDefaults(); return `<div class="row">Field ${segHTML("sF", [["tma", "TMA"], ["rtp", "RTP"], ["tmi", "TMI"], ["filter", "Filter of 4.3"]], s.field, "Field")}<button class="tbtn" type="button" id="sSwap">Swap A and B</button><button class="tbtn" type="button" id="sDef">Default line</button><span class="hint" id="sNext" style="margin:0"></span></div>
      <div class="mapwrap">${mapHTML("sMap", '<canvas class="mapov" id="sOv" aria-hidden="true"></canvas>')}<div class="busy" id="sBusy" hidden>Computing the grids…</div></div><canvas class="plot" id="sCb"></canvas>
      <div class="ctrls">${slider("sStep", "Point spacing", 25, 500, 25, s.step, "m")}${slider("sCorr", "Reading corridor (±)", 25, 2000, 25, s.corr, "m")}</div>`; },
    draw() { const s = sDefaults();
      bindSeg("sF", v => { s.field = v; paintSection(); }); bindSlider("sStep", "m", v => { s.step = v; paintSection(); }); bindSlider("sCorr", "m", v => { s.corr = v; paintSection(); });
      $("sSwap").onclick = () => { [s.A, s.B] = [s.B, s.A]; paintSection(); }; $("sDef").onclick = () => { s.A = s.B = null; s.next = "A"; paintSection(); };
      $("sMap").onclick = e => { if (!LAB.secT) return; const r = $("sMap").getBoundingClientRect(), [la, lo] = LAB.secT.inv(e.clientX - r.left, e.clientY - r.top), E = mapExtent(); if (la < E.lat0 || la > E.lat1 || lo < E.lon0 || lo > E.lon1) return;
        if (s.next === "A") { s.A = [la, lo]; s.next = "B"; } else { s.B = [la, lo]; s.next = "A"; } if (Math.hypot(s.A[0] - s.B[0], s.A[1] - s.B[1]) < 1e-3) return; paintSection(); };
      onPaint(paintSection); } },
    { title: "Profile A–B", sub: "The field along the section and the readings in the corridor (TMA and TMI). Move the pointer along the profile to find the point on the map.",
      html: () => `<canvas class="plot" id="sPr"></canvas><div class="row"><button class="tbtn" type="button" id="sCsv">Profile (CSV)</button><button class="tbtn go" type="button" data-go="5.2">Model this section →</button><span class="hint" id="sMsg"></span></div><div class="kpis" id="sK"></div>`,
      draw() { $("sCsv").onclick = () => { const S = LAB.sec; if (S) saveFile("wadi_ghadir_mag_section.csv", [`# Wadi Ghadir Magnetic Lab, written by ${AUTHOR}. Section A–B; field: ${S.name} [${S.unit}].`, "distance_m,lat,lon,field"].concat(S.x.map((x, i) => [x.toFixed(1), S.lat[i].toFixed(7), S.lon[i].toFixed(7), isF(S.v[i]) ? S.v[i].toFixed(2) : ""].join(","))).join("\n"), "text/csv", $("sMsg")); }; } }],
  ideas: [["ruler", "Across the strike", "Draw the section across the elongation of the anomaly: the 2-D models assume bodies infinitely long across the section."],
    ["target", "TMA or RTP", "Model the TMA with the true field direction, or the RTP with a vertical field. Both must give the same bodies."],
    ["map", "Corridor", "Readings within the corridor are projected onto the line; where the line leaves the tracks, the profile is interpolated."]],
  tries: ["Draw a section across the strongest anomaly in the north-east.", "Compare the TMA and RTP profiles: where does the low move?"],
});
function paintSection() {
  const cv = $("sMap"); if (!cv || !Lr()) return;
  needGrid(() => { const s = sDefaults(), F = sectionField(), G = F.G, S = sectionData(), vals = Array.from(F.z).filter((v, i) => G.mask[i]), Sx = F.lim ? { lo: F.lim[0], hi: F.lim[1], t: v => (v - F.lim[0]) / (F.lim[1] - F.lim[0]) } : stretchFn(vals, F.nt ? "eq" : "lin", F.sym);
    LAB.secT = drawMap(cv, { grid: Object.assign({}, G, { z: F.z }), S: Sx, pal: F.pal, contours: F.contours, hill: true, tip: $("sMapt"), name: F.name, unit: F.unit });
    drawLineOverlay($("sOv"), LAB.secT, S, s); colorBar($("sCb"), F.pal, Sx, F.unit); $("sNext").textContent = "Next click sets " + s.next + ".";
    const xk = S.x.map(v => v / 1000), hov = x => drawLineOverlay($("sOv"), LAB.secT, S, s, x === null ? NaN : x * 1000);
    const ser = [{ name: F.name, x: xk, y: S.v, color: acc(), w: 2.4, unit: F.unit, dec: 1 }];
    if ((s.field === "tma" || s.field === "tmi") && S.st.length) ser.push({ name: "readings", x: S.st.map(q => q.t / 1000), y: S.st.map(q => q.v), color: "rgba(20,25,30,.45)", dots: true, r: 1.8, unit: "nT", dec: 1 });
    plot($("sPr"), { series: ser, xlim: [0, S.L / 1000], ylabel: F.unit, xlabel: "distance from A [km]", xname: "km", xfmt: v => fmt(v, 1), h: 250, onHover: hov, snap: 0.3 });
    $("sK").innerHTML = KPI("Length", fmt(S.L / 1000, 2) + " <small>km</small>", "hl") + KPI("Azimuth A→B", fmt(S.az, 0) + "°") + KPI("Points with data", S.v.filter(isF).length + " / " + S.x.length) + KPI("Readings in the corridor", S.st.length) + KPIT("Field", esc(S.name)); }, "sBusy");
}

/* ---------- 5.2 forward model ---------- */
function fmDefaults(S) {
  const m = LAB.ui.fm || (LAB.ui.fm = { sel: 0, zmax: 3000, sensor: 1.5 });
  if (!m.bodies || m.forL !== Math.round(S.L)) {   // a starting body below the largest anomaly, susceptibility fitted
    const D = modelData(); let c = S.L / 2; if (!D.err) { let k = 0; D.d.forEach((v, i) => { if (Math.abs(v) > Math.abs(D.d[k])) k = i; }); c = D.x[k]; }
    m.bodies = [{ chi: 0.02, mr: 0, ir: 36.7, dr: 4, xy: [[c - 500, 150], [c + 500, 150], [c + 500, 900], [c - 500, 900]] }]; m.forL = Math.round(S.L); m.sel = 0;
    if (!D.err) try { m.bodies[0].chi = +MAG.fitChi(D.x, D.d, m.bodies, D.fld, S.az, m.sensor)[0].toFixed(4); } catch (e) { /* keep the default */ } }
  return m;
}
CH.push({ id: "5.2", sec: "model", short: "Forward model", title: "Forward modelling with 2-D magnetic polygons",
  tag: "Build a susceptibility model of the section from polygons and compare its total-field anomaly with the data. Bodies are magnetised by the IGRF field (induced) and, if you like, carry a remanent magnetisation.",
  goal: "test a geological hypothesis: shape, depth and susceptibility of the magnetic bodies.",
  figs: [{ title: "Data and model response", sub: "Total-field anomaly along the section; data and response are compared without their means.", html: () => `<canvas class="plot" id="mPr"></canvas><div class="kpis" id="mK"></div>`, draw() { onPaint(paintForward); } },
    { title: "Magnetic model", sub: "Drag a vertex to reshape a body, drag inside a body to move it. Double-click an edge to add a vertex, double-click a vertex to remove it.",
      html: () => { const m = LAB.ui.fm || { zmax: 3000, sensor: 1.5 };
        return `<div class="row" id="mSelRow"></div><canvas class="plot" id="mSec" style="touch-action:none;cursor:grab"></canvas>
        <div class="ctrls">${slider("mChi", "Susceptibility χ of the body", -0.05, 0.15, 0.001, 0.02, "SI", v => v.toFixed(3))}${slider("mMr", "Remanent magnetisation Mr", 0, 10, 0.1, 0, "A/m", v => v.toFixed(1))}${slider("mIr", "Remanence inclination", -90, 90, 1, 37, "°")}${slider("mDr", "Remanence declination", -180, 180, 1, 4, "°")}${slider("mZ", "Depth of the section", 500, 8000, 250, m.zmax, "m")}</div>
        <div class="row"><button class="tbtn go" type="button" id="mFit">Fit the susceptibilities</button><button class="tbtn" type="button" id="mAdd">Add a body</button><button class="tbtn" type="button" id="mDel">Delete the body</button><button class="tbtn" type="button" id="mReset">Start again</button><button class="tbtn" type="button" id="mCsv">Model (CSV)</button><span class="hint" id="mMsg"></span></div>`; },
      draw() { const cur = () => { const m = LAB.ui.fm; return m && m.bodies[m.sel]; };
        bindSlider("mChi", "SI", v => { const b = cur(); if (b) { b.chi = v; paintForward(); } }, v => v.toFixed(3)); bindSlider("mMr", "A/m", v => { const b = cur(); if (b) { b.mr = v; paintForward(); } }, v => v.toFixed(1));
        bindSlider("mIr", "°", v => { const b = cur(); if (b) { b.ir = v; paintForward(); } }); bindSlider("mDr", "°", v => { const b = cur(); if (b) { b.dr = v; paintForward(); } });
        bindSlider("mZ", "m", v => { LAB.ui.fm.zmax = v; paintForward(); });
        $("mFit").onclick = () => { const D = modelData(), m = LAB.ui.fm; if (D.err || !m.bodies.length) return; try { const r = MAG.fitChi(D.x, D.d, m.bodies, D.fld, D.S.az, m.sensor); m.bodies.forEach((b, k) => { b.chi = +r[k].toFixed(4); }); $("mMsg").textContent = "Susceptibilities fitted by least squares (remanence kept)."; } catch (e) { $("mMsg").textContent = "The bodies cannot be fitted separately."; } paintForward(); };
        $("mAdd").onclick = () => { const m = LAB.ui.fm, S = LAB.sec; if (!S) return; const c = S.L * (0.3 + 0.4 * Math.random()), w = S.L * 0.04, z = m.zmax * 0.08; m.bodies.push({ chi: 0.01, mr: 0, ir: 37, dr: 4, xy: [[c - w, z], [c + w, z], [c + w, 4 * z], [c - w, 4 * z]] }); m.sel = m.bodies.length - 1; paintForward(); };
        $("mDel").onclick = () => { const m = LAB.ui.fm; if (!m.bodies.length) return; m.bodies.splice(m.sel, 1); m.sel = Math.max(0, m.sel - 1); paintForward(); };
        $("mReset").onclick = () => { LAB.ui.fm.bodies = null; paintForward(); };
        $("mCsv").onclick = () => { const m = LAB.ui.fm; if (m) saveFile("wadi_ghadir_mag_forward_model.csv", [`# Wadi Ghadir Magnetic Lab, written by ${AUTHOR}. 2-D bodies along the section: distance from A [m], depth [m], susceptibility [SI], remanence [A/m, °].`, "body,vertex,distance_m,depth_m,chi_SI,mr_Am,ir_deg,dr_deg"].concat(m.bodies.flatMap((b, k) => b.xy.map((p, i) => [k + 1, i + 1, p[0].toFixed(1), p[1].toFixed(1), b.chi, b.mr, b.ir, b.dr].join(",")))).join("\n"), "text/csv", $("mMsg")); };
        bindSectionDrag(); } }],
  ideas: [["cube", "Induced and remanent", "M = χF/μ₀ + M<sub>r</sub>. With χ = 0.01 SI in a 42 000 nT field the induced magnetisation is 0.33 A/m. Basalts and dykes can carry remanence many times larger."],
    ["target", "Dipolar shape", "With the field inclined 37° the anomaly of a body is a high on one side and a low on the other; its shape depends on the direction of the section."],
    ["scale", "Depth from the gradient", "Shallow bodies give sharp anomalies, deep bodies broad ones: the width of the anomaly is about twice the depth to the top."]],
  eqs: [EQ("B = (μ₀ / 4πGρ) (M·∇) g", "Poisson's relation (2-D polygon via Talwani)"), EQ("ΔT ≈ B · F̂", "Total-field anomaly")],
  tries: ["Make the body twice as deep: how wide and how strong is the anomaly now?", "Give the body a reversed remanence (inclination −37°, declination 184°) and watch the anomaly flip.", "Add a second body and press Fit."],
});
function paintForward() {
  const pr = $("mPr"); if (!pr || !Lr()) return;
  needGrid(() => { const D = modelData();
    if (D.err) { plot(pr, { series: [], xlim: [0, 1], h: 140 }); $("mK").innerHTML = KPIT("Section", esc(D.err), "bad"); return; }
    const S = D.S, m = fmDefaults(S), resp = MOD.centred(MAG.forward(D.x, m.bodies, D.fld, S.az, m.sensor)), xk = D.x.map(v => v / 1000);
    plot(pr, { series: [{ name: "data", x: xk, y: D.d, color: css("--ink"), dots: true, r: 2.2, unit: "nT", dec: 1 }, { name: "model", x: xk, y: resp, color: acc(), w: 2.6, unit: "nT", dec: 1 }, { name: "residual", x: xk, y: D.d.map((v, i) => v - resp[i]), color: "#7f8a93", w: 1.2, dash: [4, 3], unit: "nT", dec: 1 }],
      xlim: secXlim(S).map(v => v / 1000), ylabel: "nT", xlabel: "", xname: "km", xfmt: v => fmt(v, 1), h: 220, hlines: [{ y: 0 }] });
    const sec = $("mSec"); if (sec) LAB.fmT = drawSection(sec, { xlim: secXlim(S), zmax: m.zmax, bodies: m.bodies, sel: m.sel, handles: true, h: Math.min(360, Math.max(240, sec.clientWidth * 0.42)) });
    const row = $("mSelRow"); if (row) { row.innerHTML = m.bodies.length ? "Body " + segHTML("mSel", m.bodies.map((b, k) => [k, `${k + 1}: χ ${fmt(b.chi, 3)}`]), m.sel, "Selected body") : '<span class="hint">No bodies: press Add a body.</span>'; bindSeg("mSel", v => { m.sel = +v; paintForward(); }); }
    const b = m.bodies[m.sel]; if (b && $("mChi")) [["mChi", b.chi, "SI", v => v.toFixed(3)], ["mMr", b.mr || 0, "A/m", v => v.toFixed(1)], ["mIr", b.ir, "°", v => String(Math.round(v))], ["mDr", b.dr, "°", v => String(Math.round(v))]].forEach(([id, v, u, f]) => { $(id).value = v; $(id + "o").textContent = f(+v) + " " + u; });
    const r = MOD.rms(resp, D.d), r0 = MOD.rms(D.d.map(() => 0), D.d);
    $("mK").innerHTML = KPI("rms misfit", nT(r, 1), r < 0.3 * r0 ? "ok" : "hl") + KPI("Data rms", nT(r0, 1)) + KPI("Explained", fmt(100 * (1 - (r * r) / (r0 * r0 || 1)), 0) + " <small>%</small>") + KPI("Field", D.rtp ? "vertical (RTP)" : `I ${fmt(D.fld.I, 1)}°, D ${fmt(D.fld.D, 1)}°`) + KPI("Section azimuth", fmt(S.az, 0) + "°"); }, "mBusyNone");
}
function bindSectionDrag() {
  const cv = $("mSec"); if (!cv) return; let drag = null, raf = 0;
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const near = (px, py) => { const T = LAB.fmT, m = LAB.ui.fm; if (!T || !m) return null; let best = null, bd = 169; m.bodies.forEach((b, k) => b.xy.forEach(([x, z], i) => { const d = (T.X(x) - px) ** 2 + (T.Z(z) - py) ** 2 - (k === m.sel ? 20 : 0); if (d < bd) { bd = d; best = { k, i }; } })); return best; };
  const inside = (b, x, z) => { let c = false; for (let i = 0, j = b.xy.length - 1; i < b.xy.length; j = i++) { const [xi, zi] = b.xy[i], [xj, zj] = b.xy[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const clampZ = z => Math.max(0, Math.min(LAB.ui.fm.zmax, z));
  cv.onpointerdown = e => { const [px, py] = pos(e), m = LAB.ui.fm, T = LAB.fmT; if (!m || !T) return; const v = near(px, py);
    if (v) { m.sel = v.k; drag = { type: "v", k: v.k, i: v.i }; } else { const [x, z] = T.inv(px, py), k = m.bodies.findIndex(b => inside(b, x, z)); if (k < 0) return; m.sel = k; drag = { type: "b", k, x, z }; }
    cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; paintForward(); };
  cv.onpointermove = e => { if (!drag) return; const [px, py] = pos(e), T = LAB.fmT, b = LAB.ui.fm.bodies[drag.k]; if (!T || !b) return; const [x, z] = T.inv(px, py);
    if (drag.type === "v") b.xy[drag.i] = [x, clampZ(z)]; else { let dz = z - drag.z; const zs = b.xy.map(p => p[1]); dz = Math.max(-Math.min(...zs), Math.min(LAB.ui.fm.zmax - Math.max(...zs), dz)); b.xy = b.xy.map(([a, c]) => [a + x - drag.x, c + dz]); drag.x = x; drag.z += dz; }
    cancelAnimationFrame(raf); raf = requestAnimationFrame(paintForward); };
  cv.onpointerup = cv.onpointercancel = () => { drag = null; cv.style.cursor = "grab"; };
  cv.ondblclick = e => { const [px, py] = pos(e), m = LAB.ui.fm, T = LAB.fmT; if (!m || !T) return; const v = near(px, py);
    if (v) { const b = m.bodies[v.k]; if (b.xy.length > 3) b.xy.splice(v.i, 1); m.sel = v.k; paintForward(); return; }
    const b = m.bodies[m.sel]; if (!b) return; let best = -1, bd = 196, at = null;
    b.xy.forEach((p, i) => { const q = b.xy[(i + 1) % b.xy.length], ax = T.X(p[0]), az = T.Z(p[1]), bx = T.X(q[0]), bz = T.Z(q[1]), L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1, t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - az) * (bz - az)) / L2)), d = (ax + t * (bx - ax) - px) ** 2 + (az + t * (bz - az) - py) ** 2; if (d < bd) { bd = d; best = i; at = T.inv(px, py); } });
    if (best >= 0) { b.xy.splice(best + 1, 0, [at[0], clampZ(at[1])]); paintForward(); } };
}

/* ---------- 5.3 inversion ---------- */
const ivDefaults = () => LAB.ui.iv || (LAB.ui.iv = { cw: 150, zmax: 3000, nz: 20, sigma: 10, beta: 1, z0: 250, ls: 0, lam: "auto", pos: true, bodies: true });
CH.push({ id: "5.3", sec: "model", short: "Inversion", title: "Inversion: a susceptibility section from the data",
  tag: "The section is divided into cells and the susceptibility of every cell is found by regularised least squares, weighted with depth, optionally with χ ≥ 0.",
  goal: "invert the section for susceptibility and see what the data can and cannot resolve.",
  figs: [{ title: "Data fit and L-curve", sub: "λ balances data fit against model size. Auto picks the λ for which the misfit equals the data error (χ²/N = 1).",
    html: () => `<canvas class="plot" id="iPr"></canvas><div class="row"><span class="hint" style="margin:0">λ</span>${segHTML("iAuto", [["auto", "Auto (χ²/N = 1)"], ["man", "Manual"]], ivDefaults().lam === "auto" ? "auto" : "man", "Lambda mode")}</div><div class="ctrls">${slider("iLam", "log₁₀ λ (relative)", -9, 3, 0.1, ivDefaults().lam === "auto" ? -3 : ivDefaults().lam, "", v => v.toFixed(1))}</div><canvas class="plot" id="iLc"></canvas><div class="kpis" id="iK"></div>`,
    draw() { const v = ivDefaults(); bindSeg("iAuto", x => { v.lam = x === "auto" ? "auto" : +$("iLam").value; paintInversion(); }); bindSlider("iLam", "", x => { v.lam = x; $("iAuto").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === "man")); paintInversion(); }, x => x.toFixed(1)); onPaint(paintInversion); } },
    { title: "Susceptibility section", sub: "Susceptibility of the cells (SI). Dashed: the bodies of the forward model of 5.2. The mesh extends beyond A and B by padding cells.",
      html: () => { const v = ivDefaults(); return `<div class="mapwrap"><canvas class="plot" id="iSec"></canvas><div class="busy" id="iBusy" hidden>Computing the sensitivities…</div></div><canvas class="plot" id="iCb"></canvas>
        <div class="ctrls">${slider("iSig", "Data error σ", 1, 100, 1, v.sigma, "nT")}${slider("iBeta", "Depth weighting β", 0, 4, 0.1, v.beta, "", x => x.toFixed(1))}${slider("iZ0", "Depth weighting z₀", 50, 2000, 50, v.z0, "m")}${slider("iLs", "Smoothness length", 0, 2000, 50, v.ls, "m")}${slider("iCw", "Cell width", 50, 1000, 25, v.cw, "m")}${slider("iZm", "Depth of the mesh", 500, 8000, 250, v.zmax, "m")}</div>
        <div class="row">${chk("iPos", "χ ≥ 0 (active set, slower)", v.pos)}${chk("iBod", "Show the forward-model bodies", v.bodies)}<button class="tbtn" type="button" id="iCsv">Model (CSV)</button><span class="hint" id="iMsg"></span></div>`; },
      draw() { const v = ivDefaults(), re = () => { LAB.invP = null; paintInversion(); };
        bindSlider("iSig", "nT", x => { v.sigma = x; re(); }); bindSlider("iBeta", "", x => { v.beta = x; re(); }, x => x.toFixed(1)); bindSlider("iZ0", "m", x => { v.z0 = x; re(); }); bindSlider("iLs", "m", x => { v.ls = x; re(); }); bindSlider("iCw", "m", x => { v.cw = x; re(); }); bindSlider("iZm", "m", x => { v.zmax = x; re(); });
        bindChk("iPos", x => { v.pos = x; LAB.invR = null; paintInversion(); }); bindChk("iBod", x => { v.bodies = x; paintInversion(); });
        $("iCsv").onclick = () => { const I = LAB.invR; if (!I) return; const M = I.M, out = [`# Wadi Ghadir Magnetic Lab, written by ${AUTHOR}. 2-D susceptibility inversion of the section; χ²/N ${I.s.chi2n.toFixed(2)}.`, "distance_m,depth_m,chi_SI"];
          for (let iz = 0; iz < M.nz; iz++) for (let ix = 0; ix < M.nx; ix++) out.push([((M.xe[ix] + M.xe[ix + 1]) / 2).toFixed(1), ((M.ze[iz] + M.ze[iz + 1]) / 2).toFixed(1), I.s.m[iz * M.nx + ix].toExponential(4)].join(","));
          saveFile("wadi_ghadir_mag_inversion_model.csv", out.join("\n"), "text/csv", $("iMsg")); }; } }],
  ideas: [["grid", "Linear in χ", "With induced magnetisation the anomaly is linear in the susceptibility of each cell: the same machinery as the gravity inversion, with magnetic kernels."],
    ["mountain", "Depth weighting", "Magnetic kernels decay faster than gravity ones (1/r² in 2-D): without weighting, all susceptibility sits at the surface. β between 1 and 2 balances them; the depth resolution of magnetic data stays poor."],
    ["check", "Positivity", "Most rocks have χ ≥ 0. With the constraint, cells that want negative values are fixed at zero and the rest re-fitted, which sharpens the bodies."]],
  eqs: [EQ("Φ = Σ((Gχ − d)/σ)² + λ‖W R χ‖²", "Objective function"), EQ("w(z) = (1 + z/z₀)<sup>−β/2</sup>", "Depth weighting")],
  tries: ["Switch the positivity off: where do negative susceptibilities appear?", "Set β to 0 and then to 3: where does the susceptibility go?", "Invert the RTP section and compare it with the TMA section."],
  notes: [NOTE("key", "SimPEG", "<p>Notebook 05 inverts the gridded TMA in 3-D with pyGIMLi and SimPEG; chapter 5.4 shows both.</p>")],
});
function paintInversion() {
  const pr = $("iPr"); if (!pr || !Lr()) return;
  needGrid(() => { const D = modelData(); if (D.err) { plot(pr, { series: [], xlim: [0, 1], h: 140 }); $("iK").innerHTML = KPIT("Section", esc(D.err), "bad"); return; }
    const v = ivDefaults(), key = [D.key, v.cw, v.zmax, v.nz, v.sigma, v.beta, v.z0, v.ls].join("|");
    if (!LAB.invP || LAB.invP.key !== key) { const b = $("iBusy"); if (b) b.hidden = false;
      clearTimeout(LAB.invT); LAB.invT = setTimeout(() => { try { const t = Date.now(), M = MOD.mesh(D.S.L, { cw: v.cw, zmax: v.zmax, nz: v.nz }), G = MAG.sensitivity(D.x, M, D.fld, D.S.az, 1.5); LAB.invP = { key, M, G, D, ms: Date.now() - t, P: MOD.prepare(D.x, D.d, M, Object.assign({}, v, { G })) }; LAB.invR = null; }
        catch (e) { console.error(e); LAB.invP = null; $("iK").innerHTML = KPIT("Inversion failed", esc(e.message), "bad"); } if (b) b.hidden = true; if (LAB.invP) paintInversion(); }, 30); return; }
    const I = LAB.invP, M = I.M, rel0 = v.lam === "auto" ? null : Math.pow(10, v.lam);
    let P0 = I.P, s, nfix = 0;
    const rk = key + "|" + v.lam + "|" + v.pos;
    if (LAB.invR && LAB.invR.key === rk) s = LAB.invR.s;
    else { const rel = rel0 || MOD.autoLambda(P0); s = MOD.solve(P0, rel, true);
      if (v.pos) { const fixed = new Uint8Array(M.nc); for (let it = 0; it < 6; it++) { let add = 0; s.m.forEach((q, j) => { if (q < 0 && !fixed[j]) { fixed[j] = 1; add++; } }); if (!add) break;
          const G2 = Float64Array.from(I.G); for (let i = 0; i < D.x.length; i++) for (let j = 0; j < M.nc; j++) if (fixed[j]) G2[i * M.nc + j] = 0;
          P0 = MOD.prepare(D.x, D.d, M, Object.assign({}, v, { G: G2 })); s = MOD.solve(P0, rel0 || MOD.autoLambda(P0), true); s.m = s.m.map((q, j) => fixed[j] ? 0 : q); }
        nfix = 0; s.m.forEach(q => { if (q <= 0) nfix++; }); s.m = s.m.map(q => Math.max(0, q)); }
      LAB.invR = { key: rk, s, M, P: P0, nfix }; }
    if (v.lam === "auto" && $("iLam")) { $("iLam").value = Math.log10(s.rel).toFixed(1); $("iLamo").textContent = Math.log10(s.rel).toFixed(1) + " "; }
    const xk = D.x.map(x => x / 1000);
    plot(pr, { series: [{ name: "data", x: xk, y: D.d, color: css("--ink"), dots: true, r: 2.2, unit: "nT", dec: 1 }, { name: "inversion", x: xk, y: s.pred, color: acc(), w: 2.6, unit: "nT", dec: 1 }], xlim: secXlim(D.S).map(x => x / 1000), ylabel: "nT", xlabel: "distance from A [km]", xname: "km", xfmt: x => fmt(x, 1), h: 210 });
    const lc = MOD.lcurve(LAB.invR.P, Array.from({ length: 25 }, (_, i) => Math.pow(10, -9 + i * 0.5))).filter(q => q.chi2n > 1e-3), lx = q => 0.5 * Math.log10(q.phim + 1e-30);
    plot($("iLc"), { series: [{ name: "L-curve", x: lc.map(lx), y: lc.map(q => Math.log10(q.chi2n)), color: "#7f8a93", w: 1.6, dec: 2 }], markers: [{ x: lx(s), y: Math.log10(Math.max(1e-3, s.chi2n)), color: acc(), r: 6, label: "λ" }], hlines: [{ y: 0, label: "χ²/N = 1" }],
      xlim: [Math.min(...lc.map(lx)) - 0.1, Math.max(...lc.map(lx)) + 0.1], xlabel: "log₁₀ ‖W R χ‖ (model size)", ylabel: "log₁₀ χ²/N", xname: "log size", xfmt: x => fmt(x, 1), h: 200, nohover: true });
    const mv = Array.from(s.m), sorted = mv.map(Math.abs).sort((a, b) => a - b), lim = Math.max(1e-5, pctl(sorted, 0.99)), sec = $("iSec");
    if (sec) drawSection(sec, { xlim: secXlim(D.S), zmax: v.zmax, cells: { xe: M.xe, ze: M.ze, m: mv, lim, pos: v.pos, pal: v.pos ? "mag" : "anom" }, bodies: v.bodies && LAB.ui.fm ? LAB.ui.fm.bodies : [], outline: true, h: Math.min(380, Math.max(240, sec.clientWidth * 0.42)) });
    colorBar($("iCb"), v.pos ? "mag" : "anom", v.pos ? { lo: 0, hi: lim, t: q => q / lim } : { lo: -lim, hi: lim, t: q => (q + lim) / (2 * lim) }, "χ [SI]", 3);
    $("iK").innerHTML = KPI("χ²/N", fmt(s.chi2n, 2), Math.abs(s.chi2n - 1) < 0.2 ? "ok" : "hl") + KPI("rms misfit", nT(MOD.rms(s.pred, D.d), 1)) + KPI("λ (relative)", s.rel.toExponential(1)) + KPI("χ", `${Math.min(...mv).toFixed(4)} … ${Math.max(...mv).toFixed(4)} <small>SI</small>`) + KPI("Cells × data", `${M.nc} × ${D.x.length}`) + (v.pos ? KPI("Cells at zero", LAB.invR.nfix) : "") + KPI("Field", D.rtp ? "vertical (RTP)" : `I ${fmt(D.fld.I, 0)}°`); }, "iBusy");
}

/* ---------- 5.4 pyGIMLi and SimPEG ---------- */
const PYM = WGM_DATA.model || null;
const edgesOf = c => { const e = [c[0] - (c[1] - c[0]) / 2]; for (let i = 0; i < c.length - 1; i++) e.push((c[i] + c[i + 1]) / 2); e.push(c[c.length - 1] + (c[c.length - 1] - c[c.length - 2]) / 2); return e; };
CH.push({ id: "5.4", sec: "model", short: "pyGIMLi and SimPEG", title: "The anomaly in 3-D with pyGIMLi and SimPEG",
  tag: "Notebook 05 models the strongest anomaly of the survey in 3-D: a best-fitting magnetic block and a depth-weighted inversion with pyGIMLi, and a bounded susceptibility inversion with SimPEG. Their results along the section A–B are embedded here.",
  goal: "compare a single-block hypothesis with two 3-D inversions of the same anomaly.",
  figs: [{ title: "Data and responses along A–B", sub: "TMA of the 8 km modelling window minus its median and a plane, along the north–south section through the anomaly.",
    html: () => PYM ? `<canvas class="plot" id="pPr"></canvas><div class="kpis" id="pK"></div><div class="row"><button class="tbtn go" type="button" id="pUse">Use this section in 5.1–5.3</button><span class="hint" id="pMsg"></span></div>` : `<p class="hint">The pyGIMLi and SimPEG results were not available when this lab was built. Run notebook 05 and rebuild the lab.</p>`,
    draw() { if (!PYM) return; const xk = PYM.x.map(v => v / 1000), S = PYM.summary;
      plot($("pPr"), { series: [{ name: "data", x: xk, y: PYM.data, color: css("--ink"), dots: true, r: 2.4, unit: "nT", dec: 0 }, { name: "pyGIMLi block", x: xk, y: PYM.fwd, color: "#8a5bd6", w: 1.6, dash: [6, 4], unit: "nT", dec: 0 }, { name: "pyGIMLi 3-D", x: xk, y: PYM.pg, color: acc(), w: 2.4, unit: "nT", dec: 0 }, { name: "SimPEG 3-D", x: xk, y: PYM.sp, color: "#1baf7a", w: 2.2, dash: [3, 2], unit: "nT", dec: 0 }],
        xlim: [0, PYM.L / 1000], ylabel: "nT", xlabel: "distance from A [km] (south → north)", xname: "km", xfmt: v => fmt(v, 1), h: 240 });
      $("pK").innerHTML = KPI("Block χ", fmt(S.block.chi_SI, 3) + " <small>SI</small>", "hl") + KPI("Block rms", nT(S.block.rms_nT)) + KPI("pyGIMLi rms", nT(S.pygimli.rms_nT, 1)) + KPI("pyGIMLi χ²", fmt(S.pygimli.chi2, 2)) + KPI("SimPEG rms", nT(S.simpeg.rms_nT, 1)) + KPI("SimPEG cells", S.simpeg.cells.toLocaleString("en-US")) + KPI("Data", S.window.data);
      $("pUse").onclick = () => { const s = sDefaults(); s.A = PYM.A.slice(); s.B = PYM.B.slice(); s.field = "tma"; LAB.ui.fm = null; LAB.sec = null; $("pMsg").textContent = "Section and field set: open 5.1–5.3."; }; } },
    { title: "Susceptibility sections", sub: "Top: pyGIMLi 3-D inversion (smallest model, depth-weighted, λ from the discrepancy principle); bottom: SimPEG 3-D inversion with χ ≥ 0. Both cut along A–B, same colour scale; dashed: the best-fitting block.",
      html: () => PYM ? `<canvas class="plot" id="pPg"></canvas><canvas class="plot" id="pSp"></canvas><canvas class="plot" id="pCb"></canvas>` : "",
      draw() { if (!PYM) return; const all = PYM.pgm.v.flat().concat(PYM.spm.v.flat()).filter(isF).map(Math.abs).sort((a, b) => a - b), lim = Math.max(1e-4, pctl(all, 0.99)), B = PYM.block;
        const body = [{ chi: B.chi, xy: [[B.x0, B.z0], [B.x1, B.z0], [B.x1, B.z1], [B.x0, B.z1]] }], h = cv => Math.min(320, Math.max(200, cv.clientWidth * 0.36));
        [["pPg", PYM.pgm, "pyGIMLi 3-D"], ["pSp", PYM.spm, "SimPEG 3-D, χ ≥ 0"]].forEach(([id, g, lab]) => drawSection($(id), { xlim: [0, PYM.L], zmax: 2500, cells: { xe: edgesOf(g.x), ze: edgesOf(g.z), m: g.v.flat(), lim }, bodies: body, outline: true, label: lab, h: h($(id)) }));
        colorBar($("pCb"), "anom", { lo: -lim, hi: lim, t: q => (q + lim) / (2 * lim) }, "χ [SI]", 3); } },
    { title: "The code", sub: "The essential calls of notebook 05 (open it for every step, with editable parameters).",
      html: () => `<pre class="code" style="white-space:pre;overflow-x:auto;font-size:12.5px"># pyGIMLi: 3-D magnetics on a hexahedral mesh (Holstein 2007 kernels)
mesh3 = pg.createGrid(x_edges, y_edges, -z_edges[::-1])
fop3 = MagneticsModelling(mesh3, xyz, cmp=["TFA"], igrf=[X_north, Y_east, Z_down])
inv = pg.Inversion(fop=fop3)
inv.setRegularization(cType=0, trans="lin")
inv.modelTrans = pg.trans.Trans(); inv.dataTrans = pg.trans.Trans()
inv.setConstraintWeights(depthWeighting(mesh3, z0=200, power=1.5, cell=True))
chi = inv.run(d_obs, absoluteError=15.0, lam=lam, startModel=0.0)

# SimPEG: 3-D susceptibility inversion with χ ≥ 0
src = magnetics.sources.UniformBackgroundField(receiver_list=[rx], amplitude=F, inclination=I, declination=D)
sim = magnetics.simulation.Simulation3DIntegral(survey=magnetics.survey.Survey(src), mesh=mesh_sp,
                                                chiMap=maps.IdentityMap(nP=n), engine="choclo")
opt = optimization.ProjectedGNCG(maxIter=15, lower=0.0, upper=1.0)
dirs = [directives.UpdateSensitivityWeights(), directives.BetaEstimate_ByEig(beta0_ratio=10),
        directives.BetaSchedule(coolingFactor=5, coolingRate=1), directives.TargetMisfit(chifact=1)]
chi3d = inversion.BaseInversion(inverse_problem.BaseInvProblem(dmis, reg, opt), directiveList=dirs).run(m0)</pre>`,
      draw() {} }],
  ideas: [["cube", "One block", "The best single block (searched over position, size and depth) explains about half of the anomaly: the source is more complex than one prism."],
    ["layers", "Two inversions", "pyGIMLi (smallest model, χ may be negative) and SimPEG (bounded, χ ≥ 0, sensitivity-weighted) both put susceptible rock (about 0.2 SI) at 0.5–1.5 km below the anomaly."],
    ["scale", "χ = 0.2 SI", "A susceptibility of this size points to magnetite-rich rock, such as mafic or ultramafic intrusions or banded iron ore: a target for a check in the field."]],
  notes: [NOTE("key", "Files", "<p><code>outputs/modelling_magnetic/</code>: section_profile.csv, pygimli_section_model.csv, simpeg_section_model.csv, simpeg_3d_model.npz, summary.json and section_models.png.</p>")],
});

/* ---------- 6.1 validation ---------- */
CH.push({ id: "6.1", sec: "out", short: "Check against Python", title: "Check against the Python processing chain",
  tag: "This lab is a port of the wghadir magnetic chain. For the Wadi Ghadir data with the default parameters, both must reject the same readings and give the same anomalies.",
  goal: "verify that the browser chain reproduces the delivered magnetic products.",
  figs: [{ title: "Readings: browser against Python", sub: "Total-field anomaly (TMA) of every 4th reading; rejected readings compared one by one.", html: () => `<canvas class="plot" id="vCv"></canvas><div class="kpis" id="vK"></div>`, draw() { onPaint(paintValid); } },
    { title: "Grids: browser against Python", sub: "TMA and RTP grids of the lab sampled at the nodes of the Python grids (50 m, UTM 36N). Small differences come from the grid cell and the block layout.",
      html: () => `<div class="mapwrap"><canvas class="plot" id="vG"></canvas><div class="busy" id="vBusy" hidden>Computing the grids…</div></div><div class="kpis" id="vGK"></div>`, draw() { onPaint(paintValidGrid); } }],
  ideas: [["check", "Same chain", "Day segments, Hampel despike and IGRF-14 follow the Python code; the IGRF is evaluated here in JavaScript and agrees with ppigrf to better than 0.1 nT."],
    ["grid", "Same gridding", "Block median, linear trend and the Verde biharmonic spline with the same damping; the reduction to the pole uses the same operator and taper."]],
});
function paintValid() {
  const cv = $("vCv"); if (!cv || !Lr()) return; const py = LAB.input.python;
  if (!py) { plot(cv, { series: [], xlim: [0, 1], h: 140 }); $("vK").innerHTML = KPIT("Not available", "The comparison needs the Wadi Ghadir example data."); return; }
  const byRow = new Map(Lr().d.map(r => [r.row, r])), x = [], y = []; py.rows.forEach((row, i) => { const r = byRow.get(row); if (r && isF(r.tma) && isF(py.tma[i])) { x.push(py.tma[i]); y.push(r.tma - py.tma[i]); } });
  plot(cv, { series: [{ name: "reading", x, y, color: acc(), dots: true, r: 1.8, unit: "nT", dec: 3 }], xlim: [Math.min(...x) - 20, Math.max(...x) + 20], xlabel: "Python TMA [nT]", ylabel: "browser − Python [nT]", xname: "TMA", xfmt: v => fmt(v, 0), h: 240, hlines: [{ y: 0 }] });
  const spJS = new Set(Lr().d.filter(r => r.spike).map(r => r.row)), spPy = new Set(py.spikes), both = [...spJS].filter(r => spPy.has(r)).length, a = y.map(Math.abs).sort((p, q) => p - q);
  $("vK").innerHTML = KPI("Readings compared", x.length.toLocaleString("en-US")) + KPI("Median |ΔTMA|", nT(a[a.length >> 1], 3), "ok") + KPI("Largest |ΔTMA|", nT(a[a.length - 1], 3)) + KPI("Spikes: lab / Python / both", `${spJS.size} / ${spPy.size} / ${both}`, spJS.size === spPy.size && both === spPy.size ? "ok" : "bad");
}
function paintValidGrid() {
  const cv = $("vG"); if (!cv || !Lr()) return; const py = LAB.input.python; if (!py) { plot(cv, { series: [], xlim: [0, 1], h: 140 }); return; }
  needGrid(() => { const T = getGrid("tma"), R = getRTP(), L = T.local, at = (G, la, lo) => { const [x, y] = L.fwd(la, lo); return sampleGrid(G, G.z, x, y); };
    const a = [], b = [], c = [], d = []; py.grid.forEach(([lo, la, tma, rtp]) => { const u = at(T, la, lo), w = at(R, la, lo); if (isF(u)) { a.push(tma); b.push(u); } if (isF(w)) { c.push(rtp); d.push(w); } });
    const cr = (p, q) => GL.corr(p, q), rms = (p, q) => Math.sqrt(p.reduce((s, v, i) => s + (q[i] - v) ** 2, 0) / p.length);
    plot(cv, { series: [{ name: "TMA", x: a, y: b, color: acc(), dots: true, r: 1.6, unit: "nT", dec: 0 }, { name: "RTP", x: c, y: d, color: "#2356C8", dots: true, r: 1.6, unit: "nT", dec: 0 }], xlim: [Math.min(...a, ...c), Math.max(...a, ...c)], xlabel: "Python grid [nT]", ylabel: "lab grid [nT]", xname: "Python", xfmt: v => fmt(v, 0), h: 300 });
    $("vGK").innerHTML = KPI("TMA correlation", fmt(cr(a, b), 3), "ok") + KPI("TMA rms difference", nT(rms(a, b), 0)) + KPI("RTP correlation", fmt(cr(c, d), 3), "ok") + KPI("RTP rms difference", nT(rms(c, d), 0)) + KPI("Nodes", a.length.toLocaleString("en-US")); }, "vBusy");
}

/* ---------- 6.2 export ---------- */
CH.push({ id: "6.2", sec: "out", short: "Export and parameters", title: "Export the results and the parameters",
  tag: "Take the readings with their flags, the grids, the map and your parameter set with you. A parameter set pasted back here reproduces the run.",
  goal: "save the results of your run and the settings that produced them.",
  figs: [
    { title: "Results", sub: "Each button offers a file to save.",
      html: () => `<div class="row"><button class="tbtn go" type="button" id="xR">Readings with QC, IGRF and TMA (CSV)</button><button class="tbtn" type="button" id="xT">TMI grid (CSV)</button><button class="tbtn" type="button" id="xA">TMA grid (CSV)</button><button class="tbtn" type="button" id="xP">RTP grid (CSV)</button><button class="tbtn" type="button" id="xD">Day summary (CSV)</button><button class="tbtn" type="button" id="xPng">RTP map (PNG)</button><button class="tbtn" type="button" id="xHtml">This lab (HTML)</button></div><p class="hint" id="xMsg"></p><div class="busy" id="xBusy" hidden>Computing…</div><img id="xImg" alt="Exported map" hidden style="width:100%;border-radius:12px;margin-top:8px">`,
      draw() { const m = $("xMsg");
        $("xR").onclick = () => saveFile("wadi_ghadir_mag_readings.csv", readingsCSV(), "text/csv", m); $("xD").onclick = () => saveFile("wadi_ghadir_mag_days.csv", daysCSV(), "text/csv", m);
        $("xT").onclick = () => busy("xBusy", () => { const G = getGrid("tmi"); saveFile("wadi_ghadir_tmi_grid.csv", gridCSV(G, G.z, "total magnetic intensity [nT]"), "text/csv", m); });
        $("xA").onclick = () => busy("xBusy", () => { const G = getGrid("tma"); saveFile("wadi_ghadir_tma_grid.csv", gridCSV(G, G.z, "total-field anomaly TMI − IGRF [nT]"), "text/csv", m); });
        $("xP").onclick = () => busy("xBusy", () => { const G = getRTP(); saveFile("wadi_ghadir_rtp_grid.csv", gridCSV(G, G.z, "reduced-to-pole anomaly [nT]"), "text/csv", m); });
        $("xPng").onclick = () => busy("xBusy", exportPng); $("xHtml").onclick = () => saveFile("Wadi_Ghadir_Magnetic_Lab.html", PAGE_HTML, "text/html", m); } },
    { title: "Parameter set", sub: "All processing parameters of this run (JSON). Edit or paste a set and press Apply.",
      html: () => `<textarea class="code" id="pJ" spellcheck="false" aria-label="Parameters as JSON"></textarea><div class="row"><button class="tbtn go" type="button" id="pA">Apply</button><button class="tbtn" type="button" id="pC">Copy</button><button class="tbtn" type="button" id="pD">Restore the defaults</button><span class="hint" id="pM"></span></div>`,
      draw() { $("pJ").value = JSON.stringify(Object.assign({ written_by: AUTHOR }, P()), null, 1);
        $("pA").onclick = () => { try { const j = JSON.parse($("pJ").value); delete j.written_by; LAB.P = MAG.mergeParams(j); changed(); $("pM").textContent = "Applied."; } catch (e) { $("pM").textContent = "This is not valid JSON: " + e.message; } };
        $("pC").onclick = () => copyText($("pJ").value, $("pM")); $("pD").onclick = () => { LAB.P = MAG.mergeParams({}); $("pJ").value = JSON.stringify(P(), null, 1); changed(); $("pM").textContent = "Defaults restored."; }; } },
    { title: "Software and sources", sub: "",
      html: () => `<ul class="refs"><li>Processing chain: <i>wghadir</i> Python package (this project), <code>MagneticChain</code>, ported to JavaScript for this lab; notebook 02 runs it step by step, notebook 05 models the anomaly in 3-D with pyGIMLi and SimPEG.</li><li>Physics core and page design: <i>Static Gravity Lab</i> and <i>Wadi Ghadir Gravity Lab</i> by Mohamed Sobh, LIAG.</li><li>Alken, P. et al. (2021). International Geomagnetic Reference Field: the thirteenth generation; IGRF-14 coefficients (IAGA Working Group V-MOD, 2024).</li><li>Pearson, R. K. et al. (2016). Generalized Hampel filters. <i>EURASIP J. Adv. Signal Process.</i></li><li>Uieda, L. et al. (2018). Verde: processing and gridding spatial data using Green's functions. <i>JOSS</i> 3.</li><li>Baranov, V. (1957). A new method for interpretation of aeromagnetic maps: pseudo-gravimetric anomalies. <i>Geophysics</i> 22.</li><li>Talwani, M. &amp; Heirtzler, J. R. (1964). Computation of magnetic anomalies caused by two-dimensional bodies. Blakely, R. J. (1995). <i>Potential Theory in Gravity and Magnetic Applications.</i></li><li>Miller, H. G. &amp; Singh, V. (1994). Potential field tilt. <i>J. Appl. Geophys.</i> 32. Spector, A. &amp; Grant, F. S. (1970). <i>Geophysics</i> 35. Li, Y. &amp; Oldenburg, D. W. (1996). 3-D inversion of magnetic data. <i>Geophysics</i> 61.</li><li>Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA.</li></ul>`,
      draw() {} }],
  ideas: [["check", "Reproducible", "The parameter set and the input file fully define a run. Keep them with the results."], ["layers", "Columns", "The readings table holds every row with its day, flags, Hampel statistics, IGRF field and direction, and the anomaly."]],
});
function readingsCSV() { return [`# Wadi Ghadir Magnetic Lab, written by ${AUTHOR}. Data: ${LAB.input.name}. IGRF-14 for ${P().date}.`, "row,day,time,lat,lon,elev_m,reading_nT,tmi_nT,diurnal_nT,hampel_median_nT,hampel_dev_nT,accepted,flags,igrf_F_nT,igrf_inc_deg,igrf_dec_deg,tma_nT"]
  .concat(Lr().d.map(r => [r.row, r.day, hms(r.t), fmt(r.lat, 7), fmt(r.lon, 7), fmt(r.elev, 2), fmt(r.reading, 2), fmt(r.tmi, 2), fmt(r.diurnal, 2), fmt(r.hmed, 2), fmt(r.hdev, 2), r.ok ? 1 : 0, r.flags.join(";"), fmt(r.F, 2), fmt(r.inc, 4), fmt(r.dec, 4), fmt(r.tma, 2)].join(",").replace(/–/g, ""))).join("\n"); }
function daysCSV() { return [`# Wadi Ghadir Magnetic Lab, written by ${AUTHOR}.`, "day,date,readings,accepted,spikes,first,last,diurnal_min_nT,diurnal_max_nT,tmi_median_nT,tmi_min_nT,tmi_max_nT"].concat(Lr().days.map(d => [d.day, d.date, d.n, d.nOk, d.spikes, hms(d.t0), hms(d.t1), fmt(d.diMin, 1), fmt(d.diMax, 1), fmt(d.tmiMed, 1), fmt(d.tmiMin, 1), fmt(d.tmiMax, 1)].join(","))).join("\n"); }
function gridCSV(G, z, label) { const out = [`# Wadi Ghadir Magnetic Lab, written by ${AUTHOR}. Grid of ${label}, cell ${G.cell} m.`, "lon,lat,x_local_m,y_local_m,value"];
  for (let r = 0; r < G.ny; r++) for (let c = 0; c < G.nx; c++) { const i = r * G.nx + c; if (!G.mask[i]) continue; const x = G.x0 + c * G.cell, y = G.y0 + r * G.cell, [la, lo] = G.local.inv(x, y); out.push([lo.toFixed(6), la.toFixed(6), x.toFixed(1), y.toFixed(1), z[i].toFixed(2)].join(",")); } return out.join("\n"); }
function copyText(text, msgEl) { const done = ok => { if (msgEl) msgEl.textContent = ok ? "Copied to the clipboard." : "Copy was blocked here."; }; try { navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); } catch (e) { done(false); } }
let DL = null;
if (window.claude && window.claude.use) window.claude.use("downloads").then(d => { DL = d; }, () => { DL = null; });
function saveFile(name, data, type, msgEl) {
  const msg = msgEl || $("xMsg") || $("heroMsg") || { set textContent(v) { /* no message area */ } };
  if (DL) { DL.save({ filename: name, data }).then(() => { msg.textContent = name + " saved."; }, e => { msg.textContent = e && e.code === "declined" ? "Saving was cancelled." : "This view cannot save files."; }); return; }
  if (window.claude) { msg.textContent = "Saving files is not available in this view."; return; }
  try { const a = document.createElement("a"); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); msg.textContent = name + " saved."; } catch (e) { msg.textContent = "Download is blocked here."; }
}
function exportPng() {
  const holder = document.createElement("div"); holder.style.cssText = "position:absolute;left:-9999px;width:1400px"; const c2 = document.createElement("canvas"); c2.className = "plot"; holder.appendChild(c2); document.body.appendChild(holder);
  const G = getRTP(), vals = Array.from(G.z).filter((v, i) => G.mask[i]), S = stretchFn(vals, "eq");
  drawMap(c2, { grid: G, S, pal: "mag", hill: true });
  { const cx = c2.getContext("2d"), dpr = Math.min(2, window.devicePixelRatio || 1); cx.save(); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.font = "600 12px " + css("--disp"); cx.fillStyle = css("--muted"); cx.textAlign = "right"; cx.textBaseline = "bottom"; cx.fillText("Wadi Ghadir Magnetic Lab · RTP anomaly · written by " + AUTHOR, c2.width / dpr - 12, c2.height / dpr - 2); cx.restore(); }
  const img = $("xImg"); img.src = c2.toDataURL("image/png"); img.hidden = false;
  c2.toBlob(blob => { holder.remove(); if (blob) saveFile("wadi_ghadir_rtp_map.png", blob, "image/png"); }, "image/png");
}

/* ================================================================ hero animation */
function heroBg(dpr) {   // field lines of a dipole
  const bg = $("heroBg"), r = bg.getBoundingClientRect(); bg.width = r.width * dpr; bg.height = r.height * dpr; const c = bg.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, r.width, r.height);
  const cx = r.width * 0.78, cy = r.height * 0.95; c.lineWidth = 1;
  for (let i = 1; i <= 16; i++) { const Rr = i * i * 9 + 40; c.strokeStyle = "rgba(232,144,95," + (0.15 - i * 0.007) + ")"; c.beginPath();
    for (let t = 0.02; t <= Math.PI - 0.02; t += 0.02) { const rr = Rr * Math.sin(t) ** 2, x = cx + rr * Math.sin(t) * Math.cos(0.64) - rr * Math.cos(t) * Math.sin(0.64), y = cy - rr * Math.sin(t) * Math.sin(0.64) - rr * Math.cos(t) * Math.cos(0.64); if (t < 0.03) c.moveTo(x, y); else c.lineTo(x, y); }
    c.stroke(); }
}
function heroSize() { const cv = $("heroCv"); if (!cv) return; const W = cv.clientWidth || 600, E = mapExtent(), k = Math.cos((E.lat0 + E.lat1) / 2 * Math.PI / 180), H = Math.round(W * (E.lat1 - E.lat0) / ((E.lon1 - E.lon0) * k)), dpr = Math.min(2, window.devicePixelRatio || 1); cv.style.height = H + "px"; cv.width = W * dpr; cv.height = H * dpr; Object.assign(HERO, { W, H, dpr }); heroBg(dpr); HERO.pts = null; }
function heroInit() { heroSize(); if ("IntersectionObserver" in window) new IntersectionObserver(es => { HERO.vis = es[0].isIntersecting; }).observe($("heroCv")); document.addEventListener("visibilitychange", () => { HERO.vis = !document.hidden; }); requestAnimationFrame(heroFrame); }
function heroFrame(now) {
  requestAnimationFrame(heroFrame); if (!HERO.vis || !HERO.W || !Lr()) return;
  const { W, H, dpr } = HERO, ctx = $("heroCv").getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches, E = mapExtent(), X = lon => (lon - E.lon0) / (E.lon1 - E.lon0) * W, Y = lat => (E.lat1 - lat) / (E.lat1 - E.lat0) * H;
  if (!HERO.pts || HERO.n !== okR().length) { const ok = thin(okR(), 6000), S = stretchFn(ok.map(r => r.tma), "eq"); HERO.pts = ok.map(r => ({ x: X(r.lon), y: Y(r.lat), c: lutCol("mag", S.t(r.tma)), day: r.day })); HERO.n = okR().length; HERO.nd = Lr().nDays; HERO.S = S; }
  ctx.fillStyle = "#0A141A"; ctx.fillRect(0, 0, W, H);
  const img = hillImage(); if (img && LAB.input.hill) { const h = LAB.input.hill; ctx.globalAlpha = 0.5; ctx.drawImage(img, X(h.lon0), Y(h.lat1), X(h.lon1) - X(h.lon0), Y(h.lat0) - Y(h.lat1)); ctx.globalAlpha = 1; }
  const cyc = 13, ph = reduce ? 1 : ((now - HERO.t0) / 1000 % cyc) / (cyc - 2.5), n = Math.floor(Math.min(1, ph) * HERO.pts.length);
  for (let i = 0; i < n; i++) { const p = HERO.pts[i]; ctx.fillStyle = p.c; ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4); }
  if (n > 0 && n < HERO.pts.length && !reduce) { const p = HERO.pts[n - 1]; ctx.fillStyle = "rgba(255,230,190,.8)"; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 6.283); ctx.fill(); }
  const day = n ? HERO.pts[Math.max(0, n - 1)].day : 1; ctx.fillStyle = "rgba(10,20,26,.72)"; ctx.fillRect(10, 10, 178, 44);
  ctx.fillStyle = "#E8EFF3"; ctx.font = "700 15px " + css("--disp"); ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(`Survey day ${day} of ${HERO.nd}`, 18, 16);
  ctx.fillStyle = "#F0A57B"; ctx.font = "600 12px " + css("--mono"); ctx.fillText(Math.round(n / HERO.pts.length * okR().length).toLocaleString("en-US") + " readings · TMA", 18, 36);
  const bw = Math.min(160, W * 0.32); for (let i = 0; i < bw; i++) { ctx.fillStyle = lutCol("mag", i / bw); ctx.fillRect(W - bw - 14 + i, H - 22, 1.2, 8); }
  ctx.fillStyle = "#E8EFF3"; ctx.font = "600 11px " + css("--disp"); ctx.textAlign = "left"; ctx.fillText(fmt(HERO.S.lo, 0), W - bw - 14, H - 12); ctx.textAlign = "right"; ctx.fillText(fmt(HERO.S.hi, 0) + " nT", W - 14, H - 12);
}

/* ================================================================ start */
function themeToggle() {
  const root = document.documentElement, b = $("themeBtn"), cur = () => root.dataset.theme || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const label = () => { b.textContent = cur() === "dark" ? "Light theme" : "Dark theme"; };
  try { const t = localStorage.getItem("wg-lab-theme"); if (t) root.dataset.theme = t; } catch (e) { /* storage unavailable */ }
  label(); b.onclick = () => { root.dataset.theme = cur() === "dark" ? "light" : "dark"; try { localStorage.setItem("wg-lab-theme", root.dataset.theme); } catch (e) { /* storage unavailable */ } label(); APPI.redraw(); };
}
CH.forEach(c => { const d0 = c.figs[0].draw; c.figs[0].draw = function () { LAB.paint = []; d0.call(this); }; });
compute(); updateBadge();
const app = makeApp({ chapters: CH, store: "wadi-ghadir-mag-lab", heroInit, heroSize,
  sections: [["start", "The survey", "globe"], ["data", "Data", "layers"], ["qc", "Corrections and QC", "filter"], ["maps", "Maps", "map"], ["model", "Modelling", "cube"], ["out", "Results", "check"]] });
themeToggle();
document.getElementById("heroSave").addEventListener("click", () => saveFile("Wadi_Ghadir_Magnetic_Lab.html", PAGE_HTML, "text/html"));
document.getElementById("heroOwn").addEventListener("click", () => setTimeout(() => { const f = $("fMag"); if (f) f.focus(); }, 600));
app.init();
})();
