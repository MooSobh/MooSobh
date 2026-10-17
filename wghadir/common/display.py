"""Compact inline display of the saved figures in Jupyter notebooks.

The figures are written at 300-400 dpi; for the notebook they are shown as
down-scaled JPEG copies so the notebooks stay small.  The full-resolution PNG
files remain in the output folders.

Author : Dr. Mohamed Sobh, LIAG (Leibniz Institute for Applied Geophysics)
Project: Wadi Ghadir gravity and magnetic survey, Eastern Desert, Egypt (2026)
"""
import io
import os


def show_figure(path, max_px=1100, quality=78):
    """Display one saved figure, down-scaled to max_px on the long side."""
    from IPython.display import Image, Markdown, display
    from PIL import Image as PILImage

    im = PILImage.open(path).convert("RGB")
    im.thumbnail((max_px, max_px))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True)
    display(Markdown(f"`{os.path.basename(path)}`"))
    display(Image(data=buf.getvalue(), format="jpeg"))


def show_figures(folder, prefix="", max_px=1100):
    """Display every PNG in folder whose name starts with prefix, in name order."""
    for f in sorted(os.listdir(folder)):
        if f.endswith(".png") and f.startswith(prefix):
            show_figure(os.path.join(folder, f), max_px=max_px)
