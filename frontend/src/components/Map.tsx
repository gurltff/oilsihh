import { Circle, CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { useEffect, useMemo } from "react";
import type { Lang, Well } from "../types";
import { tr } from "../lib/i18n";

interface Props {
  wells: Well[];
  target: Well | undefined;
  radiusKm: number;
  setRadiusKm: (r: number) => void;
  selected: string[];
  active: string | null;
  onSelect: (id: string) => void;
  lang: Lang;
}

/** Surface projection of a build-and-hold trajectory (same model as the backend). */
function surfacePath(w: Well): [number, number][] {
  const pts: [number, number][] = [];
  let x = 0, y = 0;
  const az = (w.azimuth_deg * Math.PI) / 180;
  for (let md = 0; md <= w.td_m; md += 100) {
    const inc = md <= w.kop_m ? 0 : Math.min(w.inclination_deg, ((md - w.kop_m) * 2.5) / 30);
    const h = 100 * Math.sin((inc * Math.PI) / 180);
    x += h * Math.sin(az);
    y += h * Math.cos(az);
    pts.push([w.lat + y / 111000, w.lon + x / (111000 * Math.cos((w.lat * Math.PI) / 180))]);
  }
  return pts;
}

function Recenter({ target }: { target?: Well }) {
  const map = useMap();
  useEffect(() => { if (target) map.setView([target.lat, target.lon], map.getZoom()); }, [target, map]);
  return null;
}

export default function WellMap({ wells, target, radiusKm, setRadiusKm, selected, active, onSelect, lang }: Props) {
  const paths = useMemo(() => Object.fromEntries(wells.map((w) => [w.id, surfacePath(w)])), [wells]);
  if (!target) return <div className="card h-full animate-pulse" />;
  return (
    <div className="card flex h-full flex-col p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="label">{tr("radius", lang)}</span>
        <input aria-label="radius" type="range" min={1} max={15} step={0.5} value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))} className="flex-1 accent-oil-500" />
        <span className="w-16 text-right font-mono text-sm">{radiusKm.toFixed(1)} km</span>
        <span className="text-xs text-slate-500">{wells.filter((w) => w.in_radius && !w.is_target).length} offset wells</span>
      </div>
      <div className="relative min-h-[300px] flex-1">
        <MapContainer center={[target.lat, target.lon]} zoom={11} scrollWheelZoom>
          <Recenter target={target} />
          <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Circle center={[target.lat, target.lon]} radius={radiusKm * 1000}
            pathOptions={{ color: "#1f5aa6", weight: 1.5, fillOpacity: 0.06, dashArray: "6 4" }} />
          {wells.map((w) => {
            const isSel = selected.includes(w.id);
            const isActive = active === w.id;
            const color = w.is_target ? "#b3122e" : !w.in_radius ? "#94a3b8" : isSel ? "#f2a900" : "#1f5aa6";
            return (
              <div key={w.id}>
                {(w.is_target || isSel || isActive) && (
                  <Polyline positions={paths[w.id]} pathOptions={{ color, weight: isActive ? 5 : 3, opacity: 0.9 }} />
                )}
                <CircleMarker center={[w.lat, w.lon]} radius={w.is_target ? 10 : isActive ? 9 : 6}
                  pathOptions={{ color: isActive ? "#000" : "#fff", weight: 2, fillColor: color, fillOpacity: w.in_radius ? 1 : 0.4 }}
                  eventHandlers={{ click: () => !w.is_target && onSelect(w.id) }}>
                  <Tooltip direction="top">
                    <div className="text-xs">
                      <b>{w.name}</b> ({w.field}){w.is_target ? " — TARGET" : ""}<br />
                      {w.distance_km != null && !w.is_target && <>{w.distance_km.toFixed(2)} km · </>}
                      TD {w.td_m.toFixed(0)} m · {w.event_count} events · {w.npt_total} h NPT
                    </div>
                  </Tooltip>
                </CircleMarker>
              </div>
            );
          })}
        </MapContainer>
        <div className="absolute bottom-2 left-2 z-[500] rounded bg-white/90 px-2 py-1 text-[11px] text-slate-700 shadow">
          <span className="mr-2"><span className="inline-block h-2 w-2 rounded-full bg-[#b3122e]" /> Target</span>
          <span className="mr-2"><span className="inline-block h-2 w-2 rounded-full bg-[#1f5aa6]" /> In radius</span>
          <span className="mr-2"><span className="inline-block h-2 w-2 rounded-full bg-[#f2a900]" /> In correlation</span>
          <span><span className="inline-block h-2 w-2 rounded-full bg-slate-400" /> Outside</span>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">Click an offset well to add/remove it from the correlation panel.</p>
    </div>
  );
}
