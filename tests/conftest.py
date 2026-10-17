"""pytest configuration: make the wghadir package importable from the repository root.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
