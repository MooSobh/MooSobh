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
