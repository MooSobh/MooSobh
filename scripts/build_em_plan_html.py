#!/usr/bin/env python3
"""Build the interactive Wadi Ghadir EM Survey Planner (one self-contained HTML file).

The page shows the EM survey design of scripts/design_em_survey.py interactively: plan map over the
relief, residual gravity or RTP magnetics; target footprints; TEM/AMT lines and stations; a section along
each line with the compact joint model, the target depths and the depth of investigation, which follows
the host resistivity, loop size, current and noise chosen on the page; a depth-of-investigation chart;
the station list and the field files (CSV, GPX, KML) to download.

Run after scripts/design_em_survey.py:
    python scripts/build_em_plan_html.py
Writes web/Wadi_Ghadir_EM_Survey_Planner.html and, with --artifact PATH, a body-only copy for publishing.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import argparse
import base64
import json
import os
import sys

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import design_em_survey as E  # noqa: E402
from build_inversion_explorer import terrain  # noqa: E402
from wghadir import inversion as W  # noqa: E402

SRC = os.path.join(ROOT, "web", "src", "em_plan.html")
OUT = os.path.join(ROOT, "web", "Wadi_Ghadir_EM_Survey_Planner.html")
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()  # noqa: E731


def grids(T, g):
    """Residual gravity [0.01 mGal] and RTP [nT] on a 100 m grid over the terrain extent, rows north to south (int16, -32768 = none)."""
    from scipy.interpolate import griddata
    from scipy.spatial import cKDTree
    xs = np.arange(T["x0"] + 50, T["x1"], 100.0)
    ys = np.arange(T["y1"] - 50, T["y0"], -100.0)
    X, Y = np.meshgrid(xs, ys)
    d = g["data_xyz"]
    G = griddata(d[:, :2], g["data_mgal"], (X, Y), method="linear")
    G[cKDTree(d[:, :2]).query(np.c_[X.ravel(), Y.ravel()])[0].reshape(X.shape) > 1500] = np.nan
    rtp = pd.read_csv(os.path.join(ROOT, "outputs", "grids", "mag_rtp_xyz.csv")).dropna()
    dist, idx = cKDTree(rtp[["easting_utm36n", "northing_utm36n"]].values).query(np.c_[X.ravel(), Y.ravel()])
    M = np.where(dist < 100, rtp["rtp_nT"].values[idx], np.nan).reshape(X.shape)
    q = lambda a, s: np.where(np.isfinite(a), np.round(a * s), -32768).astype(np.int16)  # noqa: E731
    return {"nx": len(xs), "ny": len(ys), "grav": b64(q(G, 100)), "rtp": b64(q(M, 1)),
            "grav_lim": float(np.nanpercentile(np.abs(G), 98)), "rtp_lim": float(np.nanpercentile(np.abs(M), 98))}


def lonlat_fit(T):
    """Quadratic fit (E, N) -> (lon, lat) over the area, accurate to well under a metre."""
    E_, N_ = np.meshgrid(np.linspace(T["x0"], T["x1"], 25), np.linspace(T["y0"], T["y1"], 25))
    lon, lat = W.to_lonlat(E_.ravel(), N_.ravel())
    e0, n0 = (T["x0"] + T["x1"]) / 2, (T["y0"] + T["y1"]) / 2
    u, v = (E_.ravel() - e0) / 1e4, (N_.ravel() - n0) / 1e4
    A = np.c_[np.ones_like(u), u, v, u * u, u * v, v * v]
    return {"e0": e0, "n0": n0, "lon": np.linalg.lstsq(A, lon, rcond=None)[0].tolist(), "lat": np.linalg.lstsq(A, lat, rcond=None)[0].tolist()}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--artifact", help="also write a body-only copy (no doctype/head) to this path")
    args = ap.parse_args()
    mesh, act, rho, chi, g, m, targets, lines, st = E.compute()
    T = terrain(mesh, 5)
    wlines, wst, sched = E.week_plan(lines, targets, g, m)

    def sec_of(ln):
        d, zc, R = W.section(mesh, rho, tuple(ln["a"]), tuple(ln["b"]), step=50.0, zmin=E.ZMIN)
        _, _, C = W.section(mesh, chi, tuple(ln["a"]), tuple(ln["b"]), step=50.0, zmin=E.ZMIN)
        zb = zc - mesh.h[2][-len(zc):] / 2
        zt = zc + mesh.h[2][-len(zc):] / 2
        qr = np.where(np.isfinite(R), np.round(np.clip(R / 0.3, -1, 1) * 127), -128).astype(np.int8)
        qc = np.where(np.isfinite(C), np.round(np.clip(C / 0.3, 0, 1) * 127), -128).astype(np.int8)
        return {"n": len(d), "step": 50.0, "zb": zb.tolist(), "zt": zt.tolist(), "rho": b64(qr), "chi": b64(qc)}
    sections = {ln["id"]: sec_of(ln) for ln in lines}
    week_sections = {ln["id"]: sec_of(ln) for ln in wlines}
    tlist = []
    for t in targets:
        from scipy.spatial import ConvexHull
        p = t["footprint"]
        hull = p[ConvexHull(p).vertices] if len(p) >= 3 else p
        lon, lat = W.to_lonlat(t["e"], t["n"])
        tlist.append({"id": t["id"], "kind": t["kind"], "e": t["e"], "n": t["n"], "lon": float(lon), "lat": float(lat),
                      "top_depth": t["top_depth"], "centre_depth": t["centre_depth"], "bottom_elev": t["bottom_elev"],
                      "peak": t["peak"], "other_mean": float(t["other_mean"]), "agree": int(t.get("agree", 0)), "agree_share": float(t.get("agree_share", 0)),
                      "g_mgal": float(t.get("g_mgal", np.nan)), "rtp_nT": float(t.get("rtp_nT", np.nan)), "volume_km3": t["volume_km3"], "dense_magnetic_share": t["dense_magnetic_share"],
                      "hull": np.round(hull, 1).tolist()})
    wlist = [{"id": ln["id"], "target": ln["target"], "priority": ln["priority"], "method": ln["method"], "loop_m": ln["loop_m"],
              "spacing_m": ln["spacing_m"], "outer_m": ln["outer_m"], "amt_spacing_m": ln["amt_spacing_m"], "length_m": ln["length_m"],
              "a": [float(v) for v in ln["a"]], "b": [float(v) for v in ln["b"]], "purpose": ln["purpose"],
              "n_tem": ln["n_tem"], "n_amt": ln["n_amt"]} for ln in wlines]
    llist = [{"id": ln["id"], "target": ln["target"], "priority": ln["priority"], "method": ln["method"], "loop_m": ln["loop_m"],
              "spacing_m": ln["spacing_m"] if ln["loop_m"] else 0, "amt_spacing_m": ln["amt_spacing_m"], "length_m": ln["length_m"],
              "a": [float(v) for v in ln["a"]], "b": [float(v) for v in ln["b"]], "purpose": ln["purpose"],
              "n_tem": ln["n_tem"], "n_amt": ln["n_amt"]} for ln in lines]
    files = {}
    for name in ("em_stations.csv", "em_lines.csv", "em_targets.csv", "em_survey.gpx", "em_survey.kml",
                 "em_week_stations.csv", "em_week_lines.csv", "em_week_schedule.csv", "em_week.gpx", "em_week.kml"):
        files[name] = open(os.path.join(E.OUT, name), encoding="utf-8").read()
    synthetic = {}
    sdir = os.path.join(E.OUT, "synthetic")
    if os.path.exists(os.path.join(sdir, "em_synthetic_summary.csv")):
        import io
        from PIL import Image
        summ = pd.read_csv(os.path.join(sdir, "em_synthetic_summary.csv"), comment="#")
        for row in summ.to_dict(orient="records"):
            png = os.path.join(sdir, f"em_synthetic_{row['line']}.png")
            if not os.path.exists(png):
                continue
            im = Image.open(png).convert("RGB")
            im.thumbnail((1500, 1500))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=78, optimize=True)
            row = {k: (None if isinstance(v, float) and np.isnan(v) else v) for k, v in row.items()}
            synthetic[row["line"]] = {"summary": row, "img": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}
    payload = {"written_by": "Mohamed Sobh, LIAG", "synthetic": synthetic, "terrain": T, "grids": grids(T, g), "ll": lonlat_fit(T),
               "tracks": {"gravity": np.round(g["data_xyz"][:, :2], 0).tolist(), "magnetic": np.round(m["data_xyz"][:, :2], 0).tolist()},
               "targets": tlist, "lines": llist, "stations": st.to_dict(orient="list"), "sections": sections,
               "week": {"lines": wlist, "stations": wst.to_dict(orient="list"), "sections": week_sections, "schedule": sched.to_dict(orient="records"),
                        "rates": {"tem": E.TEM_RATE, "amt": E.AMT_RATE, "first_day": E.FIRST_DAY, "move": E.MOVE_DAYS, "days": E.WEEK_DAYS}},
               "tem": {"current": E.TEM_CURRENT_A, "noise": E.TEM_NOISE, "last_gate": E.TEM_LAST_GATE_S},
               "resistivities": {k: list(v) for k, v in E.RESISTIVITIES.items()}, "files": files}
    page = open(SRC, encoding="utf-8").read().replace("/*__DATA__*/null", json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    assert "__DATA__" not in page
    if args.artifact:
        open(args.artifact, "w", encoding="utf-8").write(page)
        print("wrote", args.artifact)
    k = page.index("</style>") + len("</style>")
    doc = ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           + page[:k] + "\n</head>\n<body>\n" + page[k:] + "\n</body>\n</html>\n")
    open(OUT, "w", encoding="utf-8").write(doc)
    print(f"wrote {OUT} ({len(doc) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
