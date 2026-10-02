"""Topographic effect of the DEM at the gravity stations (Harmonica prisms).

For each station the DEM is turned into right-rectangular prisms in a local
Cartesian frame centred on the station:

* inner zone: the 1" (~30 m) DEM cells inside a square of +/- INNER_COARSE
  coarse cells (about +/- 2 km) around the station;
* outer zone: the DEM block-averaged to COARSE x COARSE cells (~250 m),
  outside the inner square and within OUTER_RADIUS_M of the station.

Every prism extends from the geoid (0 m, EGM2008) to the DEM height; both are
lowered by the Earth-curvature drop d^2 / (2R) at horizontal distance d, so the
result includes the curvature (Bullard B) effect.  DEM cells within
FLATTEN_RADIUS_M of the station are set to the station height, removing the
mismatch between a 30 m DEM and a point on a wadi floor.  Cells below 0 m
(sea, filled with 0 m) carry no mass: Red Sea water and bathymetry are NOT
modelled.

The result g1 is the vertical attraction for a density of 1 g/cm3, in mGal; for
density rho the topographic effect is rho * g1 (linear in rho).
"""
import numpy as np

R_EARTH = 6371008.8
COARSE = 8                 # coarse cell = 8 x 8 DEM cells (~240 m x 250 m)
INNER_COARSE = 8           # inner zone = +/- 8 coarse cells (~ +/- 2 km)
OUTER_RADIUS_M = 22000.0   # Hayford zone O outer radius (21.9 km)
FLATTEN_RADIUS_M = 50.0
SENSOR_OFFSET_M = 0.2      # CG-6 sensor above the GNSS-measured point (assumed, not recorded)


class TopoModel:
    def __init__(self, grid, coarse=COARSE):
        self.g = grid
        self.coarse = coarse
        ny = (grid.z.shape[0] // coarse) * coarse
        nx = (grid.z.shape[1] // coarse) * coarse
        self.zf = grid.z[:ny, :nx]
        self.lonf = grid.lon[:nx]
        self.latf = grid.lat[:ny]
        zc = self.zf.reshape(ny // coarse, coarse, nx // coarse, coarse).mean(axis=(1, 3))
        self.zc = zc
        self.lonc = self.lonf.reshape(-1, coarse).mean(axis=1)
        self.latc = self.latf.reshape(-1, coarse).mean(axis=1)
        self.dlon = grid.dx
        self.dlat = grid.dy

    def _prisms(self, lon, lat, z, dlon, dlat, lon0, lat0, top_override=None):
        """Prism array (west, east, south, north, bottom, top) in the station frame."""
        kx = np.radians(1.0) * R_EARTH * np.cos(np.radians(lat0))
        ky = np.radians(1.0) * R_EARTH
        LON, LAT = np.meshgrid(lon, lat)
        x = (LON - lon0) * kx
        y = (LAT - lat0) * ky
        hx, hy = 0.5 * dlon * kx, 0.5 * dlat * ky
        d2 = x ** 2 + y ** 2
        drop = d2 / (2 * R_EARTH)
        top = np.maximum(z, 0.0)
        if top_override is not None:
            m, v = top_override
            top = np.where(m(d2), v, top)
        pr = np.column_stack([(x - hx).ravel(), (x + hx).ravel(), (y - hy).ravel(), (y + hy).ravel(),
                              (-drop).ravel(), (top - drop).ravel()])
        keep = pr[:, 5] > pr[:, 4]
        return pr[keep], d2.ravel()[keep]

    def unit_effect(self, lon0, lat0, H0, outer_radius=OUTER_RADIUS_M, inner_coarse=INNER_COARSE):
        import harmonica as hm

        c = self.coarse
        ic = int(np.argmin(np.abs(self.latc - lat0)))
        jc = int(np.argmin(np.abs(self.lonc - lon0)))
        i0, i1 = max(ic - inner_coarse, 0), min(ic + inner_coarse + 1, self.zc.shape[0])
        j0, j1 = max(jc - inner_coarse, 0), min(jc + inner_coarse + 1, self.zc.shape[1])
        # inner zone, 1" cells
        zf = self.zf[i0 * c:i1 * c, j0 * c:j1 * c]
        flat = (lambda d2: d2 <= FLATTEN_RADIUS_M ** 2, H0)
        pin, _ = self._prisms(self.lonf[j0 * c:j1 * c], self.latf[i0 * c:i1 * c], zf, self.dlon, self.dlat,
                              lon0, lat0, top_override=flat)
        # outer zone, coarse cells outside the inner square and inside the radius
        zc = self.zc.copy()
        zc[i0:i1, j0:j1] = -1.0  # removed (no mass)
        pout, d2 = self._prisms(self.lonc, self.latc, zc, self.dlon * c, self.dlat * c, lon0, lat0)
        pout = pout[d2 <= outer_radius ** 2]
        prisms = np.vstack([pin, pout])
        g = hm.prism_gravity((np.array([0.0]), np.array([0.0]), np.array([H0 + SENSOR_OFFSET_M])), prisms,
                             np.full(len(prisms), 1000.0), field="g_z")
        return float(g[0]), len(pin), len(pout)

    def coverage_ok(self, lon0, lat0, outer_radius=OUTER_RADIUS_M):
        kx = np.radians(1.0) * R_EARTH * np.cos(np.radians(lat0))
        ky = np.radians(1.0) * R_EARTH
        return (min(lon0 - self.lonf[0], self.lonf[-1] - lon0) * kx >= outer_radius
                and min(lat0 - self.latf[-1], self.latf[0] - lat0) * ky >= outer_radius)


def distance_to_sea_km(model, lon, lat):
    """Distance to the nearest coarse DEM cell at or below 0.5 m (sea), km."""
    sea = model.zc <= 0.5
    LON, LAT = np.meshgrid(model.lonc, model.latc)
    sl, sb = LON[sea], LAT[sea]
    if sl.size == 0:
        return np.full(len(lon), np.inf)
    kx = np.radians(1.0) * R_EARTH * np.cos(np.radians(np.mean(lat)))
    ky = np.radians(1.0) * R_EARTH
    out = []
    for lo, la in zip(lon, lat):
        out.append(np.sqrt(((sl - lo) * kx) ** 2 + ((sb - la) * ky) ** 2).min() / 1000)
    return np.array(out)
