"""Similarity ranking, explainable XGBoost risk model, look-ahead engine, telemetry."""
from __future__ import annotations

import math
import random
import threading
from collections import defaultdict

import numpy as np
import xgboost as xgb

from . import db
from . import field as F
from .i18n import t

EVENT_TYPES = ["loss", "kick", "stuck_pipe", "caving"]
BIN_M = 50.0


# ---------------------------------------------------------------- geometry
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def wells_within(target: F.Well, radius_km: float, all_wells: list[F.Well] | None = None) -> list[tuple[F.Well, float]]:
    ws = all_wells or db.wells()
    res = []
    for w in ws:
        if w.id == target.id or w.is_target:
            continue
        d = haversine_km(target.lat, target.lon, w.lat, w.lon)
        if d <= radius_km:
            res.append((w, d))
    return sorted(res, key=lambda p: p[1])


# ---------------------------------------------------------------- similarity
DEFAULT_WEIGHTS = {"distance": 0.30, "lithology": 0.30, "mud_weight": 0.25, "trajectory": 0.15}


def lithology_overlap(a: F.Well, b: F.Well) -> float:
    """Depth-interval IoU per formation, thickness-weighted over the common depth range."""
    td = min(a.td_m, b.td_m)
    inter = union = 0.0
    for fm, _ in F.FORMATIONS:
        ia, ib = F.formation_interval(a.tops, fm, td), F.formation_interval(b.tops, fm, td)
        if not ia or not ib:
            continue
        lo, hi = max(ia[0], ib[0]), min(ia[1], ib[1])
        inter += max(0.0, hi - lo)
        union += max(ia[1], ib[1]) - min(ia[0], ib[0])
    return inter / union if union else 0.0


def mw_profile_delta(a: F.Well, b: F.Well) -> float:
    depths = np.arange(500, min(a.td_m, b.td_m), 100)
    d = [abs(F.mud_weight_ppg(z, a.mw_offset) - F.mud_weight_ppg(z, b.mw_offset)) +
         abs(F.pore_pressure_ppg(z, a.pp_offset) - F.pore_pressure_ppg(z, b.pp_offset)) for z in depths]
    return float(np.mean(d)) if len(d) else 0.0


def similarity(target: F.Well, radius_km: float, weights: dict | None = None) -> list[dict]:
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    tot = sum(w.values()) or 1.0
    w = {k: v / tot for k, v in w.items()}
    out = []
    for off, dist in wells_within(target, radius_km):
        comp = {
            "distance": math.exp(-dist / 5.0),
            "lithology": lithology_overlap(target, off),
            "mud_weight": max(0.0, 1.0 - mw_profile_delta(target, off) / 1.5),
            "trajectory": max(0.0, math.cos(math.radians(abs(target.inclination_deg - off.inclination_deg)) * 2)),
        }
        score = sum(w[k] * comp[k] for k in comp)
        out.append({
            "well_id": off.id, "name": off.name, "field": off.field, "distance_km": round(dist, 2),
            "components": {k: round(v, 3) for k, v in comp.items()}, "score": round(score, 4),
            "npt_total": round(sum(e["npt_hours"] for e in off.events), 1), "event_count": len(off.events),
        })
    out.sort(key=lambda r: -r["score"])
    for i, r in enumerate(out):
        r["rank"] = i + 1
    return out


# ---------------------------------------------------------------- risk model
FEATURES = [
    "depth_m", "formation_code", "mud_weight_ppg", "pore_pressure_ppg", "frac_gradient_ppg",
    "mw_overbalance_ppg", "drilling_window_ppg", "inclination_deg", "dist_to_top_m",
    "offset_event_density", "offset_npt_density",
]
FEATURE_LABELS = {
    "depth_m": "Depth", "formation_code": "Formation lithology", "mud_weight_ppg": "Mud weight",
    "pore_pressure_ppg": "Pore pressure gradient", "frac_gradient_ppg": "Fracture gradient",
    "mw_overbalance_ppg": "Mud weight overbalance (MW - PP)", "drilling_window_ppg": "Narrow MW window (FG - MW)",
    "inclination_deg": "Hole inclination", "dist_to_top_m": "Proximity to formation top",
    "offset_event_density": "Offset-well event density", "offset_npt_density": "Offset-well NPT density",
}


