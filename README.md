# Wadi Ghadir CG-6 gravity survey – processing and QC

Reproducible processing of the January 2026 Wadi Ghadir (Eastern Desert, Egypt)
relative gravity survey: two Scintrex CG-6 meters (#0640 and #0313) and the GNSS
point files.

* **Technical report:** [`report/REPORT.md`](report/REPORT.md) (an HTML version with embedded figures is in `report/REPORT.html`)
* **Machine-readable outputs:** `outputs/tables/*.csv`, `outputs/summary.json`
* **Figures:** `outputs/figures/*.png`

## Status of the products

| Product | Status |
|---|---|
| Δg relative to base 100, per station, with QC and drift control | ready (985 field stations) |
| Free-air, simple Bouguer and **complete (terrain-corrected) Bouguer** anomalies relative to base 100, ρ = 2.0–3.0 g/cm³ | ready, relative to base 100 (EGM2008 orthometric heights; Copernicus GLO-30 terrain correction) |
| Maps (11), Nettleton sheets (22 profiles), grids (NetCDF/XYZ), Excel workbook, GeoJSON, KML | ready |
| Ground magnetics: total field (points and grid), IGRF-14 anomaly, reduced-to-pole, Excel workbook | ready (IGRF date assumed 20 Jan 2026) |
| Absolute anomalies | **not possible** without an absolute gravity tie |
| Bouguer density | working value 2.67 g/cm³; robust Nettleton profiles 2.71–2.96 g/cm³ (report §4.3) |

## Run

```bash
python -m pip install -r requirements.txt
python scripts/run_processing.py --raw data/raw --out outputs   # ~3 min; first run downloads DEM/geoid windows
python scripts/run_magnetics.py                                 # magnetics: QC, IGRF, maps, RTP (~1 min)
python scripts/build_report_html.py                             # report/REPORT.html
python scripts/make_package.py --out dist                       # dist/Wadi_Ghadir_Gravity_Package(.zip)
python -m pytest -q tests
```

## Layout

```
data/raw/               supplied files, unchanged (SHA-256 in outputs/tables/01_file_inventory.csv)
data/external/          Copernicus GLO-30 and EGM2008 windows used (with provenance)
wghadir/cg6.py          CG-6 export reader, occupation grouping
wghadir/tide.py         Longman (1959) tide, reproduces the CG-6 TideCorr to 0.2 µGal rms
wghadir/qc.py           row-level QC thresholds and flags
wghadir/gnss.py         DMS workbooks and KML readers
wghadir/pipeline.py     processing stages (inventory → QC → GNSS → base control → reductions → Nettleton)
wghadir/reduce.py       normal gravity, free-air, Bouguer slab
wghadir/nettleton.py    density sweep, regression density, block bootstrap
wghadir/geodata.py      Copernicus GLO-30 DEM and EGM2008 geoid (download + cache), sampling, hillshade
wghadir/terrain.py      DEM prism topographic effect (Harmonica), inner/outer zones, Earth curvature
wghadir/maps.py         publication maps and grids (Verde spline, UTM 36N)
wghadir/nettleton_figs.py  per-profile Nettleton sheets and summaries
wghadir/export.py       Excel workbook, GeoJSON, KML
wghadir/magnetics.py    magnetic QC (despike, crossovers), IGRF-14, gridding, RTP, maps
wghadir/figures.py      QC figures
scripts/run_processing.py      full chain
scripts/build_report_html.py   self-contained HTML report
scripts/make_package.py        delivery folder and zip
scripts/terrain_correction.py  stand-alone terrain correction for another DEM (+ slab self-test)
tests/                  regression tests
```
