#!/usr/bin/env python3
"""Assemble the downloadable packages.

Run after scripts/run_all.py and scripts/build_report_html.py:
    python scripts/make_package.py --out dist             # results delivery folder + zip (+ zip parts)
    python scripts/make_package.py --out dist --chains    # code-only package: chains, notebooks, environment

Results package:  dist/Wadi_Ghadir_Gravity_Package/ and .zip (report, maps, figures, data, grids, tables,
                  code, input data)
Chains package:   dist/Wadi_Ghadir_Processing_Chains.zip (package wghadir, scripts, tests, executed notebooks,
                  environment.yml, input data, reference result sheets; the 12 MB DEM is downloaded
                  automatically on the first run)

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import argparse
import glob
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = "Wadi_Ghadir_Gravity_Package"
CHAINS_NAME = "Wadi_Ghadir_Processing_Chains"
CODE_FILES = ("README.md", "environment.yml", "requirements.txt", "pyproject.toml")
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", ".ipynb_checkpoints", "*.egg-info")

README = """# Wadi Ghadir gravity survey – delivery package

Wadi Ghadir, Eastern Desert, Egypt – CG-6 relative gravity survey, 16–24 January 2026.
Prepared by Dr. Mohamed Sobh, LIAG.

| Folder | Content |
|---|---|
| `01_Report/` | Technical report: `REPORT.html` (self-contained, open in any browser) and `REPORT.md` |
| `02_Maps/` | Publication maps (400 dpi PNG): stations, elevation, height QC, uncertainty, observed gravity, free-air, simple and complete Bouguer, terrain correction, density panels; `Magnetics/`: total field (points and grid), anomaly, reduced-to-pole |
| `03_QC_Figures/` | Processing / QC figures: tide check, correction terms, readings, StdDev/tilt, base-100 drift, ties, instrument comparison, GNSS checks |
| `04_Nettleton/` | One density sheet per profile (topography, anomaly for ρ = 2.0–3.0, Nettleton criterion) and summary figures |
| `05_Results_Data/` | **Final results**: `Wadi_Ghadir_Gravity_Results.xlsx` (all sheets, column dictionary), `Wadi_Ghadir_Magnetic_Results.xlsx`, `Wadi_Ghadir_Final_Stations.csv`, GeoJSON (GIS) and KML (Google Earth) |
| `06_Grids/` | Gridded maps as NetCDF and XYZ CSV (lon, lat, UTM 36N, value) + gridding cross-validation |
| `07_Tables_CSV/` | Every processing table (QC rows, occupations, base control, ties, GNSS, Nettleton, …) and `summary.json` |
| `08_Scripts/` | Python package `wghadir` (gravity and magnetic chains), scripts, notebooks, tests, `environment.yml` |
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
conda env create -f environment.yml && conda activate wghadir     # or: python -m pip install -r requirements.txt
python scripts/run_all.py --raw ../09_Input_Data/raw --external ../09_Input_Data/external --out outputs \
    --mag ../09_Input_Data/raw/magnetics/All_Data_Corrected_Total_Intensity.xlsx
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
    ap.add_argument("--split-mb", type=float, default=40.0,
                    help="also write numbered zip parts below this size (0 = off)")
    ap.add_argument("--chains", action="store_true", help="build the code-only chains package instead")
    a = ap.parse_args()
    if a.chains:
        return chains_package(os.path.join(ROOT, a.out))
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
    for old, new in (("../outputs/magnetics/", "../02_Maps/Magnetics/"), ("../outputs/maps/", "../02_Maps/"), ("../outputs/figures/", "../03_QC_Figures/"),
                     ("../outputs/nettleton/", "../04_Nettleton/")):
        md = md.replace(old, new)
    md = re.sub(r"`outputs/tables/", "`07_Tables_CSV/", md)
    open(os.path.join(rep, "REPORT.md"), "w", encoding="utf-8").write(md)

    counts = {
        "02_Maps": copy("outputs/maps/*.png", os.path.join(pkg, "02_Maps")),
        "03_QC_Figures": copy("outputs/figures/*.png", os.path.join(pkg, "03_QC_Figures")),
        "04_Nettleton": copy("outputs/nettleton/*.png", os.path.join(pkg, "04_Nettleton")),
        "02_Maps/Magnetics": copy("outputs/magnetics/*.png", os.path.join(pkg, "02_Maps", "Magnetics")),
        "05_Results_Data": copy("outputs/deliverables/*", os.path.join(pkg, "05_Results_Data")),
        "06_Grids": copy("outputs/grids/*", os.path.join(pkg, "06_Grids")),
        "07_Tables_CSV": copy("outputs/tables/*.csv", os.path.join(pkg, "07_Tables_CSV")),
    }
    shutil.copy2(os.path.join(ROOT, "outputs", "summary.json"), os.path.join(pkg, "07_Tables_CSV"))
    code = os.path.join(pkg, "08_Scripts")
    for d in ("wghadir", "scripts", "tests", "notebooks", "web", "third_party"):
        shutil.copytree(os.path.join(ROOT, d), os.path.join(code, d), ignore=IGNORE)
    for f in CODE_FILES:
        shutil.copy2(os.path.join(ROOT, f), code)
    shutil.copytree(os.path.join(ROOT, "data", "raw"), os.path.join(pkg, "09_Input_Data", "raw"))
    shutil.copytree(os.path.join(ROOT, "data", "external"), os.path.join(pkg, "09_Input_Data", "external"))

    zpath = shutil.make_archive(os.path.join(ROOT, a.out, NAME), "zip", os.path.join(ROOT, a.out), NAME)
    print(counts)
    print(f"package: {pkg}\nzip: {zpath} ({os.path.getsize(zpath) / 1e6:.1f} MB)")
    if a.split_mb:
        split_zips(pkg, os.path.join(ROOT, a.out), a.split_mb * 1e6)


