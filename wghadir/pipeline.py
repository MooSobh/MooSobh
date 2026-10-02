"""Wadi Ghadir CG-6 gravity processing chain.

Stages (acquisition order):
  1  inventory and header metadata of the instrument exports
  2  numerical verification of CorrGrav = RawGrav + Tide + Tilt + Temp + Drift
  3  controlled re-computation of the tide (Longman) at the observed position
  4  row-level QC and occupation grouping
  5  GNSS point workbooks/KML: parsing, day mapping, datum checks, coordinate matching
  6  base control: station 0 (hotel) and station 100 (field control), drift model
  7  inter-instrument reconciliation (0-100 ties, co-located points)
  8  base-relative reductions (free-air, simple Bouguer density sweep)
  9  Nettleton density profiles
"""
import os
import re
import tempfile
import zipfile

import numpy as np
import pandas as pd

from . import cg6, gnss, nettleton, qc, reduce
from .tide import longman_correction

INSTRUMENT_FILES = {
    "CG6-0640": "CG-6_0640_W_GHADIR_New_gravimeter.dat",
    "CG6-0313": "CG-6_0313_W_GHADER_old_gravimeter.dat",
}
REFERENCE_INSTRUMENT = "CG6-0640"
MATCH_MAX_M = 30.0          # max separation CG-6 internal GPS -> GNSS point
AMBIG_MARGIN_M = 10.0       # second candidate (at a distinct location) closer than d1 + margin
DISTINCT_LOC_M = 5.0        # GNSS points closer than this are treated as one location
BASE_LOC_MAX_M = 50.0       # base occupations must lie within this of the base mark
DAY_DATUM_SHIFT_MIN_M = 0.5  # per-day height offset at both base marks that triggers an adjustment
H_SIGMA_NOMINAL_M = 0.15    # nominal GNSS height uncertainty (from base-100 day-to-day scatter)
EXCLUDED_KML_NAMES = {"MRSA", "DEFAULT", ""}
TIE_MAX_HOURS = 4.0         # hotel 0 <-> base 100 tie legs longer than this are not used
TARE_MGAL = 0.30            # base-100 misclosure above this is treated as a tare, not drift noise
MATCH_OK = ("MATCHED", "MATCHED_ID_TIEBREAK")


# ----------------------------------------------------------------------------- 1-4
def load_instruments(raw_dir):
    headers, frames = {}, []
    for inst, fname in INSTRUMENT_FILES.items():
        h, d = cg6.read_cg6(os.path.join(raw_dir, fname), inst)
        headers[inst] = h
        frames.append(d)
    df = pd.concat(frames, ignore_index=True)
    df = cg6.assign_occupations(df)
    return headers, df


def inventory_tables(headers, df, raw_dir):
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
    if line == "0" and station == "0":
        return "hotel_base_0"
    if line == "0" and station == "100":
        return "field_base_100"
    return "field"


def build_occupations(df):
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
    occ.loc[occ["cg6_gps_spread_m"] > qc.THRESHOLDS["gps_spread_warn_m"], "occ_flags"] += "CG6_GPS_SPREAD;"
    occ.loc[occ["n_accepted"] == 1, "occ_flags"] += "SINGLE_READING;"
    occ.loc[~occ["usable"], "occ_flags"] += "NO_ACCEPTED_READING;"
    return occ


# ----------------------------------------------------------------------------- 5 GNSS
def _base_kind(pid):
    p = str(pid).lower().replace(" ", "")
    if "base" in p or p.startswith("b100"):
        return "base_100" if "100" in p else "hotel_0"
    return ""


def load_gnss(raw_dir):
    tmp = tempfile.mkdtemp(prefix="wghadir_gnss_")
    with zipfile.ZipFile(os.path.join(raw_dir, "results.zip")) as z:
        z.extractall(tmp)
        zip_list = [(i.filename, i.file_size) for i in z.infolist() if not i.is_dir()]
    root = os.path.join(tmp, "results")
    days = sorted(int(m.group(1)) for f in os.listdir(root) if (m := re.match(r"day(\d+)\.xlsx$", f)))
    wb, kml = [], []
    for k in days:
        w = gnss.read_point_workbook(os.path.join(root, f"day{k}.xlsx"), f"results.zip/day{k}.xlsx")
        w["gnss_day"] = k
        wb.append(w)
        kp = os.path.join(root, f"day{k}.kml")
        if os.path.exists(kp):
            km = gnss.read_kml(kp, f"results.zip/day{k}.kml")
            km["gnss_day"] = k
            kml.append(km)
    W = pd.concat(wb, ignore_index=True)
    K = pd.concat(kml, ignore_index=True)
    master = gnss.read_point_workbook(os.path.join(raw_dir, "GPS_All_Days.xlsx"), "GPS_All_Days.xlsx")

    # master workbook vs concatenated daily workbooks
    same = (len(master) == len(W))
    if same:
        eq = ((master["point_id"].values == W["point_id"].values)
              & np.isclose(master["lat"].values, W["lat"].values, atol=1e-10)
              & np.isclose(master["lon"].values, W["lon"].values, atol=1e-10)
              & np.isclose(master["h_gnss"].values, W["h_gnss"].values, atol=1e-6, equal_nan=True))
    master_check = dict(master_rows=len(master), daily_rows=len(W),
                        rows_identical=int(eq.sum()) if same else 0,
                        master_rows_with_height_error=int(master["h_err"].notna().sum()))
    W["gnss_day_from_master"] = W["gnss_day"]  # master is the ordered concatenation

    # attach KML twins (same coordinates) and collect KML-only points
    W["point_id_kml"] = ""
    W["kml_easting"] = np.nan
    W["kml_northing"] = np.nan
    W["h_kml"] = np.nan
    kml_used = np.zeros(len(K), bool)
    for i, r in W.iterrows():
        Kd = K[K["gnss_day"] == r["gnss_day"]]
        d = gnss.haversine_m(r["lat"], r["lon"], Kd["lat"].values, Kd["lon"].values)
        j = np.argmin(d)
        if d[j] < 0.05:
            W.loc[i, ["point_id_kml", "kml_easting", "kml_northing", "h_kml"]] = [
                Kd["point_id"].iloc[j], Kd["easting_local"].iloc[j], Kd["northing_local"].iloc[j], Kd["h_kml"].iloc[j]]
            kml_used[Kd.index[j]] = True
    W["source_type"] = "workbook"
    Konly = K[~kml_used].copy()
    Konly["source_type"] = np.where(Konly["point_id"].isin(EXCLUDED_KML_NAMES), "kml_reference_or_label", "kml_only")
    Konly = Konly.rename(columns={"h_kml": "h_gnss", "easting_local": "kml_easting", "northing_local": "kml_northing"})
    Konly["point_id_kml"] = Konly["point_id"]
    Konly["h_kml"] = Konly["h_gnss"]
    Konly["h_err"] = np.nan
    Konly["id_excel_date"] = False
    P = pd.concat([W, Konly], ignore_index=True, sort=False)
    P["base_kind"] = P["point_id"].map(_base_kind)
    P.loc[P["point_id_kml"].isin(["MRSA"]), "base_kind"] = "gnss_reference_MRSA"
    P["gnss_uid"] = [f"D{d}:{s[:3]}:{p}" for d, s, p in zip(P["gnss_day"], P["source_type"], P["point_id"])]
    return P, K, master_check, pd.DataFrame(zip_list, columns=["zip_member", "bytes"])


