#!/usr/bin/env python3
"""Build the interactive Wadi Ghadir Inversion Explorer (one self-contained HTML file).

The explorer shows the SimPEG inversions of notebooks 06-08 in the browser: horizontal slices at any
elevation, vertical sections along any line, a 3-D view of the anomalous cells, the data fit of every
model and the convergence of every run. This script embeds:

* the seven 3-D models on the common mesh (compact and smooth density, compact and smooth
  susceptibility, joint density, joint susceptibility, joint units), quantised to one byte per cell;
* the gravity and magnetic data blocks with the data predicted by every model (forward-modelled
  here with SimPEG for the smooth and joint models, which the notebooks do not store);
* the iteration logs and the summaries of the three notebooks.

Run after notebooks 06-08 (outputs/inversion/):
    python scripts/build_inversion_explorer.py
Writes web/Wadi_Ghadir_Inversion_Explorer.html and, with --artifact PATH, a body-only copy for publishing.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import argparse
import base64
import io
import json
import os
import sys

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from wghadir import inversion as W  # noqa: E402

INV = os.path.join(ROOT, "outputs", "inversion")
SRC = os.path.join(ROOT, "web", "src", "inv_explorer.html")
OUT = os.path.join(ROOT, "web", "Wadi_Ghadir_Inversion_Explorer.html")
MASK_M = 2500.0                      # cells farther than this from any data point are unconstrained
# preset sections (lon, lat): A-B of notebook 04 and the S-N line of notebook 05
SECTIONS = {"A–B (notebook 04)": ((34.7448, 24.7058), (34.9490, 24.8117)),
            "S–N through the SW anomaly (notebook 05)": ((34.749, 24.700), (34.749, 24.752))}


def compactness(v):
    """Share of the active cells that hold 90 % of the model's total absolute value."""
    a = np.sort(np.abs(v))[::-1]
    c = np.cumsum(a)
    return float((np.searchsorted(c, 0.9 * c[-1]) + 1) / len(a))


def b64(a):
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def quantise(full, active, lo, hi):
    """One byte per cell (Fortran order of the mesh): 0..254 linear in [lo, hi], 255 = air."""
    q = np.full(full.shape, 255, np.uint8)
    v = np.clip((full[active] - lo) / (hi - lo), 0, 1)
    q[active] = np.round(v * 254).astype(np.uint8)
    return q


def simulations(mesh, active, g, m):
    """SimPEG integral simulations for the gravity and magnetic blocks (identity maps on the active cells)."""
    from simpeg import maps
    from simpeg.potential_fields import gravity, magnetics
    n = int(active.sum())
    rg = gravity.receivers.Point(g["data_xyz"], components="gz")
    sg = gravity.simulation.Simulation3DIntegral(
        survey=gravity.survey.Survey(gravity.sources.SourceField(receiver_list=[rg])), mesh=mesh,
        rhoMap=maps.IdentityMap(nP=n), active_cells=active, engine="choclo", store_sensitivities="forward_only")
    F, I, D = m["field"]
    rm = magnetics.receivers.Point(m["data_xyz"], components="tmi")
    src = magnetics.sources.UniformBackgroundField(receiver_list=[rm], amplitude=F, inclination=I, declination=D)
    sm = magnetics.simulation.Simulation3DIntegral(
        survey=magnetics.survey.Survey(src), mesh=mesh, chiMap=maps.IdentityMap(nP=n), active_cells=active,
        model_type="scalar", engine="choclo", store_sensitivities="forward_only")
    return sg, sm


def terrain(mesh, n_pad):
    """Copernicus GLO-30 over the core of the mesh: a hillshade JPEG (50 m) and elevations on a 200 m grid."""
    from PIL import Image
    from wghadir.common import geodata
    dem = geodata.Grid(os.path.join(ROOT, "data", "external", "copernicus_glo30_wadi_ghadir.tif"))
    x0 = mesh.origin[0] + mesh.h[0][:n_pad].sum()
    x1 = mesh.origin[0] + mesh.h[0][:-n_pad].sum()
    y0 = mesh.origin[1] + mesh.h[1][:n_pad].sum()
    y1 = mesh.origin[1] + mesh.h[1][:-n_pad].sum()

    def sample(step):
        E, N = np.meshgrid(np.arange(x0, x1 + 1, step), np.arange(y1, y0 - 1, -step))   # rows north to south
        lon, lat = W.to_lonlat(E.ravel(), N.ravel())
        z = dem.sample(lon, lat).reshape(E.shape)
        return np.where(np.isfinite(z), z, 0.0)

    z50 = sample(50.0)
    hs = geodata.hillshade(z50, 50.0, 50.0, z_factor=1.6)
    rgb = np.dstack([hs * 255] * 3)
    rgb[z50 <= 0.5] = [196, 220, 238]
    buf = io.BytesIO()
    Image.fromarray(rgb.clip(0, 255).astype(np.uint8)).save(buf, "JPEG", quality=78, optimize=True)
    z200 = sample(200.0)
    return {"x0": float(x0), "x1": float(x1), "y0": float(y0), "y1": float(y1),
            "hillshade": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
            "z200": b64(np.round(z200).astype(np.int16)), "nx200": int(z200.shape[1]), "ny200": int(z200.shape[0])}


def read_log(name):
    df = pd.read_csv(os.path.join(INV, name))
    return {c: [float(v) for v in df[c]] for c in df.columns}


