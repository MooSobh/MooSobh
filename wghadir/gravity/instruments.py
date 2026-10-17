"""Step 9 of the gravity chain: reconciliation of the two CG-6 instruments.

Scale factor of CG-6 #0313 relative to #0640 from (a) the hotel 0 - base 100
ties and (b) co-located field points; combined by inverse-variance weighting
when they agree.  Segments of #0313 that were extrapolated beyond a base
control are re-tied to co-located #0640 values.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import numpy as np
import pandas as pd

from . import gnss
from .settings import MATCH_OK


def colocated_pairs(occ, max_sep_m=10.0, max_dh_m=0.5):
    """Pairs of #0640 and #0313 occupations at the same point (<= max_sep_m apart, height difference <= max_dh_m)."""
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
    """Scale factor k of #0313 relative to #0640 from the hotel-base100 ties and from the co-located pairs (linear regression and regression through the origin), with standard errors."""
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
