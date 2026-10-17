#!/usr/bin/env python3
"""Run the Wadi Ghadir ground magnetic processing chain (steps 1-8).

Examples:
    python scripts/run_magnetics.py
    python scripts/run_magnetics.py --mag data/raw/magnetics/All_Data_Corrected_Total_Intensity.xlsx --out outputs

Run the gravity chain first into the same --out directory if the maps should show
base 100 from the gravity solution (otherwise its stored position is used); the
DEM for the relief is taken from --external.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import argparse
import os
import sys

import matplotlib

matplotlib.use("Agg")  # files only, no screen output
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from wghadir.chains import MagneticChain  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mag", default="data/raw/magnetics/All_Data_Corrected_Total_Intensity.xlsx")
    ap.add_argument("--external", default="data/external")
    ap.add_argument("--out", default="outputs")
    ap.add_argument("--no-maps", action="store_true", help="skip step 7 (maps)")
    a = ap.parse_args()
    MagneticChain(mag_file=a.mag, external_dir=a.external, out_dir=a.out).run_all(make_maps=not a.no_maps)


if __name__ == "__main__":
    main()
