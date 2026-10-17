"""Step 8 of the gravity chain: base control and drift model.

Station 100 (line 0) is the field control.  The drift is modelled piecewise
linearly between successive base-100 controls of each instrument; station 0
(hotel) contributes supplementary controls through the median 0-100 tie.
Model uncertainty is estimated by leave-one-out misclosure; base-100 jumps
larger than TARE_MGAL are treated as tares, not as drift noise.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import numpy as np
import pandas as pd

from . import gnss
from .settings import BASE_LOC_MAX_M, TARE_MGAL, TIE_MAX_HOURS


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
