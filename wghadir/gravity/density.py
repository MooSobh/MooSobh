"""Step 12 of the gravity chain: reduction density by the Nettleton method.

Continuous traverses are cut into profiles; for each profile the density is
estimated by the detrended-correlation sweep and by regression (with a block
bootstrap), for the simple (slab) and the complete (DEM) Bouguer effect.
Moving 3 km windows and a chi-square consensus summarise the estimates.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import numpy as np
import pandas as pd

from . import gnss, nettleton, reduce
from .settings import METHODS


def build_profiles(st, max_step_m=1000.0, min_n=15, min_relief_m=40.0):
    """Cut the stations of each instrument line into continuous profiles (gap <= max_step_m) with chainage; keep profiles with >= min_n stations and >= min_relief_m relief."""
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
    """Nettleton sweep and regression density (with block bootstrap) for every profile, for the simple and the complete Bouguer effect."""
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
