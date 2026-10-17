"""Steps 1-5 of the gravity chain: inventory, on-board corrections, tide, occupations.

1  read both CG-6 exports, file inventory (SHA-256) and header metadata
2  numerical check CorrGrav = RawGrav + TideCorr + TiltCorr + TempCorr + DriftCorr
3  Longman tide re-computed at the CG-6 GPS position (time stamps are UTC)
4  (row QC is in qc.py)
5  grouping of accepted readings into station occupations

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import os

import numpy as np
import pandas as pd

from . import cg6, gnss
from .settings import INSTRUMENT_FILES, THRESHOLDS
from .tide import longman_correction


def load_instruments(raw_dir):
    """Step 1: read both CG-6 exports and assign occupation ids; return (headers, rows)."""
    headers, frames = {}, []
    for inst, fname in INSTRUMENT_FILES.items():
        h, d = cg6.read_cg6(os.path.join(raw_dir, fname), inst)
        headers[inst] = h
        frames.append(d)
    df = pd.concat(frames, ignore_index=True)
    df = cg6.assign_occupations(df)
    return headers, df


def inventory_tables(headers, df, raw_dir):
    """Step 1: file inventory (size, SHA-256) of raw_dir and the CG-6 header metadata per instrument."""
    files = []
    for f in sorted(os.listdir(raw_dir)):
        p = os.path.join(raw_dir, f)
        if os.path.isfile(p):
            files.append(dict(file=f, bytes=os.path.getsize(p), sha256=cg6.sha256(p)))
    meta = []
    for inst, h in headers.items():
        d = df[df["instrument"] == inst]
        meta.append(dict(
            instrument=inst, file=h["_file"], bytes=h["_bytes"], sha256=h["_sha256"],
            survey_name=h.get("Survey Name"), serial=h.get("Instrument Serial Number"),
            created=h.get("Created"), operator=h.get("Operator"), firmware=h.get("Firmware Version"),
            gcal1_mgal=h.get("Gcal1 [mGal]"), goff_adu=h.get("Goff [ADU]"), gref_mgal=h.get("Gref [mGal]"),
            x_scale=h.get("X Scale [arc-sec/ADU]"), y_scale=h.get("Y Scale [arc-sec/ADU]"),
            x_offset=h.get("X Offset [ADU]"), y_offset=h.get("Y Offset [ADU]"),
            temp_coeff_mgal_per_mK=h.get("Temperature Coefficient [mGal/mK]"),
            temp_scale=h.get("Temperature Scale [mK/ADU]"),
            drift_rate_mgal_per_day=h.get("Drift Rate [mGal/day]"), drift_zero_time=h.get("Drift Zero Time"),
            rows=len(d), first_reading=str(d["time_utc"].min()), last_reading=str(d["time_utc"].max()),
            survey_days=d["Date"].nunique(), lines=",".join(sorted(d["Line"].unique(), key=int)),
            correction_flags=",".join(sorted(d[cg6.FLAG_COL].unique())),
            measur_dur_s=",".join(str(v) for v in sorted(d["MeasurDur"].unique())),
            instr_height_m=",".join(str(v) for v in sorted(d["InstrHeight"].unique())),
            user_lat_lon_elev=",".join(f"{a}/{b}/{c}" for a, b, c in
                                       d[["LatUser", "LonUser", "ElevUser"]].drop_duplicates().values),
            columns="|".join(h["_columns"]),
        ))
    return pd.DataFrame(files), pd.DataFrame(meta)


def verify_corrgrav(df):
    """Step 2: closure of CorrGrav = RawGrav + TideCorr + TiltCorr + TempCorr + DriftCorr per instrument."""
    resid = df["CorrGrav"] - (df["RawGrav"] + df["TideCorr"] + df["TiltCorr"] + df["TempCorr"] + df["DriftCorr"])
    df["corrgrav_closure_mgal"] = resid
    out = []
    for inst, d in df.groupby("instrument"):
        r = d["corrgrav_closure_mgal"].dropna()
        out.append(dict(instrument=inst, rows_checked=len(r), rows_with_overflow=int((d["overflow_fields"] != "").sum()),
                        closure_rms_mgal=float(np.sqrt(np.mean(r ** 2))), closure_max_abs_mgal=float(r.abs().max()),
                        equation="CorrGrav = RawGrav + TideCorr + TiltCorr + TempCorr + DriftCorr",
                        mean_tide=float(d["TideCorr"].mean()), mean_temp=float(d["TempCorr"].mean()),
                        mean_tilt=float(d["TiltCorr"].median()), mean_drift=float(d["DriftCorr"].mean())))
    return pd.DataFrame(out)


def tide_recompute(df):
    """Replace the on-board tide by Longman at the CG-6 GPS position (timestamps = UTC)."""
    df["tide_longman_user"] = longman_correction(df["time_utc"], df["LatUser"], df["LonUser"])
    df["tide_longman_gps"] = longman_correction(df["time_utc"], df["LatGPS"], df["LonGPS"])
    df["tide_replacement_mgal"] = df["tide_longman_gps"] - df["TideCorr"]
    # g_tidefix: instrument-corrected gravity with the on-board tide removed and the
    # re-computed tide added.  Tilt, temperature and on-board drift stay as applied.
    df["g_tidefix"] = df["CorrGrav"] - df["TideCorr"] + df["tide_longman_gps"]
    rows = []
    for inst, d in df.groupby("instrument"):
        for label, col in [("Longman at user-entered position, t as UTC", "tide_longman_user"),
                           ("Longman at CG-6 GPS position, t as UTC", "tide_longman_gps")]:
            r = d["TideCorr"] - d[col]
            rows.append(dict(instrument=inst, model=label, rms_ugal=1000 * np.sqrt(np.mean(r ** 2)),
                             max_abs_ugal=1000 * r.abs().max()))
        for sh in (-3, -2, 2, 3):
            t2 = longman_correction(d["time_utc"] + pd.Timedelta(hours=sh), d["LatUser"], d["LonUser"])
            r = d["TideCorr"] - t2
            rows.append(dict(instrument=inst, model=f"Longman at user position, t shifted {sh:+d} h",
                             rms_ugal=1000 * np.sqrt(np.mean(r ** 2)), max_abs_ugal=1000 * r.abs().max()))
    return pd.DataFrame(rows)


def station_role(station, line):
    """Role of a station: hotel_base_0 (line 0, station 0), field_base_100 (line 0, station 100) or field."""
    if line == "0" and station == "0":
        return "hotel_base_0"
    if line == "0" and station == "100":
        return "field_base_100"
    return "field"


def build_occupations(df):
    """Step 5: one row per occupation (mean of accepted readings, uncertainty, CG-6 GPS position, QC flags)."""
    rows = []
    for oid, d in df.groupby("occ_id"):
        a = d[d["accepted"]]
        st, ln = d["Station"].iloc[0], d["Line"].iloc[0]
        n = len(a)
        if n:
            g = a["g_tidefix"].values
            internal = np.sqrt(np.mean(a["StdErr"].values ** 2) / n)
            scatter = np.std(g, ddof=1) / np.sqrt(n) if n > 1 else np.nan
            sigma = np.nanmax([internal, scatter]) if n > 1 else a["StdErr"].iloc[0]
            t_mid = a["time_utc"].mean()
        else:
            g, sigma, t_mid, scatter = np.array([np.nan]), np.nan, d["time_utc"].mean(), np.nan
        gps_spread = gnss.haversine_m(d["LatGPS"].min(), d["LonGPS"].min(), d["LatGPS"].max(), d["LonGPS"].max())
        rows.append(dict(
            occ_id=oid, instrument=d["instrument"].iloc[0], date=d["Date"].iloc[0], line=ln, station=st,
            role=station_role(st, ln), occ_key=f"{d['instrument'].iloc[0]}|{d['Date'].iloc[0]}|L{ln}|S{st}",
            t_start=d["time_utc"].min(), t_end=d["time_utc"].max(), t_mid=t_mid,
            n_readings=len(d), n_accepted=n, g_occ=float(np.mean(g)) if n else np.nan,
            g_range=float(np.ptp(g)) if n > 1 else np.nan, g_scatter_se=scatter, sigma_occ=sigma,
            lat_cg6=d["LatGPS"].median(), lon_cg6=d["LonGPS"].median(), elev_cg6=d["ElevGPS"].median(),
            cg6_gps_spread_m=gps_spread,
            reject_reasons=";".join(sorted(set(";".join(d["reject_reasons"]).split(";")) - {""})),
            warnings=";".join(sorted(set(";".join(d["warnings"]).split(";")) - {""})),
        ))
    occ = pd.DataFrame(rows)
    occ["usable"] = occ["n_accepted"] > 0
    occ["occ_flags"] = ""
    occ.loc[occ["cg6_gps_spread_m"] > THRESHOLDS["gps_spread_warn_m"], "occ_flags"] += "CG6_GPS_SPREAD;"
    occ.loc[occ["n_accepted"] == 1, "occ_flags"] += "SINGLE_READING;"
    occ.loc[~occ["usable"], "occ_flags"] += "NO_ACCEPTED_READING;"
    return occ
