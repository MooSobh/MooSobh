/* ===== Wadi Ghadir Gravity Lab: 2-D modelling, inversion and spectra (no DOM) =====
   Written by Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics), Hannover.

   Section coordinates: x along the profile [m], z depth [m, positive down]. Densities are contrasts in kg/m³.
   The data along a section are relative (mean removed), so every response is centred before it is compared. */
const MOD = (function () {
"use strict";
const GLb = typeof GL !== "undefined" ? GL : global.GL;

/* ---------- 2-D bodies (Talwani) ---------- */
// GL.poly2d expects the vertices clockwise in (x right, z down), i.e. a positive shoelace sum in (x, z)
function oriented(xs, zs) {
  let a = 0; for (let k = 0; k < xs.length; k++) { const k2 = (k + 1) % xs.length; a += xs[k] * zs[k2] - xs[k2] * zs[k]; }
  return a >= 0 ? [xs, zs] : [xs.slice().reverse(), zs.slice().reverse()];
}
/* response [mGal] of one polygon body {xy: [[x, z], ...], drho} at the stations x (on the surface z = 0) */
function bodyResponse(x, body, drho) {
  const [xs, zs] = oriented(body.xy.map(p => p[0]), body.xy.map(p => Math.max(0, p[1])));
  const r = drho === undefined ? body.drho : drho;
  return x.map(x0 => GLb.poly2d(x0, 0, xs, zs, r / 1000));
}
function centred(a) { let m = 0, n = 0; for (const v of a) if (Number.isFinite(v)) { m += v; n++; } m /= n || 1; return a.map(v => v - m); }
function forward(x, bodies) {
  const out = new Array(x.length).fill(0);
  for (const b of bodies) { const r = bodyResponse(x, b); for (let i = 0; i < x.length; i++) out[i] += r[i]; }
  return out;
}
/* least-squares density contrasts of the bodies (shapes fixed); the data and responses are centred */
function fitDensities(x, d, bodies) {
  const n = bodies.length; if (!n) return [];
  const A = bodies.map(b => centred(bodyResponse(x, b, 1))), dc = centred(d);
  const N = A.map(a => A.map(b => a.reduce((s, v, i) => s + v * b[i], 0))), rhs = A.map(a => a.reduce((s, v, i) => s + v * dc[i], 0));
  const tr = N.reduce((s, r, i) => s + r[i], 0) / n; N.forEach((r, i) => { r[i] += 1e-9 * tr; });
  return GLb.cholSolve(N, rhs).x;
}
function rms(a, b) { let s = 0, n = 0; for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) { s += (a[i] - b[i]) ** 2; n++; } return Math.sqrt(s / (n || 1)); }

/* ---------- smooth 2-D inversion on a rectangular mesh ---------- */
function mesh(L, o) {
  const pad = o.pad !== undefined ? o.pad : Math.max(o.zmax, 0.25 * L), nx = Math.ceil((L + 2 * pad) / o.cw), nz = o.nz;
  const x0 = L / 2 - nx * o.cw / 2, xe = Array.from({ length: nx + 1 }, (_, i) => x0 + i * o.cw), dz = o.zmax / nz;
  const ze = Array.from({ length: nz + 1 }, (_, i) => i * dz);
  return { xe, ze, nx, nz, nc: nx * nz, cw: o.cw, dz };
}
/* sensitivity [mGal per kg/m³], row-major nd × nc, columns centred; cell j = iz·nx + ix */
function sensitivity(x, M) {
  const nd = x.length, G = new Float64Array(nd * M.nc);
  for (let iz = 0; iz < M.nz; iz++) for (let ix = 0; ix < M.nx; ix++) {
    const j = iz * M.nx + ix, xa = M.xe[ix], xb = M.xe[ix + 1], za = M.ze[iz], zb = M.ze[iz + 1];
    let mean = 0;
    for (let i = 0; i < nd; i++) { const v = GLb.poly2d(x[i], 0, [xa, xb, xb, xa], [za, za, zb, zb], 0.001); G[i * M.nc + j] = v; mean += v; }
    mean /= nd; for (let i = 0; i < nd; i++) G[i * M.nc + j] -= mean;
  }
  // a rectangle listed this way is clockwise for poly2d; check the sign once (dense cell -> positive)
  if (GLb.poly2d(0, 0, [-50, 50, 50, -50], [100, 100, 200, 200], 1) < 0) for (let k = 0; k < G.length; k++) G[k] = -G[k];
  return G;
}
/* banded Cholesky of the symmetric matrix stored as rows of the lower band: B[i*(b+1) + (i-j)] */
function bandChol(B, n, b) {
  const w = b + 1;
  for (let i = 0; i < n; i++) for (let j = Math.max(0, i - b); j <= i; j++) {
    let s = B[i * w + (i - j)];
    for (let k = Math.max(0, i - b, j - b); k < j; k++) s -= B[i * w + (i - k)] * B[j * w + (j - k)];
    if (i === j) { if (s <= 0) throw new Error("regularisation matrix is not positive definite"); B[i * w] = Math.sqrt(s); }
    else B[i * w + (i - j)] = s / B[j * w];
  }
  return B;
}
function bandFwd(Lb, n, b, g, out) { const w = b + 1; for (let i = 0; i < n; i++) { let s = g[i]; for (let k = Math.max(0, i - b); k < i; k++) s -= Lb[i * w + (i - k)] * out[k]; out[i] = s / Lb[i * w]; } return out; }
function bandBack(Lb, n, b, y, out) { const w = b + 1; for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k <= Math.min(n - 1, i + b); k++) s -= Lb[k * w + (k - i)] * out[k]; out[i] = s / Lb[i * w]; } return out; }
function depthWeights(M, z0, beta) {
  return Array.from({ length: M.nc }, (_, j) => { const iz = Math.floor(j / M.nx), zc = (M.ze[iz] + M.ze[iz + 1]) / 2; return Math.pow(1 + zc / z0, -beta / 2); });
}
/* prepare the inversion: objective  Σ((G m − d)/σ)² + λ‖R m‖²,  R = W·[√αs I; √αx Dx; √αz Dz]
   with the depth weighting W = (1 + z/z0)^(−β/2) and αx = (Ls/Δx)², αz = (Ls/Δz)² (Ls: smoothness length).
   With RᵀR = L Lᵀ and Ĝ = G L⁻ᵀ/σ, the model for any λ is m = L⁻ᵀ Ĝᵀ (Ĝ Ĝᵀ + λ I)⁻¹ d/σ. */
