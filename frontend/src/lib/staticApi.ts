/**
 * Static demo backend for GitHub Pages: serves pre-exported API snapshots from ./data
 * and re-implements the interactive endpoints (look-ahead, similarity weights, search, RAG)
 * in the browser. Ingestion / fine-tuning need the real FastAPI server.
 */
import type { DrillEvent } from "../types";

const DATA = `${import.meta.env.BASE_URL}data/`;
const memo = new Map<string, Promise<unknown>>();
const load = <T,>(f: string): Promise<T> => {
  if (!memo.has(f)) memo.set(f, fetch(DATA + f).then((r) => { if (!r.ok) throw new Error(`${r.status} ${f}`); return r.json(); }));
  return memo.get(f) as Promise<T>;
};

interface FWell {
  id: string; name: string; field: string; lat: number; lon: number; td_m: number; is_target: boolean;
  tops: [string, number][]; events: DrillEvent[];
}
interface FDoc { id: string; well_id: string; doc_type: string; page: number; title: string; text: string }
interface Field { wells: FWell[]; documents: FDoc[] }
const field = () => load<Field>("field.json");
const rKey = (r: unknown) => Math.min(15, Math.max(1, Math.round(Number(r) || 10)));

// ------------------------------------------------------------------ geo helpers
function haversine(a: FWell, b: FWell) {
  const R = 6371.0088, rad = Math.PI / 180;
  const dp = (b.lat - a.lat) * rad, dl = (b.lon - a.lon) * rad;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const within = (f: Field, t: FWell, r: number) =>
  f.wells.filter((w) => !w.is_target && w.id !== t.id).map((w) => [w, haversine(t, w)] as const).filter(([, d]) => d <= r).sort((a, b) => a[1] - b[1]);
function interval(w: FWell, fm: string): [number, number] | null {
  const i = w.tops.findIndex(([n]) => n === fm);
  if (i < 0 || w.tops[i][1] >= w.td_m) return null;
  return [w.tops[i][1], Math.min(i + 1 < w.tops.length ? w.tops[i + 1][1] : w.td_m, w.td_m)];
}
const fmAt = (w: FWell, d: number) => w.tops.reduce((n, [f, t]) => (d >= t ? f : n), w.tops[0][0]);

// ------------------------------------------------------------------ i18n (mirrors backend app/i18n.py)
const T: Record<string, Record<string, string>> = {
  approach: {
    en: "🚨 WARNING: {dist}m to {fm} — {k} of {n} offset wells experienced {event} (Avg NPT: {npt} hrs) between {lo}m – {hi}m.",
    hi: "🚨 चेतावनी: {fm} तक {dist} मीटर — {n} में से {k} ऑफसेट कुओं में {event} हुआ (औसत NPT: {npt} घंटे), {lo} मी – {hi} मी के बीच।",
    as: "🚨 সতৰ্কবাণী: {fm} লৈ {dist} মিটাৰ — {n} টাৰ ভিতৰত {k} টা অফছেট কুঁৱাত {event} হৈছিল (গড় NPT: {npt} ঘণ্টা), {lo} মি – {hi} মি ৰ মাজত।",
  },
  inside: {
    en: "🚨 IN ZONE: Drilling {fm} — {k} of {n} offset wells experienced {event} (Avg NPT: {npt} hrs) between {lo}m – {hi}m.",
    hi: "🚨 क्षेत्र में: {fm} की ड्रिलिंग — {n} में से {k} ऑफसेट कुओं में {event} हुआ (औसत NPT: {npt} घंटे), {lo} मी – {hi} मी के बीच।",
    as: "🚨 অঞ্চলত: {fm} খনন চলি আছে — {n} টাৰ ভিতৰত {k} টা অফছেট কুঁৱাত {event} হৈছিল (গড় NPT: {npt} ঘণ্টা), {lo} মি – {hi} মি ৰ মাজত।",
  },
  loss: { en: "severe Mud Loss", hi: "गंभीर मड लॉस", as: "গুৰুতৰ মাড লছ" },
  kick: { en: "a Kick / well-control event", hi: "किक (वेल कंट्रोल घटना)", as: "কিক (কুঁৱা নিয়ন্ত্ৰণ ঘটনা)" },
  stuck_pipe: { en: "Stuck Pipe", hi: "स्टक पाइप", as: "আবদ্ধ পাইপ" },
  caving: { en: "Hole Caving", hi: "होल केविंग", as: "গাঁত খহি পৰা" },
  intro: { en: "Based on {n} matching report excerpts from nearby wells:", hi: "आसपास के कुओं की {n} मिलती-जुलती रिपोर्टों के आधार पर:", as: "ওচৰৰ কুঁৱাৰ {n} টা মিল থকা প্ৰতিবেদনৰ ভিত্তিত:" },
  worked: { en: "What worked", hi: "क्या कारगर रहा", as: "কি কাম কৰিছিল" },
  failed: { en: "What failed", hi: "क्या विफल रहा", as: "কি বিফল হৈছিল" },
  none: { en: "No matching evidence was found in the indexed DDR/WCR corpus.", hi: "अनुक्रमित DDR/WCR रिपोर्टों में कोई मेल खाता साक्ष्य नहीं मिला।", as: "সূচীভুক্ত DDR/WCR প্ৰতিবেদনত কোনো মিল থকা প্ৰমাণ পোৱা নগ'ল।" },
};
const t = (k: string, lang: string, kw: Record<string, string | number> = {}) =>
  (T[k][lang] ?? T[k].en).replace(/\{(\w+)\}/g, (_, x) => String(kw[x]));
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

// ------------------------------------------------------------------ look-ahead (port of analytics.look_ahead)
async function lookAhead(p: Record<string, string>) {
  const f = await field();
  const tgt = f.wells.find((w) => w.id === (p.well_id ?? "NWIS-TGT-01"))!;
  const bit = Number(p.bit_depth ?? 0), radius = Number(p.radius_km ?? 10), win = Number(p.window_m ?? 300), lang = p.lang ?? "en";
  const offs = within(f, tgt, radius);
  const alerts: unknown[] = [];
  tgt.tops.forEach(([fm, top], i) => {
    const base = i + 1 < tgt.tops.length ? tgt.tops[i + 1][1] : tgt.td_m;
    if (base <= bit || top - bit > win) return;
    const dist = Math.max(0, top - bit);
    const byType: Record<string, (DrillEvent & { offset_well: string; distance_km: number; mapped_depth_m: number })[]> = {};
    for (const [o, dkm] of offs) {
      const iv = interval(o, fm);
      if (!iv) continue;
      for (const e of o.events) {
        if (e.formation !== fm) continue;
        const mapped = Math.round(top + (e.depth_m - iv[0]));
        if (mapped >= bit - 20) (byType[e.event_type] ??= []).push({ ...e, offset_well: o.name, distance_km: Math.round(dkm * 100) / 100, mapped_depth_m: mapped });
      }
    }
    for (const [et, evs] of Object.entries(byType)) {
      const wellsHit = [...new Set(evs.map((e) => e.offset_well))].sort();
      const avg = Math.round((evs.reduce((a, e) => a + e.npt_hours, 0) / evs.length) * 10) / 10;
      const lo = Math.min(...evs.map((e) => e.mapped_depth_m)), hi = Math.max(...evs.map((e) => e.mapped_depth_m));
      const ratio = wellsHit.length / Math.max(1, offs.length);
      const sev = (avg >= 10 && ratio >= 0.3) || ratio >= 0.6 ? "high" : ratio >= 0.2 ? "moderate" : "low";
      const count = (key: "worked" | "failed") => {
        const m = new Map<string, number>();
        evs.forEach((e) => (e[key] ?? []).forEach((a) => m.set(a, (m.get(a) ?? 0) + 1)));
        return [...m].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([action, c]) => ({ action, count: c }));
      };
      alerts.push({
        key: `${tgt.id}:${fm}:${et}`, formation: fm, formation_top_m: top, distance_m: Math.round(dist * 10) / 10, event_type: et, severity: sev,
        wells_affected: wellsHit, offset_wells: offs.length, avg_npt_hours: avg, depth_range: [lo, hi],
        message: t(dist === 0 ? "inside" : "approach", lang, { dist: dist.toFixed(0), fm, k: wellsHit.length, n: offs.length, event: t(et, lang), npt: avg, lo: fmt(lo), hi: fmt(hi) }),
        mitigation: { worked: count("worked"), failed: count("failed") },
        evidence: [...evs].sort((a, b) => b.npt_hours - a.npt_hours).slice(0, 5),
      });
    }
  });
  const rank: Record<string, number> = { high: 0, moderate: 1, low: 2 };
  (alerts as { severity: string; distance_m: number }[]).sort((a, b) => rank[a.severity] - rank[b.severity] || a.distance_m - b.distance_m);
  return { bit_depth_m: bit, current_formation: fmAt(tgt, bit), alerts };
}

