"""eRTMAC-NWIS — Nearby Wells Intelligence System API (FastAPI)."""
from __future__ import annotations

import math
import os
import uuid
from contextlib import asynccontextmanager
from collections import defaultdict
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import analytics as A
from . import db, ingest, rag, report
from . import field as F
from .schemas import (AckIn, Correction, IngestResponse, IngestText, RagQuery, SearchQuery, SimilarityWeights, WellOut)

TARGET = "NWIS-TGT-01"
RIG_COST_INR_PER_HR = float(os.environ.get("NWIS_RIG_COST_INR_PER_HR", "110000"))
MITIGATION_EFFECTIVENESS = float(os.environ.get("NWIS_MITIGATION_EFFECTIVENESS", "0.55"))



@asynccontextmanager
async def lifespan(_: FastAPI):
    db.conn()
    A.RISK.train()
    rag.INDEX.build()
    yield


app = FastAPI(title="eRTMAC-NWIS", version="1.0.0", lifespan=lifespan,
              description="Nearby Wells Intelligence System — Oil India Limited (SIH PS 26121)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _well(well_id: str) -> F.Well:
    w = db.well(well_id)
    if not w:
        raise HTTPException(404, f"well {well_id} not found")
    return w


def _well_out(w: F.Well, dist: float | None = None) -> dict:
    return WellOut(id=w.id, name=w.name, field=w.field, lat=w.lat, lon=w.lon, status=w.status, spud_year=w.spud_year,
                   td_m=w.td_m, inclination_deg=w.inclination_deg, azimuth_deg=w.azimuth_deg, kop_m=w.kop_m, is_target=w.is_target,
                   distance_km=None if dist is None else round(dist, 3), event_count=len(w.events),
                   npt_total=round(sum(e["npt_hours"] for e in w.events), 1),
                   tops=[{"formation": f, "top_m": t} for f, t in w.tops]).model_dump()


# ------------------------------------------------------------------ wells & geo
@app.get("/api/health")
def health():
    return {"status": "ok", "model_version": A.RISK.version, "holdout_auc": A.RISK.auc, "documents": len(rag.INDEX.docs)}


@app.get("/api/wells")
def list_wells(target: str = TARGET, radius_km: float = Query(15.0, ge=0.1, le=100)):
    t = _well(target)
    ws = db.wells()
    out = []
    for w in ws:
        d = A.haversine_km(t.lat, t.lon, w.lat, w.lon)
        o = _well_out(w, d)
        o["in_radius"] = w.id == t.id or d <= radius_km
        out.append(o)
    return sorted(out, key=lambda o: o["distance_km"])


@app.get("/api/wells/{well_id}")
def get_well(well_id: str):
    w = _well(well_id)
    return {**_well_out(w), "trajectory": F.trajectory(w), "events": sorted(w.events, key=lambda e: e["depth_m"])}


@app.get("/api/wells/{well_id}/log")
def well_log(well_id: str, step: float = Query(10.0, ge=2, le=100)):
    """Strip-log curves: lithology, gamma ray, mud weight, pore pressure, frac gradient + NPT flags."""
    w = _well(well_id)
    rng = __import__("random").Random(hash(w.id) & 0xFFFF)
    depths = np.arange(0, w.td_m + step, step)
    curves = []
    for d in depths:
        fm = F.formation_at(w.tops, d)
        curves.append({"md": float(d), "formation": fm, "gr_api": F.gamma_ray(fm, d, rng),
                       "mw_ppg": F.mud_weight_ppg(d, w.mw_offset), "pp_ppg": F.pore_pressure_ppg(d, w.pp_offset),
                       "fg_ppg": F.frac_gradient_ppg(d, fm)})
    return {"well_id": w.id, "name": w.name, "td_m": w.td_m, "tops": [{"formation": f, "top_m": t} for f, t in w.tops],
            "curves": curves, "events": sorted(w.events, key=lambda e: e["depth_m"])}


@app.get("/api/trajectories3d")
def trajectories3d(well_id: str = TARGET, radius_km: float = Query(8.0, ge=0.5, le=50)):
    t = _well(well_id)
    k_lat = 111_000.0
    k_lon = 111_000.0 * math.cos(math.radians(t.lat))

    def path(w: F.Well):
        e0, n0 = (w.lon - t.lon) * k_lon, (w.lat - t.lat) * k_lat
        return [{"md": p["md"], "x": p["east"] + e0, "y": p["north"] + n0, "z": -p["tvd"]} for p in F.trajectory(w, 25.0)]

    def at_md(pts, md):
        for a, b in zip(pts, pts[1:]):
            if a["md"] <= md <= b["md"]:
                f = (md - a["md"]) / max(1e-9, b["md"] - a["md"])
                return {k: a[k] + f * (b[k] - a[k]) for k in ("x", "y", "z")}
        return pts[-1]

    out = [{"well_id": t.id, "name": t.name, "is_target": True, "path": path(t), "events": []}]
    for w, dist in A.wells_within(t, radius_km):
        p = path(w)
        evs = [{**e, **at_md(p, e["depth_m"])} for e in w.events if e["depth_m"] <= w.td_m]
        out.append({"well_id": w.id, "name": w.name, "is_target": False, "distance_km": round(dist, 2), "path": p, "events": evs})
    return out


# ------------------------------------------------------------------ analytics
@app.post("/api/offsets/rank")
def rank_offsets(weights: SimilarityWeights, well_id: str = TARGET, radius_km: float = Query(10.0, ge=0.5, le=50)):
    return {"weights": weights.model_dump(), "ranking": A.similarity(_well(well_id), radius_km, weights.model_dump())}


@app.get("/api/offsets")
def offsets(well_id: str = TARGET, radius_km: float = Query(10.0, ge=0.5, le=50)):
    return {"weights": A.DEFAULT_WEIGHTS, "ranking": A.similarity(_well(well_id), radius_km)}


@app.get("/api/risk")
def risk(well_id: str = TARGET, radius_km: float = Query(10.0, ge=0.5, le=50), step: float = Query(50.0, ge=25, le=250)):
    return {"model_version": A.RISK.version, "holdout_auc": A.RISK.auc, "sections": A.RISK.profile(_well(well_id), radius_km, step)}


@app.post("/api/risk/train")
def risk_train():
    return A.RISK.train()


@app.get("/api/lookahead")
def lookahead(well_id: str = TARGET, bit_depth: float = Query(0.0, ge=0, le=6000), radius_km: float = Query(10.0, ge=0.5, le=50),
              window_m: float = Query(300.0, ge=10, le=5000), lang: str = "en"):
    return A.look_ahead(_well(well_id), bit_depth, radius_km, window_m, lang)


@app.get("/api/telemetry")
def telemetry(well_id: str = TARGET, radius_km: float = Query(10.0, ge=0.5, le=50)):
    return A.telemetry(_well(well_id), radius_km)


@app.post("/api/alerts/ack")
def ack(a: AckIn):
    db.x("INSERT INTO acks (alert_key, role) VALUES (?,?)", (a.alert_key, a.role))
    return {"ok": True}


# ------------------------------------------------------------------ ingestion + HITL
def _ingest(doc_type: str, text: str, method: str, well_hint: str | None, title: str) -> dict:
    recs = ingest.parse(text, well_hint)
    well_id = next((r["well_id"] for r in recs if r["well_id"]), well_hint)
    doc_id = f"{doc_type}-UP-{uuid.uuid4().hex[:8]}"
    db.x("INSERT INTO documents VALUES (?,?,?,?,?,?)", (doc_id, well_id, doc_type, 1, title, text))
    saved = ingest.store(doc_id, recs)
    rag.INDEX.build()
    return IngestResponse(doc_id=doc_id, method=method, pages=max(1, text.count("\f") + 1), extractions=saved,
                          needs_review=sum(r["verification_status"] == "pending_review" for r in saved),
                          mean_confidence=round(float(np.mean([r["confidence"] for r in saved])) if saved else 0.0, 3)).model_dump()


@app.post("/api/ingest/wcr-ddr")
async def ingest_file(file: UploadFile = File(...), doc_type: str = Form("DDR"), well_id: str | None = Form(None)):
    data = await file.read()
    try:
        text, method = ingest.extract_text(file.filename or "upload.txt", data)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return _ingest(doc_type.upper(), text, method, well_id or None, file.filename or "upload")


@app.post("/api/ingest/text")
def ingest_text(body: IngestText):
    return _ingest(body.doc_type, body.text, "plain-text", body.well_id, f"{body.doc_type} pasted text")


@app.get("/api/extractions")
def extractions(status: str | None = None, max_conf: float = 1.0):
    import json
    sql, args = "SELECT * FROM extractions WHERE confidence <= ?", [max_conf]
    if status:
        sql += " AND verification_status = ?"
        args.append(status)
    rows = db.q(sql + " ORDER BY id DESC", tuple(args))
    for r in rows:
        r["field_scores"] = json.loads(r["field_scores"])
    return rows


@app.patch("/api/extractions/{ext_id}")
def correct(ext_id: int, c: Correction):
    rows = db.q("SELECT * FROM extractions WHERE id=?", (ext_id,))
    if not rows:
        raise HTTPException(404, "extraction not found")
    r = rows[0]
    if c.action == "reject":
        db.x("UPDATE extractions SET verification_status='rejected' WHERE id=?", (ext_id,))
        db.x("DELETE FROM events WHERE id=?", (f"EX-{ext_id:05d}",))
        return {"id": ext_id, "verification_status": "rejected"}
    if c.event_type and c.event_type != r["event_type"]:
        ingest.learn(r["raw_text"], r["event_type"], c.event_type)
    elif r["event_type"]:
        ingest.learn(r["raw_text"], None, r["event_type"])
    upd = {k: v for k, v in c.model_dump().items() if k != "action" and v is not None}
    r.update(upd)
    r["verification_status"] = "verified"
    r["confidence"] = 1.0
    db.x("UPDATE extractions SET well_id=?, event_type=?, depth_m=?, formation=?, date=?, npt_hours=?, confidence=1.0, verification_status='verified' WHERE id=?",
         (r["well_id"], r["event_type"], r["depth_m"], r["formation"], r["date"], r["npt_hours"], ext_id))
    ingest.promote(r)
    return {k: r[k] for k in ("id", "well_id", "event_type", "depth_m", "formation", "date", "npt_hours", "verification_status")}


@app.post("/api/model/finetune")
def finetune():
    """Retrain the risk model and re-index the corpus with all human-verified events."""
    n_fb = db.q("SELECT COUNT(*) AS n FROM feedback")[0]["n"]
    n_ver = db.q("SELECT COUNT(*) AS n FROM extractions WHERE verification_status='verified'")[0]["n"]
    metrics = A.RISK.train()
    docs = rag.INDEX.build()
    return {"risk_model": metrics, "indexed_documents": docs, "lexicon_terms_learned": n_fb, "verified_extractions": n_ver}


# ------------------------------------------------------------------ knowledge base + RAG
@app.post("/api/search")
def search(s: SearchQuery):
    evs = db.events()
    wells = {w.id: w for w in db.wells()}
    tgt = wells.get(s.well_id) if s.well_id else None
    docs = {d["id"]: d for d in db.q("SELECT id, title, text FROM documents")}
    res = []
    for e in evs:
        if s.formations and e["formation"] not in s.formations:
            continue
        if s.event_types and e["event_type"] not in s.event_types:
            continue
        if s.severities and e["severity"] not in s.severities:
            continue
        if not (s.depth_min <= e["depth_m"] <= s.depth_max):
            continue
        w = wells.get(e["well_id"])
        dist = A.haversine_km(tgt.lat, tgt.lon, w.lat, w.lon) if tgt and w else None
        if s.radius_km and dist is not None and dist > s.radius_km:
            continue
        doc = docs.get(e.get("doc_id"), {})
        if s.text:
            hay = " ".join([doc.get("text", ""), e["formation"], e["event_type"], " ".join(e.get("worked", [])), w.name if w else ""]).lower()
            if not all(tok in hay for tok in s.text.lower().split()):
                continue
        res.append({**e, "well_name": w.name if w else e["well_id"], "field": w.field if w else "", "doc_title": doc.get("title"),
                    "distance_km": None if dist is None else round(dist, 2)})
    res.sort(key=lambda e: (e["distance_km"] if e["distance_km"] is not None else 1e9, e["depth_m"]))
    facets = {k: dict() for k in ("formation", "event_type", "severity")}
    for e in res:
        for k in facets:
            facets[k][e[k]] = facets[k].get(e[k], 0) + 1
    return {"count": len(res), "results": res[:300], "facets": facets}


@app.post("/api/rag/query")
def rag_query(q: RagQuery):
    w = db.well(q.well_id) if q.well_id else None
    return rag.answer(q.query, q.lang, w, q.radius_km, q.k)


@app.get("/api/documents/{doc_id}")
def document(doc_id: str):
    rows = db.q("SELECT * FROM documents WHERE id=?", (doc_id,))
    if not rows:
        raise HTTPException(404, "document not found")
    return rows[0]


@app.get("/api/documents/{doc_id}/pdf")
def document_pdf(doc_id: str, hl_start: int | None = None, hl_end: int | None = None):
    d = document(doc_id)
    hl = (hl_start, hl_end) if hl_start is not None and hl_end is not None else None
    return Response(report.document_pdf(d["title"], d["text"], hl), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{doc_id}.pdf"'})


# ------------------------------------------------------------------ reporting / dashboards
@app.get("/api/report/prespud.pdf")
def prespud(well_id: str = TARGET, radius_km: float = Query(10.0, ge=0.5, le=50)):
    pdf = report.build(_well(well_id), radius_km)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="PreSpud_{well_id}.pdf"'})


@app.get("/api/dashboard/manager")
def manager(well_id: str = TARGET, radius_km: float = Query(10.0, ge=0.5, le=50)):
    t = _well(well_id)
    offs = A.wells_within(t, radius_km)
    evs = [e for o, _ in offs for e in o.events]
    look = A.look_ahead(t, 0.0, radius_km, window_m=F.TD_MAX)
    expected = sum(a["avg_npt_hours"] * len(a["wells_affected"]) / max(1, a["offset_wells"]) for a in look["alerts"])
    saved = expected * MITIGATION_EFFECTIVENESS
    keys = {a["key"] for a in look["alerts"]}
    acked = {r["alert_key"] for r in db.q("SELECT DISTINCT alert_key FROM acks")}
    by_type, by_field, by_year = defaultdict(float), defaultdict(float), defaultdict(float)
    wells = {w.id: w for w in db.wells()}
    for e in evs:
        by_type[e["event_type"]] += e["npt_hours"]
        by_field[wells[e["well_id"]].field] += e["npt_hours"]
        by_year[e["date"][:4]] += e["npt_hours"]
    ext = db.q("SELECT verification_status s, COUNT(*) n FROM extractions GROUP BY s")
    return {
        "offset_wells": len(offs), "historical_events": len(evs), "historical_npt_hours": round(sum(e["npt_hours"] for e in evs), 1),
        "expected_npt_hours_target": round(expected, 1), "npt_hours_saved": round(saved, 1),
        "cost_saved_inr": round(saved * RIG_COST_INR_PER_HR), "rig_cost_inr_per_hr": RIG_COST_INR_PER_HR,
        "mitigation_effectiveness": MITIGATION_EFFECTIVENESS,
        "alerts_total": len(keys), "alerts_acknowledged": len(keys & acked),
        "compliance_pct": round(100 * len(keys & acked) / len(keys), 1) if keys else 100.0,
        "npt_by_event_type": {k: round(v, 1) for k, v in by_type.items()},
        "npt_by_field": {k: round(v, 1) for k, v in by_field.items()},
        "npt_by_year": {k: round(v, 1) for k, v in sorted(by_year.items())},
        "extraction_status": {r["s"]: r["n"] for r in ext}, "model": {"version": A.RISK.version, "holdout_auc": A.RISK.auc},
    }


# ------------------------------------------------------------------ SPA hosting (production build)
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
