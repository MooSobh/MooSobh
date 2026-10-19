"""Regression tests: run with  python -m pytest -q

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
"""
import os
import sys

import numpy as np
import pandas as pd
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


def test_sgtool_filters_available():
    """The vendored SGTool filter engine imports without GDAL and filters a grid."""
    from wghadir.common.sgtool_bridge import sgtool_processor

    z = np.random.default_rng(0).normal(size=(40, 60))
    gp = sgtool_processor(dx=100.0, dy=100.0)
    assert gp.tilt_angle(z).shape == z.shape
    assert np.isfinite(gp.total_horizontal_gradient(z)).all()


def test_web_lab_engine_matches_python(tmp_path):
    """The browser engine (web/src/engine.js, run in Node) reproduces the Python complete Bouguer values."""
    import json
    import shutil
    import subprocess
    import sys

    node = shutil.which("node")
    tables = os.path.join(RAW, "..", "..", "outputs", "tables")
    if node is None or not os.path.exists(os.path.join(tables, "16_field_stations_relative.csv")):
        pytest.skip("needs Node.js and the outputs of the gravity chain")
    root = os.path.join(os.path.dirname(__file__), "..")
    sys.path.insert(0, os.path.join(root, "scripts"))
    import build_gravity_lab

    data = build_gravity_lab.build(RAW, tables, os.path.join(root, "data", "external"))
    data.pop("hillshade")
    (tmp_path / "data.json").write_text(json.dumps(data))
    js = f"""
const fs=require('fs'); eval(fs.readFileSync({json.dumps(os.path.join(root, 'web', 'src', 'gl_core.js'))},'utf8').replace('const GL=','global.GL='));
const E=require({json.dumps(os.path.join(root, 'web', 'src', 'engine.js'))});
const D=JSON.parse(fs.readFileSync({json.dumps(str(tmp_path / 'data.json'))},'utf8'));
const st=D.stations.map(r=>Object.fromEntries(D.stationCols.map((c,i)=>[c,r[i]])));
const R=E.run({{files:D.files,stations:st,ref:D.ref}},{{}},GL.longman);
const seen=new Set(); const d=[];
for(const s of R.st.filter(s=>s.ok)){{ if(!D.python[s.key]||seen.has(s.key)) continue; seen.add(s.key); d.push(Math.abs(E.CB(s,2.67)-D.python[s.key][1])); }}
d.sort((a,b)=>a-b); console.log(JSON.stringify({{n:d.length, median:d[d.length>>1], p99:d[Math.floor(0.99*d.length)]}}));
"""
    out = json.loads(subprocess.run([node, "-e", js], capture_output=True, text=True, check=True).stdout)
    assert out["n"] > 900
    assert out["median"] < 1e-3 and out["p99"] < 0.01      # mGal


def test_web_lab_accepts_uploaded_readings_table():
    """A generic readings table plus station table (web/examples) reproduces the Python values for CG6-0640."""
    import json
    import shutil
    import subprocess

    node = shutil.which("node")
    ex = os.path.join(os.path.dirname(__file__), "..", "web", "examples")
    if node is None or not os.path.exists(os.path.join(ex, "example_readings_CG6-0640.csv")):
        pytest.skip("needs Node.js and web/examples (python scripts/build_gravity_lab.py)")
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    js = f"""
const fs=require('fs'); eval(fs.readFileSync({json.dumps(os.path.join(root, 'web', 'src', 'gl_core.js'))},'utf8').replace('const GL=','global.GL='));
const E=require({json.dumps(os.path.join(root, 'web', 'src', 'engine.js'))});
const ex={json.dumps(os.path.abspath(ex))};
const files=[{{name:'example_readings_CG6-0640.csv', text:fs.readFileSync(ex+'/example_readings_CG6-0640.csv','utf8')}}];
const st=E.normaliseStations(E.parseCSV(fs.readFileSync(ex+'/example_stations_CG6-0640.csv','utf8')));
const R=E.run({{files, stations:st, ref:null}}, {{}}, GL.longman);
const ok=R.st.filter(s=>s.ok);
console.log(JSON.stringify(Object.fromEntries(ok.map(s=>[s.key, E.CB(s,2.67)]))));
"""
    cb = json.loads(subprocess.run([node, "-e", js], capture_output=True, text=True, check=True).stdout)
    py = pd.read_csv(os.path.join(root, "outputs", "tables", "16_field_stations_relative.csv"))
    py = py[py["product_ok"] & (py["instrument"] == "CG6-0640")].drop_duplicates("occ_key").set_index("occ_key")
    common = [k for k in cb if k in py.index]
    assert len(common) > 500
    d = np.abs(np.array([cb[k] for k in common]) - py.loc[common, "dCB_rel_rho2.67_mgal"].values)
    assert np.max(d) < 0.002          # mGal


