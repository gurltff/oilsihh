import { useState } from "react";
import { api } from "../lib/api";
import { EVENT_COLOR, RISK_COLOR } from "../lib/constants";
import { tr } from "../lib/i18n";
import type { Alert, DocRef, Lang, LookAheadResp, Role } from "../types";

interface Props {
  data: LookAheadResp | null;
  lang: Lang;
  role: Role;
  offline: boolean;
  onOpenDoc: (d: DocRef) => void;
}

/** Predictive look-ahead banner: countdown to the next hazardous formation with lessons learned. */
export default function LookAhead({ data, lang, role, offline, onOpenDoc }: Props) {
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const big = role === "driller";
  if (!data) return <div className="card h-24 animate-pulse" />;
  const alerts = data.alerts;

  const ack = (a: Alert) => {
    setAcked((p) => ({ ...p, [a.key]: true }));
    api.post("/api/alerts/ack", { alert_key: a.key, role }).catch(() => undefined);
  };

  return (
    <section className="space-y-2" aria-live="assertive">
      <div className="flex items-center gap-2">
        <h2 className={`font-semibold ${big ? "text-xl" : ""}`}>{tr("lookAhead", lang)}</h2>
        <span className="text-xs text-slate-500">
          {tr("bitDepth", lang)} {data.bit_depth_m.toFixed(0)} m · {data.current_formation}
        </span>
        {offline && <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-black">{tr("offline", lang)}</span>}
      </div>
      {alerts.length === 0 && <div className="card p-3 text-sm text-emerald-600">✔ {tr("noAlerts", lang)}</div>}
      {alerts.slice(0, big ? 2 : 3).map((a, i) => (
        <article key={a.key}
          className={`card border-l-8 p-3 ${i === 0 && a.severity === "high" && !acked[a.key] ? "pulse" : ""}`}
          style={{ borderLeftColor: RISK_COLOR[a.severity] }}>
          <div className="flex items-start gap-3">
            <div className="text-center">
              <div className={`font-mono font-black ${big ? "text-5xl" : "text-3xl"}`} style={{ color: RISK_COLOR[a.severity] }}>
                {a.distance_m.toFixed(0)}<span className="text-base">m</span>
              </div>
              <div className="text-[10px] uppercase text-slate-500">{tr("to", lang)} {a.formation.split(" ")[0]}</div>
            </div>
            <div className="min-w-0 flex-1">
              <p className={`font-semibold leading-snug ${big ? "text-xl" : "text-sm"}`}>{a.message}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded px-1.5 py-0.5 font-bold text-white" style={{ background: RISK_COLOR[a.severity] }}>{a.severity.toUpperCase()}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: EVENT_COLOR[a.event_type] }} />{a.event_type.replace("_", " ")}</span>
                <span className="text-slate-500">Wells: {a.wells_affected.slice(0, 5).join(", ")}{a.wells_affected.length > 5 ? "…" : ""}</span>
              </div>
              <div className={`mt-2 grid gap-2 ${big ? "text-base" : "text-xs"} md:grid-cols-2`}>
                <div className="rounded bg-emerald-50 p-2 dark:bg-emerald-950/40">
                  <div className="font-semibold text-emerald-700 dark:text-emerald-400">✅ {tr("worked", lang)}</div>
                  {a.mitigation.worked.map((m) => <div key={m.action}>{m.action} <span className="text-slate-500">×{m.count}</span></div>)}
                </div>
                <div className="rounded bg-red-50 p-2 dark:bg-red-950/40">
                  <div className="font-semibold text-red-700 dark:text-red-400">❌ {tr("failed", lang)}</div>
                  {a.mitigation.failed.length ? a.mitigation.failed.map((m) => <div key={m.action}>{m.action} <span className="text-slate-500">×{m.count}</span></div>) : <div>—</div>}
                </div>
              </div>
              {!big && (
                <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                  {a.evidence.map((e) => (
                    <button key={e.id} className="rounded border border-slate-300 px-1.5 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                      onClick={() => e.doc_id && onOpenDoc({ doc_id: e.doc_id, start: e.hl_start, end: e.hl_end })}>
                      📄 {e.offset_well} @ {e.depth_m.toFixed(0)} m ({e.npt_hours} h)
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className={acked[a.key] ? "btn-ghost" : "btn-primary"} disabled={acked[a.key]} onClick={() => ack(a)}>
              {acked[a.key] ? tr("acked", lang) : tr("ack", lang)}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
