# Wadi Ghadir gravity and magnetic survey – processing chains

**Prepared by Dr. Mohamed Sobh, LIAG** (Leibniz Institute for Applied Geophysics)

Reproducible processing of the January 2026 Wadi Ghadir (Eastern Desert, Egypt) survey:

* **Gravity:** two Scintrex CG-6 meters (#0640 and #0313), GNSS station coordinates, Copernicus
  GLO-30 DEM and EGM2008 geoid. Products: free-air, simple and complete (terrain-corrected) Bouguer
  anomalies relative to base 100 for ρ = 2.0–3.0 g/cm³, and Nettleton density analysis.
* **Magnetics:** diurnally corrected total field. Products: QC and despiking, IGRF-14 anomaly,
  grids and reduction to the pole.

The technical report is [`report/REPORT.md`](report/REPORT.md). An HTML version with embedded figures is
in `report/REPORT.html`.

## 1  Installation

With conda or mamba (recommended: rasterio and pyproj come with their binary libraries):

```bash
conda env create -f environment.yml
conda activate wghadir
python -m pytest -q              # 13 tests, about 10 s
```

With pip, using an existing Python ≥ 3.10:

```bash
python -m pip install -r requirements.txt
python -m pip install -e .       # optional: makes `import wghadir` work from anywhere
```

## 2  Running the chains

**Step by step in Jupyter** (recommended for checking every intermediate result):

```bash
jupyter lab notebooks/
```

* `notebooks/01_Gravity_Processing.ipynb`: gravity, steps 1–14, from loading the CG-6 files to the maps.
* `notebooks/02_Magnetic_Processing.ipynb`: magnetics, steps 1–8, from loading the workbook to the RTP map.
* `notebooks/03_Gravity_OpenSource_Workflow.ipynb`: gravity from readings to maps with the open-source stack:
  pygtide/ETERNA (tide), Boule (normal gravity, gravity disturbance), Harmonica and Choclo (Bouguer and terrain
  prisms, equivalent sources, filters), Verde (gridding), SGTool (derivatives, tilt angle) and PyGMT (maps).
  Results go to `outputs/open_source/`.

Each step has a **✏️ PARAMETERS** cell (thresholds, densities, grid spacing and so on, all editable), a **▶ PROCESSING**
cell that calls the `wghadir` functions directly, and a **📊 RESULT** cell with tables and plots made in the notebook.
After a change, re-run that step and the steps below it. The default parameters reproduce the delivered results.

**Interactive lab in the browser:** open `web/Wadi_Ghadir_Gravity_Lab.html` in any browser (no installation).
It runs the gravity chain in JavaScript on the raw CG-6 files, with every parameter adjustable, maps, filters
and exports, and accepts your own CG-6 exports and station table (chapter 2.1). Rebuild it after changing the
Python results with `python scripts/build_gravity_lab.py`; its sources are in `web/src/`.

**From the command line:**

```bash
python scripts/run_all.py                # gravity, then magnetics (~5 min incl. 400 dpi maps)
python scripts/run_gravity.py            # gravity only   (--no-figures: ~1 min)
python scripts/run_magnetics.py          # magnetics only (~1 min)
python scripts/build_gravity_lab.py      # rebuild web/Wadi_Ghadir_Gravity_Lab.html
```

**From Python:**

```python
from wghadir.chains import GravityChain, MagneticChain

g = GravityChain(raw_dir="data/raw", external_dir="data/external", out_dir="outputs")
g.step01_inventory()          # ... each step can be run and inspected separately
g.run_all()                   # or all 14 steps

m = MagneticChain(mag_file="data/raw/magnetics/All_Data_Corrected_Total_Intensity.xlsx", out_dir="outputs")
m.run_all()
```

Gravity step 7 needs the Copernicus GLO-30 DEM window (12 MB) and the EGM2008 geoid window in
`data/external/`. Both are in the repository. In the code-only zip (`Wadi_Ghadir_Processing_Chains.zip`)
the DEM is left out to keep the download small, and step 7 downloads it automatically on the first run
(internet needed once; it is then cached).

## 3  The processing steps

| Gravity (`GravityChain`) | | Magnetics (`MagneticChain`) | |
|---|---|---|---|
| 1 | inventory, SHA-256, CG-6 metadata | 1 | load rows, UTM 36N, survey days |
| 2 | check CorrGrav = Raw + Tide + Tilt + Temp + Drift | 2 | despike (Hampel filter per day) |
| 3 | Longman tide at the GPS position (UTC) | 3 | IGRF-14 → anomaly TMA = TMI − IGRF |
| 4 | row QC (StdDev, tilt, overflow, frozen sensor, repeats) | 4 | day summary, crossovers, IGRF date sensitivity |
| 5 | station occupations | 5 | gridding of TMI and TMA |
| 6 | GNSS parsing, datum check, day mapping, matching | 6 | reduction to the pole (FFT) |
| 7 | EGM2008 orthometric heights, DEM comparison | 7 | maps: points and grids |
| 8 | base-100 control, drift model, closures | 8 | export: tables, grids, workbook |
| 9 | instrument scale factor and re-ties | | |
| 10 | free-air and simple Bouguer anomalies | | |
| 11 | DEM terrain correction, complete Bouguer anomalies | | |
| 12 | Nettleton density (profiles, windows, consensus) | | |
| 13 | summary and deliverables (xlsx, csv, geojson, kml) | | |
| 14 | QC figures, maps, grids, Nettleton sheets | | |

All tunable values are in `wghadir/gravity/settings.py` and `wghadir/magnetic/settings.py`.

## 4  Layout

```
environment.yml, requirements.txt, pyproject.toml   installation
notebooks/                 01_Gravity_Processing.ipynb, 02_Magnetic_Processing.ipynb, 03_Gravity_OpenSource_Workflow.ipynb
web/                       Wadi_Ghadir_Gravity_Lab.html (interactive lab) and its sources in web/src/
third_party/sgtool/        SGTool filter engine (MIT, vendored unchanged; see its README)
scripts/                   run_all.py, run_gravity.py, run_magnetics.py, build_report_html.py, make_package.py
wghadir/
  chains/gravity.py        GravityChain   – the gravity chain, steps 1-14
  chains/magnetic.py       MagneticChain  – the magnetic chain, steps 1-8
  gravity/                 settings, cg6 reader, tide, qc, gnss, inventory, positioning, base_control,
                           instruments, reduce, terrain, reductions, nettleton, density,
                           figures, maps, nettleton_figs, export
  magnetic/                settings, processing (QC, IGRF, gridding, RTP), maps, export
  common/                  geodata (DEM, geoid), mapping (map style), excel, display (notebooks)
tests/                     regression tests (python -m pytest -q)
data/raw/                  supplied files, unchanged (SHA-256 in outputs/tables/01_file_inventory.csv)
data/external/             Copernicus GLO-30 and EGM2008 windows used (with provenance)
outputs/                   results: deliverables/, tables/, maps/, grids/, figures/, nettleton/, magnetics/
report/                    REPORT.md and REPORT.html
reference_results/         (zip only) delivered result sheets and summaries, to compare a local run with
```

## 5  Status of the products

| Product | Status |
|---|---|
| Δg relative to base 100, per station, with QC and drift control | ready (985 field stations) |
| Free-air, simple Bouguer and **complete (terrain-corrected) Bouguer** anomalies relative to base 100, ρ = 2.0–3.0 g/cm³ | ready (EGM2008 orthometric heights; Copernicus GLO-30 terrain correction) |
| Maps (11), Nettleton sheets (22 profiles), grids (NetCDF/XYZ), Excel workbook, GeoJSON, KML | ready |
| Ground magnetics: total field (points and grid), IGRF-14 anomaly, reduced-to-pole, Excel workbook | ready (IGRF date assumed: 20 Jan 2026) |
| Absolute anomalies | **not possible** without an absolute gravity tie |
| Bouguer density | working value 2.67 g/cm³; robust Nettleton profiles 2.71–2.96 g/cm³ (report §4.3) |
