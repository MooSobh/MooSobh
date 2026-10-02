"""Publication figures.  Each function writes one PNG (300 dpi) into fdir."""
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm  # noqa: E402

# reference categorical palette (fixed order) and status colour
C = {"CG6-0640": "#2a78d6", "CG6-0313": "#eb6834", "third": "#1baf7a", "violet": "#4a3aa7",
     "reject": "#e34948", "ink": "#0b0b0b", "ink2": "#52514e", "grid": "#d9d8d3"}
LABEL = {"CG6-0640": "CG-6 #0640 (new)", "CG6-0313": "CG-6 #0313 (old)"}
DIVERGING = LinearSegmentedColormap.from_list(
    "bluegrayred", ["#104281", "#2a78d6", "#9ec5f4", "#f0efec", "#f4a3a2", "#e34948", "#8f1d1c"])

plt.rcParams.update({
    "font.size": 9, "axes.titlesize": 10, "axes.labelsize": 9, "legend.fontsize": 8,
    "axes.edgecolor": C["ink2"], "axes.labelcolor": C["ink"], "xtick.color": C["ink2"], "ytick.color": C["ink2"],
    "axes.grid": True, "grid.color": C["grid"], "grid.linewidth": 0.5, "axes.spines.top": False,
    "axes.spines.right": False, "figure.dpi": 110, "savefig.dpi": 300, "savefig.bbox": "tight",
    "lines.linewidth": 1.2, "legend.frameon": False,
})


def _save(fig, fdir, name):
    fig.savefig(os.path.join(fdir, name))
    plt.close(fig)


def _lonlat_aspect(ax, lat=24.77):
    ax.set_aspect(1 / np.cos(np.radians(lat)))
    ax.set_xlabel("Longitude [°E]")
    ax.set_ylabel("Latitude [°N]")


def fig_map(ctx, fdir):
    occ, P = ctx["occ"], ctx["P"]
    fig, ax = plt.subplots(figsize=(7.2, 6.0))
    f = occ[occ["role"] == "field"]
    for inst in ("CG6-0640", "CG6-0313"):
        m = f[(f["instrument"] == inst) & f["match_status"].isin(["MATCHED", "MATCHED_ID_TIEBREAK"])]
        ax.scatter(m["lon"], m["lat"], s=7, color=C[inst], label=f"{LABEL[inst]} – matched ({len(m)})", lw=0)
    u = f[~f["match_status"].isin(["MATCHED", "MATCHED_ID_TIEBREAK"])]
    ax.scatter(u["lon_cg6"], u["lat_cg6"], s=22, marker="x", color=C["reject"], lw=1,
               label=f"no GNSS match ≤30 m ({len(u)}; CG-6 GPS position)")
    b = ctx["ref"]["base_100"]
    ax.plot(b["lon"], b["lat"], marker="^", ms=10, color=C["ink"], ls="", label="Base 100 (field control)")
    ax.annotate("Base 100", (b["lon"], b["lat"]), xytext=(6, -10), textcoords="offset points", fontsize=8)
    ax.annotate("Station 0 (hotel, 25.0668°N 34.8777°E)\nlies ~31 km NNW, outside the map",
                (0.99, 0.02), xycoords="axes fraction", ha="right", va="bottom", fontsize=7.5, color=C["ink2"])
    _lonlat_aspect(ax)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=2)
    ax.set_title("Survey coverage, Wadi Ghadir (16–24 Jan 2026)")
    _save(fig, fdir, "fig01_coverage_map.png")


