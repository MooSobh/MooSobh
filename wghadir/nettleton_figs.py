"""Nettleton density figures: one sheet per profile plus summary graphics."""
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, Normalize  # noqa: E402

from . import maps  # noqa: E402  (shared style, basemap and helpers)

RHO_LINES = np.round(np.arange(2.0, 3.01, 0.1), 2)
DENS_CMAP = LinearSegmentedColormap.from_list("dens", ["#9ec5f4", "#3987e5", "#1c5cab", "#4a3aa7", "#2b1b6b"])
SIMPLE_COL, COMPLETE_COL, BEST_COL = "#eb6834", "#1c5cab", "#c0262d"


def _profile_sheet(p, sw, res, bm, s_all, fdir):
    pid = p["profile_id"].iloc[0]
    rc = res[(res["profile_id"] == pid) & (res["method"] == "complete")].iloc[0]
    rs = res[(res["profile_id"] == pid) & (res["method"] == "simple")].iloc[0]
    x = p["chainage_m"].values / 1000

    fig = plt.figure(figsize=(9.0, 9.6))
    gs = fig.add_gridspec(3, 3, height_ratios=[1.0, 1.25, 1.0], hspace=0.38, wspace=0.42)
    # location
    axm = fig.add_subplot(gs[0, 0])
    bm.draw(axm, relief_alpha=0.85)
    axm.scatter(s_all["lon"], s_all["lat"], s=0.6, c="#8c8b86", lw=0, zorder=10)
    axm.plot(p["lon"], p["lat"], "-", color=BEST_COL, lw=1.6, zorder=11)
    axm.plot(p["lon"].iloc[0], p["lat"].iloc[0], "o", ms=4, mfc="white", mec=BEST_COL, zorder=12)
    axm.set_xticks([])
    axm.set_yticks([])
    axm.set_title("Location (○ = chainage 0)", fontsize=8, loc="left", fontweight="normal")
    # topography
    axt = fig.add_subplot(gs[0, 1:])
    axt.fill_between(x, p["H_dem_m"], p["H_dem_m"].min() - 5, color="#e9e4cf", lw=0)
    axt.plot(x, p["H_dem_m"], color="#956b45", lw=1.0, label="Copernicus DEM at stations")
    axt.plot(x, p["H_ortho_m"], "o", ms=2.6, color="#1d1d1b", label="Station height (GNSS, EGM2008)")
    axt.set_ylabel("Height [m]")
    axt.set_xlim(x.min(), x.max())
    axt.legend(loc="best", fontsize=7)
    axt.set_title(f"{pid}  –  {len(p)} stations, {x.max():.1f} km, relief {np.ptp(p['H_ortho_m']):.0f} m",
                  loc="left", fontsize=9.5)
    axt.grid(True, color="#e4e3de", lw=0.5)
    # anomaly for several densities
    axa = fig.add_subplot(gs[1, :])
    norm = Normalize(RHO_LINES.min(), RHO_LINES.max())
    for rho in RHO_LINES:
        b = p["dFA_rel_mgal"] - rho * p["u_topo_mgal_per_gcc"]
        axa.plot(x, b - b.mean(), color=DENS_CMAP(norm(rho)), lw=1.0, alpha=0.95)
    b267 = p["dFA_rel_mgal"] - 2.67 * p["u_topo_mgal_per_gcc"]
    axa.plot(x, b267 - b267.mean(), color="black", lw=1.4, ls="--", label="ρ = 2.67 g/cm³")
    if 1.5 < rc["rho_regression"] < 3.5:
        bb = p["dFA_rel_mgal"] - rc["rho_regression"] * p["u_topo_mgal_per_gcc"]
        axa.plot(x, bb - bb.mean(), color=BEST_COL, lw=2.0, label=f"best fit ρ = {rc['rho_regression']:.2f} g/cm³")
    sm = plt.cm.ScalarMappable(cmap=DENS_CMAP, norm=norm)
    cb = fig.colorbar(sm, ax=axa, pad=0.01, aspect=25)
    cb.set_label("Reduction density ρ [g/cm³]", fontsize=8)
    axa.set_ylabel("ΔCB − profile mean [mGal]")
    axa.set_xlabel("Chainage [km]")
    axa.set_xlim(x.min(), x.max())
    axa.legend(loc="best", fontsize=7)
    axa.grid(True, color="#e4e3de", lw=0.5)
    axa.set_title("Complete Bouguer anomaly along the profile for ρ = 2.0–3.0 g/cm³ (step 0.1)", loc="left",
                  fontsize=9, fontweight="normal")
    # correlation curves
    axc = fig.add_subplot(gs[2, :2])
    for method, col, ls in (("simple", SIMPLE_COL, "--"), ("complete", COMPLETE_COL, "-")):
        d = sw[(sw["profile_id"] == pid) & (sw["method"] == method)]
        axc.plot(d["rho"], d["corr_detrended"], color=col, ls=ls, lw=1.6,
                 label="simple Bouguer (slab)" if method == "simple" else "complete Bouguer (DEM)")
    axc.axhline(0, color="#52514e", lw=0.7)
    axc.axvline(2.67, color="#52514e", lw=0.6, ls=":")
    for r_, col in ((rs, SIMPLE_COL), (rc, COMPLETE_COL)):
        if np.isfinite(r_["rho_zero_corr"]):
            axc.plot(r_["rho_zero_corr"], 0, "o", ms=6, mfc="white", mec=col, mew=1.5, zorder=5)
    axc.set_xlabel("Trial density ρ [g/cm³]")
    axc.set_ylabel("corr(detrended anomaly, detrended H)")
    axc.set_ylim(-1.02, 1.02)
    axc.legend(loc="lower left", fontsize=7)
    axc.grid(True, color="#e4e3de", lw=0.5)
    axc.set_title("Nettleton criterion (○ = zero correlation)", loc="left", fontsize=9, fontweight="normal")
    # statistics box
    axs = fig.add_subplot(gs[2, 2])
    axs.axis("off")
    txt = ["Regression ΔFA = a + b·x + ρ·u", "",
           "Complete Bouguer (DEM):",
           f"  ρ = {rc['rho_regression']:.2f} ± {rc['rho_regression_se']:.2f} g/cm³",
           f"  bootstrap 95 %: {rc['rho_boot_p2_5']:.2f} – {rc['rho_boot_p97_5']:.2f}",
           f"  residual rms {rc['residual_rms_mgal']:.2f} mGal", "",
           "Simple Bouguer (slab):",
           f"  ρ = {rs['rho_regression']:.2f} ± {rs['rho_regression_se']:.2f} g/cm³",
           f"  bootstrap 95 %: {rs['rho_boot_p2_5']:.2f} – {rs['rho_boot_p97_5']:.2f}", "",
           f"Stations used: {int(rc['n_used'])}",
           f"Instrument: {'CG-6 #0640' if pid.startswith('N') else 'CG-6 #0313'}"]
    axs.text(0, 1, "\n".join(txt), va="top", fontsize=7.6, family="DejaVu Sans Mono",
             bbox=dict(boxstyle="round,pad=0.5", fc="#f6f5f1", ec="#d9d8d3"))
    fig.savefig(os.path.join(fdir, f"nettleton_{pid}.png"), dpi=300)
    plt.close(fig)


