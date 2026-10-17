# SGTool (vendored subset)

Structural Geophysics Tool by Mark Jessell and contributors, MIT licence (see `LICENSE`).
Source: https://github.com/swaxi/SGTool, commit 1a68e09f14617408d781924d9b1ea72484a79bad (14 Oct 2026).

Only the grid-filter engine is included: `calcs/GeophysicalProcessor.py` and `calcs/worms/`
(continuation, derivatives, total horizontal gradient, tilt angle, analytic signal, band-pass,
reduction to the pole). The files are unchanged. SGTool normally runs inside QGIS / ArcGIS Pro;
`wghadir/common/sgtool_bridge.py` makes these numpy filters usable from plain Python.
