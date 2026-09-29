import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { EVENT_COLOR, EVENT_TYPES, FORMATIONS, RISK_COLOR } from "../lib/constants";
import { tr } from "../lib/i18n";
import type { DocRef, DrillEvent, EventType, Lang } from "../types";

type Row = DrillEvent & { well_name: string; field: string; doc_title: string | null; distance_km: number | null };
interface Resp { count: number; results: Row[]; facets: Record<string, Record<string, number>> }
const SEVS = ["low", "moderate", "high"] as const;

function Multi<T extends string>({ label, all, value, set, counts }: { label: string; all: readonly T[]; value: T[]; set: (v: T[]) => void; counts?: Record<string, number> }) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className="flex flex-wrap gap-1">
        {all.map((o) => {
          const on = value.includes(o);
          return (
            <button key={o} onClick={() => set(on ? value.filter((x) => x !== o) : [...value, o])}
              className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-oil-500 bg-oil-500 text-white" : "border-slate-300 dark:border-slate-700"}`}>
              {o.replace("_", " ")}{counts?.[o] != null && <span className="ml-1 opacity-70">{counts[o]}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Full-text + faceted metadata search across verified drilling events. */
export default function KnowledgeBase({ lang, wellId, radiusKm, onOpenDoc }: { lang: Lang; wellId: string; radiusKm: number; onOpenDoc: (d: DocRef) => void }) {
  const [text, setText] = useState("");
  const [fms, setFms] = useState<string[]>([]);
  const [ets, setEts] = useState<EventType[]>([]);
  const [sev, setSev] = useState<(typeof SEVS)[number][]>([]);
  const [dmin, setDmin] = useState(0);
  const [dmax, setDmax] = useState(5000);
  const [scoped, setScoped] = useState(false);
  const [res, setRes] = useState<Resp | null>(null);

  useEffect(() => {
    const h = setTimeout(() => {
      api.post<Resp>("/api/search", { text, formations: fms, event_types: ets, severities: sev, depth_min: dmin, depth_max: dmax,
        well_id: wellId, radius_km: scoped ? radiusKm : null }).then(setRes).catch(() => undefined);
    }, 200);
    return () => clearTimeout(h);
  }, [text, fms, ets, sev, dmin, dmax, scoped, wellId, radiusKm]);

  return (
    <div className="card p-3">
      <h2 className="mb-2 font-semibold">🔎 {tr("kb", lang)}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <input className="input" placeholder="Full-text search (e.g. LCM pill, overpull, Duliajan-07)…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex items-center gap-2 text-xs">
          <span className="label">Depth</span>
          <input className="input w-20" type="number" value={dmin} onChange={(e) => setDmin(Number(e.target.value))} />–
          <input className="input w-20" type="number" value={dmax} onChange={(e) => setDmax(Number(e.target.value))} /> m
          <label className="ml-auto flex items-center gap-1"><input type="checkbox" checked={scoped} onChange={(e) => setScoped(e.target.checked)} /> within {radiusKm} km</label>
        </div>
        <Multi label="Formation" all={FORMATIONS} value={fms} set={setFms} counts={res?.facets.formation} />
        <div className="space-y-2">
          <Multi label="Event hazard type" all={EVENT_TYPES} value={ets} set={setEts} counts={res?.facets.event_type} />
          <Multi label="Severity" all={SEVS} value={sev} set={setSev} counts={res?.facets.severity} />
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">{res?.count ?? 0} matching events</p>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white text-left dark:bg-slate-900">
            <tr><th>Well</th><th>Event</th><th className="text-right">Depth</th><th>Formation</th><th>Date</th><th className="text-right">NPT</th><th>Severity</th><th>What worked</th><th>Source</th></tr>
          </thead>
          <tbody>
            {res?.results.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                <td>{r.well_name}{r.distance_km != null && <span className="text-slate-400"> · {r.distance_km} km</span>}</td>
                <td><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: EVENT_COLOR[r.event_type] }} />{r.event_type.replace("_", " ")}</td>
                <td className="text-right font-mono">{r.depth_m.toFixed(0)}</td>
                <td>{r.formation}</td>
                <td>{r.date}</td>
                <td className="text-right font-mono">{r.npt_hours}</td>
                <td><span className="rounded px-1 text-white" style={{ background: RISK_COLOR[r.severity] }}>{r.severity}</span></td>
                <td className="max-w-[220px]">{r.worked?.[0] ?? "—"}</td>
                <td>{r.doc_id && <button className="text-oil-500 hover:underline" onClick={() => onOpenDoc({ doc_id: r.doc_id!, start: r.hl_start, end: r.hl_end })}>📄 {r.doc_title ?? r.doc_id}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