def fig_tide(ctx, fdir):
    df = ctx["df"]
    fig, axes = plt.subplots(2, 1, figsize=(7.2, 5.6), sharex=True, gridspec_kw=dict(hspace=0.35))
    d = df[(df["instrument"] == "CG6-0313")]
    ax = axes[0]
    ax.plot(d["time_utc"], d["TideCorr"] * 1000, ".", ms=2.5, color=C["CG6-0313"], label="on-board TideCorr (user position 43.79°N, 79.50°W)")
    ax.plot(d["time_utc"], d["tide_longman_gps"] * 1000, ".", ms=2.5, color=C["CG6-0640"], label="Longman re-computed at station position")
    ax.set_ylabel("Tide correction [µGal]")
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.04), ncol=2, markerscale=3)
    ax.set_title("CG-6 #0313: on-board tide used a wrong (factory default) position")
    ax = axes[1]
    for inst in ("CG6-0313", "CG6-0640"):
        d = df[df["instrument"] == inst]
        ax.plot(d["time_utc"], d["tide_replacement_mgal"] * 1000, ".", ms=2.5, color=C[inst],
                label=f"{LABEL[inst]}: re-computed − on-board")
    ax.set_ylabel("Difference [µGal]")
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.30), ncol=2, markerscale=3)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    ax.set_xlabel("Date (UTC, 2026)")
    _save(fig, fdir, "fig02_tide_check.png")


def fig_corrections(ctx, fdir):
    df = ctx["df"]
    fig, axes = plt.subplots(4, 2, figsize=(7.2, 7.6), sharex="col")
    terms = [("TideCorr", "Tide [mGal]"), ("TiltCorr", "Tilt corr. [mGal]"), ("TempCorr", "Temperature corr. [mGal]"),
             ("DriftCorr", "On-board drift corr. [mGal]")]
    for j, inst in enumerate(("CG6-0640", "CG6-0313")):
        d = df[df["instrument"] == inst]
        ok = d["accepted"]
        for i, (col, lab) in enumerate(terms):
            ax = axes[i, j]
            ax.plot(d.loc[ok, "time_utc"], d.loc[ok, col], ".", ms=2, color=C[inst])
            ax.plot(d.loc[~ok, "time_utc"], d.loc[~ok, col], "x", ms=4, color=C["reject"], lw=0.8)
            if col == "TiltCorr":
                ax.set_ylim(-0.001, 0.02)
            if j == 0:
                ax.set_ylabel(lab)
        axes[0, j].set_title(LABEL[inst])
        axes[-1, j].xaxis.set_major_formatter(mdates.DateFormatter("%d"))
        axes[-1, j].set_xlabel("Day of Jan 2026 (UTC)")
    fig.suptitle("Instrument-applied correction terms (as exported; ✕ = rejected rows; tilt axis clipped at 0.02 mGal)", fontsize=9)
    fig.tight_layout()
    _save(fig, fdir, "fig03_correction_terms.png")


def fig_timeseries(ctx, fdir):
    df = ctx["df"]
    fig, axes = plt.subplots(2, 1, figsize=(7.2, 5.8), sharex=True)
    for ax, inst in zip(axes, ("CG6-0640", "CG6-0313")):
        d = df[df["instrument"] == inst]
        ok = d["accepted"]
        ax.plot(d.loc[ok, "time_utc"], d.loc[ok, "g_tidefix"], ".", ms=2, color=C[inst], label="accepted (tide re-computed)")
        ax.plot(d.loc[~ok, "time_utc"], d.loc[~ok, "g_tidefix"], "x", ms=5, color=C["reject"], label="rejected")
        for role, mk in (("100", "^"), ("0", "s")):
            m = ok & (d["Station"] == role) & (d["Line"] == "0")
            ax.plot(d.loc[m, "time_utc"], d.loc[m, "g_tidefix"], mk, ms=3.5, mfc="none", color=C["ink"],
                    mew=0.6, label=f"station {role} (Line 0)")
        lo, hi = np.nanpercentile(d.loc[ok, "g_tidefix"], [0.5, 99.5])
        ax.set_ylim(lo - 8, hi + 8)
        ax.set_ylabel("Corrected reading [mGal]")
        ax.set_title(LABEL[inst] + (" – frozen-sensor rows (≈7268 mGal) lie below the axis" if inst == "CG6-0313" else ""))
    axes[0].legend(loc="lower center", bbox_to_anchor=(0.5, 1.12), ncol=4, markerscale=1.5)
    axes[-1].xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    axes[-1].set_xlabel("Date (UTC, 2026)")
    _save(fig, fdir, "fig04_reading_timeseries.png")


