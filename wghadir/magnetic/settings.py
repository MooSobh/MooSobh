"""Magnetic processing settings: every tunable value of the magnetic chain.

Values used for the delivered products (report section 5).

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import datetime as dt


# -----------------------------------------------------------------------------
# Survey date (ASSUMED: the file has times but no dates) [5.1]
SURVEY_DATE = dt.datetime(2026, 1, 20)   # ASSUMED: the file has times but no dates


# -----------------------------------------------------------------------------
# Despike (Hampel filter within each day) [5.1]
HAMPEL_WINDOW = 11
HAMPEL_K = 6.0
HAMPEL_FLOOR_NT = 30.0


# -----------------------------------------------------------------------------
# Crossover check between days [5.1]
CROSSOVER_M = 5.0


# -----------------------------------------------------------------------------
# Gridding and reduction to the pole [5.2]
GRID_SPACING_M = 50.0
BLOCK_M = 100.0
MASK_KM = 2.0
SPLINE_DAMPING = 1e-6     # damping of the biharmonic spline
TAPER_KM = 3.0
