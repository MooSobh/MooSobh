"""The two processing chains as step-by-step classes.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
"""
from .gravity import GravityChain  # noqa: F401
from .magnetic import MagneticChain  # noqa: F401

__all__ = ["GravityChain", "MagneticChain"]