def fig_qc(ctx, fdir):
    df = ctx["df"]
    from .qc import THRESHOLDS as TH
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.3))
    ax = axes[0]
    bins = np.linspace(0, 0.1, 41)
    for inst in ("CG6-0640", "CG6-0313"):
        ax.hist(df.loc[df["instrument"] == inst, "StdDev"].clip(upper=0.0999), bins=bins, histtype="step",
                color=C[inst], lw=1.4, label=LABEL[inst])
    ax.axvline(TH["stddev_warn_mgal"], color=C["ink2"], ls="--", lw=0.8)
    ax.axvline(TH["stddev_reject_mgal"], color=C["reject"], ls="-", lw=1)
    ax.text(TH["stddev_reject_mgal"], ax.get_ylim()[1] * 0.9, " reject", color=C["reject"], fontsize=8)
    ax.text(TH["stddev_warn_mgal"], ax.get_ylim()[1] * 0.75, " warn", color=C["ink2"], fontsize=8)
    ax.set_xlabel("StdDev of 60-s reading [mGal] (clipped at 0.1)")
    ax.set_ylabel("Readings")
    ax.legend(loc="upper right")
    ax = axes[1]
    for inst in ("CG6-0640", "CG6-0313"):
        d = df[df["instrument"] == inst]
        ax.plot(d["X"].clip(-45, 45), d["Y"].clip(-45, 45), ".", ms=2.5, color=C[inst], label=LABEL[inst])
    r = df[~df["accepted"]]
    ax.plot(r["X"].clip(-45, 45), r["Y"].clip(-45, 45), "x", ms=5, color=C["reject"], label="rejected (any reason)")
    t = TH["tilt_reject_arcsec"]
    ax.plot([-t, t, t, -t, -t], [-t, -t, t, t, -t], color=C["reject"], lw=1)
    ax.set_xlim(-46, 46)
    ax.set_ylim(-46, 46)
    ax.set_aspect(1)
    ax.set_xlabel("X tilt [arcsec] (clipped ±45)")
    ax.set_ylabel("Y tilt [arcsec]")
    ax.legend(loc="lower left", fontsize=7)
    fig.tight_layout()
    _save(fig, fdir, "fig05_qc_stddev_tilt.png")


def fig_base100(ctx, fdir):
    occ, ctrl = ctx["occ"], ctx["ctrl"]
    dates = sorted(occ["date"].unique())
    fig, axes = plt.subplots(len(dates), 2, figsize=(7.2, 1.15 * len(dates) + 0.8), sharex=False)
    for j, inst in enumerate(("CG6-0640", "CG6-0313")):
        for i, date in enumerate(dates):
            ax = axes[i, j]
            b = occ[(occ["instrument"] == inst) & (occ["date"] == date) & (occ["role"] == "field_base_100")]
            c = ctrl[(ctrl["instrument"] == inst) & (ctrl["date"] == date)].sort_values("t")
            c100 = c[c["source"] == "station 100"]
            if len(c100):
                ref = c100["g100"].iloc[0]
            elif len(c):
                ref = c["g100"].iloc[0]
            else:
                ref = np.nan
            hrs = lambda t: (pd.to_datetime(t) - pd.Timestamp(date)) / pd.Timedelta(hours=1)  # noqa: E731
            if len(c):
                ax.plot(hrs(c["t"]), (c["g100"] - ref) * 1000, "-", color=C[inst], lw=1)
                hc = c[c["source"] != "station 100"]
                ax.plot(hrs(hc["t"]), (hc["g100"] - ref) * 1000, "s", mfc="white", color=C[inst], ms=4)
            ok = b[b["valid_control"]]
            ax.errorbar(hrs(ok["t_mid"]), (ok["g_occ"] - ref) * 1000, yerr=ok["sigma_occ"] * 1000, fmt="o", ms=3.5,
                        color=C[inst], capsize=0)
            bad = b[~b["valid_control"]]
            for _, r in bad.iterrows():
                ax.annotate("✕ frozen", (hrs(r["t_mid"]), 0), color=C["reject"], fontsize=7, ha="center")
            ax.set_xlim(3, 19)
            ax.tick_params(labelsize=7)
            if j == 0:
                ax.set_ylabel(date[5:], fontsize=8)
            if i == 0:
                ax.set_title(LABEL[inst] + "\nstation-100 value − first of day [µGal]", fontsize=9)
            if i < len(dates) - 1:
                ax.set_xticklabels([])
        axes[-1, j].set_xlabel("Hour of day (UTC)")
    from matplotlib.lines import Line2D
    fig.legend(handles=[Line2D([], [], marker="o", ls="-", color=C["ink2"], ms=4, label="station-100 occupation (±σ)"),
                        Line2D([], [], marker="s", ls="", mfc="white", color=C["ink2"], ms=4,
                               label="station 0 converted with median 0→100 tie"),
                        Line2D([], [], ls="-", color=C["ink2"], label="piecewise-linear drift model")],
               loc="lower center", ncol=3, bbox_to_anchor=(0.5, -0.02), fontsize=7.5)
    fig.text(0.01, 0.5, "Date (2026)", rotation=90, va="center", fontsize=8)
    fig.tight_layout(rect=(0.02, 0.025, 1, 1))
    _save(fig, fdir, "fig06_base100_daily.png")


