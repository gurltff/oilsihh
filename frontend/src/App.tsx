import { useCallback, useEffect, useMemo, useState } from "react";
import WellMap from "./components/Map";
import Correlation from "./components/Correlation";
import LookAhead from "./components/LookAhead";
import RAGChat from "./components/RAGChat";
import RiskPanel from "./components/RiskPanel";
import ReplayBar from "./components/ReplayBar";
import TelemetryPanel from "./components/TelemetryPanel";
import Trajectory3D from "./components/Trajectory3D";
import SimilarityTable from "./components/SimilarityTable";
import Ingest from "./components/Ingest";
import KnowledgeBase from "./components/KnowledgeBase";
import ManagerDashboard from "./components/ManagerDashboard";
import DocModal from "./components/DocModal";
import { api, cache, cachedGet } from "./lib/api";
import { TARGET_ID } from "./lib/constants";
import { LANG_LABEL, tr } from "./lib/i18n";
import type { DocRef, Lang, LookAheadResp, RiskSection, Role, Similar, Telemetry, Well } from "./types";

type Theme = "light" | "dark" | "oled";
type Tab = "overview" | "kb" | "ingest" | "ask" | "3d";

const pref = <T,>(k: string, d: T): T => cache.get<T>(k)?.value ?? d;

export default function App() {
  const [role, setRole] = useState<Role>(() => pref("role", "geologist"));
  const [lang, setLang] = useState<Lang>(() => pref("lang", "en"));
  const [theme, setTheme] = useState<Theme>(() => pref("theme", "light"));
  const [tab, setTab] = useState<Tab>("overview");
  const [radiusKm, setRadiusKm] = useState(10);
  const [wells, setWells] = useState<Well[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(TARGET_ID);
  const [risk, setRisk] = useState<{ sections: RiskSection[]; holdout_auc: number | null }>({ sections: [], holdout_auc: null });
  const [look, setLook] = useState<LookAheadResp | null>(null);
  const [offline, setOffline] = useState(false);
  const [stream, setStream] = useState<Telemetry[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [doc, setDoc] = useState<DocRef | null>(null);
  const [ackTick, setAckTick] = useState(0);

  const dark = theme !== "light";
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("dark", dark);
    el.classList.toggle("oled", theme === "oled");
    cache.set("theme", theme);
  }, [theme, dark]);
  useEffect(() => cache.set("role", role), [role]);
  useEffect(() => { cache.set("lang", lang); document.documentElement.lang = lang; }, [lang]);

  // wells within radius (debounced for slider drags)
  useEffect(() => {
    const h = setTimeout(() => {
      cachedGet<Well[]>(`wells:${radiusKm}`, "/api/wells", { target: TARGET_ID, radius_km: radiusKm })
        .then(([w, off]) => { setWells(w); setOffline(off); }).catch(() => setOffline(true));
      cachedGet<{ sections: RiskSection[]; holdout_auc: number }>(`risk:${radiusKm}`, "/api/risk", { well_id: TARGET_ID, radius_km: radiusKm })
        .then(([r]) => setRisk(r)).catch(() => undefined);
    }, 200);
    return () => clearTimeout(h);
  }, [radiusKm]);

  // pre-select the three most similar offsets for the correlation panel
  useEffect(() => {
    api.get<{ ranking: Similar[] }>("/api/offsets", { well_id: TARGET_ID, radius_km: 10 })
      .then((r) => setSelected(r.ranking.slice(0, 3).map((s) => s.well_id))).catch(() => undefined);
  }, []);

  // telemetry stream for replay; start the demo just above the top of the Girujan
  useEffect(() => {
    cachedGet<Telemetry[]>("telemetry", "/api/telemetry", { well_id: TARGET_ID, radius_km: 10 }).then(([s]) => {
      setStream(s);
      const start = s.findIndex((p) => p.md >= 2500);
      setIndex(start > 0 ? start : 0);
    }).catch(() => undefined);
  }, []);

  const bitDepth = stream[index]?.md ?? 0;

  // look-ahead alerts follow the bit
  useEffect(() => {
    const h = setTimeout(() => {
      cachedGet<LookAheadResp>(`look:${lang}`, "/api/lookahead", { well_id: TARGET_ID, bit_depth: bitDepth, radius_km: radiusKm, window_m: 300, lang })
        .then(([l, off]) => { setLook(off ? { ...l, bit_depth_m: bitDepth } : l); setOffline(off); }).catch(() => setOffline(true));
    }, 120);
    return () => clearTimeout(h);
  }, [bitDepth, radiusKm, lang]);

  // voice-free audible cue when a new HIGH alert appears
  const topKey = look?.alerts[0]?.severity === "high" ? look.alerts[0].key : null;
  useEffect(() => {
    if (!topKey || !playing) return;
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      o.frequency.value = 880;
      o.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.15);
    } catch { /* autoplay blocked */ }
  }, [topKey, playing]);

  const toggleWell = useCallback((id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-4)));
    setActive(id);
  }, []);
  const corrIds = useMemo(() => [TARGET_ID, ...selected], [selected]);
  const target = wells.find((w) => w.is_target);
  const openDoc = useCallback((d: DocRef) => { setDoc(d); setAckTick((t) => t + 1); }, []);

  const tabs: [Tab, string][] = [["overview", tr("overview", lang)], ["ask", tr("ask", lang)], ["kb", tr("kb", lang)], ["ingest", tr("ingest", lang)], ["3d", tr("view3d", lang)]];

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-[1000] flex flex-wrap items-center gap-3 bg-oil-900 px-4 py-2 text-white shadow dark:bg-black">
        <div>
          <div className="text-lg font-black tracking-tight">eRTMAC-NWIS <span className="text-oil-accent">●</span></div>
          <div className="text-[11px] text-slate-300">{tr("title", lang)} · Oil India Limited · {target?.name ?? TARGET_ID}</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-600" role="tablist" aria-label="role">
            {(["driller", "geologist", "manager"] as Role[]).map((r) => (
              <button key={r} onClick={() => { setRole(r); setTab("overview"); }}
                className={`px-3 py-1 text-sm ${role === r ? "bg-oil-accent font-bold text-black" : "hover:bg-oil-700"}`}>{tr(r, lang)}</button>
            ))}
          </div>
          <select aria-label="language" className="rounded bg-oil-700 px-2 py-1 text-sm" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {(Object.keys(LANG_LABEL) as Lang[]).map((l) => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
          </select>
          <select aria-label="theme" className="rounded bg-oil-700 px-2 py-1 text-sm" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
            <option value="light">☀ Light</option><option value="dark">🌙 Dark</option><option value="oled">⬛ OLED field</option>
          </select>
          <a className="btn bg-oil-accent text-black hover:brightness-110" href={api.url(`/api/report/prespud.pdf?well_id=${TARGET_ID}&radius_km=${radiusKm}`)}>
            ⬇ {tr("prespud", lang)}
          </a>
        </div>
      </header>

      {role !== "driller" && (
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === k ? "border-oil-500 font-semibold" : "border-transparent text-slate-500"}`}>{label}</button>
          ))}
        </nav>
      )}

      <main className="mx-auto max-w-[1600px] space-y-3 p-3">
        {role === "driller" && (
          <>
            <LookAhead data={look} lang={lang} role={role} offline={offline} onOpenDoc={openDoc} />
            <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
              <TelemetryPanel stream={stream} index={index} dark={dark} lang={lang} big />
              <RiskPanel sections={risk.sections} bitDepth={bitDepth} lang={lang} auc={risk.holdout_auc} compact />
            </div>
          </>
        )}

        {role === "geologist" && tab === "overview" && (
          <>
            <LookAhead data={look} lang={lang} role={role} offline={offline} onOpenDoc={openDoc} />
            <div className="grid gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="space-y-3">
                <div className="h-[460px]">
                  <WellMap wells={wells} target={target} radiusKm={radiusKm} setRadiusKm={setRadiusKm} selected={selected} active={active} onSelect={toggleWell} lang={lang} />
                </div>
                <SimilarityTable wellId={TARGET_ID} radiusKm={radiusKm} lang={lang} selected={selected} onToggle={toggleWell} />
              </div>
              <div className="space-y-3">
                <Correlation wellIds={corrIds} active={active} bitDepth={bitDepth} dark={dark} lang={lang} onActivate={setActive} onRemove={toggleWell} />
                <RiskPanel sections={risk.sections} bitDepth={bitDepth} lang={lang} auc={risk.holdout_auc} />
              </div>
            </div>
          </>
        )}

        {role === "manager" && tab === "overview" && (
          <>
            <ManagerDashboard wellId={TARGET_ID} radiusKm={radiusKm} dark={dark} refreshKey={ackTick + (look?.alerts.length ?? 0)} />
            <div className="grid gap-3 lg:grid-cols-2">
              <LookAhead data={look} lang={lang} role={role} offline={offline} onOpenDoc={openDoc} />
              <SimilarityTable wellId={TARGET_ID} radiusKm={radiusKm} lang={lang} selected={selected} onToggle={toggleWell} />
            </div>
          </>
        )}

        {role !== "driller" && tab === "ask" && <RAGChat lang={lang} wellId={TARGET_ID} radiusKm={radiusKm} onOpenDoc={openDoc} />}
        {role !== "driller" && tab === "kb" && <KnowledgeBase lang={lang} wellId={TARGET_ID} radiusKm={radiusKm} onOpenDoc={openDoc} />}
        {role !== "driller" && tab === "ingest" && <Ingest onOpenDoc={openDoc} />}
        {role !== "driller" && tab === "3d" && <Trajectory3D wellId={TARGET_ID} radiusKm={radiusKm} bitDepth={bitDepth} dark={dark} lang={lang} active={active} />}
      </main>

      <ReplayBar stream={stream} index={index} setIndex={setIndex} playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} />
      <DocModal doc={doc} onClose={() => setDoc(null)} />
    </div>
  );
}