def summary_forest(net, cons, fdir):
    keep = net.groupby("profile_id")["rho_regression_se"].min() < 2.5
    profiles = (net[(net["method"] == "complete") & net["profile_id"].isin(keep[keep].index)]
                .sort_values("rho_regression")["profile_id"].tolist())
    fig, ax = plt.subplots(figsize=(7.6, 0.32 * len(profiles) + 1.6))
    y = np.arange(len(profiles))
    for method, col, off, mk in (("simple", SIMPLE_COL, 0.17, "s"), ("complete", COMPLETE_COL, -0.17, "o")):
        d = net[net["method"] == method].set_index("profile_id").loc[profiles]
        ok = (d["rho_regression_se"] < 2.5).values
        ax.errorbar(d["rho_regression"].values[ok], y[ok] + off, xerr=1.96 * d["rho_regression_se"].values[ok], fmt=mk,
                    ms=4.5, color=col, ecolor=col, elinewidth=1, capsize=0,
                    label="simple Bouguer (slab)" if method == "simple" else "complete Bouguer (DEM)")
    c = cons[(cons["set"] == "profiles") & (cons["method"] == "complete")]
    if len(c):
        c = c.iloc[0]
        ax.axvspan(c["weighted_mean"] - 1.96 * c["weighted_se_scaled"], c["weighted_mean"] + 1.96 * c["weighted_se_scaled"],
                   color=COMPLETE_COL, alpha=0.12, lw=0,
                   label=f"weighted mean (complete) {c['weighted_mean']:.2f} ± {1.96 * c['weighted_se_scaled']:.2f}")
    ax.axvline(2.67, color="#52514e", ls=":", lw=0.8)
    ax.axvspan(-3.5, 1.5, color="#f3f2ee", lw=0, zorder=0)
    ax.axvspan(3.5, 8.5, color="#f3f2ee", lw=0, zorder=0)
    ax.text(-3.3, len(profiles) - 0.4, "implausible (< 1.5)", fontsize=6.5, color="#7a7974", va="top")
    ax.text(8.3, len(profiles) - 0.4, "implausible (> 3.5)", fontsize=6.5, color="#7a7974", va="top", ha="right")
    ax.set_yticks(y)
    ax.set_yticklabels(profiles, fontsize=7)
    ax.set_ylim(-0.7, len(profiles) - 0.2)
    ax.set_xlim(-3.5, 8.5)
    ax.set_xlabel("Nettleton / regression density ±1.96 SE [g/cm³] (estimates with SE ≥ 2.5 omitted)")
    ax.legend(loc="lower right", fontsize=7)
    ax.grid(True, axis="x", color="#e4e3de", lw=0.5)
    ax.set_title("Density estimate per profile: simple vs complete Bouguer", loc="left")
    fig.savefig(os.path.join(fdir, "nettleton_summary_profiles.png"), dpi=300)
    plt.close(fig)