def fig_ties(ctx, fdir):
    ties, closures = ctx["ties"], ctx["closures"]
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.2))
    ax = axes[0]
    for inst, off in (("CG6-0640", -0.1), ("CG6-0313", 0.1)):
        d = ties[(ties["instrument"] == inst) & ties["tie_raw_mgal"].notna()]
        x = pd.to_datetime(d["date"]).dt.day + off + np.where(d["leg"] == "evening", 0.25, -0.25) * 0.4
        ax.plot(x, -d["tie_raw_mgal"], "o", ms=4, color=C[inst], label=LABEL[inst])
        ax.axhline(-d["tie_raw_mgal"].mean(), color=C[inst], lw=0.8, ls="--")
    ax.set_xlabel("Day of January 2026")
    ax.set_ylabel("g(0) − g(100) [mGal, instr. units]")
    ax.set_title("Hotel 0 – base 100 tie (both legs)")
    ax.legend(loc="center right")
    ax = axes[1]
    for inst in ("CG6-0640", "CG6-0313"):
        d = closures[closures["instrument"] == inst]
        ax.plot(pd.to_datetime(d["date"]).dt.day, d["hotel_closure_mgal"] * 1000, "o-", ms=4, color=C[inst], label=LABEL[inst])
    ax.axhline(0, color=C["ink2"], lw=0.6)
    ax.set_xlabel("Day of January 2026")
    ax.set_ylabel("Evening − morning at station 0 [µGal]")
    ax.set_title("Daily hotel closure (after on-board drift)")
    ax.legend(loc="lower left")
    fig.tight_layout()
    _save(fig, fdir, "fig07_ties_and_closures.png")


def fig_instruments(ctx, fdir):
    pairs, sc = ctx["pairs"], ctx["sc"]
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.3))
    ax = axes[0]
    ext = pairs["drift_mode_0313"].str.startswith("EXTRAP")
    ax.plot(pairs.loc[~ext, "dg100_0313"], pairs.loc[~ext, "dg100_0640"], "o", color=C["violet"], ms=5,
            label="co-located, both interpolated")
    ax.plot(pairs.loc[ext, "dg100_0313"], pairs.loc[ext, "dg100_0640"], "D", mfc="white", color=C["CG6-0313"], ms=5,
            label="#0313 drift extrapolated (18 Jan L5)")
    x = np.linspace(-45, 10, 10)
    ax.plot(x, x, color=C["ink2"], lw=0.8, ls=":", label="1:1")
    ax.plot(x, sc["k_tie"] * x, color=C["CG6-0640"], lw=1, label=f"k from 0–100 ties = {sc['k_tie']:.4f}")
    ax.set_xlabel("Δg to base 100, #0313 [mGal]")
    ax.set_ylabel("Δg to base 100, #0640 [mGal]")
    ax.legend(loc="upper left", fontsize=7)
    ax.set_title("Co-located stations (≤10 m, |Δh| ≤ 0.5 m)")
    ax = axes[1]
    r = pairs["dg100_0640"] - sc["k_tie"] * pairs["dg100_0313"]
    ax.errorbar(pairs["dg100_0313"], r * 1000, yerr=np.hypot(pairs["sigma_0640"], pairs["sigma_0313"]) * 1000,
                fmt="none", ecolor=C["grid"])
    ax.plot(pairs.loc[~ext, "dg100_0313"], r[~ext] * 1000, "o", color=C["violet"], ms=5)
    ax.plot(pairs.loc[ext, "dg100_0313"], r[ext] * 1000, "D", mfc="white", color=C["CG6-0313"], ms=5)
    ax.axhline(0, color=C["ink2"], lw=0.6)
    ax.set_xlabel("Δg to base 100, #0313 [mGal]")
    ax.set_ylabel("#0640 − k·#0313 [µGal]")
    ax.set_title("Residual after scale k")
    fig.tight_layout()
    _save(fig, fdir, "fig08_instrument_comparison.png")


