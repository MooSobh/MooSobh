"""Gravity reduction terms.  All gravity values in mGal, heights in metres.

Sign conventions (corrections are *added* to observed gravity unless stated):
  normal gravity      gamma(phi) is *subtracted* (anomaly = g_obs - gamma + ...)
  free-air            +FA(h)  with FA(h) = (0.3087691 - 0.0004398 sin^2 phi) h - 7.2125e-8 h^2
                      (second-order normal-gravity height gradient, Hinze et al. 2005)
  Bouguer slab        -2 pi G rho h = -0.04193 rho[g/cm3] h[m]
"""
import numpy as np

BOUGUER_K = 0.04193  # mGal per (g/cm3 * m)


def normal_gravity_wgs84(lat_deg):
    """Somigliana closed form, WGS84 ellipsoid, mGal."""
    s2 = np.sin(np.radians(lat_deg)) ** 2
    return 978032.53359 * (1 + 0.00193185265241 * s2) / np.sqrt(1 - 0.00669437999013 * s2)


def free_air_term(lat_deg, h_m):
    s2 = np.sin(np.radians(lat_deg)) ** 2
    return (0.3087691 - 0.0004398 * s2) * h_m - 7.2125e-8 * h_m ** 2


def bouguer_slab(rho_gcc, h_m):
    return BOUGUER_K * rho_gcc * h_m
