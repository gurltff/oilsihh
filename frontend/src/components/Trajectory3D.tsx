import { useEffect, useMemo, useState } from "react";
import type Plotly from "plotly.js-dist-min";
import Plot, { darkLayout } from "./Plot";
import { api } from "../lib/api";
import { EVENT_COLOR, EVENT_TYPES } from "../lib/constants";
import { tr } from "../lib/i18n";
import type { Lang, Traj3D } from "../types";

interface Props { wellId: string; radiusKm: number; bitDepth: number; dark: boolean; lang: Lang; active: string | null }

/** WebGL 3D trajectories with hazard events suspended in space. */
export default function Trajectory3D({ wellId, radiusKm, bitDepth, dark, lang, active }: Props) {
  const [wells, setWells] = useState<Traj3D[]>([]);
  useEffect(() => { api.get<Traj3D[]>("/api/trajectories3d", { well_id: wellId, radius_km: radiusKm }).then(setWells).catch(() => undefined); }, [wellId, radiusKm]);

  const fig = useMemo(() => {
    const data: Partial<Plotly.PlotData>[] = [];
    wells.forEach((w) => {
      const hl = w.is_target || w.well_id === active;
      data.push({ type: "scatter3d", mode: "lines", name: w.name, showlegend: false,
        x: w.path.map((p) => p.x), y: w.path.map((p) => p.y), z: w.path.map((p) => p.z),
        line: { width: hl ? 8 : 3, color: w.is_target ? "#b3122e" : w.well_id === active ? "#f2a900" : dark ? "#64748b" : "#94a3b8" },
        hovertemplate: `${w.name}<br>MD %{text} m<extra></extra>`, text: w.path.map((p) => p.md.toFixed(0)) } as Partial<Plotly.PlotData>);
      if (w.is_target) {
        const bit = w.path.reduce((a, p) => (Math.abs(p.md - bitDepth) < Math.abs(a.md - bitDepth) ? p : a), w.path[0]);
        if (bit) data.push({ type: "scatter3d", mode: "text+markers", x: [bit.x], y: [bit.y], z: [bit.z], text: ["BIT"], showlegend: false,
          marker: { size: 6, color: "#000", symbol: "diamond" }, hoverinfo: "skip" } as Partial<Plotly.PlotData>);
      }
    });
    EVENT_TYPES.forEach((et) => {
      const evs = wells.flatMap((w) => w.events.filter((e) => e.event_type === et).map((e) => ({ ...e, well: w.name })));
      if (!evs.length) return;
      data.push({ type: "scatter3d", mode: "markers", name: et.replace("_", " "), x: evs.map((e) => e.x), y: evs.map((e) => e.y), z: evs.map((e) => e.z),
        marker: { size: evs.map((e) => 4 + Math.min(10, e.npt_hours / 2)), color: EVENT_COLOR[et], opacity: 0.9, line: { color: "#fff", width: 1 } },
        text: evs.map((e) => `${e.well}: ${et} @ ${e.depth_m} m, ${e.formation}, ${e.npt_hours} h NPT`), hovertemplate: "%{text}<extra></extra>" } as Partial<Plotly.PlotData>);
    });
    const grid = dark ? "#334155" : "#cbd5e1";
    return { data, layout: { ...darkLayout(dark), height: 620, margin: { l: 0, r: 0, t: 0, b: 0 }, legend: { x: 0, y: 1 },
      scene: { xaxis: { title: { text: "East (m)" }, gridcolor: grid }, yaxis: { title: { text: "North (m)" }, gridcolor: grid },
        zaxis: { title: { text: "TVD (m)" }, gridcolor: grid }, aspectmode: "manual", aspectratio: { x: 1.4, y: 1.4, z: 1 } } } as Partial<Plotly.Layout> };
  }, [wells, bitDepth, dark, active]);

  return (
    <div className="card p-3">
      <h2 className="font-semibold">🛢 {tr("view3d", lang)}</h2>
      <p className="text-xs text-slate-500">Marker size ∝ NPT. Red = mud loss, yellow = kick, purple = stuck pipe, blue = caving. Drag to orbit.</p>
      <Plot data={fig.data} layout={fig.layout} className="w-full" />
    </div>
  );
}