def fig_gnss(ctx, fdir):
    dm, occ = ctx["datum_marks"], ctx["occ"]
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.2))
    ax = axes[0]
    for mark, col, lab in (("hotel_0", C["third"], "Base 0 (hotel)"), ("base_100", C["violet"], "Base 100")):
        d = dm[dm["mark"] == mark]
        ax.plot(d["gnss_day"], d["dh_m"], "o-", color=col, ms=4, label=lab)
    ax.axhline(0, color=C["ink2"], lw=0.6)
    ax.set_xlabel("GNSS day file (day1 = 16 Jan)")
    ax.set_ylabel("Height − multi-day median [m]")
    ax.set_title("Base-mark height repeatability")
    ax.legend(loc="upper left")
    ax = axes[1]
    for inst in ("CG6-0640", "CG6-0313"):
        d = occ[(occ["instrument"] == inst) & occ["match_status"].isin(["MATCHED", "MATCHED_ID_TIEBREAK"])]
        ax.hist(d["match_dist_m"], bins=np.arange(0, 31, 1), histtype="step", lw=1.4, color=C[inst], label=LABEL[inst])
    ax.set_xlabel("CG-6 GPS → GNSS point separation [m]")
    ax.set_ylabel("Occupations")
    ax.set_title("Coordinate match distance")
    ax.legend(loc="upper right")
    fig.tight_layout()
    _save(fig, fdir, "fig09_gnss_checks.png")


def fig_anomaly_maps(ctx, fdir):
    st = ctx["st"]
    s = st[st["product_ok"]]
    fig, axes = plt.subplots(1, 3, figsize=(7.4, 2.55), sharey=True, layout="constrained")
    for ax, (col, title) in zip(axes, (("dh_m", "Height rel. base 100 [m]"),
                                       ("dFA_rel_mgal", "ΔFA rel. base 100 [mGal]"),
                                       ("dSB_rel_rho2.67_mgal", "ΔSB (2.67) rel. base 100 [mGal]"))):
        v = s[col]
        if col == "dh_m":
            sc_ = ax.scatter(s["lon"], s["lat"], c=v, s=6, cmap="cividis", lw=0)
        else:
            lim = np.nanpercentile(np.abs(v), 98)
            sc_ = ax.scatter(s["lon"], s["lat"], c=v, s=6, cmap=DIVERGING, norm=TwoSlopeNorm(0, -lim, lim), lw=0)
        cb = fig.colorbar(sc_, ax=ax, orientation="horizontal", pad=0.02, shrink=0.9)
        cb.ax.tick_params(labelsize=7)
        cb.set_label(title, fontsize=8)
        _lonlat_aspect(ax)
        ax.tick_params(labelsize=7)
        if ax is not axes[0]:
            ax.set_ylabel("")
    fig.suptitle("Base-relative products – provisional (no terrain correction, no absolute datum)", fontsize=9)
    _save(fig, fdir, "fig10_relative_anomaly_maps.png")


