#!/usr/bin/env python3
"""Build the interactive Wadi Ghadir Gravity Lab (one self-contained HTML file).

The lab runs the gravity processing chain in the browser (web/src/engine.js) on the
raw CG-6 files.  This script embeds the Wadi Ghadir example data:

* the two raw CG-6 exports, exactly as supplied;
* the station table from the Python chain (GNSS position, EGM2008 orthometric height
  and the unit topographic effect of the Copernicus DEM, relative to base 100);
* the base-100 and hotel reference marks;
* the Python results (free-air and complete Bouguer, 2.67) for the validation chapter;
* a hillshade of the Copernicus GLO-30 DEM for the map background.

Run after the gravity chain (outputs/tables/15 and 16 must exist):
    python scripts/build_gravity_lab.py
Writes web/Wadi_Ghadir_Gravity_Lab.html (open it in any browser) and, with --artifact PATH,
a body-only copy for publishing.

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
from wghadir.common.geodata import Grid, hillshade  # noqa: E402
from wghadir.gravity.settings import INSTRUMENT_FILES, MATCH_OK  # noqa: E402

SRC = os.path.join(ROOT, "web", "src")
MAP_EXTENT = (34.705, 35.025, 24.665, 24.850)          # lon0, lon1, lat0, lat1 of the hillshade


def r(v, d):
    return None if not np.isfinite(v) else round(float(v), d)


def station_table(tables):
    occ = pd.read_csv(os.path.join(tables, "15_occupations.csv"), dtype={"line": str, "station": str})
    st = pd.read_csv(os.path.join(tables, "16_field_stations_relative.csv"), dtype={"line": str, "station": str})
    u = st.set_index("occ_id")["u_topo_mgal_per_gcc"]
    o = occ[occ["match_status"].isin(MATCH_OK)].copy()
    o["u"] = o["occ_id"].map(u)
    o = o.drop_duplicates(["instrument", "date", "line", "station"])
    # compact rows: instrument, date, line, station, lat, lon, H, u
    return [[a.instrument, a.date, a.line, a.station, r(a.lat, 7), r(a.lon, 7), r(a.H_ortho_m, 3), r(a.u, 5)]
            for a in o.itertuples()]


def python_reference(tables):
    st = pd.read_csv(os.path.join(tables, "16_field_stations_relative.csv"))
    s = st[st["product_ok"]].drop_duplicates("occ_key")
    return {k: [r(fa, 4), r(cb, 4)] for k, fa, cb in zip(s["occ_key"], s["dFA_rel_mgal"], s["dCB_rel_rho2.67_mgal"])}


def hillshade_png(dem_path, width=1100):
    from PIL import Image
    dem = Grid(dem_path)
    lon0, lon1, lat0, lat1 = MAP_EXTENT
    j = (dem.lon >= lon0) & (dem.lon <= lon1)
    i = (dem.lat >= lat0) & (dem.lat <= lat1)
    z = dem.z[np.ix_(i, j)]
    dx = np.radians(dem.dx) * 6371008.8 * np.cos(np.radians(24.76))
    dy = np.radians(dem.dy) * 6371008.8
    hs = hillshade(z, dx, dy, z_factor=1.6)
    sea = z <= 0.5
    rgb = np.dstack([hs * 255] * 3)
    rgb[sea] = [196, 220, 238]
    im = Image.fromarray(rgb.clip(0, 255).astype(np.uint8))
    im = im.resize((width, int(width * im.height / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80, optimize=True)
    lons, lats = dem.lon[j], dem.lat[i]
    return {"src": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
            "lon0": float(lons[0]), "lon1": float(lons[-1]), "lat0": float(lats[-1]), "lat1": float(lats[0])}


def build(raw, tables, external):
    summary = json.load(open(os.path.join(os.path.dirname(tables), "summary.json")))
    b, h = summary["ref"]["base_100"], summary["ref"]["hotel_0"]
    files = []
    for name in INSTRUMENT_FILES.values():
        with open(os.path.join(raw, name), encoding="utf-8", errors="replace") as fh:
            files.append({"name": name, "text": fh.read()})
    return {
        "survey": "Wadi Ghadir, Eastern Desert, Egypt",
        "files": files,
        "stationCols": ["inst", "date", "line", "station", "lat", "lon", "H", "u"],
        "stations": station_table(tables),
        "ref": {"base": {"lat": b["lat"], "lon": b["lon"], "H": b["H_used"], "u": 0.0},
                "hotel": {"lat": h["lat"], "lon": h["lon"]}},
        "python": python_reference(tables),
        "hillshade": hillshade_png(os.path.join(external, "copernicus_glo30_wadi_ghadir.tif")),
    }


def assemble(data):
    read = lambda f: open(os.path.join(SRC, f), encoding="utf-8").read()  # noqa: E731
    body = read("lab_body.html")
    page = (body.replace("/*@@CSS@@*/", read("base.css") + "\n" + read("lab.css"))
                .replace("/*@@JS@@*/", "\n".join([read("gl_core.js"), read("ui_core.js"), read("engine.js"),
                                                  "const WG_DATA = " + json.dumps(data, separators=(",", ":")).replace("</", "<\\/") + ";",
                                                  read("lab.js")])))
    return page


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", default=os.path.join(ROOT, "data", "raw"))
    ap.add_argument("--tables", default=os.path.join(ROOT, "outputs", "tables"))
    ap.add_argument("--external", default=os.path.join(ROOT, "data", "external"))
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "Wadi_Ghadir_Gravity_Lab.html"))
    ap.add_argument("--artifact", help="also write a body-only copy for publishing as a claude.ai artifact")
    ap.add_argument("--data-json", help="also write the embedded data bundle as JSON (for testing)")
    a = ap.parse_args()
    data = build(a.raw, a.tables, a.external)
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
