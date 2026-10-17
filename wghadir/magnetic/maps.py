"""Magnetic maps (points and grids) in the gravity map style, and grid export.

Colours are histogram-equalised (equal numbers of values per colour band) so a
single strong anomaly does not compress the rest of the colour range.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import os
import textwrap

import matplotlib.patheffects as pe
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import BoundaryNorm

from ..common import mapping as maps
from .processing import _lonlat
from .settings import BLOCK_M, GRID_SPACING_M, MASK_KM


def equalised_norm(values, n_levels=64):
    """Histogram-equalised colour classes (equal numbers of values per colour band)."""
    v = np.asarray(values, float)
    v = v[np.isfinite(v)]
    levels = np.unique(np.round(np.percentile(v, np.linspace(0.5, 99.5, n_levels + 1)), 1))
    return BoundaryNorm(levels, ncolors=256, extend="both"), levels


def _equalised_colorbar(fig, m, ax, label, levels):
    cb = maps.colorbar(fig, m, ax, label + "  (histogram-equalised)")
    idx = np.linspace(0, len(levels) - 1, 9).round().astype(int)
    cb.set_ticks(levels[idx])
    cb.set_ticklabels([f"{levels[i]:,.0f}" for i in idx])
    return cb


def _credit(ax, text):
    maps.credit(ax, "\n".join(textwrap.wrap(text, 175)))


def _nice_step(lo, hi, n=18):
    raw = (hi - lo) / n
    mag = 10 ** np.floor(np.log10(raw))
    for m in (1, 2, 2.5, 5, 10):
        if raw <= m * mag:
            return m * mag
    return 10 * mag


def map_points(bm, d, ref, col, title, label, fname, fdir, center=None, subtitle="", note=""):
    """Map of the accepted readings coloured by col (histogram-equalised), rejected spikes as crosses."""
    a = d[d["accepted"]]
    norm, levels = equalised_norm(a[col])
    fig, ax = plt.subplots(figsize=(8.6, 5.6))
    bm.draw(ax, relief_alpha=0.85)
    o = a.iloc[np.argsort(np.abs(a[col].values - np.median(a[col])))]
    m = ax.scatter(o["lon"], o["lat"], c=o[col], s=3.2, cmap=maps.ANOM, norm=norm, lw=0, zorder=12, rasterized=True)
    sp = d[d["flags"].str.contains("SPIKE")]
    ax.scatter(sp["lon"], sp["lat"], s=7, marker="x", c="#1d1d1b", lw=0.5, zorder=13,
               label=f"rejected spikes ({len(sp)})")
    maps.base100(ax, ref)
    maps.scalebar(ax)
    maps.north_arrow(ax)
    _equalised_colorbar(fig, m, ax, label, levels)
    ax.legend(loc="lower right", markerscale=1.5)
    ax.set_title(title, loc="left", pad=14 if subtitle else 6)
    if subtitle:
        ax.text(0, 1.012, subtitle, transform=ax.transAxes, fontsize=7.2, color=maps.INK2, va="bottom")
    _credit(ax, note)
    fig.savefig(os.path.join(fdir, fname), dpi=maps.DPI)
    plt.close(fig)


def map_grid(bm, g, d, ref, title, label, fname, fdir, center=None, subtitle="", note="", track_alpha=0.45):
    """Gridded magnetic map with contours and survey tracks (histogram-equalised colours)."""
    LON, LAT = _lonlat(g)
    Z = g["value"].values
    lo, hi = np.nanpercentile(Z, [1, 99])
    norm, levels = equalised_norm(Z)
    step = _nice_step(lo, hi)
    fig, ax = plt.subplots(figsize=(8.6, 5.6))
    bm.draw(ax, relief_alpha=0.85)
    m = ax.pcolormesh(LON, LAT, Z, cmap=maps.ANOM, norm=norm, shading="auto", alpha=0.85, zorder=5, rasterized=True)
    lev = np.arange(np.floor(lo / step) * step, np.ceil(hi / step) * step + step / 2, step)
    cs = ax.contour(LON, LAT, Z, levels=lev, colors=maps.INK, linewidths=0.35, alpha=0.7, zorder=6)
    lab = ax.clabel(cs, levels=cs.levels[::2], fmt="%g", fontsize=5.5, inline=True, inline_spacing=2)
    for t in lab:
        t.set_path_effects([pe.withStroke(linewidth=1.6, foreground="white")])
    a = d[d["accepted"]]
    ax.scatter(a["lon"].values[::4], a["lat"].values[::4], s=0.25, c=maps.INK, lw=0, alpha=track_alpha, zorder=7,
               rasterized=True)
    maps.base100(ax, ref)
    maps.scalebar(ax)
    maps.north_arrow(ax)
    _equalised_colorbar(fig, m, ax, label, levels)
    ax.set_title(title, loc="left", pad=14 if subtitle else 6)
    if subtitle:
        ax.text(0, 1.012, subtitle, transform=ax.transAxes, fontsize=7.2, color=maps.INK2, va="bottom")
    _credit(ax, f"Contour interval {step:g} nT. Biharmonic spline after {BLOCK_M:.0f} m block median, "
                    f"{GRID_SPACING_M:.0f} m grid, blanked >{MASK_KM:g} km from data; grey dots = survey tracks. "
                    f"Relief: Copernicus GLO-30. {note}")
    fig.savefig(os.path.join(fdir, fname), dpi=maps.DPI)
    plt.close(fig)


def save_grid(g, path_stem, name):
    """Write a grid as NetCDF and as XYZ CSV (lon, lat, UTM 36N, value)."""
    LON, LAT = _lonlat(g)
    g.to_netcdf(path_stem + ".nc")
    E, N = np.meshgrid(g.easting, g.northing)
    pd.DataFrame({"lon": LON.ravel(), "lat": LAT.ravel(), "easting_utm36n": E.ravel(), "northing_utm36n": N.ravel(),
                  name: g["value"].values.ravel()}).dropna().to_csv(path_stem + "_xyz.csv", index=False,
                                                                     float_format="%.6f")