// ------------------------------------------------------------------ search
async function search(s: { text?: string; formations?: string[]; event_types?: string[]; severities?: string[]; depth_min?: number; depth_max?: number; well_id?: string; radius_km?: number | null }) {
  const f = await field();
  const docs = new Map(f.documents.map((d) => [d.id, d]));
  const tgt = f.wells.find((w) => w.id === s.well_id);
  const res = [];
  for (const w of f.wells) {
    const dist = tgt ? haversine(tgt, w) : null;
    if (s.radius_km && dist != null && dist > s.radius_km) continue;
    for (const e of w.events) {
      if (s.formations?.length && !s.formations.includes(e.formation)) continue;
      if (s.event_types?.length && !s.event_types.includes(e.event_type)) continue;
      if (s.severities?.length && !s.severities.includes(e.severity)) continue;
      if (e.depth_m < (s.depth_min ?? 0) || e.depth_m > (s.depth_max ?? 5000)) continue;
      const doc = e.doc_id ? docs.get(e.doc_id) : undefined;
      if (s.text) {
        const hay = [doc?.text ?? "", e.formation, e.event_type, ...(e.worked ?? []), w.name].join(" ").toLowerCase();
        if (!s.text.toLowerCase().split(/\s+/).filter(Boolean).every((tok) => hay.includes(tok))) continue;
      }
      res.push({ ...e, well_name: w.name, field: w.field, doc_title: doc?.title ?? null, distance_km: dist == null ? null : Math.round(dist * 100) / 100 });
    }
  }
  res.sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9) || a.depth_m - b.depth_m);
  const facets: Record<string, Record<string, number>> = { formation: {}, event_type: {}, severity: {} };
  for (const e of res) for (const k of Object.keys(facets)) { const v = (e as unknown as Record<string, string>)[k]; facets[k][v] = (facets[k][v] ?? 0) + 1; }
  return { count: res.length, results: res.slice(0, 300), facets };
}

