"""Synthetic-but-physically-consistent Upper Assam field model.

Generates the demo dataset: well headers, trajectories, stratigraphy,
mud-weight / pore-pressure profiles, historical drilling events with
mitigation outcomes, and the DDR/WCR documents those events were
"reported" in. Everything is deterministic (seeded) so demos are repeatable.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

# Upper Assam shelf stratigraphy (top-down) with nominal tops for the
# Duliajan area. Per-well tops are jittered around these values.
FORMATIONS = [
    ("Alluvium", 0),
    ("Namsang", 450),
    ("Girujan Clay", 1150),
    ("Tipam Sandstone", 2820),
    ("Barail Coal", 3480),
    ("Kopili Shale", 4150),
    ("Sylhet Limestone", 4600),
]
TD_MAX = 5000.0

LITHO_CODE = {name: i for i, (name, _) in enumerate(FORMATIONS)}

# Hazard propensity per formation: (event_type, base probability per well, mean NPT hrs)
HAZARDS = {
    "Girujan Clay": [("stuck_pipe", 0.45, 9.0), ("caving", 0.2, 5.0)],
    "Tipam Sandstone": [("loss", 0.7, 14.0), ("kick", 0.15, 8.0)],
    "Barail Coal": [("stuck_pipe", 0.5, 16.0), ("caving", 0.45, 7.0), ("loss", 0.2, 6.0)],
    "Kopili Shale": [("caving", 0.5, 8.0), ("kick", 0.35, 11.0)],
    "Sylhet Limestone": [("loss", 0.3, 10.0)],
    "Namsang": [("loss", 0.08, 3.0)],
}

MITIGATIONS = {
    "loss": {
        "worked": [
            "LCM pill (4 ppb) + reduced ROP to 3 m/hr",
            "Pumped 40 bbl CaCO3 fine/medium LCM pill, reduced flow rate by 15%",
            "Lowered ECD by reducing pump rate; bridged with graded LCM",
            "Set cement plug across loss zone and drilled out at 10.2 ppg",
        ],
        "failed": [
            "Increasing mud density above 11.8 ppg worsened formation fracture",
            "Continued drilling blind without LCM led to total loss",
            "Coarse nut-plug LCM plugged MWD tool, forced trip",
        ],
    },
    "kick": {
        "worked": [
            "Shut-in, Driller's method circulation, raised MW by 0.4 ppg",
            "Wait-and-weight kill with 12.4 ppg kill mud",
            "Flow check every stand while drilling through gas-bearing sands",
        ],
        "failed": [
            "Delayed shut-in after pit gain alarm increased influx volume",
            "Pumping out of hole at high speed swabbed in gas",
        ],
    },
    "stuck_pipe": {
        "worked": [
            "Jarred down with 60 klbs overpull limit, spotted pipe-lax pill",
            "Switched to KCl-polymer mud (7% KCl) to inhibit clay swelling",
            "Backreamed each stand and maintained 120 rpm rotation",
        ],
        "failed": [
            "Pulling above 120 klbs overpull parted the string",
            "Water-based mud without inhibitor caused bit balling",
        ],
    },
    "caving": {
        "worked": [
            "Raised MW by 0.3 ppg for borehole stability, high-vis sweeps",
            "Reduced trip speed and added asphaltic shale stabilizer",
        ],
        "failed": [
            "High-rate washing caused further wellbore enlargement",
            "Low MW (9.2 ppg) insufficient to support Kopili shale",
        ],
    },
}

FIELD_CENTERS = {
    "Duliajan": (27.360, 95.320),
    "Moran": (26.920, 94.930),
    "Digboi": (27.393, 95.620),
    "Naharkatiya": (27.290, 95.340),
}


@dataclass
class Well:
    id: str
    name: str
    field: str
    lat: float
    lon: float
    kb_m: float
    status: str
    spud_year: int
    inclination_deg: float
    azimuth_deg: float
    kop_m: float
    td_m: float
    tops: list[tuple[str, float]]
    mw_offset: float  # ppg shift applied to regional mud-weight profile
    pp_offset: float  # ppg shift applied to regional pore-pressure profile
    is_target: bool = False
    events: list[dict] = field(default_factory=list)


def formation_at(tops: list[tuple[str, float]], depth: float) -> str:
    name = tops[0][0]
    for fm, top in tops:
        if depth >= top:
            name = fm
    return name


def formation_interval(tops: list[tuple[str, float]], fm: str, td: float) -> tuple[float, float] | None:
    for i, (name, top) in enumerate(tops):
        if name == fm:
            if top >= td:
                return None
            base = tops[i + 1][1] if i + 1 < len(tops) else td
            return top, min(base, td)
    return None


def pore_pressure_ppg(depth: float, pp_offset: float) -> float:
    """Hydrostatic (8.6 ppg) ramping into mild overpressure in Barail/Kopili."""
    base = 8.6
    if depth > 3300:
        base += (depth - 3300) / 1700 * 2.4
    return round(base + pp_offset, 2)


def frac_gradient_ppg(depth: float, fm: str) -> float:
    fg = 12.0 + depth / 5000 * 3.5
    if fm == "Tipam Sandstone":
        fg -= 1.4  # weak, high-permeability sands -> narrow window
    if fm == "Sylhet Limestone":
        fg -= 0.8  # fractured carbonate
    return round(fg, 2)


def mud_weight_ppg(depth: float, mw_offset: float) -> float:
    mw = 9.0 + depth / 5000 * 3.2
    return round(mw + mw_offset, 2)


def gamma_ray(fm: str, depth: float, rng: random.Random) -> float:
    base = {
        "Alluvium": 55, "Namsang": 60, "Girujan Clay": 115, "Tipam Sandstone": 45,
        "Barail Coal": 85, "Kopili Shale": 130, "Sylhet Limestone": 30,
    }[fm]
    return round(base + 12 * math.sin(depth / 37.0) + rng.gauss(0, 7), 1)


def trajectory(w: Well, step: float = 50.0) -> list[dict]:
    """Minimum-curvature-ish build-and-hold path in local ENU metres."""
    pts = []
    x = y = 0.0
    tvd = 0.0
    md = 0.0
    build_rate = 2.5 / 30.0  # deg per m
    az = math.radians(w.azimuth_deg)
    while md <= w.td_m + 1e-6:
        inc = 0.0 if md <= w.kop_m else min(w.inclination_deg, (md - w.kop_m) * build_rate)
        pts.append({"md": round(md, 1), "tvd": round(tvd, 1), "east": round(x, 1), "north": round(y, 1), "inc": round(inc, 2)})
        r = math.radians(inc)
        tvd += step * math.cos(r)
        horiz = step * math.sin(r)
        x += horiz * math.sin(az)
        y += horiz * math.cos(az)
        md += step
    return pts


def _jitter_tops(rng: random.Random, scale: float) -> list[tuple[str, float]]:
    tops = []
    for name, top in FORMATIONS:
        tops.append((name, 0.0 if top == 0 else round(top + rng.gauss(0, scale), 0)))
    return tops


def build_field(seed: int = 26121) -> list[Well]:
    rng = random.Random(seed)
    wells: list[Well] = []

    target = Well(
        id="NWIS-TGT-01", name="Duliajan-Target-01 (Planned)", field="Duliajan",
        lat=27.3615, lon=95.3290, kb_m=112.0, status="planned", spud_year=2026,
        inclination_deg=18.0, azimuth_deg=65.0, kop_m=1500.0, td_m=4800.0,
        tops=[(n, float(t)) for n, t in FORMATIONS], mw_offset=0.0, pp_offset=0.0, is_target=True,
    )
    wells.append(target)

    plan = [
        ("Duliajan", 12, 3.5), ("Naharkatiya", 3, 5.0), ("Digboi", 3, 6.0), ("Moran", 3, 6.0),
    ]
    idx = 0
    for fld, n, spread_km in plan:
        clat, clon = FIELD_CENTERS[fld]
        for k in range(n):
            idx += 1
            ang = rng.uniform(0, 2 * math.pi)
            dist_km = rng.uniform(0.6, spread_km) if fld == "Duliajan" else rng.uniform(0.2, spread_km)
            lat = clat + (dist_km * math.cos(ang)) / 111.0
            lon = clon + (dist_km * math.sin(ang)) / (111.0 * math.cos(math.radians(clat)))
            # geomechanical "family": wells in the same field share tops/pressure regime
            family_scale = 40 if fld == "Duliajan" else 140
            w = Well(
                id=f"{fld[:3].upper()}-{k + 1:02d}", name=f"{fld}-{k + 1:02d}", field=fld,
                lat=round(lat, 5), lon=round(lon, 5), kb_m=round(rng.uniform(95, 140), 1),
                status=rng.choice(["producing", "producing", "suspended", "abandoned"]),
                spud_year=rng.randint(1994, 2024),
                inclination_deg=round(rng.choice([0, 0, 8, 15, 22, 30, 35]) + rng.uniform(0, 4), 1),
                azimuth_deg=round(rng.uniform(0, 360), 1), kop_m=round(rng.uniform(900, 2200), 0),
                td_m=round(rng.uniform(3900, 4950), 0), tops=_jitter_tops(rng, family_scale),
                mw_offset=round(rng.gauss(0, 0.25 if fld == "Duliajan" else 0.6), 2),
                pp_offset=round(rng.gauss(0, 0.2 if fld == "Duliajan" else 0.5), 2),
            )
            wells.append(w)

    # Historical events for offset wells
    ev_id = 0
    for w in wells[1:]:
        for fm, hz in HAZARDS.items():
            iv = formation_interval(w.tops, fm, w.td_m)
            if not iv or iv[1] - iv[0] < 30:
                continue
            for etype, p, npt_mean in hz:
                # wells with higher MW delta vs pore pressure see more losses/fewer kicks
                adj = p + (0.25 * w.mw_offset if etype == "loss" else -0.25 * w.mw_offset if etype == "kick" else 0)
                if rng.random() > max(0.02, min(0.95, adj)):
                    continue
                top, base = iv
                # hazards cluster near formation tops (first ~90 m), e.g. top-Tipam losses
                depth = round(min(base - 5, top + abs(rng.gauss(35, 30))), 0)
                ev_id += 1
                worked = rng.sample(MITIGATIONS[etype]["worked"], k=1)
                failed = rng.sample(MITIGATIONS[etype]["failed"], k=1) if rng.random() < 0.6 else []
                sev_npt = max(1.0, round(rng.gauss(npt_mean, npt_mean * 0.35), 1))
                w.events.append({
                    "id": f"EV-{ev_id:04d}", "well_id": w.id, "event_type": etype, "depth_m": depth,
                    "formation": fm, "date": f"{w.spud_year}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}",
                    "npt_hours": sev_npt, "severity": "high" if sev_npt >= 12 else "moderate" if sev_npt >= 6 else "low",
                    "mud_weight_ppg": mud_weight_ppg(depth, w.mw_offset),
                    "worked": worked, "failed": failed,
                })
    return wells


EVENT_PHRASES = {
    "loss": ["Observed partial mud losses of {r} bbl/hr", "Encountered total loss of circulation", "Mud loss while drilling, loss rate {r} bbl/hr"],
    "kick": ["Pit gain of {r} bbl observed, well flowing - kick detected", "Gas kick with flow increase, shut-in well"],
    "stuck_pipe": ["String got stuck while pulling out, differential sticking suspected", "Pipe stuck, unable to rotate, overpull {r} klbs"],
    "caving": ["Heavy cavings on shakers, splintery shale", "Hole instability with cavings and tight spots"],
}


def render_ddr(w: Well, ev: dict, page: int, rng: random.Random) -> str:
    phrase = rng.choice(EVENT_PHRASES[ev["event_type"]]).format(r=rng.randint(15, 80))
    lines = [
        "OIL INDIA LIMITED - DAILY DRILLING REPORT",
        f"Well: {w.name}   Field: {w.field}   Date: {ev['date']}   Report page {page}",
        f"Rig: OIL-R{rng.randint(10, 40)}   Hole size: {rng.choice(['12 1/4', '8 1/2', '17 1/2'])} in",
        f"00:00-06:00 Drilled ahead from {ev['depth_m'] - 40:.0f} m to {ev['depth_m'] - 5:.0f} m in {ev['formation']}. MW {ev['mud_weight_ppg']} ppg.",
        f"06:00-08:30 At {ev['depth_m']:.0f} m: {phrase}. Formation: {ev['formation']}.",
        f"08:30-{8 + int(ev['npt_hours']) % 16:02d}:00 NPT {ev['npt_hours']} hrs. Remedial: {ev['worked'][0]}.",
    ]
    if ev["failed"]:
        lines.append(f"Note: initial attempt failed - {ev['failed'][0]}.")
    lines.append(f"Lesson learned: {ev['worked'][0]} was effective in {ev['formation']} at {ev['depth_m']:.0f} m.")
    return "\n".join(lines)
