#!/usr/bin/env python3
"""Run the complete Wadi Ghadir gravity processing chain from the raw files.

Example:
    python scripts/run_processing.py --raw data/raw --out outputs
"""
import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from wghadir import figures, pipeline as pl, qc  # noqa: E402


def _json(o):
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    if isinstance(o, (pd.Timestamp,)):
        return str(o)
    if isinstance(o, np.bool_):
        return bool(o)
    raise TypeError(type(o))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", default="data/raw", help="directory with the supplied raw files")
    ap.add_argument("--out", default="outputs", help="output directory")
    ap.add_argument("--no-figures", action="store_true")
    a = ap.parse_args()
    tdir = os.path.join(a.out, "tables")
    fdir = os.path.join(a.out, "figures")
    os.makedirs(tdir, exist_ok=True)
    os.makedirs(fdir, exist_ok=True)
    W = lambda df, name: df.to_csv(os.path.join(tdir, name), index=False, float_format="%.6g")  # noqa: E731
    summary = {}

    # 1-3 inventory, CorrGrav verification, tide
    headers, df = pl.load_instruments(a.raw)
    files, meta = pl.inventory_tables(headers, df, a.raw)
    W(files, "01_file_inventory.csv")
    W(meta, "02_instrument_metadata.csv")
    ver = pl.verify_corrgrav(df)
    W(ver, "03_corrgrav_verification.csv")
    tide = pl.tide_recompute(df)
    W(tide, "04_tide_check.csv")

    # 4 QC
    df = qc.row_qc(df)
    W(qc.threshold_sensitivity(df), "06_qc_threshold_sensitivity.csv")
    W(pd.DataFrame([qc.THRESHOLDS]), "06_qc_thresholds.csv")
    occ = pl.build_occupations(df)

    # 5 GNSS
    P, K, master_check, zip_list = pl.load_gnss(a.raw)
    W(zip_list, "01b_results_zip_members.csv")
    datum_marks, datum_days, ref = pl.gnss_datum_check(P)
    day_map_tab, day_of_date = pl.map_days(occ, P)
    W(day_map_tab, "08_gnss_day_mapping.csv")
    W(datum_marks, "09_gnss_base_marks_by_day.csv")
    W(datum_days, "09_gnss_day_datum.csv")
    occ = pl.match_occupations(occ, P, day_of_date, datum_days, ref)
    # reference height of base 100: median of daily solutions after day adjustment
    b = datum_marks[datum_marks["mark"] == "base_100"].merge(datum_days[["gnss_day", "day_height_shift_m"]], on="gnss_day")
    ref["base_100"]["h_used"] = float((b["h_gnss"] - b["day_height_shift_m"]).median())
    ref["base_100"]["h_used_sd"] = float((b["h_gnss"] - b["day_height_shift_m"]).std(ddof=1))
    P["date"] = P["gnss_day"].map({v: k for k, v in day_of_date.items()})
    W(P.drop(columns=["lat_text", "lon_text"], errors="ignore"), "07_gnss_points_all.csv")

    # 6 base control
    occ, ctrl, ties, tie_stats, loo, seg, model_sigma, rate_sigma = pl.base_control(occ, ref)
    closures = pl.day_closures(occ)
    W(ctrl, "10_control_points.csv")
    W(ties, "11_hotel_base100_ties.csv")
    W(loo, "12_base100_leave_one_out_misclosure.csv")
    W(seg, "12_base100_segment_rates.csv")
    W(closures, "13_daily_closures.csv")

    # 7 instruments
    pairs = pl.colocated_pairs(occ)
    W(pairs, "14_colocated_pairs.csv")
    sc = pl.scale_estimates(tie_stats, pairs)
    summary["scale"] = sc
    k_apply = None
    if "k_colocated_origin" in sc:
        z = (sc["k_colocated_origin"] - sc["k_tie"]) / np.hypot(sc["k_colocated_origin_se"], sc["k_tie_se"])
        sc["agreement_z"] = z
        if abs(z) < 2:
            w1, w2 = 1 / sc["k_tie_se"] ** 2, 1 / sc["k_colocated_origin_se"] ** 2
            k_apply = (w1 * sc["k_tie"] + w2 * sc["k_colocated_origin"]) / (w1 + w2)
            sc["k_applied"] = k_apply
            sc["k_applied_se"] = 1 / np.sqrt(w1 + w2)

    retie = pd.DataFrame()
    if k_apply is not None:
        occ, retie = pl.retie_extrapolated(occ, pairs, k_apply)
    W(retie, "14_extrapolated_segment_reties.csv")
    summary["retie"] = retie.to_dict("records")

    # 8 reductions
    st = pl.reductions(occ, ref, k_apply=k_apply)

    # rows table (all original rows + derived columns + decision)
    rows = df.merge(occ[["occ_id", "occ_key", "role", "match_status", "gnss_uid", "match_dist_m"]], on="occ_id", how="left")
    W(rows.drop(columns=["t"], errors="ignore"), "05_rows_qc.csv")
    W(occ, "15_occupations.csv")
    W(st, "16_field_stations_relative.csv")

    # 9 Nettleton
    prof, prof_sum = pl.build_profiles(st)
    sweeps, net = pl.run_nettleton(prof, prof_sum)
    W(prof, "17_profiles_stations.csv")
    W(prof_sum, "17_profiles_summary.csv")
    W(sweeps, "18_nettleton_sweeps.csv")
    W(net, "18_nettleton_results.csv")
    win = pl.window_nettleton(prof)
    W(win, "19_nettleton_windows.csv")
    dbc = pl.day_boundary_check(prof, datum_days)
    W(dbc, "20_day_boundary_height_check.csv")

    summary.update(dict(
        rows=int(len(df)), rows_accepted=int(df["accepted"].sum()),
        rows_rejected_by_reason=df.loc[~df["accepted"], "reject_reasons"].value_counts().to_dict(),
        occupations=int(len(occ)), occupations_usable=int(occ["usable"].sum()),
        match_status=occ.groupby(["instrument", "match_status"]).size().rename("n").reset_index().to_dict("records"),
        day_of_date=day_of_date, master_check=master_check, ref=ref, tie_stats=tie_stats,
        model_sigma=model_sigma, rate_sigma=rate_sigma,
        products=int(st["product_ok"].sum()),
    ))
    with open(os.path.join(a.out, "summary.json"), "w") as fh:
        json.dump(summary, fh, indent=2, default=_json)

    if not a.no_figures:
        figures.make_all(dict(df=df, occ=occ, st=st, P=P, ctrl=ctrl, ties=ties, loo=loo, closures=closures,
                              pairs=pairs, sc=sc, retie=retie, win=win, dbc=dbc, datum_days=datum_days, closures_tab=closures, prof=prof, prof_sum=prof_sum, sweeps=sweeps, net=net,
                              datum_marks=datum_marks, ref=ref, tide=tide), fdir)
    print(json.dumps({k: summary[k] for k in ("rows", "rows_accepted", "occupations", "products")}, indent=1))


if __name__ == "__main__":
    main()
