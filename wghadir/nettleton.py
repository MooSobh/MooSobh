"""Nettleton (1939) density profiling along continuous traverses.

For each trial density rho the base-relative simple Bouguer quantity along a
profile is  B(rho) = FA_rel - 0.04193 rho dh.  A linear regional trend in
chainage is removed from both B(rho) and dh; the density at which the
residual B is uncorrelated with residual topography is the Nettleton estimate.
This is algebraically identical to the Parasnis-type regression
FA_rel = a + b x + rho * (0.04193 dh), which also yields a standard error.
"""
import numpy as np
import pandas as pd

from .reduce import BOUGUER_K

RHO_GRID = np.round(np.arange(1.80, 3.2001, 0.01), 2)


def _detrend(x, y):
    A = np.column_stack([np.ones_like(x), x])
    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    return y - A @ coef


def sweep(chain_m, dh, fa_rel, rho_grid=RHO_GRID):
    x = np.asarray(chain_m, float) / 1000.0
    h_res = _detrend(x, np.asarray(dh, float))
    rows = []
    for rho in rho_grid:
        b = np.asarray(fa_rel, float) - BOUGUER_K * rho * np.asarray(dh, float)
        b_res = _detrend(x, b)
        r = np.corrcoef(b_res, h_res)[0, 1]
        rough = np.sqrt(np.mean(np.diff(b, 2) ** 2)) if len(b) > 2 else np.nan
        rows.append(dict(rho=rho, corr_detrended=r, rms_detrended_mgal=np.sqrt(np.mean(b_res ** 2)),
                         roughness_2nd_diff_mgal=rough))
    return pd.DataFrame(rows)


def regression_density(chain_m, dh, fa_rel):
    """rho and its standard error from FA_rel = a + b x + rho*(k dh)."""
    x = np.asarray(chain_m, float) / 1000.0
    z = BOUGUER_K * np.asarray(dh, float)
    y = np.asarray(fa_rel, float)
    A = np.column_stack([np.ones_like(x), x, z])
    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    res = y - A @ coef
    dof = max(len(y) - 3, 1)
    s2 = res @ res / dof
    cov = s2 * np.linalg.pinv(A.T @ A)
    return coef[2], np.sqrt(cov[2, 2]), np.sqrt(s2)


def block_bootstrap(chain_m, dh, fa_rel, n_boot=2000, block=5, seed=1):
    """Moving-block bootstrap of the regression density (blocks of adjacent stations)."""
    rng = np.random.default_rng(seed)
    n = len(dh)
    x, z, y = (np.asarray(v, float) for v in (chain_m, dh, fa_rel))
    starts = np.arange(0, max(n - block + 1, 1))
    est = []
    for _ in range(n_boot):
        idx = np.concatenate([np.arange(s, min(s + block, n)) for s in rng.choice(starts, int(np.ceil(n / block)))])[:n]
        if np.ptp(z[idx]) < 1.0:
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
