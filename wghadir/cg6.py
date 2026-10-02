"""Reader for Scintrex CG-6 survey exports (tab-delimited .dat with '/' header)."""
import hashlib
import os
import re

import numpy as np
import pandas as pd

NUMERIC_COLS = ["CorrGrav", "StdDev", "StdErr", "RawGrav", "X", "Y", "SensorTemp", "TideCorr",
                "TiltCorr", "TempCorr", "DriftCorr", "MeasurDur", "InstrHeight", "LatUser", "LonUser",
                "ElevUser", "LatGPS", "LonGPS", "ElevGPS"]
FLAG_COL = "Corrections[drift-temp-na-tide-tilt]"
OVERFLOW = "******"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_cg6(path, instrument_label):
    """Return (header dict, DataFrame) for one CG-6 export.

    Every data row is kept.  Fields printed as '******' by the instrument (numeric
    overflow) are converted to NaN and recorded in the column 'overflow_fields'.
    """
    with open(path, encoding="utf-8", errors="replace") as fh:
        lines = fh.read().splitlines()
    header = {}
    hdr_idx = None
    for i, line in enumerate(lines):
        if line.startswith("/Station"):
            hdr_idx = i
            break
        m = re.match(r"^/\s*(.+?):\s*(.*)$", line)
        if m:
            header[m.group(1).strip()] = m.group(2).strip()
    if hdr_idx is None:
        raise ValueError(f"{path}: no '/Station' column header found")
    cols = lines[hdr_idx][1:].split("\t")
    rows = [ln.split("\t") for ln in lines[hdr_idx + 1:] if ln.strip()]
    df = pd.DataFrame(rows, columns=cols)
    df.insert(0, "file_row", np.arange(1, len(df) + 1))           # 1-based data row
    df.insert(1, "file_line", np.arange(hdr_idx + 2, hdr_idx + 2 + len(df)))  # 1-based text line
    over = []
    for _, r in df[NUMERIC_COLS].iterrows():
        over.append(";".join(c for c in NUMERIC_COLS if str(r[c]).strip() == OVERFLOW))
    df["overflow_fields"] = over
    for c in NUMERIC_COLS:
        df[c] = pd.to_numeric(df[c].replace(OVERFLOW, np.nan))
    df["Station"] = df["Station"].astype(str).str.strip()
    df["Line"] = df["Line"].astype(str).str.strip()
    df["time_utc"] = pd.to_datetime(df["Date"] + " " + df["Time"])
    df.insert(0, "instrument", instrument_label)
    df["serial"] = header.get("Instrument Serial Number", "")
    header["_file"] = os.path.basename(path)
    header["_bytes"] = os.path.getsize(path)
    header["_sha256"] = sha256(path)
    header["_rows"] = len(df)
    header["_columns"] = cols
    return header, df


def assign_occupations(df):
    """Group consecutive readings of the same Station/Line on the same date.

    A new occupation starts whenever Date, Station or Line changes between
    successive records, or when the gap between successive readings exceeds
    15 minutes (re-setup at the same point).
    """
    df = df.sort_values(["instrument", "time_utc"]).reset_index(drop=True)
    occ = []
    k = 0
    prev = None
    for _, r in df.iterrows():
        key = (r["instrument"], r["Date"], r["Station"], r["Line"])
        if prev is None or key != prev[0] or (r["time_utc"] - prev[1]) > pd.Timedelta(minutes=15):
            k += 1
        occ.append(k)
        prev = (key, r["time_utc"])
    df["occ_id"] = occ
    return df
