# eRTMAC-NWIS — Nearby Wells Intelligence System

Decision-support platform for Oil India Limited (SIH PS **26121**). It turns decades of offset-well DDR/WCR
records around Duliajan, Moran, Digboi and Naharkatiya into look-ahead hazard alerts for a well being drilled.

| Layer | Stack |
|---|---|
| API | FastAPI · Pydantic v2 · SQLite (schema is PostGIS-portable) |
| ML | XGBoost risk model with exact TreeSHAP explanations · TF-IDF (word + char n-gram) retrieval |
| Docs | fpdf2 (pre-spud briefing, source-page PDFs) · pypdf text layer · optional Tesseract OCR |
| UI | React 18 + TypeScript · Tailwind · Leaflet (OpenStreetMap, no API keys) · Plotly.js (strip logs, WebGL 3D) |

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
cd frontend && npm install && npm run build && cd ..
cd backend && ../.venv/bin/uvicorn app.main:app --port 8000   # serves the API and the built UI on http://localhost:8000
```

For development, run `npm run dev` in `frontend/`; Vite proxies `/api` to port 8000. API docs are at `/docs`.
Tests: `cd backend && ../.venv/bin/python -m pytest`.

On first start the database (`backend/data/nwis.db`) is seeded with a deterministic synthetic field. It has 22 wells
with formation tops, pore-pressure and frac profiles, and historical events with mitigation outcomes, plus the DDR/WCR
pages those events were reported in. Replace `app/field.py` / `db.seed` with a real OIL data loader to go live.

## Feature map

| Spec item | Where |
|---|---|
| Map + 1–15 km radius filter, map → correlation sync | `components/Map.tsx`, `GET /api/wells` |
| Stacked strip logs (lithology · GR · MW/PP/FG · NPT flags) on one 0–5000 m depth axis | `components/Correlation.tsx`, `GET /api/wells/{id}/log` |
| OCR/NLP DDR/WCR ingestion, per-field confidence, review queue < 0.85 | `app/ingest.py`, `POST /api/ingest/wcr-ddr`, `POST /api/ingest/text` |
| Verify & Correct → lexicon learning + model fine-tune | `components/Ingest.tsx`, `PATCH /api/extractions/{id}`, `POST /api/model/finetune` |
| Faceted knowledge-base search | `components/KnowledgeBase.tsx`, `POST /api/search` |
| Look-ahead depth alerts with what worked / what failed | `components/LookAhead.tsx`, `GET /api/lookahead` |
| RAG chat with citations → source page with highlighted span / PDF | `app/rag.py`, `components/RAGChat.tsx`, `components/DocModal.tsx`, `POST /api/rag/query` |
| Explainable risk per depth section (XGBoost + SHAP "Why" panel) | `app/analytics.py::RiskModel`, `components/RiskPanel.tsx`, `GET /api/risk` |
| Weighted offset similarity (distance, lithology IoU, MW/PP delta, trajectory) | `app/analytics.py::similarity`, `components/SimilarityTable.tsx` |
| Live MWD replay (Play/Pause/1-5-10x/Scrub) | `components/ReplayBar.tsx`, `components/TelemetryPanel.tsx`, `GET /api/telemetry` |
| 3D trajectories + hazard markers | `components/Trajectory3D.tsx`, `GET /api/trajectories3d` |
| OLED field mode, Service Worker + LocalStorage offline cache | `public/sw.js`, `lib/api.ts::cachedGet` |
| English / हिन्दी / অসমীয়া alerts, UI and queries | `app/i18n.py`, `lib/i18n.ts` |
| Pre-spud PDF briefing (ranking, hazard matrix, risk sections, casing seats, lessons) | `app/report.py`, `GET /api/report/prespud.pdf` |
| Driller / Geologist / Manager views; NPT saved, ₹ impact, alert compliance | `App.tsx`, `components/ManagerDashboard.tsx`, `GET /api/dashboard/manager` |

### Notes and assumptions
- **Similarity** = Σ wᵢ·componentᵢ, with each component normalised to [0,1]: `e^(−d/5 km)`, the thickness-weighted
  formation-interval IoU, `1 − mean(|ΔMW|+|ΔPP|)/1.5 ppg`, and `cos(2·Δinclination)`. The UI can re-tune the weights live.
  A far well with matching geomechanics can therefore outrank a nearby dissimilar one.
- **Risk model**: 50 m intervals from every offset well are labelled by whether an event occurred there. The features
  are depth, lithology, MW, PP, FG, overbalance, MW window, inclination, distance below the formation top and
  distance-weighted offset event/NPT density. The model reports hold-out AUC, and the "Why" text is built from the top
  positive SHAP contributors.
- **Manager KPIs**: NPT saved = Σ(alert avg NPT × offset hit-rate) × mitigation efficacy. The efficacy and rig-cost
  inputs are configurable via `NWIS_MITIGATION_EFFECTIVENESS` (default 0.55) and `NWIS_RIG_COST_INR_PER_HR`
  (default ₹110,000). Compliance = acknowledged alerts / alerts raised.
- **RAG** is extractive, so every sentence in an answer comes from a retrieved report line and carries its citation.
  Hindi and Assamese queries are normalised (script digits plus a drilling glossary) before retrieval.
- **OCR**: PDFs use their text layer. Scanned images need `pytesseract`, Pillow and the `tesseract` binary.
- **PostGIS**: distances use haversine in Python. To switch, move `wells` to a `geography(Point)` column and replace
  `wells_within` with `ST_DWithin`.
