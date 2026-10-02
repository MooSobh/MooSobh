#!/usr/bin/env python3
"""Render report/REPORT.md to a self-contained report/REPORT.html (figures embedded).

Example:
    python scripts/build_report_html.py
"""
import base64
import os
import re

import markdown

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = """
:root{--bg:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--rule:#d9d8d3;--code:#f0efec}
@media (prefers-color-scheme: dark){:root{--bg:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--rule:#383835;--code:#262624}
 img{background:#fff}}
body{background:var(--bg);color:var(--ink);font:15px/1.55 Georgia,serif;max-width:900px;margin:0 auto;padding:24px 16px}
h1,h2,h3{font-family:system-ui,sans-serif;line-height:1.25}h2{border-top:1px solid var(--rule);padding-top:18px;margin-top:36px}
table{border-collapse:collapse;margin:12px 0;font:13px/1.4 system-ui,sans-serif;display:block;overflow-x:auto}
th,td{border-bottom:1px solid var(--rule);padding:4px 8px;text-align:left;vertical-align:top}th{color:var(--ink2)}
code,pre{background:var(--code);font-size:13px}pre{padding:10px;overflow-x:auto}img{max-width:100%;height:auto}
em{color:var(--ink2)}
"""


def main():
    src = open(os.path.join(ROOT, "report", "REPORT.md"), encoding="utf-8").read()

    def embed(m):
        alt, path = m.group(1), m.group(2)
        p = os.path.normpath(os.path.join(ROOT, "report", path))
        b64 = base64.b64encode(open(p, "rb").read()).decode()
        return f"![{alt}](data:image/png;base64,{b64})"

    src = re.sub(r"!\[([^\]]*)\]\(([^)]+\.png)\)", embed, src)
    body = markdown.markdown(src, extensions=["tables", "fenced_code"])
    html = ("<!doctype html><html lang='en'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            f"<title>Wadi Ghadir Gravity Report</title><style>{CSS}</style></head><body>{body}</body></html>")
    out = os.path.join(ROOT, "report", "REPORT.html")
    open(out, "w", encoding="utf-8").write(html)
    print(f"wrote {out} ({os.path.getsize(out) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
