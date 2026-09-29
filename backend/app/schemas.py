"""Pydantic contracts for the eRTMAC-NWIS API."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

EventType = Literal["loss", "kick", "stuck_pipe", "caving"]
VerificationStatus = Literal["auto_verified", "pending_review", "verified", "rejected"]
Lang = Literal["en", "hi", "as"]


class Top(BaseModel):
    formation: str
    top_m: float


class WellOut(BaseModel):
    id: str
    name: str
    field: str
    lat: float
    lon: float
    status: str
    spud_year: int
    td_m: float
    inclination_deg: float
    azimuth_deg: float
    kop_m: float
    is_target: bool
    distance_km: Optional[float] = None
    event_count: int = 0
    npt_total: float = 0.0
    tops: list[Top]


class DrillingEvent(BaseModel):
    """Canonical structured record extracted from a DDR / WCR."""
    well_id: Optional[str]
    event_type: Optional[EventType]
    depth_m: Optional[float]
    formation: Optional[str]
    date: Optional[str]
    npt_hours: Optional[float]
    raw_text: str
    verification_status: VerificationStatus


class Extraction(DrillingEvent):
    id: int
    doc_id: str
    confidence: float = Field(ge=0.0, le=1.0)
    field_scores: dict[str, float]


class IngestResponse(BaseModel):
    doc_id: str
    method: str
    pages: int
    extractions: list[Extraction]
    needs_review: int
    mean_confidence: float


class IngestText(BaseModel):
    text: str
    doc_type: Literal["DDR", "WCR"] = "DDR"
    well_id: Optional[str] = None


class Correction(BaseModel):
    well_id: Optional[str] = None
    event_type: Optional[EventType] = None
    depth_m: Optional[float] = None
    formation: Optional[str] = None
    date: Optional[str] = None
    npt_hours: Optional[float] = None
    action: Literal["verify", "reject"] = "verify"


class SimilarityWeights(BaseModel):
    distance: float = 0.30
    lithology: float = 0.30
    mud_weight: float = 0.25
    trajectory: float = 0.15


class RagQuery(BaseModel):
    query: str
    lang: Optional[Lang] = None
    well_id: Optional[str] = "NWIS-TGT-01"
    radius_km: Optional[float] = None
    k: int = Field(6, ge=1, le=15)


class AckIn(BaseModel):
    alert_key: str
    role: str = "driller"


class SearchQuery(BaseModel):
    text: str = ""
    formations: list[str] = []
    event_types: list[EventType] = []
    severities: list[Literal["low", "moderate", "high"]] = []
    depth_min: float = 0
    depth_max: float = 5000
    well_id: Optional[str] = None
    radius_km: Optional[float] = None
