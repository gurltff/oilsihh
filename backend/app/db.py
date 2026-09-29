"""SQLite persistence (drop-in replaceable with PostGIS: see README).

Tables
  wells(id, json)                    well header + tops + trajectory params
  events(id, well_id, ..., json)     verified historical drilling events
  documents(id, well_id, doc_type, page, text)
  extractions(id, ..., status)       NLP output awaiting / after human review
  feedback(term, event_type, weight) lexicon weights learned from corrections
  acks(id, alert_key, ts, role)      alert acknowledgements (compliance KPI)
"""
from __future__ import annotations

import json
import os
import random
import sqlite3
import threading
from pathlib import Path

from . import field as F

DB_PATH = Path(os.environ.get("NWIS_DB", Path(__file__).resolve().parent.parent / "data" / "nwis.db"))
_lock = threading.RLock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS wells (id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, well_id TEXT, event_type TEXT, depth_m REAL, formation TEXT,
  date TEXT, npt_hours REAL, severity TEXT, doc_id TEXT, page INTEGER,
  hl_start INTEGER, hl_end INTEGER, source TEXT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, well_id TEXT, doc_type TEXT, page INTEGER, title TEXT, text TEXT);
CREATE TABLE IF NOT EXISTS extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT, well_id TEXT, event_type TEXT,
  depth_m REAL, formation TEXT, date TEXT, npt_hours REAL, raw_text TEXT,
  confidence REAL, field_scores TEXT, verification_status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS feedback (term TEXT, event_type TEXT, weight REAL, PRIMARY KEY(term, event_type));
CREATE TABLE IF NOT EXISTS acks (id INTEGER PRIMARY KEY AUTOINCREMENT, alert_key TEXT, role TEXT, ts TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""


def conn() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.executescript(SCHEMA)
            if _conn.execute("SELECT COUNT(*) FROM wells").fetchone()[0] == 0:
                seed(_conn)
        return _conn


def reset_for_tests(path: str) -> None:
    global _conn, DB_PATH
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn = None
        DB_PATH = Path(path)
        if DB_PATH.exists():
            DB_PATH.unlink()


def seed(c: sqlite3.Connection) -> None:
    rng = random.Random(7)
    wells = F.build_field()
    for w in wells:
        header = {k: v for k, v in w.__dict__.items() if k != "events"}
        c.execute("INSERT INTO wells VALUES (?,?)", (w.id, json.dumps(header)))
        page = 0
        for ev in sorted(w.events, key=lambda e: e["depth_m"]):
            page += 1
            doc_type = "DDR" if rng.random() < 0.75 else "WCR"
            doc_id = f"{doc_type}-{w.id}"
            text = F.render_ddr(w, ev, page, rng)
            if doc_type == "WCR":
                text = text.replace("DAILY DRILLING REPORT", "WELL COMPLETION REPORT")
            # highlight = the event line (bounding "box" in text coordinates)
            marker = f"At {ev['depth_m']:.0f} m:"
            s = text.index(marker)
            e = text.index("\n", s)
            c.execute("INSERT OR REPLACE INTO documents VALUES (?,?,?,?,?,?)",
                      (f"{doc_id}-p{page}", w.id, doc_type, page, f"{doc_type} {w.name} p.{page}", text))
            c.execute(
                "INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (ev["id"], w.id, ev["event_type"], ev["depth_m"], ev["formation"], ev["date"], ev["npt_hours"],
                 ev["severity"], f"{doc_id}-p{page}", page, s, e, "seed", json.dumps(ev)),
            )
    c.commit()


def q(sql: str, args: tuple = ()) -> list[dict]:
    with _lock:
        return [dict(r) for r in conn().execute(sql, args).fetchall()]


def x(sql: str, args: tuple = ()) -> int:
    with _lock:
        c = conn()
        cur = c.execute(sql, args)
        c.commit()
        return cur.lastrowid


def wells() -> list[F.Well]:
    out = []
    for r in q("SELECT json FROM wells"):
        d = json.loads(r["json"])
        d["tops"] = [tuple(t) for t in d["tops"]]
        out.append(F.Well(**d))
    evs = events()
    by = {w.id: w for w in out}
    for e in evs:
        if e["well_id"] in by:
            by[e["well_id"]].events.append(e)
    return out


def events() -> list[dict]:
    res = []
    for r in q("SELECT * FROM events"):
        d = json.loads(r.pop("json"))
        d.update({k: r[k] for k in ("doc_id", "page", "hl_start", "hl_end", "source")})
        res.append(d)
    return res


def well(well_id: str) -> F.Well | None:
    return next((w for w in wells() if w.id == well_id), None)
