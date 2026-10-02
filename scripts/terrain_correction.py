#!/usr/bin/env python3
"""Topographic (complete Bouguer) correction with Fatiando a Terra Harmonica.

NOT run by the main chain: no DEM was supplied with the survey.  Run it once a
DEM is available whose vertical datum matches the station heights.

The DEM is converted into a layer of right-rectangular prisms (top = DEM
height, bottom = 0 m of the height datum; negative heights give negative
thickness) with constant density rho.  Its vertical attraction g_topo is computed
at each station (station height + sensor offset) and at base 100.  The
base-relative complete Bouguer quantity is

    dCB(rho) = dFA_rel - [g_topo(station) - g_topo(base100)]

and, for reporting, the classical terrain correction is TC = 0.04193*rho*h - g_topo.

Requirements on the DEM (see report section 5.4):
  * extends at least 22 km (Hayford zone O; 167 km for full zones) beyond the stations,
  * cell size <= ~30 m near stations (SRTM/Copernicus GLO-30 or better),
  * same vertical datum as the station heights (or converted with a geoid model).

Example:
    python scripts/terrain_correction.py --dem dem.nc --stations outputs/tables/16_field_stations_relative.csv \\
        --density 2.67 --out outputs/tables/21_terrain_corrected.csv
    python scripts/terrain_correction.py --selftest
"""
import argparse
import sys

import numpy as np
import pandas as pd

R_EARTH = 6371008.8


def to_local_xy(lon, lat, lon0, lat0):
    """Equirectangular projection about (lon0, lat0) [m].  Scale error < 0.1 % within ~60 km."""
    x = np.radians(np.asarray(lon) - lon0) * R_EARTH * np.cos(np.radians(lat0))
    y = np.radians(np.asarray(lat) - lat0) * R_EARTH
    return x, y


def topo_effect(dem_lon, dem_lat, dem_h, st_lon, st_lat, st_h, rho_gcc, lon0, lat0, sensor_offset_m=0.2):
    """Vertical gravity [mGal] of the DEM prism layer at the stations."""
    import harmonica as hm
    import verde as vd  # noqa: F401  (harmonica dependency, imported for clarity)
    import xarray as xr

    LON, LAT = np.meshgrid(dem_lon, dem_lat)
    X, Y = to_local_xy(LON, LAT, lon0, lat0)
    # on a small area the projected grid is regular to within the scale error above
    easting = X[0, :]
    northing = Y[:, 0]
    surface = xr.DataArray(dem_h, coords={"northing": northing, "easting": easting}, dims=("northing", "easting"))
    density = np.where(surface.values >= 0, rho_gcc * 1000.0, -rho_gcc * 1000.0)
    layer = hm.prism_layer((easting, northing), surface=surface, reference=0.0,
                           properties={"density": density})
    sx, sy = to_local_xy(st_lon, st_lat, lon0, lat0)
    return layer.prism_layer.gravity((sx, sy, np.asarray(st_h) + sensor_offset_m), field="g_z")


def selftest():
    """Flat DEM of height h: g_topo must approach the infinite-slab value 0.04193*rho*h."""
    rho, h = 2.67, 300.0
    lat0, lon0 = 24.78, 34.87
    lon = np.linspace(lon0 - 1.2, lon0 + 1.2, 481)
    lat = np.linspace(lat0 - 1.1, lat0 + 1.1, 441)
    dem = np.full((lat.size, lon.size), h)
    g = topo_effect(lon, lat, dem, [lon0], [lat0], [h], rho, lon0, lat0, sensor_offset_m=0.0)
    slab = 0.04193 * rho * h
    print(f"flat-DEM test: prism layer {g[0]:.3f} mGal, infinite slab {slab:.3f} mGal, ratio {g[0] / slab:.4f}")
    ok = abs(g[0] / slab - 1) < 0.01
    print("PASS" if ok else "FAIL")
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dem", help="NetCDF grid with variables lon/lat (degrees) and elevation (m)")
    ap.add_argument("--dem-var", default=None, help="name of the elevation variable (default: first data variable)")
    ap.add_argument("--stations", default="outputs/tables/16_field_stations_relative.csv")
    ap.add_argument("--density", type=float, default=2.67)
    ap.add_argument("--base-lon", type=float, default=34.9337552)
    ap.add_argument("--base-lat", type=float, default=24.7867488)
    ap.add_argument("--base-h", type=float, default=111.77)
    ap.add_argument("--out", default="outputs/tables/21_terrain_corrected.csv")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(0 if selftest() else 1)
    if not a.dem:
        ap.error("--dem is required (or use --selftest)")
    import xarray as xr

    ds = xr.open_dataset(a.dem)
    var = a.dem_var or list(ds.data_vars)[0]
    da = ds[var]
    lon_name = [c for c in da.dims if c.lower().startswith(("lon", "x"))][0]
    lat_name = [c for c in da.dims if c.lower().startswith(("lat", "y"))][0]
    da = da.sortby(lat_name).sortby(lon_name)
    st = pd.read_csv(a.stations)
    st = st[st["product_ok"]].copy()
    lon0, lat0 = a.base_lon, a.base_lat
    pad_km = min(abs(float(da[lon_name].min()) - st["lon"].min()), abs(float(da[lon_name].max()) - st["lon"].max())) * 111 * np.cos(np.radians(lat0))
    print(f"DEM extends at least {pad_km:.1f} km (E-W) beyond the stations")
    g_st = topo_effect(da[lon_name].values, da[lat_name].values, da.values, st["lon"], st["lat"], st["h_used"],
                       a.density, lon0, lat0)
    g_b = topo_effect(da[lon_name].values, da[lat_name].values, da.values, [lon0], [lat0], [a.base_h],
                      a.density, lon0, lat0)[0]
    st[f"g_topo_rho{a.density:.2f}_mgal"] = g_st
    st[f"TC_rho{a.density:.2f}_mgal"] = 0.04193 * a.density * st["h_used"] - g_st
    st[f"dCB_rel_rho{a.density:.2f}_mgal"] = st["dFA_rel_mgal"] - (g_st - g_b)
    st.to_csv(a.out, index=False, float_format="%.6g")
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
