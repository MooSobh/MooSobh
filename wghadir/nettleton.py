"""Nettleton (1939) density profiling along continuous traverses.

For a trial density rho the base-relative Bouguer quantity along a profile is

    B(rho) = dFA - rho * u

where u is the Bouguer effect for 1 g/cm3 relative to base 100:
  simple Bouguer   u = 0.04193 * dH                      (infinite slab)
  complete Bouguer u = g1(station) - g1(base 100)        (DEM prisms, see terrain.py)

A linear regional trend in chainage is removed from B(rho) and from the station
height; the density at which the residual B is uncorrelated with residual
topography is the Nettleton estimate.  It equals the regression estimate from
dFA = a + b x + rho * u, which also yields a standard error.
"""
import numpy as np
import pandas as pd

RHO_GRID = np.round(np.arange(1.80, 3.2001, 0.01), 2)


def _detrend(x, y):
    A = np.column_stack([np.ones_like(x), x])
    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    return y - A @ coef


def sweep(chain_m, h, u, fa, rho_grid=RHO_GRID):
    x = np.asarray(chain_m, float) / 1000.0
    h_res = _detrend(x, np.asarray(h, float))
    rows = []
    for rho in rho_grid:
        b = np.asarray(fa, float) - rho * np.asarray(u, float)
        b_res = _detrend(x, b)
        r = np.corrcoef(b_res, h_res)[0, 1]
        rough = np.sqrt(np.mean(np.diff(b, 2) ** 2)) if len(b) > 2 else np.nan
        rows.append(dict(rho=rho, corr_detrended=r, rms_detrended_mgal=np.sqrt(np.mean(b_res ** 2)),
                         roughness_2nd_diff_mgal=rough))
    return pd.DataFrame(rows)


def regression_density(chain_m, u, fa):
    """rho and its standard error from dFA = a + b x + rho * u."""
    x = np.asarray(chain_m, float) / 1000.0
    z = np.asarray(u, float)
    y = np.asarray(fa, float)
    A = np.column_stack([np.ones_like(x), x, z])
    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    res = y - A @ coef
    dof = max(len(y) - 3, 1)
    s2 = res @ res / dof
    cov = s2 * np.linalg.pinv(A.T @ A)
    return coef[2], np.sqrt(cov[2, 2]), np.sqrt(s2)


def block_bootstrap(chain_m, u, fa, n_boot=2000, block=5, seed=1):
    """Moving-block bootstrap of the regression density (blocks of adjacent stations)."""
    rng = np.random.default_rng(seed)
    n = len(u)
    x, z, y = (np.asarray(v, float) for v in (chain_m, u, fa))
    starts = np.arange(0, max(n - block + 1, 1))
    est = []
    for _ in range(n_boot):
        idx = np.concatenate([np.arange(s, min(s + block, n)) for s in rng.choice(starts, int(np.ceil(n / block)))])[:n]
        if np.ptp(z[idx]) < 0.04:
            continue
        est.append(regression_density(x[idx], z[idx], y[idx])[0])
    est = np.array(est)
    return np.percentile(est, [2.5, 50, 97.5]), len(est)


def zero_crossing(sw):
    r = sw["corr_detrended"].values
    rho = sw["rho"].values
    s = np.where(np.sign(r[:-1]) != np.sign(r[1:]))[0]
    if len(s) == 0:
        return np.nan
    i = s[0]
    return rho[i] + (rho[i + 1] - rho[i]) * (0 - r[i]) / (r[i + 1] - r[i])
