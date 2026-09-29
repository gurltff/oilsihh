import { useEffect, useRef } from "react";
import type { Telemetry } from "../types";

interface Props {
  stream: Telemetry[];
  index: number;
  setIndex: (i: number | ((p: number) => number)) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  speed: number;
  setSpeed: (s: number) => void;
}

const BASE_TICK_MS = 250; // 1x = one 5 m sample every 250 ms

/** Floating live-feed replay controller (play / pause / speed / scrub). */
export default function ReplayBar({ stream, index, setIndex, playing, setPlaying, speed, setSpeed }: Props) {
  const timer = useRef<number>();
  useEffect(() => {
    window.clearInterval(timer.current);
    if (playing && stream.length) {
      timer.current = window.setInterval(() => {
        setIndex((i) => {
          if (i >= stream.length - 1) { setPlaying(false); return i; }
          return Math.min(stream.length - 1, i + speed);
        });
      }, BASE_TICK_MS);
    }
    return () => window.clearInterval(timer.current);
  }, [playing, speed, stream.length, setIndex, setPlaying]);

  const cur = stream[index];
  return (
    <div className="fixed bottom-3 left-1/2 z-[1500] flex w-[min(960px,95vw)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/95 px-4 py-2 text-white shadow-2xl">
      <span className="flex items-center gap-1 text-xs font-bold text-red-400">
        <span className={`h-2 w-2 rounded-full ${playing ? "animate-pulse bg-red-500" : "bg-slate-500"}`} /> REPLAY
      </span>
      <button className="btn bg-oil-500 hover:bg-oil-700" onClick={() => setPlaying(!playing)} aria-label={playing ? "pause" : "play"}>
        {playing ? "❚❚ Pause" : "▶ Play"}
      </button>
      <div className="flex overflow-hidden rounded-lg border border-slate-600">
        {[1, 5, 10].map((s) => (
          <button key={s} onClick={() => setSpeed(s)} className={`px-2 py-1 text-xs ${speed === s ? "bg-oil-accent text-black" : "hover:bg-slate-700"}`}>{s}x</button>
        ))}
      </div>
      <input aria-label="scrub depth" type="range" min={0} max={Math.max(0, stream.length - 1)} value={index}
        onChange={(e) => setIndex(Number(e.target.value))} className="min-w-[160px] flex-1 accent-amber-400" />
      <span className="w-24 text-right font-mono text-sm">{cur ? `${cur.md.toFixed(0)} m` : "—"}</span>
      {cur && (
        <span className="hidden font-mono text-[11px] text-slate-300 lg:inline">
          ROP {cur.rop} · SPP {cur.spp_psi} · TQ {cur.torque_kftlb} · Gas {cur.gas_ppm}
        </span>
      )}
    </div>
  );
}
