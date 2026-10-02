"""Regression tests: run with  python -m pytest -q"""
import os

import numpy as np
import pytest

from wghadir import cg6, gnss, reduce
from wghadir.tide import longman_correction

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