function prepare(x, d, M, o) {
  const nd = x.length, nc = M.nc, b = M.nx, w = b + 1, sig = o.sigma;
  const G = o.G || sensitivity(x, M), W = depthWeights(M, o.z0, o.beta);
  const ax = (o.ls / M.cw) ** 2, az = (o.ls / M.dz) ** 2, B = new Float64Array(nc * w);
  for (let j = 0; j < nc; j++) B[j * w] += W[j] * W[j];
  for (let iz = 0; iz < M.nz; iz++) for (let ix = 0; ix < M.nx; ix++) {
    const j = iz * M.nx + ix;
    if (ix + 1 < M.nx) { const q = ax * W[j] * W[j]; B[j * w] += q; B[(j + 1) * w] += q; B[(j + 1) * w + 1] -= q; }
    if (iz + 1 < M.nz) { const k = j + M.nx, q = az * ((W[j] + W[k]) / 2) ** 2; B[j * w] += q; B[k * w] += q; B[k * w + M.nx] -= q; }
  }
  bandChol(B, nc, b);
  const Gh = new Float64Array(nd * nc), tmp = new Float64Array(nc);
  for (let i = 0; i < nd; i++) { bandFwd(B, nc, b, G.subarray(i * nc, (i + 1) * nc), tmp); for (let j = 0; j < nc; j++) Gh[i * nc + j] = tmp[j] / sig; }
  const K = new Float64Array(nd * nd);
  for (let i = 0; i < nd; i++) for (let k = 0; k <= i; k++) { let s = 0; const oi = i * nc, ok = k * nc; for (let j = 0; j < nc; j++) s += Gh[oi + j] * Gh[ok + j]; K[i * nd + k] = K[k * nd + i] = s; }
  let tr = 0; for (let i = 0; i < nd; i++) tr += K[i * nd + i];
  const dc = centred(d), dh = dc.map(v => v / sig);
  return { x, d: dc, dh, nd, nc, M, G, Gh, K, L: B, b, sig, scale: tr / nd };
}
function cholDense(A, n) {   // in place, lower triangle
  for (let j = 0; j < n; j++) { let s = A[j * n + j]; for (let k = 0; k < j; k++) s -= A[j * n + k] ** 2; if (s <= 0) throw new Error("singular"); const l = Math.sqrt(s); A[j * n + j] = l;
    for (let i = j + 1; i < n; i++) { let t = A[i * n + j]; for (let k = 0; k < j; k++) t -= A[i * n + k] * A[j * n + k]; A[i * n + j] = t / l; } }
  return A;
}
function cholSolveDense(Lc, n, b) { const y = new Float64Array(n); for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= Lc[i * n + k] * y[k]; y[i] = s / Lc[i * n + i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= Lc[k * n + i] * y[k]; y[i] = s / Lc[i * n + i]; } return y; }
/* misfit and model norm for a relative λ (λ = rel × mean diagonal of ĜĜᵀ); the model only when asked */
function solve(P, rel, wantModel) {
  const n = P.nd, lam = rel * P.scale, A = Float64Array.from(P.K);
  for (let i = 0; i < n; i++) A[i * n + i] += lam;
  const c = cholSolveDense(cholDense(A, n), n, P.dh);
  let chi2 = 0, phim = 0; for (let i = 0; i < n; i++) chi2 += (lam * c[i]) ** 2;
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < n; k++) s += P.K[i * n + k] * c[k]; phim += c[i] * s; }
  const out = { rel, lam, chi2, chi2n: chi2 / n, phim };
  if (wantModel) {
    const y = new Float64Array(P.nc); for (let i = 0; i < n; i++) { const ci = c[i], o = i * P.nc; for (let j = 0; j < P.nc; j++) y[j] += P.Gh[o + j] * ci; }
    const m = bandBack(P.L, P.nc, P.b, y, new Float64Array(P.nc)), pred = new Array(n).fill(0);
    for (let i = 0; i < n; i++) { let s = 0; const o = i * P.nc; for (let j = 0; j < P.nc; j++) s += P.G[o + j] * m[j]; pred[i] = s; }
    Object.assign(out, { m, pred, rms: rms(pred, P.d) });
  }
  return out;
}
const lcurve = (P, rels) => rels.map(r => solve(P, r, false));
/* the relative λ with χ²/N = 1 (discrepancy principle), by bisection in log λ */
function autoLambda(P) {
  let lo = -9, hi = 4;
  if (solve(P, Math.pow(10, lo)).chi2n > 1) return Math.pow(10, lo);
  if (solve(P, Math.pow(10, hi)).chi2n < 1) return Math.pow(10, hi);
  for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (solve(P, Math.pow(10, mid)).chi2n > 1) hi = mid; else lo = mid; }
  return Math.pow(10, (lo + hi) / 2);
}

