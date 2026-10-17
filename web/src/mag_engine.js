/* ===== WG magnetic engine: the Wadi Ghadir ground-magnetic chain in the browser (no DOM) =====
   A JavaScript port of the wghadir magnetic chain: load, day segments, Hampel despike, IGRF-14,
   QC statistics (days, crossovers, IGRF date sensitivity), gridding, reduction to the pole,
   plus 2-D magnetic polygon modelling.
   Written by Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics), Hannover. */
const MAG = (function () {
"use strict";
const D2R = Math.PI / 180, isF = Number.isFinite;
const GLb = typeof GL !== "undefined" ? GL : global.GL, ENGb = typeof ENG !== "undefined" ? ENG : global.ENG;

/* ---------- default parameters (the values of the delivered Wadi Ghadir products) ---------- */
const DEFAULTS = {
  date: "2026-01-20",                                   // ASSUMED: the file has times but no dates
  despike: { window: 11, k: 6.0, floor: 30.0, on: true },
  day: { gapMin: 30 },                                  // a time step back by more than this starts a new day
  xover: { maxM: 5.0 },
  grid: { cell: 100, block: 100, maskKm: 2.0, taperKm: 3.0, damp: -6, mindist: 25 },
};
const clone = o => JSON.parse(JSON.stringify(o));
function mergeParams(P) { const out = clone(DEFAULTS); for (const k in (P || {})) out[k] = typeof out[k] === "object" && out[k] !== null ? Object.assign(out[k], P[k]) : P[k]; return out; }
const median = a => { const s = a.filter(isF).sort((x, y) => x - y), n = s.length; return !n ? NaN : n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };

/* ---------- 1  reading the data ---------- */
/* column aliases of a magnetic readings table (CSV or the first sheet of a workbook) */
const ALIAS = {
  lat: ["lat", "latitude", "y_lat", "lat_deg"], lon: ["lon", "long", "longitude", "lng", "lon_deg"],
  elev: ["e", "elev", "elevation", "alt", "altitude", "h", "height", "z"],
  reading: ["reading", "raw", "tmi_raw", "field_raw", "total_field_raw"],
  time: ["time", "hhmmss", "time_hhmmss", "utc"], date: ["date", "day"],
  tmi: ["corrected data", "corrected", "tmi", "tmi_corr", "tmi_corr_nt", "total intensity", "total_field", "field", "nt", "mag", "corrected data (total intensity)"],
  line: ["line", "profile"],
};
const norm = s => String(s).toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9_ ]/g, "").trim();
function findCol(head, key) {
  const h = head.map(norm);
  for (const a of ALIAS[key]) { const i = h.indexOf(a); if (i >= 0) return i; }
  for (const a of ALIAS[key]) { const i = h.findIndex(x => x.startsWith(a)); if (i >= 0 && a.length > 2) return i; }
  return -1;
}
/* hhmmss as number (114913), "11:49:13", Excel day fraction (0.4925) or a date-time string -> seconds of the day */
function timeSec(v) {
  if (v === null || v === undefined || v === "") return NaN;
  if (typeof v === "number") { if (v > 0 && v < 1) return Math.round(v * 86400); const t = Math.round(v); return Math.floor(t / 10000) * 3600 + Math.floor(t / 100) % 100 * 60 + t % 100; }
  const m = String(v).match(/(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/); if (m) return +m[1] * 3600 + +m[2] * 60 + (+m[3] || 0);
  const n = +v; return isF(n) ? timeSec(n) : NaN;
}
function dateStr(v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);  // Excel serial
  const s = String(v).trim(); let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return s;
}
/* rows of cells (first row = header) -> readings; the Wadi Ghadir workbook layout is recognised by position */
function fromTable(table, name) {
  const head = table[0].map(String), body = table.slice(1);
  const col = {}; for (const k in ALIAS) col[k] = findCol(head, k);
  // the supplied workbook: lat, long, x, y, E, Reading, Time, Corrected data (Total Intensity)
  if (col.tmi < 0 && head.length >= 8 && norm(head[7]).startsWith("corrected")) col.tmi = 7;
  if (col.lat < 0 || col.lon < 0 || col.tmi < 0) throw new Error(`${name}: needs columns lat, lon and the total field (found: ${head.join(", ")})`);
  const num = v => (v === null || v === undefined || v === "" ? NaN : +v);
  return body.map((r, i) => ({ row: i + 2, lat: num(r[col.lat]), lon: num(r[col.lon]), elev: col.elev >= 0 ? num(r[col.elev]) : NaN,
    reading: col.reading >= 0 ? num(r[col.reading]) : NaN, t: col.time >= 0 ? timeSec(r[col.time]) : NaN, date: col.date >= 0 ? dateStr(r[col.date]) : "",
    tmi: num(r[col.tmi]), line: col.line >= 0 ? String(r[col.line] ?? "") : "" }));
}
function parseCSVTable(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.startsWith("#")); if (!lines.length) return [[]];
  const d = [",", ";", "\t"].map(c => [c, lines[0].split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  return lines.map(l => l.split(d).map(s => { const v = s.trim().replace(/^"|"$/g, ""); return v !== "" && isF(+v) ? +v : v; }));
}

/* ---------- 2  load: flags, diurnal correction, day segments ---------- */
function load(rows, P) {
  const d = rows.map(r => Object.assign({}, r, { flags: [] }));
  for (const r of d) { if (!isF(r.lat) || !isF(r.lon) || !isF(r.tmi) || (!isF(r.t) && !r.date)) r.flags.push("NON_DATA_ROW"); r.diurnal = isF(r.reading) ? r.tmi - r.reading : NaN; }
  const hasDate = d.some(r => r.date), dates = hasDate ? [...new Set(d.filter(r => !r.flags.length).map(r => r.date))].sort() : [];
  let k = 1, last = null;
  for (const r of d) {
    if (r.flags.length) { r.day = 0; continue; }
    if (hasDate) { r.day = dates.indexOf(r.date) + 1; continue; }
    if (last !== null && r.t < last - P.day.gapMin * 60) k++;
    r.day = k; last = r.t;
  }
  const nDays = hasDate ? dates.length : k;
  return { d, nDays, hasDate, dates };
}
/* Hampel filter on the total field within each day (rolling median, centred window, min 3 values) */
function rollingMedian(v, w) {
  const h = w >> 1, out = new Array(v.length).fill(NaN);
  for (let i = 0; i < v.length; i++) { const s = []; for (let j = Math.max(0, i - h); j <= Math.min(v.length - 1, i + h); j++) if (isF(v[j])) s.push(v[j]); if (s.length >= 3) out[i] = median(s); }
  return out;
}
function despike(L, P) {
  const byDay = new Map(); L.d.forEach(r => { if (r.day > 0) { if (!byDay.has(r.day)) byDay.set(r.day, []); byDay.get(r.day).push(r); } });
  for (const g of byDay.values()) {
    const s = g.map(r => r.tmi), med = rollingMedian(s, P.despike.window), dev0 = s.map((v, i) => Math.abs(v - med[i])), mad = rollingMedian(dev0, P.despike.window);
    g.forEach((r, i) => { r.hmed = med[i]; r.hdev = dev0[i]; r.thr = Math.max(P.despike.floor, P.despike.k * 1.4826 * mad[i]); r.spike = P.despike.on && dev0[i] > r.thr; if (r.spike) r.flags.push("SPIKE_HAMPEL"); });
  }
  L.d.forEach(r => { r.ok = !r.flags.includes("NON_DATA_ROW") && !r.flags.includes("SPIKE_HAMPEL"); });
  return L;
}

/* ---------- 3  IGRF-14 ---------- */
let COEF = null;   // {epochs, n, m, v[epoch][k]} set by setIGRF
function setIGRF(c) { COEF = c; }
function decYear(iso) { const t = Date.parse(iso + "T00:00:00Z"), y = +iso.slice(0, 4), a = Date.UTC(y, 0, 1), b = Date.UTC(y + 1, 0, 1); return y + (t - a) / (b - a); }
function coeffsAt(year) {
  const E = COEF.epochs; let i = 0; while (i < E.length - 2 && year > E[i + 1]) i++;
  const f = (year - E[i]) / (E[i + 1] - E[i]), nmax = Math.max(...COEF.n), g = [], h = [];
  for (let n = 0; n <= nmax; n++) { g.push(new Float64Array(n + 1)); h.push(new Float64Array(n + 1)); }
  COEF.n.forEach((n, k) => { const m = COEF.m[k], v = COEF.v[i][k] + f * (COEF.v[i + 1][k] - COEF.v[i][k]); if (m >= 0) g[n][m] = v; else h[n][-m] = v; });
  return { g, h, nmax };
}
/* main field at geodetic lat, lon [deg], height h [km] above the ellipsoid: X north, Y east, Z down, F [nT], I, D [deg] */
function igrfAt(C, lat, lon, hkm) {
  const a = 6378.137, e2 = 0.00669437999014, RE = 6371.2, sl = Math.sin(lat * D2R), cl = Math.cos(lat * D2R);
  const N = a / Math.sqrt(1 - e2 * sl * sl), rho = (N + hkm) * cl, z = (N * (1 - e2) + hkm) * sl, r = Math.hypot(rho, z);
  const latc = Math.atan2(z, rho), th = Math.PI / 2 - latc, ct = Math.cos(th), st = Math.max(1e-12, Math.sin(th)), ph = lon * D2R, nmax = C.nmax;
  // Schmidt semi-normalised Legendre functions and their theta derivatives
  const P = [], dP = []; for (let n = 0; n <= nmax; n++) { P.push(new Float64Array(n + 1)); dP.push(new Float64Array(n + 1)); }
  P[0][0] = 1; dP[0][0] = 0;
  for (let n = 1; n <= nmax; n++) for (let m = 0; m <= n; m++) {
    if (n === m) { const k = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n)); P[n][n] = k * st * P[n - 1][n - 1]; dP[n][n] = k * (st * dP[n - 1][n - 1] + ct * P[n - 1][n - 1]); }
    else { const a1 = (2 * n - 1) / Math.sqrt(n * n - m * m), a2 = Math.sqrt(((n - 1) * (n - 1) - m * m) / (n * n - m * m));
      P[n][m] = a1 * ct * P[n - 1][m] - (n - 2 >= m ? a2 * P[n - 2][m] : 0); dP[n][m] = a1 * (ct * dP[n - 1][m] - st * P[n - 1][m]) - (n - 2 >= m ? a2 * dP[n - 2][m] : 0); }
  }
  let Br = 0, Bt = 0, Bp = 0;
  for (let n = 1; n <= nmax; n++) { const f = Math.pow(RE / r, n + 2);
    for (let m = 0; m <= n; m++) { const cm = Math.cos(m * ph), sm = Math.sin(m * ph), gh = C.g[n][m] * cm + C.h[n][m] * sm;
      Br += f * (n + 1) * gh * P[n][m]; Bt -= f * gh * dP[n][m]; Bp += f * m * (C.g[n][m] * sm - C.h[n][m] * cm) * P[n][m] / st; } }
  // geocentric north, east, down -> geodetic
  const psi = lat * D2R - latc, Xc = -Bt, Zc = -Br, X = Xc * Math.cos(psi) + Zc * Math.sin(psi), Z = -Xc * Math.sin(psi) + Zc * Math.cos(psi), Y = Bp;
  const H = Math.hypot(X, Y);
  return { X, Y, Z, F: Math.hypot(H, Z), I: Math.atan2(Z, H) / D2R, D: Math.atan2(Y, X) / D2R };
}
function addIGRF(L, P) {
  const C = coeffsAt(decYear(P.date)), hm = median(L.d.filter(r => r.day > 0).map(r => r.elev)), h0 = isF(hm) ? hm : 0;
  for (const r of L.d) { if (r.day <= 0) { r.F = r.inc = r.dec = r.tma = NaN; continue; } const b = igrfAt(C, r.lat, r.lon, (isF(r.elev) ? r.elev : h0) / 1000); r.F = b.F; r.inc = b.I; r.dec = b.D; r.tma = r.tmi - b.F; }
  const ok = L.d.filter(r => r.ok); L.inc = median(ok.map(r => r.inc)); L.dec = median(ok.map(r => r.dec)); L.F = median(ok.map(r => r.F));
  return L;
}
function igrfSensitivity(lat, lon, dates) {
  return dates.map(dt => { const b = igrfAt(coeffsAt(decYear(dt)), lat, lon, 0.3); return { date: dt, F: b.F, I: b.I, D: b.D }; });
}

