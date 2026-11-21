#!/usr/bin/env python3
"""Synthetic TEM and AMT study of the one-week EM lines: what each profile can detect, and to what depth.

For every TEM and AMT station of the one-week plan (scripts/design_em_survey.py):

1. A true resistivity model is built below the station from the gravity and magnetic inversions (the mean of the
   joint compact, separate compact and smooth models) with a petrophysical scenario:
   serpentinite (light and magnetic) wet and actively altering 30 ohm m, or dry 800 ohm m; dense rock 3000;
   other light rock 600; host basement 2000; a 20 m weathered or wadi-fill layer of 300 ohm m on top.
2. TEM (central loop of the planned size, 10 A, 10 us - 10 ms, 3 % + 10 nV/m2 noise, gates below twice the
   noise floor dropped) and AMT (10 Hz - 10 kHz, 5 % in apparent resistivity, 1.5 deg in phase) are forward-modelled
   in 1-D with SimPEG and inverted, each twice with references 0.1x and 10x the background. The two models give the
   depth of investigation (Oldenburg and Li 1999: DOI index 0.3) and their mean is the recovered model.
3. Detectability: the largest difference, in noise units, between the response with the serpentinite and the
   response with host rock in its place; above 3 the body is detectable.

Outputs (outputs/em_survey/synthetic/): one figure per line (true model, TEM and AMT recovered sections with
their DOI, detectability profile), em_synthetic_summary.csv and EM_Synthetic_Study.pdf.

Run after scripts/design_em_survey.py:   python scripts/em_synthetic.py   (about 10 minutes on 4 cores;
--replot redraws the figures from the saved results)

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import os
import sys
import time
import warnings
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
OUT = os.path.join(ROOT, "outputs", "em_survey", "synthetic")
AUTHOR = "written by Mohamed Sobh, LIAG"

RHO = {"host": 2000.0, "serp_wet": 30.0, "serp_dry": 800.0, "dense": 3000.0, "light": 600.0, "cover": 300.0}
COVER_M = 20.0
TEM_TIMES = np.logspace(-5, -2, 28)
TEM_I, TEM_REL, TEM_FLOOR = 10.0, 0.03, 1e-8
AMT_F = np.logspace(4, 1, 19)
AMT_REL, AMT_PHASE = 0.05, 1.5
DOI_CUT = 0.3
TEM_STEP = 100.0          # invert every TEM station at least this far apart


# ----------------------------------------------------------------------------- 1-D forward and inverse (worker side)
def _quiet():
    warnings.filterwarnings("ignore")
    import logging
    logging.getLogger("simpeg").setLevel(logging.ERROR)


def tem_sim(loop_m, thick):
    from simpeg import maps
    from simpeg.electromagnetics import time_domain as tdem
    rx = tdem.receivers.PointMagneticFluxTimeDerivative(np.array([[0.0, 0.0, 0.5]]), TEM_TIMES, "z")
    src = tdem.sources.CircularLoop([rx], location=np.r_[0.0, 0.0, 0.5], radius=loop_m / np.sqrt(np.pi), current=TEM_I,
                                    waveform=tdem.sources.StepOffWaveform())
    return tdem.Simulation1DLayered(survey=tdem.Survey([src]), thicknesses=thick, sigmaMap=maps.ExpMap(nP=len(thick) + 1))


def amt_sim(thick):
    from simpeg import maps
    from simpeg.electromagnetics import natural_source as nsem
    rxs = [nsem.receivers.Impedance(np.array([[0.0, 0.0, 0.0]]), orientation="xy", component=c) for c in ("apparent_resistivity", "phase")]
    srcs = [nsem.sources.PlanewaveXYPrimary(rxs, frequency=f) for f in AMT_F]
    # Simulation1DRecursive orders layers from the bottom up: reverse, so the model runs top-down as for TEM
    import scipy.sparse as sp
    n = len(thick) + 1
    flip = maps.LinearMap(sp.csr_matrix(np.eye(n)[::-1]))
    return nsem.Simulation1DRecursive(survey=nsem.Survey(srcs), thicknesses=np.asarray(thick)[::-1], sigmaMap=maps.ExpMap(nP=n) * flip)


def invert(sim, dobs, std, thick, ref_rho, start_rho=300.0, occam=False):
    """Smooth 1-D inversion in log-conductivity, started from start_rho with reference ref_rho (Gauss-Newton;
    a bounded solver takes over if a step leaves the physical range)."""
    import contextlib
    import io
    from discretize import TensorMesh
    from simpeg import data, data_misfit, directives, inverse_problem, inversion, optimization, regularization
    # occam: every layer counts the same in the regularisation (smoothness in log-depth, as the layers are log-spaced)
    mesh = TensorMesh([np.ones(len(thick) + 1)]) if occam else TensorMesh([np.r_[thick, thick[-1]]])
    mref = np.full(mesh.n_cells, np.log(1.0 / ref_rho))
    m0 = np.full(mesh.n_cells, np.log(1.0 / start_rho))
    best = None
    for opt in (optimization.InexactGaussNewton(maxIter=40, maxIterCG=40),
                optimization.ProjectedGNCG(maxIter=40, maxIterCG=50, lower=np.log(1e-5), upper=np.log(1.0))):
        dm = data_misfit.L2DataMisfit(data=data.Data(sim.survey, dobs=dobs, standard_deviation=std), simulation=sim)
        reg = regularization.WeightedLeastSquares(mesh, alpha_s=1e-2 if occam else 1e-3, alpha_x=1.0, reference_model=mref)
        ip = inverse_problem.BaseInvProblem(dm, reg, opt)
        dirs = [directives.BetaEstimate_ByEig(beta0_ratio=10, random_seed=0), directives.BetaSchedule(coolingFactor=2, coolingRate=1),
                directives.TargetMisfit(chifact=1)]
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                m = inversion.BaseInversion(ip, dirs).run(m0)
            chi2 = float(dm(m) / len(dobs))
        except Exception:
            continue
        if np.isfinite(chi2) and (best is None or chi2 < best[1]):
            best = (1.0 / np.exp(m), chi2)
        if best is not None and best[1] < 1.5:
            break
    return best if best is not None else (np.full(mesh.n_cells, ref_rho), np.inf)


def layers(true_top, true_rho, z_max):
    """Inversion layers (log-spaced to z_max) and the true model as thicknesses for the forward run."""
    inv_thick = np.diff(np.r_[0.0, np.geomspace(8.0, z_max, 32)])
    return inv_thick, np.diff(true_top), true_rho


def run_station(job):
    """job: dict(kind, loop, tops, rhos (wet), rhos_dry, rhos_host, seed). Returns recovered models, DOI and detectability."""
    _quiet()
    kind, tops, rng = job["kind"], np.asarray(job["tops"]), np.random.default_rng(job["seed"])
    thick_true = np.diff(tops)
    if kind == "TEM":
        fwd = lambda r: tem_sim(job["loop"], thick_true).dpred(np.log(1.0 / np.asarray(r)))  # noqa: E731
        d, d_dry, d_host = fwd(job["rhos"]), fwd(job["rhos_dry"]), fwd(job["rhos_host"])
        std = TEM_REL * np.abs(d) + TEM_FLOOR
        keep = np.abs(d) > 2 * TEM_FLOOR
        det_wet = float(np.max(np.abs(d - d_host)[keep] / std[keep])) if keep.any() else 0.0
        det_dry = float(np.max(np.abs(d_dry - d_host)[keep] / std[keep])) if keep.any() else 0.0
        dobs = d + rng.normal(0, 1, d.size) * std
        z_max = 1500.0
        inv_thick = np.diff(np.r_[0.0, np.geomspace(8.0, z_max, 32)])
        sim_full = tem_sim(job["loop"], inv_thick)
        # drop the gates below the noise: rebuild the survey with the kept times
        from simpeg.electromagnetics import time_domain as tdem
        from simpeg import maps
        t_keep = TEM_TIMES[keep]
        rx = tdem.receivers.PointMagneticFluxTimeDerivative(np.array([[0.0, 0.0, 0.5]]), t_keep, "z")
        src = tdem.sources.CircularLoop([rx], location=np.r_[0.0, 0.0, 0.5], radius=job["loop"] / np.sqrt(np.pi), current=TEM_I,
                                        waveform=tdem.sources.StepOffWaveform())
        sim_full = tdem.Simulation1DLayered(survey=tdem.Survey([src]), thicknesses=inv_thick, sigmaMap=maps.ExpMap(nP=len(inv_thick) + 1))
        dobs, std = dobs[keep], std[keep]
        background = 1000.0
    else:
        sim_t = amt_sim(thick_true)
        fwd = lambda r: sim_t.dpred(np.log(1.0 / np.asarray(r)))  # noqa: E731
        d, d_dry, d_host = fwd(job["rhos"]), fwd(job["rhos_dry"]), fwd(job["rhos_host"])
        ra, ph = d[0::2], d[1::2]
        std = np.empty_like(d)
        std[0::2], std[1::2] = AMT_REL * np.abs(ra), AMT_PHASE
        det_wet = float(np.max(np.abs(d - d_host) / std))
        det_dry = float(np.max(np.abs(d_dry - d_host) / std))
        dobs = d + rng.normal(0, 1, d.size) * std
        z_max = 4000.0
        inv_thick = np.diff(np.r_[0.0, np.geomspace(10.0, z_max, 34)])
        sim_full = amt_sim(inv_thick)
        background = 1000.0
    lo, chi_lo = invert(sim_full, dobs, std, inv_thick, background / 10, occam=kind == "AMT")
    hi, chi_hi = invert(sim_full, dobs, std, inv_thick, background * 10, occam=kind == "AMT")
    R = np.abs(np.log(lo) - np.log(hi)) / np.log(100.0)                 # DOI index (Oldenburg and Li 1999)
    zc = np.r_[0.0, np.cumsum(inv_thick)]
    zc = (zc + np.r_[zc[1:], zc[-1] + inv_thick[-1]]) / 2
    # DOI: the top of the deepest run of layers where the two models part (index above the cut all the way down)
    ok = np.nonzero(R <= DOI_CUT)[0]
    doi = float(zc[min(ok[-1] + 1, len(zc) - 1)]) if len(ok) else 0.0
    if kind == "AMT":                     # below a good conductor the low frequencies see no deeper than their Bostick depth
        doi = min(doi, float(356.0 * np.sqrt(max(dobs[-2], 1.0) / AMT_F.min())))
    rec = np.exp((np.log(lo) + np.log(hi)) / 2)
    zmin = float(356.0 * np.sqrt(max(dobs[0], 1.0) / AMT_F.max())) if kind == "AMT" else 0.0     # AMT: shallowest resolvable depth
    return dict(station=job["station"], kind=kind, z=zc.tolist(), rho=rec.tolist(), doi=doi, zmin=zmin, chi2=(chi_lo + chi_hi) / 2,
                det_wet=det_wet, det_dry=det_dry)


# ----------------------------------------------------------------------------- true models along the lines (main side)
def petro(rbar, cbar, serp):
    r = np.full(rbar.shape, RHO["host"])
    r[rbar >= 0.05] = RHO["dense"]
    r[(rbar <= -0.05) & (cbar < 0.005)] = RHO["light"]
    r[(rbar <= -0.02) & (cbar >= 0.005)] = serp
    return r


def build_jobs(wlines, wst):
    import design_em_survey as E
    from wghadir import inversion as W
    mesh, act, rho, chi, g, m = E.load()
    gg = dict(np.load(os.path.join(E.INV, "gravity_model.npz")))
    mm = dict(np.load(os.path.join(E.INV, "magnetic_model.npz")))
    shp = mesh.shape_cells
    as3 = lambda v: np.nan_to_num(v.reshape(shp, order="F"))  # noqa: E731
    rbar = np.mean([as3(rho), as3(W.model_on_mesh(mesh, act, gg["rho_gcc"])), as3(W.model_on_mesh(mesh, act, gg["rho_smooth_gcc"]))], axis=0)
    cbar = np.mean([as3(chi), as3(W.model_on_mesh(mesh, act, mm["chi_SI"])), as3(W.model_on_mesh(mesh, act, mm["chi_smooth_SI"]))], axis=0)
    A = act.reshape(shp, order="F")
    xe, ye, ze = mesh.nodes_x, mesh.nodes_y, mesh.nodes_z
    jobs = []
    sel = []
    for ln in wlines:
        for kind in ("TEM", "AMT"):
            s = wst[(wst.line == ln["id"]) & (wst.method == kind)]
            if kind == "TEM" and len(s):
                s = s[np.isclose(np.mod(s.distance_m, TEM_STEP), 0) | np.isclose(np.mod(s.distance_m, TEM_STEP), TEM_STEP)]
            sel.append(s)
            for r in s.itertuples():
                i = int(np.clip(np.searchsorted(xe, r.easting) - 1, 0, shp[0] - 1))
                j = int(np.clip(np.searchsorted(ye, r.northing) - 1, 0, shp[1] - 1))
                ks = np.nonzero(A[i, j])[0][::-1]                      # active cells, top down
                surf = ze[ks[0] + 1]
                tops = [0.0, COVER_M]
                vals_r, vals_c = [None], []
                for k in ks:
                    z_top, z_bot = surf - ze[k + 1], surf - ze[k]
                    if z_bot <= COVER_M:
                        continue
                    tops.append(z_bot)
                    vals_c.append((rbar[i, j, k], cbar[i, j, k]))
                    if z_bot > 4000:
                        break
                rb = np.array([v[0] for v in vals_c])
                cb = np.array([v[1] for v in vals_c])
                rhos = {}
                for key, serp in (("rhos", RHO["serp_wet"]), ("rhos_dry", RHO["serp_dry"]), ("rhos_host", None)):
                    body = petro(rb, cb, serp if serp else RHO["host"])
                    if serp is None:
                        body[(rb <= -0.02) & (cb >= 0.005)] = RHO["host"]
                    rhos[key] = np.r_[RHO["cover"], body]
                tops = np.array(tops[:-1] + [tops[-1]])
                jobs.append(dict(line=ln["id"], station=r.station, kind=kind, loop=ln["loop_m"] or 100, distance=r.distance_m,
                                 elevation=float(surf), tops=tops[:len(rhos["rhos"])].tolist(), seed=len(jobs),
                                 serp=((rb <= -0.02) & (cb >= 0.005)).tolist(), **{k: v.tolist() for k, v in rhos.items()}))
    return jobs


def figure(ln, jobs, res, targets):
    import matplotlib.pyplot as plt
    from matplotlib.colors import LogNorm
    norm, cmap = LogNorm(10, 5000), "turbo_r"
    kinds = [k for k in ("TEM", "AMT") if any(j["kind"] == k and j["line"] == ln["id"] for j in jobs)]
    fig, axes = plt.subplots(2 + len(kinds), 1, figsize=(12, 2.6 * (2 + len(kinds)) + 0.6), sharex=True,
                             gridspec_kw={"height_ratios": [1] * (1 + len(kinds)) + [0.7]})
    jt = [j for j in jobs if j["line"] == ln["id"]]
    jt_any = sorted({j["distance"]: j for j in jt}.values(), key=lambda j: j["distance"])
    zmax = 1500 if kinds == ["TEM"] else 3000

    def column_plot(ax, items, getz, getr, doi=None, zmin=None):
        """items: (distance, surface elevation, layer bottoms below surface, resistivities); columns meet half-way between stations."""
        dist = np.array([it[0] for it in items], float)
        if len(dist) == 0:
            return None
        mid = (dist[1:] + dist[:-1]) / 2
        edges = np.r_[dist[0] - (mid[0] - dist[0] if len(mid) else 50), mid, dist[-1] + (dist[-1] - mid[-1] if len(mid) else 50)]
        im = None
        for k, (d, el, z, r) in enumerate(items):
            zt = np.r_[0.0, np.asarray(z, float)]
            rr = np.asarray(r, float).copy()
            if zmin is not None:
                rr[zt[1:] <= zmin[k]] = np.nan                      # above the shallowest resolvable depth
            im = ax.pcolormesh(edges[k:k + 2], el - zt, rr[:, None], norm=norm, cmap=cmap, shading="flat", rasterized=True)
        if doi is not None:
            yd = np.array([el - dz for (_, el, _, _), dz in zip(items, doi)])
            ax.fill_between(dist, yd, -5000, color="w", alpha=0.6, lw=0, zorder=3)
            ax.plot(dist, yd, "k--", lw=1.2, zorder=4)
        return im

    # true model (wet scenario)
    items = [(j["distance"], j["elevation"], j["tops"][1:] + [j["tops"][-1] + 200], j["rhos"]) for j in jt_any]
    im = column_plot(axes[0], items, None, None)
    axes[0].set_title(f"{ln['id']} · true resistivity, scenario: wet serpentinite {RHO['serp_wet']:.0f} Ωm in host {RHO['host']:.0f} Ωm "
                      f"(from the gravity and magnetic inversions)", loc="left", fontsize=9)
    for ax_i, kind in enumerate(kinds, 1):
        rr = [res[j["station"] + kind] for j in jt if j["kind"] == kind]
        jj = [j for j in jt if j["kind"] == kind]
        items = [(j["distance"], j["elevation"], np.r_[np.asarray(r["z"])[1:] - np.diff(r["z"])[0] / 2 + np.diff(r["z"])[0] / 2, r["z"][-1] + 200],
                  r["rho"]) for j, r in zip(jj, rr)]
        items = [(j["distance"], j["elevation"], np.r_[(np.asarray(r["z"])[1:] + np.asarray(r["z"])[:-1]) / 2, r["z"][-1] * 1.1], r["rho"])
                 for j, r in zip(jj, rr)]
        column_plot(axes[ax_i], items, None, None, doi=[r["doi"] for r in rr], zmin=[r["zmin"] for r in rr] if kind == "AMT" else None)
        dm = np.median([r["doi"] for r in rr])
        setup = f"{ln['loop_m']} m loop, 10 A" if kind == "TEM" else "10 Hz-10 kHz"
        axes[ax_i].set_title(f"{kind} ({setup}) · 1-D inversion · DOI (dashed) median {dm:.0f} m, faded below{' · blank: too shallow for 10 kHz' if kind == 'AMT' else ''} · "
                             f"χ² {np.mean([r['chi2'] for r in rr]):.2f}", loc="left", fontsize=8.5)
    for ax in axes[:-1]:
        el = max(j["elevation"] for j in jt_any)
        ax.set_ylim(el - zmax, el + 40)
        ax.set_ylabel("elevation [m]")
    # detectability
    ax = axes[-1]
    for kind, c in (("TEM", "#2e7d32"), ("AMT", "#d35400")):
        jj = [j for j in jt if j["kind"] == kind]
        if not jj:
            continue
        rr = [res[j["station"] + kind] for j in jj]
        ax.semilogy([j["distance"] for j in jj], [max(r["det_wet"], 0.05) for r in rr], "-o", ms=3, color=c, label=f"{kind}: wet serpentinite")
        ax.semilogy([j["distance"] for j in jj], [max(r["det_dry"], 0.05) for r in rr], "--", color=c, alpha=0.7, label=f"{kind}: dry serpentinite")
    ax.axhline(3, color="k", lw=1)
    ax.text(ax.get_xlim()[0], 3.3, " detectable above 3 × noise", fontsize=8)
    ax.set_ylabel("anomaly / noise")
    ax.set_xlabel("distance along the line [m]")
    ax.legend(fontsize=7.5, ncol=4, loc="lower right", framealpha=0.85)
    ax.grid(alpha=0.3, which="both")
    fig.colorbar(im, ax=list(axes[:-1]), shrink=0.6, pad=0.04, label="resistivity [Ωm]")
    fig.suptitle(f"Wadi Ghadir · synthetic EM test of line {ln['id']} ({ln['length_m'] / 1000:.1f} km) · {AUTHOR}", fontsize=11, weight="bold")
    return fig


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages
    import design_em_survey as E
    os.makedirs(OUT, exist_ok=True)
    mesh, act, rho, chi, g, m, targets, lines, st = E.compute()
    wlines, wst, _ = E.week_plan(lines, targets, g, m)
    jobs = build_jobs(wlines, wst)
    cache = os.path.join(OUT, "em_synthetic_results.json")
    if "--replot" in sys.argv and os.path.exists(cache):
        import json
        res = json.load(open(cache))
        out = None
    else:
        res = None
    print(f"{len(jobs)} soundings ({sum(j['kind'] == 'TEM' for j in jobs)} TEM, {sum(j['kind'] == 'AMT' for j in jobs)} AMT), 2 inversions each")
    if res is None:
        t0 = time.time()
        with ProcessPoolExecutor(max_workers=os.cpu_count()) as ex:
            out = list(ex.map(run_station, jobs, chunksize=2))
        res = {r["station"] + r["kind"]: r for r in out}
        import json
        json.dump(res, open(cache, "w"))
        print(f"done in {time.time() - t0:.0f} s")
    rows, figs = [], []
    for ln in wlines:
        jt = [j for j in jobs if j["line"] == ln["id"]]
        row = {"line": ln["id"], "target": ln["target"], "length_km": ln["length_m"] / 1000}
        for kind in ("TEM", "AMT"):
            rr = [res[j["station"] + kind] for j in jt if j["kind"] == kind]
            if not rr:
                continue
            row.update({f"{kind}_soundings": len(rr), f"{kind}_doi_median_m": round(float(np.median([r["doi"] for r in rr]))),
                        f"{kind}_doi_min_m": round(float(np.min([r["doi"] for r in rr]))),
                        f"{kind}_detect_wet_max": round(float(np.max([r["det_wet"] for r in rr])), 1),
                        f"{kind}_detect_dry_max": round(float(np.max([r["det_dry"] for r in rr])), 1),
                        f"{kind}_share_detect_wet": round(float(np.mean([r["det_wet"] > 3 for r in rr])), 2),
                        f"{kind}_chi2": round(float(np.mean([r["chi2"] for r in rr])), 2)})
        # serpentinite depth along the line (true model) for comparison
        tops = [j["tops"][1:][int(np.argmax(j["serp"]))] for j in jt if any(j["serp"])]
        row["serpentinite_top_median_m"] = round(float(np.median(tops))) if tops else None
        rows.append(row)
        fig = figure(ln, jobs, res, targets)
        fig.savefig(os.path.join(OUT, f"em_synthetic_{ln['id']}.png"), dpi=130)
        figs.append(fig)
    summ = pd.DataFrame(rows)
    with open(os.path.join(OUT, "em_synthetic_summary.csv"), "w") as f:
        f.write(f"# Wadi Ghadir synthetic EM study of the one-week lines, {AUTHOR}.\n")
        summ.to_csv(f, index=False)
    fs = plt.figure(figsize=(16.5, 11.7))
    fs.text(0.04, 0.95, "Wadi Ghadir: synthetic EM test of the one-week lines (natural H2)", fontsize=18, weight="bold")
    fs.text(0.04, 0.925, f"{AUTHOR} · 1-D SimPEG forward modelling and inversion at every station · DOI after Oldenburg and Li (1999)", fontsize=10)
    ax = fs.add_axes((0.04, 0.5, 0.92, 0.38))
    ax.axis("off")
    t = ax.table(cellText=summ.astype(object).where(summ.notna(), "").astype(str).values, colLabels=[c.replace("_", " ") for c in summ.columns], loc="upper left", cellLoc="center")
    t.auto_set_font_size(False)
    t.set_fontsize(7.5)
    t.scale(1, 1.6)
    fs.text(0.04, 0.46, "\n".join([
        "Petrophysical scenario (resistivities typical of the rock types; to be checked with R1 and outcrop measurements):",
        f"  serpentinite (light and magnetic in the inversions): wet, fractured, actively altering {RHO['serp_wet']:.0f} Ωm, or dry {RHO['serp_dry']:.0f} Ωm;",
        f"  host basement {RHO['host']:.0f} Ωm · dense rock {RHO['dense']:.0f} Ωm · other light rock {RHO['light']:.0f} Ωm · top {COVER_M:.0f} m weathered or wadi fill {RHO['cover']:.0f} Ωm.",
        f"TEM: central loop of the planned size, {TEM_I:.0f} A, 28 gates 10 µs-10 ms, noise 3 % + {TEM_FLOOR:.0e} V/m², gates below twice the floor dropped.",
        f"AMT: 19 frequencies 10 Hz-10 kHz, noise {AMT_REL * 100:.0f} % in apparent resistivity and {AMT_PHASE}° in phase.",
        "Each sounding is inverted twice (smooth 1-D, references 100 and 10 000 Ωm); where both agree the data control the model, and the depth where",
        f"they part (DOI index {DOI_CUT}) is the depth of investigation. Detectability: largest response difference with and without the serpentinite, in noise units.",
        "Limits: 1-D modelling of a 3-D setting (edges of bodies are smeared), a single scenario of resistivities, and potential-field geometry that is itself uncertain.",
    ]), fontsize=10, va="top", linespacing=1.6)
    with PdfPages(os.path.join(OUT, "EM_Synthetic_Study.pdf")) as pdf:
        pdf.savefig(fs)
        for f_ in figs:
            pdf.savefig(f_)
    plt.close("all")
    print(summ.to_string(index=False))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
