"""Publication maps of the Wadi Ghadir gravity products.

Gridding: stations are projected to UTM zone 36N (EPSG:32636), block-median
reduced to 200 m cells and interpolated with a damped biharmonic spline
(verde.Spline) on a 100 m grid; nodes farther than MASK_KM from the nearest
station are blanked.  Grids are written next to the figures as NetCDF and XYZ
CSV so the maps can be re-made in any GIS.

Background: hillshade of the Copernicus GLO-30 DEM (illumination from NW, 40 deg).
"""
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.patheffects as pe  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, Normalize, TwoSlopeNorm  # noqa: E402
from matplotlib.ticker import FuncFormatter, MultipleLocator  # noqa: E402

from .geodata import hillshade  # noqa: E402

EXTENT = (34.705, 35.025, 24.665, 24.850)  # lon0, lon1, lat0, lat1
GRID_SPACING_M = 100.0
BLOCK_M = 200.0
MASK_KM = 2.0
DPI = 400

INK, INK2, GRID = "#1d1d1b", "#52514e", "#bdbcb6"
INST_COL = {"CG6-0640": "#2a78d6", "CG6-0313": "#eb6834"}
INST_LAB = {"CG6-0640": "CG-6 #0640", "CG6-0313": "CG-6 #0313"}
SEA = "#cfe3f3"
COAST = "#4a88c7"

ANOM = LinearSegmentedColormap.from_list("anom", [
    "#0b2f63", "#1c5cab", "#3987e5", "#86b6ef", "#d4e6f9", "#f6f5f1",
    "#fbd4c4", "#f19274", "#e05a3c", "#b52a1d", "#6e1309"], N=256)
HYPSO = LinearSegmentedColormap.from_list("hypso", [
    "#e9e4cf", "#d9cfa6", "#c8b27c", "#b48f5c", "#956b45", "#734d33", "#4f3424", "#3a2a22"], N=256)
TC_CMAP = LinearSegmentedColormap.from_list("tc", ["#fbf6ef", "#f3d6a8", "#e5a66a", "#c86d3c", "#8f3b1f", "#4e1a0c"])
UNC_CMAP = LinearSegmentedColormap.from_list("unc", ["#d9ecd2", "#8cc58a", "#3f9b5c", "#1d6b45", "#0b3d2a"])

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 8.5, "axes.titlesize": 10.5, "axes.titleweight": "bold",
    "axes.labelsize": 8.5, "axes.edgecolor": INK, "axes.linewidth": 0.8, "xtick.color": INK2,
    "ytick.color": INK2, "xtick.labelsize": 7.5, "ytick.labelsize": 7.5, "xtick.direction": "in",
    "ytick.direction": "in", "xtick.top": True, "ytick.right": True, "savefig.dpi": DPI,
    "savefig.bbox": "tight", "savefig.pad_inches": 0.08, "axes.grid": False, "legend.frameon": True,
    "legend.framealpha": 0.92, "legend.edgecolor": GRID, "legend.fontsize": 7.5,
})
HALO = [pe.withStroke(linewidth=2.2, foreground="white")]


# ----------------------------------------------------------------------------- helpers
def _deg_fmt(hemi):
    def f(v, _):
        return f"{abs(v):.2f}°{hemi}"
    return FuncFormatter(f)


