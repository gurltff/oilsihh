import { useRef, useState } from "react";
import { api } from "../lib/api";
import { LANG_LABEL, tr } from "../lib/i18n";
import type { Citation, DocRef, Lang } from "../types";

interface Msg { role: "user" | "assistant"; text: string; citations?: Citation[]; lang?: string }
interface Props { lang: Lang; wellId: string; radiusKm: number; onOpenDoc: (d: DocRef) => void }

const SUGGESTIONS: Record<Lang, string[]> = {
  en: ["What mitigation worked at 2,800m in nearby wells?", "stuck pipe in Barail coal", "kick in Kopili shale, what failed?"],
  hi: ["आसपास के कुओं में 2800 मीटर पर मड लॉस का क्या उपाय कारगर रहा?", "बरैल कोयला में फंसा पाइप"],
  as: ["ওচৰৰ কুঁৱাত ২৮০০ মিটাৰত মাড লছৰ কি সমাধান কাম কৰিছিল?", "কপিলি শ্বেলত কিক"],
};

/** Institutional-memory chat: cited, extractive RAG answers over DDR/WCR pages. */
export default function RAGChat({ lang, wellId, radiusKm, onOpenDoc }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [scoped, setScoped] = useState(true);
  const end = useRef<HTMLDivElement>(null);

  const ask = async (text: string) => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { role: "user", text }]);
    setQ("");
    setBusy(true);
    try {
      const r = await api.post<{ answer: string; citations: Citation[]; language: string }>("/api/rag/query",
        { query: text, lang, well_id: wellId, radius_km: scoped ? radiusKm : null });
      setMsgs((m) => [...m, { role: "assistant", text: r.answer, citations: r.citations, lang: r.language }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `⚠ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
      setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  const renderAnswer = (m: Msg) =>
    m.text.split(/(\[\d+\])/g).map((part, i) => {
      const n = /^\[(\d+)\]$/.exec(part);
      const c = n && m.citations?.[Number(n[1]) - 1];
      return c ? (
        <button key={i} className="mx-0.5 rounded bg-oil-500 px-1 text-[10px] font-bold text-white align-super"
          onClick={() => onOpenDoc({ doc_id: c.doc_id, start: c.highlight.start, end: c.highlight.end })}>{n![1]}</button>
      ) : <span key={i}>{part}</span>;
    });

  return (
    <div className="card flex h-[640px] flex-col p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">🧠 {tr("ask", lang)}</h2>
        <span className="text-xs text-slate-500">Retrieval over DDR/WCR pages · answers in {LANG_LABEL[lang]}</span>
        <label className="ml-auto flex items-center gap-1 text-xs">
          <input type="checkbox" checked={scoped} onChange={(e) => setScoped(e.target.checked)} /> only wells within {radiusKm} km
        </label>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {msgs.length === 0 && (
          <div className="space-y-1">
            {SUGGESTIONS[lang].concat(lang === "en" ? [] : SUGGESTIONS.en.slice(0, 1)).map((s) => (
              <button key={s} onClick={() => ask(s)} className="block w-full rounded-lg border border-dashed border-slate-300 p-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">{s}</button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-10 rounded-lg bg-oil-500 p-2 text-sm text-white" : "mr-4 rounded-lg bg-slate-100 p-2 text-sm dark:bg-slate-800"}>
            <div className="whitespace-pre-wrap">{m.role === "assistant" ? renderAnswer(m) : m.text}</div>
            {m.citations && m.citations.length > 0 && (
              <div className="mt-2 space-y-1 border-t border-slate-300 pt-2 dark:border-slate-700">
                {m.citations.map((c, k) => (
                  <div key={c.doc_id} className="flex items-center gap-2 text-xs">
                    <span className="font-bold">[{k + 1}]</span>
                    <span className="flex-1 truncate" title={c.snippet}>{c.title} — “{c.snippet}”</span>
                    <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => onOpenDoc({ doc_id: c.doc_id, start: c.highlight.start, end: c.highlight.end })}>
                      View Source PDF
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="mr-4 animate-pulse rounded-lg bg-slate-100 p-2 text-sm dark:bg-slate-800">…</div>}
        <div ref={end} />
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input className="input flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("askPlaceholder", lang)} />
        <button className="btn-primary" disabled={busy}>{tr("send", lang)}</button>
      </form>
    </div>
  );
}
