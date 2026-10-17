"""Ground magnetic processing chain of the Wadi Ghadir survey, as 8 numbered steps.

    from wghadir.chains import MagneticChain
    m = MagneticChain(mag_file="data/raw/magnetics/All_Data_Corrected_Total_Intensity.xlsx",
                      external_dir="data/external", out_dir="outputs")
    m.run_all()                       # or m.step01_load(), m.step02_... one by one

Input: the diurnally corrected total-field workbook supplied by the field team.
The map style, base-100 symbol and DEM relief are shared with the gravity maps;
base 100 is read from <out_dir>/summary.json if the gravity chain has been run,
otherwise from the default position below.

 Step  What                                                   Main results (attributes)
 ----  -----------------------------------------------------  ---------------------------
  1    load all rows, UTM coordinates, day segments from time  data
  2    despike: Hampel filter within each day                  data['accepted']
  3    IGRF-14 total field -> total-field anomaly (TMA)        data['tma_nT'], inc, dec
  4    QC statistics: days, crossovers, IGRF date sensitivity  days, crossovers, igrf_sensitivity
  5    gridding of TMI and TMA (block median + spline)         grid_tmi, grid_tma, cv
  6    reduction to the pole (FFT, tapered and padded)         grid_rtp
  7    maps: points and grids of TMI, TMA, RTP                 mag01-mag05 PNG
  8    export: tables, grids (NetCDF/XYZ), workbook, summary   summary

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import json
import os

import numpy as np
import pandas as pd

from ..common import geodata, mapping
from ..magnetic import export, maps, processing, settings

# Base 100 (gravity field control, GNSS position from the gravity chain, outputs/summary.json).
# Used only as a map symbol when the gravity chain has not been run in out_dir.
DEFAULT_BASE_100 = {"lat": 24.786748811111114, "lon": 34.9337552}


class MagneticChain:
    """Step-by-step ground magnetic processing (see the module docstring for the steps)."""

    def __init__(self, mag_file="data/raw/magnetics/All_Data_Corrected_Total_Intensity.xlsx",
                 external_dir="data/external", out_dir="outputs", verbose=True):
        self.mag_file, self.external_dir, self.out_dir = mag_file, external_dir, out_dir
        self.map_dir = os.path.join(out_dir, "magnetics")
        self.grid_dir = os.path.join(out_dir, "grids")
        self.table_dir = os.path.join(out_dir, "tables")
        self.deliverable_dir = os.path.join(out_dir, "deliverables")
        for d in (self.map_dir, self.grid_dir, self.table_dir, self.deliverable_dir):
            os.makedirs(d, exist_ok=True)
        self.verbose = verbose

    def _log(self, msg):
        if self.verbose:
            print(msg, flush=True)

    @property
    def accepted(self):
        """Accepted readings only."""
        return self.data[self.data["accepted"]]

    # ------------------------------------------------------------------ steps
    def step01_load(self):
        """Read every row (keeps the Excel row number), UTM 36N coordinates, day segments."""
        self.data = processing.load(self.mag_file)
        n = int((self.data["day_seq"] > 0).sum())
        self._log(f"[1] {len(self.data)} rows, {n} survey readings, {self.data['day_seq'].max()} survey days")
        return self.data

    def step02_despike(self):
        """Hampel filter on the corrected total field within each day."""
        self.data = processing.despike(self.data)
        n_sp = int(self.data["flags"].str.contains("SPIKE").sum())
        self._log(f"[2] {n_sp} spikes rejected; {int(self.data['accepted'].sum())} readings accepted")
        return self.data["flags"].str.split(";").explode().replace("", np.nan).dropna().value_counts()

    def step03_igrf(self):
        """IGRF-14 total field, inclination and declination; TMA = TMI - IGRF."""
        self.data = processing.add_igrf(self.data, settings.SURVEY_DATE)
        self.inc = float(self.accepted["igrf_inc_deg"].median())
        self.dec = float(self.accepted["igrf_dec_deg"].median())
        self._log(f"[3] IGRF-14 {settings.SURVEY_DATE:%Y-%m-%d} (assumed): I = {self.inc:.2f} deg, "
                  f"D = {self.dec:.2f} deg")
        return self.data[["igrf_F_nT", "tma_nT"]].describe()

    def step04_qc_statistics(self):
        """Per-day summary, crossovers between days and the IGRF date sensitivity."""
        self.days = processing.day_summary(self.data)
        self.crossover_pairs, self.crossovers = processing.crossovers(self.data)
        a = self.accepted
        self.igrf_sensitivity = processing.igrf_date_sensitivity(float(a["lon"].median()), float(a["lat"].median()))
        self._log(f"[4] {len(self.crossover_pairs)} crossover pairs (< {settings.CROSSOVER_M:g} m, different days)")
        return self.days

    def step05_gridding(self):
        """Block median + damped biharmonic spline (UTM 36N), blanked away from data; cross-validation."""
        a = self.accepted
        x, y = a["utm_e"].values, a["utm_n"].values
        self.grid_tmi = processing.grid_field(x, y, a["tmi_corr_nT"].values)
        self.grid_tma = processing.grid_field(x, y, a["tma_nT"].values)
        self.cv = {"tmi": processing.cv_rmse(x, y, a["tmi_corr_nT"].values),
                   "tma": processing.cv_rmse(x, y, a["tma_nT"].values)}
        self._log(f"[5] grids {settings.GRID_SPACING_M:g} m; cross-validation rms TMI {self.cv['tmi']:.1f} nT, "
                  f"TMA {self.cv['tma']:.1f} nT")
        return self.cv

    def step06_reduction_to_pole(self):
        """FFT reduction to the pole of the TMA (induced magnetisation along the IGRF field)."""
        a = self.accepted
        self.grid_rtp = processing.rtp_grid(a["utm_e"].values, a["utm_n"].values, a["tma_nT"].values,
                                            self.inc, self.dec)
        v = self.grid_rtp["value"]
        self._log(f"[6] RTP range {float(np.nanmin(v)):.0f} to {float(np.nanmax(v)):.0f} nT")
        return self.grid_rtp

    def step07_maps(self):
        """Point maps and gridded maps of TMI, TMA and RTP in the gravity map style."""
        summ = os.path.join(self.out_dir, "summary.json")
        ref = json.load(open(summ))["ref"] if os.path.exists(summ) else {"base_100": DEFAULT_BASE_100}
        dem = geodata.Grid(os.path.join(self.external_dir, "copernicus_glo30_wadi_ghadir.tif"))
        bm = mapping.Basemap(dem)
        mapping.apply_map_style()
        d, inc, dec, cv, out = self.data, self.inc, self.dec, self.cv, self.map_dir
        date = f"{settings.SURVEY_DATE:%d %b %Y}"
        n_acc, n_all = int(d["accepted"].sum()), int((d["day_seq"] > 0).sum())
        maps.map_points(bm, d, ref, "tmi_corr_nT", "Total magnetic intensity – survey readings",
                        "Total magnetic intensity [nT]", "mag01_TMI_points.png", out,
                        subtitle=f"{n_acc:,} accepted readings of {n_all:,}; diurnally corrected as supplied",
                        note="Points coloured by the corrected total field; ✕ = readings rejected by the Hampel "
                             "despike.")
        maps.map_points(bm, d, ref, "tma_nT", "Total-field magnetic anomaly – survey readings", "TMI − IGRF [nT]",
                        "mag02_TMA_points.png", out, center=0.0,
                        subtitle=f"IGRF-14 removed for {date} (assumed date); I = {inc:.1f}°, D = {dec:.1f}°",
                        note="Points coloured by the anomaly; ✕ = rejected spikes.")
        maps.map_grid(bm, self.grid_tmi, d, ref, "Total magnetic intensity (gridded)", "Total magnetic intensity [nT]",
                      "mag03_TMI_grid.png", out, subtitle="Diurnally corrected total field",
                      note=f"Cross-validation rms {cv['tmi']:.0f} nT.")
        maps.map_grid(bm, self.grid_tma, d, ref, "Total-field magnetic anomaly (gridded)", "TMI − IGRF [nT]",
                      "mag04_TMA_grid.png", out, center=0.0,
                      subtitle=f"IGRF-14 removed ({date}, assumed); I = {inc:.1f}°, D = {dec:.1f}°",
                      note=f"Cross-validation rms {cv['tma']:.0f} nT.")
        maps.map_grid(bm, self.grid_rtp, d, ref, "Reduced-to-pole magnetic anomaly", "RTP anomaly [nT]",
                      "mag05_RTP_grid.png", out, center=0.0,
                      subtitle=f"Induced magnetisation assumed; field I = {inc:.1f}°, D = {dec:.1f}° (IGRF-14)",
                      note="FFT RTP (Harmonica) on a padded grid tapered to the median beyond the data mask.")
        self._log(f"[7] maps mag01-mag05 in {out}")
        return sorted(f for f in os.listdir(out) if f.endswith(".png"))

    def step08_export(self):
        """Grids (NetCDF + XYZ), QC tables, Excel workbook and magnetics_summary.json."""
        for g, name in ((self.grid_tmi, "tmi_nT"), (self.grid_tma, "tma_nT"), (self.grid_rtp, "rtp_nT")):
            maps.save_grid(g, os.path.join(self.grid_dir, f"mag_{name.split('_')[0]}"), name)
        pd.DataFrame([dict(grid=k, block_kfold_rmse_nT=v) for k, v in self.cv.items()]).to_csv(
            os.path.join(self.grid_dir, "mag_gridding_cross_validation.csv"), index=False)
        t = self.table_dir
        self.data.to_csv(os.path.join(t, "30_mag_readings_qc.csv"), index=False, float_format="%.6f")
        self.days.to_csv(os.path.join(t, "31_mag_day_summary.csv"), index=False)
        self.crossovers.to_csv(os.path.join(t, "32_mag_crossovers.csv"), index=False)
        self.igrf_sensitivity.to_csv(os.path.join(t, "33_mag_igrf_date_sensitivity.csv"), index=False)

        d, s = self.data, settings
        n_acc, n_all = int(d["accepted"].sum()), int((d["day_seq"] > 0).sum())
        meta = {"Source file": os.path.basename(self.mag_file), "Rows": len(d), "Survey readings": n_all,
                "Accepted": n_acc, "Rejected spikes": int(d["flags"].str.contains("SPIKE").sum()),
                "Non-data rows": int(d["flags"].str.contains("NON_DATA").sum()),
                "Survey days (from time stamps)": int(d["day_seq"].max()),
                "IGRF model / date": f"IGRF-14, {s.SURVEY_DATE:%Y-%m-%d} (assumed: no dates in the file)",
                "Field inclination / declination (median)": f"{self.inc:.2f}° / {self.dec:.2f}°",
                "Despike": f"Hampel, window {s.HAMPEL_WINDOW}, k = {s.HAMPEL_K}, floor {s.HAMPEL_FLOOR_NT} nT",
                "Gridding": f"{s.BLOCK_M:.0f} m block median, spline, {s.GRID_SPACING_M:.0f} m grid, "
                            f"mask {s.MASK_KM} km",
                "Cross-validation rms (TMI / TMA)": f"{self.cv['tmi']:.1f} / {self.cv['tma']:.1f} nT"}
        export.write_workbook(os.path.join(self.deliverable_dir, "Wadi_Ghadir_Magnetic_Results.xlsx"), d, self.days,
                              self.crossovers, self.igrf_sensitivity, meta)
        xr = self.crossover_pairs
        self.summary = dict(meta, inc=self.inc, dec=self.dec, crossover_pairs=int(len(xr)),
                            crossover_median_abs_nT=float(np.median(np.abs(xr["dTMI_nT"]))) if len(xr) else None,
                            tma_percentiles=np.percentile(self.accepted["tma_nT"], [1, 50, 99]).tolist(),
                            rtp_range=[float(np.nanmin(self.grid_rtp["value"])),
                                       float(np.nanmax(self.grid_rtp["value"]))])
        with open(os.path.join(self.out_dir, "magnetics_summary.json"), "w") as fh:
            json.dump(self.summary, fh, indent=2, default=str)
        self._log(f"[8] tables, grids and Wadi_Ghadir_Magnetic_Results.xlsx written to {self.out_dir}")
        return self.summary

    # ------------------------------------------------------------------ all steps
    STEPS = ("step01_load", "step02_despike", "step03_igrf", "step04_qc_statistics", "step05_gridding",
             "step06_reduction_to_pole", "step07_maps", "step08_export")

    def run_all(self, make_maps=True):
        """Run steps 1-8 in order (step 7 only if make_maps=True)."""
        for name in self.STEPS:
            if name == "step07_maps" and not make_maps:
                continue
            getattr(self, name)()
        return self