class Basemap:
    def __init__(self, dem, extent=EXTENT):
        self.extent = extent
        lon0, lon1, lat0, lat1 = extent
        j = (dem.lon >= lon0) & (dem.lon <= lon1)
        i = (dem.lat >= lat0) & (dem.lat <= lat1)
        self.z = dem.z[np.ix_(i, j)]
        self.lon, self.lat = dem.lon[j], dem.lat[i]
        dx = np.radians(dem.dx) * 6371008.8 * np.cos(np.radians(np.mean(self.lat)))
        dy = np.radians(dem.dy) * 6371008.8
        self.hs = hillshade(self.z, dx, dy, z_factor=1.6)
        self.sea = self.z <= 0.5
        self.dem = dem

    def draw(self, ax, relief_alpha=0.55, tint=False, contours=False):
        lon0, lon1, lat0, lat1 = self.extent
        ext = (self.lon[0], self.lon[-1], self.lat[-1], self.lat[0])
        if tint:
            ax.imshow(np.ma.masked_where(self.sea, self.z), extent=ext, cmap=HYPSO, vmin=0, vmax=650,
                      interpolation="bilinear", zorder=0)
            ax.imshow(self.hs, extent=ext, cmap="gray", vmin=0, vmax=1, alpha=0.38, interpolation="bilinear", zorder=1)
        else:
            ax.imshow(self.hs, extent=ext, cmap="gray", vmin=-0.1, vmax=1.1, alpha=relief_alpha,
                      interpolation="bilinear", zorder=0)
        ax.imshow(np.ma.masked_where(~self.sea, np.ones_like(self.z)), extent=ext,
                  cmap=LinearSegmentedColormap.from_list("s", [SEA, SEA]), interpolation="nearest", zorder=2)
        ax.contour(self.lon, self.lat, self.z, levels=[0.5], colors=COAST, linewidths=0.7, zorder=3)
        if contours:
            cs = ax.contour(self.lon, self.lat, self.z, levels=np.arange(100, 1600, 100), colors="#6b5a4a",
                            linewidths=0.35, alpha=0.6, zorder=3)
            ax.clabel(cs, levels=cs.levels[::2], fmt="%d m", fontsize=5.5, inline=True)
        ax.set_xlim(lon0, lon1)
        ax.set_ylim(lat0, lat1)
        frame(ax)


def frame(ax, lat=24.76):
    ax.set_aspect(1 / np.cos(np.radians(lat)))
    ax.xaxis.set_major_locator(MultipleLocator(0.05))
    ax.yaxis.set_major_locator(MultipleLocator(0.05))
    ax.xaxis.set_major_formatter(_deg_fmt("E"))
    ax.yaxis.set_major_formatter(_deg_fmt("N"))
    ax.grid(True, color="white", lw=0.4, alpha=0.6, zorder=4)


def scalebar(ax, km=(0, 2, 4, 6), loc=(0.04, 0.05)):
    lon0, lon1 = ax.get_xlim()
    lat0, lat1 = ax.get_ylim()
    latc = lat0 + (lat1 - lat0) * loc[1]
    deg_per_km = 1 / (111.32 * np.cos(np.radians(latc)))
    x0 = lon0 + (lon1 - lon0) * loc[0]
    h = (lat1 - lat0) * 0.011
    for k in range(len(km) - 1):
        ax.add_patch(plt.Rectangle((x0 + km[k] * deg_per_km, latc), (km[k + 1] - km[k]) * deg_per_km, h,
                                   facecolor=INK if k % 2 == 0 else "white", edgecolor=INK, lw=0.6, zorder=20))
    for v in km:
        ax.text(x0 + v * deg_per_km, latc + 1.9 * h, f"{v}", ha="center", va="bottom", fontsize=6.5,
                zorder=20, path_effects=HALO)
    ax.text(x0 + km[-1] * deg_per_km + 0.6 * deg_per_km, latc + 0.5 * h, "km", va="center", fontsize=6.5,
            zorder=20, path_effects=HALO)


def north_arrow(ax, loc=(0.955, 0.86)):
    ax.annotate("N", xy=(loc[0], loc[1] + 0.085), xytext=(loc[0], loc[1]), xycoords="axes fraction",
                ha="center", va="center", fontsize=9, fontweight="bold", zorder=20,
                arrowprops=dict(arrowstyle="-|>,head_width=0.35,head_length=0.7", color=INK, lw=1.4),
                path_effects=HALO)


def stations(ax, s, size=2.2, color=INK, alpha=0.75, zorder=12):
    ax.scatter(s["lon"], s["lat"], s=size, c=color, lw=0, alpha=alpha, zorder=zorder)