/* ---------- 4  QC statistics ---------- */
function daySummary(L) {
  const out = [];
  for (let k = 1; k <= L.nDays; k++) {
    const g = L.d.filter(r => r.day === k); if (!g.length) continue;
    const di = g.map(r => r.diurnal).filter(isF), tm = g.map(r => r.tmi);
    out.push({ day: k, date: g[0].date || "", n: g.length, nOk: g.filter(r => r.ok).length, t0: g[0].t, t1: g[g.length - 1].t, lon: median(g.map(r => r.lon)), lat: median(g.map(r => r.lat)),
      diMin: di.length ? Math.min(...di) : NaN, diMax: di.length ? Math.max(...di) : NaN, tmiMed: median(tm), tmiMin: Math.min(...tm), tmiMax: Math.max(...tm), spikes: g.filter(r => r.spike).length });
  }
  return out;
}
/* accepted readings closer than maxM but measured on different days */
function crossovers(L, local, maxM) {
  const a = L.d.filter(r => r.ok), xy = a.map(r => local.fwd(r.lat, r.lon)), cell = Math.max(maxM, 1), B = new Map();
  xy.forEach(([x, y], i) => { const k = Math.floor(x / cell) + "|" + Math.floor(y / cell); if (!B.has(k)) B.set(k, []); B.get(k).push(i); });
  const pairs = [];
  xy.forEach(([x, y], i) => { const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let p = -1; p <= 1; p++) for (let q = -1; q <= 1; q++) for (const j of (B.get((cx + p) + "|" + (cy + q)) || [])) {
      if (j <= i || a[i].day === a[j].day) continue; const dd = Math.hypot(xy[j][0] - x, xy[j][1] - y); if (dd >= maxM) continue;
      const [u, v] = a[i].day < a[j].day ? [i, j] : [j, i]; pairs.push({ dayA: a[u].day, dayB: a[v].day, dT: a[v].tmi - a[u].tmi, dist: dd, lat: a[u].lat, lon: a[u].lon }); } });
  return pairs;
}

