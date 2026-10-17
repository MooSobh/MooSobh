/* ===== WG engine: the Wadi Ghadir gravity processing chain in the browser (no DOM) =====
   A JavaScript port of the wghadir Python chain (steps: parse, tide, QC, occupations, positions,
   base control and drift, instrument scale, reductions, Nettleton) plus gridding and contouring.
   Written by Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics), Hannover. */
const ENG = (function () {
"use strict";
const D2R = Math.PI / 180, R_EARTH = 6371008.8, BOUGUER_K = 0.04193;

/* ---------- default parameters (the values of the delivered Wadi Ghadir products) ---------- */
const DEFAULTS = {
  qc: { stdReject: 0.080, stdWarn: 0.050, tiltReject: 30, tiltWarn: 20, repeatOutlier: 0.050, grossRange: 500,
        frozen: [{ inst: "CG6-0313", lo: 8007.5, hi: 8009.0 }] },
  tide: { model: "longman_gps", factor: 1.16 },
  occ: { gapMin: 15 },
  base: { line: "0", station: "100", locMaxM: 50 },
  hotel: { line: "0", station: "0", use: true, tieMaxH: 4 },
  drift: { tareMgal: 0.30 },
  pos: { allowCg6Gps: false },
  scale: { refInst: "auto", apply: true, pairMaxSepM: 10, pairMaxDhM: 0.5, retieMinPairs: 3 },
  red: { rho: 2.67, sensorM: 0.0 },
  net: { maxStepM: 1000, minN: 15, minReliefM: 40 },
};
const clone = o => JSON.parse(JSON.stringify(o));
function mergeParams(P) {
  const out = clone(DEFAULTS);
  for (const k in (P || {})) out[k] = Object.assign(out[k] || {}, P[k]);
  return out;
}

/* ---------- small numerics ---------- */
const isF = Number.isFinite;
function median(a) { const s = a.filter(isF).sort((x, y) => x - y); const n = s.length; if (!n) return NaN; return n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]); }
function mean(a) { const s = a.filter(isF); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : NaN; }
function std(a, ddof = 1) { const s = a.filter(isF), n = s.length; if (n - ddof <= 0) return NaN; const m = mean(s); return Math.sqrt(s.reduce((t, v) => t + (v - m) ** 2, 0) / (n - ddof)); }
function haversine(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dp = p2 - p1, dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}
function normalGravity(lat) { const s2 = Math.sin(lat * D2R) ** 2; return 978032.53359 * (1 + 0.00193185265241 * s2) / Math.sqrt(1 - 0.00669437999013 * s2); }
function freeAir(lat, h) { const s2 = Math.sin(lat * D2R) ** 2; return (0.3087691 - 0.0004398 * s2) * h - 7.2125e-8 * h * h; }
/* solve small dense system (Gaussian elimination, partial pivoting); A is array of rows, modified */
function solve(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    const d = A[c][c]; if (Math.abs(d) < 1e-300) throw new Error("singular system");
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / d; if (!f) continue; const Ar = A[r], Ac = A[c]; for (let k = c; k < n; k++) Ar[k] -= f * Ac[k]; b[r] -= f * b[c]; }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}
/* least squares y = A coef (A rows), returns {coef, cov, s2} */
function lstsq(A, y) {
  const m = A[0].length, N = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0);
  A.forEach((r, i) => { for (let j = 0; j < m; j++) { b[j] += r[j] * y[i]; for (let k = 0; k < m; k++) N[j][k] += r[j] * r[k]; } });
  const coef = solve(N.map(r => r.slice()), b.slice());
  let rss = 0; A.forEach((r, i) => { let p = 0; for (let j = 0; j < m; j++) p += r[j] * coef[j]; rss += (y[i] - p) ** 2; });
  const s2 = rss / Math.max(A.length - m, 1);
  const inv = []; for (let j = 0; j < m; j++) { const e = new Array(m).fill(0); e[j] = 1; inv.push(solve(N.map(r => r.slice()), e)); }
  return { coef, cov: inv.map(r => r.map(v => v * s2)), s2 };
}
/* local metric projection about a centre (equirectangular, < 0.1 % error over 60 km) */
function makeLocal(lat0, lon0) {
  const kx = D2R * R_EARTH * Math.cos(lat0 * D2R), ky = D2R * R_EARTH;
  return { lat0, lon0, fwd: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky], inv: (x, y) => [lat0 + y / ky, lon0 + x / kx] };
}

/* ---------- 1  parse a Scintrex CG-6 survey export ---------- */
const NUM = ["CorrGrav", "StdDev", "StdErr", "RawGrav", "X", "Y", "SensorTemp", "TideCorr", "TiltCorr", "TempCorr", "DriftCorr",
  "MeasurDur", "InstrHeight", "LatUser", "LonUser", "ElevUser", "LatGPS", "LonGPS", "ElevGPS"];
