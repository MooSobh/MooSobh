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
| `engine.js` | processing engine: CG-6 parser, tide, QC, occupations, base control and drift, instrument scale, reductions, Nettleton, spline gridding, contours (no DOM; testable in Node) |
| `lab.js` | chapters, maps, interaction, hero animation |

Build after the gravity chain has run (`outputs/tables/15*`, `16*` and `outputs/summary.json`):

```bash
python scripts/build_gravity_lab.py            # writes web/Wadi_Ghadir_Gravity_Lab.html
```

`tests/test_core.py::test_web_lab_engine_matches_python` runs `engine.js` in Node and checks it against the
Python results.