def fig_nettleton(ctx, fdir):
    sweeps, net, prof, win = ctx["sweeps"], ctx["net"], ctx["prof"], ctx["win"]
    # (a) correlation vs density for every eligible profile
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.4))
    ax = axes[0]
    for pid, d in sweeps.groupby("profile_id"):
        col = C["CG6-0640"] if pid.startswith("N") else C["CG6-0313"]
        ax.plot(d["rho"], d["corr_detrended"], color=col, lw=0.9, alpha=0.8)
    ax.axhline(0, color=C["ink2"], lw=0.6)
    ax.axvline(2.67, color=C["ink2"], lw=0.6, ls="--")
    ax.set_xlabel("Trial density ρ [g/cm³]")
    ax.set_ylabel("corr(detrended ΔSB, detrended Δh)")
    ax.set_title(f"Nettleton sweeps, {net['profile_id'].nunique()} profiles")
    ax.plot([], [], color=C["CG6-0640"], label="#0640 traverses")
    ax.plot([], [], color=C["CG6-0313"], label="#0313 lines")
    ax.legend(loc="lower left")
    ax = axes[1]
    w = win[win["rho_se"] < 1.0].sort_values("rho_regression")
    y = np.arange(len(w))
    ax.errorbar(w["rho_regression"], y, xerr=1.96 * w["rho_se"], fmt="none", ecolor=C["grid"], capsize=0)
    for inst in ("CG6-0640", "CG6-0313"):
        m = w["instrument"].values == inst
        ax.plot(w["rho_regression"].values[m], y[m], "o", ms=4, color=C[inst], label=LABEL[inst])
    ax.axvspan(2.0, 3.0, color=C["grid"], alpha=0.35, lw=0)
    ax.axvline(2.67, color=C["ink2"], lw=0.6, ls="--")
    ax.set_xlim(-1, 7)
    ax.set_yticks([])
    ax.set_xlabel("Window density estimate ±1.96 SE [g/cm³]")
    ax.set_title(f"3-km windows with SE < 1 g/cm³ (n = {len(w)})")
    ax.legend(loc="lower right", fontsize=7)
    fig.tight_layout()
    _save(fig, fdir, "fig11_nettleton_summary.png")

    # (b) anomaly vs topography for the profiles with the tightest estimates
    best = net.sort_values("rho_regression_se").head(4)["profile_id"].tolist()
    fig, axes = plt.subplots(2, len(best), figsize=(7.4, 4.4), sharex="col")
    for j, pid in enumerate(best):
        p = prof[prof["profile_id"] == pid].sort_values("chainage_m")
        p = p[~p["drift_mode"].str.startswith("EXTRAP")]
        x = p["chainage_m"] / 1000
        ax = axes[0, j]
        ax.plot(x, p["h_used"], color=C["ink2"], lw=1)
        ax.set_title(pid, fontsize=8)
        if j == 0:
            ax.set_ylabel("Height [m]")
        ax = axes[1, j]
        for rho, col in ((2.2, C["third"]), (2.67, C["ink"]), (3.0, C["violet"])):
            b = p["dFA_rel_mgal"] - 0.04193 * rho * p["dh_m"]
            ax.plot(x, b - b.mean(), color=col, lw=1, label=f"ρ = {rho}")
        ax.set_xlabel("Chainage [km]")
        if j == 0:
            ax.set_ylabel("ΔSB − mean [mGal]")
        ax.tick_params(labelsize=7)
    axes[1, 0].legend(loc="best", fontsize=7)
    fig.suptitle("Topography and simple-Bouguer profiles for three trial densities (no terrain correction)", fontsize=9)
    fig.tight_layout()
    _save(fig, fdir, "fig12_nettleton_profiles.png")


def make_all(ctx, fdir):
    """QC figures into fdir; maps, grids and Nettleton sheets into sibling folders."""
    from . import maps, nettleton_figs

    for f in (fig_map, fig_tide, fig_corrections, fig_timeseries, fig_qc, fig_base100, fig_ties, fig_instruments,
              fig_gnss):
        f(ctx, fdir)
    root = os.path.dirname(os.path.abspath(fdir))
    print("  maps ...", flush=True)
    cv = maps.make_all(ctx, os.path.join(root, "maps"), os.path.join(root, "grids"))
    print("  Nettleton figures ...", flush=True)
    nettleton_figs.make_all(ctx, os.path.join(root, "nettleton"))
    return cv
