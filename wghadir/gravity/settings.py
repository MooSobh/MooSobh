"""Gravity processing settings: every tunable value of the chain in one place.

The numbers below are the values used for the delivered Wadi Ghadir products.
Each is documented in the report (section given in brackets).  Change a value
here and re-run the chain.  Parameters that belong to a single function (for
example the profile segmentation in density.build_profiles) are documented as
keyword defaults of that function.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""


# -----------------------------------------------------------------------------
# Input files [2.1]
INSTRUMENT_FILES = {
    "CG6-0640": "CG-6_0640_W_GHADIR_New_gravimeter.dat",
    "CG6-0313": "CG-6_0313_W_GHADER_old_gravimeter.dat",
}
REFERENCE_INSTRUMENT = "CG6-0640"


# -----------------------------------------------------------------------------
# Row-level QC [3.1]
# Documented thresholds (see report section 3.1).  Units: mGal and arc-seconds.
THRESHOLDS = {
    "stddev_reject_mgal": 0.080,   # ~99.5th percentile of the combined data set
    "stddev_warn_mgal": 0.050,     # ~95th percentile
    "tilt_reject_arcsec": 30.0,    # |X| or |Y| beyond this: levelling not trusted
    "tilt_warn_arcsec": 20.0,
    "repeat_outlier_mgal": 0.050,  # deviation from median of the other readings (n >= 3)
    "repeat_range_warn_mgal": 0.050,  # two-reading occupations
    "gps_spread_warn_m": 50.0,     # spread of CG-6 internal GPS positions within an occupation
    "gross_range_mgal": 500.0,     # |g - instrument median|; true survey range is < 170 mGal
}

# Frozen sensor output: RawGrav pinned at this level irrespective of station.
# Evidence: CG-6 0313 returned RawGrav 8008.32-8008.36 mGal both at station 100
# and at station 0, whose gravity differs by ~65 mGal (2026-01-18 15:25-16:38).
FROZEN_RAW_WINDOW = {"CG6-0313": (8007.5, 8009.0)}


# -----------------------------------------------------------------------------
# GNSS matching and heights [3.3]
MATCH_MAX_M = 30.0          # max separation CG-6 internal GPS -> GNSS point
AMBIG_MARGIN_M = 10.0       # second candidate (at a distinct location) closer than d1 + margin
DISTINCT_LOC_M = 5.0        # GNSS points closer than this are treated as one location
BASE_LOC_MAX_M = 50.0       # base occupations must lie within this of the base mark
DAY_DATUM_SHIFT_MIN_M = 0.5  # per-day height offset at both base marks that triggers an adjustment
H_SIGMA_NOMINAL_M = 0.15    # nominal GNSS height uncertainty (from base-100 day-to-day scatter)
EXCLUDED_KML_NAMES = {"MRSA", "DEFAULT", ""}
MATCH_OK = ("MATCHED", "MATCHED_ID_TIEBREAK")


# -----------------------------------------------------------------------------
# Base control and drift [3.4]
TIE_MAX_HOURS = 4.0         # hotel 0 <-> base 100 tie legs longer than this are not used
TARE_MGAL = 0.30            # base-100 misclosure above this is treated as a tare, not drift noise


# -----------------------------------------------------------------------------
# External geodetic data [3.3, 4.2]
DEM_BOUNDS = (34.48, 24.45, 35.26, 25.07)  # lon0, lat0, lon1, lat1: survey area + >= 22 km
DEM_FILE = "copernicus_glo30_wadi_ghadir.tif"
GEOID_FILE = "egm2008_wadi_ghadir.tif"


# -----------------------------------------------------------------------------
# Reductions and terrain correction [4.1-4.2]
RHO_LIST = (2.0, 2.2, 2.3, 2.4, 2.5, 2.6, 2.67, 2.7, 2.8, 2.9, 3.0)
R_EARTH = 6371008.8
COARSE = 8                 # coarse cell = 8 x 8 DEM cells (~240 m x 250 m)
INNER_COARSE = 8           # inner zone = +/- 8 coarse cells (~ +/- 2 km)
OUTER_RADIUS_M = 22000.0   # Hayford zone O outer radius (21.9 km)
FLATTEN_RADIUS_M = 50.0
SENSOR_OFFSET_M = 0.2      # CG-6 sensor above the GNSS-measured point (assumed, not recorded)


# -----------------------------------------------------------------------------
# Nettleton density analysis [4.3]
METHODS = {"simple": "u_slab_mgal_per_gcc", "complete": "u_topo_mgal_per_gcc"}