def chains_package(out_dir):
    """One zip with the processing chains: code, notebooks, environment and the input data."""
    pkg = os.path.join(out_dir, CHAINS_NAME)
    if os.path.exists(pkg):
        shutil.rmtree(pkg)
    os.makedirs(pkg)
    for d in ("wghadir", "scripts", "tests", "notebooks", "web", "third_party"):
        shutil.copytree(os.path.join(ROOT, d), os.path.join(pkg, d), ignore=IGNORE)
    for f in CODE_FILES:
        shutil.copy2(os.path.join(ROOT, f), pkg)
    os.makedirs(os.path.join(pkg, "report"))
    shutil.copy2(os.path.join(ROOT, "report", "REPORT.md"), os.path.join(pkg, "report"))
    shutil.copytree(os.path.join(ROOT, "data", "raw"), os.path.join(pkg, "data", "raw"))
    # the geoid window and the DEM provenance are small; the 12 MB DEM is fetched on the first run
    ext = os.path.join(pkg, "data", "external")
    os.makedirs(ext)
    for f in sorted(os.listdir(os.path.join(ROOT, "data", "external"))):
        if not f.startswith("copernicus_glo30_wadi_ghadir.tif"):
            shutil.copy2(os.path.join(ROOT, "data", "external", f), ext)
    # the delivered result sheets, to compare a local run with
    shutil.copytree(os.path.join(ROOT, "outputs", "deliverables"), os.path.join(pkg, "reference_results"))
    for f in ("summary.json", "magnetics_summary.json"):
        shutil.copy2(os.path.join(ROOT, "outputs", f), os.path.join(pkg, "reference_results"))
    # section models of notebook 04 (pyGIMLi, SimPEG); notebook 04 itself starts from the grids of notebook 03
    if os.path.isdir(os.path.join(ROOT, "outputs", "modelling")):
        shutil.copytree(os.path.join(ROOT, "outputs", "modelling"), os.path.join(pkg, "reference_results", "modelling"))
    zpath = shutil.make_archive(pkg, "zip", out_dir, CHAINS_NAME)
    print(f"chains package: {zpath} ({os.path.getsize(zpath) / 2 ** 20:.1f} MiB)")
    return zpath


def split_zips(pkg, out_dir, limit):
    """Numbered zip parts (each < limit bytes) that unpack into the same folder tree."""
    import zipfile
    import zlib

    files = []
    for dp, _, fns in os.walk(pkg):
        for fn in sorted(fns):
            full = os.path.join(dp, fn)
            with open(full, "rb") as fh:
                csize = len(zlib.compress(fh.read(), 6))  # parts are limited by their compressed size
            files.append((os.path.relpath(full, os.path.dirname(pkg)), full, csize))
    files.sort(key=lambda t: t[0])
    parts, cur, size = [], [], 0
    for rel, full, sz in files:
        if cur and size + sz > limit:
            parts.append(cur)
            cur, size = [], 0
        cur.append((rel, full))
        size += sz
    parts.append(cur)
    for old in glob.glob(os.path.join(out_dir, NAME + "_part*.zip")):
        os.remove(old)
    for k, part in enumerate(parts, 1):
        zp = os.path.join(out_dir, f"{NAME}_part{k}of{len(parts)}.zip")
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
            for rel, full in part:
                z.write(full, rel)
        tops = sorted({r.split(os.sep)[1] for r, _ in part if r.count(os.sep) >= 1})
        print(f"{os.path.basename(zp)}: {os.path.getsize(zp) / 1e6:.1f} MB  [{', '.join(tops)}]")


if __name__ == "__main__":
    main()