def gnss_datum_check(P):
    """Per-day height of the two base marks relative to their multi-day median."""
    rows = []
    ref = {}
    for kind in ("hotel_0", "base_100"):
        b = P[(P["base_kind"] == kind) & (P["source_type"] != "kml_reference_or_label")]
        b = b.sort_values("source_type").drop_duplicates("gnss_day")  # workbook preferred
        ref[kind] = dict(h=b["h_gnss"].median(), lat=b["lat"].median(), lon=b["lon"].median())
        for _, r in b.iterrows():
            rows.append(dict(gnss_day=r["gnss_day"], mark=kind, point_id=r["point_id"], source=r["source"],
                             h_gnss=r["h_gnss"], h_median_all_days=ref[kind]["h"],
                             dh_m=r["h_gnss"] - ref[kind]["h"],
                             horiz_offset_m=gnss.haversine_m(r["lat"], r["lon"], ref[kind]["lat"], ref[kind]["lon"])))
    T = pd.DataFrame(rows)
    mrsa = P[P["base_kind"] == "gnss_reference_MRSA"][["gnss_day", "lat", "lon", "h_gnss", "kml_easting", "kml_northing"]]
    days = []
    for k, d in T.groupby("gnss_day"):
        o = d.set_index("mark")["dh_m"]
        both = ("hotel_0" in o) and ("base_100" in o)
        shift = 0.0
        sig = 0.0
        rule = "no adjustment"
        if both and np.sign(o["hotel_0"]) == np.sign(o["base_100"]) and min(abs(o["hotel_0"]), abs(o["base_100"])) > DAY_DATUM_SHIFT_MIN_M:
            shift = float((o["hotel_0"] + o["base_100"]) / 2)
            sig = float(abs(o["hotel_0"] - o["base_100"]) / 2)
            rule = "both base marks offset > %.1f m with equal sign: heights reduced by mean offset" % DAY_DATUM_SHIFT_MIN_M
        m = mrsa[mrsa["gnss_day"] == k]
        days.append(dict(gnss_day=k, dh_hotel0_m=o.get("hotel_0", np.nan), dh_base100_m=o.get("base_100", np.nan),
                         day_height_shift_m=shift, day_shift_sigma_m=sig, rule=rule,
                         mrsa_h=m["h_gnss"].iloc[0] if len(m) else np.nan,
                         mrsa_E_local=m["kml_easting"].iloc[0] if len(m) else np.nan,
                         mrsa_N_local=m["kml_northing"].iloc[0] if len(m) else np.nan))
    return T, pd.DataFrame(days), ref


def map_days(occ, P):
    """Which GNSS day file corresponds to which observation date (by coordinate agreement)."""
    rows = []
    for date in sorted(occ["date"].unique()):
        o = occ[(occ["date"] == date) & (occ["role"] == "field")]
        for k in sorted(P["gnss_day"].unique()):
            C = P[(P["gnss_day"] == k) & (P["source_type"] == "workbook")]
            d = gnss.haversine_m(o["lat_cg6"].values[:, None], o["lon_cg6"].values[:, None],
                                 C["lat"].values[None, :], C["lon"].values[None, :]).min(axis=1)
            rows.append(dict(date=date, gnss_day=k, field_occupations=len(o), matched_within_30m=int((d <= MATCH_MAX_M).sum())))
    M = pd.DataFrame(rows)
    best = M.loc[M.groupby("date")["matched_within_30m"].idxmax()]
    return M, dict(zip(best["date"], best["gnss_day"]))


def _expected_ids(inst, line, st, role):
    if role == "field_base_100":
        return "base_100"
    if role == "hotel_base_0":
        return "hotel_0"
    if inst == "CG6-0640":
        return {st, f"1-{st}"}
    # bare numbers were also used for CG6-0313 points on 2026-01-17/18 (GNSS days 2-3)
    return {f"{line}-{st}", f"L{line}-{st}", st}


def _id_ok(c, exp):
    if isinstance(exp, str):
        return c["base_kind"] == exp
    return (c["point_id"] in exp) or (str(c["point_id_kml"]) in exp)


