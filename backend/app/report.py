"""Pre-spud briefing PDF (fpdf2, core fonts -> English only)."""
from __future__ import annotations

import datetime as dt
from collections import defaultdict

from fpdf import FPDF

from . import analytics as A
from . import field as F

RISK_RGB = {"high": (200, 30, 45), "moderate": (230, 150, 20), "low": (40, 150, 80)}


def _safe(s: str) -> str:
    return s.encode("latin-1", "replace").decode("latin-1")


def build(target: F.Well, radius_km: float) -> bytes:
    sims = A.similarity(target, radius_km)
    profile = A.RISK.profile(target, radius_km, step=100.0)
    seats = A.casing_seats(target, profile)
    offs = A.wells_within(target, radius_km)

    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(True, 15)
    pdf.add_page()
    pdf.set_fill_color(12, 30, 60)
    pdf.rect(0, 0, 210, 28, "F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_xy(10, 7)
    pdf.cell(0, 8, "eRTMAC-NWIS  |  Pre-Spud Hazard Briefing")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_xy(10, 16)
    pdf.cell(0, 6, _safe(f"{target.name}  |  {target.field}  |  {target.lat:.4f}N {target.lon:.4f}E  |  Planned TD {target.td_m:.0f} m  |  "
                         f"Offset radius {radius_km:g} km  |  Generated {dt.datetime.now():%Y-%m-%d %H:%M}"))
    pdf.set_text_color(0, 0, 0)
    pdf.ln(16)

    def h(title: str) -> None:
        pdf.ln(3)
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_text_color(12, 30, 60)
        pdf.cell(0, 7, title, new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Helvetica", "", 9)

    def table(headers, rows, widths):
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_fill_color(225, 230, 240)
        for hd, w in zip(headers, widths):
            pdf.cell(w, 6, hd, border=1, fill=True)
        pdf.ln()
        pdf.set_font("Helvetica", "", 8)
        for r in rows:
            fill = r[-1] if isinstance(r[-1], tuple) else None
            cells = r[:-1] if fill else r
            for i, (c, w) in enumerate(zip(cells, widths)):
                if fill and i == len(cells) - 1:
                    pdf.set_fill_color(*fill)
                    pdf.set_text_color(255, 255, 255)
                pdf.cell(w, 5.5, _safe(str(c)), border=1, fill=bool(fill and i == len(cells) - 1))
                pdf.set_text_color(0, 0, 0)
            pdf.ln()

    all_ev = [e for o, _ in offs for e in o.events]
    h("1. Executive summary")
    high = [r for r in profile if r["level"] == "high"]
    pdf.multi_cell(0, 5, _safe(
        f"{len(offs)} offset wells within {radius_km:g} km report {len(all_ev)} drilling events totalling "
        f"{sum(e['npt_hours'] for e in all_ev):.0f} h NPT. The XGBoost risk model flags {len(high)} x 100 m intervals as HIGH risk"
        + (f", concentrated in {', '.join(sorted({r['formation'] for r in high}))}." if high else ".")))

    h("2. Offset well similarity ranking")
    table(["#", "Well", "Field", "Dist km", "Litho", "MW", "Traj", "Score", "Events", "NPT h"],
          [[s["rank"], s["name"], s["field"], s["distance_km"], s["components"]["lithology"], s["components"]["mud_weight"],
            s["components"]["trajectory"], s["score"], s["event_count"], s["npt_total"]] for s in sims[:12]],
          [8, 32, 24, 16, 14, 14, 14, 16, 16, 16])

    h("3. Depth hazard matrix (offset events by formation)")
    mat = defaultdict(lambda: defaultdict(lambda: [0, 0.0]))
    for e in all_ev:
        c = mat[e["formation"]][e["event_type"]]
        c[0] += 1
        c[1] += e["npt_hours"]
    rows = []
    for fm, top in target.tops:
        if fm not in mat:
            continue
        row = [fm, f"{top:.0f}"]
        for et in A.EVENT_TYPES:
            n, npt = mat[fm][et]
            row.append(f"{n} / {npt:.0f}h" if n else "-")
        rows.append(row)
    table(["Formation", "Top m", "Loss", "Kick", "Stuck pipe", "Caving"], rows, [40, 18, 30, 30, 30, 30])

    h("4. Predicted risk by depth section (100 m)")
    rows = [[f"{r['top_m']:.0f}-{r['base_m']:.0f}", r["formation"], f"{r['risk']:.0%}", r["why"][:78], r["level"].upper(), RISK_RGB[r["level"]]]
            for r in profile if r["level"] != "low"]
    table(["Interval m", "Formation", "Risk", "Explanation (SHAP)", "Level"], rows or [["-", "-", "-", "All sections low risk", "LOW", RISK_RGB["low"]]],
          [22, 30, 12, 108, 18])

    h("5. Recommended casing seats")
    table(["Depth m", "Casing", "Rationale"], [[f"{s['depth_m']:.0f}", s["casing"], s["reason"]] for s in seats], [20, 45, 125])

    h("6. Lessons learned - recommended actions")
    look = A.look_ahead(target, 0.0, radius_km, window_m=F.TD_MAX)
    for a in look["alerts"][:8]:
        pdf.set_font("Helvetica", "B", 9)
        pdf.multi_cell(0, 5, _safe(f"{a['formation']} (top {a['formation_top_m']:.0f} m) - {a['event_type'].replace('_', ' ')}: "
                                   f"{len(a['wells_affected'])}/{a['offset_wells']} wells, avg NPT {a['avg_npt_hours']} h"),
                       new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 8)
        for m in a["mitigation"]["worked"]:
            pdf.multi_cell(0, 4.5, _safe(f"   [WORKED x{m['count']}] {m['action']}"), new_x="LMARGIN", new_y="NEXT")
        for m in a["mitigation"]["failed"]:
            pdf.multi_cell(0, 4.5, _safe(f"   [FAILED x{m['count']}] {m['action']}"), new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def document_pdf(title: str, text: str, hl: tuple[int, int] | None) -> bytes:
    """Render a stored DDR/WCR page as a PDF with the cited span highlighted."""
    pdf = FPDF(format="A4")
    pdf.add_page()
    pdf.set_font("Courier", "B", 11)
    pdf.cell(0, 8, _safe(title), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Courier", "", 9)
    pos = 0
    for line in text.split("\n"):
        start, end = pos, pos + len(line)
        on = hl and start < hl[1] and end > hl[0]
        if on:
            pdf.set_fill_color(255, 235, 80)
        pdf.multi_cell(0, 5, _safe(line), fill=bool(on), new_x="LMARGIN", new_y="NEXT")
        pos = end + 1
    return bytes(pdf.output())
