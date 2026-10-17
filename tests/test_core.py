"""Regression tests: run with  python -m pytest -q

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
"""
import os

import numpy as np
import pytest

from wghadir.gravity import cg6, gnss, reduce, settings
from wghadir.gravity.tide import longman_correction

RAW = os.path.join(os.path.dirname(__file__), "..", "data", "raw")


def test_dms_parsing():
    assert gnss.dms_to_deg("N24°49'28.06755\" \xa0") == pytest.approx(24.824463209, abs=1e-9)
    assert gnss.dms_to_deg("E34°59'46.36109\"") == pytest.approx(34.996211414, abs=1e-9)


def test_normal_gravity_wgs84():
    assert reduce.normal_gravity_wgs84(0.0) == pytest.approx(978032.53359, abs=1e-5)
    assert reduce.normal_gravity_wgs84(90.0) == pytest.approx(983218.49378, abs=1e-3)


def test_bouguer_slab_constant():
    assert reduce.bouguer_slab(2.67, 100.0) == pytest.approx(11.195, abs=1e-3)


@pytest.mark.parametrize("fname", ["CG-6_0640_W_GHADIR_New_gravimeter.dat", "CG-6_0313_W_GHADER_old_gravimeter.dat"])
def test_longman_reproduces_onboard_tide(fname):
    _, d = cg6.read_cg6(os.path.join(RAW, fname), "x")
    t = longman_correction(d["time_utc"], d["LatUser"], d["LonUser"])
    assert np.max(np.abs(t - d["TideCorr"])) < 0.001  # mGal


@pytest.mark.parametrize("fname", ["CG-6_0640_W_GHADIR_New_gravimeter.dat", "CG-6_0313_W_GHADER_old_gravimeter.dat"])
def test_corrgrav_is_sum_of_terms(fname):
    _, d = cg6.read_cg6(os.path.join(RAW, fname), "x")
    r = d["CorrGrav"] - (d["RawGrav"] + d["TideCorr"] + d["TiltCorr"] + d["TempCorr"] + d["DriftCorr"])
    assert np.nanmax(np.abs(r)) <= 0.00021


def test_chains_expose_numbered_steps():
    from wghadir.chains import GravityChain, MagneticChain
    for chain, n in ((GravityChain, 14), (MagneticChain, 8)):
        assert len(chain.STEPS) == n
        assert all(hasattr(chain, s) for s in chain.STEPS)
        assert [int(s[4:6]) for s in chain.STEPS] == list(range(1, n + 1))


def test_settings_documented_values():
    assert settings.THRESHOLDS["stddev_reject_mgal"] == 0.080
    assert settings.MATCH_MAX_M == 30.0
    assert 2.67 in settings.RHO_LIST


def test_terrain_flat_dem_matches_slab():
    """Flat DEM of height h: the prism model (22 km, curvature) must approach the slab 0.04193 h."""
    from types import SimpleNamespace

    from wghadir.gravity.terrain import TopoModel

    h, lon0, lat0, d = 100.0, 34.87, 24.78, 1.0 / 3600
    lon = np.arange(lon0 - 0.26, lon0 + 0.26, d)
    lat = np.arange(lat0 + 0.24, lat0 - 0.24, -d)
    grid = SimpleNamespace(lon=lon, lat=lat, z=np.full((lat.size, lon.size), h), dx=d, dy=d)
    model = TopoModel(grid)
    g1 = model.unit_effect(lon0, lat0, h)[0]
    assert model.coverage_ok(lon0, lat0)
    assert g1 / (0.04193 * h) == pytest.approx(1.0, abs=0.01)


def test_magnetic_despike_reproduces_delivered_count():
    """Default Hampel parameters reject the 155 spikes of the delivered magnetic product."""
    from wghadir.magnetic import processing

    d = processing.despike(processing.load(os.path.join(RAW, "magnetics", "All_Data_Corrected_Total_Intensity.xlsx")))
    assert int(d["flags"].str.contains("SPIKE").sum()) == 155
    assert int(d["accepted"].sum()) == 12006
