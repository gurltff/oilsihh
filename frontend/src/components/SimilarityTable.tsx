import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { tr } from "../lib/i18n";
import type { Lang, Similar } from "../types";

type W = { distance: number; lithology: number; mud_weight: number; trajectory: number };
interface Props { wellId: string; radiusKm: number; lang: Lang; selected: string[]; onToggle: (id: string) => void }

const LABEL: Record<keyof W, string> = { distance: "w₁ Distance", lithology: "w₂ Lithology", mud_weight: "w₃ MW profile", trajectory: "w₄ Trajectory" };

/** Multi-parameter weighted similarity index with live-tunable weights. */
export default function SimilarityTable({ wellId, radiusKm, lang, selected, onToggle }: Props) {
  const [w, setW] = useState<W>({ distance: 0.3, lithology: 0.3, mud_weight: 0.25, trajectory: 0.15 });
  const [rows, setRows] = useState<Similar[]>([]);
  useEffect(() => {
    const h = setTimeout(() => {
      api.post<{ ranking: Similar[] }>(`/api/offsets/rank?well_id=${wellId}&radius_km=${radiusKm}`, w).then((r) => setRows(r.ranking)).catch(() => undefined);
    }, 150);
    return () => clearTimeout(h);
  }, [w, wellId, radiusKm]);
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="card p-3">
      <h2 className="font-semibold">{tr("similarity", lang)}</h2>
      <p className="mb-2 font-mono text-[11px] text-slate-500">Similarity = w₁·e^(−d/5km) + w₂·Litho IoU + w₃·(1 − ΔMW/PP) + w₄·cos(2Δinc)</p>
      <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
        {(Object.keys(w) as (keyof W)[]).map((k) => (
          <label key={k} className="text-xs">
            {LABEL[k]} <b>{((w[k] / sum) * 100).toFixed(0)}%</b>
            <input type="range" min={0} max={1} step={0.05} value={w[k]} className="w-full accent-oil-500"
              onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} />
          </label>
        ))}
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white text-left dark:bg-slate-900">
            <tr><th>#</th><th>Well</th><th className="text-right">km</th><th className="text-right">Litho</th><th className="text-right">MW</th><th className="text-right">Traj</th><th>Score</th><th className="text-right">NPT h</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.well_id} className="border-t border-slate-100 dark:border-slate-800">
                <td>{r.rank}</td>
                <td className="font-medium">{r.name}</td>
                <td className="text-right font-mono">{r.distance_km.toFixed(1)}</td>
                <td className="text-right font-mono">{r.components.lithology.toFixed(2)}</td>
                <td className="text-right font-mono">{r.components.mud_weight.toFixed(2)}</td>
                <td className="text-right font-mono">{r.components.trajectory.toFixed(2)}</td>
                <td className="w-28">
                  <div className="flex items-center gap-1">
                    <div className="h-2 flex-1 rounded bg-slate-100 dark:bg-slate-800"><div className="h-2 rounded bg-oil-500" style={{ width: `${r.score * 100}%` }} /></div>
                    <span className="font-mono">{r.score.toFixed(2)}</span>
                  </div>
                </td>
                <td className="text-right font-mono">{r.npt_total}</td>
                <td className="text-right">
                  <button className="text-oil-500 hover:underline" onClick={() => onToggle(r.well_id)}>{selected.includes(r.well_id) ? "− log" : "+ log"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