function parseCG6(text, name) {
  const lines = text.split(/\r?\n/), header = {};
  let h = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.startsWith("/Station")) { h = i; break; }
    const m = ln.match(/^\/\s*(.+?):\s*(.*)$/); if (m) header[m[1].trim()] = m[2].trim();
  }
  if (h < 0) throw new Error(`${name}: this is not a CG-6 survey export (no "/Station" column header line).`);
  const cols = lines[h].slice(1).split("\t");
  const serial = header["Instrument Serial Number"] || "";
  const inst = serial ? "CG6-" + serial.slice(-4) : name.replace(/\.[^.]+$/, "");
  const rows = [];
  for (let i = h + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = lines[i].split("\t"), r = { inst, file: name, fileRow: rows.length + 1, overflow: [] };
    cols.forEach((c, j) => { r[c] = (f[j] ?? "").trim(); });
    for (const c of NUM) { if (r[c] === "******") { r.overflow.push(c); r[c] = NaN; } else r[c] = r[c] === "" || r[c] === undefined ? NaN : +r[c]; }
    r.Station = String(r.Station); r.Line = String(r.Line);
    const [Y, M, Dd] = (r.Date || "").split("-").map(Number), [hh, mm, ss] = (r.Time || "").split(":").map(Number);
    r.t = Date.UTC(Y, M - 1, Dd, hh, mm, ss);
    rows.push(r);
  }
  return { name, inst, serial, header, cols, rows };
}

