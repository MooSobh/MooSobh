"""Longman (1959) solid-earth tide for relative gravimetry.

Implements I. M. Longman (1959), "Formulas for computing the tidal accelerations
due to the moon and the sun", J. Geophys. Res. 64(12), 2351-2355.  This is the
formula family used on board Scintrex CG-5/CG-6 meters, so it allows a controlled
re-computation of the instrument TideCorr column at a different position or time.

Returned value is the *correction* in mGal that is added to an observed reading,
i.e. minus the vertical tidal acceleration, with the Love-number style amplitude
factor 1.16 used by the CG-6.  The sign is checked numerically against the
instrument column in the processing log (see wghadir.qc.tide_check).
"""
import numpy as np
import pandas as pd

_ARCSEC = np.pi / (180.0 * 3600.0)
_DEG = np.pi / 180.0

# Longman constants (cgs units)
_MU = 6.670e-8          # gravitational constant
_M = 7.3537e25          # mass of the moon [g]
_S = 1.993e33           # mass of the sun [g]
_E = 0.05490            # eccentricity of the lunar orbit
_MM = 0.074804          # ratio of mean motion of sun to that of moon
_C = 3.84402e10         # mean earth-moon distance [cm]
_C1 = 1.495e13          # mean earth-sun distance [cm]
_A = 6.378270e8         # earth equatorial radius [cm]
_I = 5.145 * _DEG       # inclination of lunar orbit to ecliptic
_OMEGA = 23.452 * _DEG  # obliquity of the ecliptic
AMPLITUDE_FACTOR = 1.16


def longman_correction(t_utc, lat_deg, lon_deg, h_m=0.0, factor=AMPLITUDE_FACTOR):
    """Tide correction [mGal] to be *added* to a gravity reading.

    t_utc   : array-like of datetimes interpreted as UTC
    lat_deg : geodetic latitude, degrees north
    lon_deg : longitude, degrees east
    h_m     : height above the ellipsoid/sea level [m] (effect is negligible)
    """
    t = pd.DatetimeIndex(pd.to_datetime(t_utc))
    lat = np.broadcast_to(np.asarray(lat_deg, float), (len(t),)) * _DEG
    lon = np.broadcast_to(np.asarray(lon_deg, float), (len(t),))
    h = np.broadcast_to(np.asarray(h_m, float), (len(t),))

    epoch = pd.Timestamp("1899-12-31 12:00:00")
    days = (t - epoch) / pd.Timedelta(days=1)
    T = np.asarray(days, float) / 36525.0
    t0 = np.asarray(t.hour + t.minute / 60.0 + (t.second + t.microsecond * 1e-6) / 3600.0, float)

    # mean orbital elements, Longman eqs. (10)-(12)
    s = (270.0 + 26 / 60 + 11.72 / 3600) * _DEG + (1336 * 2 * np.pi + 1108406.05 * _ARCSEC) * T \
        + 7.128 * _ARCSEC * T**2 + 0.0072 * _ARCSEC * T**3
    p = (334.0 + 19 / 60 + 46.42 / 3600) * _DEG + (11 * 2 * np.pi + 392522.51 * _ARCSEC) * T \
        - 37.15 * _ARCSEC * T**2 - 0.036 * _ARCSEC * T**3
    hs = (279.0 + 41 / 60 + 48.05 / 3600) * _DEG + 129602768.11 * _ARCSEC * T + 1.080 * _ARCSEC * T**2
    N = (259.0 + 10 / 60 + 57.12 / 3600) * _DEG - (5 * 2 * np.pi + 482912.63 * _ARCSEC) * T \
        + 7.58 * _ARCSEC * T**2 + 0.008 * _ARCSEC * T**3
    ps = (281.0 + 13 / 60 + 15.0 / 3600) * _DEG + 6189.03 * _ARCSEC * T + 1.63 * _ARCSEC * T**2 \
        + 0.012 * _ARCSEC * T**3
    e1 = 0.01675104 - 0.00004180 * T - 0.000000126 * T**2

    # moon
    cosI = np.cos(_OMEGA) * np.cos(_I) - np.sin(_OMEGA) * np.sin(_I) * np.cos(N)
    I = np.arccos(cosI)
    nu = np.arcsin(np.sin(_I) * np.sin(N) / np.sin(I))
    cos_alpha = np.cos(N) * np.cos(nu) + np.sin(N) * np.sin(nu) * np.cos(_OMEGA)
    sin_alpha = np.sin(_OMEGA) * np.sin(N) / np.sin(I)
    alpha = 2.0 * np.arctan2(sin_alpha, 1.0 + cos_alpha)
    xi = N - alpha
    sigma = s - xi
    l_moon = sigma + 2 * _E * np.sin(s - p) + 1.25 * _E**2 * np.sin(2 * (s - p)) \
        + 3.75 * _MM * _E * np.sin(s - 2 * hs + p) + (11.0 / 8.0) * _MM**2 * np.sin(2 * (s - hs))

    # hour angle of the mean sun at the station (east longitude positive)
    t_ha = (15.0 * (t0 - 12.0) + lon) * _DEG
    chi = t_ha + hs - nu
    chi1 = t_ha + hs

    l_sun = hs + 2 * e1 * np.sin(hs - ps)

    cos_theta = np.sin(lat) * np.sin(I) * np.sin(l_moon) + np.cos(lat) * (
        np.cos(I / 2) ** 2 * np.cos(l_moon - chi) + np.sin(I / 2) ** 2 * np.cos(l_moon + chi))
    cos_phi = np.sin(lat) * np.sin(_OMEGA) * np.sin(l_sun) + np.cos(lat) * (
        np.cos(_OMEGA / 2) ** 2 * np.cos(l_sun - chi1) + np.sin(_OMEGA / 2) ** 2 * np.cos(l_sun + chi1))

    a_prime = 1.0 / (_C * (1 - _E**2))
    inv_d = 1.0 / _C + a_prime * _E * np.cos(s - p) + a_prime * _E**2 * np.cos(2 * (s - p)) \
        + (15.0 / 8.0) * a_prime * _MM * _E * np.cos(s - 2 * hs + p) + a_prime * _MM**2 * np.cos(2 * (s - hs))
    a1_prime = 1.0 / (_C1 * (1 - e1**2))
    inv_D = 1.0 / _C1 + a1_prime * e1 * np.cos(hs - ps)

    C2 = 1.0 / (1.0 + 0.006738 * np.sin(lat) ** 2)
    r = np.sqrt(C2) * _A + h * 100.0

    g_moon = _MU * _M * r * inv_d**3 * (3 * cos_theta**2 - 1) \
        + 1.5 * _MU * _M * r**2 * inv_d**4 * (5 * cos_theta**3 - 3 * cos_theta)
    g_sun = _MU * _S * r * inv_D**3 * (3 * cos_phi**2 - 1)
    # g_moon + g_sun is the upward tidal acceleration in Gal; the correction
    # added to a reading is +factor*(g) (an upward pull lowers the reading).
    return factor * (g_moon + g_sun) * 1000.0
