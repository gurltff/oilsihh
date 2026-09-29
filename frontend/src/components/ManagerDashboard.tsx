import { useEffect, useMemo, useState } from "react";
import type Plotly from "plotly.js-dist-min";
import Plot, { darkLayout } from "./Plot";
import { api } from "../lib/api";
import { EVENT_COLOR } from "../lib/constants";
import type { EventType } from "../types";

interface Dash {
  offset_wells: number; historical_events: number; historical_npt_hours: number; expected_npt_hours_target: number;
  npt_hours_saved: number; cost_saved_inr: number; rig_cost_inr_per_hr: number; mitigation_effectiveness: number;
  alerts_total: number; alerts_acknowledged: number; compliance_pct: number;
  npt_by_event_type: Record<string, number>; npt_by_field: Record<string, number>; npt_by_year: Record<string, number>;
  extraction_status: Record<string, number>; model: { version: number; holdout_auc: number };
}

const inr = (v: number) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : `₹${(v / 1e5).toFixed(1)} L`);

/** Executive view: NPT saved, mitigation compliance, financial impact. */
export default function ManagerDashboard({ wellId, radiusKm, dark, refreshKey }: { wellId: string; radiusKm: number; dark: boolean; refreshKey: number }) {
  const [d, setD] = useState<Dash | null>(null);
  useEffect(() => { api.get<Dash>("/api/dashboard/manager", { well_id: wellId, radius_km: radiusKm }).then(setD).catch(() => undefined); }, [wellId, radiusKm, refreshKey]);

  const charts = useMemo(() => {
    if (!d) return null;
    const grid = dark ? "#1e293b" : "#e2e8f0";
    const base = { ...darkLayout(dark), height: 260, margin: { l: 90, r: 10, t: 30, b: 30 }, showlegend: false };
    const types = Object.entries(d.npt_by_event_type).sort((a, b) => a[1] - b[1]);
    const years = Object.entries(d.npt_by_year);
    return {
      type: { data: [{ type: "bar", orientation: "h", y: types.map(([k]) => k.replace("_", " ")), x: types.map(([, v]) => v),
        marker: { color: types.map(([k]) => EVENT_COLOR[k as EventType]) }, text: types.map(([, v]) => `${v} h`), textposition: "outside",
        hovertemplate: "%{y}: %{x} h NPT<extra></extra>" }] as Partial<Plotly.PlotData>[],
        layout: { ...base, title: { text: "Historical NPT by hazard", font: { size: 12 } }, xaxis: { gridcolor: grid } } as Partial<Plotly.Layout> },
      year: { data: [{ type: "bar", x: years.map(([k]) => k), y: years.map(([, v]) => v), marker: { color: "#1f5aa6" },
        hovertemplate: "%{x}: %{y} h NPT<extra></extra>" }] as Partial<Plotly.PlotData>[],
        layout: { ...base, margin: { l: 40, r: 10, t: 30, b: 30 }, title: { text: "Offset-well NPT by spud year", font: { size: 12 } }, yaxis: { gridcolor: grid } } as Partial<Plotly.Layout> },
    };
  }, [d, dark]);

  if (!d || !charts) return <div className="card h-40 animate-pulse" />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="NPT hours saved (forecast)" value={`${d.npt_hours_saved} h`} sub={`of ${d.expected_npt_hours_target} h expected on target · ${(d.mitigation_effectiveness * 100).toFixed(0)}% mitigation efficacy`} />
        <Kpi label="Financial impact" value={inr(d.cost_saved_inr)} sub={`@ ₹${(d.rig_cost_inr_per_hr / 1000).toFixed(0)}k / rig-hr spread cost`} />
        <Kpi label="Risk-mitigation compliance" value={`${d.compliance_pct}%`} sub={`${d.alerts_acknowledged} / ${d.alerts_total} hazard alerts acknowledged`} />
        <Kpi label="Offset intelligence" value={`${d.offset_wells} wells`} sub={`${d.historical_events} events · ${d.historical_npt_hours} h historical NPT`} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card p-2"><Plot data={charts.type.data} layout={charts.type.layout} /></div>
        <div className="card p-2"><Plot data={charts.year.data} layout={charts.year.layout} /></div>
      </div>
      <div className="card flex flex-wrap gap-6 p-3 text-sm">
        <span>Risk model <b>v{d.model.version}</b> · hold-out AUC <b>{d.model.holdout_auc}</b></span>
        <span>Data pipeline: {Object.entries(d.extraction_status).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(" · ") || "no uploads yet"}</span>
        <span>NPT by field: {Object.entries(d.npt_by_field).map(([k, v]) => `${k} ${v} h`).join(" · ")}</span>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-3">
      <div className="label">{label}</div>
      <div className="mt-1 text-3xl font-bold">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}
