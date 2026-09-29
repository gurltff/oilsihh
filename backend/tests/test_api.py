import os
import tempfile

import pytest
from fastapi.testclient import TestClient

from app import db


@pytest.fixture(scope="module")
def client():
    db.reset_for_tests(os.path.join(tempfile.mkdtemp(), "t.db"))
    from app.main import app
    with TestClient(app) as c:
        yield c


def test_similarity_bounded_and_ranked(client):
    r = client.get("/api/offsets", params={"radius_km": 15}).json()["ranking"]
    assert r and all(0 <= v <= 1 for x in r for v in x["components"].values())
    assert [x["score"] for x in r] == sorted((x["score"] for x in r), reverse=True)


def test_radius_filter(client):
    ws = client.get("/api/wells", params={"radius_km": 2}).json()
    assert all(w["distance_km"] <= 2 for w in ws if w["in_radius"] and not w["is_target"])


def test_lookahead_tipam_loss(client):
    la = client.get("/api/lookahead", params={"bit_depth": 2775, "radius_km": 10}).json()
    a = next(a for a in la["alerts"] if a["formation"] == "Tipam Sandstone" and a["event_type"] == "loss")
    assert a["distance_m"] == 45 and "45m to Tipam Sandstone" in a["message"]
    assert a["mitigation"]["worked"]
    hi = client.get("/api/lookahead", params={"bit_depth": 2775, "lang": "hi"}).json()
    assert "चेतावनी" in hi["alerts"][0]["message"]


def test_risk_profile_has_shap(client):
    s = client.get("/api/risk").json()["sections"]
    assert all(0 <= x["risk"] <= 1 for x in s)
    assert any(x["level"] == "high" for x in s) and s[0]["drivers"]


def test_ingest_verify_finetune(client):
    txt = "Well: Duliajan-03  Field: Duliajan  Date: 12/03/2019\nObserved heavy splintery material on shakers near 3300 m"
    r = client.post("/api/ingest/text", json={"text": txt}).json()
    e = r["extractions"][0]
    assert e["confidence"] < 0.85 and e["verification_status"] == "pending_review"
    v = client.patch(f"/api/extractions/{e['id']}", json={"event_type": "caving", "npt_hours": 5, "formation": "Tipam Sandstone"}).json()
    assert v["verification_status"] == "verified"
    f = client.post("/api/model/finetune").json()
    assert f["verified_extractions"] >= 1 and f["lexicon_terms_learned"] > 0


def test_rag_citations_multilingual(client):
    r = client.post("/api/rag/query", json={"query": "What mitigation worked at 2,800m in nearby wells?"}).json()
    c = r["citations"][0]
    doc = client.get(f"/api/documents/{c['doc_id']}").json()
    assert doc["text"][c["highlight"]["start"]:c["highlight"]["end"]] == c["snippet"]
    assert "What worked" in r["answer"]
    assert client.post("/api/rag/query", json={"query": "২৮০০ মিটাৰত লছৰ সমাধান"}).json()["language"] == "as"


def test_search_filters(client):
    r = client.post("/api/search", json={"formations": ["Barail Coal"], "severities": ["high"], "depth_min": 3000, "depth_max": 4500}).json()
    assert r["count"] > 0 and all(x["formation"] == "Barail Coal" and x["severity"] == "high" for x in r["results"])


def test_pdfs_and_dashboard(client):
    assert client.get("/api/report/prespud.pdf").content[:4] == b"%PDF"
    d = client.get("/api/dashboard/manager").json()
    assert d["npt_hours_saved"] > 0
    key = client.get("/api/lookahead", params={"window_m": 5000}).json()["alerts"][0]["key"]
    client.post("/api/alerts/ack", json={"alert_key": key})
    assert client.get("/api/dashboard/manager").json()["alerts_acknowledged"] == 1
    t3 = client.get("/api/trajectories3d").json()
    assert t3[0]["is_target"] and any(w["events"] for w in t3[1:])