def base100(ax, ref, label=True):
    b = ref["base_100"]
    ax.plot(b["lon"], b["lat"], marker="*", ms=12, mfc="#ffd23f", mec=INK, mew=0.8, ls="", zorder=25)
    if label:
        ax.annotate("Base 100", (b["lon"], b["lat"]), xytext=(7, 6), textcoords="offset points", fontsize=7,
                    fontweight="bold", zorder=25, path_effects=HALO)


def credit(ax, text):
    ax.text(0.0, -0.085, text, transform=ax.transAxes, fontsize=5.8, color=INK2, va="top", ha="left")


def colorbar(fig, mappable, ax, label, ticks=None, extend="both", shrink=0.82):
    cb = fig.colorbar(mappable, ax=ax, orientation="vertical", shrink=shrink, pad=0.018, aspect=28,
                      extend=extend, ticks=ticks)
    cb.set_label(label, fontsize=8)
    cb.ax.tick_params(labelsize=7, direction="out")
    cb.outline.set_linewidth(0.6)
    return cb


# ----------------------------------------------------------------------------- gridding
class Gridder:
    def __init__(self, extent=EXTENT, spacing=GRID_SPACING_M):
        import pyproj
        self.tr = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:32636", always_xy=True)
        self.inv = pyproj.Transformer.from_crs("EPSG:32636", "EPSG:4326", always_xy=True)
        lon0, lon1, lat0, lat1 = extent
        xs, ys = self.tr.transform([lon0, lon1, lon0, lon1], [lat0, lat0, lat1, lat1])
        self.region = (min(xs), max(xs), min(ys), max(ys))
        self.spacing = spacing

    def grid(self, lon, lat, values, damping=1e-7):
        import verde as vd
        x, y = self.tr.transform(np.asarray(lon), np.asarray(lat))
        ok = np.isfinite(values)
        x, y, v = x[ok], y[ok], np.asarray(values)[ok]
        chain = vd.Chain([("block", vd.BlockReduce(np.median, spacing=BLOCK_M)),
                          ("trend", vd.Trend(degree=1)),
                          ("spline", vd.Spline(damping=damping, mindist=50.0))])
        chain.fit((x, y), v)
        g = chain.grid(region=self.region, spacing=self.spacing, data_names="value", dims=("northing", "easting"))
        g = vd.distance_mask((x, y), maxdist=MASK_KM * 1000, grid=g)
        E, N = np.meshgrid(g.easting.values, g.northing.values)
        LON, LAT = self.inv.transform(E, N)
        return LON, LAT, g["value"].values, g

    def cv_score(self, lon, lat, values, damping=1e-7):
        import verde as vd
        x, y = self.tr.transform(np.asarray(lon), np.asarray(lat))
        chain = vd.Chain([("block", vd.BlockReduce(np.median, spacing=BLOCK_M)),
                          ("trend", vd.Trend(degree=1)),
                          ("spline", vd.Spline(damping=damping, mindist=50.0))])
        bx, bv = vd.BlockReduce(np.median, spacing=BLOCK_M).filter((x, y), np.asarray(values))
        cv = vd.BlockKFold(spacing=2000, n_splits=5, shuffle=True, random_state=0)
        scores = vd.cross_val_score(chain, bx, bv, cv=cv, scoring="neg_root_mean_squared_error")
        return float(-np.mean(scores))


def _levels(v, step):
    lo = np.floor(np.nanmin(v) / step) * step
    hi = np.ceil(np.nanmax(v) / step) * step
    return np.arange(lo, hi + step / 2, step)


