"""External geodetic data: Copernicus GLO-30 DEM and the EGM2008 geoid.

Both are public datasets read over HTTP as windows of cloud-optimised GeoTIFFs
and cached under data/external/ so the processing is repeatable offline.

* Copernicus DEM GLO-30 (DSM), 1 arc-second, horizontal WGS84 (EPSG:4326),
  heights orthometric w.r.t. EGM2008 (EPSG:3855).  Licence: Copernicus DEM,
  (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018,
  provided under COPERNICUS by the European Union and ESA.  Tiles that do not
  exist (open sea) are filled with 0 m and flagged in the provenance file.
* EGM2008 2.5' geoid undulation grid from the PROJ-data repository
  (us_nga_egm08_25.tif, public domain, NGA).
"""
import json
import os

import numpy as np

COP_URL = ("/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{tile}_DEM/"
           "Copernicus_DSM_COG_10_{tile}_DEM.tif")
EGM_URL = "/vsicurl/https://raw.githubusercontent.com/OSGeo/PROJ-data/master/us_nga/us_nga_egm08_25.tif"
ARCSEC = 1.0 / 3600.0


def _tile_name(lat0, lon0):
    ns = "N" if lat0 >= 0 else "S"
    ew = "E" if lon0 >= 0 else "W"
    return f"{ns}{abs(lat0):02d}_00_{ew}{abs(lon0):03d}_00"


def fetch_dem(bounds, out_path):
    """Mosaic Copernicus GLO-30 over bounds=(west, south, east, north) on a 1" grid."""
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.windows import from_bounds

    if os.path.exists(out_path):
        return out_path
    # pixel centres on whole arc-seconds, as in the Copernicus tiles (AREA_OR_POINT=Point)
    w = round(bounds[0] * 3600) / 3600 - 0.5 * ARCSEC
    e = round(bounds[2] * 3600) / 3600 + 0.5 * ARCSEC
    s = round(bounds[1] * 3600) / 3600 - 0.5 * ARCSEC
    n = round(bounds[3] * 3600) / 3600 + 0.5 * ARCSEC
    nx = int(round((e - w) / ARCSEC))
    ny = int(round((n - s) / ARCSEC))
    dem = np.zeros((ny, nx), np.float32)
    have = np.zeros((ny, nx), bool)
    prov = {"source": "Copernicus DEM GLO-30 (DSM), EGM2008 heights", "tiles": {}}
    for lat0 in range(int(np.floor(s)), int(np.floor(n)) + 1):
        for lon0 in range(int(np.floor(w)), int(np.floor(e)) + 1):
            tile = _tile_name(lat0, lon0)
            url = COP_URL.format(tile=tile)
            try:
                src = rasterio.open(url)
            except Exception:
                prov["tiles"][tile] = "missing (open sea) - filled with 0 m"
                continue
            with src:
                tw, ts, te, tn = max(w, lon0), max(s, lat0), min(e, lon0 + 1), min(n, lat0 + 1)
                # Copernicus pixel centres sit on whole arc-seconds; read the window covering our cells
                win = from_bounds(tw, ts, te, tn, src.transform).round_offsets().round_lengths()
                a = src.read(1, window=win)
                t = src.window_transform(win)
                col0 = int(round((t.c - w) / ARCSEC))
                row0 = int(round((n - t.f) / ARCSEC))
                r0, c0 = max(row0, 0), max(col0, 0)
                r1, c1 = min(row0 + a.shape[0], ny), min(col0 + a.shape[1], nx)
                dem[r0:r1, c0:c1] = a[r0 - row0:r1 - row0, c0 - col0:c1 - col0]
                have[r0:r1, c0:c1] = True
                prov["tiles"][tile] = "read"
    dem[~np.isfinite(dem)] = 0.0
    prov["fraction_filled_with_zero"] = float(1 - have.mean())
    transform = from_origin(w, n, ARCSEC, ARCSEC)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with rasterio.open(out_path, "w", driver="GTiff", height=ny, width=nx, count=1, dtype="float32",
                       crs="EPSG:4326", transform=transform, compress="deflate", predictor=3,
                       tiled=True) as dst:
        dst.write(dem, 1)
        dst.update_tags(VERTICAL_DATUM="EGM2008 (EPSG:3855)", SOURCE="Copernicus DEM GLO-30")
    with open(out_path.replace(".tif", "_provenance.json"), "w") as fh:
        json.dump(prov, fh, indent=2)
    return out_path


def fetch_geoid(bounds, out_path, pad=0.25):
    import rasterio
    from rasterio.windows import from_bounds

    if os.path.exists(out_path):
        return out_path
    w, s, e, n = bounds
    with rasterio.open(EGM_URL) as src:
        win = from_bounds(w - pad, s - pad, e + pad, n + pad, src.transform).round_offsets().round_lengths()
        a = src.read(1, window=win)
        prof = src.profile.copy()
        prof.update(height=a.shape[0], width=a.shape[1], transform=src.window_transform(win),
                    compress="deflate", tiled=False)
        prof.pop("blockxsize", None)
        prof.pop("blockysize", None)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with rasterio.open(out_path, "w", **prof) as dst:
        dst.write(a, 1)
    return out_path


class Grid:
    """A north-up geographic raster held in memory with bilinear sampling."""

    def __init__(self, path):
        import rasterio
        with rasterio.open(path) as src:
            self.z = src.read(1).astype(float)
            t = src.transform
            self.dx, self.dy = t.a, -t.e
            # pixel-centre coordinates (AREA_OR_POINT handled by using the transform's cell centres)
            self.lon = t.c + self.dx * (np.arange(src.width) + 0.5)
            self.lat = t.f - self.dy * (np.arange(src.height) + 0.5)

    def sample(self, lon, lat):
        lon = np.asarray(lon, float)
        lat = np.asarray(lat, float)
        fx = (lon - self.lon[0]) / self.dx
        fy = (self.lat[0] - lat) / self.dy
        i0 = np.clip(np.floor(fy).astype(int), 0, self.z.shape[0] - 2)
        j0 = np.clip(np.floor(fx).astype(int), 0, self.z.shape[1] - 2)
        ty = fy - i0
        tx = fx - j0
        z = self.z
        return ((1 - ty) * (1 - tx) * z[i0, j0] + (1 - ty) * tx * z[i0, j0 + 1]
                + ty * (1 - tx) * z[i0 + 1, j0] + ty * tx * z[i0 + 1, j0 + 1])


def hillshade(z, dx_m, dy_m, azimuth=315.0, altitude=40.0, z_factor=1.0):
    gy, gx = np.gradient(z * z_factor, dy_m, dx_m)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az = np.radians(360 - azimuth + 90)
    alt = np.radians(altitude)
    hs = np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect)
    return np.clip(hs, 0, 1)