def match_occupations(occ, P, day_of_date, datum_days, ref):
    shifts = datum_days.set_index("gnss_day")
    cand_all = P[P["source_type"].isin(["workbook", "kml_only"])].copy()
    out = []
    for _, o in occ.iterrows():
        k = day_of_date[o["date"]]
        C = cand_all[cand_all["gnss_day"] == k]
        if o["role"] != "field":
            C = C[C["base_kind"] == ("base_100" if o["role"] == "field_base_100" else "hotel_0")]
        d = gnss.haversine_m(o["lat_cg6"], o["lon_cg6"], C["lat"].values, C["lon"].values)
        order = np.argsort(d)
        res = dict(occ_id=o["occ_id"], gnss_day=k, gnss_file=f"day{k}")
        if len(order) == 0:
            res.update(match_status="NO_CANDIDATE")
            out.append(res)
            continue
        exp = _expected_ids(o["instrument"], o["line"], o["station"], o["role"])
        c1 = C.iloc[order[0]]
        d1 = d[order[0]]
        # points within DISTINCT_LOC_M of the nearest are one location: prefer the
        # label that agrees with the instrument record (does not change coordinates)
        same_loc = [j for j in order if gnss.haversine_m(c1["lat"], c1["lon"], C["lat"].iloc[j], C["lon"].iloc[j]) <= DISTINCT_LOC_M]
        for j in same_loc:
            if _id_ok(C.iloc[j], exp):
                c1, d1 = C.iloc[j], d[j]
                break
        # second candidate at a distinct location
        d2, c2 = np.nan, None
        for j in order:
            if gnss.haversine_m(c1["lat"], c1["lon"], C["lat"].iloc[j], C["lon"].iloc[j]) > DISTINCT_LOC_M:
                d2, c2 = d[j], C.iloc[j]
                break
        id_ok = _id_ok(c1, exp)
        status = "MATCHED"
        if d1 > MATCH_MAX_M:
            status = "UNMATCHED_GT_%dM" % MATCH_MAX_M
        elif c2 is not None and d2 < d1 + AMBIG_MARGIN_M:
            # distance alone cannot decide; use the label only if exactly one candidate agrees
            ok2 = _id_ok(c2, exp)
            if id_ok and not ok2:
                status = "MATCHED_ID_TIEBREAK"
            elif ok2 and not id_ok and d2 <= MATCH_MAX_M:
                c1, c2, d1, d2 = c2, c1, d2, d1
                id_ok = True
                status = "MATCHED_ID_TIEBREAK"
            else:
                status = "AMBIGUOUS"
        sh = shifts.loc[k, "day_height_shift_m"] if k in shifts.index else 0.0
        ss = shifts.loc[k, "day_shift_sigma_m"] if k in shifts.index else 0.0
        res.update(match_status=status, gnss_uid=c1["gnss_uid"], gnss_point_id=c1["point_id"],
                   gnss_point_id_kml=c1["point_id_kml"], gnss_source=c1["source"], gnss_source_type=c1["source_type"],
                   match_dist_m=d1, second_dist_m=d2, second_point_id=None if c2 is None else c2["point_id"],
                   id_consistent=bool(id_ok), lat=c1["lat"], lon=c1["lon"], h_gnss_original=c1["h_gnss"],
                   h_err_reported=c1["h_err"], day_height_shift_m=sh,
                   h_used=c1["h_gnss"] - sh,
                   h_sigma_m=float(np.sqrt(H_SIGMA_NOMINAL_M ** 2 + ss ** 2)))
        out.append(res)
    M = pd.DataFrame(out)
    return occ.merge(M, on="occ_id", how="left")