def gridded_map(bm, gr, s, ref, col, title, unit_label, fname, fdir, cmap=ANOM, center=None, cstep=1.0,
                subtitle="", vlim=None, gdir=None, note=""):
    LON, LAT, Z, g = gr.grid(s["lon"], s["lat"], s[col])
    fig, ax = plt.subplots(figsize=(8.6, 5.6))
    bm.draw(ax, relief_alpha=0.85)
    lo, hi = vlim if vlim is not None else np.nanpercentile(Z, [1, 99])
    if center is not None and lo < center < hi:
        norm = TwoSlopeNorm(center, lo, hi)
    else:
        norm = Normalize(lo, hi)
    m = ax.pcolormesh(LON, LAT, Z, cmap=cmap, norm=norm, shading="auto", alpha=0.82, zorder=5, rasterized=True)
    lev = _levels(Z, cstep)
    cs = ax.contour(LON, LAT, Z, levels=lev, colors=INK, linewidths=0.45, alpha=0.75, zorder=6)
    lab = ax.clabel(cs, levels=cs.levels[::2] if len(cs.levels) > 14 else cs.levels, fmt="%g", fontsize=6,
                    inline=True, inline_spacing=2)
    for t in lab:
        t.set_path_effects([pe.withStroke(linewidth=1.6, foreground="white")])
    stations(ax, s, size=1.6, alpha=0.6)
    base100(ax, ref)
    scalebar(ax)
    north_arrow(ax)
    colorbar(fig, m, ax, unit_label)
    ax.set_title(title, loc="left")
    if subtitle:
        ax.text(0, 1.012, subtitle, transform=ax.transAxes, fontsize=7.2, color=INK2, va="bottom")
        ax.set_title(title, loc="left", pad=14)
    credit(ax, f"Contour interval {cstep:g} mGal. Biharmonic spline, {GRID_SPACING_M:.0f} m grid, blanked "
               f">{MASK_KM:g} km from stations; dots = {len(s)} stations. Relief: Copernicus GLO-30. {note}")
    fig.savefig(os.path.join(fdir, fname))
    plt.close(fig)
    if gdir:
        stem = os.path.splitext(fname)[0]
        g.to_netcdf(os.path.join(gdir, stem + ".nc"))
        out = pd.DataFrame({"lon": LON.ravel(), "lat": LAT.ravel(), "easting_utm36n": np.meshgrid(g.easting, g.northing)[0].ravel(),
                            "northing_utm36n": np.meshgrid(g.easting, g.northing)[1].ravel(), col: Z.ravel()})
        out.dropna().to_csv(os.path.join(gdir, stem + "_xyz.csv"), index=False, float_format="%.6f")
    return LON, LAT, Z


def inset_locator(ia, dem, ref):
    z = dem.z[::6, ::6]
    hs = hillshade(z, 185.0, 185.0, z_factor=2)
    ext = (dem.lon[0], dem.lon[-1], dem.lat[-1], dem.lat[0])
    ia.imshow(np.ma.masked_where(z <= 0.5, z), extent=ext, cmap=HYPSO, vmin=0, vmax=900, zorder=0)
    ia.imshow(hs, extent=ext, cmap="gray", alpha=0.35, zorder=1)
    ia.imshow(np.ma.masked_where(z > 0.5, np.ones_like(z)), extent=ext,
              cmap=LinearSegmentedColormap.from_list("s", [SEA, SEA]), zorder=2)
    lon0, lon1, lat0, lat1 = EXTENT
    ia.add_patch(plt.Rectangle((lon0, lat0), lon1 - lon0, lat1 - lat0, fill=False, ec="#b52a1d", lw=1.2, zorder=5))
    ia.plot(34.87765, 25.06676, marker="s", ms=4, mfc="white", mec=INK, zorder=6)
    ia.annotate("Station 0\n(hotel)", (34.87765, 25.06676), xytext=(4, -2), textcoords="offset points",
                fontsize=5.5, va="top", path_effects=HALO)
    ia.text(35.16, 24.62, "Red\nSea", fontsize=6, color=COAST, style="italic", ha="center")
    ia.set_xlim(dem.lon[0], dem.lon[-1])
    ia.set_ylim(dem.lat[-1], dem.lat[0])
    ia.set_aspect(1 / np.cos(np.radians(24.76)))
    ia.set_xticks([])
    ia.set_yticks([])
    ia.set_title("Location", fontsize=8.5, loc="left")
    ia.text(0.02, 0.02, "red frame = map", transform=ia.transAxes, fontsize=5.8, color="#b52a1d")
    for sp in ia.spines.values():
        sp.set_edgecolor(INK)
        sp.set_linewidth(0.8)
    return ia