/* ---------- 5  gridding (block median + trend + biharmonic spline) with distance to the data ---------- */
/* the Verde chain of the Python processing: BlockReduce(median) -> Trend(1) -> Spline(damping, mindist).
   Verde scales the Jacobian columns to unit standard deviation and solves a ridge regression. */
function fitSplineVerde(x, y, v, o) {
  let xmin = Infinity, ymin = Infinity; for (let i = 0; i < x.length; i++) { if (x[i] < xmin) xmin = x[i]; if (y[i] < ymin) ymin = y[i]; }
  const Bm = new Map(); for (let i = 0; i < x.length; i++) { if (!isF(v[i])) continue; const k = Math.floor((x[i] - xmin) / o.block) + "|" + Math.floor((y[i] - ymin) / o.block); if (!Bm.has(k)) Bm.set(k, []); Bm.get(k).push(i); }
  const bx = [], by = [], bv = []; for (const idx of Bm.values()) { bx.push(median(idx.map(i => x[i]))); by.push(median(idx.map(i => y[i]))); bv.push(median(idx.map(i => v[i]))); }
  const n = bx.length, mx = bx.reduce((s, q) => s + q, 0) / n, my = by.reduce((s, q) => s + q, 0) / n;
  // linear trend
  const N3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r3 = [0, 0, 0];
  for (let i = 0; i < n; i++) { const a = [1, (bx[i] - mx) / 1000, (by[i] - my) / 1000]; for (let j = 0; j < 3; j++) { r3[j] += a[j] * bv[i]; for (let k = 0; k < 3; k++) N3[j][k] += a[j] * a[k]; } }
  const tc = GLb.cholSolve(N3, r3).x, trend = (px, py) => tc[0] + tc[1] * (px - mx) / 1000 + tc[2] * (py - my) / 1000;
  const res = bv.map((q, i) => q - trend(bx[i], by[i])), md = o.mindist;
  const green = (dx, dy) => { const d = Math.sqrt(dx * dx + dy * dy) + md; return d < 1 ? d * (d * Math.log(d) - d) : d * d * (Math.log(d) - 1); };
  const J = new Float64Array(n * n); for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) J[i * n + j] = J[j * n + i] = green(bx[i] - bx[j], by[i] - by[j]);
  const sc = new Float64Array(n); for (let j = 0; j < n; j++) { let m = 0; for (let i = 0; i < n; i++) m += J[i * n + j]; m /= n; let q = 0; for (let i = 0; i < n; i++) q += (J[i * n + j] - m) ** 2; sc[j] = Math.sqrt(q / n) || 1; }
  // ridge: (Jsᵀ Js + α I) c = Jsᵀ r,  Js = J diag(1/sc)
  const A = new Float64Array(n * n), b = new Float64Array(n), col = new Float64Array(n);
  for (let j = 0; j < n; j++) { for (let i = 0; i < n; i++) col[i] = J[i * n + j];
    for (let k = 0; k <= j; k++) { let s = 0; const ok = k; for (let i = 0; i < n; i++) s += col[i] * J[i * n + ok]; A[j * n + k] = A[k * n + j] = s / (sc[j] * sc[k]); }
    let t = 0; for (let i = 0; i < n; i++) t += col[i] * res[i]; b[j] = t / sc[j]; }
  const alpha = Math.pow(10, o.damp); for (let j = 0; j < n; j++) A[j * n + j] += alpha;
  for (let j = 0; j < n; j++) { let s = A[j * n + j]; for (let k = 0; k < j; k++) s -= A[j * n + k] ** 2; const l = Math.sqrt(Math.max(s, 1e-300)); A[j * n + j] = l;
    for (let i = j + 1; i < n; i++) { let t = A[i * n + j]; for (let k = 0; k < j; k++) t -= A[i * n + k] * A[j * n + k]; A[i * n + j] = t / l; } }
  const c = new Float64Array(n); for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= A[i * n + k] * c[k]; c[i] = s / A[i * n + i]; }
  for (let i = n - 1; i >= 0; i--) { let s = c[i]; for (let k = i + 1; k < n; k++) s -= A[k * n + i] * c[k]; c[i] = s / A[i * n + i]; }
  const f = Float64Array.from(c, (q, j) => q / sc[j]);
  return { predict: (px, py) => { let s = trend(px, py); for (let j = 0; j < n; j++) s += f[j] * green(px - bx[j], py - by[j]); return s; }, nData: n };
}
function gridField(pts, o) {
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon0 = pts.reduce((s, p) => s + p.lon, 0) / pts.length, L = o.local || ENGb.makeLocal(lat0, lon0);
  const xy = pts.map(p => L.fwd(p.lat, p.lon)), x = xy.map(q => q[0]), y = xy.map(q => q[1]), v = pts.map(p => p.v);
  const pad = (o.maskKm + (o.taperKm || 0)) * 1000;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity; for (let i = 0; i < x.length; i++) { if (x[i] < xmin) xmin = x[i]; if (x[i] > xmax) xmax = x[i]; if (y[i] < ymin) ymin = y[i]; if (y[i] > ymax) ymax = y[i]; }
  const x0 = Math.floor((xmin - pad) / o.cell) * o.cell, y0 = Math.floor((ymin - pad) / o.cell) * o.cell, nx = Math.floor((xmax + pad - x0) / o.cell) + 1, ny = Math.floor((ymax + pad - y0) / o.cell) + 1;
  const model = fitSplineVerde(x, y, v, o);
  const z = new Float64Array(nx * ny), dist = distanceGrid(x, y, x0, y0, nx, ny, o.cell, pad), mask = new Uint8Array(nx * ny);
  let lv = 0, nl = 0;
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) { const i = r * nx + c; if (dist[i] >= pad) { z[i] = NaN; continue; } z[i] = model.predict(x0 + c * o.cell, y0 + r * o.cell); mask[i] = dist[i] <= o.maskKm * 1000 ? 1 : 0; if (mask[i]) { lv += z[i]; nl++; } }
  lv /= nl || 1; for (let i = 0; i < z.length; i++) if (!isF(z[i])) z[i] = lv;     // nodes beyond the taper: not needed, set to the mean
  return { nx, ny, x0, y0, cell: o.cell, z, mask, dist, local: L, nData: model.nData, model };
}
/* distance from every node to the nearest reading (exact Euclidean distance transform of the nodes nearest
   to the readings, Felzenszwalb & Huttenlocher 2012; accurate to half a cell), capped at maxD */
