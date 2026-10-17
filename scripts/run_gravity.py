#!/usr/bin/env python3
"""Run the complete Wadi Ghadir gravity processing chain (steps 1-14) from the raw files.

Examples:
    python scripts/run_gravity.py
    python scripts/run_gravity.py --raw data/raw --external data/external --out outputs --no-figures

The Copernicus DEM and EGM2008 windows are downloaded into --external on the first
run (internet required once) and re-used afterwards.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from wghadir.chains import GravityChain  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", default="data/raw", help="directory with the supplied raw CG-6 and GNSS files")
    ap.add_argument("--external", default="data/external", help="cache for the DEM and geoid windows")
    ap.add_argument("--out", default="outputs", help="output directory")
    ap.add_argument("--no-figures", action="store_true", help="skip step 14 (figures, maps, grids)")
    a = ap.parse_args()
    chain = GravityChain(raw_dir=a.raw, external_dir=a.external, out_dir=a.out)
    chain.run_all(make_figures=not a.no_figures)
    print(json.dumps({k: chain.summary[k] for k in ("rows", "rows_accepted", "occupations", "products")}, indent=1))


if __name__ == "__main__":
    main()
