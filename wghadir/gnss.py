"""GNSS point workbooks (DMS text) and KML exports."""
import datetime as dt
import re
import xml.etree.ElementTree as ET

import numpy as np
import openpyxl
import pandas as pd

_DMS = re.compile(r"([NSEW])\s*(\d+)\s*°\s*(\d+)\s*'\s*([\d.]+)\s*\"")


def dms_to_deg(text):
    """'N24°49'28.06755\"' -> 24.824463 (decimal degrees, signed)."""
    if text is None:
        return np.nan
    m = _DMS.search(str(text).replace("\xa0", " "))
    if not m:
        return np.nan
    hemi, d, mnt, s = m.groups()
    val = int(d) + int(mnt) / 60.0 + float(s) / 3600.0
    return -val if hemi in "SW" else val


def _num(text):
    if text is None:
        return np.nan
    s = str(text).replace("\xa0", " ").strip()
    try:
        return float(s)
    except ValueError:
        return np.nan


def _id_text(v):
    """Point IDs as text; flag IDs that Excel converted into dates."""
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d"), True
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip(), False


def read_point_workbook(path, source_label):
    """Read a GNSS point workbook (Point ID, Latitude, Longitude, Height, Height Error).

    Header rows are located by the text 'Point ID'; unit rows are skipped.
    Returns one row per point with original text retained.
    """
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    out = []
    for i, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if row[0] is None or str(row[0]).strip() == "Point ID":
            continue
        pid, is_date = _id_text(row[0])
        lat = dms_to_deg(row[1])
        lon = dms_to_deg(row[2])
        if np.isnan(lat) or np.isnan(lon):
            continue
        out.append(dict(source=source_label, sheet_row=i, point_id=pid, id_excel_date=is_date,
                        lat=lat, lon=lon, h_gnss=_num(row[3]),
                        h_err=_num(row[4]) if len(row) > 4 else np.nan,
                        lat_text=str(row[1]).replace("\xa0", "").strip(),
                        lon_text=str(row[2]).replace("\xa0", "").strip()))
    return pd.DataFrame(out)


def read_kml(path, source_label):
    ns = {"k": "http://www.opengis.net/kml/2.2"}
    root = ET.parse(path).getroot()
    out = []
    for pm in root.iter("{http://www.opengis.net/kml/2.2}Placemark"):
        name = pm.findtext("k:name", default="", namespaces=ns).strip()
        coords = pm.findtext(".//k:coordinates", default="", namespaces=ns).strip()
        desc = pm.findtext("k:description", default="", namespaces=ns)
        if not coords:
            continue
        lon, lat, h = (float(x) for x in coords.split(",")[:3])
        e = re.search(r"Easting</td><td>([-\d.]+)", desc or "")
        n = re.search(r"Northing</td><td>([-\d.]+)", desc or "")
        out.append(dict(source=source_label, point_id=name, lat=lat, lon=lon, h_kml=h,
                        easting_local=float(e.group(1)) if e else np.nan,
                        northing_local=float(n.group(1)) if n else np.nan))
    return pd.DataFrame(out)


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371008.8
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dl = np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))