# ----------------------------------------------------------------------------- the maps
def map_stations(bm, ctx, fdir):
    occ, ref = ctx["occ"], ctx["ref"]
    f = occ[occ["role"] == "field"]
    fig = plt.figure(figsize=(11.0, 6.3))
    gs = fig.add_gridspec(2, 2, width_ratios=[4.3, 1.35], height_ratios=[1.0, 1.15], wspace=0.06, hspace=0.12)
    ax = fig.add_subplot(gs[:, 0])
    ia = fig.add_subplot(gs[0, 1])
    lax = fig.add_subplot(gs[1, 1])
    lax.axis("off")
    bm.draw(ax, tint=True, contours=True)
    for inst in ("CG6-0640", "CG6-0313"):
        m = f[(f["instrument"] == inst) & f["match_status"].isin(["MATCHED", "MATCHED_ID_TIEBREAK"]) & f["usable"]]
        ax.scatter(m["lon"], m["lat"], s=9, c=INST_COL[inst], edgecolors="white", linewidths=0.35, zorder=12,
                   label=f"{INST_LAB[inst]}  ({len(m)} stations)")
    u = f[~f["match_status"].isin(["MATCHED", "MATCHED_ID_TIEBREAK"]) | ~f["usable"]]
    ax.scatter(u["lon_cg6"], u["lat_cg6"], s=16, marker="x", c="#c0262d", lw=0.9, zorder=13,
               label=f"Excluded: no GNSS match or no valid reading ({len(u)})")
    # line labels at first station of each #0313 line
    o = f[(f["instrument"] == "CG6-0313") & f["lat"].notna()]
    for line, d in o.groupby("line"):
        d = d.sort_values("t_mid")
        ax.text(d["lon"].iloc[0], d["lat"].iloc[0], f"L{line}", fontsize=6, color="#8a3a12", fontweight="bold",
                ha="right", va="bottom", zorder=14, path_effects=HALO)
    base100(ax, ref)
    ax.plot([], [], marker="*", ms=10, mfc="#ffd23f", mec=INK, ls="", label="Base 100 (field control)")
    scalebar(ax)
    north_arrow(ax)
    h, l = ax.get_legend_handles_labels()
    lax.legend(h, l, loc="upper left", markerscale=1.4, fontsize=7.2, frameon=False, borderaxespad=0)
    inset_locator(ia, ctx["dem"], ref)
    sm = plt.cm.ScalarMappable(cmap=HYPSO, norm=Normalize(0, 650))
    cax = lax.inset_axes([0.0, 0.18, 0.92, 0.06])
    cb = fig.colorbar(sm, cax=cax, orientation="horizontal", extend="max")
    cb.set_label("DEM elevation [m, EGM2008]", fontsize=7.5)
    cb.ax.tick_params(labelsize=6.5)
    ax.set_title("Gravity station distribution – Wadi Ghadir, 16–24 Jan 2026", loc="left", pad=14)
    ax.text(0, 1.012, "#0313 line numbers in brown; DEM contours every 100 m", transform=ax.transAxes,
            fontsize=7.2, color=INK2, va="bottom")
    credit(ax, "Coordinates: GNSS (WGS84). Relief and contours: Copernicus DEM GLO-30. Inset: station 0 (hotel) "
               "and survey frame.")
    fig.savefig(os.path.join(fdir, "map01_station_distribution.png"))
    plt.close(fig)


def map_points(bm, s, ref, col, title, label, fname, fdir, cmap, norm, subtitle="", note="", size=11, extend="both"):
    fig, ax = plt.subplots(figsize=(8.6, 5.6))
    bm.draw(ax, relief_alpha=0.85)
    o = s.sort_values(col, key=lambda v: np.abs(v))
    m = ax.scatter(o["lon"], o["lat"], c=o[col], s=size, cmap=cmap, norm=norm, edgecolors=INK, linewidths=0.25,
                   zorder=12)
    base100(ax, ref)
    scalebar(ax)
    north_arrow(ax)
    colorbar(fig, m, ax, label, extend=extend)
    ax.set_title(title, loc="left", pad=14 if subtitle else 6)
    if subtitle:
        ax.text(0, 1.012, subtitle, transform=ax.transAxes, fontsize=7.2, color=INK2, va="bottom")
    credit(ax, note)
    fig.savefig(os.path.join(fdir, fname))
    plt.close(fig)


