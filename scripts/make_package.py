#!/usr/bin/env python3
"""Assemble the downloadable delivery folder and zip it.

Run after scripts/run_processing.py and scripts/build_report_html.py:
    python scripts/make_package.py --out dist
Produces dist/Wadi_Ghadir_Gravity_Package/ and dist/Wadi_Ghadir_Gravity_Package.zip
"""
import argparse
import glob
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = "Wadi_Ghadir_Gravity_Package"

README = """# Wadi Ghadir gravity survey – delivery package

Wadi Ghadir, Eastern Desert, Egypt – CG-6 relative gravity survey, 16–24 January 2026.
Prepared by Dr. Mohamed Sobh, LIAG.

| Folder | Content |
|---|---|
| `01_Report/` | Technical report: `REPORT.html` (self-contained, open in any browser) and `REPORT.md` |
| `02_Maps/` | Publication maps (400 dpi PNG): stations, elevation, height QC, uncertainty, observed gravity, free-air, simple and complete Bouguer, terrain correction, density panels |
| `03_QC_Figures/` | Processing / QC figures: tide check, correction terms, readings, StdDev/tilt, base-100 drift, ties, instrument comparison, GNSS checks |
| `04_Nettleton/` | One density sheet per profile (topography, anomaly for ρ = 2.0–3.0, Nettleton criterion) and summary figures |
| `05_Results_Data/` | **Final results**: `Wadi_Ghadir_Gravity_Results.xlsx` (all sheets, column dictionary), `Wadi_Ghadir_Final_Stations.csv`, GeoJSON (GIS) and KML (Google Earth) |
| `06_Grids/` | Gridded maps as NetCDF and XYZ CSV (lon, lat, UTM 36N, value) + gridding cross-validation |
| `07_Tables_CSV/` | Every processing table (QC rows, occupations, base control, ties, GNSS, Nettleton, …) and `summary.json` |
| `08_Scripts/` | Complete Python processing chain, tests and requirements |
| `09_Input_Data/` | Raw CG-6 and GNSS files as supplied; DEM and geoid windows used (with provenance) |

## Key products (Final_Stations sheet)

* `FA_rel_mGal` – free-air anomaly relative to base 100
* `SB_rel_<ρ>_mGal` – simple Bouguer anomaly, ρ = 2.00–3.00 g/cm³
* `CB_rel_<ρ>_mGal` – complete (terrain-corrected) Bouguer anomaly, ρ = 2.00–3.00 g/cm³ (**recommended: CB_rel_2.67_mGal**)
* `Lat_deg`, `Lon_deg` (WGS84) and `UTM36N_E_m`, `UTM36N_N_m` for plotting

All anomalies are relative to field base 100 (no absolute gravity tie was available). Read the report
sections 1 and 5 before interpreting the values.

## Re-running the processing

```bash
cd 08_Scripts
python -m pip install -r requirements.txt
python scripts/run_processing.py --raw ../09_Input_Data/raw --external ../09_Input_Data/external --out outputs
```
"""


def copy(src_glob, dst):
    os.makedirs(dst, exist_ok=True)
    n = 0
    for f in sorted(glob.glob(os.path.join(ROOT, src_glob))):
        if os.path.isfile(f):
            shutil.copy2(f, dst)
            n += 1
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="dist")
    a = ap.parse_args()
    pkg = os.path.join(ROOT, a.out, NAME)
    if os.path.exists(pkg):
        shutil.rmtree(pkg)
    os.makedirs(pkg)
    with open(os.path.join(pkg, "README.md"), "w") as fh:
        fh.write(README)

    rep = os.path.join(pkg, "01_Report")
    os.makedirs(rep)
    shutil.copy2(os.path.join(ROOT, "report", "REPORT.html"), rep)
    md = open(os.path.join(ROOT, "report", "REPORT.md"), encoding="utf-8").read()
    for old, new in (("../outputs/maps/", "../02_Maps/"), ("../outputs/figures/", "../03_QC_Figures/"),
                     ("../outputs/nettleton/", "../04_Nettleton/")):
        md = md.replace(old, new)
    md = re.sub(r"`outputs/tables/", "`07_Tables_CSV/", md)
    open(os.path.join(rep, "REPORT.md"), "w", encoding="utf-8").write(md)

    counts = {
        "02_Maps": copy("outputs/maps/*.png", os.path.join(pkg, "02_Maps")),
        "03_QC_Figures": copy("outputs/figures/*.png", os.path.join(pkg, "03_QC_Figures")),
        "04_Nettleton": copy("outputs/nettleton/*.png", os.path.join(pkg, "04_Nettleton")),
        "05_Results_Data": copy("outputs/deliverables/*", os.path.join(pkg, "05_Results_Data")),
        "06_Grids": copy("outputs/grids/*", os.path.join(pkg, "06_Grids")),
        "07_Tables_CSV": copy("outputs/tables/*.csv", os.path.join(pkg, "07_Tables_CSV")),
    }
    shutil.copy2(os.path.join(ROOT, "outputs", "summary.json"), os.path.join(pkg, "07_Tables_CSV"))
    code = os.path.join(pkg, "08_Scripts")
    for d in ("wghadir", "scripts", "tests"):
        shutil.copytree(os.path.join(ROOT, d), os.path.join(code, d),
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for f in ("requirements.txt", "README.md"):
        shutil.copy2(os.path.join(ROOT, f), code)
    shutil.copytree(os.path.join(ROOT, "data", "raw"), os.path.join(pkg, "09_Input_Data", "raw"))
    shutil.copytree(os.path.join(ROOT, "data", "external"), os.path.join(pkg, "09_Input_Data", "external"))

    zpath = shutil.make_archive(os.path.join(ROOT, a.out, NAME), "zip", os.path.join(ROOT, a.out), NAME)
    print(counts)
    print(f"package: {pkg}\nzip: {zpath} ({os.path.getsize(zpath) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
