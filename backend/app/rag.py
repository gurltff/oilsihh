"""Retrieval-augmented institutional memory over DDR/WCR pages.

Dense-ish retrieval via TF-IDF (word 1-2 grams + char 3-5 grams, cosine),
re-ranked by depth proximity to any depth mentioned in the query and by
geographic proximity to the active well. The answer is composed
extractively from the retrieved lines so every statement carries a
citation to (document, page, highlight span).
"""
from __future__ import annotations

import re
import threading
from collections import defaultdict

import numpy as np
from scipy.sparse import hstack
from sklearn.feature_extraction.text import TfidfVectorizer

from . import db
from .analytics import haversine_km
from .i18n import detect_lang, normalise_query, t


class Index:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.docs: list[dict] = []
        self.mat = None
        self.wv = self.cv = None

    def build(self) -> int:
        docs = db.q("SELECT * FROM documents")
        texts = [d["text"] for d in docs]
        wv = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, stop_words="english")
        cv = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True)
        m = hstack([wv.fit_transform(texts), cv.fit_transform(texts) * 0.5]).tocsr()
        with self.lock:
            self.docs, self.mat, self.wv, self.cv = docs, m, wv, cv
        return len(docs)

    def search(self, query: str, k: int = 6, well=None, radius_km: float | None = None) -> list[dict]:
        if self.mat is None:
            self.build()
        qn = normalise_query(query)
        with self.lock:
            qv = hstack([self.wv.transform([qn]), self.cv.transform([qn]) * 0.5]).tocsr()
            sims = (self.mat @ qv.T).toarray().ravel()
            norms = np.sqrt(self.mat.multiply(self.mat).sum(axis=1)).A.ravel() * max(1e-9, float(np.sqrt(qv.multiply(qv).sum())))
            sims = sims / np.maximum(norms, 1e-9)
            docs = self.docs
        m = re.search(r"(\d[\d,]{2,5})\s*(?:m\b|metre|meter)?", qn)
        qdepth = float(m.group(1).replace(",", "")) if m else None
        wells = {w.id: w for w in db.wells()}
        ev_by_doc = {e["doc_id"]: e for e in db.events()}
        scored = []
        for i, d in enumerate(docs):
            s = float(sims[i])
            ev = ev_by_doc.get(d["id"])
            if qdepth and ev:
                s *= 1.0 + 0.8 * np.exp(-abs(ev["depth_m"] - qdepth) / 150.0)
            if well is not None and d["well_id"] in wells:
                o = wells[d["well_id"]]
                dist = haversine_km(well.lat, well.lon, o.lat, o.lon)
                if radius_km and dist > radius_km:
                    continue
                s *= 1.0 + 0.3 * np.exp(-dist / 5.0)
            scored.append((s, d, ev))
        scored.sort(key=lambda p: -p[0])
        out = []
        for s, d, ev in scored[:k]:
            if s <= 0.02:
                continue
            hl = (ev["hl_start"], ev["hl_end"]) if ev else _first_match(d["text"], qn)
            out.append({"doc_id": d["id"], "title": d["title"], "well_id": d["well_id"], "doc_type": d["doc_type"],
                        "page": d["page"], "score": round(s, 4), "snippet": d["text"][hl[0]:hl[1]],
                        "highlight": {"start": hl[0], "end": hl[1]}, "event": ev})
        return out


def _first_match(text: str, q: str) -> tuple[int, int]:
    for tok in sorted(re.findall(r"[a-zA-Z]{4,}", q), key=len, reverse=True):
        i = text.lower().find(tok.lower())
        if i >= 0:
            s = text.rfind("\n", 0, i) + 1
            e = text.find("\n", i)
            return s, e if e > 0 else len(text)
    return 0, min(len(text), 160)


INDEX = Index()


def answer(query: str, lang: str | None = None, well=None, radius_km: float | None = None, k: int = 6) -> dict:
    lang = lang or detect_lang(query)
    hits = INDEX.search(query, k=k, well=well, radius_km=radius_km)
    if not hits:
        return {"answer": t("rag.none", lang), "language": lang, "citations": []}
    worked, failed = defaultdict(list), defaultdict(list)
    for i, h in enumerate(hits, 1):
        text = next(d["text"] for d in INDEX.docs if d["id"] == h["doc_id"])
        for m in re.finditer(r"Remedial: (.+?)\.\s*$", text, re.M):
            worked[m.group(1)].append(i)
        for m in re.finditer(r"initial attempt failed - (.+?)\.\s*$", text, re.M):
            failed[m.group(1)].append(i)
    lines = [t("rag.intro", lang, n=len(hits))]
    for i, h in enumerate(hits, 1):
        ev = h["event"]
        if ev:
            lines.append(f"[{i}] {h['title']}: {ev['event_type'].replace('_', ' ')} at {ev['depth_m']:.0f} m in "
                         f"{ev['formation']}, {ev['npt_hours']} h NPT.")
        else:
            lines.append(f"[{i}] {h['title']}: {h['snippet']}")
    if worked:
        lines.append(f"\n✅ {t('rag.worked', lang)}:")
        for a, refs in sorted(worked.items(), key=lambda kv: -len(kv[1])):
            lines.append(f"  • {a} " + "".join(f"[{r}]" for r in refs))
    if failed:
        lines.append(f"\n❌ {t('rag.failed', lang)}:")
        for a, refs in sorted(failed.items(), key=lambda kv: -len(kv[1])):
            lines.append(f"  • {a} " + "".join(f"[{r}]" for r in refs))
    return {"answer": "\n".join(lines), "language": lang, "citations": hits}