// ------------------------------------------------------------------ RAG (TF-IDF cosine + depth/proximity re-rank)
const GLOSSARY: Record<string, string> = {
  "नुकसान": "loss", "लॉस": "loss", "मड": "mud", "रिसाव": "loss", "किक": "kick", "गैस": "gas", "फंसा": "stuck", "फँसा": "stuck", "अटका": "stuck",
  "पाइप": "pipe", "केविंग": "caving", "उपाय": "mitigation", "समाधान": "mitigation", "गहराई": "depth", "मीटर": "m", "कोयला": "coal", "शेल": "shale", "बरैल": "barail",
  "লছ": "loss", "মাড": "mud", "কিক": "kick", "গেছ": "gas", "আবদ্ধ": "stuck", "পাইপ": "pipe", "খহি": "caving", "সমাধান": "mitigation", "গভীৰতা": "depth",
  "মিটাৰ": "m", "কয়লা": "coal", "শ্বেল": "shale", "কপিলি": "kopili",
};
const STOP = new Set("the a an of in at on to and or for with was were is are what which nearby wells well m".split(" "));
const normalise = (q: string) => {
  let s = q.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x966)).replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x9e6));
  for (const [k, v] of Object.entries(GLOSSARY)) s = s.split(k).join(` ${v} `);
  return s;
};
const SYN: Record<string, string[]> = {
  mitigation: ["remedial", "effective", "lesson"], worked: ["effective", "remedial"], work: ["effective", "remedial"],
  fix: ["remedial"], solution: ["remedial"], fail: ["failed"], failed: ["failed", "attempt"], loss: ["loss", "mud"],
};
const toks = (s: string) => (s.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(ings?|es|s)$/, ""));
let index: { docs: FDoc[]; vecs: Map<string, number>[]; idf: Map<string, number> } | null = null;
async function getIndex() {
  if (index) return index;
  const f = await field();
  const df = new Map<string, number>();
  const tfs = f.documents.map((d) => { const m = new Map<string, number>(); toks(d.text).forEach((w) => m.set(w, (m.get(w) ?? 0) + 1)); m.forEach((_, w) => df.set(w, (df.get(w) ?? 0) + 1)); return m; });
  const N = f.documents.length;
  const idf = new Map([...df].map(([w, n]) => [w, Math.log((1 + N) / (1 + n)) + 1]));
  const vecs = tfs.map((m) => { const v = new Map<string, number>(); let n = 0; m.forEach((c, w) => { const x = (1 + Math.log(c)) * idf.get(w)!; v.set(w, x); n += x * x; }); n = Math.sqrt(n); v.forEach((x, w) => v.set(w, x / n)); return v; });
  return (index = { docs: f.documents, vecs, idf });
}
async function rag(body: { query: string; lang?: string | null; well_id?: string; radius_km?: number | null; k?: number }) {
  const f = await field();
  const lang = body.lang ?? (/[ঀ-৿]/.test(body.query) ? "as" : /[ऀ-ॿ]/.test(body.query) ? "hi" : "en");
  const qn = normalise(body.query);
  const { docs, vecs, idf } = await getIndex();
  const q = new Map<string, number>();
  toks(qn).flatMap((w) => [w, ...(SYN[w] ?? [])]).forEach((w) => idf.has(w) && q.set(w, (q.get(w) ?? 0) + idf.get(w)!));
  const qn2 = Math.sqrt([...q.values()].reduce((a, x) => a + x * x, 0)) || 1;
  q.forEach((x, w) => q.set(w, x / qn2));
  const qdm = /(\d[\d,]{2,5})/.exec(qn);
  const qdepth = qdm ? Number(qdm[1].replace(/,/g, "")) : null;
  const evByDoc = new Map<string, DrillEvent>();
  const wells = new Map(f.wells.map((w) => [w.id, w]));
  f.wells.forEach((w) => w.events.forEach((e) => e.doc_id && evByDoc.set(e.doc_id, e)));
  const tgt = body.well_id ? wells.get(body.well_id) : undefined;
  const scored = docs.map((d, i) => {
    let s = 0;
    q.forEach((x, w) => { s += x * (vecs[i].get(w) ?? 0); });
    const ev = evByDoc.get(d.id);
    if (qdepth && ev) s = (s + 0.3 * Math.exp(-Math.abs(ev.depth_m - qdepth) / 150)) * (1 + 0.8 * Math.exp(-Math.abs(ev.depth_m - qdepth) / 150));
    const o = wells.get(d.well_id);
    if (tgt && o) {
      const dist = haversine(tgt, o);
      if (body.radius_km && dist > body.radius_km) s = 0;
      s *= 1 + 0.3 * Math.exp(-dist / 5);
    }
    return { s, d, ev };
  }).filter((x) => x.s > 0.02).sort((a, b) => b.s - a.s).slice(0, body.k ?? 6);
  if (!scored.length) return { answer: t("none", lang), language: lang, citations: [] };
  const worked = new Map<string, number[]>(), failed = new Map<string, number[]>();
  const lines = [t("intro", lang, { n: scored.length })];
  const citations = scored.map(({ s, d, ev }, i) => {
    for (const m of d.text.matchAll(/Remedial: (.+?)\.\s*$/gm)) worked.set(m[1], [...(worked.get(m[1]) ?? []), i + 1]);
    for (const m of d.text.matchAll(/initial attempt failed - (.+?)\.\s*$/gm)) failed.set(m[1], [...(failed.get(m[1]) ?? []), i + 1]);
    const hs = ev?.hl_start ?? 0, he = ev?.hl_end ?? Math.min(d.text.length, 160);
    lines.push(ev ? `[${i + 1}] ${d.title}: ${ev.event_type.replace("_", " ")} at ${ev.depth_m.toFixed(0)} m in ${ev.formation}, ${ev.npt_hours} h NPT.` : `[${i + 1}] ${d.title}`);
    return { doc_id: d.id, title: d.title, well_id: d.well_id, doc_type: d.doc_type, page: d.page, score: Math.round(s * 1e4) / 1e4,
      snippet: d.text.slice(hs, he), highlight: { start: hs, end: he }, event: ev ?? null };
  });
  const list = (m: Map<string, number[]>) => [...m].sort((a, b) => b[1].length - a[1].length).map(([a, r]) => `  • ${a} ${r.map((x) => `[${x}]`).join("")}`);
  if (worked.size) lines.push(`\n✅ ${t("worked", lang)}:`, ...list(worked));
  if (failed.size) lines.push(`\n❌ ${t("failed", lang)}:`, ...list(failed));
  return { answer: lines.join("\n"), language: lang, citations };
}

