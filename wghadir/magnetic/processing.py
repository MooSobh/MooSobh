"""Ground magnetic processing: loading, QC, IGRF removal, gridding and RTP.

Input: one workbook with columns lat, long, x, y, E, Reading, Time, Corrected data
(Total Intensity); "Corrected data" is the diurnally corrected total field supplied
by the field team (Corrected - Reading = diurnal correction, 0 to -170 nT).

Chain
  1  load every row, keep the source row number, flag non-data rows
  2  day segments from the time stamps (the file carries no dates)
  3  despike: Hampel filter within each day (window 11 readings ~ 28 m)
  4  IGRF-14 total field at each reading (ppigrf) -> total-field anomaly
  5  crossover check between days (readings < 5 m apart on different days)
  6  gridding as for gravity: UTM 36N, block median, damped biharmonic spline,
     blanked > MASK_KM from data
  7  reduction to the pole (Harmonica, FFT) assuming induced magnetisation along
     the IGRF field direction; tapered and padded grid to limit edge effects

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import datetime as dt

import numpy as np
import pandas as pd

from ..common.mapping import EXTENT
from .settings import (BLOCK_M, CROSSOVER_M, GRID_SPACING_M, HAMPEL_FLOOR_NT, HAMPEL_K,  # noqa: F401
                       HAMPEL_WINDOW, MASK_KM, SURVEY_DATE, TAPER_KM)


# -----------------------------------------------------------------------------
# Load and QC
def load(path):
    """Step 1: read the workbook (all rows, Excel row numbers), UTM 36N coordinates and coordinate check, diurnal correction, day segments from the time stamps."""
    import pyproj

    raw = pd.read_excel(path, sheet_name=0, header=0)
    raw = raw.iloc[:, :8]
    raw.columns = ["lat", "lon", "x_file", "y_file", "elev_file", "reading_nT", "time_hhmmss", "tmi_corr_nT"]
    raw.insert(0, "source_row", np.arange(2, len(raw) + 2))  # Excel row number
    d = raw.copy()
    for c in d.columns[1:]:
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d["flags"] = ""
    nd = d["time_hhmmss"].isna() | d["lon"].isna() | d["lat"].isna()
    d.loc[nd, "flags"] += "NON_DATA_ROW;"
    tr = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:32636", always_xy=True)
    e, n = tr.transform(d["lon"].fillna(0).values, d["lat"].fillna(0).values)
    d["utm_e"] = np.where(nd, np.nan, e)
    d["utm_n"] = np.where(nd, np.nan, n)
    d["utm_check_m"] = np.hypot(d["utm_e"] - d["x_file"], d["utm_n"] - d["y_file"])
    d.loc[~nd & d["x_file"].isna(), "flags"] += "UTM_FROM_LATLON;"
    d["diurnal_corr_nT"] = d["tmi_corr_nT"] - d["reading_nT"]
    # day segments: time steps backwards by more than 30 min start a new day
    t = d["time_hhmmss"].fillna(-1).astype(int)
    sec = np.where(nd, np.nan, (t // 10000) * 3600 + (t // 100 % 100) * 60 + t % 100)
    d["time_s"] = sec
    day = np.zeros(len(d), int)
    k, last = 1, None
    for i, s in enumerate(sec):
        if np.isnan(s):
            day[i] = 0
            continue
        if last is not None and s < last - 1800:
            k += 1
        day[i] = k
        last = s
    d["day_seq"] = day
    return d


def despike(d):
    """Hampel filter on the corrected total field, applied within each day."""
    d = d.copy()
    d["hampel_median_nT"] = np.nan
    d["hampel_dev_nT"] = np.nan
    for k, g in d[d["day_seq"] > 0].groupby("day_seq"):
        s = g["tmi_corr_nT"]
        med = s.rolling(HAMPEL_WINDOW, center=True, min_periods=3).median()
        mad = (s - med).abs().rolling(HAMPEL_WINDOW, center=True, min_periods=3).median()
        thr = np.maximum(HAMPEL_FLOOR_NT, HAMPEL_K * 1.4826 * mad)
        dev = (s - med).abs()
        d.loc[g.index, "hampel_median_nT"] = med
        d.loc[g.index, "hampel_dev_nT"] = dev
        spike = dev > thr
        d.loc[g.index[spike.values], "flags"] += "SPIKE_HAMPEL;"
    d["accepted"] = ~d["flags"].str.contains("NON_DATA_ROW|SPIKE_HAMPEL")
    return d


def add_igrf(d, date=SURVEY_DATE):
    """Step 3: IGRF-14 total field, inclination and declination at every reading; TMA = TMI - IGRF."""
    import ppigrf

    d = d.copy()
    ok = d["day_seq"] > 0
    h_km = d.loc[ok, "elev_file"].fillna(d["elev_file"].median()).values / 1000.0
    be, bn, bu = ppigrf.igrf(d.loc[ok, "lon"].values, d.loc[ok, "lat"].values, h_km, date)
    be, bn, bu = (np.asarray(v).ravel() for v in (be, bn, bu))
    F = np.sqrt(be ** 2 + bn ** 2 + bu ** 2)
    d.loc[ok, "igrf_F_nT"] = F
    d.loc[ok, "igrf_inc_deg"] = np.degrees(np.arctan2(-bu, np.hypot(be, bn)))
    d.loc[ok, "igrf_dec_deg"] = np.degrees(np.arctan2(be, bn))
    d["tma_nT"] = d["tmi_corr_nT"] - d["igrf_F_nT"]
    return d


def igrf_date_sensitivity(lon, lat):
    """Step 4: IGRF total field and direction at the survey centre for several dates."""
    import ppigrf

    out = []
    for date in (dt.datetime(2025, 1, 15), dt.datetime(2025, 7, 15), SURVEY_DATE, dt.datetime(2026, 7, 15)):
        be, bn, bu = ppigrf.igrf(lon, lat, 0.3, date)
        F = float(np.sqrt(be ** 2 + bn ** 2 + bu ** 2).ravel()[0])
        out.append(dict(date=date.date().isoformat(), F_nT=F,
                        inc_deg=float(np.degrees(np.arctan2(-bu, np.hypot(be, bn))).ravel()[0]),
                        dec_deg=float(np.degrees(np.arctan2(be, bn)).ravel()[0])))
    return pd.DataFrame(out)


def crossovers(d, maxdist=CROSSOVER_M):
    """Accepted readings < maxdist apart but measured on different days."""
    from scipy.spatial import cKDTree

    a = d[d["accepted"]].reset_index(drop=True)
    tree = cKDTree(a[["utm_e", "utm_n"]].values)
    pairs = tree.query_pairs(maxdist, output_type="ndarray")
    p = pairs[a["day_seq"].values[pairs[:, 0]] != a["day_seq"].values[pairs[:, 1]]]
    rows = pd.DataFrame({"day_a": a["day_seq"].values[p[:, 0]], "day_b": a["day_seq"].values[p[:, 1]],
                         "dTMI_nT": a["tmi_corr_nT"].values[p[:, 1]] - a["tmi_corr_nT"].values[p[:, 0]],
                         "dist_m": np.hypot(*(a[["utm_e", "utm_n"]].values[p[:, 1]] - a[["utm_e", "utm_n"]].values[p[:, 0]]).T)})
    swap = rows["day_a"] > rows["day_b"]
    rows.loc[swap, ["day_a", "day_b"]] = rows.loc[swap, ["day_b", "day_a"]].values
    rows.loc[swap, "dTMI_nT"] *= -1
    summ = rows.groupby(["day_a", "day_b"]).agg(n_pairs=("dTMI_nT", "size"), median_dTMI_nT=("dTMI_nT", "median"),
                                                mad_dTMI_nT=("dTMI_nT", lambda v: (v - v.median()).abs().median())
                                                ).reset_index()
    return rows, summ


def day_summary(d):
    """Step 4: per-day reading counts, time span, position, diurnal correction and field statistics."""
    g = d[d["day_seq"] > 0].groupby("day_seq")
    return g.agg(n_readings=("tmi_corr_nT", "size"), n_accepted=("accepted", "sum"),
                 time_first=("time_hhmmss", "first"), time_last=("time_hhmmss", "last"),
                 lon_median=("lon", "median"), lat_median=("lat", "median"),
                 diurnal_min_nT=("diurnal_corr_nT", "min"), diurnal_max_nT=("diurnal_corr_nT", "max"),
                 tmi_median_nT=("tmi_corr_nT", "median"), tmi_min_nT=("tmi_corr_nT", "min"),
                 tmi_max_nT=("tmi_corr_nT", "max")).reset_index()


# -----------------------------------------------------------------------------
# Gridding and reduction to the pole
def _chain():
    import verde as vd
    return vd.Chain([("block", vd.BlockReduce(np.median, spacing=BLOCK_M)),
                     ("trend", vd.Trend(degree=1)),
                     ("spline", vd.Spline(damping=1e-6, mindist=25.0))])


def _region(extent, pad_m=0.0):
    import pyproj
    tr = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:32636", always_xy=True)
    lon0, lon1, lat0, lat1 = extent
    xs, ys = tr.transform([lon0, lon1, lon0, lon1], [lat0, lat0, lat1, lat1])
    return (min(xs) - pad_m, max(xs) + pad_m, min(ys) - pad_m, max(ys) + pad_m)


def _lonlat(g):
    import pyproj
    inv = pyproj.Transformer.from_crs("EPSG:32636", "EPSG:4326", always_xy=True)
    E, N = np.meshgrid(g.easting.values, g.northing.values)
    return inv.transform(E, N)


def _dist_to_data(g, x, y):
    from scipy.spatial import cKDTree
    E, N = np.meshgrid(g.easting.values, g.northing.values)
    dist, _ = cKDTree(np.column_stack([x, y])).query(np.column_stack([E.ravel(), N.ravel()]))
    return dist.reshape(E.shape)


def grid_field(x, y, v, extent=EXTENT):
    """Step 5: grid a field (block median, trend, spline) on GRID_SPACING_M, blanked > MASK_KM from data."""
    chain = _chain().fit((x, y), v)
    g = chain.grid(region=_region(extent), spacing=GRID_SPACING_M, data_names="value", dims=("northing", "easting"))
    dist = _dist_to_data(g, x, y)
    g["value"] = g["value"].where(dist <= MASK_KM * 1000)
    return g


def cv_rmse(x, y, v):
    """Block K-fold cross-validation rms error of the gridding chain."""
    import verde as vd
    bx, bv = vd.BlockReduce(np.median, spacing=BLOCK_M).filter((x, y), v)
    cv = vd.BlockKFold(spacing=2000, n_splits=5, shuffle=True, random_state=0)
    return float(-np.mean(vd.cross_val_score(_chain(), bx, bv, cv=cv, scoring="neg_root_mean_squared_error")))


def rtp_grid(x, y, tma, inc, dec, extent=EXTENT):
    """Reduction to the pole of the total-field anomaly (induced magnetisation)."""
    import harmonica as hm
    import xrft

    pad_m = (MASK_KM + TAPER_KM) * 1000
    chain = _chain().fit((x, y), tma)
    g = chain.grid(region=_region(extent, pad_m), spacing=GRID_SPACING_M, data_names="value",
                   dims=("northing", "easting"))["value"]
    dist = _dist_to_data(g.to_dataset(), x, y)
    level = float(np.median(tma))
    w = np.clip((MASK_KM * 1000 + TAPER_KM * 1000 - dist) / (TAPER_KM * 1000), 0, 1)
    w = np.sin(0.5 * np.pi * w) ** 2                         # 1 inside the data mask, 0 beyond the taper
    dev = (g - level) * w
    n_pad = int(np.ceil(0.5 * max(dev.shape)))
    padded = xrft.pad(dev, {"easting": n_pad, "northing": n_pad})
    r = hm.reduction_to_pole(padded, inclination=inc, declination=dec)
    r = xrft.unpad(r, {"easting": n_pad, "northing": n_pad})
    r = r.assign_coords(easting=g.easting, northing=g.northing)
    r = r.where(dist <= MASK_KM * 1000)
    reg = _region(extent)
    r = r.sel(easting=slice(reg[0], reg[1]), northing=slice(reg[2], reg[3]))
    return r.to_dataset(name="value")