def build():
    import discretize
    g = dict(np.load(os.path.join(INV, "gravity_model.npz")))
    m = dict(np.load(os.path.join(INV, "magnetic_model.npz")))
    j = dict(np.load(os.path.join(INV, "joint_model.npz")))
    summ = {k: json.load(open(os.path.join(INV, f"{k}_summary.json"))) for k in ("gravity", "magnetic", "joint")}
    hx, hy, hz, origin = g["hx"], g["hy"], g["hz"], g["origin"]
    mesh = discretize.TensorMesh([hx, hy, hz], origin=origin)
    active = g["active"]
    assert (active == m["active"]).all() and (active == j["active"]).all()

    def full(v):
        f = np.full(mesh.n_cells, np.nan)
        f[active] = v
        return f

    models = {
        "rho_compact": (g["rho_gcc"], "density", "compact"),
        "rho_smooth": (g["rho_smooth_gcc"], "density", "smooth"),
        "rho_joint": (j["rho_gcc"], "density", "joint"),
        "chi_compact": (m["chi_SI"], "susceptibility", "compact"),
        "chi_smooth": (m["chi_smooth_SI"], "susceptibility", "smooth"),
        "chi_joint": (j["chi_SI"], "susceptibility", "joint"),
    }
    out_models = {}
    for key, (v, prop, kind) in models.items():
        if prop == "density":
            a = float(np.abs(v).max())
            lo, hi = -a, a
        else:
            lo, hi = 0.0, float(v.max())
        out_models[key] = {"property": prop, "kind": kind, "lo": lo, "hi": hi, "min": float(v.min()), "max": float(v.max()),
                           "compactness_90": compactness(v),
                           "q": b64(quantise(full(v), active, lo, hi))}
    units = np.full(mesh.n_cells, 255, np.uint8)
    units[active] = j["units"].astype(np.uint8)
    out_models["units_joint"] = {"property": "units", "kind": "joint", "lo": 0, "hi": 254, "q": b64(units),
                                 "percent": [float((j["units"] == u).mean() * 100) for u in range(5)]}

    # data predicted by every model
    print("forward-modelling the smooth and joint models ...")
    sg, sm = simulations(mesh, active, g, m)
    pred_g = {"compact": -sg.dpred(g["rho_gcc"]), "smooth": -sg.dpred(g["rho_smooth_gcc"]), "joint": -sg.dpred(j["rho_gcc"])}
    pred_m = {"compact": sm.dpred(m["chi_SI"]), "smooth": sm.dpred(m["chi_smooth_SI"]), "joint": sm.dpred(j["chi_SI"])}
    for name, p, ref in (("gravity", pred_g["compact"], g["predicted_mgal"]), ("magnetic", pred_m["compact"], m["predicted_nT"])):
        err = float(np.abs(p - ref).max() / np.abs(ref).max())
        print(f"  {name}: compact prediction reproduces the notebook to {err:.1e} (relative)")
        assert err < 1e-3, f"{name} forward model does not match the notebook"

    def data_block(d, obs, unc, pred, decimals):
        r = lambda a: [round(float(x), decimals) for x in a]  # noqa: E731
        return {"e": r(d[:, 0]), "n": r(d[:, 1]), "z": r(d[:, 2]), "obs": r(obs, ), "unc": r(unc),
                "pred": {k: r(v) for k, v in pred.items()}}

    data = {"gravity": data_block(g["data_xyz"], g["data_mgal"], g["uncertainty_mgal"], pred_g, 4),
            "magnetic": data_block(m["data_xyz"], m["data_nT"], m["uncertainty_nT"], pred_m, 2)}
    for d in data.values():
        d["e"] = [round(x, 1) for x in d["e"]]
        d["n"] = [round(x, 1) for x in d["n"]]

    # cells farther than MASK_M from each data set, per column (nx * ny, x fastest)
    xc, yc = mesh.cell_centers_x, mesh.cell_centers_y
    far = {k: W.far_from_data(xc, yc, np.array(data[k]["e"]), np.array(data[k]["n"]), MASK_M).astype(np.uint8)
           for k in ("gravity", "magnetic")}   # (ny, nx)

    sections = {}
    for name, (a, b) in SECTIONS.items():
        ea, na = W.to_utm(*a)
        eb, nb = W.to_utm(*b)
        sections[name] = [[float(ea), float(na)], [float(eb), float(nb)]]

    logs = {"gravity": {"compact": read_log("gravity_iterations.csv")},
            "magnetic": {"compact": read_log("magnetic_iterations.csv")},
            "joint": read_log("joint_iterations.csv")}

    payload = {
        "written_by": "Mohamed Sobh, LIAG",
        "mesh": {"hx": [float(x) for x in hx], "hy": [float(x) for x in hy], "hz": [float(x) for x in hz],
                 "origin": [float(x) for x in origin], "n_pad_xy": 5},
        "models": out_models,
        "far": {k: b64(v.reshape(-1)) for k, v in far.items()},
        "mask_m": MASK_M,
        "data": data,
        "sections": sections,
        "logs": logs,
        "summary": summ,
        "terrain": terrain(mesh, 5),
        "units_names": ["background", "dense, magnetic", "dense, non-magnetic", "light, magnetic", "light, non-magnetic"],
    }
    return payload


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--artifact", help="also write a body-only copy (no doctype/head) to this path")
    args = ap.parse_args()
    payload = build()
    page = open(SRC, encoding="utf-8").read()
    page = page.replace("/*__DATA__*/null", json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    assert "__DATA__" not in page
    if args.artifact:
        open(args.artifact, "w", encoding="utf-8").write(page)
        print("wrote", args.artifact)
    head_end = page.index("</style>") + len("</style>")
    doc = ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           + page[:head_end] + "\n</head>\n<body>\n" + page[head_end:] + "\n</body>\n</html>\n")
    open(OUT, "w", encoding="utf-8").write(doc)
    print(f"wrote {OUT} ({len(doc) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
