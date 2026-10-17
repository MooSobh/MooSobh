"""Steps 6-7 of the gravity chain: GNSS positions and heights.

6  parse the GNSS point workbooks (DMS) and the KML files, check the daily datum at
   the two base marks, map GNSS days to gravity dates by coordinates and match every
   occupation to one GNSS point (distance, ambiguity and station-ID rules)
7  EGM2008 orthometric heights H = h - N and comparison with the Copernicus DEM

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import os
import re
import tempfile
import zipfile

import numpy as np
import pandas as pd

from . import gnss
from .settings import (AMBIG_MARGIN_M, DAY_DATUM_SHIFT_MIN_M, DISTINCT_LOC_M, EXCLUDED_KML_NAMES,
                       H_SIGMA_NOMINAL_M, MATCH_MAX_M)


def _base_kind(pid):
    p = str(pid).lower().replace(" ", "")
    if "base" in p or p.startswith("b100"):
        return "base_100" if "100" in p else "hotel_0"
    return ""


def load_gnss(raw_dir):
    """Step 6: read the daily GNSS workbooks (results.zip), the master workbook and the KML points into one table; return (points, kml, master_check, zip_list)."""
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
    """Step 6: match every occupation to one GNSS point of its day (distance, ambiguity and station-ID rules) and attach position, height and height sigma."""
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
