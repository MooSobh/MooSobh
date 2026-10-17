# Wadi Ghadir Gravity Lab (interactive, in the browser)

Prepared by Dr. Mohamed Sobh, LIAG.

`Wadi_Ghadir_Gravity_Lab.html` is a single self-contained page: open it in any browser. It runs the
gravity processing chain on the raw CG-6 files in JavaScript, with all parameters adjustable, and accepts
other CG-6 exports and station tables (chapter 2.1).

| Source (`web/src/`) | Content |
|---|---|
| `lab_body.html` | page structure (hero, chapter rail, footer) |
| `base.css`, `gl_core.js`, `ui_core.js` | design system, physics core and app shell from *Static Gravity Lab* (Mohamed Sobh, LIAG) |
| `lab.css` | additions for this lab |
| `model.js` | 2-D Talwani bodies, density fit, depth-weighted 2-D inversion (banded Cholesky, any λ in milliseconds), radial power spectrum, polynomial trends (no DOM) |
| `engine.js` | processing engine: CG-6 parser, tide, QC, occupations, base control and drift, instrument scale, reductions, Nettleton, spline gridding, contours (no DOM; testable in Node) |
| `lab.js` | chapters, maps, interaction, hero animation |

Build after the gravity chain has run (`outputs/tables/15*`, `16*` and `outputs/summary.json`):

```bash
python scripts/build_gravity_lab.py            # writes web/Wadi_Ghadir_Gravity_Lab.html
```

`tests/test_core.py::test_web_lab_engine_matches_python` runs `engine.js` in Node and checks it against the
Python results; `test_web_lab_modelling_engine` checks `model.js` (Talwani against a line mass, inversion of a
buried block). When `outputs/modelling/` exists (notebook 04), the builder embeds the pyGIMLi and SimPEG sections
for chapter 6.4.

## Chapters after gridding

| Chapter | Content |
|---|---|
| 5.2 Filters | regional (upward continuation), residual, low-, high- and band-pass, polynomial trend and residual; 1st and 2nd vertical derivative, ∂/∂x, ∂/∂y, horizontal gradient, analytic signal, tilt, theta, TDX; radially averaged power spectrum with depth estimates |
| 6.1 Cross-section | click A and B on the map; profile of the grid or the filtered grid, topography, stations in a corridor; CSV |
| 6.2 Forward model | 2-D polygons (Talwani): drag vertices and bodies, add or remove vertices, least-squares densities; CSV |
| 6.3 Inversion | cells on the section, smallest or smooth model with Li–Oldenburg depth weighting, λ by the discrepancy principle or by hand, L-curve; CSV |
| 6.4 pyGIMLi and SimPEG | notebook 04 results along the same section: responses, 2-D and 3-D density sections, the code |

## Loading new data

Chapter 2.1 of the lab accepts, together or separately:

* Scintrex CG-6 survey exports (`.dat`, as written by the meter);
* readings tables from any relative gravimeter (`.csv`): columns `date`, `time` (UTC), `station`, `gravity` [mGal],
  optional `line`, `instrument`, `stddev`, `tilt_x`, `tilt_y`, `tidecorr`, `lat`, `lon`;
* a station table (`.csv`): `station`, `lat`, `lon`, `H` (or `h` and `N`), optional `line`, `date`, `instrument`,
  `u_topo` or `tc`. Include the base station with its adopted coordinates.

`web/examples/` holds a ready-made pair to try: the Wadi Ghadir CG-6 #0640 readings as a readings table and its
station table. Loading them reproduces the Python complete Bouguer anomalies of those 531 stations to 0.2 µGal
(`tests/test_core.py::test_web_lab_accepts_uploaded_readings_table`).

## Wadi Ghadir Magnetic Lab

`Wadi_Ghadir_Magnetic_Lab.html` does the same for the ground magnetics, following `wghadir.chains.MagneticChain`:

| Chapter | Content |
|---|---|
| 2.1–2.2 | load the workbook (.xlsx, read with SheetJS, loaded on demand) or a CSV; day segments from the time stamps; diurnal correction |
| 3.1 | Hampel despike (window, k, minimum threshold) with the rejected readings on the map |
| 3.2 | IGRF-14 at every reading (degree 13, evaluated in JavaScript; within 0.1 nT of ppigrf), date sensitivity |
| 3.3 | day summary and crossovers between days |
| 4.1–4.3 | Verde-style gridding (block median, trend, scaled ridge spline), reduction to the pole, 15 filters, power spectrum |
| 5.1–5.4 | cross-section, 2-D magnetic polygons (induced and remanent magnetisation, via Poisson's relation on the Talwani polygon), 2-D susceptibility inversion with χ ≥ 0, the pyGIMLi and SimPEG results of notebook 05 |
| 6.1–6.2 | check against the Python chain (same 155 spikes, TMA within 0.02 nT, grids r = 0.99 / 0.98), exports |

Sources: `mag_body.html`, `mag_engine.js` (engine, no DOM) and `mag_lab.js`, with the shared `base.css`, `lab.css`,
`gl_core.js`, `ui_core.js`, `engine.js` and `model.js`. Build with `python scripts/build_magnetic_lab.py` after the
magnetic chain (and notebook 05 for chapter 5.4). `web/examples/example_magnetic_readings.csv` is the Wadi Ghadir
workbook as a CSV, to try the upload. `tests/test_core.py::test_web_magnetic_lab_engine` checks the engine in Node.
