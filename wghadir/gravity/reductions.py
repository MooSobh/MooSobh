"""Steps 10-11 of the gravity chain: gravity reductions and terrain correction.

10 base-relative free-air and simple Bouguer quantities (WGS84 normal gravity,
   second-order free-air term, infinite slab for 11 densities)
11 DEM topographic effect by Harmonica prisms (see terrain.py) and the complete
   Bouguer anomaly for the same densities; zoning-sensitivity test

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import numpy as np
import pandas as pd

from . import reduce, terrain
from .settings import MATCH_OK, RHO_LIST


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
