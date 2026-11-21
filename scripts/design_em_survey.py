#!/usr/bin/env python3
"""Design a ground EM survey (TEM + AMT) for Wadi Ghadir from the gravity and magnetic inversions.

Targets are taken from the compact joint SimPEG model of notebook 08: connected bodies of
high susceptibility (chi >= CHI_T) or strong density contrast (|drho| >= RHO_T) in the cells that the data
constrain. Each target gets an EM line across its strike, extending past both contacts, with the
loop size and station spacing chosen from the depth to the top of the body. A regional AMT traverse
follows section A-B of notebook 04 and a short reference line samples a quiet area for the background resistivity.

Outputs (outputs/em_survey/):
    EM_Survey_Plan.pdf          plan sheets: summary, plan map, sections with expected depths, depth of investigation
    em_summary.png, em_plan_map.png, em_sections.png, em_depth_of_investigation.png
    em_lines.csv, em_stations.csv, em_targets.csv, em_survey.gpx, em_survey.kml (field GPS / Google Earth)

Run after notebooks 06-08:  python scripts/design_em_survey.py

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import os
import sys

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from wghadir import inversion as W  # noqa: E402

INV = os.path.join(ROOT, "outputs", "inversion")
OUT = os.path.join(ROOT, "outputs", "em_survey")
AUTHOR = "written by Mohamed Sobh, LIAG"

CHI_T = 0.05          # SI: magnetic body
RHO_T = 0.15          # g/cm3: dense or light body
MIN_CELLS = 6         # smallest body kept (cells of 400 x 400 x 100 m)
N_TARGETS = 6
MIN_SEP_M = 2500.0    # between target centres
MASK_M = 1500.0       # targets only where data lie within this distance (well constrained)
ZMIN = -2500.0        # deepest elevation considered
SECTION_AB = ((34.7448, 24.7058), (34.9490, 24.8117))   # A-B of notebook 04 (lon, lat)

# TEM and AMT settings (typical ground systems)
TEM_CURRENT_A = 10.0
TEM_NOISE = 1e-8      # V/m^2, conservative late-time noise level (Spies 1989)
TEM_LAST_GATE_S = 0.01
AMT_FMIN_HZ = 10.0
RESISTIVITIES = {     # typical ranges [ohm m] (Palacky 1987; Telford et al. 1990)
    "Dry wadi alluvium": (100, 1000),
    "Saline/wet alluvium near the coast": (1, 30),
    "Granitoids, gneiss": (1000, 20000),
    "Metavolcanics, metasediments": (300, 5000),
    "Serpentinite, talc-carbonate": (50, 1000),
    "Graphitic schist, altered shear zones": (1, 100),
    "Massive sulphides, graphite": (0.01, 10),
}


def tem_doi(loop_m, rho):
    """Approximate depth of investigation of a central-loop TEM sounding (Spies 1989), capped by the
    diffusion depth at the last gate."""
    moment = TEM_CURRENT_A * loop_m ** 2
    spies = 0.55 * (moment * np.asarray(rho, float) / TEM_NOISE) ** 0.2
    diffusion = 1261.0 * np.sqrt(np.asarray(rho, float) * TEM_LAST_GATE_S)
    return np.minimum(spies, diffusion)


def amt_depth(rho, f=AMT_FMIN_HZ):
    """Bostick penetration depth of an MT sounding at frequency f."""
    return 356.0 * np.sqrt(np.asarray(rho, float) / f)


def method_for(top_depth):
    """EM set-up from the depth below surface to the top of the target."""
    if top_depth <= 150:
        return {"method": "TEM central loop", "loop_m": 100, "spacing_m": 50, "amt_spacing_m": 0}
    if top_depth <= 500:
        return {"method": "TEM central loop", "loop_m": 200, "spacing_m": 100, "amt_spacing_m": 0}
    return {"method": "TEM + AMT", "loop_m": 400, "spacing_m": 100, "amt_spacing_m": 250}


def load():
    import discretize
    j = dict(np.load(os.path.join(INV, "joint_model.npz")))
    g = dict(np.load(os.path.join(INV, "gravity_model.npz")))
    m = dict(np.load(os.path.join(INV, "magnetic_model.npz")))
    mesh = discretize.TensorMesh([j["hx"], j["hy"], j["hz"]], origin=j["origin"])
    act = j["active"]
    rho, chi = (W.model_on_mesh(mesh, act, j[k]) for k in ("rho_gcc", "chi_SI"))
    return mesh, act, rho, chi, g, m


def find_targets(mesh, act, rho, chi, g, m):
    """Connected bodies of the compact joint model, ranked for EM."""
    from scipy import ndimage
    nx, ny, nz = mesh.shape_cells
    R, C, A = (a.reshape(mesh.shape_cells, order="F") for a in (rho, chi, act))
    xc, yc, zc = mesh.cell_centers_x, mesh.cell_centers_y, mesh.cell_centers_z
    far = (W.far_from_data(xc, yc, g["data_xyz"][:, 0], g["data_xyz"][:, 1], MASK_M)
           | W.far_from_data(xc, yc, m["data_xyz"][:, 0], m["data_xyz"][:, 1], MASK_M)).T      # (nx, ny)
    core = np.zeros((nx, ny), bool)
    core[6:-6, 6:-6] = True                                            # inside the core of the mesh, off its edge
    keep = A & (~far & core)[:, :, None] & (zc >= ZMIN)[None, None, :]
    surf = np.array([[zc[A[i, j]].max() + mesh.h[2][A[i, j]][-1] / 2 if A[i, j].any() else np.nan
                      for j in range(ny)] for i in range(nx)])
    R0, C0 = np.nan_to_num(R), np.nan_to_num(C)
    found = []
    for kind, mask in (("magnetic", keep & (C0 >= CHI_T)), ("dense", keep & (R0 >= RHO_T)), ("light", keep & (R0 <= -RHO_T))):
        lab, n = ndimage.label(mask)
        for c in range(1, n + 1):
            ii, jj, kk = np.nonzero(lab == c)
            if len(ii) < MIN_CELLS:
                continue
            val = C0[ii, jj, kk] if kind == "magnetic" else R0[ii, jj, kk]
            w = np.abs(val)
            e, n_ = np.average(xc[ii], weights=w), np.average(yc[jj], weights=w)
            ztop = (zc[kk] + mesh.h[2][kk] / 2).max()
            zbot = (zc[kk] - mesh.h[2][kk] / 2).min()
            ic, jc = np.argmin(np.abs(xc - e)), np.argmin(np.abs(yc - n_))
            cols = np.unique(np.c_[ii, jj], axis=0)
            col_top = [surf[ci, cj] - (zc[kk[(ii == ci) & (jj == cj)]] + mesh.h[2][kk[(ii == ci) & (jj == cj)]] / 2).max() for ci, cj in cols]
            top_depth = max(0.0, float(np.nanmedian(col_top)))               # median over the footprint
            centre_depth = float(np.nanmedian(surf[ii, jj] - zc[kk]))
            pts = np.c_[xc[cols[:, 0]], yc[cols[:, 1]]]
            if len(pts) >= 3:
                ev, evec = np.linalg.eigh(np.cov(pts.T))
                strike = evec[:, 1] if ev[1] > 1.5 * ev[0] else np.array([np.sin(np.radians(45)), np.cos(np.radians(45))])
                width = 4 * np.sqrt(max(ev[0], 0)) + 400
            else:
                strike, width = np.array([np.sin(np.radians(45)), np.cos(np.radians(45))]), 400.0
            other = R0[ii, jj, kk].mean() if kind == "magnetic" else C0[ii, jj, kk].mean()
            dense_mag = float(np.mean((R0[ii, jj, kk] >= 0.02) & (C0[ii, jj, kk] >= 0.005)))
            vol = float(np.sum(mesh.h[0][ii] * mesh.h[1][jj] * mesh.h[2][kk]) / 1e9)
            peak = float(val.max() if kind != "light" else val.min())
            # rank: size and contrast, favour shallow bodies and dense + magnetic overlap (sulphide / magnetite potential)
            contrast = float(np.abs(val).mean()) / 0.3
            weight = {"magnetic": 1.6, "dense": 1.2, "light": 0.7}[kind]           # EM interest: magnetic > dense > light
            score = min(vol, 4.0) ** 0.5 * contrast * (1 + 2 * dense_mag) / (1 + top_depth / 400) * weight
            found.append(dict(kind=kind, e=e, n=n_, top_elev=ztop, bottom_elev=zbot, top_depth=top_depth, centre_depth=centre_depth, peak=peak,
                              other_mean=other, dense_magnetic_share=dense_mag, volume_km3=vol, cells=len(ii),
                              strike=strike, width=width, footprint=pts, score=score))
    found.sort(key=lambda t: -t["score"])
    chosen = []
    for t in found:
        if all(np.hypot(t["e"] - c["e"], t["n"] - c["n"]) > MIN_SEP_M for c in chosen):
            chosen.append(t)
        if len(chosen) == N_TARGETS:
            break
    for k, t in enumerate(chosen, 1):
        t["id"] = f"T{k}"
    return chosen, far, surf


def quiet_site(mesh, act, rho, chi, far, avoid):
    """Centre of the quietest constrained column (small |drho| and chi throughout), away from the targets."""
    R, C, A = (a.reshape(mesh.shape_cells, order="F") for a in (rho, chi, act))
    xc, yc, zc = mesh.cell_centers_x, mesh.cell_centers_y, mesh.cell_centers_z
    sel = (zc >= ZMIN)
    act_any = A[:, :, sel].any(axis=2)
    amp = np.nanmax(np.abs(np.nan_to_num(R[:, :, sel])) / 0.3 + np.nan_to_num(C[:, :, sel]) / 0.3, axis=2)
    from scipy import ndimage
    amp = ndimage.uniform_filter(amp, 5)
    amp[far | ~act_any] = np.inf
    X, Y = np.meshgrid(xc, yc, indexing="ij")
    for t in avoid:
        amp[np.hypot(X - t["e"], Y - t["n"]) < 3000] = np.inf
    i, j = np.unravel_index(np.argmin(amp), amp.shape)
    return xc[i], yc[j]


def make_lines(targets, ref, region):
    w, e, s, n = region
    lines = []
    for t in targets:
        cfg = method_for(t["top_depth"])
        across = np.array([t["strike"][1], -t["strike"][0]])          # perpendicular to strike
        L = float(np.clip(t["width"] + 2 * 800, 2000, 4000))
        a = np.array([t["e"], t["n"]]) - across * L / 2
        b = np.array([t["e"], t["n"]]) + across * L / 2
        if across[0] < 0 or (abs(across[0]) < 1e-9 and across[1] < 0):
            a, b = b, a                                               # start in the west
        lines.append(dict(id=f"L{t['id'][1:]}", target=t["id"], a=a, b=b, **cfg, priority="",
                          purpose=f"{t['kind']} body {t['id']}: contacts and conductive zones"))
    ea, na = W.to_utm(*SECTION_AB[0])
    eb, nb = W.to_utm(*SECTION_AB[1])
    lines.append(dict(id="P1", target="regional", a=np.array([float(ea), float(na)]), b=np.array([float(eb), float(nb)]),
                      method="AMT", loop_m=0, spacing_m=500, amt_spacing_m=500, priority="",
                      purpose="regional AMT traverse along A-B (notebook 04): structure to 1-3 km"))
    lines.append(dict(id="R1", target="reference", a=np.array([ref[0] - 750, ref[1]]), b=np.array([ref[0] + 750, ref[1]]),
                      method="TEM central loop", loop_m=200, spacing_m=100, amt_spacing_m=0, priority="",
                      purpose="reference line over a quiet area: background resistivity"))
    for ln in lines:
        ln["length_m"] = float(np.hypot(*(ln["b"] - ln["a"])))
    return lines


def stations(lines, gdata, mdata):
    from scipy.spatial import cKDTree
    tree = cKDTree(np.r_[gdata[:, :2], mdata[:, :2]])
    rows = []
    for ln in lines:
        for kind, sp in (("TEM", ln["spacing_m"] if ln["loop_m"] else 0), ("AMT", ln["amt_spacing_m"])):
            if not sp:
                continue
            k = np.arange(0, ln["length_m"] + 1e-6, sp)
            ee = ln["a"][0] + k / ln["length_m"] * (ln["b"][0] - ln["a"][0])
            nn = ln["a"][1] + k / ln["length_m"] * (ln["b"][1] - ln["a"][1])
            lon, lat = W.to_lonlat(ee, nn)
            d, _ = tree.query(np.c_[ee, nn])
            for s_, (x, y, lo, la, dd) in enumerate(zip(ee, nn, lon, lat, d)):
                rows.append(dict(line=ln["id"], station=f"{ln['id']}-{kind}{s_:03d}", method=kind, distance_m=round(k[s_], 1),
                                 easting=round(x, 1), northing=round(y, 1), lon=round(lo, 6), lat=round(la, 6),
                                 loop_m=ln["loop_m"] if kind == "TEM" else 0, nearest_traverse_m=round(dd, 0)))
    return pd.DataFrame(rows)


def write_gps(lines, st, path_gpx, path_kml):
    def ll(p):
        lo, la = W.to_lonlat(p[0], p[1])
        return float(lo), float(la)
    g = ['<?xml version="1.0" encoding="UTF-8"?>',
         '<gpx version="1.1" creator="Wadi Ghadir EM survey design, ' + AUTHOR + '" xmlns="http://www.topografix.com/GPX/1/1">']
    for r in st.itertuples():
        g.append(f'<wpt lat="{r.lat}" lon="{r.lon}"><name>{r.station}</name><desc>{r.method} {r.loop_m or ""}</desc></wpt>')
    for ln in lines:
        (lo1, la1), (lo2, la2) = ll(ln["a"]), ll(ln["b"])
        g.append(f'<trk><name>{ln["id"]}</name><desc>{ln["method"]}: {ln["purpose"]}</desc><trkseg>'
                 f'<trkpt lat="{la1:.6f}" lon="{lo1:.6f}"/><trkpt lat="{la2:.6f}" lon="{lo2:.6f}"/></trkseg></trk>')
    g.append("</gpx>")
    open(path_gpx, "w").write("\n".join(g))
    k = ['<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
         f"<name>Wadi Ghadir EM survey plan</name><description>{AUTHOR}</description>"]
    for ln in lines:
        (lo1, la1), (lo2, la2) = ll(ln["a"]), ll(ln["b"])
        k.append(f"<Placemark><name>{ln['id']} ({ln['method']})</name><description>{ln['purpose']}</description>"
                 f"<LineString><coordinates>{lo1:.6f},{la1:.6f},0 {lo2:.6f},{la2:.6f},0</coordinates></LineString></Placemark>")
    for r in st.itertuples():
        k.append(f"<Placemark><name>{r.station}</name><Point><coordinates>{r.lon},{r.lat},0</coordinates></Point></Placemark>")
    k.append("</Document></kml>")
    open(path_kml, "w").write("\n".join(k))


def plan_map(ax_g, ax_m, targets, lines, st, g, m):
    import matplotlib.patheffects as pe
    from scipy.interpolate import griddata
    from scipy.spatial import ConvexHull, cKDTree
    d = g["data_xyz"]
    xs = np.arange(d[:, 0].min() - 1000, d[:, 0].max() + 1000, 200.0)
    ys = np.arange(d[:, 1].min() - 1000, d[:, 1].max() + 1000, 200.0)
    X, Y = np.meshgrid(xs, ys)
    G = griddata(d[:, :2], g["data_mgal"], (X, Y), method="linear")
    G[cKDTree(d[:, :2]).query(np.c_[X.ravel(), Y.ravel()])[0].reshape(X.shape) > 1500] = np.nan
    rtp = pd.read_csv(os.path.join(ROOT, "outputs", "grids", "mag_rtp_xyz.csv")).dropna()
    t = cKDTree(rtp[["easting_utm36n", "northing_utm36n"]].values)
    dist, idx = t.query(np.c_[X.ravel(), Y.ravel()])
    Mg = np.where(dist < 150, rtp["rtp_nT"].values[idx], np.nan).reshape(X.shape)
    km = lambda v: np.asarray(v) / 1000  # noqa: E731
    v = np.nanpercentile(np.abs(G), 98)
    im1 = ax_g.pcolormesh(km(xs), km(ys), G, cmap="RdBu_r", vmin=-v, vmax=v, shading="auto", rasterized=True)
    vm = np.nanpercentile(np.abs(Mg), 98)
    im2 = ax_m.pcolormesh(km(xs), km(ys), Mg, cmap="RdBu_r", vmin=-vm, vmax=vm, shading="auto", rasterized=True)
    col = {"magnetic": "#6a1b9a", "dense": "#b71c1c", "light": "#0d47a1"}
    for ax, im, lab in ((ax_g, im1, "residual Bouguer anomaly [mGal]"), (ax_m, im2, "RTP magnetic anomaly [nT]")):
        ax.plot(km(g["data_xyz"][:, 0]), km(g["data_xyz"][:, 1]), ".", ms=1.2, color="0.35", zorder=2)
        for tg in targets:
            p = tg["footprint"]
            if len(p) >= 3:
                h = ConvexHull(p)
                ax.fill(km(p[h.vertices, 0]), km(p[h.vertices, 1]), facecolor="none", edgecolor=col[tg["kind"]], lw=1.6, ls="--", zorder=3)
        for ln in lines:
            c = "k" if ln["id"][0] == "L" else ("#e65100" if ln["id"] == "P1" else "#2e7d32")
            ax.plot(km([ln["a"][0], ln["b"][0]]), km([ln["a"][1], ln["b"][1]]), "-", color=c, lw=2.2, zorder=4,
                    path_effects=[pe.Stroke(linewidth=4, foreground="w"), pe.Normal()])
            s = st[st.line == ln["id"]]
            ax.plot(km(s.easting), km(s.northing), "|", color=c, ms=4, zorder=5)
            ax.annotate(f"{ln['id']} · prio {ln['priority']} · {ln['length_m'] / 1000:.1f} km", km(ln["b"]), xytext=(4, 4), textcoords="offset points", fontsize=9, weight="bold", color=c,
                        path_effects=[pe.withStroke(linewidth=3, foreground="w")], zorder=6)
        ax.set_aspect("equal")
        ax.set_xlabel("easting [km], UTM 36N")
        ax.set_ylabel("northing [km]")
        ax.figure.colorbar(im, ax=ax, shrink=0.75, pad=0.02, label=lab)
        ax.grid(alpha=0.25)
    ax_g.set_title("EM lines over the residual Bouguer anomaly")
    ax_m.set_title("EM lines over the reduced-to-pole magnetic anomaly")


def draw_sections(fig, lines, targets, mesh, rho, chi):
    tmap = {t["id"]: t for t in targets}
    sec_lines = [ln for ln in lines if ln["id"] != "R1"]
    axes = fig.subplots(len(sec_lines), 1, squeeze=False)[:, 0]
    for ax, ln in zip(axes, sec_lines):
        d, zc, R = W.section(mesh, rho, tuple(ln["a"]), tuple(ln["b"]), step=50.0, zmin=ZMIN)
        _, _, C = W.section(mesh, chi, tuple(ln["a"]), tuple(ln["b"]), step=50.0, zmin=ZMIN)
        im = ax.pcolormesh(d / 1000, zc / 1000, R, cmap="RdBu_r", vmin=-0.3, vmax=0.3, shading="nearest", rasterized=True)
        if np.isfinite(C).any() and np.nanmax(C) > 0.02:
            ax.contour(d / 1000, zc / 1000, np.nan_to_num(C), levels=[0.02, 0.1], colors=["#7b1fa2", "#4a148c"], linewidths=[0.8, 1.6])
        topo = np.array([np.nanmax(np.where(np.isfinite(R[:, i]), zc, np.nan)) if np.isfinite(R[:, i]).any() else np.nan for i in range(len(d))]) + 50
        ax.plot(d / 1000, topo / 1000, "k-", lw=1)
        surf = np.nanmedian(topo)
        txt = []
        if ln["loop_m"]:
            for rr, ls in ((100, "--"), (1000, ":")):
                dz = float(tem_doi(ln["loop_m"], rr))
                ax.axhline((surf - dz) / 1000, color="#2e7d32", ls=ls, lw=1.2)
                txt.append(f"TEM {ln['loop_m']} m loop: ~{dz:.0f} m at {rr} Ωm")
        if ln["amt_spacing_m"]:
            for rr, ls in ((100, "--"), (1000, ":")):
                dz = float(amt_depth(rr))
                if (surf - dz) > ZMIN:
                    ax.axhline((surf - dz) / 1000, color="#e65100", ls=ls, lw=1.2)
                txt.append(f"AMT ≥{AMT_FMIN_HZ:.0f} Hz: ~{dz:.0f} m at {rr} Ωm")
        if ln["target"] in tmap:
            t = tmap[ln["target"]]
            mid = ln["length_m"] / 2000
            ax.annotate(f"{t['id']}: top ≈ {t['top_depth']:.0f} m, centre ≈ {t['centre_depth']:.0f} m below surface", (mid, (surf - t["top_depth"]) / 1000), xytext=(8, -14),
                        textcoords="offset points", fontsize=8, arrowprops=dict(arrowstyle="->", lw=0.8))
            ax.plot(mid, (surf - t["top_depth"]) / 1000, "kv", ms=6)
        ax.set_ylim(ZMIN / 1000, 0.85)
        ax.set_title(f"{ln['id']}  ({ln['method']}, {ln['length_m'] / 1000:.1f} km)   " + " · ".join(txt), fontsize=8.5, loc="left")
        ax.set_ylabel("elev. [km]")
    axes[-1].set_xlabel("distance along line from the west end [km]   (colour: joint compact Δρ; purple contours: χ = 0.02 and 0.1 SI; "
                        "green/orange lines: depth of investigation, dashed 100 Ωm, dotted 1000 Ωm)", fontsize=8)
    fig.colorbar(im, ax=list(axes), shrink=0.35, pad=0.01, label="Δρ [g/cm³]")


def compute():
    """Targets, lines and stations of the EM survey (used by the plan sheets and the interactive page)."""
    mesh, act, rho, chi, g, m = load()
    targets, far, surf = find_targets(mesh, act, rho, chi, g, m)
    ref = quiet_site(mesh, act, rho, chi, far, targets)
    region = (mesh.nodes_x[5], mesh.nodes_x[-6], mesh.nodes_y[5], mesh.nodes_y[-6])
    lines = make_lines(targets, ref, region)
    st = stations(lines, g["data_xyz"], m["data_xyz"])
    # priorities: shallow, contrasted bodies first; dense + magnetic overlap raises it
    for ln in lines:
        t = next((t for t in targets if t["id"] == ln["target"]), None)
        ln["priority"] = ("1" if t["top_depth"] < 300 or t["dense_magnetic_share"] > 0.3 else "2") if t else ("1" if ln["id"] == "R1" else "2")
    for k, ln in enumerate(lines):
        ln["n_tem"] = int((st.line == ln["id"]).sum() - ((st.line == ln["id"]) & (st.method == "AMT")).sum())
        ln["n_amt"] = int(((st.line == ln["id"]) & (st.method == "AMT")).sum())
    return mesh, act, rho, chi, g, m, targets, lines, st


# -----------------------------------------------------------------------------
# One-week campaign: the most important lines, shortened, with dense stations only over the targets
WEEK_DAYS = 7
TEM_RATE = {100: 30, 200: 22, 400: 12}   # TEM soundings per day by loop side (moving loop, one crew)
AMT_RATE = 7                             # AMT soundings per day (one crew, two or three systems leap-frogging)
FIRST_DAY = 0.6                          # share of day 1 left after mobilisation and instrument tests
MOVE_DAYS = 0.15                         # moving to another line
# line, priority, length [km], TEM loop [m], TEM step over the target / outside [m], AMT step [m], why
WEEK = [
    ("R1", "1", 1.0, 200, 100, 100, 0, "background resistivity and noise level: calibrates every other line"),
    ("L2", "1", 2.0, 100, 50, 100, 500, "strongest magnetic anomaly, dense and magnetic: possible active serpentinisation front (H2 source)"),
    ("L1", "1", 2.4, 100, 50, 100, 500, "shallow magnetic body with a dense and magnetic core: H2 source candidate"),
    ("L4", "1", 3.0, 400, 200, 200, 250, "deep magnetic body (top ~700 m) and its faults: source at depth and pathways"),
    ("L5", "2", 2.0, 100, 50, 100, 0, "shallow magnetic body in the east: serpentinite or magnetite-rich mafic rock"),
    ("L6", "2", 2.0, 100, 100, 100, 0, "low-density body at the coast: reservoir and seal side of the H2 system"),
    ("L3", "2", 4.0, 0, 0, 0, 250, "deep dense block (top ~1.1 km): AMT only, fluid paths into it"),
]


def week_plan(lines, g, m):
    """Lines, stations and day-by-day schedule of the one-week campaign."""
    from scipy.spatial import cKDTree
    tree = cKDTree(np.r_[g["data_xyz"][:, :2], m["data_xyz"][:, :2]])
    full = {ln["id"]: ln for ln in lines}
    wlines, rows = [], []
    for lid, prio, L_km, loop, core, outer, amt, why in WEEK:
        src = full[lid]
        u = (src["b"] - src["a"]) / src["length_m"]
        mid = (src["a"] + src["b"]) / 2
        L = L_km * 1000.0
        a, b = mid - u * L / 2, mid + u * L / 2
        ln = dict(id=lid, target=src["target"], priority=prio, a=a, b=b, length_m=L, loop_m=loop, spacing_m=core, outer_m=outer,
                  amt_spacing_m=amt, purpose=why, method=("TEM + AMT" if loop and amt else "TEM central loop" if loop else "AMT"))
        sets = []
        if loop:
            d = np.unique(np.round(np.r_[np.arange(0, L + 1, outer), np.arange(L / 2 - 500, L / 2 + 501, core), L], 1))
            sets.append(("TEM", d[(d >= 0) & (d <= L)]))
        if amt:
            sets.append(("AMT", np.arange(0, L + 1, amt)))
        for kind, dd in sets:
            ee, nn = a[0] + dd * u[0], a[1] + dd * u[1]
            lon, lat = W.to_lonlat(ee, nn)
            dist, _ = tree.query(np.c_[ee, nn])
            for k, (x, y, lo, la, di, dt) in enumerate(zip(ee, nn, lon, lat, dd, dist)):
                rows.append(dict(line=lid, station=f"{lid}-{kind}{k:03d}", method=kind, distance_m=round(float(di), 1), easting=round(float(x), 1),
                                 northing=round(float(y), 1), lon=round(float(lo), 6), lat=round(float(la), 6), loop_m=loop if kind == "TEM" else 0,
                                 nearest_traverse_m=round(float(dt), 0)))
        wlines.append(ln)
    st = pd.DataFrame(rows)
    st["day"] = 0
    sched = []
    for crew, kind in (("TEM crew", "TEM"), ("AMT crew", "AMT")):
        day, left, first = 1, FIRST_DAY, True
        for ln in wlines:
            idx = st.index[(st.line == ln["id"]) & (st.method == kind)]
            if not len(idx):
                continue
            if not first:
                left -= MOVE_DAYS
            first = False
            cost = 1.0 / (TEM_RATE[ln["loop_m"]] if kind == "TEM" else AMT_RATE)
            for i in idx:
                if left < cost - 1e-9:
                    day, left = day + 1, 1.0
                st.loc[i, "day"] = day
                left -= cost
        for (d, lid), grp in st[st.method == kind].groupby(["day", "line"], sort=False):
            sched.append(dict(day=int(d), crew=crew, line=lid, soundings=len(grp), first=grp.station.iloc[0], last=grp.station.iloc[-1]))
    sched = pd.DataFrame(sched).sort_values(["day", "crew"]).reset_index(drop=True)
    for ln in wlines:
        ln["n_tem"] = int(((st.line == ln["id"]) & (st.method == "TEM")).sum())
        ln["n_amt"] = int(((st.line == ln["id"]) & (st.method == "AMT")).sum())
    return wlines, st, sched


def write_week(wlines, wst, sched, targets, g, m):
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages
    hdr = f"# Wadi Ghadir one-week EM campaign, {AUTHOR}. UTM 36N / WGS 84.\n"
    ldf = pd.DataFrame([{"order": k + 1, "line": ln["id"], "priority": ln["priority"], "method": ln["method"], "loop_m": ln["loop_m"],
                         "tem_step_m": f"{ln['spacing_m']}/{ln['outer_m']}" if ln["loop_m"] else "", "amt_step_m": ln["amt_spacing_m"] or "",
                         "length_km": ln["length_m"] / 1000, "tem_stations": ln["n_tem"], "amt_stations": ln["n_amt"],
                         "days": f"{wst[wst.line == ln['id']].day.min()}-{wst[wst.line == ln['id']].day.max()}", "why": ln["purpose"]}
                        for k, ln in enumerate(wlines)])
    for df, name in ((ldf, "em_week_lines.csv"), (wst, "em_week_stations.csv"), (sched, "em_week_schedule.csv")):
        with open(os.path.join(OUT, name), "w") as f:
            f.write(hdr)
            df.to_csv(f, index=False)
    write_gps(wlines, wst, os.path.join(OUT, "em_week.gpx"), os.path.join(OUT, "em_week.kml"))
    fig_map, (a1, a2) = plt.subplots(1, 2, figsize=(16.5, 5.9))
    plan_map(a1, a2, targets, wlines, wst, g, m)
    fig_map.suptitle(f"Wadi Ghadir: one-week EM campaign · {AUTHOR}", fontsize=11, weight="bold")
    fig_map.tight_layout(rect=(0, 0, 1, 0.95))
    fig_map.savefig(os.path.join(OUT, "em_week_map.png"), dpi=170)
    days = int(wst.day.max())
    fig_g, ax = plt.subplots(figsize=(16.5, 3.6))
    cols = {ln["id"]: c for ln, c in zip(wlines, plt.cm.tab10.colors)}
    for r, crew in enumerate(("TEM crew", "AMT crew")):
        sub = sched[sched.crew == crew]
        for d in range(1, days + 1):
            rows_d = list(sub[sub.day == d].itertuples())
            x0 = d - 1 + (0 if d > 1 else 1 - FIRST_DAY)
            ws = [row.soundings / (TEM_RATE[next(ln["loop_m"] for ln in wlines if ln["id"] == row.line)] if crew == "TEM crew" else AMT_RATE) for row in rows_d]
            gap = 0.03
            scale = min(1.0, (d - x0 - gap * len(ws)) / max(sum(ws), 1e-9))   # keep each day's blocks inside the day
            for row, w in zip(rows_d, ws):
                w *= scale
                ax.barh(r, w, left=x0 + gap / 2, color=cols[row.line], edgecolor="w")
                ax.text(x0 + gap / 2 + w / 2, r, f"{row.line}\n{row.soundings}", ha="center", va="center", fontsize=8, color="w", weight="bold")
                x0 += w + gap
    ax.set_yticks([0, 1], ["TEM crew", "AMT crew"])
    ax.set_xticks(np.arange(days) + 0.5, [f"day {d}" for d in range(1, days + 1)])
    ax.set_xlim(0, max(days, WEEK_DAYS))
    ax.axvspan(0, 1 - FIRST_DAY, color="0.9")
    ax.text((1 - FIRST_DAY) / 2, 0.5, "mobilise,\ntests", ha="center", va="center", fontsize=8, color="0.4")
    for d in range(1, WEEK_DAYS):
        ax.axvline(d, color="0.8", lw=0.8)
    ax.invert_yaxis()
    ax.set_title(f"Schedule: {len(wst[wst.method == 'TEM'])} TEM and {len(wst[wst.method == 'AMT'])} AMT soundings in {days} days "
                 f"(TEM {TEM_RATE[100]}/day with 100 m loops, {TEM_RATE[400]}/day with 400 m; AMT {AMT_RATE}/day; day 1 starts after mobilisation)", loc="left", fontsize=9)
    fig_g.tight_layout()
    fig_g.savefig(os.path.join(OUT, "em_week_schedule.png"), dpi=150)
    with PdfPages(os.path.join(OUT, "EM_Survey_Week_Plan.pdf")) as pdf:
        fs = plt.figure(figsize=(16.5, 11.7))
        fs.text(0.04, 0.95, "Wadi Ghadir: one-week EM campaign (most important lines)", fontsize=18, weight="bold")
        fs.text(0.04, 0.925, f"{AUTHOR} · priority 1 first; priority 2 lines are dropped first if time runs short · P1 regional AMT moves to a later campaign", fontsize=10)
        ax = fs.add_axes((0.04, 0.45, 0.92, 0.44))
        ax.axis("off")
        tb = ldf.drop(columns=["why"]).astype(str)
        t = ax.table(cellText=tb.values, colLabels=tb.columns, loc="upper left", cellLoc="center")
        t.auto_set_font_size(False)
        t.set_fontsize(9)
        t.scale(1, 1.5)
        fs.text(0.04, 0.5, "\n".join(f"{ln['id']}: {ln['purpose']}" for ln in wlines) +
                "\n\nAt every TEM station: soil gas (H2, CH4, CO2, He, Rn) in a 1 m probe by a third person. Day 7 is the reserve for repeats and QC.",
                fontsize=9.5, va="top", linespacing=1.6)
        pdf.savefig(fs)
        pdf.savefig(fig_map)
        pdf.savefig(fig_g)
    plt.close("all")
    print(ldf.drop(columns=["why"]).to_string(index=False))
    print(sched.to_string(index=False))


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages
    os.makedirs(OUT, exist_ok=True)
    mesh, act, rho, chi, g, m, targets, lines, st = compute()

    # tables
    tdf = pd.DataFrame([{k: v for k, v in t.items() if k not in ("footprint", "strike", "score", "width")} for t in targets])
    tdf.insert(1, "lon", 0.0)
    tdf.insert(2, "lat", 0.0)
    tdf["lon"], tdf["lat"] = W.to_lonlat(tdf.e.values, tdf.n.values)
    tdf = tdf.round({"e": 0, "n": 0, "lon": 5, "lat": 5, "top_elev": 0, "bottom_elev": 0, "top_depth": 0, "centre_depth": 0, "peak": 3,
                     "other_mean": 4, "dense_magnetic_share": 2, "volume_km3": 3})
    ldf = pd.DataFrame([{"line": ln["id"], "target": ln["target"], "priority": ln["priority"], "method": ln["method"],
                         "loop_m": ln["loop_m"], "tem_spacing_m": ln["spacing_m"] if ln["loop_m"] else 0, "amt_spacing_m": ln["amt_spacing_m"],
                         "length_km": round(ln["length_m"] / 1000, 2), "tem_stations": ln["n_tem"], "amt_stations": ln["n_amt"],
                         "start_lon": round(float(W.to_lonlat(*ln["a"])[0]), 6), "start_lat": round(float(W.to_lonlat(*ln["a"])[1]), 6),
                         "end_lon": round(float(W.to_lonlat(*ln["b"])[0]), 6), "end_lat": round(float(W.to_lonlat(*ln["b"])[1]), 6),
                         "purpose": ln["purpose"]} for ln in lines])
    hdr = f"# Wadi Ghadir EM survey design, {AUTHOR}. UTM 36N / WGS 84.\n"
    for df, name in ((tdf, "em_targets.csv"), (ldf, "em_lines.csv"), (st, "em_stations.csv")):
        with open(os.path.join(OUT, name), "w") as f:
            f.write(hdr)
            df.to_csv(f, index=False)
    write_gps(lines, st, os.path.join(OUT, "em_survey.gpx"), os.path.join(OUT, "em_survey.kml"))

    plt.rcParams.update({"font.size": 9})
    # plan map
    fig_map, (a1, a2) = plt.subplots(1, 2, figsize=(16.5, 5.9))
    plan_map(a1, a2, targets, lines, st, g, m)
    fig_map.suptitle(f"Wadi Ghadir: ground EM survey plan (TEM + AMT) · {AUTHOR}", fontsize=11, weight="bold")
    fig_map.text(0.01, 0.01, "Black: target lines L1-L6 · orange: regional AMT traverse P1 · green: reference line R1 · "
                 "dashed outlines: target footprints from the compact joint inversion (purple magnetic, red dense, blue light) · "
                 "grey dots: gravity blocks (existing tracks)", fontsize=8)
    fig_map.tight_layout(rect=(0, 0.03, 1, 0.95))
    fig_map.savefig(os.path.join(OUT, "em_plan_map.png"), dpi=170)
    # sections
    n_sec = len([ln for ln in lines if ln["id"] != "R1"])
    fig_sec = plt.figure(figsize=(12, 2.15 * n_sec + 1), layout="constrained")
    draw_sections(fig_sec, lines, targets, mesh, rho, chi)
    fig_sec.suptitle(f"Expected targets and EM depth of investigation along the lines · {AUTHOR}", fontsize=11, weight="bold")
    fig_sec.savefig(os.path.join(OUT, "em_sections.png"), dpi=150)
    # depth of investigation
    fig_doi, (b1, b2) = plt.subplots(1, 2, figsize=(14, 5.6), gridspec_kw={"width_ratios": [1.2, 1]})
    r = np.logspace(0, 4, 100)
    for L, c in ((100, "#66bb6a"), (200, "#2e7d32"), (400, "#1b5e20")):
        b1.loglog(r, tem_doi(L, r), color=c, lw=2, label=f"TEM central loop {L} m ({TEM_CURRENT_A:.0f} A)")
    for f, c in ((10, "#e65100"), (1, "#bf360c")):
        b1.loglog(r, amt_depth(r, f), color=c, lw=2, ls="--", label=f"AMT/MT, lowest frequency {f:g} Hz")
    for t in targets:
        b1.axhline(max(t["top_depth"], 10), color="0.5", lw=0.6, ls=":")
        b1.text(1.1, max(t["top_depth"], 10) * 1.05, f"{t['id']} top", fontsize=7, color="0.35")
    b1.set_xlabel("resistivity of the host [Ωm]")
    b1.set_ylabel("depth of investigation [m]")
    b1.set_ylim(10, 10000)
    b1.grid(which="both", alpha=0.25)
    b1.legend(fontsize=8, loc="upper left")
    b1.set_title("How deep each set-up sees (rules of thumb)")
    names = list(RESISTIVITIES)
    for k, nm in enumerate(names):
        lo, hi = RESISTIVITIES[nm]
        b2.plot([lo, hi], [k, k], lw=9, solid_capstyle="butt", color="#455a64" if "sulph" not in nm.lower() and "graph" not in nm.lower() else "#c62828")
    b2.set_xscale("log")
    b2.set_yticks(range(len(names)), names, fontsize=8)
    b2.invert_yaxis()
    b2.set_xlabel("resistivity [Ωm]")
    b2.set_title("Expected resistivities (typical ranges)")
    b2.grid(axis="x", which="both", alpha=0.25)
    fig_doi.suptitle(f"EM depth of investigation and expected resistivities · {AUTHOR}", fontsize=11, weight="bold")
    fig_doi.tight_layout()
    fig_doi.savefig(os.path.join(OUT, "em_depth_of_investigation.png"), dpi=160)

    # summary page + PDF
    fig_sum = plt.figure(figsize=(16.5, 11.7))
    fig_sum.text(0.04, 0.95, "Wadi Ghadir, Eastern Desert, Egypt: ground EM survey plan", fontsize=18, weight="bold")
    fig_sum.text(0.04, 0.925, f"{AUTHOR} · targets from the compact joint gravity-magnetic inversion (notebook 08) · UTM 36N, WGS 84", fontsize=10)
    tb = tdf[["id", "kind", "lon", "lat", "top_depth", "centre_depth", "bottom_elev", "peak", "volume_km3", "dense_magnetic_share"]].copy()
    tb["top_depth"] = [f"{v:.0f}" if v >= 100 else "< 100 (near surface)" for v in tb.top_depth]
    tb["centre_depth"] = [f"{v:.0f}" for v in tb.centre_depth]
    tb["bottom_elev"] = [f"{v:.0f}" if v > ZMIN + 200 else f"below {ZMIN + 100:.0f}" for v in tb.bottom_elev]
    tb.columns = ["target", "body", "lon", "lat", "depth to top [m]", "depth to centre [m]", "base elev. [m]", "peak Δρ [g/cm³] or χ [SI]", "volume [km³]", "dense+magnetic share"]
    ax = fig_sum.add_axes((0.04, 0.62, 0.92, 0.27))
    ax.axis("off")
    ax.set_title("Targets (expected depths from the compact model; potential-field depths are uncertain by ± a few hundred metres)", loc="left", fontsize=10)
    tab = ax.table(cellText=tb.astype(str).values, colLabels=tb.columns, loc="upper left", cellLoc="center")
    tab.auto_set_font_size(False)
    tab.set_fontsize(8.5)
    tab.scale(1, 1.35)
    lb = ldf[["line", "target", "priority", "method", "loop_m", "tem_spacing_m", "amt_spacing_m", "length_km", "tem_stations", "amt_stations",
              "start_lon", "start_lat", "end_lon", "end_lat"]].copy()
    lb.columns = ["line", "target", "prio.", "method", "loop [m]", "TEM step [m]", "AMT step [m]", "length [km]", "TEM st.", "AMT st.",
                  "start lon", "start lat", "end lon", "end lat"]
    ax = fig_sum.add_axes((0.04, 0.30, 0.92, 0.28))
    ax.axis("off")
    ax.set_title("Lines (stations in em_stations.csv, em_survey.gpx for field GPS, em_survey.kml for Google Earth)", loc="left", fontsize=10)
    tab = ax.table(cellText=lb.astype(str).values, colLabels=lb.columns, loc="upper left", cellLoc="center")
    tab.auto_set_font_size(False)
    tab.set_fontsize(8.5)
    tab.scale(1, 1.35)
    notes = [
        "Field procedure",
        f"• TEM: central (in-loop) soundings, square loop of the listed side, ≥{TEM_CURRENT_A:.0f} A, gates to ≥{TEM_LAST_GATE_S * 1000:.0f} ms, stack until late gates are stable;"
        " move the loop along the line by the listed step. Use a 100 m loop on shallow targets, 200-400 m where the top is deeper.",
        "• AMT: tensor soundings (Ex, Ey, Hx, Hy, Hz if possible), 10 Hz-10 kHz (to 1 Hz where time allows), dipoles 50 m, remote reference to cut cultural noise.",
        "• Run R1 first to fix the background resistivity and noise level; then L-lines in order of priority; P1 last (regional, many soundings).",
        "• Lines can shift up to ~300 m to follow tracks and wadis; keep them perpendicular to strike and record actual positions (GPS).",
        "What to expect",
        "• Host rocks of the Eastern Desert basement are resistive (≈ 300-20 000 Ωm), so TEM sees deep but signals are weak: good targets are conductors"
        " (sulphides, graphite, altered shear zones, 0.01-100 Ωm) at or near the contacts of the gravity and magnetic bodies.",
        "• Magnetic bodies may be magnetite-bearing serpentinites or mafic rocks (moderate resistivity) or contain pyrrhotite/sulphides (conductive):"
        " EM separates these cases, which gravity and magnetics alone cannot.",
        "• Depths of investigation are rules of thumb (TEM: Spies 1989, capped by the diffusion depth at the last gate; AMT: Bostick depth at the lowest frequency)."
        " Wadi fill near the coast may be saline and conductive, which shortens TEM penetration.",
    ]
    fig_sum.text(0.04, 0.27, "\n".join(notes), fontsize=9, va="top", linespacing=1.55)
    fig_sum.savefig(os.path.join(OUT, "em_summary.png"), dpi=110)
    with PdfPages(os.path.join(OUT, "EM_Survey_Plan.pdf")) as pdf:
        for f in (fig_sum, fig_map, fig_sec, fig_doi):
            pdf.savefig(f)
        info = pdf.infodict()
        info["Title"] = "Wadi Ghadir EM survey plan"
        info["Author"] = "Mohamed Sobh, LIAG"
    plt.close("all")
    print(tdf[["id", "kind", "e", "n", "top_depth", "centre_depth", "top_elev", "bottom_elev", "peak", "volume_km3", "dense_magnetic_share"]].to_string(index=False))
    print(ldf[["line", "target", "priority", "method", "loop_m", "length_km", "tem_stations", "amt_stations"]].to_string(index=False))
    print(f"stations: {len(st)}; median distance to an existing traverse {st.nearest_traverse_m.median():.0f} m")
    wlines, wst, sched = week_plan(lines, g, m)
    write_week(wlines, wst, sched, targets, g, m)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