/* ---------- grid helpers: radial power spectrum and polynomial trend ---------- */
function radialSpectrum(g, nbins) {
  const { nx, ny, cell, z } = g; let Nx = 1, Ny = 1; while (Nx < nx + 32) Nx <<= 1; while (Ny < ny + 32) Ny <<= 1;
  const ox = (Nx - nx) >> 1, oy = (Ny - ny) >> 1, pw = Math.max(6, Math.min(ox, oy) - 1); let mean = 0; for (const v of z) mean += v; mean /= z.length;
  const re = new Float64Array(Nx * Ny), im = new Float64Array(Nx * Ny);
  for (let r = 0; r < Ny; r++) for (let c = 0; c < Nx; c++) { const rr = Math.max(0, Math.min(ny - 1, r - oy)), cc = Math.max(0, Math.min(nx - 1, c - ox)), d = Math.hypot(r - oy - rr, c - ox - cc);
    const w = d >= pw ? 0 : 0.5 * (1 + Math.cos(Math.PI * d / pw)); re[r * Nx + c] = (z[rr * nx + cc] - mean) * w; }
  GLb.fft2(re, im, Nx, Ny, false);
  const kNy = Math.PI / cell, dk = 2 * Math.PI / (Math.max(Nx, Ny) * cell), nb = nbins || Math.floor(kNy / dk), S = new Float64Array(nb), C = new Float64Array(nb);
  for (let r = 0; r < Ny; r++) { const ky = 2 * Math.PI * (r <= Ny / 2 ? r : r - Ny) / (Ny * cell); for (let c = 0; c < Nx; c++) {
    const kx = 2 * Math.PI * (c <= Nx / 2 ? c : c - Nx) / (Nx * cell), k = Math.hypot(kx, ky), b = Math.floor(k / dk);
    if (b < 1 || b >= nb) continue; const i = r * Nx + c; S[b] += re[i] * re[i] + im[i] * im[i]; C[b]++; } }
  const k = [], lnP = [];
  for (let b = 1; b < nb; b++) if (C[b] > 0 && S[b] > 0) { k.push((b + 0.5) * dk * 1000); lnP.push(Math.log(S[b] / C[b])); }
  return { k, lnP };             // k in rad/km
}
/* straight-line fit of ln P against k (rad/km) in [k0, k1]: depth = −slope / 2 [km] */
function depthFit(sp, k0, k1) {
  const ii = sp.k.map((v, i) => i).filter(i => sp.k[i] >= k0 && sp.k[i] <= k1); if (ii.length < 3) return null;
  const xs = ii.map(i => sp.k[i]), ys = ii.map(i => sp.lnP[i]), n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const slope = sxy / sxx; return { slope, icpt: my - slope * mx, depth: -slope / 2, k0, k1, n };
}
/* least-squares polynomial surface of the given order through the nodes with mask, evaluated on the whole grid */
function polyTrend(g, order) {
  const terms = []; for (let t = 0; t <= order; t++) for (let i = 0; i <= t; i++) terms.push([t - i, i]);
  const sx = g.nx * g.cell / 2, sy = g.ny * g.cell / 2, fx = c => (c * g.cell - sx) / sx, fy = r => (r * g.cell - sy) / sy;
  const u = terms.length, N = Array.from({ length: u }, () => new Array(u).fill(0)), b = new Array(u).fill(0);
  for (let r = 0; r < g.ny; r++) for (let c = 0; c < g.nx; c++) { const i = r * g.nx + c; if (!g.mask[i]) continue;
    const X = fx(c), Y = fy(r), a = terms.map(([p, q]) => Math.pow(X, p) * Math.pow(Y, q));
    for (let j = 0; j < u; j++) { b[j] += a[j] * g.z[i]; for (let k = 0; k < u; k++) N[j][k] += a[j] * a[k]; } }
  for (let j = 0; j < u; j++) N[j][j] *= 1 + 1e-12;
  const coef = GLb.cholSolve(N, b).x, out = new Float64Array(g.nx * g.ny);
  for (let r = 0; r < g.ny; r++) for (let c = 0; c < g.nx; c++) { const X = fx(c), Y = fy(r); let s = 0; terms.forEach(([p, q], j) => { s += coef[j] * Math.pow(X, p) * Math.pow(Y, q); }); out[r * g.nx + c] = s; }
  return out;
}

const API = { oriented, bodyResponse, forward, fitDensities, centred, rms, mesh, sensitivity, depthWeights, prepare, solve, lcurve, autoLambda, radialSpectrum, depthFit, polyTrend };
if (typeof module !== "undefined") module.exports = API;
return API;
})();
