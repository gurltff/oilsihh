import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { EVENT_TYPES, FORMATIONS } from "../lib/constants";
import type { DocRef, EventType, Extraction } from "../types";

const SAMPLE = `OIL INDIA LIMITED - DAILY DRILLING REPORT
Well: Duliajan-04   Field: Duliajan   Date: 14/02/2025
00:00-06:00 Drilled 12 1/4 in hole from 2790 m to 2838 m in Tipam sandstone. MW 11.4 ppg.
06:00-09:00 At 2841 m: encountered partial loss of circulation, loss rate 45 bbl/hr. NPT 9 hrs.
Remedial: LCM pill (4 ppb) + reduced ROP to 3 m/hr.
14:00 Observed splintery material on shakers near 2870 m, hole tight on connection.
20:00 Pit gain 6 bbl, shut in well, circulated out gas.`;

interface IngestResp { doc_id: string; method: string; extractions: Extraction[]; needs_review: number; mean_confidence: number }

/** OCR/NLP ingestion + human-in-the-loop Verify & Correct queue. */
export default function Ingest({ onOpenDoc }: { onOpenDoc: (d: DocRef) => void }) {
  const [text, setText] = useState(SAMPLE);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<"DDR" | "WCR">("DDR");
  const [last, setLast] = useState<IngestResp | null>(null);
  const [queue, setQueue] = useState<Extraction[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.get<Extraction[]>("/api/extractions", { status: "pending_review" }).then(setQueue).catch(() => undefined);
  useEffect(() => { void load(); }, []);

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      let r: IngestResp;
      if (file) {
        const fd = new FormData();
        fd.append("file", file); fd.append("doc_type", docType);
        r = await api.upload<IngestResp>("/api/ingest/wcr-ddr", fd);
      } else {
        r = await api.post<IngestResp>("/api/ingest/text", { text, doc_type: docType });
      }
      setLast(r);
      await load();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  const finetune = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ risk_model: { version: number; holdout_auc: number; samples: number }; lexicon_terms_learned: number; verified_extractions: number }>("/api/model/finetune", {});
      setMsg(`Model v${r.risk_model.version} retrained on ${r.risk_model.samples} intervals (AUC ${r.risk_model.holdout_auc}); ${r.verified_extractions} verified extractions, ${r.lexicon_terms_learned} lexicon weights learned.`);
    } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="card p-3">
        <h2 className="font-semibold">📥 OCR + NLP ingestion — <code className="text-xs">/api/ingest/wcr-ddr</code></h2>
        <div className="my-2 flex flex-wrap items-center gap-2 text-sm">
          <select className="input" value={docType} onChange={(e) => setDocType(e.target.value as "DDR" | "WCR")}><option>DDR</option><option>WCR</option></select>
          <input type="file" accept=".pdf,.txt,.png,.jpg,.jpeg,.tif,.tiff" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
          {file && <button className="text-xs text-red-500" onClick={() => setFile(null)}>clear file</button>}
        </div>
        {!file && <textarea className="input h-56 w-full font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />}
        <button className="btn-primary mt-2" disabled={busy} onClick={submit}>{busy ? "Processing…" : "Extract events"}</button>
        {msg && <p className="mt-2 text-sm text-oil-500">{msg}</p>}
        {last && (
          <div className="mt-3">
            <p className="text-sm">
              <b>{last.doc_id}</b> via {last.method} · {last.extractions.length} events · mean confidence{" "}
              <b>{(last.mean_confidence * 100).toFixed(0)}%</b> · {last.needs_review} need review
              <button className="ml-2 text-xs text-oil-500 underline" onClick={() => onOpenDoc({ doc_id: last.doc_id })}>view</button>
            </p>
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-900 p-2 text-[11px] text-emerald-300">
              {JSON.stringify(last.extractions.map(({ well_id, event_type, depth_m, formation, date, npt_hours, raw_text, verification_status, confidence }) =>
                ({ well_id, event_type, depth_m, formation, date, npt_hours, raw_text, verification_status, confidence })), null, 2)}
            </pre>
          </div>
        )}
      </div>
      <div className="card p-3">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 font-semibold">🧑‍🔧 Verify & Correct ({queue.length} below 0.85)</h2>
          <button className="btn-ghost" onClick={load}>↻</button>
          <button className="btn-primary" disabled={busy} onClick={finetune}>Trigger fine-tuning</button>
        </div>
        <div className="mt-2 max-h-[560px] space-y-2 overflow-auto">
          {queue.length === 0 && <p className="text-sm text-slate-500">Nothing to review. Low-confidence extractions land here.</p>}
          {queue.map((x) => <ReviewRow key={x.id} x={x} onDone={load} />)}
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ x, onDone }: { x: Extraction; onDone: () => void }) {
  const [v, setV] = useState({ well_id: x.well_id ?? "", event_type: x.event_type ?? "loss", depth_m: x.depth_m ?? 0,
    formation: x.formation ?? "", date: x.date ?? "", npt_hours: x.npt_hours ?? 0 });
  const act = async (action: "verify" | "reject") => {
    await api.patch(`/api/extractions/${x.id}`, { ...v, action, depth_m: Number(v.depth_m), npt_hours: Number(v.npt_hours) });
    onDone();
  };
  const low = (k: string) => (x.field_scores[k] ?? 1) < 0.85 ? "ring-2 ring-amber-400" : "";
  return (
    <div className="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono">#{x.id}</span>
        <div className="h-1.5 w-20 rounded bg-slate-200"><div className="h-1.5 rounded bg-amber-500" style={{ width: `${x.confidence * 100}%` }} /></div>
        <span>{(x.confidence * 100).toFixed(0)}%</span>
        <span className="flex-1 truncate italic text-slate-500">“{x.raw_text}”</span>
      </div>
      <div className="grid grid-cols-3 gap-1">
        <input className={`input ${low("well_id")}`} value={v.well_id} placeholder="well_id" onChange={(e) => setV({ ...v, well_id: e.target.value })} />
        <select className={`input ${low("event_type")}`} value={v.event_type} onChange={(e) => setV({ ...v, event_type: e.target.value as EventType })}>
          {EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input className={`input ${low("depth_m")}`} type="number" value={v.depth_m} onChange={(e) => setV({ ...v, depth_m: Number(e.target.value) })} />
        <select className={`input ${low("formation")}`} value={v.formation} onChange={(e) => setV({ ...v, formation: e.target.value })}>
          <option value="">formation?</option>{FORMATIONS.map((f) => <option key={f}>{f}</option>)}
        </select>
        <input className={`input ${low("date")}`} value={v.date} placeholder="YYYY-MM-DD" onChange={(e) => setV({ ...v, date: e.target.value })} />
        <input className={`input ${low("npt_hours")}`} type="number" value={v.npt_hours} onChange={(e) => setV({ ...v, npt_hours: Number(e.target.value) })} />
      </div>
      <div className="mt-1 flex justify-end gap-2">
        <button className="btn-ghost !py-0.5" onClick={() => act("reject")}>Reject</button>
        <button className="btn-primary !py-0.5" onClick={() => act("verify")}>✔ Verify</button>
      </div>
    </div>
  );
}
