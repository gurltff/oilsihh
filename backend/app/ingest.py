"""OCR + NLP extraction of drilling events from DDR / WCR documents."""
from __future__ import annotations

import io
import json
import re
from collections import defaultdict

from . import db
from . import field as F

REVIEW_THRESHOLD = 0.85

BASE_LEXICON = {
    "loss": {"loss": 1.0, "losses": 1.0, "lost circulation": 1.5, "loss of circulation": 1.5, "lcm": 0.6, "bbl/hr": 0.5, "returns": 0.4},
    "kick": {"kick": 1.5, "pit gain": 1.2, "influx": 1.2, "shut-in": 0.7, "shut in": 0.7, "flowing": 0.6, "well flow": 0.8},
    "stuck_pipe": {"stuck": 1.5, "overpull": 0.8, "jar": 0.8, "jarred": 0.8, "differential sticking": 1.2, "unable to rotate": 0.8, "tight hole": 0.5},
    "caving": {"caving": 1.5, "cavings": 1.5, "splintery": 0.8, "instability": 0.8, "washout": 0.7, "tight spots": 0.5},
}
FORMATION_KEYS = {
    "alluvium": "Alluvium", "namsang": "Namsang", "girujan": "Girujan Clay", "tipam": "Tipam Sandstone",
    "barail": "Barail Coal", "kopili": "Kopili Shale", "sylhet": "Sylhet Limestone",
}


def extract_text(filename: str, data: bytes) -> tuple[str, str]:
    """Return (text, method). PDFs use the text layer, images go through Tesseract OCR."""
    name = filename.lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        txt = "\n".join((p.extract_text() or "") for p in reader.pages)
        if txt.strip():
            return txt, "pdf-text-layer"
        raise ValueError("PDF has no text layer; upload page images for OCR")
    if name.endswith((".png", ".jpg", ".jpeg", ".tif", ".tiff")):
        try:
            import pytesseract
            from PIL import Image
        except ImportError as e:  # pragma: no cover - optional dependency
            raise ValueError("OCR requires pytesseract + Pillow and the tesseract binary") from e
        return pytesseract.image_to_string(Image.open(io.BytesIO(data))), "tesseract-ocr"
    return data.decode("utf-8", errors="replace"), "plain-text"


def lexicon() -> dict[str, dict[str, float]]:
    lex = {k: dict(v) for k, v in BASE_LEXICON.items()}
    for r in db.q("SELECT term, event_type, weight FROM feedback"):
        lex.setdefault(r["event_type"], {})
        lex[r["event_type"]][r["term"]] = lex[r["event_type"]].get(r["term"], 0.0) + r["weight"]
    return lex


def _classify(line: str, lex) -> tuple[str | None, float]:
    low = line.lower()
    scores = defaultdict(float)
    for et, terms in lex.items():
        for term, w in terms.items():
            if re.search(r"\b" + re.escape(term) + r"\b", low):
                scores[et] += w
    if not scores or max(scores.values()) <= 0:
        return None, 0.0
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    best, s1 = ranked[0]
    s2 = ranked[1][1] if len(ranked) > 1 else 0.0
    margin = (s1 - max(0.0, s2)) / s1
    return best, min(1.0, 0.55 + 0.25 * min(s1, 2.0) / 2.0 + 0.2 * margin)


def parse(text: str, well_hint: str | None = None) -> list[dict]:
    lex = lexicon()
    wells = db.wells()
    header_well = well_hint
    m = re.search(r"Well\s*[:\-]\s*([A-Za-z0-9\-\(\) ]+?)(?:\s{2,}|\s+Field|\n|$)", text)
    if not header_well and m:
        cand = m.group(1).strip().lower()
        for w in wells:
            if cand in (w.name.lower(), w.id.lower()) or w.name.lower() in cand:
                header_well = w.id
                break
    header_date = None
    dm = re.search(r"(\d{4}-\d{2}-\d{2}|\d{2}[/.-]\d{2}[/.-]\d{4})", text)
    if dm:
        header_date = _norm_date(dm.group(1))
    header_fm = None
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    out = []
    for i, ln in enumerate(lines):
        for k, v in FORMATION_KEYS.items():
            if k in ln.lower():
                header_fm = v
        et, et_conf = _classify(ln, lex)
        if not et or ln.lower().startswith(("lesson", "note")):
            continue
        ctx = " ".join(lines[max(0, i - 1): i + 2])
        depth_direct = _depth(ln)
        depth = depth_direct if depth_direct is not None else _depth(ctx)
        fm = next((v for k, v in FORMATION_KEYS.items() if k in ctx.lower()), header_fm)
        npt, npt_direct = None, False
        for j, probe in enumerate((ln, ctx, " ".join(lines[i: i + 3]))):
            nm = re.search(r"NPT[^0-9]{0,10}(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)", probe, re.I)
            if nm:
                npt, npt_direct = float(nm.group(1)), j == 0
                break
        well_known = header_well is not None and any(w.id == header_well for w in wells)
        fm_score = 0.9 if fm is not None else 0.3
        if depth is not None and fm is not None and header_well:
            w = next((w for w in wells if w.id == header_well), None)
            # cross-check against the well's known stratigraphy
            if w and F.formation_at(w.tops, depth) != fm:
                fm_score = 0.55
        scores = {
            "event_type": round(et_conf, 2),
            # values found on the event line itself are trusted more than ones borrowed from context
            "depth_m": (0.95 if depth_direct is not None else 0.6) if depth is not None and 0 < depth <= F.TD_MAX else 0.2,
            "formation": fm_score,
            "well_id": 0.95 if well_known else 0.3,
            "date": 0.9 if header_date else 0.4,
            "npt_hours": (0.9 if npt_direct else 0.6) if npt is not None else 0.4,
        }
        weights = {"event_type": 0.3, "depth_m": 0.25, "formation": 0.15, "well_id": 0.1, "date": 0.05, "npt_hours": 0.15}
        conf = round(sum(scores[k] * weights[k] for k in weights), 3)
        rec = {
            "well_id": header_well, "event_type": et, "depth_m": depth, "formation": fm, "date": header_date,
            "npt_hours": npt, "raw_text": ln, "confidence": conf, "field_scores": scores,
            "verification_status": "auto_verified" if conf >= REVIEW_THRESHOLD else "pending_review",
        }
        # collapse duplicates for the same event (e.g. several lines describing one loss)
        if out and out[-1]["event_type"] == et and out[-1]["depth_m"] == depth:
            if conf > out[-1]["confidence"]:
                out[-1] = rec
            continue
        out.append(rec)
    return out