# ----------------------------------------------------------------------------- 6 base control
def base_control(occ, ref):
    """Daily drift model per instrument from station-100 occupations.

    g100(t) is the piecewise-linear interpolation between successive valid
    control occupations of the same day.  Valid controls are station-100
    occupations (Line 0) with accepted readings and located within
    BASE_LOC_MAX_M of the base-100 mark.  Hotel (station 0) occupations are
    converted into supplementary control values with the instrument's median
    0->100 tie, but only where no station-100 control brackets the field data.
    """
    occ = occ.copy()
    b100 = ref["base_100"]
    occ["dist_to_base100_mark_m"] = gnss.haversine_m(occ["lat_cg6"], occ["lon_cg6"], b100["lat"], b100["lon"])
    occ["dist_to_hotel_mark_m"] = gnss.haversine_m(occ["lat_cg6"], occ["lon_cg6"], ref["hotel_0"]["lat"], ref["hotel_0"]["lon"])
    is100 = (occ["role"] == "field_base_100") & occ["usable"] & (occ["dist_to_base100_mark_m"] < BASE_LOC_MAX_M)
    is0 = (occ["role"] == "hotel_base_0") & occ["usable"] & (occ["dist_to_hotel_mark_m"] < BASE_LOC_MAX_M)
    occ["valid_control"] = is100 | is0

    # 0->100 ties (morning: first 0 -> first 100; evening: last 100 -> last 0)
    ties = []
    for (inst, date), d in occ.groupby(["instrument", "date"]):
        c100 = d[is100.loc[d.index]].sort_values("t_mid")
        c0_all = d[d["role"] == "hotel_base_0"].sort_values("t_mid")
        rate = np.nan
        if len(c100) >= 2:
            dt = (c100["t_mid"].iloc[-1] - c100["t_mid"].iloc[0]) / pd.Timedelta(hours=1)
            rate = (c100["g_occ"].iloc[-1] - c100["g_occ"].iloc[0]) / dt
        for when, o0, o100 in [("morning", c0_all.head(1), c100.head(1)), ("evening", c0_all.tail(1), c100.tail(1))]:
            if len(o0) == 0 or len(o100) == 0:
                continue
            o0, o100 = o0.iloc[0], o100.iloc[0]
            if when == "morning" and len(c0_all) and o0["t_mid"] > o100["t_mid"]:
                continue
            ok = bool(is0.loc[o0.name]) and abs((o100["t_mid"] - o0["t_mid"]) / pd.Timedelta(hours=1)) <= TIE_MAX_HOURS
            dt_h = (o100["t_mid"] - o0["t_mid"]) / pd.Timedelta(hours=1)
            raw = o100["g_occ"] - o0["g_occ"]
            ties.append(dict(instrument=inst, date=date, leg=when, t_hotel=o0["t_mid"], t_base100=o100["t_mid"],
                             dt_hours=dt_h, tie_raw_mgal=raw if ok else np.nan,
                             day_rate_mgal_per_h=rate,
                             tie_used=ok, hotel_reject_reasons=o0["reject_reasons"]))
    ties = pd.DataFrame(ties)
    tie_stats = {}
    for inst, d in ties.groupby("instrument"):
        v = d["tie_raw_mgal"].dropna()
        tie_stats[inst] = dict(n=len(v), median=float(v.median()), mean=float(v.mean()), sd=float(v.std(ddof=1)),
                               se=float(v.std(ddof=1) / np.sqrt(len(v))))

    # control points
    ctrl = []
    for i, o in occ[occ["valid_control"]].iterrows():
        if o["role"] == "field_base_100":
            ctrl.append(dict(occ_id=o["occ_id"], instrument=o["instrument"], date=o["date"], t=o["t_mid"],
                             g100=o["g_occ"], sigma=o["sigma_occ"], source="station 100"))
        else:
            ts = tie_stats[o["instrument"]]
            ctrl.append(dict(occ_id=o["occ_id"], instrument=o["instrument"], date=o["date"], t=o["t_mid"],
                             g100=o["g_occ"] + ts["median"], sigma=np.hypot(o["sigma_occ"], ts["sd"]),
                             source="station 0 + median 0->100 tie"))
    ctrl = pd.DataFrame(ctrl).sort_values(["instrument", "t"]).reset_index(drop=True)

    # leave-one-out misclosure of interior station-100 controls, and segment rates
    loo, seg_rates = [], []
    for (inst, date), c in ctrl[ctrl["source"] == "station 100"].groupby(["instrument", "date"]):
        c = c.sort_values("t").reset_index(drop=True)
        th = (c["t"] - c["t"].iloc[0]) / pd.Timedelta(hours=1)
        for j in range(len(c) - 1):
            dth = th.iloc[j + 1] - th.iloc[j]
            seg_rates.append(dict(instrument=inst, date=date, t0=c["t"].iloc[j], t1=c["t"].iloc[j + 1], dt_hours=dth,
                                  dg_mgal=c["g100"].iloc[j + 1] - c["g100"].iloc[j],
                                  rate_mgal_per_h=(c["g100"].iloc[j + 1] - c["g100"].iloc[j]) / dth))
        for j in range(1, len(c) - 1):
            pred = np.interp(th.iloc[j], [th.iloc[j - 1], th.iloc[j + 1]], [c["g100"].iloc[j - 1], c["g100"].iloc[j + 1]])
            loo.append(dict(instrument=inst, date=date, t=c["t"].iloc[j], observed=c["g100"].iloc[j], predicted=pred,
                            misclosure_mgal=c["g100"].iloc[j] - pred))
    loo = pd.DataFrame(loo)
    seg_rates = pd.DataFrame(seg_rates)
    model_sigma = {}
    rate_sigma = {}
    for inst in occ["instrument"].unique():
        l = loo[loo["instrument"] == inst]["misclosure_mgal"] if len(loo) else pd.Series(dtype=float)
        l = l[l.abs() <= TARE_MGAL]  # steps larger than this are reported as tares
        model_sigma[inst] = float(np.sqrt(np.mean(l ** 2))) if len(l) else 0.02
        s = seg_rates[(seg_rates["instrument"] == inst) & (seg_rates["dt_hours"] > 1.0)]["rate_mgal_per_h"]
        rate_sigma[inst] = float(s.std(ddof=1)) if len(s) > 2 else 0.01

    # apply to all usable occupations
    occ["g100_interp"] = np.nan
    occ["g100_sigma"] = np.nan
    occ["drift_mode"] = ""
    occ["ctrl_before"] = ""
    occ["ctrl_after"] = ""
    for (inst, date), d in occ.groupby(["instrument", "date"]):
        c = ctrl[(ctrl["instrument"] == inst) & (ctrl["date"] == date)].sort_values("t").reset_index(drop=True)
        if len(c) == 0:
            occ.loc[d.index, "drift_mode"] = "NO_CONTROL"
            continue
        for i, o in d.iterrows():
            t = o["t_mid"]
            before = c[c["t"] <= t]
            after = c[c["t"] >= t]
            if len(before) and len(after):
                c0, c1 = before.iloc[-1], after.iloc[0]
                if c0["occ_id"] == c1["occ_id"]:
                    g, s, mode = c0["g100"], c0["sigma"], "AT_CONTROL"
                else:
                    w = (t - c0["t"]) / (c1["t"] - c0["t"])
                    g = c0["g100"] + w * (c1["g100"] - c0["g100"])
                    s = np.sqrt(((1 - w) * c0["sigma"]) ** 2 + (w * c1["sigma"]) ** 2 + model_sigma[inst] ** 2)
                    mode = "INTERPOLATED" if (c0["source"] == c1["source"] == "station 100") else "INTERPOLATED_HOTEL_CONTROL"
                occ.loc[i, ["ctrl_before", "ctrl_after"]] = [str(c0["occ_id"]), str(c1["occ_id"])]
            else:
                # outside the controlled interval: extrapolate with the nearest segment rate
                if len(c) >= 2:
                    seg = c.iloc[-2:] if len(before) else c.iloc[:2]
                    rate = (seg["g100"].iloc[1] - seg["g100"].iloc[0]) / ((seg["t"].iloc[1] - seg["t"].iloc[0]) / pd.Timedelta(hours=1))
                else:
                    rate = 0.0
                cn = before.iloc[-1] if len(before) else after.iloc[0]
                dth = (t - cn["t"]) / pd.Timedelta(hours=1)
                g = cn["g100"] + rate * dth
                s = np.sqrt(cn["sigma"] ** 2 + model_sigma[inst] ** 2 + (rate_sigma[inst] * dth) ** 2)
                mode = "EXTRAPOLATED_%.1fh" % abs(dth)
                occ.loc[i, ["ctrl_before", "ctrl_after"]] = [str(cn["occ_id"]), ""]
            occ.loc[i, ["g100_interp", "g100_sigma", "drift_mode"]] = [g, s, mode]
    occ["dg100_mgal"] = occ["g_occ"] - occ["g100_interp"]
    occ["dg100_sigma_mgal"] = np.sqrt(occ["sigma_occ"] ** 2 + occ["g100_sigma"] ** 2)
    return occ, ctrl, ties, tie_stats, loo, seg_rates, model_sigma, rate_sigma


