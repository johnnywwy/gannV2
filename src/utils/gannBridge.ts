import type { Trend } from "./squareNine";

export type GannTrendSegment = {
  startDate: string;
  endDate: string;
  startPrice: number;
  endPrice: number;
  direction: "up" | "down";
};

export type GannBridgePayload = {
  value: number;
  trend: Trend;
  source?: string;
  symbol?: string;
  symbolName?: string;
  turningKind?: "high" | "low";
  timestamp?: number;
  date?: string;
  trendSegments?: GannTrendSegment[];
  updatedAt: number;
};

export type GannProjectionLine = {
  value: number;
  kind: "main" | "cross";
};

export type GannProjectionPayload = {
  clickedValue: number;
  trend: Trend;
  source?: string;
  lines: GannProjectionLine[];
  updatedAt: number;
};

export const GANN_BRIDGE_EVENT = "gann-square-nine-selection";
export const GANN_PROJECTION_EVENT = "gann-square-nine-projection";

let bridgeSelection: GannBridgePayload | null = null;
let projectionResult: GannProjectionPayload | null = null;

export function saveGannBridgeSelection(payload: Omit<GannBridgePayload, "updatedAt">) {
  const next: GannBridgePayload = {
    ...payload,
    value: Math.max(1, Math.round(Number(payload.value) || 1)),
    trendSegments: payload.trendSegments ?? bridgeSelection?.trendSegments,
    updatedAt: Date.now(),
  };

  bridgeSelection = next;
  window.dispatchEvent(new CustomEvent<GannBridgePayload>(GANN_BRIDGE_EVENT, { detail: next }));
  return next;
}

export function readGannBridgeSelection() {
  return bridgeSelection;
}

export function saveGannTrendSegments(
  segments: GannTrendSegment[],
  symbol?: string,
  symbolName?: string,
) {
  const current = bridgeSelection;
  const next: GannBridgePayload = {
    value: current?.value ?? 1,
    trend: current?.trend ?? "down",
    source: current?.source ?? "K线日线趋势分段",
    symbol: symbol ?? current?.symbol,
    symbolName: symbolName ?? current?.symbolName,
    turningKind: current?.turningKind,
    timestamp: current?.timestamp,
    date: current?.date,
    trendSegments: segments,
    updatedAt: Date.now(),
  };
  bridgeSelection = next;
  window.dispatchEvent(new CustomEvent<GannBridgePayload>(GANN_BRIDGE_EVENT, { detail: next }));
  return next;
}

export function saveGannProjectionResult(
  payload: Omit<GannProjectionPayload, "updatedAt">,
) {
  const next: GannProjectionPayload = {
    ...payload,
    clickedValue: Math.max(1, Math.round(Number(payload.clickedValue) || 1)),
    lines: payload.lines
      .map<GannProjectionLine>((line) => ({
        value: Number(line.value),
        kind: line.kind === "cross" ? "cross" : "main",
      }))
      .filter((line) => Number.isFinite(line.value) && line.value > 0),
    updatedAt: Date.now(),
  };

  projectionResult = next;
  window.dispatchEvent(
    new CustomEvent<GannProjectionPayload>(GANN_PROJECTION_EVENT, {
      detail: next,
    }),
  );
  return next;
}

export function readGannProjectionResult() {
  return projectionResult;
}
