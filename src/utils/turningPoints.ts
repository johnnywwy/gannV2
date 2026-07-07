export type TurningPointKind = "high" | "low";

export type TurningPointBar = {
  timestamp?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
};

export type TurningPoint = {
  kind: TurningPointKind;
  timestamp: number;
  value: number;
  index: number;
  key: string;
};

export const DEFAULT_TURNING_THRESHOLD = 1.8;
export const TURNING_THRESHOLD_EVENT = "gann-turning-threshold-change";

export function calculateMajorTurningPoints(
  bars: TurningPointBar[],
  threshold: number,
): TurningPoint[] {
  if (bars.length < 30) return [];

  const highs = bars.map((bar) => Number(bar.high));
  const lows = bars.map((bar) => Number(bar.low));
  const validHighs = highs.filter(Number.isFinite);
  const validLows = lows.filter(Number.isFinite);
  if (validHighs.length === 0 || validLows.length === 0) return [];

  const highest = Math.max(...validHighs);
  const lowest = Math.min(...validLows);
  const range = highest - lowest;
  if (!Number.isFinite(range) || range <= 0) return [];

  const pivotWindow = clamp(Math.floor(bars.length / 90), 5, 18);
  const normalizedThreshold = clamp(threshold, 0.5, 8);
  const minMove = Math.max(
    range * (normalizedThreshold / 100),
    calculateAverageTrueRange(bars, 14) * normalizedThreshold,
  );
  const candidates: TurningPoint[] = [];

  for (let index = pivotWindow; index < bars.length - pivotWindow; index += 1) {
    const high = highs[index];
    const low = lows[index];
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;

    let isHigh = true;
    let isLow = true;
    for (
      let offset = index - pivotWindow;
      offset <= index + pivotWindow;
      offset += 1
    ) {
      if (offset === index) continue;
      if (high < highs[offset]) isHigh = false;
      if (low > lows[offset]) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) {
      const timestamp = Number(bars[index].timestamp);
      candidates.push({
        kind: "high",
        timestamp,
        value: high,
        index,
        key: `high:${timestamp}:${high}`,
      });
    }
    if (isLow) {
      const timestamp = Number(bars[index].timestamp);
      candidates.push({
        kind: "low",
        timestamp,
        value: low,
        index,
        key: `low:${timestamp}:${low}`,
      });
    }
  }

  return compressTurningPoints(candidates, minMove, pivotWindow).slice(-36);
}

export function formatDateFromTimestamp(timestamp: number) {
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeTurningThreshold(value: unknown) {
  const numeric = Number(value ?? DEFAULT_TURNING_THRESHOLD);
  const clamped = Math.min(
    8,
    Math.max(
      0.5,
      Number.isFinite(numeric) ? numeric : DEFAULT_TURNING_THRESHOLD,
    ),
  );
  return Number(clamped.toFixed(1));
}

export function readStoredTurningThreshold() {
  if (typeof window === "undefined") return DEFAULT_TURNING_THRESHOLD;
  return normalizeTurningThreshold(
    window.localStorage.getItem(getTurningThresholdStorageKey()),
  );
}

export function saveTurningThreshold(value: unknown) {
  const threshold = normalizeTurningThreshold(value);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      getTurningThresholdStorageKey(),
      String(threshold),
    );
    window.dispatchEvent(
      new CustomEvent<number>(TURNING_THRESHOLD_EVENT, {
        detail: threshold,
      }),
    );
  }
  return threshold;
}

function compressTurningPoints(
  candidates: TurningPoint[],
  minMove: number,
  pivotWindow: number,
) {
  const points: TurningPoint[] = [];
  candidates
    .sort((a, b) => a.index - b.index || (a.kind === "high" ? -1 : 1))
    .forEach((candidate) => {
      const last = points.at(-1);
      if (!last) {
        points.push(candidate);
        return;
      }

      if (candidate.kind === last.kind) {
        const shouldReplace =
          candidate.kind === "high"
            ? candidate.value >= last.value
            : candidate.value <= last.value;
        if (shouldReplace) points[points.length - 1] = candidate;
        return;
      }

      const hasEnoughMove = Math.abs(candidate.value - last.value) >= minMove;
      const hasEnoughDistance = candidate.index - last.index >= pivotWindow * 2;
      if (hasEnoughMove || hasEnoughDistance) {
        points.push(candidate);
      }
    });

  return points;
}

function calculateAverageTrueRange(bars: TurningPointBar[], period: number) {
  const trueRanges: number[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const high = Number(bars[index].high);
    const low = Number(bars[index].low);
    const prevClose = Number(bars[index - 1].close);
    if (![high, low, prevClose].every(Number.isFinite)) continue;
    trueRanges.push(
      Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose),
      ),
    );
  }

  const recent = trueRanges.slice(-period * 3);
  if (recent.length === 0) return 0;
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getTurningThresholdStorageKey() {
  return "gann-turning-threshold";
}