def day_closures(occ):
    """Hotel 0->0 closure per day and day-to-day station-100 series."""
    rows = []
    for (inst, date), d in occ.groupby(["instrument", "date"]):
        h = d[(d["role"] == "hotel_base_0")].sort_values("t_mid")
        b = d[(d["role"] == "field_base_100") & d["valid_control"]].sort_values("t_mid")
        r = dict(instrument=inst, date=date, n_base100_occupations=int((d["role"] == "field_base_100").sum()),
                 n_base100_valid=len(b))
        if len(h) >= 2 and h["valid_control"].iloc[0] and h["valid_control"].iloc[-1]:
            dt = (h["t_mid"].iloc[-1] - h["t_mid"].iloc[0]) / pd.Timedelta(hours=1)
            r.update(hotel_closure_mgal=h["g_occ"].iloc[-1] - h["g_occ"].iloc[0], hotel_closure_hours=dt)
        if len(b) >= 2:
            dt = (b["t_mid"].iloc[-1] - b["t_mid"].iloc[0]) / pd.Timedelta(hours=1)
            r.update(base100_first_last_mgal=b["g_occ"].iloc[-1] - b["g_occ"].iloc[0], base100_span_hours=dt,
                     base100_range_mgal=np.ptp(b["g_occ"].values))
        if len(b):
            r.update(base100_first_value=b["g_occ"].iloc[0], base100_first_time=b["t_mid"].iloc[0])
        rows.append(r)
    return pd.DataFrame(rows)


# ----------------------------------------------------------------------------- 7 inter-instrument
def colocated_pairs(occ, max_sep_m=10.0, max_dh_m=0.5):
    f = occ[(occ["role"] == "field") & occ["usable"] & (occ["match_status"].isin(MATCH_OK))
            & occ["dg100_mgal"].notna()]
    a = f[f["instrument"] == "CG6-0640"]
    b = f[f["instrument"] == "CG6-0313"]
    rows = []
    for _, r in b.iterrows():
        d = gnss.haversine_m(r["lat"], r["lon"], a["lat"].values, a["lon"].values)
        j = int(np.argmin(d))
        if d[j] <= max_sep_m and abs(a["h_used"].iloc[j] - r["h_used"]) <= max_dh_m:
            s = a.iloc[j]
            rows.append(dict(occ_0313=r["occ_id"], key_0313=r["occ_key"], occ_0640=s["occ_id"], key_0640=s["occ_key"],
                             gnss_0313=r["gnss_uid"], gnss_0640=s["gnss_uid"], separation_m=d[j],
                             dh_m=s["h_used"] - r["h_used"],
                             dg100_0313=r["dg100_mgal"], dg100_0640=s["dg100_mgal"],
                             sigma_0313=r["dg100_sigma_mgal"], sigma_0640=s["dg100_sigma_mgal"],
                             drift_mode_0313=r["drift_mode"], drift_mode_0640=s["drift_mode"]))
    return pd.DataFrame(rows)


def scale_estimates(tie_stats, pairs):
    t_ref = tie_stats["CG6-0640"]
    t_old = tie_stats["CG6-0313"]
    k_tie = t_ref["mean"] / t_old["mean"]
    k_tie_se = abs(k_tie) * np.sqrt((t_ref["se"] / t_ref["mean"]) ** 2 + (t_old["se"] / t_old["mean"]) ** 2)
    out = dict(k_tie=k_tie, k_tie_se=k_tie_se, tie_0640=t_ref, tie_0313=t_old)
    p = pairs[pairs["separation_m"] <= 10.0]
    p = p[~p["drift_mode_0313"].str.startswith("EXTRAP") & ~p["drift_mode_0640"].str.startswith("EXTRAP")]
    if len(p) >= 3 and np.ptp(p["dg100_0313"]) > 5:
        A = np.column_stack([np.ones(len(p)), p["dg100_0313"].values])
        coef, *_ = np.linalg.lstsq(A, p["dg100_0640"].values, rcond=None)
        res = p["dg100_0640"].values - A @ coef
        s2 = res @ res / max(len(p) - 2, 1)
        cov = s2 * np.linalg.pinv(A.T @ A)
        out.update(k_colocated=coef[1], k_colocated_se=float(np.sqrt(cov[1, 1])), offset_colocated=coef[0],
                   offset_colocated_se=float(np.sqrt(cov[0, 0])), colocated_n=len(p),
                   colocated_rms_mgal=float(np.sqrt(np.mean(res ** 2))),
                   colocated_dg_range_mgal=float(np.ptp(p["dg100_0313"])))
        # scale through origin (both tied to the same base 100).  Standard error is the
        # larger of the residual-based and the propagated (station sigma) value.
        x, y = p["dg100_0313"].values, p["dg100_0640"].values
        k0 = (x @ y) / (x @ x)
        r0 = y - k0 * x
        se_res = np.sqrt((r0 @ r0) / max(len(p) - 1, 1) / (x @ x))
        sig = np.hypot(p["sigma_0640"].values, k0 * p["sigma_0313"].values)
        se_prop = np.sqrt(np.sum(x ** 2 * sig ** 2)) / (x @ x)
        out.update(k_colocated_origin=float(k0), k_colocated_origin_se=float(max(se_res, se_prop)),
                   k_colocated_origin_se_residual=float(se_res), k_colocated_origin_se_propagated=float(se_prop),
                   colocated_origin_rms_mgal=float(np.sqrt(np.mean(r0 ** 2))))
    return out


