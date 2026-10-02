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
| Δg relative to base 100, per occupation, with QC and drift control | ready (985 field occupations) |
| Base-relative free-air and simple Bouguer quantities (density sweep 2.0–3.0 g/cm³) | **provisional**: height datum undocumented, no terrain correction |
| Absolute gravity, absolute free-air / complete Bouguer anomalies | **not possible** with the supplied data (no absolute tie, no DEM) |
| Bouguer density from Nettleton profiles | **not determined**: profiles disagree (see report §4.3) |

## Run

```bash
python -m pip install -r requirements.txt
python scripts/run_processing.py --raw data/raw --out outputs   # ~15 s
python -m pytest -q tests                                       # regression tests
python scripts/terrain_correction.py --selftest                 # Harmonica prism check (optional)
```

`run_processing.py` re-creates every table and figure from the five files in `data/raw/`
(the two CG-6 `.dat` exports, `GPS_All_Days.xlsx`, `results.zip`, and the processing brief).
Python ≥ 3.10.

Once a DEM is available (same vertical datum as the station heights, ≥ 22 km beyond the
survey), run

```bash
python scripts/terrain_correction.py --dem dem.nc --density 2.67 \
    --stations outputs/tables/16_field_stations_relative.csv --out outputs/tables/21_terrain_corrected.csv
```

## Layout

```
data/raw/               supplied files, unchanged (SHA-256 in outputs/tables/01_file_inventory.csv)
wghadir/cg6.py          CG-6 export reader, occupation grouping
wghadir/tide.py         Longman (1959) tide, reproduces the CG-6 TideCorr to 0.2 µGal rms
wghadir/qc.py           row-level QC thresholds and flags
wghadir/gnss.py         DMS workbooks and KML readers
wghadir/pipeline.py     processing stages (inventory → QC → GNSS → base control → reductions → Nettleton)
wghadir/reduce.py       normal gravity, free-air, Bouguer slab
wghadir/nettleton.py    density sweep, regression density, block bootstrap
wghadir/figures.py      report figures
scripts/run_processing.py      full chain
scripts/terrain_correction.py  DEM-based topographic correction (Harmonica), not run: no DEM supplied
tests/                  regression tests
```
