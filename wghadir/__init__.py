"""wghadir - processing chains for the Wadi Ghadir gravity and magnetic survey.

Wadi Ghadir, Eastern Desert, Egypt: CG-6 relative gravity and ground magnetic
survey, January 2026.

Package layout
--------------
wghadir.chains.gravity    GravityChain   - the gravity chain, 14 numbered steps
wghadir.chains.magnetic   MagneticChain  - the magnetic chain, 8 numbered steps
wghadir.gravity           gravity building blocks (readers, QC, GNSS, base control,
                          reductions, terrain, Nettleton, figures, maps, export)
wghadir.magnetic          magnetic building blocks (QC, IGRF, gridding, RTP, maps)
wghadir.common            shared code (DEM / geoid access, map style, Excel output)

Quick start
-----------
>>> from wghadir.chains import GravityChain, MagneticChain
>>> GravityChain(raw_dir="data/raw", out_dir="outputs").run_all()
>>> MagneticChain(mag_file="data/raw/magnetics/All_Data_Corrected_Total_Intensity.xlsx",
...               out_dir="outputs").run_all()

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
__version__ = "1.0.0"
__author__ = "Dr. Mohamed Sobh, LIAG"