def retie_extrapolated(occ, pairs, k, min_pairs=3):
    """Re-tie CG6-0313 segments with extrapolated drift to co-located CG6-0640 points.

    offset = mean(dg100_0640 - k * dg100_0313) over co-located pairs whose 0640
    value is interpolated and whose 0313 value is extrapolated on the same date.
    The offset (divided by k) is added to all extrapolated 0313 occupations of
    that date; their uncertainty becomes the pair scatter combined with sigma_occ.
    """
    occ = occ.copy()
    occ["retie_offset_mgal"] = 0.0
    rows = []
    p = pairs[pairs["drift_mode_0313"].str.startswith("EXTRAP") & ~pairs["drift_mode_0640"].str.startswith("EXTRAP")]
    p = p.merge(occ[["occ_id", "date"]].rename(columns={"occ_id": "occ_0313"}), on="occ_0313")
    for date, d in p.groupby("date"):
        off = d["dg100_0640"] - k * d["dg100_0313"]
        r = dict(date=date, n_pairs=len(d), offset_mgal=off.mean(), offset_sd_mgal=off.std(ddof=1),
                 applied=len(d) >= min_pairs)
        rows.append(r)
        if r["applied"]:
            m = (occ["instrument"] == "CG6-0313") & (occ["date"] == date) & occ["drift_mode"].str.startswith("EXTRAP")
            occ.loc[m, "retie_offset_mgal"] = r["offset_mgal"] / k
            occ.loc[m, "dg100_mgal"] = occ.loc[m, "dg100_mgal"] + r["offset_mgal"] / k
            occ.loc[m, "dg100_sigma_mgal"] = np.hypot(occ.loc[m, "sigma_occ"], r["offset_sd_mgal"])
            occ.loc[m, "drift_mode"] = "RETIED_COLOCATION(" + occ.loc[m, "drift_mode"] + ")"
    return occ, pd.DataFrame(rows)


# ----------------------------------------------------------------------------- 8 reductions
RHO_LIST = (2.0, 2.2, 2.3, 2.4, 2.5, 2.6, 2.67, 2.7, 2.8, 2.9, 3.0)


def add_orthometric(occ, ref, geoid, dem):
    """EGM2008 orthometric heights H = h - N (GNSS heights shown to be ellipsoidal, report 3.3)
    and the DEM height at each matched occupation for comparison."""
    occ = occ.copy()
    m = occ["lat"].notna()
    occ.loc[m, "N_egm2008_m"] = geoid.sample(occ.loc[m, "lon"], occ.loc[m, "lat"])
    occ["H_ortho_m"] = occ["h_used"] - occ["N_egm2008_m"]
    occ.loc[m, "H_dem_m"] = dem.sample(occ.loc[m, "lon"], occ.loc[m, "lat"])
    occ["H_minus_dem_m"] = occ["H_ortho_m"] - occ["H_dem_m"]
    b = ref["base_100"]
    b["N_egm2008"] = float(geoid.sample([b["lon"]], [b["lat"]])[0])
    b["H_used"] = b["h_used"] - b["N_egm2008"]
    b["H_dem"] = float(dem.sample([b["lon"]], [b["lat"]])[0])
    return occ


def reductions(occ, ref, k_apply=None, rho_list=RHO_LIST):
    """Base-relative free-air and simple Bouguer quantities for field occupations.

    Heights are EGM2008 orthometric heights H.
    dFA = dg100 - [gamma(phi) - gamma(phi100)] + [FA(H) - FA(H100)]
    dSB(rho) = dFA - 0.04193 rho (H - H100)
    """
    lat100, H100 = ref["base_100"]["lat"], ref["base_100"]["H_used"]
    s = occ[(occ["role"] == "field")].copy()
    s["product_ok"] = s["usable"] & s["dg100_mgal"].notna() & s["match_status"].isin(MATCH_OK)
    s["scale_factor_applied"] = 1.0
    if k_apply is not None:
        s.loc[s["instrument"] == "CG6-0313", "scale_factor_applied"] = k_apply
    s["dg100_scaled_mgal"] = s["dg100_mgal"] * s["scale_factor_applied"]
    s["dh_m"] = s["H_ortho_m"] - H100
    s["normal_gravity_diff_mgal"] = reduce.normal_gravity_wgs84(s["lat"]) - reduce.normal_gravity_wgs84(lat100)
    s["free_air_term_diff_mgal"] = reduce.free_air_term(s["lat"], s["H_ortho_m"]) - reduce.free_air_term(lat100, H100)
    s["dFA_rel_mgal"] = s["dg100_scaled_mgal"] - s["normal_gravity_diff_mgal"] + s["free_air_term_diff_mgal"]
    s["u_slab_mgal_per_gcc"] = reduce.BOUGUER_K * s["dh_m"]
    for rho in rho_list:
        s[f"dSB_rel_rho{rho:.2f}_mgal"] = s["dFA_rel_mgal"] - reduce.bouguer_slab(rho, s["dh_m"])
    s["dFA_sigma_mgal"] = np.sqrt(s["dg100_sigma_mgal"] ** 2 + (0.3086 * s["h_sigma_m"]) ** 2)
    s["dSB267_sigma_mgal"] = np.sqrt(s["dg100_sigma_mgal"] ** 2 + ((0.3086 - 0.04193 * 2.67) * s["h_sigma_m"]) ** 2)
    return s