def _depth(s: str) -> float | None:
    m = re.search(r"(?:at|@|depth(?: of)?)\s*(\d{2,4}(?:[.,]\d+)?)\s*m(?:\b|D)", s, re.I) or re.search(r"(\d{3,4})\s*m\b", s)
    return float(m.group(1).replace(",", "")) if m else None


def _norm_date(s: str) -> str:
    if re.match(r"\d{4}-", s):
        return s
    d, mth, y = re.split(r"[/.-]", s)
    return f"{y}-{mth}-{d}"


def store(doc_id: str, recs: list[dict]) -> list[dict]:
    saved = []
    for r in recs:
        rid = db.x(
            "INSERT INTO extractions (doc_id, well_id, event_type, depth_m, formation, date, npt_hours, raw_text, confidence, field_scores, verification_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (doc_id, r["well_id"], r["event_type"], r["depth_m"], r["formation"], r["date"], r["npt_hours"], r["raw_text"],
             r["confidence"], json.dumps(r["field_scores"]), r["verification_status"]))
        r = {"id": rid, "doc_id": doc_id, **r}
        if r["verification_status"] == "auto_verified":
            promote(r)
        saved.append(r)
    return saved


def promote(r: dict) -> None:
    """Copy a verified extraction into the events table used by analytics + RAG."""
    if not (r["well_id"] and r["event_type"] and r["depth_m"] is not None):
        return
    ev_id = f"EX-{r['id']:05d}"
    npt = r["npt_hours"] or 0.0
    ev = {"id": ev_id, "well_id": r["well_id"], "event_type": r["event_type"], "depth_m": r["depth_m"],
          "formation": r["formation"] or "Unknown", "date": r["date"] or "", "npt_hours": npt,
          "severity": "high" if npt >= 12 else "moderate" if npt >= 6 else "low", "mud_weight_ppg": None,
          "worked": [], "failed": []}
    doc = db.q("SELECT text FROM documents WHERE id=?", (r["doc_id"],))
    s = e = 0
    if doc:
        s = doc[0]["text"].find(r["raw_text"])
        e = s + len(r["raw_text"]) if s >= 0 else 0
        s = max(s, 0)
        rem = re.search(r"Remedial: (.+?)\.\s*$", doc[0]["text"], re.M)
        if rem:
            ev["worked"] = [rem.group(1)]
    db.x("INSERT OR REPLACE INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
         (ev_id, ev["well_id"], ev["event_type"], ev["depth_m"], ev["formation"], ev["date"], npt, ev["severity"],
          r["doc_id"], 1, s, e, "ingest", json.dumps(ev)))


def learn(raw_text: str, predicted: str | None, corrected: str) -> None:
    """Online lexicon update from a human correction (the 'fine-tuning' signal for the extractor)."""
    toks = set(re.findall(r"[a-z][a-z\-]{3,}", raw_text.lower())) - {"with", "while", "from", "formation", "observed"}
    for tok in toks:
        db.x("INSERT INTO feedback VALUES (?,?,?) ON CONFLICT(term, event_type) DO UPDATE SET weight = weight + excluded.weight",
             (tok, corrected, 0.3))
        if predicted and predicted != corrected:
            db.x("INSERT INTO feedback VALUES (?,?,?) ON CONFLICT(term, event_type) DO UPDATE SET weight = weight + excluded.weight",
                 (tok, predicted, -0.3))