def density_panel(bm, gr, s, ref, prefix, densities, title, fname, fdir, cstep=1.0, gdir=None):
    cols = [f"{prefix}{r:.2f}_mgal" for r in densities]
    grids = [gr.grid(s["lon"], s["lat"], s[c]) for c in cols]
    allv = np.concatenate([g[2][np.isfinite(g[2])] for g in grids])
    lo, hi = np.percentile(allv, [1, 99])
    norm = TwoSlopeNorm(0, lo, hi) if lo < 0 < hi else Normalize(lo, hi)
    fig, axes = plt.subplots(2, 2, figsize=(11.2, 7.0), sharex=True, sharey=True, layout="constrained")
    for ax, rho, (LON, LAT, Z, g), c in zip(axes.ravel(), densities, grids, cols):
        bm.draw(ax, relief_alpha=0.85)
        m = ax.pcolormesh(LON, LAT, Z, cmap=ANOM, norm=norm, shading="auto", alpha=0.85, zorder=5, rasterized=True)
        cs = ax.contour(LON, LAT, Z, levels=_levels(Z, cstep), colors=INK, linewidths=0.35, alpha=0.7, zorder=6)
        ax.clabel(cs, levels=cs.levels[::2], fmt="%g", fontsize=5, inline=True)
        stations(ax, s, size=0.8, alpha=0.5)
        base100(ax, ref, label=False)
        ax.text(0.015, 0.975, f"ρ = {rho:.2f} g/cm³", transform=ax.transAxes, fontsize=9, fontweight="bold",
                va="top", zorder=30, bbox=dict(boxstyle="round,pad=0.25", fc="white", ec=GRID, lw=0.6))
        if gdir:
            g.to_netcdf(os.path.join(gdir, f"{os.path.splitext(fname)[0]}_rho{rho:.2f}.nc"))
    for ax in axes[0]:
        ax.tick_params(labelbottom=False)
    for ax in axes[:, 1]:
        ax.tick_params(labelleft=False)
    scalebar(axes[1, 0])
    north_arrow(axes[0, 1])
    cb = fig.colorbar(m, ax=axes, orientation="vertical", shrink=0.7, pad=0.01, aspect=34, extend="both")
    cb.set_label("Anomaly relative to base 100 [mGal]", fontsize=8.5)
    cb.ax.tick_params(labelsize=7)
    fig.suptitle(title + f"  (same colour scale; contour interval {cstep:g} mGal; gridding as in the single maps)",
                 x=0.02, ha="left", fontsize=10.5, fontweight="bold")
    fig.savefig(os.path.join(fdir, fname), dpi=300)
    plt.close(fig)