def terrain_stage(st, ref, model, rho_list=RHO_LIST, progress=True):
    """DEM topographic effect (unit density) and complete-Bouguer density sweep.

    g1 = attraction of the DEM topography (geoid to surface, with curvature, 22 km) for 1 g/cm3.
    dCB(rho) = dFA - rho [g1(station) - g1(base 100)]
    TC(rho)  = rho [0.04193 H - g1]   (terrain + curvature correction relative to the slab)
    """
    from . import terrain

    b = ref["base_100"]
    g1b, nin, nout = model.unit_effect(b["lon"], b["lat"], b["H_used"])
    b["g1_topo"] = g1b
    st = st.copy()
    idx = st.index[st["product_ok"]]
    g1 = []
    for k, i in enumerate(idx):
        g1.append(model.unit_effect(st.at[i, "lon"], st.at[i, "lat"], st.at[i, "H_ortho_m"])[0])
        if progress and k % 200 == 0:
            print(f"  terrain: {k}/{len(idx)} stations", flush=True)
    st["g1_topo_mgal_per_gcc"] = np.nan
    st.loc[idx, "g1_topo_mgal_per_gcc"] = g1
    st["u_topo_mgal_per_gcc"] = st["g1_topo_mgal_per_gcc"] - g1b
    st["TC1_mgal_per_gcc"] = reduce.BOUGUER_K * st["H_ortho_m"] - st["g1_topo_mgal_per_gcc"]
    st["TC_rho2.67_mgal"] = 2.67 * st["TC1_mgal_per_gcc"]
    for rho in rho_list:
        st[f"dCB_rel_rho{rho:.2f}_mgal"] = st["dFA_rel_mgal"] - rho * st["u_topo_mgal_per_gcc"]
    st["dist_to_sea_km"] = np.nan
    st.loc[idx, "dist_to_sea_km"] = terrain.distance_to_sea_km(model, st.loc[idx, "lon"].values, st.loc[idx, "lat"].values)
    st["dem_coverage_22km"] = False
    st.loc[idx, "dem_coverage_22km"] = [model.coverage_ok(lo, la) for lo, la in zip(st.loc[idx, "lon"], st.loc[idx, "lat"])]
    return st


def terrain_validation(model, st, n=12):
    """Sensitivity of g1 to the zoning parameters on a spread of stations."""
    from . import terrain

    s = st[st["product_ok"]].sort_values("TC1_mgal_per_gcc")
    pick = s.iloc[np.linspace(0, len(s) - 1, n).astype(int)]
    fine = terrain.TopoModel(model.g, coarse=4)
    rows = []
    for _, r in pick.iterrows():
        g0 = r["g1_topo_mgal_per_gcc"]
        g_a = fine.unit_effect(r["lon"], r["lat"], r["H_ortho_m"], inner_coarse=16)[0]
        g_b = model.unit_effect(r["lon"], r["lat"], r["H_ortho_m"], outer_radius=20000.0)[0]
        g_c = model.unit_effect(r["lon"], r["lat"], r["H_ortho_m"] + 0.5)[0]
        rows.append(dict(occ_key=r["occ_key"], TC1=r["TC1_mgal_per_gcc"], g1=g0,
                         d_finer_outer_and_wider_inner=g_a - g0, d_outer_radius_20km=g_b - g0,
                         d_station_height_plus_0_5m=g_c - g0))
    return pd.DataFrame(rows)


# ----------------------------------------------------------------------------- 9 Nettleton
METHODS = {"simple": "u_slab_mgal_per_gcc", "complete": "u_topo_mgal_per_gcc"}


def build_profiles(st, max_step_m=1000.0, min_n=15, min_relief_m=40.0):
    s = st[st["product_ok"]].copy()
    s["station_num"] = pd.to_numeric(s["station"], errors="coerce")
    profs = []
    for (inst, line), d in s.groupby(["instrument", "line"]):
        d = d.sort_values(["station_num", "t_mid"]).drop_duplicates("station_num", keep="first")
        lat, lon = d["lat"].values, d["lon"].values
        step = np.r_[0, gnss.haversine_m(lat[:-1], lon[:-1], lat[1:], lon[1:])]
        seg = np.cumsum(step > max_step_m)
        for k in np.unique(seg):
            p = d[seg == k].copy()
            stp = step[seg == k].copy()
            stp[0] = 0
            p["chainage_m"] = np.cumsum(stp)
            p["profile_id"] = f"{'N' if inst == 'CG6-0640' else 'O'}-L{line}-{int(p['station_num'].min())}-{int(p['station_num'].max())}"
            profs.append(p)
    P = pd.concat(profs, ignore_index=True)
    summ = []
    for pid, p in P.groupby("profile_id"):
        summ.append(dict(profile_id=pid, instrument=p["instrument"].iloc[0], line=p["line"].iloc[0],
                         n_stations=len(p), dates=",".join(sorted(p["date"].unique())),
                         length_km=p["chainage_m"].max() / 1000, H_min=p["H_ortho_m"].min(), H_max=p["H_ortho_m"].max(),
                         relief_m=np.ptp(p["H_ortho_m"]), mean_spacing_m=p["chainage_m"].max() / max(len(p) - 1, 1),
                         lat_c=p["lat"].mean(), lon_c=p["lon"].mean(),
                         n_extrapolated_drift=int(p["drift_mode"].str.startswith("EXTRAP").sum())))
    S = pd.DataFrame(summ)
    S["eligible"] = (S["n_stations"] >= min_n) & (S["relief_m"] >= min_relief_m)
    return P, S


