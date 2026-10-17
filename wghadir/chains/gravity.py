"""Gravity processing chain of the Wadi Ghadir survey, as 14 numbered steps.

    from wghadir.chains import GravityChain
    g = GravityChain(raw_dir="data/raw", external_dir="data/external", out_dir="outputs")
    g.run_all()                       # or call g.step01_inventory(), g.step02_... one by one

Each step reads what the previous steps left on the object, adds its own
results as attributes and writes its tables to <out_dir>/tables.  The step
numbers match the table numbers and the report sections.

 Step  What                                              Main results (attributes)
 ----  ------------------------------------------------  ---------------------------------
  1    inventory of the raw files, CG-6 header metadata  rows, headers, files, meta
  2    check CorrGrav = Raw + Tide + Tilt + Temp + Drift  corrgrav_check
  3    Longman tide re-computed at the GPS position      tide_check, rows['g_tidefix']
  4    row-level QC with explicit thresholds             rows['accepted'], qc_sensitivity
  5    readings grouped into station occupations         occ
  6    GNSS points: parsing, datum, day mapping, match   gnss, datum_marks, datum_days, ref
  7    EGM2008 orthometric heights, DEM comparison       dem, geoid, height_check
  8    base-100 control, drift model, closures           ctrl, ties, loo, closures
  9    inter-instrument scale factor and re-ties         pairs, scale, retie
 10    free-air and simple Bouguer (11 densities)        st
 11    DEM terrain correction, complete Bouguer          topo, st, terrain_check
 12    Nettleton density by profile and window           prof, net, win, consensus
 13    summary and deliverables (xlsx, csv, geojson, kml) summary, final
 14    QC figures, maps, grids and Nettleton sheets      figure files

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import json
import os
import time

import numpy as np
import pandas as pd

from ..common import geodata
from ..gravity import (base_control, density, export, figures, instruments, inventory, positioning, qc, reductions,
                       settings, terrain)


def _json_default(o):
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, pd.Timestamp):
        return str(o)
    raise TypeError(type(o))


class GravityChain:
    """Step-by-step CG-6 gravity processing (see the module docstring for the steps)."""

    def __init__(self, raw_dir="data/raw", external_dir="data/external", out_dir="outputs", verbose=True):
        self.raw_dir, self.external_dir, self.out_dir = raw_dir, external_dir, out_dir
        self.table_dir = os.path.join(out_dir, "tables")
        self.figure_dir = os.path.join(out_dir, "figures")
        self.deliverable_dir = os.path.join(out_dir, "deliverables")
        for d in (self.table_dir, self.figure_dir, self.deliverable_dir):
            os.makedirs(d, exist_ok=True)
        self.verbose = verbose
        self.summary = {}

    # ------------------------------------------------------------------ helpers
    def _log(self, msg):
        if self.verbose:
            print(msg, flush=True)

    def _save(self, df, name):
        """Write one processing table to <out_dir>/tables/<name>."""
        df.to_csv(os.path.join(self.table_dir, name), index=False, float_format="%.6g")

    # ------------------------------------------------------------------ steps
    def step01_inventory(self):
        """Read both CG-6 exports; file inventory with SHA-256 and header metadata."""
        self.headers, self.rows = inventory.load_instruments(self.raw_dir)
        self.files, self.meta = inventory.inventory_tables(self.headers, self.rows, self.raw_dir)
        self._save(self.files, "01_file_inventory.csv")
        self._save(self.meta, "02_instrument_metadata.csv")
        self._log(f"[1] {len(self.rows)} readings from {len(self.headers)} instruments")
        return self.files

    def step02_verify_onboard_corrections(self):
        """Numerical check of CorrGrav = RawGrav + TideCorr + TiltCorr + TempCorr + DriftCorr."""
        self.corrgrav_check = inventory.verify_corrgrav(self.rows)
        self._save(self.corrgrav_check, "03_corrgrav_verification.csv")
        self._log("[2] CorrGrav closure rms [mGal]: " + ", ".join(
            f"{r.instrument} {r.closure_rms_mgal:.1e}" for r in self.corrgrav_check.itertuples()))
        return self.corrgrav_check

    def step03_recompute_tide(self):
        """Longman tide at the CG-6 GPS position replaces the on-board tide (-> g_tidefix)."""
        self.tide_check = inventory.tide_recompute(self.rows)
        self._save(self.tide_check, "04_tide_check.csv")
        self._log("[3] tide re-computed (Longman, UTC, GPS position)")
        return self.tide_check

    def step04_row_qc(self):
        """Accept/reject every reading with the thresholds in gravity/settings.py."""
        self.rows = qc.row_qc(self.rows)
        self.qc_sensitivity = qc.threshold_sensitivity(self.rows)
        self._save(self.qc_sensitivity, "06_qc_threshold_sensitivity.csv")
        self._save(pd.DataFrame([settings.THRESHOLDS]), "06_qc_thresholds.csv")
        self._log(f"[4] accepted {int(self.rows['accepted'].sum())} of {len(self.rows)} readings")
        return self.rows.loc[~self.rows["accepted"], "reject_reasons"].value_counts()

    def step05_occupations(self):
        """Group the accepted readings into station occupations (mean, sigma, flags)."""
        self.occ = inventory.build_occupations(self.rows)
        self._log(f"[5] {len(self.occ)} occupations, {int(self.occ['usable'].sum())} usable")
        return self.occ

    def step06_gnss_positioning(self):
        """Parse the GNSS files, check the daily datum, map days and match every occupation."""
        P, _, self.master_check, zip_list = positioning.load_gnss(self.raw_dir)
        self._save(zip_list, "01b_results_zip_members.csv")
        self.datum_marks, self.datum_days, self.ref = positioning.gnss_datum_check(P)
        day_map_tab, self.day_of_date = positioning.map_days(self.occ, P)
        self._save(day_map_tab, "08_gnss_day_mapping.csv")
        self._save(self.datum_marks, "09_gnss_base_marks_by_day.csv")
        self._save(self.datum_days, "09_gnss_day_datum.csv")
        self.occ = positioning.match_occupations(self.occ, P, self.day_of_date, self.datum_days, self.ref)
        # reference height of base 100: median of the daily solutions after the day adjustment
        b = self.datum_marks[self.datum_marks["mark"] == "base_100"].merge(
            self.datum_days[["gnss_day", "day_height_shift_m"]], on="gnss_day")
        h = b["h_gnss"] - b["day_height_shift_m"]
        self.ref["base_100"]["h_used"] = float(h.median())
        self.ref["base_100"]["h_used_sd"] = float(h.std(ddof=1))
        P["date"] = P["gnss_day"].map({v: k for k, v in self.day_of_date.items()})
        self.gnss = P
        status = self.occ.groupby(["instrument", "match_status"]).size().rename("n").reset_index()
        self._log(f"[6] {len(P)} GNSS points; occupations matched: "
                  f"{int(self.occ['match_status'].isin(settings.MATCH_OK).sum())}")
        return status

    def step07_heights_and_dem(self):
        """Fetch/cache the Copernicus DEM and EGM2008; H = h - N; compare with the DEM."""
        dem_path = geodata.fetch_dem(settings.DEM_BOUNDS, os.path.join(self.external_dir, settings.DEM_FILE))
        geo_path = geodata.fetch_geoid(settings.DEM_BOUNDS, os.path.join(self.external_dir, settings.GEOID_FILE))
        self.dem, self.geoid = geodata.Grid(dem_path), geodata.Grid(geo_path)
        self.occ = positioning.add_orthometric(self.occ, self.ref, self.geoid, self.dem)
        f = self.occ[(self.occ["role"] == "field") & self.occ["match_status"].isin(settings.MATCH_OK)]
        by_day = f.groupby("gnss_day")
        h = by_day.agg(n=("H_minus_dem_m", "size"),
                       median_H_minus_dem=("H_minus_dem_m", "median"),
                       mad_H_minus_dem=("H_minus_dem_m", lambda v: (v - v.median()).abs().median()),
                       day_shift_applied=("day_height_shift_m", "first")).reset_index()
        h.insert(2, "median_h_ellip_minus_dem", [np.median(g["h_gnss_original"] - g["H_dem_m"]) for _, g in by_day])
        h["median_N_egm2008"] = [g["N_egm2008_m"].median() for _, g in by_day]
        h["median_H_minus_dem_without_day_shift"] = h["median_H_minus_dem"] + h["day_shift_applied"]
        self.height_check = h
        self._save(h, "21_height_datum_dem_check.csv")
        self.summary["height_datum"] = dict(
            median_h_ellipsoidal_minus_dem=float(np.median(f["h_gnss_original"] - f["H_dem_m"])),
            median_N_egm2008=float(f["N_egm2008_m"].median()),
            N_range=[float(f["N_egm2008_m"].min()), float(f["N_egm2008_m"].max())],
            median_H_minus_dem=float(f["H_minus_dem_m"].median()),
            mad_H_minus_dem=float((f["H_minus_dem_m"] - f["H_minus_dem_m"].median()).abs().median()))
        self._save(self.gnss.drop(columns=["lat_text", "lon_text"], errors="ignore"), "07_gnss_points_all.csv")
        self._log("[7] median H - DEM = {median_H_minus_dem:+.2f} m".format(**self.summary["height_datum"]))
        return h

    def step08_base_control(self):
        """Base-100 controls, drift model with leave-one-out uncertainty, daily closures."""
        (self.occ, self.ctrl, self.ties, self.tie_stats, self.loo, self.seg_rates, self.model_sigma,
         self.rate_sigma) = base_control.base_control(self.occ, self.ref)
        self.closures = base_control.day_closures(self.occ)
        self._save(self.ctrl, "10_control_points.csv")
        self._save(self.ties, "11_hotel_base100_ties.csv")
        self._save(self.loo, "12_base100_leave_one_out_misclosure.csv")
        self._save(self.seg_rates, "12_base100_segment_rates.csv")
        self._save(self.closures, "13_daily_closures.csv")
        self._log(f"[8] drift-model sigma per instrument [mGal]: {self.model_sigma}")
        return self.closures

    def step09_instrument_reconciliation(self):
        """Scale factor of #0313 from ties and co-located points; re-tie extrapolated segments."""
        self.pairs = instruments.colocated_pairs(self.occ)
        self._save(self.pairs, "14_colocated_pairs.csv")
        sc = instruments.scale_estimates(self.tie_stats, self.pairs)
        self.k_apply = None
        if "k_colocated_origin" in sc:
            z = (sc["k_colocated_origin"] - sc["k_tie"]) / np.hypot(sc["k_colocated_origin_se"], sc["k_tie_se"])
            sc["agreement_z"] = z
            if abs(z) < 2:      # the two estimates agree: inverse-variance weighted mean
                w1, w2 = 1 / sc["k_tie_se"] ** 2, 1 / sc["k_colocated_origin_se"] ** 2
                self.k_apply = (w1 * sc["k_tie"] + w2 * sc["k_colocated_origin"]) / (w1 + w2)
                sc["k_applied"] = self.k_apply
                sc["k_applied_se"] = 1 / np.sqrt(w1 + w2)
        self.scale = sc
        self.summary["scale"] = sc
        self.retie = pd.DataFrame()
        if self.k_apply is not None:
            self.occ, self.retie = instruments.retie_extrapolated(self.occ, self.pairs, self.k_apply)
        self._save(self.retie, "14_extrapolated_segment_reties.csv")
        self.summary["retie"] = self.retie.to_dict("records")
        self._log(f"[9] scale factor applied to CG-6 #0313: k = {self.k_apply}")
        return pd.Series(sc)

    def step10_reductions(self):
        """Free-air and simple Bouguer anomalies relative to base 100 for all densities."""
        self.st = reductions.reductions(self.occ, self.ref, k_apply=self.k_apply)
        self._log(f"[10] {int(self.st['product_ok'].sum())} stations with complete products")
        return self.st

    def step11_terrain_correction(self):
        """DEM topographic effect (Harmonica prisms to 22 km) and complete Bouguer anomalies."""
        t0 = time.time()
        self.topo = terrain.TopoModel(self.dem)
        self.st = reductions.terrain_stage(self.st, self.ref, self.topo, progress=self.verbose)
        self.terrain_check = reductions.terrain_validation(self.topo, self.st)
        self._save(self.terrain_check, "22_terrain_validation.csv")
        # row, occupation and station tables are final from here on
        rows = self.rows.merge(self.occ[["occ_id", "occ_key", "role", "match_status", "gnss_uid", "match_dist_m"]],
                               on="occ_id", how="left")
        self._save(rows.drop(columns=["t"], errors="ignore"), "05_rows_qc.csv")
        self._save(self.occ, "15_occupations.csv")
        self._save(self.st, "16_field_stations_relative.csv")
        self._log(f"[11] terrain correction done in {time.time() - t0:.0f} s")
        return self.terrain_check

    def step12_density_nettleton(self):
        """Nettleton density per profile, moving windows and the consensus value."""
        self.prof, self.prof_summary = density.build_profiles(self.st)
        self.sweeps, self.net = density.run_nettleton(self.prof, self.prof_summary)
        self.win = density.window_nettleton(self.prof)
        self.day_boundary = density.day_boundary_check(self.prof, self.datum_days)
        self.consensus = density.density_consensus(self.net, self.win)
        for df, name in ((self.prof, "17_profiles_stations.csv"), (self.prof_summary, "17_profiles_summary.csv"),
                         (self.sweeps, "18_nettleton_sweeps.csv"), (self.net, "18_nettleton_results.csv"),
                         (self.win, "19_nettleton_windows.csv"), (self.day_boundary, "20_day_boundary_height_check.csv"),
                         (self.consensus, "23_density_consensus.csv")):
            self._save(df, name)
        self._log(f"[12] {len(self.prof_summary)} profiles, {len(self.win)} windows")
        return self.consensus

    def step13_summary_and_export(self):
        """summary.json and the deliverables: Excel workbook, final CSV, GeoJSON, KML."""
        r, o = self.rows, self.occ
        self.summary.update(dict(
            rows=int(len(r)), rows_accepted=int(r["accepted"].sum()),
            rows_rejected_by_reason=r.loc[~r["accepted"], "reject_reasons"].value_counts().to_dict(),
            occupations=int(len(o)), occupations_usable=int(o["usable"].sum()),
            match_status=o.groupby(["instrument", "match_status"]).size().rename("n").reset_index().to_dict("records"),
            day_of_date=self.day_of_date, master_check=self.master_check, ref=self.ref, tie_stats=self.tie_stats,
            model_sigma=self.model_sigma, rate_sigma=self.rate_sigma, products=int(self.st["product_ok"].sum())))
        with open(os.path.join(self.out_dir, "summary.json"), "w") as fh:
            json.dump(self.summary, fh, indent=2, default=_json_default)
        ctx = dict(st=self.st, prof=self.prof, net=self.net, sweeps=self.sweeps, win=self.win, cons=self.consensus,
                   ctrl=self.ctrl, ties=self.ties, closures=self.closures, sc=self.scale, pairs=self.pairs,
                   hchk=self.height_check, tval=self.terrain_check, occ=self.occ, df=self.rows, meta=self.meta)
        d = self.deliverable_dir
        self.final = export.write_workbook(os.path.join(d, "Wadi_Ghadir_Gravity_Results.xlsx"), ctx)
        self.final.to_csv(os.path.join(d, "Wadi_Ghadir_Final_Stations.csv"), index=False, float_format="%.6f")
        export.write_geojson(os.path.join(d, "Wadi_Ghadir_Final_Stations.geojson"), self.final)
        export.write_kml(os.path.join(d, "Wadi_Ghadir_Final_Stations.kml"), self.final)
        self._log(f"[13] deliverables written to {d}")
        return self.final

    def step14_figures_and_maps(self):
        """QC figures (fig01-09), maps and grids (map01-11), Nettleton sheets."""
        ctx = dict(df=self.rows, occ=self.occ, st=self.st, P=self.gnss, ctrl=self.ctrl, ties=self.ties, loo=self.loo,
                   closures=self.closures, pairs=self.pairs, sc=self.scale, retie=self.retie, win=self.win,
                   dbc=self.day_boundary, datum_days=self.datum_days, closures_tab=self.closures, prof=self.prof,
                   prof_sum=self.prof_summary, sweeps=self.sweeps, net=self.net, datum_marks=self.datum_marks,
                   ref=self.ref, tide=self.tide_check, cons=self.consensus, hchk=self.height_check,
                   tval=self.terrain_check, dem=self.dem, geoid=self.geoid, model=self.topo)
        self.gridding_cv = figures.make_all(ctx, self.figure_dir)
        self._log(f"[14] figures in {self.out_dir}/figures, maps, nettleton; grids in {self.out_dir}/grids")
        return self.gridding_cv

    # ------------------------------------------------------------------ all steps
    STEPS = ("step01_inventory", "step02_verify_onboard_corrections", "step03_recompute_tide", "step04_row_qc",
             "step05_occupations", "step06_gnss_positioning", "step07_heights_and_dem", "step08_base_control",
             "step09_instrument_reconciliation", "step10_reductions", "step11_terrain_correction",
             "step12_density_nettleton", "step13_summary_and_export", "step14_figures_and_maps")

    def run_all(self, make_figures=True):
        """Run steps 1-14 in order (step 14 only if make_figures=True)."""
        for name in self.STEPS:
            if name == "step14_figures_and_maps" and not make_figures:
                continue
            getattr(self, name)()
        return self
