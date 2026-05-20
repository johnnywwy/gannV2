import type { Trend } from "./squareNine";

export type GannBridgePayload = {
  value: number;
  trend: Trend;
  source?: string;
  updatedAt: number;
};

export const GANN_BRIDGE_STORAGE_KEY = "gann-v2:square-nine-selection";
export const GANN_BRIDGE_EVENT = "gann-square-nine-selection";

export function saveGannBridgeSelection(payload: Omit<GannBridgePayload, "updatedAt">) {
  const next: GannBridgePayload = {
    ...payload,
    value: Math.max(1, Math.round(Number(payload.value) || 1)),
    updatedAt: Date.now(),
  };

  window.localStorage.setItem(GANN_BRIDGE_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent<GannBridgePayload>(GANN_BRIDGE_EVENT, { detail: next }));
  return next;
}

export function readGannBridgeSelection() {
  try {
    const raw = window.localStorage.getItem(GANN_BRIDGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GannBridgePayload>;
    const value = Math.round(Number(parsed.value));
    if (!Number.isFinite(value) || value < 1) return null;
    return {
      value,
      trend: parsed.trend === "up" ? "up" : "down",
      source: parsed.source,
      updatedAt: Number(parsed.updatedAt) || 0,
    } satisfies GannBridgePayload;
  } catch {
    return null;
  }
}
