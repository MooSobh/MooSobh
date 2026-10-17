"""Use the SGTool grid filters (Jessell et al., MIT licence) outside QGIS.

SGTool's ``GeophysicalProcessor`` implements its FFT filters in numpy, but the
module imports GDAL (osgeo) for file handling at import time.  When GDAL is not
installed, a minimal stand-in module is registered so the import succeeds; the
filters themselves never call GDAL.  The SGTool code is vendored unchanged in
third_party/sgtool (see its README for the source commit).

    from wghadir.common.sgtool_bridge import sgtool_processor
    gp = sgtool_processor(dx=100.0, dy=100.0)
    thg = gp.total_horizontal_gradient(grid_values)

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import os
import sys
import types

SGTOOL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                          "third_party", "sgtool")


class _Placeholder:
    """Stands in for any GDAL object; only reached by SGTool's file-handling code."""

    def __init__(self, *args, **kwargs):
        pass

    def __call__(self, *args, **kwargs):
        return _Placeholder()

    def __getattr__(self, name):
        return _Placeholder()


def _placeholder_module(name):
    m = types.ModuleType(name)
    m.__path__ = []
    m.__getattr__ = lambda attr: _Placeholder()
    return m


def _ensure_osgeo():
    try:
        import osgeo  # noqa: F401
    except ImportError:
        sys.modules["osgeo"] = _placeholder_module("osgeo")
        for sub in ("gdal", "ogr", "osr", "gdalnumeric", "gdalconst", "gdal_array"):
            sys.modules["osgeo." + sub] = _placeholder_module("osgeo." + sub)


def sgtool_processor(dx, dy, buffer=10, sgtool_dir=SGTOOL_DIR):
    """SGTool GeophysicalProcessor for a grid with cell sizes dx, dy (metres)."""
    _ensure_osgeo()
    if sgtool_dir not in sys.path:
        sys.path.insert(0, sgtool_dir)
    from calcs.GeophysicalProcessor import GeophysicalProcessor
    return GeophysicalProcessor(dx, dy, buffer)