def make_all(ctx, fdir, gdir):
    os.makedirs(fdir, exist_ok=True)
    os.makedirs(gdir, exist_ok=True)
    st, ref = ctx["st"], ctx["ref"]
    s = st[st["product_ok"]].copy()
    bm = Basemap(ctx["dem"])
    gr = Gridder()
    cv = {}

    map_stations(bm, ctx, fdir)
    hmax = np.nanpercentile(s["H_ortho_m"], 99.5)
    map_points(bm, s, ref, "H_ortho_m", "Station elevation", "Orthometric height H [m, EGM2008]",
               "map02_station_elevation.png", fdir, HYPSO, Normalize(0, hmax),
               subtitle="GNSS ellipsoidal height minus EGM2008 geoid undulation (11.5–12.7 m)",
               note="Heights: GNSS processed relative to MRSA; day-7 heights lowered by 2.83 m (report §3.3).", extend="max")
    rr = 3.0
    map_points(bm, s, ref, "H_minus_dem_m", "Height check: GNSS-derived H minus Copernicus DEM",
               "H − DEM [m]", "map03_height_check_vs_dem.png", fdir, ANOM, TwoSlopeNorm(0, -rr, rr),
               subtitle=f"Median {s['H_minus_dem_m'].median():+.2f} m, MAD "
                        f"{(s['H_minus_dem_m'] - s['H_minus_dem_m'].median()).abs().median():.2f} m",
               note="Copernicus GLO-30 is a surface model with ~2 m absolute vertical accuracy; colour scale clipped at ±3 m.")
    map_points(bm, s, ref, "dFA_sigma_mgal", "Station uncertainty (1σ) of the free-air value",
               "σ(ΔFA) [mGal]", "map04_station_uncertainty.png", fdir, UNC_CMAP,
               Normalize(0.03, np.nanpercentile(s["dFA_sigma_mgal"], 99)), extend="max",
               subtitle="Gravity (reading + drift model) and height (0.15 m; 0.35 m on 22 Jan) combined",
               note="CG-6 #0313 stations carry the larger drift-model uncertainty (53 µGal).")

    specs = [
        ("dg100_scaled_mgal", "Observed gravity relative to base 100", "Δg₁₀₀ [mGal]", "map05_observed_gravity.png",
         2.0, "Tide recomputed, drift tied to base 100, #0313 scaled by k = 1.0119"),
        ("dFA_rel_mgal", "Free-air anomaly relative to base 100", "ΔFA [mGal]", "map06_free_air_anomaly.png",
         1.0, "Normal gravity WGS84; second-order free-air gradient; EGM2008 orthometric heights"),
        ("dSB_rel_rho2.67_mgal", "Simple Bouguer anomaly (ρ = 2.67 g/cm³) relative to base 100", "ΔSB [mGal]",
         "map07_simple_bouguer_2.67.png", 1.0, "Infinite-slab correction 0.04193·ρ·ΔH; no terrain correction"),
        ("dCB_rel_rho2.67_mgal", "Complete Bouguer anomaly (ρ = 2.67 g/cm³) relative to base 100", "ΔCB [mGal]",
         "map09_complete_bouguer_2.67.png", 1.0, "Free-air minus DEM topographic effect (prisms, 22 km, curvature)"),
    ]
    for col, title, lab, fname, step, sub in specs:
        center = 0.0 if col.startswith(("dSB", "dCB")) else None
        cmap = TC_CMAP if col == "TC_rho2.67_mgal" else ANOM
        gridded_map(bm, gr, s, ref, col, title, lab, fname, fdir, cmap=cmap, center=center, cstep=step,
                    subtitle=sub, gdir=gdir)
        cv[col] = gr.cv_score(s["lon"], s["lat"], s[col])

    map_points(bm, s, ref, "TC_rho2.67_mgal", "Terrain correction at the stations (ρ = 2.67 g/cm³)", "TC [mGal]",
               "map08_terrain_correction_2.67.png", fdir, TC_CMAP,
               Normalize(0, np.nanpercentile(s["TC_rho2.67_mgal"], 99.5)), extend="max",
               subtitle="Copernicus GLO-30 prisms to 22 km incl. Earth curvature, relative to the Bouguer slab",
               note=f"Range {s['TC_rho2.67_mgal'].min():.2f}–{s['TC_rho2.67_mgal'].max():.2f} mGal, median "
                    f"{s['TC_rho2.67_mgal'].median():.2f} mGal. Shown at stations: TC varies over short distances "
                    "and is not gridded.")
    dens = (2.20, 2.40, 2.67, 2.90)
    density_panel(bm, gr, s, ref, "dCB_rel_rho", dens, "Complete Bouguer anomaly for four reduction densities",
                  "map10_complete_bouguer_density_panel.png", fdir, gdir=gdir)
    density_panel(bm, gr, s, ref, "dSB_rel_rho", dens, "Simple Bouguer anomaly for four reduction densities",
                  "map11_simple_bouguer_density_panel.png", fdir, gdir=gdir)
    pd.DataFrame([dict(grid=k, block_kfold_rmse_mgal=v) for k, v in cv.items()]).to_csv(
        os.path.join(gdir, "gridding_cross_validation.csv"), index=False)
    return cv
