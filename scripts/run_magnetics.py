#!/usr/bin/env python3
"""Ground magnetics of Wadi Ghadir: QC, IGRF removal, point and gridded maps, RTP.

Example:
    python scripts/run_magnetics.py --mag data/raw/magnetics/All_Data_Corrected_Total_Intensity.xlsx
Requires the gravity run first (outputs/summary.json for base 100, data/external DEM for relief).
"""
import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from wghadir import geodata, magnetics as mg, maps  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mag", default="data/raw/magnetics/All_Data_Corrected_Total_Intensity.xlsx")
    ap.add_argument("--out", default="outputs")
    ap.add_argument("--external", default="data/external")
    a = ap.parse_args()
    mdir = os.path.join(a.out, "magnetics")
    gdir = os.path.join(a.out, "grids")
    tdir = os.path.join(a.out, "tables")
    ddir = os.path.join(a.out, "deliverables")
    for p in (mdir, gdir, tdir, ddir):
        os.makedirs(p, exist_ok=True)

    d = mg.load(a.mag)
    d = mg.despike(d)
    d = mg.add_igrf(d)
    days = mg.day_summary(d)
    xrows, xs = mg.crossovers(d)
    acc = d[d["accepted"]]
    lon_c, lat_c = float(acc["lon"].median()), float(acc["lat"].median())
    sens = mg.igrf_date_sensitivity(lon_c, lat_c)
    inc = float(acc["igrf_inc_deg"].median())
    dec = float(acc["igrf_dec_deg"].median())

    x, y = acc["utm_e"].values, acc["utm_n"].values
    g_tmi = mg.grid_field(x, y, acc["tmi_corr_nT"].values)
    g_tma = mg.grid_field(x, y, acc["tma_nT"].values)
    g_rtp = mg.rtp_grid(x, y, acc["tma_nT"].values, inc, dec)
    cv = {"tmi": mg.cv_rmse(x, y, acc["tmi_corr_nT"].values), "tma": mg.cv_rmse(x, y, acc["tma_nT"].values)}

    ref = json.load(open(os.path.join(a.out, "summary.json")))["ref"]
    dem = geodata.Grid(os.path.join(a.external, "copernicus_glo30_wadi_ghadir.tif"))
    bm = maps.Basemap(dem)
    n_acc, n_all = int(d["accepted"].sum()), int((d["day_seq"] > 0).sum())
    sub_pts = f"{n_acc:,} accepted readings of {n_all:,}; diurnally corrected as supplied"
    mg.map_points(bm, d, ref, "tmi_corr_nT", "Total magnetic intensity – survey readings",
                  "Total magnetic intensity [nT]", "mag01_TMI_points.png", mdir, subtitle=sub_pts,
                  note="Points coloured by the corrected total field; ✕ = readings rejected by the Hampel despike.")
    mg.map_points(bm, d, ref, "tma_nT", "Total-field magnetic anomaly – survey readings",
                  "TMI − IGRF [nT]", "mag02_TMA_points.png", mdir, center=0.0,
                  subtitle=f"IGRF-14 removed for {mg.SURVEY_DATE:%d %b %Y} (assumed date); "
                           f"I = {inc:.1f}°, D = {dec:.1f}°",
                  note="Points coloured by the anomaly; ✕ = rejected spikes.")
    mg.map_grid(bm, g_tmi, d, ref, "Total magnetic intensity (gridded)", "Total magnetic intensity [nT]",
                "mag03_TMI_grid.png", mdir, subtitle="Diurnally corrected total field",
                note=f"Cross-validation rms {cv['tmi']:.0f} nT.")
    mg.map_grid(bm, g_tma, d, ref, "Total-field magnetic anomaly (gridded)", "TMI − IGRF [nT]",
                "mag04_TMA_grid.png", mdir, center=0.0,
                subtitle=f"IGRF-14 removed ({mg.SURVEY_DATE:%d %b %Y}, assumed); I = {inc:.1f}°, D = {dec:.1f}°",
                note=f"Cross-validation rms {cv['tma']:.0f} nT.")
    mg.map_grid(bm, g_rtp, d, ref, "Reduced-to-pole magnetic anomaly", "RTP anomaly [nT]",
                "mag05_RTP_grid.png", mdir, center=0.0,
                subtitle=f"Induced magnetisation assumed; field I = {inc:.1f}°, D = {dec:.1f}° (IGRF-14)",
                note="FFT RTP (Harmonica) on a padded grid tapered to the median beyond the data mask.")

    for g, name in ((g_tmi, "tmi_nT"), (g_tma, "tma_nT"), (g_rtp, "rtp_nT")):
        mg.save_grid(g, os.path.join(gdir, f"mag_{name.split('_')[0]}"), name)
    pd.DataFrame([dict(grid=k, block_kfold_rmse_nT=v) for k, v in cv.items()]).to_csv(
        os.path.join(gdir, "mag_gridding_cross_validation.csv"), index=False)

    d.to_csv(os.path.join(tdir, "30_mag_readings_qc.csv"), index=False, float_format="%.6f")
    days.to_csv(os.path.join(tdir, "31_mag_day_summary.csv"), index=False)
    xs.to_csv(os.path.join(tdir, "32_mag_crossovers.csv"), index=False)
    sens.to_csv(os.path.join(tdir, "33_mag_igrf_date_sensitivity.csv"), index=False)
    meta = {"Source file": os.path.basename(a.mag), "Rows": len(d), "Survey readings": n_all,
            "Accepted": n_acc, "Rejected spikes": int(d["flags"].str.contains("SPIKE").sum()),
            "Non-data rows": int(d["flags"].str.contains("NON_DATA").sum()),
            "Survey days (from time stamps)": int(d["day_seq"].max()),
            "IGRF model / date": f"IGRF-14, {mg.SURVEY_DATE:%Y-%m-%d} (assumed: no dates in the file)",
            "Field inclination / declination (median)": f"{inc:.2f}° / {dec:.2f}°",
            "Despike": f"Hampel, window {mg.HAMPEL_WINDOW}, k = {mg.HAMPEL_K}, floor {mg.HAMPEL_FLOOR_NT} nT",
            "Gridding": f"{mg.BLOCK_M:.0f} m block median, spline, {mg.GRID_SPACING_M:.0f} m grid, mask {mg.MASK_KM} km",
            "Cross-validation rms (TMI / TMA)": f"{cv['tmi']:.1f} / {cv['tma']:.1f} nT"}
    mg.write_workbook(os.path.join(ddir, "Wadi_Ghadir_Magnetic_Results.xlsx"), d, days, xs, sens, meta)
    summary = dict(meta, inc=inc, dec=dec, crossover_pairs=int(len(xrows)),
                   crossover_median_abs_nT=float(np.median(np.abs(xrows["dTMI_nT"]))) if len(xrows) else None,
                   tma_percentiles=np.percentile(acc["tma_nT"], [1, 50, 99]).tolist(),
                   rtp_range=[float(np.nanmin(g_rtp["value"])), float(np.nanmax(g_rtp["value"]))])
    with open(os.path.join(a.out, "magnetics_summary.json"), "w") as fh:
        json.dump(summary, fh, indent=2, default=str)
    print(json.dumps(summary, indent=1, default=str))


if __name__ == "__main__":
    main()