function distanceGrid(x, y, x0, y0, nx, ny, cell, maxD) {
  const INF = 1e20, f = new Float64Array(nx * ny).fill(INF);
  for (let i = 0; i < x.length; i++) { const c = Math.round((x[i] - x0) / cell), r = Math.round((y[i] - y0) / cell); if (c >= 0 && r >= 0 && c < nx && r < ny) f[r * nx + c] = 0; }
  const dt1 = (g, n) => { const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1); let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) { let s; while (true) { s = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k] && k > 0) k--; else break; } if (s <= z[k]) { v[0] = q; z[0] = -INF; z[1] = INF; k = 0; continue; } k++; v[k] = q; z[k] = s; z[k + 1] = INF; }
    k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + g[v[k]]; } return d; };
  const col = new Float64Array(ny);
  for (let c = 0; c < nx; c++) { for (let r = 0; r < ny; r++) col[r] = f[r * nx + c]; const d = dt1(col, ny); for (let r = 0; r < ny; r++) f[r * nx + c] = d[r]; }
  const row = new Float64Array(nx), out = new Float64Array(nx * ny);
  for (let r = 0; r < ny; r++) { for (let c = 0; c < nx; c++) row[c] = f[r * nx + c]; const d = dt1(row, nx); for (let c = 0; c < nx; c++) out[r * nx + c] = Math.min(maxD, Math.sqrt(d[c]) * cell); }
  return out;
}