def windows_map(bm, win, s_all, ref, fdir):
    w = win[(win["method"] == "complete") & (win["rho_se"] < 1.0)]
    fig, ax = plt.subplots(figsize=(8.6, 5.6))
    bm.draw(ax, relief_alpha=0.85)
    ax.scatter(s_all["lon"], s_all["lat"], s=0.8, c="#5d5c58", lw=0, zorder=10)
    norm = Normalize(2.0, 3.4)
    sc = ax.scatter(w["lon_c"], w["lat_c"], c=w["rho_regression"].clip(1.5, 3.9), s=55 / w["rho_se"].clip(0.15, 1),
                    cmap=DENS_CMAP, norm=norm, edgecolors="black", linewidths=0.5, zorder=12)
    for _, r in w.iterrows():
        ax.annotate(f"{r['rho_regression']:.2f}", (r["lon_c"], r["lat_c"]), xytext=(5, 4), textcoords="offset points",
                    fontsize=6, zorder=13, path_effects=maps.HALO)
    maps.base100(ax, ref)
    maps.scalebar(ax)
    maps.north_arrow(ax)
    maps.colorbar(fig, sc, ax, "Window density estimate [g/cm³]")
    ax.set_title("Nettleton density in 3-km profile windows (complete Bouguer)", loc="left", pad=14)
    ax.text(0, 1.012, "Windows with SE < 1 g/cm³; symbol size ∝ 1/SE; labels = estimate", transform=ax.transAxes,
            fontsize=7.2, color=maps.INK2, va="bottom")
    fig.savefig(os.path.join(fdir, "nettleton_windows_map.png"))
    plt.close(fig)


def windows_hist(win, cons, fdir):
    fig, ax = plt.subplots(figsize=(7.2, 3.6))
    bins = np.arange(0.0, 5.01, 0.2)
    for method, col in (("simple", SIMPLE_COL), ("complete", COMPLETE_COL)):
        d = win[(win["method"] == method) & (win["rho_se"] < 1.0)]["rho_regression"].clip(0, 5)
        ax.hist(d, bins=bins, histtype="step", lw=1.8, color=col,
                label=f"{method} Bouguer (n = {len(d)}, median {d.median():.2f})")
    ax.axvline(2.67, color="#52514e", ls=":", lw=0.8)
    ax.set_xlabel("Window density estimate [g/cm³] (SE < 1 g/cm³; clipped to 0–5)")
    ax.set_ylabel("Windows")
    ax.legend(loc="upper left", fontsize=7.5)
    ax.grid(True, color="#e4e3de", lw=0.5)
    ax.set_title("Distribution of 3-km window densities", loc="left")
    fig.savefig(os.path.join(fdir, "nettleton_windows_histogram.png"), dpi=300)
    plt.close(fig)


def make_all(ctx, fdir):
    os.makedirs(fdir, exist_ok=True)
    prof, sweeps, net, win, cons, st, ref = (ctx[k] for k in ("prof", "sweeps", "net", "win", "cons", "st", "ref"))
    bm = maps.Basemap(ctx["dem"])
    s_all = st[st["product_ok"]]
    for pid in net["profile_id"].unique():
        p = prof[prof["profile_id"] == pid].sort_values("chainage_m")
        p = p[~p["drift_mode"].str.startswith("EXTRAP")]
        _profile_sheet(p, sweeps, net, bm, s_all, fdir)
    summary_forest(net, cons, fdir)
    windows_map(bm, win, s_all, ref, fdir)
    windows_hist(win, cons, fdir)