def _inc_at(w: F.Well, md: float) -> float:
    return 0.0 if md <= w.kop_m else min(w.inclination_deg, (md - w.kop_m) * 2.5 / 30.0)


def _row(w: F.Well, depth: float, offsets: list[tuple[F.Well, float]]) -> list[float]:
    fm = F.formation_at(w.tops, depth)
    top = dict(w.tops)[fm]
    mw, pp, fg = F.mud_weight_ppg(depth, w.mw_offset), F.pore_pressure_ppg(depth, w.pp_offset), F.frac_gradient_ppg(depth, fm)
    dens = npt = 0.0
    for o, dist in offsets:
        wgt = math.exp(-dist / 5.0)
        for e in o.events:
            if abs(e["depth_m"] - depth) <= 100:
                dens += wgt
                npt += wgt * e["npt_hours"]
    return [depth, F.LITHO_CODE[fm], mw, pp, fg, mw - pp, fg - mw, _inc_at(w, depth), depth - top, dens, npt]


class RiskModel:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.model: xgb.Booster | None = None
        self.version = 0
        self.n_train = 0
        self.auc = None

    def train(self) -> dict:
        ws = [w for w in db.wells() if not w.is_target]
        X, y = [], []
        for w in ws:
            offs = wells_within(w, 8.0, ws)
            hit = defaultdict(int)
            for e in w.events:
                hit[int(e["depth_m"] // BIN_M)] = 1
            for b in range(int(300 // BIN_M), int(w.td_m // BIN_M)):
                X.append(_row(w, b * BIN_M + BIN_M / 2, offs))
                y.append(hit[b])
        X, y = np.array(X, dtype=float), np.array(y, dtype=float)
        rng = np.random.default_rng(0)
        idx = rng.permutation(len(y))
        cut = int(len(y) * 0.8)
        tr, te = idx[:cut], idx[cut:]
        params = {"objective": "binary:logistic", "max_depth": 4, "eta": 0.08, "subsample": 0.9,
                  "colsample_bytree": 0.9, "eval_metric": "auc", "scale_pos_weight": max(1.0, (y == 0).sum() / max(1, (y == 1).sum()) / 2), "seed": 0}
        dtr = xgb.DMatrix(X[tr], label=y[tr], feature_names=FEATURES)
        dte = xgb.DMatrix(X[te], label=y[te], feature_names=FEATURES)
        booster = xgb.train(params, dtr, num_boost_round=220)
        auc = float(booster.eval(dte).split(":")[-1])
        with self.lock:
            self.model = booster
            self.version += 1
            self.n_train = int(len(y))
            self.auc = round(auc, 3)
        return {"version": self.version, "samples": self.n_train, "positives": int(y.sum()), "holdout_auc": self.auc}

    def profile(self, target: F.Well, radius_km: float, step: float = BIN_M) -> list[dict]:
        if self.model is None:
            self.train()
        offs = wells_within(target, radius_km)
        depths = np.arange(step / 2, target.td_m, step)
        X = np.array([_row(target, d, offs) for d in depths])
        dm = xgb.DMatrix(X, feature_names=FEATURES)
        with self.lock:
            p = self.model.predict(dm)
            contribs = self.model.predict(dm, pred_contribs=True)  # exact TreeSHAP
        out = []
        for i, d in enumerate(depths):
            shap = contribs[i][:-1]
            order = np.argsort(-np.abs(shap))[:4]
            drivers = [{"feature": FEATURES[j], "label": FEATURE_LABELS[FEATURES[j]], "value": round(float(X[i][j]), 2),
                        "shap": round(float(shap[j]), 3)} for j in order]
            prob = float(p[i])
            out.append({
                "top_m": float(d - step / 2), "base_m": float(d + step / 2), "formation": F.formation_at(target.tops, d),
                "risk": round(prob, 3), "level": "high" if prob >= 0.6 else "moderate" if prob >= 0.3 else "low",
                "drivers": drivers, "why": explain(drivers, target, d, offs),
            })
        return out


def explain(drivers: list[dict], target: F.Well, depth: float, offs) -> str:
    parts = []
    for dv in drivers:
        if dv["shap"] <= 0:
            continue
        f = dv["feature"]
        if f in ("offset_event_density", "offset_npt_density"):
            near = [(o, e) for o, _ in offs for e in o.events if abs(e["depth_m"] - depth) <= 100]
            if near:
                o, e = max(near, key=lambda p: p[1]["npt_hours"])
                parts.append(f"{e['event_type'].replace('_', ' ')} in offset well {o.name} at {e['depth_m']:.0f} m ({e['npt_hours']} h NPT)")
        elif f == "mw_overbalance_ppg":
            parts.append(f"{dv['value']:+.1f} ppg mud weight overbalance")
        elif f == "drilling_window_ppg":
            parts.append(f"narrow {dv['value']:.1f} ppg MW-to-frac window")
        elif f == "pore_pressure_ppg":
            parts.append(f"high pore pressure gradient ({dv['value']:.1f} ppg)")
        elif f == "formation_code":
            parts.append(f"{F.formation_at(target.tops, depth)} lithology")
        elif f == "dist_to_top_m":
            parts.append(f"{dv['value']:.0f} m below formation top")
        else:
            parts.append(f"{dv['label'].lower()} ({dv['value']})")
    uniq = list(dict.fromkeys(parts))[:3]
    return ("Driven by: " + " + ".join(uniq)) if uniq else "No dominant risk driver; baseline risk."


RISK = RiskModel()


# ---------------------------------------------------------------- look-ahead
def mitigations_for(events: list[dict]) -> dict:
    worked, failed = defaultdict(int), defaultdict(int)
    for e in events:
        for m in e.get("worked", []):
            worked[m] += 1
        for m in e.get("failed", []):
            failed[m] += 1
    return {
        "worked": [{"action": k, "count": v} for k, v in sorted(worked.items(), key=lambda kv: -kv[1])][:3],
        "failed": [{"action": k, "count": v} for k, v in sorted(failed.items(), key=lambda kv: -kv[1])][:3],
    }


def look_ahead(target: F.Well, bit_depth: float, radius_km: float, window_m: float = 300.0, lang: str = "en") -> dict:
    offs = wells_within(target, radius_km)
    n_off = len(offs)
    alerts = []
    for i, (fm, top) in enumerate(target.tops):
        base = target.tops[i + 1][1] if i + 1 < len(target.tops) else target.td_m
        if base <= bit_depth or top - bit_depth > window_m:
            continue
        dist_to = max(0.0, top - bit_depth)
        # offset events in the same formation, mapped to the target's depth frame
        hits = []
        for o, dkm in offs:
            o_iv = F.formation_interval(o.tops, fm, o.td_m)
            if not o_iv:
                continue
            for e in o.events:
                if e["formation"] == fm:
                    mapped = top + (e["depth_m"] - o_iv[0])
                    if mapped >= bit_depth - 20:
                        hits.append({**e, "offset_well": o.name, "distance_km": round(dkm, 2), "mapped_depth_m": round(mapped, 0)})
        by_type = defaultdict(list)
        for h in hits:
            by_type[h["event_type"]].append(h)
        for etype, evs in by_type.items():
            wells_hit = sorted({e["offset_well"] for e in evs})
            avg_npt = round(float(np.mean([e["npt_hours"] for e in evs])), 1)
            lo, hi = min(e["mapped_depth_m"] for e in evs), max(e["mapped_depth_m"] for e in evs)
            ratio = len(wells_hit) / max(1, n_off)
            sev = "high" if (avg_npt >= 10 and ratio >= 0.3) or ratio >= 0.6 else "moderate" if ratio >= 0.2 else "low"
            ctx = {"dist": f"{dist_to:.0f}", "fm": fm, "k": len(wells_hit), "n": n_off,
                   "event": t(f"event.{etype}", lang), "npt": avg_npt, "lo": f"{lo:,.0f}", "hi": f"{hi:,.0f}"}
            key = "alert.inside" if dist_to == 0 else "alert.approach"
            alerts.append({
                "key": f"{target.id}:{fm}:{etype}", "formation": fm, "formation_top_m": top, "distance_m": round(dist_to, 1),
                "event_type": etype, "severity": sev, "wells_affected": wells_hit, "offset_wells": n_off,
                "avg_npt_hours": avg_npt, "depth_range": [lo, hi], "message": t(key, lang, **ctx),
                "mitigation": mitigations_for(evs), "evidence": sorted(evs, key=lambda e: -e["npt_hours"])[:5],
            })
    sev_rank = {"high": 0, "moderate": 1, "low": 2}
    alerts.sort(key=lambda a: (sev_rank[a["severity"]], a["distance_m"]))
    return {"bit_depth_m": bit_depth, "current_formation": F.formation_at(target.tops, bit_depth), "alerts": alerts}


# ---------------------------------------------------------------- telemetry replay
def telemetry(target: F.Well, radius_km: float, step: float = 5.0) -> list[dict]:
    """Synthetic MWD/LWD stream conditioned on the offset hazard picture."""
    rng = random.Random(11)
    offs = wells_within(target, radius_km)
    hazard_depths = []
    for o, _ in offs:
        for e in o.events:
            iv = F.formation_interval(o.tops, e["formation"], o.td_m)
            if iv:
                hazard_depths.append((dict(target.tops)[e["formation"]] + e["depth_m"] - iv[0], e["event_type"]))
    out = []
    t_min = 0.0
    for md in np.arange(0, target.td_m + step, step):
        fm = F.formation_at(target.tops, md)
        rop = {"Alluvium": 35, "Namsang": 28, "Girujan Clay": 18, "Tipam Sandstone": 22, "Barail Coal": 12,
               "Kopili Shale": 9, "Sylhet Limestone": 7}[fm] * rng.uniform(0.8, 1.2)
        spp = 800 + md * 0.55 + rng.gauss(0, 25)
        torque = 4 + md / 5000 * 18 + rng.gauss(0, 0.6)
        gas = 50 + (400 if fm in ("Barail Coal", "Tipam Sandstone") else 0) * rng.random()
        near = [h for h in hazard_depths if abs(h[0] - md) < 15]
        for _, et in near[:1]:
            if et == "loss":
                spp -= 180
            elif et == "kick":
                gas += 2500
            elif et == "stuck_pipe":
                torque += 9
                rop *= 0.3
            elif et == "caving":
                torque += 4
        t_min += step / max(rop, 1) * 60
        out.append({"md": float(md), "t_min": round(t_min, 1), "rop": round(rop, 1), "spp_psi": round(spp, 0),
                    "torque_kftlb": round(torque, 1), "gas_ppm": round(gas, 0), "formation": fm,
                    "mud_weight_ppg": F.mud_weight_ppg(md, target.mw_offset)})
    return out


def casing_seats(target: F.Well, profile: list[dict]) -> list[dict]:
    """Recommend casing seats ~30 m above the top of each high-risk formation where the MW window narrows."""
    seats = [{"depth_m": 450.0, "casing": "13 3/8 in surface", "reason": "Isolate alluvium / shallow aquifers"}]
    sizes = iter(["9 5/8 in intermediate", "7 in production liner", "5 in liner"])
    for fm, top in target.tops[3:]:
        zone = [r for r in profile if r["formation"] == fm]
        if not zone:
            continue
        peak = max(r["risk"] for r in zone)
        if peak >= 0.45:
            try:
                size = next(sizes)
            except StopIteration:
                break
            seats.append({"depth_m": top - 30, "casing": size,
                          "reason": f"Set above {fm} (peak risk {peak:.0%}) to protect weaker shallow shoe"})
    return seats
