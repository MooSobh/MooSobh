"""Row-level quality control for CG-6 readings.

All rows are retained; each row gets an explicit accept/reject decision and a
semicolon-separated list of reasons.  Warnings do not reject a row.
"""
import numpy as np
import pandas as pd

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


def _add(reasons, mask, code):
    for i in np.where(mask)[0]:
        reasons[i].append(code)


def row_qc(df, th=THRESHOLDS):
    df = df.copy().reset_index(drop=True)
    rej = [[] for _ in range(len(df))]
    warn = [[] for _ in range(len(df))]
    _add(rej, (df["overflow_fields"] != "").values, "OVERFLOW_FIELD")
    frozen = np.zeros(len(df), bool)
    for inst, (lo, hi) in FROZEN_RAW_WINDOW.items():
        frozen |= ((df["instrument"] == inst) & df["RawGrav"].between(lo, hi)).values
    _add(rej, frozen, "FROZEN_SENSOR_OUTPUT")
    med = df.groupby("instrument")["g_tidefix"].transform("median")
    _add(rej, ((df["g_tidefix"] - med).abs() > th["gross_range_mgal"]).values & ~frozen,
         "GROSS_RANGE_GT_%g" % th["gross_range_mgal"])
    _add(rej, (df["StdDev"] > th["stddev_reject_mgal"]).values, "STDDEV_GT_%.3f" % th["stddev_reject_mgal"])
    tilt = np.maximum(df["X"].abs(), df["Y"].abs())
    _add(rej, (tilt > th["tilt_reject_arcsec"]).values, "TILT_GT_%g" % th["tilt_reject_arcsec"])
    _add(warn, ((df["StdDev"] > th["stddev_warn_mgal"]) & (df["StdDev"] <= th["stddev_reject_mgal"])).values,
         "STDDEV_GT_%.3f" % th["stddev_warn_mgal"])
    _add(warn, ((tilt > th["tilt_warn_arcsec"]) & (tilt <= th["tilt_reject_arcsec"])).values,
         "TILT_GT_%g" % th["tilt_warn_arcsec"])

    # repeat consistency inside an occupation, using only rows not yet rejected
    ok = np.array([len(r) == 0 for r in rej])
    for oid, idx in df.groupby("occ_id").groups.items():
        idx = [i for i in idx if ok[i]]
        g = df.loc[idx, "g_tidefix"].values
        if len(idx) >= 3:
            for k, i in enumerate(idx):
                others = np.delete(g, k)
                if abs(g[k] - np.median(others)) > th["repeat_outlier_mgal"]:
                    rej[i].append("REPEAT_OUTLIER")
        elif len(idx) == 2 and abs(g[0] - g[1]) > th["repeat_range_warn_mgal"]:
            for i in idx:
                warn[i].append("TWO_READINGS_DIFFER")

    df["reject_reasons"] = [";".join(r) for r in rej]
    df["warnings"] = [";".join(w) for w in warn]
    df["accepted"] = [len(r) == 0 for r in rej]
    return df


def threshold_sensitivity(df):
    """Rows and complete occupations lost for alternative StdDev and tilt thresholds."""
    out = []
    base = df["overflow_fields"].eq("") & ~df["reject_reasons"].str.contains("FROZEN")
    tilt = np.maximum(df["X"].abs(), df["Y"].abs())
    for kind, values, metric in [("StdDev [mGal]", [0.03, 0.04, 0.05, 0.06, 0.08, 0.10], df["StdDev"]),
                                 ("max(|X|,|Y|) [arcsec]", [10, 15, 20, 25, 30, 40], tilt)]:
        for v in values:
            rejected = base & (metric > v)
            keep = base & ~(metric > v)
            occ_all = df.loc[base].groupby("occ_id").size()
            occ_keep = df.loc[keep].groupby("occ_id").size()
            lost = occ_all.index.difference(occ_keep.index)
            for inst in sorted(df["instrument"].unique()):
                m = df["instrument"] == inst
                lost_i = df.loc[df["occ_id"].isin(lost) & m, "occ_id"].nunique()
                out.append(dict(metric=kind, threshold=v, instrument=inst,
                                rows_rejected=int((rejected & m).sum()),
                                rows_valid_before=int((base & m).sum()),
                                occupations_lost=int(lost_i)))
    return pd.DataFrame(out)
