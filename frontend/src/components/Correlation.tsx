import { useEffect, useMemo, useState } from "react";
import type Plotly from "plotly.js-dist-min";
import Plot, { darkLayout } from "./Plot";
import { api } from "../lib/api";
import { EVENT_COLOR, EVENT_SYMBOL, EVENT_TYPES, LITHO_COLOR } from "../lib/constants";
import { tr } from "../lib/i18n";
import type { Lang, WellLog } from "../types";

interface Props {
  wellIds: string[]; // target first
  active: string | null;
  bitDepth: number;
  dark: boolean;
  lang: Lang;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
}

const TRACKS = ["Lith", "GR API", "ppg", "NPT h"] as const;
const TRACK_W = [0.18, 0.3, 0.3, 0.22];

/** Stacked strip logs with a shared, synchronised depth axis (0–5000 m). */
export default function Correlation({ wellIds, active, bitDepth, dark, lang, onActivate, onRemove }: Props) {
  const [logs, setLogs] = useState<Record<string, WellLog>>({});

  useEffect(() => {
    wellIds.filter((id) => !logs[id]).forEach((id) =>
      api.get<WellLog>(`/api/wells/${id}/log`, { step: 10 }).then((l) => setLogs((p) => ({ ...p, [id]: l }))).catch(() => undefined)
    );
  }, [wellIds, logs]);

  const ready = wellIds.filter((id) => logs[id]).map((id) => logs[id]);

  const fig = useMemo(() => {
    const data: Partial<Plotly.PlotData>[] = [];
    const shapes: Partial<Plotly.Shape>[] = [];
    const annotations: Partial<Plotly.Annotations>[] = [];
    const layout: Record<string, unknown> = {};
    const n = Math.max(1, ready.length);
    const gap = 0.025;
    const wellW = (1 - gap * (n - 1)) / n;
    let axis = 0;
    const seenLegend = new Set<string>();

    ready.forEach((log, wi) => {
      const x0 = wi * (wellW + gap);
      let cursor = x0;
      const ax: string[] = [];
      TRACKS.forEach((trk, ti) => {
        axis += 1;
        const w = wellW * TRACK_W[ti];
        const name = axis === 1 ? "xaxis" : `xaxis${axis}`;
        layout[name] = {
          domain: [cursor + 0.002, cursor + w - 0.002], anchor: "y", side: "top", showgrid: ti !== 0,
          gridcolor: dark ? "#1e293b" : "#e2e8f0", zeroline: false, tickfont: { size: 9 },
          title: { text: trk, font: { size: 9 }, standoff: 2 }, fixedrange: true,
          ...(ti === 0 ? { range: [0, 1], showticklabels: false } : ti === 1 ? { range: [0, 170] } : ti === 2 ? { range: [8, 17] } : { range: [0, 30] }),
        };
        ax.push(axis === 1 ? "x" : `x${axis}`);
        cursor += w;
      });
      const [xl, xg, xm, xn] = ax;
      const isActive = active === log.well_id;
      if (isActive) {
        shapes.push({ type: "rect", xref: "paper", yref: "paper", x0: x0 - 0.006, x1: x0 + wellW + 0.006, y0: 0, y1: 1.0,
          line: { color: "#f2a900", width: 3 }, fillcolor: "rgba(242,169,0,0.05)", layer: "below" });
      }
      annotations.push({ xref: "paper", yref: "paper", x: x0 + wellW / 2, y: 1.12, showarrow: false,
        text: `<b>${wi === 0 ? "TARGET-01" : log.name}</b>`, font: { size: 12, color: isActive ? "#f2a900" : undefined } });

      // Track 1 — lithology blocks
      log.tops.forEach((t, i) => {
        const base = i + 1 < log.tops.length ? log.tops[i + 1].top_m : log.td_m;
        if (t.top_m >= log.td_m) return;
        shapes.push({ type: "rect", xref: xl as Plotly.XAxisName, yref: "y", x0: 0, x1: 1, y0: t.top_m, y1: Math.min(base, log.td_m),
          fillcolor: LITHO_COLOR[t.formation], line: { width: 1, color: dark ? "#0f172a" : "#fff" } });
        data.push({ x: [0.5], y: [(t.top_m + Math.min(base, log.td_m)) / 2], xaxis: xl, yaxis: "y", mode: "text", type: "scatter",
          text: [t.formation.split(" ")[0]], textfont: { size: 8, color: t.formation === "Barail Coal" ? "#fff" : "#111" },
          hovertemplate: `${t.formation}<br>Top ${t.top_m.toFixed(0)} m<extra>${log.name}</extra>`, showlegend: false });
      });
      const md = log.curves.map((c) => c.md);
      // Track 2 — gamma ray
      data.push({ x: log.curves.map((c) => c.gr_api), y: md, xaxis: xg, yaxis: "y", type: "scatter", mode: "lines",
        line: { color: "#2e9e5b", width: 1.2 }, name: "Gamma ray", legendgroup: "gr", showlegend: !seenLegend.has("gr"),
        hovertemplate: "%{y:.0f} m · GR %{x} API<extra></extra>" });
      seenLegend.add("gr");
      // Track 3 — mud weight window (one axis: all ppg)
      ([["pp_ppg", "Pore pressure", "#0a93b5"], ["mw_ppg", "Mud weight", "#1f5aa6"], ["fg_ppg", "Frac gradient", "#b3122e"]] as const).forEach(([k, label, col]) => {
        data.push({ x: log.curves.map((c) => c[k]), y: md, xaxis: xm, yaxis: "y", type: "scatter", mode: "lines",
          line: { color: col, width: k === "mw_ppg" ? 2 : 1.2, dash: k === "mw_ppg" ? "solid" : "dot" }, name: label,
          legendgroup: k, showlegend: !seenLegend.has(k), hovertemplate: `%{y:.0f} m · ${label} %{x:.2f} ppg<extra></extra>` });
        seenLegend.add(k);
      });
      // Track 4 — NPT event flags
      EVENT_TYPES.forEach((et) => {
        const evs = log.events.filter((e) => e.event_type === et);
        if (!evs.length) return;
        data.push({ x: evs.map((e) => Math.min(29, e.npt_hours)), y: evs.map((e) => e.depth_m), xaxis: xn, yaxis: "y", type: "scatter",
          mode: "markers", name: et.replace("_", " "), legendgroup: et, showlegend: !seenLegend.has(et),
          marker: { color: EVENT_COLOR[et], symbol: EVENT_SYMBOL[et], size: 11, line: { color: dark ? "#0f172a" : "#fff", width: 2 } },
          customdata: evs.map((e) => [e.formation, e.worked?.[0] ?? "—"]) as unknown as Plotly.Datum[],
          hovertemplate: `<b>${et.replace("_", " ")}</b> @ %{y:.0f} m<br>%{customdata[0]} · NPT %{x} h<br>✅ %{customdata[1]}<extra>${log.name}</extra>` });
        seenLegend.add(et);
      });
    });

    if (bitDepth > 0) {
      shapes.push({ type: "line", xref: "paper", yref: "y", x0: 0, x1: 1, y0: bitDepth, y1: bitDepth, line: { color: "#b3122e", width: 2, dash: "dash" } });
      annotations.push({ xref: "paper", yref: "y", x: 1, y: bitDepth, xanchor: "right", yanchor: "bottom", showarrow: false,
        text: `Bit ${bitDepth.toFixed(0)} m`, font: { size: 10, color: "#b3122e" } });
    }
    return {
      data,
      layout: {
        ...darkLayout(dark), ...layout, shapes, annotations, height: 640, margin: { l: 50, r: 10, t: 95, b: 30 },
        yaxis: { range: [5000, 0], title: { text: "Measured depth (m)" }, gridcolor: dark ? "#1e293b" : "#e2e8f0", zeroline: false },
        legend: { orientation: "h", y: -0.03, x: 0, font: { size: 10 } }, hovermode: "closest", dragmode: "zoom",
      } as Partial<Plotly.Layout>,
    };
  }, [ready, active, bitDepth, dark]);

  return (
    <div className="card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{tr("correlation", lang)}</h2>
        {wellIds.map((id, i) => (
          <button key={id} onClick={() => onActivate(id)}
            className={`rounded-full border px-2 py-0.5 text-xs ${active === id ? "border-oil-accent bg-oil-accent/20" : "border-slate-300 dark:border-slate-700"}`}>
            {logs[id]?.name ?? id}
            {i > 0 && <span role="button" aria-label={`remove ${id}`} className="ml-1 text-slate-400 hover:text-red-500"
              onClick={(e) => { e.stopPropagation(); onRemove(id); }}>×</span>}
          </button>
        ))}
        <span className="text-[11px] text-slate-500">Drag vertically to zoom — all tracks share one depth axis.</span>
      </div>
      <Plot data={fig.data} layout={fig.layout} className="w-full" />
    </div>
  );
}