// ------------------------------------------------------------------ router
const acks = (): string[] => { try { return JSON.parse(localStorage.getItem("nwis:acks") ?? "[]"); } catch { return []; } };
const NEEDS_SERVER = "This feature needs the FastAPI backend — the GitHub Pages demo is read-only. Run the app locally to ingest documents.";

export async function staticRequest(method: string, fullPath: string, body?: unknown): Promise<unknown> {
  const u = new URL(fullPath, "http://x");
  const p = Object.fromEntries(u.searchParams);
  const path = u.pathname;
  const r = rKey(p.radius_km);
  if (method === "GET") {
    if (path === "/api/wells") return load(`wells_${r}.json`);
    if (path === "/api/risk") return load(`risk_${r}.json`);
    if (path === "/api/offsets") return load(`offsets_${r}.json`);
    if (path === "/api/trajectories3d") return load(`traj3d_${r}.json`);
    if (path === "/api/telemetry") return load("telemetry.json");
    if (path === "/api/lookahead") return lookAhead(p);
    if (path === "/api/extractions") return [];
    if (path === "/api/health") return { status: "ok", mode: "static" };
    if (path === "/api/dashboard/manager") {
      const d = { ...(await load<Record<string, number>>(`dash_${r}.json`)) };
      d.alerts_acknowledged = Math.min(d.alerts_total, acks().length);
      d.compliance_pct = d.alerts_total ? Math.round((1000 * d.alerts_acknowledged) / d.alerts_total) / 10 : 100;
      return d;
    }
    let m = /^\/api\/wells\/([^/]+)\/log$/.exec(path);
    if (m) return load(`log_${m[1]}.json`);
    m = /^\/api\/documents\/([^/]+)$/.exec(path);
    if (m) { const d = (await field()).documents.find((x) => x.id === m![1]); if (!d) throw new Error("404 document not found"); return d; }
  }
  if (method === "POST") {
    if (path === "/api/search") return search(body as Parameters<typeof search>[0]);
    if (path === "/api/rag/query") return rag(body as Parameters<typeof rag>[0]);
    if (path === "/api/alerts/ack") {
      const k = (body as { alert_key: string }).alert_key;
      try { localStorage.setItem("nwis:acks", JSON.stringify([...new Set([...acks(), k])])); } catch { /* ignore */ }
      return { ok: true };
    }
    if (path === "/api/offsets/rank") {
      const w = body as Record<string, number>;
      const tot = Object.values(w).reduce((a, b) => a + b, 0) || 1;
      const base = await load<{ ranking: { components: Record<string, number>; score: number; rank: number }[] }>(`offsets_${r}.json`);
      const ranking = base.ranking.map((x) => ({ ...x, score: Math.round((Object.entries(x.components).reduce((a, [k, v]) => a + (w[k] ?? 0) * v, 0) / tot) * 1e4) / 1e4 }))
        .sort((a, b) => b.score - a.score).map((x, i) => ({ ...x, rank: i + 1 }));
      return { weights: w, ranking };
    }
  }
  throw new Error(NEEDS_SERVER);
}

export function staticUrl(path: string): string | null {
  if (path.startsWith("/api/report/prespud.pdf")) return `${DATA}prespud.pdf`;
  return null; // per-document PDFs are rendered server-side only
}