def test_web_lab_modelling_engine():
    """web/src/model.js: Talwani polygon = line mass far away; the 2-D inversion puts a buried block where it is."""
    import json
    import shutil
    import subprocess

    node = shutil.which("node")
    if node is None:
        pytest.skip("needs Node.js")
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    js = f"""
const fs=require('fs'); eval(fs.readFileSync({json.dumps(os.path.join(root, 'web', 'src', 'gl_core.js'))},'utf8').replace('const GL=','global.GL='));
const M=require({json.dumps(os.path.join(root, 'web', 'src', 'model.js'))});
const sq={{xy:[[-50,950],[-50,1050],[50,1050],[50,950]],drho:100}};      // counter-clockwise on purpose
const g=M.bodyResponse([0,1000],sq), line=[0,1000].map(x=>2*6.6743e-11*100*1e4*1000/(x*x+1e6)*1e5);
const x=Array.from({{length:81}},(_,i)=>i*250), blk=[{{xy:[[8000,800],[12000,800],[12000,2000],[8000,2000]],drho:200}}];
const d=M.forward(x,blk), Ms=M.mesh(20000,{{cw:400,zmax:6000,nz:24}}), P=M.prepare(x,d,Ms,{{sigma:0.05,z0:500,beta:1,ls:500}});
const s=M.solve(P,M.autoLambda(P),true); let jb=0; s.m.forEach((v,j)=>{{if(v>s.m[jb])jb=j;}});
console.log(JSON.stringify({{g,line,chi2n:s.chi2n,x:(Ms.xe[jb%Ms.nx]+Ms.xe[jb%Ms.nx+1])/2,z:(Ms.ze[Math.floor(jb/Ms.nx)]+Ms.ze[Math.floor(jb/Ms.nx)+1])/2,
  fit:M.fitDensities(x,d,[{{xy:blk[0].xy,drho:1}}])[0]}}));
"""
    r = json.loads(subprocess.run([node, "-e", js], capture_output=True, text=True, check=True).stdout)
    assert np.allclose(r["g"], r["line"], rtol=1e-4)
    assert abs(r["chi2n"] - 1) < 0.01
    assert 9000 < r["x"] < 11000 and 600 < r["z"] < 2400
    assert abs(r["fit"] - 200) < 1e-6


def test_web_magnetic_lab_engine():
    """web/src/mag_engine.js: IGRF-14 against ppigrf, the despike and the TMA against the Python chain, 2-D polygon against a line dipole."""
    import json
    import shutil
    import subprocess

    node = shutil.which("node")
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    qc = os.path.join(root, "outputs", "tables", "30_mag_readings_qc.csv")
    if node is None or not os.path.exists(qc):
        pytest.skip("needs Node.js and the magnetic chain results")
    sys.path.insert(0, os.path.join(root, "scripts"))
    import build_magnetic_lab as bml
    tmp = os.path.join(root, "outputs", "_mag_test_input.json")
    json.dump({"table": bml.readings_table(bml.MAG_FILE), "igrf": bml.igrf_coefficients()}, open(tmp, "w"))
    src = lambda f: json.dumps(os.path.join(root, "web", "src", f))  # noqa: E731
    js = f"""
const fs=require('fs'); eval(fs.readFileSync({src('gl_core.js')},'utf8').replace('const GL=','global.GL='));
global.ENG=require({src('engine.js')}); global.MOD=require({src('model.js')}); const M=require({src('mag_engine.js')});
const I=JSON.parse(fs.readFileSync({json.dumps(tmp)})); M.setIGRF(I.igrf); const P=M.mergeParams({{}});
const L=M.load(M.fromTable(I.table,'x'),P); M.despike(L,P); M.addIGRF(L,P);
const b=M.igrfAt(M.coeffsAt(M.decYear('2026-01-20')),24.77888,34.85904,0.2344);
const dip=M.polyTMA([0,300],[[-10,490],[10,490],[10,510],[-10,510]],0,1,0,1,0.001);
console.log(JSON.stringify({{F:b.F,I:b.I,D:b.D,rows:L.d.map(r=>[r.row,r.ok?1:0,r.tma]),dip}}));
"""
    try:
        out = json.loads(subprocess.run([node, "-e", js], capture_output=True, text=True, check=True).stdout)
    finally:
        os.remove(tmp)
    assert abs(out["F"] - 41983.289) < 0.1 and abs(out["I"] - 36.76755) < 0.001 and abs(out["D"] - 4.22089) < 0.001
    py = pd.read_csv(qc).set_index("source_row")
    js_rows = pd.DataFrame(out["rows"], columns=["row", "ok", "tma"]).set_index("row").join(py, how="inner")
    assert (js_rows["ok"].astype(bool) == js_rows["accepted"]).all()
    assert np.nanmax(np.abs(js_rows["tma"] - js_rows["tma_nT"])) < 0.1
    line = [2e-7 * 400 * (500 ** 2 - x ** 2) / (x ** 2 + 500 ** 2) ** 2 * 1e9 for x in (0, 300)]
    assert np.allclose(out["dip"], line, rtol=1e-4)


def test_inversion_helpers():
    """wghadir.inversion: block median, polynomial trend and the cross-gradient measure."""
    import discretize
    from wghadir import inversion as W
    rng = np.random.default_rng(1)
    df = pd.DataFrame({"e": rng.uniform(0, 1000, 500), "n": rng.uniform(0, 1000, 500), "z": 0.0})
    df["v"] = 3 + 0.002 * df.e - 0.001 * df.n
    assert np.allclose(W.polynomial_trend(df.e.values, df.n.values, df.v.values, 1), df.v.values)
    b = W.block_median(df, ["v"], 250.0)
    assert len(b) == 16 and b.n_block.sum() == 500
    mesh = discretize.TensorMesh([np.ones(12) * 100, np.ones(10) * 100, np.ones(8) * 100])
    active = np.ones(mesh.n_cells, bool)
    x, y, z = mesh.cell_centers.T
    a = np.exp(-((x - 600) ** 2 + (y - 500) ** 2 + (z - 400) ** 2) / 2e5)
    _, s_same = W.cross_gradient(mesh, active, a, 2 * a + 1)
    _, s_diff = W.cross_gradient(mesh, active, a, x / 1000)
    assert s_same < 1e-10 and s_diff > 0.1
