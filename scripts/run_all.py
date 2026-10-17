#!/usr/bin/env python3
"""Run both processing chains: gravity (steps 1-14), then magnetics (steps 1-8).

Example:
    python scripts/run_all.py --out outputs

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from wghadir.chains import GravityChain, MagneticChain  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", default="data/raw")
    ap.add_argument("--mag", default="data/raw/magnetics/All_Data_Corrected_Total_Intensity.xlsx")
    ap.add_argument("--external", default="data/external")
    ap.add_argument("--out", default="outputs")
    ap.add_argument("--no-figures", action="store_true")
    a = ap.parse_args()
    GravityChain(raw_dir=a.raw, external_dir=a.external, out_dir=a.out).run_all(make_figures=not a.no_figures)
    MagneticChain(mag_file=a.mag, external_dir=a.external, out_dir=a.out).run_all(make_maps=not a.no_figures)


if __name__ == "__main__":
    main()
