import { useState } from "react";
import { RISK_COLOR } from "../lib/constants";
import { tr } from "../lib/i18n";
import type { Lang, RiskSection } from "../types";

interface Props { sections: RiskSection[]; bitDepth: number; lang: Lang; auc?: number | null; compact?: boolean }

/** Colour-coded risk bar along depth + SHAP "Why" panel for the selected interval. */
export default function RiskPanel({ sections, bitDepth, lang, auc, compact }: Props) {
  const current = sections.find((s) => bitDepth >= s.top_m && bitDepth < s.base_m);
  const [picked, setPicked] = useState<RiskSection | null>(null);
  const shown = picked ?? current ?? sections.reduce<RiskSection | null>((a, s) => (!a || s.risk > a.risk ? s : a), null);
  const td = sections.length ? sections[sections.length - 1].base_m : 5000;
  const maxAbs = shown ? Math.max(...shown.drivers.map((d) => Math.abs(d.shap)), 0.01) : 1;

  return (
    <div className="card flex gap-3 p-3">
      <div className="flex flex-col items-center">
        <span className="label mb-1">{tr("risk", lang)}</span>
        <div className={`relative w-10 overflow-hidden rounded border border-slate-300 dark:border-slate-700 ${compact ? "h-[260px]" : "h-[520px]"}`}>
          {sections.map((s) => (
            <button key={s.top_m} title={`${s.top_m}-${s.base_m} m · ${(s.risk * 100).toFixed(0)}% ${s.level}`}
              onClick={() => setPicked(s)} aria-label={`risk ${s.top_m} m`}
              className="absolute left-0 w-full hover:brightness-125"
              style={{ top: `${(s.top_m / td) * 100}%`, height: `${((s.base_m - s.top_m) / td) * 100}%`, background: RISK_COLOR[s.level],
                opacity: 0.35 + 0.65 * s.risk }} />
          ))}
          <div className="pointer-events-none absolute left-0 w-full border-t-2 border-black dark:border-white" style={{ top: `${(bitDepth / td) * 100}%` }} />
        </div>
        <div className="mt-1 flex w-full justify-between text-[10px] text-slate-500"><span>0</span><span>{td.toFixed(0)}m</span></div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap gap-2 text-[11px]">
          {(["low", "moderate", "high"] as const).map((l) => (
            <span key={l} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: RISK_COLOR[l] }} />{l}</span>
          ))}
          {auc != null && <span className="ml-auto text-slate-500">XGBoost · hold-out AUC {auc}</span>}
        </div>
        {shown && (
          <>
            <h3 className="font-semibold">{tr("why", lang)}</h3>
            <p className="text-sm">
              <b>{shown.top_m.toFixed(0)}–{shown.base_m.toFixed(0)} m</b> · {shown.formation} ·{" "}
              <span className="rounded px-1.5 py-0.5 text-xs font-bold text-white" style={{ background: RISK_COLOR[shown.level] }}>
                {(shown.risk * 100).toFixed(0)}% {shown.level.toUpperCase()}
              </span>
            </p>
            <p className="mt-1 text-sm italic text-slate-600 dark:text-slate-300">{shown.why}</p>
            <div className="mt-2 space-y-1">
              {shown.drivers.map((d) => (
                <div key={d.feature} className="flex items-center gap-2 text-xs">
                  <span className="w-44 truncate" title={d.label}>{d.label}</span>
                  <div className="relative h-3 flex-1 rounded bg-slate-100 dark:bg-slate-800">
                    <div className="absolute top-0 h-3 rounded" style={{
                      left: d.shap >= 0 ? "50%" : `${50 - (Math.abs(d.shap) / maxAbs) * 50}%`, width: `${(Math.abs(d.shap) / maxAbs) * 50}%`,
                      background: d.shap >= 0 ? RISK_COLOR.high : RISK_COLOR.low }} />
                    <div className="absolute left-1/2 top-0 h-3 w-px bg-slate-400" />
                  </div>
                  <span className="w-24 text-right font-mono">{d.shap >= 0 ? "+" : ""}{d.shap.toFixed(2)} ({d.value})</span>
                </div>
              ))}
              <p className="text-[10px] text-slate-500">SHAP log-odds contributions (TreeSHAP). Red raises risk, green lowers it. Click the bar to inspect any interval.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