/* ---------- 6  reduction to the pole and other magnetic operators ---------- */
/* unit vector (east, north, down) of inclination I and declination D [deg] */
const dirVec = (I, D) => [Math.cos(I * D2R) * Math.sin(D * D2R), Math.cos(I * D2R) * Math.cos(D * D2R), Math.sin(I * D2R)];
/* the TMA grid tapered to its median beyond the data mask (as in the Python chain), ready for FFT operators */
function tapered(G, maskKm, taperKm) {
  const lv = median(Array.from(G.z).filter((v, i) => G.mask[i])), z = new Float64Array(G.z.length);
  for (let i = 0; i < z.length; i++) { let w = Math.min(1, Math.max(0, (maskKm * 1000 + taperKm * 1000 - G.dist[i]) / (taperKm * 1000 || 1))); w = Math.sin(0.5 * Math.PI * w) ** 2; z[i] = lv + (G.z[i] - lv) * w; }
  return { nx: G.nx, ny: G.ny, cell: G.cell, z, level: lv };
}
/* RTP: F(k) = |k|² / (Θf Θm), Θ = i(ex kx + ey ky) + ez |k|; field and magnetisation directions (I, D) */
function rtpFilter(If, Df, Im, Dm) {
  const f = dirVec(If, Df), m = dirVec(Im === undefined ? If : Im, Dm === undefined ? Df : Dm);
  return (kx, ky, k, dc) => { if (dc || k === 0) return [0, 0];
    const fr = f[2] * k, fi = f[0] * kx + f[1] * ky, mr = m[2] * k, mi = m[0] * kx + m[1] * ky, dr = fr * mr - fi * mi, di = fr * mi + fi * mr, den = dr * dr + di * di, kk = k * k;
    return [kk * dr / den, -kk * di / den]; };
}
function rtp(G, If, Df, P) {
  const T = tapered(G, P.grid.maskKm, P.grid.taperKm), r = GLb.specFilter(T, rtpFilter(If, Df));
  return Float64Array.from(r.out);
}

