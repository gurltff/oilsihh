import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { DocRef } from "../types";

interface Doc { id: string; title: string; doc_type: string; page: number; text: string; well_id: string }

/** Source document viewer: renders the cited page with the highlighted text bounding box. */
export default function DocModal({ doc, onClose }: { doc: DocRef | null; onClose: () => void }) {
  const [d, setD] = useState<Doc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mark = useRef<HTMLElement>(null);

  useEffect(() => {
    setD(null);
    setErr(null);
    if (doc) api.get<Doc>(`/api/documents/${doc.doc_id}`).then(setD).catch((e) => setErr(String(e)));
  }, [doc]);
  useEffect(() => { mark.current?.scrollIntoView({ block: "center" }); }, [d]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  if (!doc) return null;
  const s = doc.start ?? 0, e = doc.end ?? 0;
  const pdfUrl = api.url(`/api/documents/${doc.doc_id}/pdf${doc.start != null ? `?hl_start=${s}&hl_end=${e}` : ""}`);
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal>
      <div className="card flex max-h-[90vh] w-full max-w-3xl flex-col" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
          <h3 className="flex-1 font-semibold">📄 {d?.title ?? doc.doc_id}</h3>
          <a className="btn-ghost" href={pdfUrl} target="_blank" rel="noreferrer">Open PDF</a>
          <button className="btn-ghost" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="overflow-auto bg-slate-200 p-6 dark:bg-slate-950">
          {err && <p className="text-red-600">{err}</p>}
          {d && (
            <div className="mx-auto max-w-2xl bg-white p-8 font-mono text-[12px] leading-6 text-slate-900 shadow-lg">
              <div className="mb-3 flex justify-between border-b pb-1 text-[10px] text-slate-500">
                <span>{d.doc_type} · {d.well_id}</span><span>Page {d.page}</span>
              </div>
              <pre className="whitespace-pre-wrap">
                {d.text.slice(0, s)}
                {e > s && <mark ref={mark} className="rounded-sm bg-yellow-200 outline outline-2 outline-red-500">{d.text.slice(s, e)}</mark>}
                {d.text.slice(e > s ? e : s)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
