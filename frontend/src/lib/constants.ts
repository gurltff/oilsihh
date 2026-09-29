import type { EventType } from "../types";

/** Event identity colours — validated (CVD / normal-vision / lightness) with the dataviz palette checker. */
export const EVENT_COLOR: Record<EventType, string> = { loss: "#d62839", kick: "#e0a800", stuck_pipe: "#7b3fb8", caving: "#0a93b5" };
export const EVENT_SYMBOL: Record<EventType, string> = { loss: "circle", kick: "diamond", stuck_pipe: "square", caving: "triangle-up" };
export const EVENT_TYPES: EventType[] = ["loss", "kick", "stuck_pipe", "caving"];

/** Conventional lithology fill colours for strip logs. */
export const LITHO_COLOR: Record<string, string> = {
  Alluvium: "#e8dcb5", Namsang: "#d9c27a", "Girujan Clay": "#9c8b6e", "Tipam Sandstone": "#f3d34a",
  "Barail Coal": "#3b3b3b", "Kopili Shale": "#5d7a5a", "Sylhet Limestone": "#8ec5e8",
};
export const FORMATIONS = Object.keys(LITHO_COLOR);

/** Status (risk) colours — reserved, always shown with a text label. */
export const RISK_COLOR = { low: "#2e9e5b", moderate: "#e39a14", high: "#b3122e" } as const;
export const TARGET_ID = "NWIS-TGT-01";
