export type EventType = "loss" | "kick" | "stuck_pipe" | "caving";
export type Lang = "en" | "hi" | "as";
export type Role = "driller" | "geologist" | "manager";

export interface Top { formation: string; top_m: number }
export interface Well {
  id: string; name: string; field: string; lat: number; lon: number; status: string; spud_year: number;
  td_m: number; inclination_deg: number; azimuth_deg: number; kop_m: number; is_target: boolean; distance_km: number | null;
  event_count: number; npt_total: number; tops: Top[]; in_radius?: boolean;
}
export interface DrillEvent {
  id: string; well_id: string; event_type: EventType; depth_m: number; formation: string; date: string;
  npt_hours: number; severity: "low" | "moderate" | "high"; worked: string[]; failed: string[];
  doc_id?: string; page?: number; hl_start?: number; hl_end?: number; mud_weight_ppg?: number | null;
}
export interface LogCurve { md: number; formation: string; gr_api: number; mw_ppg: number; pp_ppg: number; fg_ppg: number }
export interface WellLog { well_id: string; name: string; td_m: number; tops: Top[]; curves: LogCurve[]; events: DrillEvent[] }
export interface Similar {
  rank: number; well_id: string; name: string; field: string; distance_km: number; score: number;
  components: { distance: number; lithology: number; mud_weight: number; trajectory: number };
  npt_total: number; event_count: number;
}
export interface Driver { feature: string; label: string; value: number; shap: number }
export interface RiskSection { top_m: number; base_m: number; formation: string; risk: number; level: "low" | "moderate" | "high"; drivers: Driver[]; why: string }
export interface Mitigation { action: string; count: number }
export interface Alert {
  key: string; formation: string; formation_top_m: number; distance_m: number; event_type: EventType;
  severity: "low" | "moderate" | "high"; wells_affected: string[]; offset_wells: number; avg_npt_hours: number;
  depth_range: [number, number]; message: string; mitigation: { worked: Mitigation[]; failed: Mitigation[] };
  evidence: (DrillEvent & { offset_well: string; distance_km: number; mapped_depth_m: number })[];
}
export interface LookAheadResp { bit_depth_m: number; current_formation: string; alerts: Alert[] }
export interface Telemetry { md: number; t_min: number; rop: number; spp_psi: number; torque_kftlb: number; gas_ppm: number; formation: string; mud_weight_ppg: number }
export interface Citation {
  doc_id: string; title: string; well_id: string; doc_type: string; page: number; score: number; snippet: string;
  highlight: { start: number; end: number }; event: DrillEvent | null;
}
export interface Extraction {
  id: number; doc_id: string; well_id: string | null; event_type: EventType | null; depth_m: number | null;
  formation: string | null; date: string | null; npt_hours: number | null; raw_text: string; confidence: number;
  field_scores: Record<string, number>; verification_status: string;
}
export interface Traj3D {
  well_id: string; name: string; is_target: boolean; distance_km?: number;
  path: { md: number; x: number; y: number; z: number }[]; events: (DrillEvent & { x: number; y: number; z: number })[];
}
export interface DocRef { doc_id: string; start?: number; end?: number }
