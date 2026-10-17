"""Gravity building blocks, in processing order.

settings      all tunable values of the gravity chain
cg6, tide     CG-6 export reader; Longman (1959) earth tide
inventory     steps 1-3, 5: inventory, CorrGrav check, tide, occupations
qc            step 4: row-level QC with documented thresholds
gnss          GNSS workbook / KML readers, DMS parsing, distances
positioning   steps 6-7: GNSS matching, orthometric heights, DEM check
base_control  step 8: base-100 control, drift model, closures
instruments   step 9: inter-instrument scale and re-ties
reduce        normal gravity, free-air and Bouguer terms
terrain       DEM topographic effect with Harmonica prisms
reductions    steps 10-11: free-air, simple and complete Bouguer
nettleton     Nettleton estimators
density       step 12: profiles, windows, density consensus
figures, maps, nettleton_figs   step 13: QC figures, maps, density sheets
export        step 14: Excel workbook, CSV, GeoJSON, KML

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
"""
