"""Shared cartographic style and map furniture for all Wadi Ghadir maps.

Map frame, colour palettes, DEM hillshade basemap, scale bar, north arrow,
base-100 symbol, colour bars and the location inset.  Used by the gravity and
the magnetic maps so that both share one visual language.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import matplotlib

matplotlib.use("Agg")
import matplotlib.patheffects as pe  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402
from matplotlib.ticker import FuncFormatter, MultipleLocator  # noqa: E402

from .geodata import hillshade  # noqa: E402


# -----------------------------------------------------------------------------
# Map window, resolution and palettes
EXTENT = (34.705, 35.025, 24.665, 24.850)  # lon0, lon1, lat0, lat1
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

# Style of all maps (gravity and magnetics); applied by apply_map_style() so that the
# maps look the same whatever was plotted before.  Maps carry a full neat line (all spines).
MAP_STYLE = {
    "font.family": "DejaVu Sans", "font.size": 8.5, "axes.titlesize": 10.5, "axes.titleweight": "bold",
    "axes.labelsize": 8.5, "axes.edgecolor": INK, "axes.linewidth": 0.8, "xtick.color": INK2,
    "ytick.color": INK2, "xtick.labelsize": 7.5, "ytick.labelsize": 7.5, "xtick.direction": "in",
    "ytick.direction": "in", "xtick.top": True, "ytick.right": True, "savefig.dpi": DPI,
    "savefig.bbox": "tight", "savefig.pad_inches": 0.08, "axes.grid": False, "legend.frameon": True,
    "legend.framealpha": 0.92, "legend.edgecolor": GRID, "legend.fontsize": 7.5,
    "axes.labelcolor": INK, "axes.spines.top": True, "axes.spines.right": True,
}


def apply_map_style():
    """Matplotlib defaults + MAP_STYLE."""
    plt.rcdefaults()
    plt.rcParams.update(MAP_STYLE)


HALO = [pe.withStroke(linewidth=2.2, foreground="white")]


# -----------------------------------------------------------------------------
# Basemap and map furniture

def _deg_fmt(hemi):
    def f(v, _):
        return f"{abs(v):.2f}°{hemi}"
    return FuncFormatter(f)


class Basemap:
    """DEM hillshade (or hypsometric tint) basemap clipped to the map extent, with sea mask and coastline."""
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
    """Equal-distance aspect at the survey latitude, 0.05 degree ticks and a light graticule."""
    ax.set_aspect(1 / np.cos(np.radians(lat)))
    ax.xaxis.set_major_locator(MultipleLocator(0.05))
    ax.yaxis.set_major_locator(MultipleLocator(0.05))
    ax.xaxis.set_major_formatter(_deg_fmt("E"))
    ax.yaxis.set_major_formatter(_deg_fmt("N"))
    ax.grid(True, color="white", lw=0.4, alpha=0.6, zorder=4)


def scalebar(ax, km=(0, 2, 4, 6), loc=(0.04, 0.05)):
    """Alternating black/white scale bar in km at axes-fraction position loc."""
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
    """North arrow at axes-fraction position loc."""
    ax.annotate("N", xy=(loc[0], loc[1] + 0.085), xytext=(loc[0], loc[1]), xycoords="axes fraction",
                ha="center", va="center", fontsize=9, fontweight="bold", zorder=20,
                arrowprops=dict(arrowstyle="-|>,head_width=0.35,head_length=0.7", color=INK, lw=1.4),
                path_effects=HALO)


def stations(ax, s, size=2.2, color=INK, alpha=0.75, zorder=12):
    """Plot station positions as small dots."""
    ax.scatter(s["lon"], s["lat"], s=size, c=color, lw=0, alpha=alpha, zorder=zorder)


def base100(ax, ref, label=True):
    """Plot base 100 (field gravity control) as a yellow star."""
    b = ref["base_100"]
    ax.plot(b["lon"], b["lat"], marker="*", ms=12, mfc="#ffd23f", mec=INK, mew=0.8, ls="", zorder=25)
    if label:
        ax.annotate("Base 100", (b["lon"], b["lat"]), xytext=(7, 6), textcoords="offset points", fontsize=7,
                    fontweight="bold", zorder=25, path_effects=HALO)


def credit(ax, text):
    """Small source / method note below the map frame."""
    ax.text(0.0, -0.085, text, transform=ax.transAxes, fontsize=5.8, color=INK2, va="top", ha="left")


def colorbar(fig, mappable, ax, label, ticks=None, extend="both", shrink=0.82):
    """Vertical colour bar beside the map with label and extend arrows."""
    cb = fig.colorbar(mappable, ax=ax, orientation="vertical", shrink=shrink, pad=0.018, aspect=28,
                      extend=extend, ticks=ticks)
    cb.set_label(label, fontsize=8)
    cb.ax.tick_params(labelsize=7, direction="out")
    cb.outline.set_linewidth(0.6)
    return cb


def inset_locator(ia, dem, ref):
    """Location inset: survey frame, station 0 (hotel) and the Red Sea coast on the full DEM window."""
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
