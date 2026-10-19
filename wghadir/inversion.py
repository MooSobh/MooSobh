"""SimPEG gravity, magnetic and joint inversion of the Wadi Ghadir data: shared helpers.

Used by notebooks 06 (gravity), 07 (magnetics) and 08 (joint inversion). Everything that the
three notebooks share lives here, so that the separate and the joint inversions use exactly
the same data preparation, mesh, topography and plotting:

* data: complete Bouguer stations (table 16) and accepted magnetic readings (table 30),
  regional removal, block-median thinning and uncertainties;
* the 3-D tensor mesh over the survey, active cells below the Copernicus GLO-30 topography;
* an iteration log directive, model slices and sections, UBC export.

Coordinates are UTM 36N (EPSG:32636) metres; elevations are orthometric (EGM2008) metres.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import json
import os

import numpy as np
import pandas as pd

AUTHOR = "Mohamed Sobh, LIAG"
CRS = "EPSG:32636"


def _transformer(inverse=False):
    import pyproj
    a, b = ("EPSG:4326", CRS) if not inverse else (CRS, "EPSG:4326")
    return pyproj.Transformer.from_crs(a, b, always_xy=True)


def to_utm(lon, lat):
    """Longitude/latitude [deg] -> UTM 36N easting/northing [m]."""
    return _transformer().transform(np.asarray(lon), np.asarray(lat))


def to_lonlat(e, n):
    """UTM 36N easting/northing [m] -> longitude/latitude [deg]."""
    return _transformer(inverse=True).transform(np.asarray(e), np.asarray(n))


# -----------------------------------------------------------------------------
# Data
def load_gravity(repo, rho=2.67, sensor_m=0.25):
    """Complete Bouguer anomalies of the field stations (relative to base 100), one row per station.

    Columns: e, n, z (sensor elevation = H + sensor_m), cb (mGal), sigma (mGal, propagated)."""
    st = pd.read_csv(os.path.join(repo, "outputs", "tables", "16_field_stations_relative.csv"))
    st = st[st["product_ok"]].drop_duplicates("occ_key")
    e, n = to_utm(st["lon"].values, st["lat"].values)
    col = f"dCB_rel_rho{rho:.2f}_mgal"
    out = pd.DataFrame({"e": e, "n": n, "z": st["H_ortho_m"].values + sensor_m, "cb": st[col].values,
                        "sigma": st["dSB267_sigma_mgal"].values, "lon": st["lon"].values, "lat": st["lat"].values})
    return out[np.isfinite(out["cb"])].reset_index(drop=True)


def load_magnetics(repo, sensor_m=2.0):
    """Accepted total-field anomaly readings (TMA = TMI - IGRF-14) and the inducing field.

    Returns (DataFrame with e, n, z, tma [nT]; dict F, I, D)."""
    t = pd.read_csv(os.path.join(repo, "outputs", "tables", "30_mag_readings_qc.csv"))
    a = t[t["accepted"]]
    elev = a["elev_file"].fillna(a["elev_file"].median()).values
    df = pd.DataFrame({"e": a["utm_e"].values, "n": a["utm_n"].values, "z": elev + sensor_m, "tma": a["tma_nT"].values,
                       "lon": a["lon"].values, "lat": a["lat"].values})
    s = json.load(open(os.path.join(repo, "outputs", "magnetics_summary.json")))
    field = {"F": float(a["igrf_F_nT"].median()), "I": float(s["inc"]), "D": float(s["dec"])}
    return df.reset_index(drop=True), field


def regional_from_grid(repo, e, n):
    """The regional field of notebook 03 (complete Bouguer grid upward-continued by 3 km), at the points (e, n)."""
    import xarray as xr
    g = xr.open_dataset(os.path.join(repo, "outputs", "open_source", "Wadi_Ghadir_OpenSource_Grids.nc"))
    reg = g["regional"].interp(easting=xr.DataArray(e, dims="p"), northing=xr.DataArray(n, dims="p")).values
    if np.isnan(reg).any():                                   # outside the grid: nearest value
        near = g["regional"].sel(easting=xr.DataArray(e, dims="p"), northing=xr.DataArray(n, dims="p"), method="nearest").values
        reg = np.where(np.isnan(reg), near, reg)
    return reg


def polynomial_trend(e, n, v, degree=1):
    """Least-squares polynomial surface of the given degree through (e, n, v), evaluated at the points."""
    x, y = (e - e.mean()) / 1e4, (n - n.mean()) / 1e4
    cols = [x ** i * y ** j for i in range(degree + 1) for j in range(degree + 1 - i)]
    A = np.column_stack(cols)
    c = np.linalg.lstsq(A, v, rcond=None)[0]
    return A @ c


def block_median(df, cols, spacing):
    """One median per square block of `spacing` metres (coordinates and values); adds the count n_block."""
    bx = np.floor((df["e"] - df["e"].min()) / spacing).astype(int)
    by = np.floor((df["n"] - df["n"].min()) / spacing).astype(int)
    g = df.assign(_bx=bx, _by=by).groupby(["_bx", "_by"])
    out = g[["e", "n", "z"] + list(cols)].median()
    out["n_block"] = g.size()
    return out.reset_index(drop=True)


# -----------------------------------------------------------------------------
# Mesh and topography
def survey_region(*frames, pad_m=1000.0):
    """Bounding box (west, east, south, north) of all data frames, padded."""
    e = np.concatenate([f["e"].values for f in frames])
    n = np.concatenate([f["n"].values for f in frames])
    return (e.min() - pad_m, e.max() + pad_m, n.min() - pad_m, n.max() + pad_m)


def topography(repo, region, spacing=200.0, pad_m=8000.0):
    """Copernicus GLO-30 elevations on a regular UTM grid covering the region (+ pad); (N, 3) array e, n, z."""
    from .common import geodata
    dem = geodata.Grid(os.path.join(repo, "data", "external", "copernicus_glo30_wadi_ghadir.tif"))
    w, ea, s, no = region
    E, N = np.meshgrid(np.arange(w - pad_m, ea + pad_m + 1, spacing), np.arange(s - pad_m, no + pad_m + 1, spacing))
    lon, lat = to_lonlat(E.ravel(), N.ravel())
    z = dem.sample(lon, lat)
    z = np.where(np.isfinite(z), z, 0.0)
    return np.column_stack([E.ravel(), N.ravel(), z])


def build_mesh(region, dx=400.0, dz=100.0, n_core_z=20, n_pad_xy=5, n_pad_z=8, expansion=1.3, z_top=None):
    """Tensor mesh: core cells dx x dx x dz over the region, padding expanding by `expansion` to the sides and below.

    The top of the mesh is at z_top (default: rounded up above the highest data point is the caller's job)."""
    import discretize
    w, e, s, n = region
    ncx, ncy = int(np.ceil((e - w) / dx)), int(np.ceil((n - s) / dx))
    hx = [(dx, n_pad_xy, -expansion), (dx, ncx), (dx, n_pad_xy, expansion)]
    hy = [(dx, n_pad_xy, -expansion), (dx, ncy), (dx, n_pad_xy, expansion)]
    hz = [(dz, n_pad_z, -expansion), (dz, n_core_z)]
    mesh = discretize.TensorMesh([hx, hy, hz], origin="CCN")
    pad_x = sum(dx * expansion ** (i + 1) for i in range(n_pad_xy))
    mesh.origin = np.array([w - pad_x, s - pad_x, (z_top if z_top is not None else 0.0) - mesh.h[2].sum()])
    return mesh


def active_cells(mesh, topo_xyz):
    """Cells below the topography."""
    from discretize.utils import active_from_xyz
    return active_from_xyz(mesh, topo_xyz)


# -----------------------------------------------------------------------------
# Inversion bookkeeping
def iteration_log():
    """A SimPEG directive that records beta, phi_d, phi_m and the model norm at the end of every iteration."""
    from simpeg import directives

    class IterationLog(directives.InversionDirective):
        def initialize(self):
            self.rows = []

        def endIter(self):
            ip = self.invProb
            self.rows.append({"iteration": self.opt.iter, "beta": float(np.atleast_1d(ip.beta)[0]),
                              "phi_d": float(ip.phi_d), "phi_m": float(ip.phi_m)})

        @property
        def table(self):
            return pd.DataFrame(self.rows)

    return IterationLog()


def model_on_mesh(mesh, active, values, fill=np.nan):
    """Values of the active cells -> full mesh array (fill above the topography)."""
    out = np.full(mesh.n_cells, fill)
    out[active] = values
    return out


def depth_slice(mesh, full, depth_m, surface_z):
    """Horizontal slice of a full-mesh model at a depth below the given surface elevation; (x, y, 2-D array)."""
    v = full.reshape(mesh.shape_cells, order="F")
    k = int(np.argmin(np.abs(mesh.cell_centers_z - (surface_z - depth_m))))
    return mesh.cell_centers_x, mesh.cell_centers_y, v[:, :, k].T, mesh.cell_centers_z[k]


def section(mesh, full, a, b, step=100.0, zmin=None):
    """Vertical section of a full-mesh model from a=(e, n) to b=(e, n); (distance, z, 2-D array [z, distance])."""
    from scipy.interpolate import RegularGridInterpolator
    v = full.reshape(mesh.shape_cells, order="F")
    f = RegularGridInterpolator((mesh.cell_centers_x, mesh.cell_centers_y, mesh.cell_centers_z), v,
                                method="nearest", bounds_error=False, fill_value=np.nan)
    L = np.hypot(b[0] - a[0], b[1] - a[1])
    d = np.arange(0, L + 1e-6, step)
    zc = mesh.cell_centers_z
    if zmin is not None:
        zc = zc[zc >= zmin]
    D, Z = np.meshgrid(d, zc)
    pts = np.column_stack([a[0] + D.ravel() / L * (b[0] - a[0]), a[1] + D.ravel() / L * (b[1] - a[1]), Z.ravel()])
    return d, zc, f(pts).reshape(D.shape)


def save_ubc(mesh, models, folder, stem):
    """Write the mesh and the models (dict name -> full-mesh array) in UBC-GIF format (readable by many 3-D viewers)."""
    os.makedirs(folder, exist_ok=True)
    mesh.write_UBC(f"{stem}_mesh.msh", directory=folder)
    for name, m in models.items():
        mesh.write_model_UBC(f"{stem}_{name}.mod", np.where(np.isfinite(m), m, -100.0), directory=folder)
    return sorted(f for f in os.listdir(folder) if f.startswith(stem))


def cross_gradient(mesh, active, a, b, core=None, strong=0.9):
    """Structural similarity of two models on the same mesh (active-cell values a, b).

    Returns (t, s): t is the normalised cross-gradient |∇a × ∇b| / (|∇a| |∇b|) of every cell (0 where the gradients
    are parallel or antiparallel, 1 where they are perpendicular), on the full mesh, only where |∇a| |∇b| is in its top
    (1 - strong) fraction, i.e. where both models change (NaN elsewhere: the angle has no meaning where a model is flat);
    s is its gradient-weighted mean Σ|∇a × ∇b|² / Σ|∇a|²|∇b|² over the active core cells (0 = identical structure).
    Gradients are taken in metres with central differences of the cell values."""
    def grads(v):
        full = model_on_mesh(mesh, active, v, np.nan).reshape(mesh.shape_cells, order="F")
        full = np.where(np.isnan(full), np.nanmean(full), full)
        return np.gradient(full, mesh.cell_centers_x, mesh.cell_centers_y, mesh.cell_centers_z)
    ga, gb = grads(a), grads(b)
    cx = ga[1] * gb[2] - ga[2] * gb[1]
    cy = ga[2] * gb[0] - ga[0] * gb[2]
    cz = ga[0] * gb[1] - ga[1] * gb[0]
    num = cx ** 2 + cy ** 2 + cz ** 2
    na2, nb2 = sum(g ** 2 for g in ga), sum(g ** 2 for g in gb)
    den = na2 * nb2
    act3 = active.reshape(mesh.shape_cells, order="F")
    keep = act3.copy()
    if core is not None:
        w, e, s, n = core
        X, Y = np.meshgrid(mesh.cell_centers_x, mesh.cell_centers_y, indexing="ij")
        keep &= ((X >= w) & (X <= e) & (Y >= s) & (Y <= n))[:, :, None]
    thr = max(np.nanpercentile(den[keep], 100 * strong), 1e-300)
    t = np.where(keep & (den > thr), np.sqrt(num / np.maximum(den, thr)), np.nan)
    s = float(num[keep].sum() / den[keep].sum())
    return t.reshape(-1, order="F"), s


def joint_iteration_log():
    """A directive for the joint inversion: beta and misfit of each data set and the cross-gradient term per iteration."""
    from simpeg import directives

    class JointLog(directives.InversionDirective):
        def initialize(self):
            self.rows = []

        def endIter(self):
            ip = self.invProb
            phi = list(getattr(ip, "phi_d_list", [np.nan, np.nan]))
            betas = list(np.atleast_1d(getattr(ip, "betas", [np.nan, np.nan])))
            cg = ip.reg.objfcts[-1](ip.model)
            self.rows.append({"iteration": self.opt.iter, "beta_1": float(betas[0]), "beta_2": float(betas[-1]),
                              "phi_d_1": float(phi[0]), "phi_d_2": float(phi[-1]), "cross_gradient": float(cg)})

        @property
        def table(self):
            return pd.DataFrame(self.rows)

    return JointLog()


def far_from_data(x, y, e, n, max_m):
    """Boolean grid (len(y), len(x)): True where the nearest data point (e, n) is farther than max_m."""
    from scipy.spatial import cKDTree
    X, Y = np.meshgrid(x, y)
    d, _ = cKDTree(np.column_stack([e, n])).query(np.column_stack([X.ravel(), Y.ravel()]))
    return (d > max_m).reshape(X.shape)


def stop_at_targets(chifact=1.0):
    """A directive for joint inversions: stop as soon as every data misfit is at or below chifact × its number of data."""
    from simpeg import directives

    class StopAtTargets(directives.InversionDirective):
        def endIter(self):
            phi = getattr(self.invProb, "phi_d_list", None)
            if phi is None:
                return
            targets = [chifact * dm.simulation.survey.nD for dm in self.dmisfit.objfcts]
            if all(p <= t for p, t in zip(phi, targets)):
                self.opt.stopNextIteration = True

    return StopAtTargets()
