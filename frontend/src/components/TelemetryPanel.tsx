import { useMemo } from "react";
import type Plotly from "plotly.js-dist-min";
import Plot, { darkLayout } from "./Plot";
import { tr } from "../lib/i18n";
import type { Lang, Telemetry } from "../types";

interface Props { stream: Telemetry[]; index: number; dark: boolean; lang: Lang; big?: boolean }

const CHANNELS = [
  { k: "rop", label: "ROP", unit: "m/hr", color: "#1f5aa6" },
  { k: "spp_psi", label: "Standpipe P", unit: "psi", color: "#0a93b5" },
  { k: "torque_kftlb", label: "Torque", unit: "kft·lb", color: "#7b3fb8" },
  { k: "gas_ppm", label: "Gas", unit: "ppm", color: "#d62839" },
] as const;

/** MWD/LWD telemetry: oversized readouts + one small-multiple trace per channel (no dual axes). */
export default function TelemetryPanel({ stream, index, dark, lang, big }: Props) {
  const cur = stream[index];
  const win = useMemo(() => stream.slice(Math.max(0, index - 120), index + 1), [stream, index]);
  const fig = useMemo(() => {
    const data: Partial<Plotly.PlotData>[] = CHANNELS.map((c, i) => ({
      x: win.map((s) => s[c.k]), y: win.map((s) => s.md), type: "scatter", mode: "lines", name: c.label,
      line: { color: c.color, width: 2 }, xaxis: i === 0 ? "x" : `x${i + 1}`, yaxis: "y",
      hovertemplate: `%{y:.0f} m · ${c.label} %{x} ${c.unit}<extra></extra>`,
    }));
    const lay: Record<string, unknown> = {};
    CHANNELS.forEach((c, i) => {
      lay[i === 0 ? "xaxis" : `xaxis${i + 1}`] = { domain: [i / 4 + 0.01, (i + 1) / 4 - 0.01], anchor: "y", title: { text: `${c.label} (${c.unit})`, font: { size: 10 } },
        gridcolor: dark ? "#1e293b" : "#e2e8f0", tickfont: { size: 9 } };
    });
    return { data, layout: { ...darkLayout(dark), ...lay, height: big ? 300 : 230, showlegend: false, margin: { l: 45, r: 5, t: 10, b: 40 },
      yaxis: { autorange: "reversed", title: { text: "MD (m)" }, gridcolor: dark ? "#1e293b" : "#e2e8f0" } } as Partial<Plotly.Layout> };
  }, [win, dark, big]);

  return (
    <div className="card p-3">
      <h2 className={`mb-2 font-semibold ${big ? "text-xl" : ""}`}>📡 {tr("telemetry", lang)}</h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Readout label={tr("bitDepth", lang)} value={cur ? cur.md.toFixed(0) : "—"} unit="m" big={big} />
        {CHANNELS.map((c) => <Readout key={c.k} label={c.label} value={cur ? String(cur[c.k]) : "—"} unit={c.unit} big={big} />)}
      </div>
      {cur && <p className="mt-1 text-xs text-slate-500">{cur.formation} · MW {cur.mud_weight_ppg} ppg · T+{cur.t_min.toFixed(0)} min</p>}
      <Plot data={fig.data} layout={fig.layout} className="w-full" />
    </div>
  );
}

function Readout({ label, value, unit, big }: { label: string; value: string; unit: string; big?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
      <div className="label">{label}</div>
      <div className={`font-mono font-bold ${big ? "text-4xl" : "text-2xl"}`}>{value}<span className="ml-1 text-xs font-normal text-slate-500">{unit}</span></div>
    </div>
  );
}