def day_boundary_check(P, datum_days, rho=2.67):
    """Simple-Bouguer step between consecutive stations observed on different days,
    with and without the per-day GNSS height adjustment."""
    sh = datum_days.set_index("gnss_day")["day_height_shift_m"]
    rows = []
    for pid, d in P.groupby("profile_id"):
        d = d.sort_values("chainage_m")
        sb = d[f"dSB_rel_rho{rho:.2f}_mgal"].values
        steps = np.diff(sb)
        k = (reduce.free_air_term(d["lat"].values, 1.0) - reduce.BOUGUER_K * rho)  # mGal per metre of height
        for j in np.where(d["gnss_day"].values[1:] != d["gnss_day"].values[:-1])[0]:
            s0, s1 = sh.get(d["gnss_day"].values[j], 0.0), sh.get(d["gnss_day"].values[j + 1], 0.0)
            if s0 == 0 and s1 == 0:
                continue
            unadj = steps[j] + k[j + 1] * s1 - k[j] * s0
            rows.append(dict(profile_id=pid, from_date=d["date"].values[j], to_date=d["date"].values[j + 1],
                             from_station=d["station"].values[j], to_station=d["station"].values[j + 1],
                             distance_m=d["chainage_m"].values[j + 1] - d["chainage_m"].values[j],
                             step_adjusted_mgal=steps[j], step_unadjusted_mgal=unadj,
                             profile_median_abs_step_mgal=np.median(np.abs(steps)),
                             profile_p90_abs_step_mgal=np.percentile(np.abs(steps), 90)))
    return pd.DataFrame(rows)


def window_nettleton(P, window_m=3000.0, min_n=10, min_relief_m=30.0):
    """Regression density in consecutive non-overlapping chainage windows of every profile."""
    rows = []
    for pid, p in P.groupby("profile_id"):
        p = p.sort_values("chainage_m")
        p = p[~p["drift_mode"].str.startswith("EXTRAP")]
        if len(p) < min_n:
            continue
        edges = np.arange(0, p["chainage_m"].max() + window_m, window_m)
        for a, b in zip(edges[:-1], edges[1:]):
            w = p[(p["chainage_m"] >= a) & (p["chainage_m"] < b)]
            if len(w) < min_n or np.ptp(w["H_ortho_m"]) < min_relief_m:
                continue
            for method, ucol in METHODS.items():
                rho, se, rms = nettleton.regression_density(w["chainage_m"], w[ucol], w["dFA_rel_mgal"])
                rows.append(dict(profile_id=pid, method=method, instrument=p["instrument"].iloc[0],
                                 window_start_m=a, window_end_m=b, n=len(w), relief_m=np.ptp(w["H_ortho_m"]),
                                 rho_regression=rho, rho_se=se, residual_rms_mgal=rms,
                                 lat_c=w["lat"].mean(), lon_c=w["lon"].mean()))
    return pd.DataFrame(rows)


def run_nettleton(P, S, value_col="dFA_rel_mgal"):
    sweeps, res = [], []
    for _, r in S[S["eligible"]].iterrows():
        p = P[P["profile_id"] == r["profile_id"]].sort_values("chainage_m")
        p = p[~p["drift_mode"].str.startswith("EXTRAP")]
        if len(p) < 10 or np.ptp(p["dh_m"]) < 20:
            continue
        for method, ucol in METHODS.items():
            sw = nettleton.sweep(p["chainage_m"], p["H_ortho_m"], p[ucol], p[value_col])
            sw["profile_id"] = r["profile_id"]
            sw["method"] = method
            sweeps.append(sw)
            rho, se, rms = nettleton.regression_density(p["chainage_m"], p[ucol], p[value_col])
            ci, nb = nettleton.block_bootstrap(p["chainage_m"].values, p[ucol].values, p[value_col].values)
            res.append(dict(profile_id=r["profile_id"], method=method, n_used=len(p),
                            rho_zero_corr=nettleton.zero_crossing(sw),
                            rho_regression=rho, rho_regression_se=se, residual_rms_mgal=rms,
                            rho_boot_p2_5=ci[0], rho_boot_p50=ci[1], rho_boot_p97_5=ci[2], n_boot=nb,
                            rho_min_roughness=sw.loc[sw["roughness_2nd_diff_mgal"].idxmin(), "rho"],
                            corr_at_2_67=float(sw.loc[np.isclose(sw["rho"], 2.67), "corr_detrended"].iloc[0]),
                            relief_m=r["relief_m"], length_km=r["length_km"]))
    return pd.concat(sweeps, ignore_index=True), pd.DataFrame(res)


def density_consensus(net, win, se_max=1.0):
    """Weighted mean and chi-square consistency of the density estimates per method."""
    from scipy import stats

    rows = []
    for label, df, col, secol in (("profiles", net, "rho_regression", "rho_regression_se"),
                                  ("3km_windows", win, "rho_regression", "rho_se")):
        for method in METHODS:
            d = df[(df["method"] == method) & (df[secol] < se_max)]
            if len(d) < 2:
                continue
            w = 1 / d[secol] ** 2
            m = float((d[col] * w).sum() / w.sum())
            chi2 = float((((d[col] - m) / d[secol]) ** 2).sum())
            dof = len(d) - 1
            rows.append(dict(set=label, method=method, n=len(d), weighted_mean=m, weighted_se=float(1 / np.sqrt(w.sum())),
                             median=float(d[col].median()), p25=float(d[col].quantile(0.25)),
                             p75=float(d[col].quantile(0.75)), chi2=chi2, dof=dof,
                             p_value=float(stats.chi2.sf(chi2, dof)), birge_ratio=float(np.sqrt(chi2 / dof)),
                             weighted_se_scaled=float(1 / np.sqrt(w.sum()) * max(1.0, np.sqrt(chi2 / dof)))))
    return pd.DataFrame(rows)