/* ---------- generic CSV (comma, semicolon or tab) ---------- */
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.startsWith("#"));
  if (!lines.length) return [];
  const d = [",", ";", "\t"].map(c => [c, lines[0].split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const head = lines[0].split(d).map(s => s.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(l => { const f = l.split(d), o = {}; head.forEach((k, i) => { const v = (f[i] ?? "").trim().replace(/^"|"$/g, ""); o[k] = v !== "" && isF(+v) ? +v : v; }); return o; });
}
/* generic readings table (any gravimeter): one row per reading.
   required: date (YYYY-MM-DD, YYYY/MM/DD or DD.MM.YYYY), time (HH:MM[:SS], UTC), station, gravity (mGal; also called
   reading, g or corrgrav);  optional: line, instrument, stddev, tilt_x, tilt_y, tidecorr (tide already applied, mGal),
   lat, lon (reading position).  Also accepts one "datetime" column instead of date and time. */
function parseReadingsCSV(text, name) {
  const rows0 = parseCSV(text);
  if (!rows0.length) throw new Error(`${name}: the file is empty.`);
  const keys = Object.keys(rows0[0]), find = names => keys.find(k => names.includes(k.toLowerCase().replace(/[\s_\-\[\]()]/g, "")));
  const cDate = find(["date"]), cTime = find(["time", "timeutc", "utc"]), cDT = find(["datetime", "timestamp", "datetimeutc"]);
  const cSt = find(["station", "stn", "point", "stationid"]), cLine = find(["line", "profile"]), cG = find(["gravity", "reading", "g", "corrgrav", "gobs", "value", "mgal"]);
  const cInst = find(["instrument", "inst", "meter", "gravimeter"]), cSd = find(["stddev", "sd", "std", "sigma"]), cTx = find(["tiltx"]), cTy = find(["tilty"]);
  const cTide = find(["tidecorr", "tide", "tidecorrection"]), cLat = find(["lat", "latitude", "latgps"]), cLon = find(["lon", "long", "longitude", "longps"]);
  const miss = []; if (!cSt) miss.push("station"); if (!cG) miss.push("gravity"); if (!cDT && (!cDate || !cTime)) miss.push("date and time");
  if (miss.length) throw new Error(`${name}: missing column(s) ${miss.join(", ")}. Found: ${keys.join(", ")}.`);
  const isoDate = d => { d = String(d).trim(); let m;
    if ((m = d.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    if ((m = d.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/))) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return null; };
  const inst0 = name.replace(/\.[^.]+$/, "");
  const rows = rows0.map((o, i) => {
    let date, time;
    if (cDT) { const v = String(o[cDT]).trim().replace("T", " "); date = isoDate(v.split(" ")[0]); time = v.split(" ")[1] || "00:00:00"; }
    else { date = isoDate(o[cDate]); time = String(o[cTime]).trim(); }
    if (!date) throw new Error(`${name}, row ${i + 2}: cannot read the date "${cDT ? o[cDT] : o[cDate]}" (use YYYY-MM-DD).`);
    const [hh, mm, ss] = time.split(":").map(Number), [Y, M, D] = date.split("-").map(Number);
    const g = +o[cG], sd = cSd ? +o[cSd] : 0.01, tide = cTide ? +o[cTide] : 0, lat = cLat ? +o[cLat] : NaN, lon = cLon ? +o[cLon] : NaN;
    return { inst: cInst ? String(o[cInst]) : inst0, file: name, fileRow: i + 1, overflow: [], Date: date, Time: time,
      Station: String(o[cSt]), Line: cLine ? String(o[cLine]) : "", t: Date.UTC(Y, M - 1, D, hh || 0, mm || 0, ss || 0),
      CorrGrav: g, RawGrav: g, StdDev: isF(sd) ? sd : 0.01, StdErr: (isF(sd) ? sd : 0.01) / Math.sqrt(60), X: cTx ? +o[cTx] : 0, Y: cTy ? +o[cTy] : 0,
      TideCorr: isF(tide) ? tide : 0, TiltCorr: 0, TempCorr: 0, DriftCorr: 0, LatGPS: lat, LonGPS: lon, ElevGPS: NaN, LatUser: lat, LonUser: lon };
  }).filter(r => isF(r.CorrGrav) && isF(r.t));
  const insts = [...new Set(rows.map(r => r.inst))];
  return { name, inst: insts.join(", "), serial: "", header: { format: "readings table" }, cols: keys, rows };
}
function parseAny(f) { return /^\/\s*CG-6|^\/Station\t/m.test(f.text) ? parseCG6(f.text, f.name) : parseReadingsCSV(f.text, f.name); }

/* station coordinate table: columns line, station, lat, lon, H (or h and N); optional instrument, date, u_topo, tc */
function normaliseStations(rows) {
  const pick = (o, names) => { for (const n of names) for (const k in o) if (k.toLowerCase() === n) return o[k]; return undefined; };
  const out = [];
  for (const o of rows) {
    const lat = +pick(o, ["lat", "latitude", "lat_deg"]), lon = +pick(o, ["lon", "long", "longitude", "lon_deg"]);
    let H = +pick(o, ["h_ortho", "h_ortho_m", "elev", "elevation", "height", "h_orth"]);
    if (!isF(H)) { const hE = +pick(o, ["h", "h_ellip", "h_ellipsoidal"]), N = +pick(o, ["n", "geoid", "n_egm2008"]); H = isF(hE) ? hE - (isF(N) ? N : 0) : NaN; }
    const line = pick(o, ["line"]), station = pick(o, ["station", "stn", "point"]);
    if (!isF(lat) || !isF(lon) || station === undefined) continue;
    out.push({ inst: pick(o, ["instrument", "inst"]) ?? "", date: pick(o, ["date"]) ?? "", line: line === undefined ? "" : String(line),
      station: String(station), lat, lon, H, u: +pick(o, ["u_topo", "u_topo_rel", "u"]), tc: +pick(o, ["tc", "tc267", "terrain"]) });
  }
  return out;
}
function stationIndex(list) {
  const m = new Map();
  for (const s of list) {
    const k1 = `${s.inst}|${s.date}|${s.line}|${s.station}`, k2 = `${s.date}|${s.line}|${s.station}`, k3 = `${s.line}|${s.station}`;
    if (s.inst && s.date && !m.has(k1)) m.set(k1, s);
    if (s.date && !m.has(k2)) m.set(k2, s);
    if (!m.has(k3)) m.set(k3, s);
  }
  return (inst, date, line, station) => m.get(`${inst}|${date}|${line}|${station}`) || m.get(`${date}|${line}|${station}`) || m.get(`${line}|${station}`);
}

/* ---------- 2  tide ---------- */
function applyTide(rows, P, longman) {
  for (const r of rows) {
    r.tideGps = isF(r.LatGPS) ? longman(r.LatGPS, r.LonGPS, 0, r.t, P.tide.factor).total : NaN;
    r.tideUser = isF(r.LatUser) ? longman(r.LatUser, r.LonUser, 0, r.t, P.tide.factor).total : NaN;
    const tide = P.tide.model === "onboard" ? r.TideCorr : P.tide.model === "longman_user" ? r.tideUser : r.tideGps;
    r.g = r.CorrGrav - r.TideCorr + tide;
  }
}

/* ---------- occupations ids ---------- */
function assignOccupations(rows, P) {
  rows.sort((a, b) => a.inst < b.inst ? -1 : a.inst > b.inst ? 1 : a.t - b.t);
  let k = 0, prev = null;
  for (const r of rows) {
    const key = `${r.inst}|${r.Date}|${r.Station}|${r.Line}`;
    if (!prev || key !== prev.key || r.t - prev.t > P.occ.gapMin * 60000) k++;
    r.occ = k; prev = { key, t: r.t };
  }
}

/* ---------- 3  row QC ---------- */
function rowQC(rows, P) {
  const q = P.qc, byInst = {};
  rows.forEach(r => (byInst[r.inst] = byInst[r.inst] || []).push(r.g));
  const med = {}; for (const k in byInst) med[k] = median(byInst[k]);
  for (const r of rows) {
    const rej = [], warn = [];
    if (r.overflow.length) rej.push("OVERFLOW_FIELD");
    const frozen = q.frozen.some(f => f.inst === r.inst && r.RawGrav >= f.lo && r.RawGrav <= f.hi);
    if (frozen) rej.push("FROZEN_SENSOR_OUTPUT");
    if (!frozen && Math.abs(r.g - med[r.inst]) > q.grossRange) rej.push("GROSS_RANGE");
    if (r.StdDev > q.stdReject) rej.push("STDDEV"); else if (r.StdDev > q.stdWarn) warn.push("STDDEV");
    const tilt = Math.max(Math.abs(r.X), Math.abs(r.Y));
    if (tilt > q.tiltReject) rej.push("TILT"); else if (tilt > q.tiltWarn) warn.push("TILT");
    r.rej = rej; r.warn = warn;
  }
  const groups = new Map(); rows.forEach(r => { if (!groups.has(r.occ)) groups.set(r.occ, []); groups.get(r.occ).push(r); });
  for (const g of groups.values()) {
    const ok = g.filter(r => !r.rej.length);
    if (ok.length >= 3) ok.forEach((r, i) => { const others = ok.filter((_, j) => j !== i).map(o => o.g); if (Math.abs(r.g - median(others)) > P.qc.repeatOutlier) r.rej.push("REPEAT_OUTLIER"); });
    else if (ok.length === 2 && Math.abs(ok[0].g - ok[1].g) > P.qc.repeatOutlier) ok.forEach(r => r.warn.push("TWO_READINGS_DIFFER"));
  }
  rows.forEach(r => { r.accepted = !r.rej.length; });
}

/* ---------- 4  occupations ---------- */
function buildOccupations(rows, P) {
  const groups = new Map(); rows.forEach(r => { if (!groups.has(r.occ)) groups.set(r.occ, []); groups.get(r.occ).push(r); });
  const occ = [];
  for (const [id, g] of groups) {
    const a = g.filter(r => r.accepted), n = a.length, r0 = g[0];
    const at = (b) => r0.Station === b.station && (r0.Line === b.line || r0.Line === "" || b.line === "");   // no line: station number only
    const role = at(P.base) ? "base" : P.hotel.use && at(P.hotel) ? "hotel" : "field";
    let gm = NaN, sigma = NaN, tmid = mean(g.map(r => r.t));
    if (n) {
      const vals = a.map(r => r.g); gm = mean(vals);
      const internal = Math.sqrt(mean(a.map(r => r.StdErr ** 2)) / n), scatter = n > 1 ? std(vals) / Math.sqrt(n) : NaN;
      sigma = n > 1 ? Math.max(internal, isF(scatter) ? scatter : 0) : a[0].StdErr; tmid = mean(a.map(r => r.t));
    }
    occ.push({ id, inst: r0.inst, date: r0.Date, line: r0.Line, station: r0.Station, role, key: `${r0.inst}|${r0.Date}|L${r0.Line}|S${r0.Station}`,
      n: g.length, nAcc: n, g: gm, sigma, t: tmid, latCg6: median(g.map(r => r.LatGPS)), lonCg6: median(g.map(r => r.LonGPS)),
      elevCg6: median(g.map(r => r.ElevGPS)), usable: n > 0, rej: [...new Set(g.flatMap(r => r.rej))] });
  }
  return occ;
}

/* ---------- 5  positions ---------- */
function attachPositions(occ, lookup, P) {
  for (const o of occ) {
    const s = lookup ? lookup(o.inst, o.date, o.line, o.station) : null;
    if (s) Object.assign(o, { lat: s.lat, lon: s.lon, H: s.H, u: isF(s.u) ? s.u : NaN, tc: isF(s.tc) ? s.tc : NaN, pos: "table" });
    else if (P.pos.allowCg6Gps && isF(o.latCg6)) Object.assign(o, { lat: o.latCg6, lon: o.lonCg6, H: o.elevCg6, u: NaN, tc: NaN, pos: "cg6 gps" });
    else Object.assign(o, { lat: NaN, lon: NaN, H: NaN, u: NaN, tc: NaN, pos: "none" });
  }
}

/* ---------- 6  base control and drift (port of wghadir.gravity.base_control) ---------- */
function baseControl(occ, ref, P) {
  const near = (o, mark) => !mark || !isF(o.latCg6) || haversine(o.latCg6, o.lonCg6, mark.lat, mark.lon) < P.base.locMaxM;
  for (const o of occ) o.validCtrl = o.usable && ((o.role === "base" && near(o, ref.base)) || (o.role === "hotel" && near(o, ref.hotel)));
  const byDay = new Map(); occ.forEach(o => { const k = o.inst + "|" + o.date; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(o); });
  const ties = [];
  for (const [k, d] of byDay) {
    const c100 = d.filter(o => o.role === "base" && o.validCtrl).sort((a, b) => a.t - b.t), c0 = d.filter(o => o.role === "hotel").sort((a, b) => a.t - b.t);
    for (const leg of ["morning", "evening"]) {
      if (!c0.length || !c100.length) continue;
      const o0 = leg === "morning" ? c0[0] : c0[c0.length - 1], o1 = leg === "morning" ? c100[0] : c100[c100.length - 1];
      if (leg === "morning" && o0.t > o1.t) continue;
      const dt = (o1.t - o0.t) / 3.6e6, ok = o0.validCtrl && Math.abs(dt) <= P.hotel.tieMaxH;
      ties.push({ inst: o0.inst, date: o0.date, leg, dt, tie: ok ? o1.g - o0.g : NaN, used: ok });
    }
  }
  const tieStats = {};
  for (const inst of [...new Set(occ.map(o => o.inst))]) {
    const v = ties.filter(t => t.inst === inst && isF(t.tie)).map(t => t.tie);
    tieStats[inst] = { n: v.length, median: median(v), mean: mean(v), sd: std(v), se: std(v) / Math.sqrt(v.length) };
  }
  const ctrl = [];
  for (const o of occ.filter(o => o.validCtrl)) {
    if (o.role === "base") ctrl.push({ occ: o.id, inst: o.inst, date: o.date, t: o.t, g100: o.g, sigma: o.sigma, src: "base" });
    else if (isF(tieStats[o.inst].median)) ctrl.push({ occ: o.id, inst: o.inst, date: o.date, t: o.t, g100: o.g + tieStats[o.inst].median, sigma: Math.hypot(o.sigma, tieStats[o.inst].sd || 0), src: "hotel" });
  }
  ctrl.sort((a, b) => a.inst < b.inst ? -1 : a.inst > b.inst ? 1 : a.t - b.t);
  // leave-one-out misclosure and segment rates of base controls
  const loo = [], seg = [];
  const cByDay = new Map(); ctrl.filter(c => c.src === "base").forEach(c => { const k = c.inst + "|" + c.date; if (!cByDay.has(k)) cByDay.set(k, []); cByDay.get(k).push(c); });
  for (const c of cByDay.values()) {
    for (let j = 0; j < c.length - 1; j++) { const dt = (c[j + 1].t - c[j].t) / 3.6e6; seg.push({ inst: c[j].inst, dt, rate: (c[j + 1].g100 - c[j].g100) / dt }); }
    for (let j = 1; j < c.length - 1; j++) { const w = (c[j].t - c[j - 1].t) / (c[j + 1].t - c[j - 1].t), pred = c[j - 1].g100 + w * (c[j + 1].g100 - c[j - 1].g100); loo.push({ inst: c[j].inst, date: c[j].date, t: c[j].t, mis: c[j].g100 - pred }); }
  }
  const modelSigma = {}, rateSigma = {};
  for (const inst of Object.keys(tieStats)) {
    const l = loo.filter(x => x.inst === inst && Math.abs(x.mis) <= P.drift.tareMgal).map(x => x.mis);
    modelSigma[inst] = l.length ? Math.sqrt(mean(l.map(v => v * v))) : 0.02;
    const s = seg.filter(x => x.inst === inst && x.dt > 1).map(x => x.rate);
    rateSigma[inst] = s.length > 2 ? std(s) : 0.01;
  }
  for (const [k, d] of byDay) {
    const [inst, date] = k.split("|"), c = ctrl.filter(x => x.inst === inst && x.date === date);
    for (const o of d) {
      if (!c.length) { o.drift = "NO_CONTROL"; o.g100 = NaN; continue; }
      const before = c.filter(x => x.t <= o.t), after = c.filter(x => x.t >= o.t);
      if (before.length && after.length) {
        const c0 = before[before.length - 1], c1 = after[0];
        if (c0.occ === c1.occ) { o.g100 = c0.g100; o.g100s = c0.sigma; o.drift = "AT_CONTROL"; }
        else { const w = (o.t - c0.t) / (c1.t - c0.t); o.g100 = c0.g100 + w * (c1.g100 - c0.g100); o.g100s = Math.sqrt(((1 - w) * c0.sigma) ** 2 + (w * c1.sigma) ** 2 + modelSigma[inst] ** 2); o.drift = c0.src === "base" && c1.src === "base" ? "INTERPOLATED" : "INTERPOLATED_HOTEL"; }
      } else {
        let rate = 0;
        if (c.length >= 2) { const s2 = before.length ? c.slice(-2) : c.slice(0, 2); rate = (s2[1].g100 - s2[0].g100) / ((s2[1].t - s2[0].t) / 3.6e6); }
        const cn = before.length ? before[before.length - 1] : after[0], dth = (o.t - cn.t) / 3.6e6;
        o.g100 = cn.g100 + rate * dth; o.g100s = Math.sqrt(cn.sigma ** 2 + modelSigma[inst] ** 2 + (rateSigma[inst] * dth) ** 2); o.drift = "EXTRAPOLATED_" + Math.abs(dth).toFixed(1) + "h";
      }
    }
  }
  occ.forEach(o => { o.dg = o.g - o.g100; o.dgs = Math.sqrt(o.sigma ** 2 + (o.g100s || 0) ** 2); });
  return { ctrl, ties, tieStats, loo, modelSigma, rateSigma };
}

/* ---------- 7  instrument scale and re-ties ---------- */
function instrumentScale(occ, base, P) {
  const insts = [...new Set(occ.map(o => o.inst))];
  const nField = i => occ.filter(o => o.inst === i && o.role === "field").length;
  const ref = P.scale.refInst !== "auto" && insts.includes(P.scale.refInst) ? P.scale.refInst : insts.slice().sort((a, b) => nField(b) - nField(a))[0];
  const out = { ref, k: {}, est: {}, pairs: {}, retie: {} };
  occ.forEach(o => { o.k = 1; o.retie = 0; });
  const usable = o => o.role === "field" && o.usable && o.pos === "table" && isF(o.dg);
  const A = occ.filter(o => o.inst === ref && usable(o));
  for (const inst of insts.filter(i => i !== ref)) {
    const pairs = [];
    for (const r of occ.filter(o => o.inst === inst && usable(o))) {
      let best = null, bd = Infinity;
      for (const s of A) { const d = haversine(r.lat, r.lon, s.lat, s.lon); if (d < bd) { bd = d; best = s; } }
      if (best && bd <= P.scale.pairMaxSepM && Math.abs(best.H - r.H) <= P.scale.pairMaxDhM)
        pairs.push({ o: r, s: best, sep: bd, x: r.dg, y: best.dg, sx: r.dgs, sy: best.dgs });
    }
    out.pairs[inst] = pairs;
    const tr = base.tieStats[ref], to = base.tieStats[inst], e = {};
    if (tr && to && isF(tr.mean) && isF(to.mean) && to.n > 1 && tr.n > 1) {
      e.kTie = tr.mean / to.mean; e.kTieSe = Math.abs(e.kTie) * Math.sqrt((tr.se / tr.mean) ** 2 + (to.se / to.mean) ** 2);
    }
    const p = pairs.filter(q => !q.o.drift.startsWith("EXTRAP") && !q.s.drift.startsWith("EXTRAP"));
    const xs = p.map(q => q.x);
    if (p.length >= 3 && Math.max(...xs) - Math.min(...xs) > 5) {
      const sxx = p.reduce((t, q) => t + q.x * q.x, 0), k0 = p.reduce((t, q) => t + q.x * q.y, 0) / sxx;
      const rr = p.map(q => q.y - k0 * q.x), seRes = Math.sqrt(rr.reduce((t, v) => t + v * v, 0) / Math.max(p.length - 1, 1) / sxx);
      const seProp = Math.sqrt(p.reduce((t, q) => t + q.x ** 2 * (q.sy ** 2 + (k0 * q.sx) ** 2), 0)) / sxx;
      Object.assign(e, { kPair: k0, kPairSe: Math.max(seRes, seProp), nPairs: p.length, rmsPair: Math.sqrt(mean(rr.map(v => v * v))) });
    }
    let k = 1;
    if (isF(e.kTie) && isF(e.kPair)) {
      e.z = (e.kPair - e.kTie) / Math.hypot(e.kPairSe, e.kTieSe);
      if (Math.abs(e.z) < 2) { const w1 = 1 / e.kTieSe ** 2, w2 = 1 / e.kPairSe ** 2; k = (w1 * e.kTie + w2 * e.kPair) / (w1 + w2); e.kSe = 1 / Math.sqrt(w1 + w2); }
    } else if (isF(e.kPair)) { k = e.kPair; e.kSe = e.kPairSe; }
    e.k = P.scale.apply ? k : 1;
    out.est[inst] = e; out.k[inst] = e.k;
    occ.filter(o => o.inst === inst).forEach(o => { o.k = e.k; });
    // re-tie extrapolated segments to co-located reference values (per date)
    if (P.scale.apply) {
      const ex = pairs.filter(q => q.o.drift.startsWith("EXTRAP") && !q.s.drift.startsWith("EXTRAP")), byDate = {};
      ex.forEach(q => (byDate[q.o.date] = byDate[q.o.date] || []).push(q.y - e.k * q.x));
      for (const date in byDate) {
        const off = byDate[date], applied = off.length >= P.scale.retieMinPairs, m = mean(off), sd = std(off);
        out.retie[inst + "|" + date] = { n: off.length, offset: m, sd, applied };
        if (applied) occ.filter(o => o.inst === inst && o.date === date && String(o.drift).startsWith("EXTRAP")).forEach(o => {
          o.retie = m / e.k; o.dg += m / e.k; o.dgs = Math.hypot(o.sigma, sd); o.drift = "RETIED(" + o.drift + ")"; });
      }
    }
  }
  return out;
}

/* ---------- 8  reductions ---------- */
function reductions(occ, ref) {
  const b = ref.base, g100 = normalGravity(b.lat), fa100 = freeAir(b.lat, b.H), u100 = isF(b.u) ? b.u : 0, tc100 = isF(b.tc) ? b.tc : NaN;
  const st = occ.filter(o => o.role === "field");
  for (const s of st) {
    s.ok = s.usable && s.pos !== "none" && isF(s.dg) && isF(s.H);
    s.dgk = s.dg * s.k;
    s.dh = s.H - b.H;
    s.dFA = s.dgk - (normalGravity(s.lat) - g100) + (freeAir(s.lat, s.H) - fa100);
    s.uSlab = BOUGUER_K * s.dh;
    s.uTopo = isF(s.u) ? s.u - u100 : (isF(s.tc) && isF(tc100) ? s.uSlab - (s.tc - tc100) / 2.67 : NaN);
  }
  return st;
}
const SB = (s, rho) => s.dFA - rho * s.uSlab;
const CB = (s, rho) => s.dFA - rho * s.uTopo;

/* ---------- 9  Nettleton ---------- */
function detrend(x, y) { const n = x.length, mx = mean(x), my = mean(y); let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; } const b = sxx ? sxy / sxx : 0; return y.map((v, i) => v - my - b * (x[i] - mx)); }
function corr(a, b) { const ma = mean(a), mb = mean(b); let s = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return s / Math.sqrt(sa * sb); }
function buildProfiles(st, P) {
  const s = st.filter(x => x.ok), groups = {};
  s.forEach(x => { const k = x.inst + "|" + x.line; (groups[k] = groups[k] || []).push(x); });
  const profiles = [];
  for (const k in groups) {
    const d = groups[k].map(x => Object.assign({}, x, { sn: +x.station })).filter(x => isF(x.sn)).sort((a, b) => a.sn - b.sn || a.t - b.t);
    const seen = new Set(), u = d.filter(x => { if (seen.has(x.sn)) return false; seen.add(x.sn); return true; });
    let cur = [], ch = 0;
    const flush = () => { if (cur.length) { const sns = cur.map(x => x.sn); profiles.push({ id: `${cur[0].inst}-L${cur[0].line}-${Math.min(...sns)}-${Math.max(...sns)}`, inst: cur[0].inst, line: cur[0].line, st: cur }); } cur = []; };
    u.forEach((x, i) => {
      const step = i ? haversine(u[i - 1].lat, u[i - 1].lon, x.lat, x.lon) : 0;
      if (i && step > P.net.maxStepM) flush();
      ch = cur.length ? ch + step : 0; x.ch = ch; cur.push(x);
    });
    flush();
  }
  profiles.forEach(p => { const H = p.st.map(x => x.H); p.relief = Math.max(...H) - Math.min(...H); p.length = p.st[p.st.length - 1].ch / 1000; p.eligible = p.st.length >= P.net.minN && p.relief >= P.net.minReliefM; });
  return profiles;
}
function nettleton(p, which) {
  // as in the Python chain: stations with extrapolated drift are left out
  const S = p.st.filter(s => !String(s.drift).startsWith("EXTRAP"));
  if (S.length < 10 || Math.max(...S.map(s => s.H)) - Math.min(...S.map(s => s.H)) < 20) return null;
  const x = S.map(s => s.ch / 1000), H = S.map(s => s.H), fa = S.map(s => s.dFA), u = S.map(s => which === "simple" ? s.uSlab : s.uTopo);
  if (u.some(v => !isF(v))) return null;
  const hr = detrend(x, H), sweep = [];
  for (let rho = 1.8; rho <= 3.2001; rho += 0.01) { const b = fa.map((v, i) => v - rho * u[i]); sweep.push({ rho: +rho.toFixed(2), r: corr(detrend(x, b), hr) }); }
  let r0 = NaN; for (let i = 1; i < sweep.length; i++) if (Math.sign(sweep[i - 1].r) !== Math.sign(sweep[i].r)) { const a = sweep[i - 1], b = sweep[i]; r0 = a.rho + (b.rho - a.rho) * a.r / (a.r - b.r); break; }
  let reg = { rho: NaN, se: NaN };
  try { const L = lstsq(x.map((xi, i) => [1, xi, u[i]]), fa); reg = { rho: L.coef[2], se: Math.sqrt(L.cov[2][2]), rms: Math.sqrt(L.s2) }; } catch (e) { /* too few points */ }
  return { sweep, rhoZero: r0, rhoReg: reg.rho, rhoSe: reg.se, rms: reg.rms };
}

/* ---------- 10  gridding: block median + linear trend + biharmonic spline (Sandwell 1987) or IDW ---------- */
function blockMedian(x, y, v, cell) {
  const m = new Map();
  for (let i = 0; i < x.length; i++) { if (!isF(v[i])) continue; const k = Math.floor(x[i] / cell) + "|" + Math.floor(y[i] / cell); if (!m.has(k)) m.set(k, []); m.get(k).push(i); }
  const bx = [], by = [], bv = [];
  for (const idx of m.values()) { bx.push(median(idx.map(i => x[i]))); by.push(median(idx.map(i => y[i]))); bv.push(median(idx.map(i => v[i]))); }
  return { x: bx, y: by, v: bv };
}
function fitSpline(x, y, v, opt) {
  const B = blockMedian(x, y, v, opt.block), n = B.x.length;
  const T = lstsq(B.x.map((xi, i) => [1, xi / 1000, B.y[i] / 1000]), B.v), tr = (px, py) => T.coef[0] + T.coef[1] * px / 1000 + T.coef[2] * py / 1000;
  const r = B.v.map((vi, i) => vi - tr(B.x[i], B.y[i])), md2 = opt.mindist ** 2;
  const green = (dx, dy) => { const d2 = dx * dx + dy * dy + md2; return d2 * (0.5 * Math.log(d2) - 1); };
  const A = []; let diag = 0;
  for (let i = 0; i < n; i++) { const row = new Float64Array(n); for (let j = 0; j < n; j++) row[j] = green(B.x[i] - B.x[j], B.y[i] - B.y[j]); A.push(row); diag += Math.abs(row[i]); }
  const lam = opt.damping * (diag / n || 1);
  for (let i = 0; i < n; i++) A[i][i] += lam;
  const f = solve(A.map(rw => Array.from(rw)), r.slice());
  return { predict: (px, py) => { let s = tr(px, py); for (let j = 0; j < n; j++) s += f[j] * green(px - B.x[j], py - B.y[j]); return s; }, nData: n };
}
function fitIDW(x, y, v, opt) {
  const B = blockMedian(x, y, v, opt.block), p = opt.power;
  return { predict: (px, py) => { let sw = 0, s = 0; for (let j = 0; j < B.x.length; j++) { const d2 = (px - B.x[j]) ** 2 + (py - B.y[j]) ** 2; if (d2 < 1) return B.v[j]; const w = Math.pow(d2, -p / 2); sw += w; s += w * B.v[j]; } return s / sw; }, nData: B.x.length };
}
/* grid stations s[] (with lat, lon and value fn) on a local metric grid; returns {nx, ny, x0, y0, cell, z (row 0 = south), mask, local} */
function gridStations(pts, opt) {
  const lat0 = mean(pts.map(p => p.lat)), lon0 = mean(pts.map(p => p.lon)), L = makeLocal(lat0, lon0);
  const xy = pts.map(p => L.fwd(p.lat, p.lon)), x = xy.map(q => q[0]), y = xy.map(q => q[1]), v = pts.map(p => p.v);
  const pad = opt.blankKm * 1000, x0 = Math.min(...x) - pad, x1 = Math.max(...x) + pad, y0 = Math.min(...y) - pad, y1 = Math.max(...y) + pad;
  const nx = Math.floor((x1 - x0) / opt.cell) + 1, ny = Math.floor((y1 - y0) / opt.cell) + 1;
  const model = opt.method === "idw" ? fitIDW(x, y, v, opt) : fitSpline(x, y, v, opt);
  const z = new Float64Array(nx * ny), mask = new Uint8Array(nx * ny);
  // blanking by distance to the nearest station (coarse bucket search)
  const bs = Math.max(pad, opt.cell), buckets = new Map();
  x.forEach((xi, i) => { const k = Math.floor(xi / bs) + "|" + Math.floor(y[i] / bs); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(i); });
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const px = x0 + c * opt.cell, py = y0 + r * opt.cell, i = r * nx + c;
    z[i] = model.predict(px, py);
    const bx = Math.floor(px / bs), by = Math.floor(py / bs); let near = false;
    for (let a = -1; a <= 1 && !near; a++) for (let b = -1; b <= 1 && !near; b++) for (const j of (buckets.get((bx + a) + "|" + (by + b)) || [])) if ((x[j] - px) ** 2 + (y[j] - py) ** 2 <= pad * pad) { near = true; break; }
    mask[i] = near ? 1 : 0;
  }
  return { nx, ny, x0, y0, cell: opt.cell, z, mask, local: L, nData: model.nData };
}
/* block K-fold cross-validation of the gridding method (random blocks of blockKm) */
function crossValidate(pts, opt, folds = 5, blockKm = 2) {
  const lat0 = mean(pts.map(p => p.lat)), lon0 = mean(pts.map(p => p.lon)), L = makeLocal(lat0, lon0);
  const xy = pts.map(p => L.fwd(p.lat, p.lon)); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const blockId = new Map(); const fold = xy.map(([x, y]) => { const k = Math.floor(x / (blockKm * 1000)) + "|" + Math.floor(y / (blockKm * 1000)); if (!blockId.has(k)) blockId.set(k, Math.floor(rnd() * folds)); return blockId.get(k); });
  const err = [];
  for (let f = 0; f < folds; f++) {
    const tr = [], te = []; xy.forEach((q, i) => (fold[i] === f ? te : tr).push(i));
    if (!te.length || tr.length < 10) continue;
    const m = opt.method === "idw" ? fitIDW(tr.map(i => xy[i][0]), tr.map(i => xy[i][1]), tr.map(i => pts[i].v), opt) : fitSpline(tr.map(i => xy[i][0]), tr.map(i => xy[i][1]), tr.map(i => pts[i].v), opt);
    te.forEach(i => err.push(m.predict(xy[i][0], xy[i][1]) - pts[i].v));
  }
  return Math.sqrt(mean(err.map(e => e * e)));
}
/* contour lines by marching squares: returns array of segments [x1,y1,x2,y2] in grid index units, per level */
function contours(g, levels) {
  const { nx, ny, z, mask } = g, out = [];
  for (const lv of levels) {
    const segs = [];
    for (let r = 0; r < ny - 1; r++) for (let c = 0; c < nx - 1; c++) {
      const i = r * nx + c, q = [i, i + 1, i + nx + 1, i + nx];
      if (mask && q.some(k => !mask[k])) continue;
      const v = q.map(k => z[k]), P = [[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]], pts = [];
      for (let e = 0; e < 4; e++) { const a = v[e], b = v[(e + 1) % 4]; if ((a < lv) !== (b < lv)) { const t = (lv - a) / (b - a), A = P[e], B = P[(e + 1) % 4]; pts.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]); } }
      if (pts.length === 2) segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
      else if (pts.length === 4) { segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]); segs.push([pts[2][0], pts[2][1], pts[3][0], pts[3][1]]); }
    }
    out.push({ level: lv, segs });
  }
  return out;
}