/* ---------- 2-D magnetic polygons (Poisson's relation on the Talwani gravity polygon) ---------- */
const MU0_4PI = 1e-7, GCONST = 6.67430e-11;
/* gravity gz [m/s² per kg/m³] of a polygon at (x0, z0); z down */
function gzSI(x0, z0, xs, zs) { return GLb.poly2d(x0, z0, xs, zs, 0.001) * 1e-5; }
/* total-field anomaly [nT] of a 2-D polygon body with magnetisation (Mx along the section, Mz down) [A/m]
   at stations x on the line z = −sensor, for the field direction (fx, fz) projected on the section */
function polyTMA(x, xy, Mx, Mz, fx, fz, sensor) {
  const [xs, zs] = MODb().oriented(xy.map(p => p[0]), xy.map(p => Math.max(0, p[1]))), h = 1.0, z0 = -(sensor || 1), K = MU0_4PI / GCONST * 1e9;
  return x.map(x0 => {
    const gxp = gzSI(x0 + h, z0, xs, zs), gxm = gzSI(x0 - h, z0, xs, zs), gzp = gzSI(x0, z0 + h, xs, zs), gzm = gzSI(x0, z0 - h, xs, zs);
    const Tzx = (gxp - gxm) / (2 * h), Tzz = (gzp - gzm) / (2 * h), Txx = -Tzz, Txz = Tzx;
    const Bx = K * (Mx * Txx + Mz * Txz), Bz = K * (Mx * Tzx + Mz * Tzz);
    return Bx * fx + Bz * fz;
  });
}
const MODb = () => (typeof MOD !== "undefined" ? MOD : global.MOD);
/* magnetisation of a body: induced (susceptibility χ, SI, in the field F [nT]) plus remanence Mr [A/m] (Ir, Dr) */
function bodyMag(b, F, If, Df, az) {
  const Hm = F * 1e-9 / (4 * Math.PI * 1e-7), Mi = b.chi * Hm;          // induced M = χ F/μ0
  const comp = (M, I, D) => [M * Math.cos(I * D2R) * Math.cos((D - az) * D2R), M * Math.sin(I * D2R)];
  const [ix, iz] = comp(Mi, If, Df), [rx, rz] = comp(b.mr || 0, isF(b.ir) ? b.ir : If, isF(b.dr) ? b.dr : Df);
  return [ix + rx, iz + rz];
}
/* field of all bodies along the section of azimuth az [deg] */
function forward(x, bodies, fld, az, sensor) {
  const fx = Math.cos(fld.I * D2R) * Math.cos((fld.D - az) * D2R), fz = Math.sin(fld.I * D2R), out = new Array(x.length).fill(0);
  for (const b of bodies) { const [Mx, Mz] = bodyMag(b, fld.F, fld.I, fld.D, az), r = polyTMA(x, b.xy, Mx, Mz, fx, fz, sensor); for (let i = 0; i < x.length; i++) out[i] += r[i]; }
  return out;
}
/* least-squares susceptibilities of the bodies (induced only, shapes fixed); data and responses centred */
function fitChi(x, d, bodies, fld, az, sensor) {
  const MO = MODb(), A = bodies.map(b => MO.centred(forward(x, [Object.assign({}, b, { chi: 1, mr: 0 })], fld, az, sensor))), dc = MO.centred(d);
  const rem = MO.centred(forward(x, bodies.map(b => Object.assign({}, b, { chi: 0 })), fld, az, sensor)), y = dc.map((v, i) => v - rem[i]);
  const N = A.map(a => A.map(b => a.reduce((s, v, i) => s + v * b[i], 0))), rhs = A.map(a => a.reduce((s, v, i) => s + v * y[i], 0));
  const tr = N.reduce((s, r, i) => s + r[i], 0) / (N.length || 1); N.forEach((r, i) => { r[i] += 1e-9 * tr; });
  return GLb.cholSolve(N, rhs).x;
}
/* sensitivity of the cells of a section mesh for susceptibility (nT per SI), columns centred */
function sensitivity(x, M, fld, az, sensor) {
  const nd = x.length, G = new Float64Array(nd * M.nc), unit = { chi: 1, mr: 0 };
  const fx = Math.cos(fld.I * D2R) * Math.cos((fld.D - az) * D2R), fz = Math.sin(fld.I * D2R), [Mx, Mz] = bodyMag(unit, fld.F, fld.I, fld.D, az);
  for (let iz = 0; iz < M.nz; iz++) for (let ix = 0; ix < M.nx; ix++) {
    const j = iz * M.nx + ix, xa = M.xe[ix], xb = M.xe[ix + 1], za = M.ze[iz], zb = M.ze[iz + 1], r = polyTMA(x, [[xa, za], [xb, za], [xb, zb], [xa, zb]], Mx, Mz, fx, fz, sensor);
    let mean = 0; for (let i = 0; i < nd; i++) mean += r[i]; mean /= nd; for (let i = 0; i < nd; i++) G[i * M.nc + j] = r[i] - mean;
  }
  return G;
}

const API = { DEFAULTS, mergeParams, fromTable, parseCSVTable, timeSec, dateStr, load, despike, setIGRF, decYear, coeffsAt, igrfAt, addIGRF, igrfSensitivity,
  daySummary, crossovers, gridField, fitSplineVerde, distanceGrid, tapered, rtpFilter, rtp, dirVec, polyTMA, bodyMag, forward, fitChi, sensitivity, median };
if (typeof module !== "undefined") module.exports = API;
return API;
})();
