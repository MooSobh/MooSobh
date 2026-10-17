#!/usr/bin/env python3
"""Build the interactive Wadi Ghadir Magnetic Lab (one self-contained HTML file).

The lab runs the ground-magnetic processing chain in the browser (web/src/mag_engine.js):
day segments, Hampel despike, IGRF-14, QC statistics, Verde-style gridding, reduction to
the pole, filters, cross-sections and 2-D magnetic modelling. This script embeds:

* the readings of the supplied workbook (lat, long, E, Reading, Time, Corrected data);
* the IGRF-14 coefficients 2010-2030 (from ppigrf);
* the Python results for the validation chapter (TMA of every 4th reading, the rejected
  spikes, and the TMA and RTP grids sampled every 400 m);
* the Copernicus GLO-30 hillshade and the gravity base 100 (map symbol);
* the pyGIMLi and SimPEG section models of notebook 05 (outputs/modelling_magnetic), when present.

Run after the magnetic chain (outputs/tables/30_mag_readings_qc.csv, outputs/grids/mag_*.nc):
    python scripts/build_magnetic_lab.py
Writes web/Wadi_Ghadir_Magnetic_Lab.html and, with --artifact PATH, a body-only copy for publishing.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import argparse
import glob
import json
import os
import sys

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
sys.path.insert(0, ROOT)
from build_gravity_lab import hillshade_png  # noqa: E402

SRC = os.path.join(ROOT, "web", "src")
MAG_FILE = os.path.join(ROOT, "data", "raw", "magnetics", "All_Data_Corrected_Total_Intensity.xlsx")
# default section: north-south through the strongest RTP anomaly in the south-west (lat, lon)
SECTION = {"A": [24.700, 34.7490], "B": [24.752, 34.7490]}


def cell(v, d):
    if isinstance(v, (int, float, np.floating, np.integer)):
        return None if not np.isfinite(v) else round(float(v), d)
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else str(v)


def readings_table(path):
    raw = pd.read_excel(path, sheet_name=0, header=0).iloc[:, :8]
    keep = [0, 1, 4, 5, 6, 7]                       # lat, long, E, Reading, Time, Corrected data
    digits = [7, 7, 2, 2, 0, 2]
    head = [str(raw.columns[i]).strip() for i in keep]
    rows = [[cell(r[i], d) for i, d in zip(keep, digits)] for r in raw.itertuples(index=False)]
    rows = [[int(v) if (j == 4 and isinstance(v, float)) else v for j, v in enumerate(r)] for r in rows]
    return [head] + rows


def igrf_coefficients():
    import ppigrf
    shc = glob.glob(os.path.join(os.path.dirname(ppigrf.__file__), "IGRF14.shc"))[0]
    lines = [ln for ln in open(shc) if not ln.startswith("#")]
    years = list(map(float, lines[1].split()))
    keep = [i for i, y in enumerate(years) if y >= 2010]
    n, m, v = [], [], [[] for _ in keep]
    for ln in lines[2:]:
        p = ln.split()
        n.append(int(p[0]))
        m.append(int(p[1]))
        for j, i in enumerate(keep):
            v[j].append(float(p[2 + i]))
    return {"epochs": [years[i] for i in keep], "n": n, "m": m, "v": v}


def python_reference(outputs):
    import pyproj
    import xarray as xr
    t = pd.read_csv(os.path.join(outputs, "tables", "30_mag_readings_qc.csv"))
    a = t[t["accepted"]].iloc[::4]
    spikes = t.loc[t["flags"].fillna("").str.contains("SPIKE"), "source_row"].astype(int).tolist()
    inv = pyproj.Transformer.from_crs("EPSG:32636", "EPSG:4326", always_xy=True)
    tma = xr.open_dataset(os.path.join(outputs, "grids", "mag_tma.nc"))
    rtp = xr.open_dataset(os.path.join(outputs, "grids", "mag_rtp.nc"))
    T = tma[list(tma.data_vars)[0]].isel(easting=slice(None, None, 8), northing=slice(None, None, 8))
    R = rtp[list(rtp.data_vars)[0]].interp(easting=T.easting, northing=T.northing)
    E, N = np.meshgrid(T.easting.values, T.northing.values)
    lon, lat = inv.transform(E, N)
    ok = np.isfinite(T.values) & np.isfinite(R.values)
    grid = [[round(float(x), 6), round(float(y), 6), round(float(u), 1), round(float(w), 1)]
            for x, y, u, w in zip(lon[ok], lat[ok], T.values[ok], R.values[ok])]
    return {"rows": a["source_row"].astype(int).tolist(), "tma": [round(float(v), 2) for v in a["tma_nT"]],
            "spikes": spikes, "grid": grid}


def model_results(outputs):
    """Section A-B of notebook 05 (pyGIMLi and SimPEG); None when the notebook has not been run."""
    d = os.path.join(outputs, "modelling_magnetic")
    if not all(os.path.exists(os.path.join(d, f)) for f in ("summary.json", "section_profile.csv", "pygimli_section_model.csv", "simpeg_section_model.csv")):
        return None
    import pyproj
    summ = json.load(open(os.path.join(d, "summary.json")))
    prof = pd.read_csv(os.path.join(d, "section_profile.csv"), comment="#")

    def matrix(name):
        m = pd.read_csv(os.path.join(d, name)).pivot_table(index="depth_m", columns="distance_m", values="chi_SI")
        return {"x": [round(v, 1) for v in m.columns], "z": [round(v, 1) for v in m.index],
                "v": [[cell(v, 5) for v in row] for row in m.values]}

    utm = pyproj.Proj("EPSG:32636")
    (ea, na), (eb, nb), (be, bn) = utm(*summ["A_lonlat"]), utm(*summ["B_lonlat"]), utm(*summ["block"]["center_lonlat"])
    L = summ["length_m"]
    t = ((be - ea) * (eb - ea) + (bn - na) * (nb - na)) / L     # block centre along the section
    blk = summ["block"]
    col = lambda c: [cell(v, 2) for v in prof[c]]  # noqa: E731
    return {"A": [summ["A_lonlat"][1], summ["A_lonlat"][0]], "B": [summ["B_lonlat"][1], summ["B_lonlat"][0]], "L": L, "summary": summ,
            "block": {"x0": t - blk["size_n_m"] / 2, "x1": t + blk["size_n_m"] / 2, "z0": blk["top_m"], "z1": blk["bottom_m"], "chi": blk["chi_SI"]},
            "x": [round(v, 1) for v in prof["distance_m"]], "data": col("data_nT"), "fwd": col("pygimli_block_nT"),
            "pg": col("pygimli_inversion_nT"), "sp": col("simpeg_inversion_nT"),
            "pgm": matrix("pygimli_section_model.csv"), "spm": matrix("simpeg_section_model.csv")}


def build(outputs, external):
    summ = os.path.join(outputs, "summary.json")
    base = json.load(open(summ))["ref"]["base_100"] if os.path.exists(summ) else {"lat": 24.786748811111114, "lon": 34.9337552}
    return {"survey": "Wadi Ghadir, Eastern Desert, Egypt", "table": readings_table(MAG_FILE), "igrf": igrf_coefficients(),
            "python": python_reference(outputs), "model": model_results(outputs), "base": {"lat": base["lat"], "lon": base["lon"]}, "section": SECTION,
            "hillshade": hillshade_png(os.path.join(external, "copernicus_glo30_wadi_ghadir.tif"))}


def assemble(data):
    read = lambda f: open(os.path.join(SRC, f), encoding="utf-8").read()  # noqa: E731
    body = read("mag_body.html")
    js = [read("gl_core.js"), read("ui_core.js"), read("engine.js"), read("model.js"), read("mag_engine.js"),
          "const WGM_DATA = " + json.dumps(data, separators=(",", ":")).replace("</", "<\\/") + ";", read("mag_lab.js")]
    return body.replace("/*@@CSS@@*/", read("base.css") + "\n" + read("lab.css")).replace("/*@@JS@@*/", "\n".join(js))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--outputs", default=os.path.join(ROOT, "outputs"))
    ap.add_argument("--external", default=os.path.join(ROOT, "data", "external"))
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "Wadi_Ghadir_Magnetic_Lab.html"))
    ap.add_argument("--artifact", help="also write a body-only copy for publishing as a claude.ai artifact")
    ap.add_argument("--data-json", help="also write the embedded data bundle as JSON (for testing)")
    a = ap.parse_args()
    data = build(a.outputs, a.external)
    if a.data_json:
        json.dump(data, open(a.data_json, "w"))
    page = assemble(data)
    doc = ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           + page.replace("<!--@@HEAD_END@@-->", "</head>\n<body>") + "\n</body>\n</html>\n")
    with open(a.out, "w", encoding="utf-8") as fh:
        fh.write(doc)
    print(f"wrote {a.out} ({os.path.getsize(a.out) / 1e6:.2f} MB)")
    if a.artifact:
        with open(a.artifact, "w", encoding="utf-8") as fh:
            fh.write(page.replace("<!--@@HEAD_END@@-->", ""))
        print(f"wrote {a.artifact}")


if __name__ == "__main__":
    main()