/* ---------- the whole chain ---------- */
function run(input, Praw, longman) {
  const P = mergeParams(Praw), t0 = Date.now(), log = [];
  const files = input.files.map(parseAny);
  const rows = files.flatMap(f => f.rows);
  if (!rows.length) throw new Error("No readings found in the files.");
  log.push(`${rows.length} readings from ${files.length} file(s)`);
  const lookup = input.stations && input.stations.length ? stationIndex(input.stations) : null;
  // readings without their own position take the tide position from the station table (or the survey centre)
  if (rows.some(r => !isF(r.LatGPS))) {
    const st = input.stations || [], cLat = median(st.map(s => s.lat)), cLon = median(st.map(s => s.lon));
    for (const r of rows) if (!isF(r.LatGPS)) { const s = lookup && lookup(r.inst, r.Date, r.Line, r.Station); r.LatGPS = s ? s.lat : cLat; r.LonGPS = s ? s.lon : cLon; r.tidePosFrom = s ? "table" : "centre"; }
    if (rows.some(r => !isF(r.LatGPS))) throw new Error("The readings have no positions and there is no station table: the Earth tide cannot be computed. Add lat and lon columns or a station table.");
  }
  applyTide(rows, P, longman);
  assignOccupations(rows, P);
  rowQC(rows, P);
  const occ = buildOccupations(rows, P);
  attachPositions(occ, lookup, P);
  const ref = { base: input.ref && input.ref.base ? Object.assign({}, input.ref.base) : null, hotel: input.ref && input.ref.hotel ? input.ref.hotel : null };
  if (!ref.base) { // base reference from the station table or the CG-6 GPS
    const s = lookup && lookup("", "", P.base.line, P.base.station), b = occ.filter(o => o.role === "base");
    ref.base = s ? { lat: s.lat, lon: s.lon, H: s.H, u: s.u, tc: s.tc } : { lat: median(b.map(o => o.latCg6)), lon: median(b.map(o => o.lonCg6)), H: median(b.map(o => o.elevCg6)), u: NaN, tc: NaN };
  }
  const base = baseControl(occ, ref, P);
  const scale = instrumentScale(occ, base, P);
  const st = reductions(occ, ref);
  const profiles = buildProfiles(st, P);
  log.push(`processed in ${Date.now() - t0} ms`);
  return { P, files, rows, occ, st, ref, base, scale, profiles, log };
}

const API = { DEFAULTS, mergeParams, parseCG6, parseReadingsCSV, parseAny, parseCSV, normaliseStations, stationIndex, run, SB, CB, nettleton, gridStations, crossValidate, contours, fitSpline, blockMedian,
  makeLocal, haversine, normalGravity, freeAir, median, mean, std };
if (typeof module !== "undefined") module.exports = API;
return API;
})();
