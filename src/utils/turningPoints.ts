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

export type DailyTrendSegment = {
  startDate: string;
  endDate: string;
  startTimestamp: number;
  endTimestamp: number;
  startPrice: number;
  endPrice: number;
  direction: "up" | "down";
};

export const DEFAULT_TURNING_THRESHOLD = 1.8;
export const TURNING_THRESHOLD_EVENT = "gann-turning-threshold-change";

export function calculateMajorTurningPoints(
  bars: TurningPointBar[],
  threshold: number,
  maxPoints = 36,
): TurningPoint[] {
  if (bars.length < 30) return [];

  const highs = bars.map((bar) => Number(bar.high));
  const lows = bars.map((bar) => Number(bar.low));
  const validHighs = highs.filter(Number.isFinite);
  const validLows = lows.filter(Number.isFinite);
  if (validHighs.length === 0 || validLows.length === 0) return [];

  const pivotWindow = clamp(Math.floor(bars.length / 90), 5, 18);
  const normalizedThreshold = clamp(threshold, 0.5, 8);
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

  const points = compressTurningPoints(
    candidates,
    normalizedThreshold,
    pivotWindow,
    bars,
    pivotWindow + Math.ceil(2 * Math.sqrt(pivotWindow)),
  );
  return maxPoints > 0 ? points.slice(-maxPoints) : points;
}

export function buildDailyTrendSegments(
  bars: TurningPointBar[],
): DailyTrendSegment[] {
  const pivots = calculateMajorTurningPoints(bars, 3.5, 0);
  if (pivots.length < 2) return [];

  return pivots.slice(0, -1).map((pivot, index) => {
    const next = pivots[index + 1];
    return {
      startDate: formatDateFromTimestamp(pivot.timestamp),
      endDate: formatDateFromTimestamp(next.timestamp),
      startTimestamp: pivot.timestamp,
      endTimestamp: next.timestamp,
      startPrice: pivot.value,
      endPrice: next.value,
      direction: next.value >= pivot.value ? "up" : "down",
    };
  });
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
  thresholdPct: number,
  _pivotWindow: number,
  bars: TurningPointBar[],
  minimumBarsBetween: number,
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

      const referencePrice = Math.max(
        0.0001,
        Math.min(Math.abs(candidate.value), Math.abs(last.value)),
      );
      const percentMove = referencePrice * (thresholdPct / 100);
      const localAtr = calculateLocalAverageTrueRange(
        bars,
        Math.round((candidate.index + last.index) / 2),
        14,
      );
      const hasEnoughMove =
        Math.abs(candidate.value - last.value) >=
        Math.max(percentMove, localAtr);
      const hasEnoughDistance =
        candidate.index - last.index >= minimumBarsBetween;
      if (hasEnoughMove && hasEnoughDistance) {
        points.push(candidate);
      }
    });

  return points;
}

function calculateLocalAverageTrueRange(
  bars: TurningPointBar[],
  centerIndex: number,
  period: number,
) {
  const start = Math.max(1, centerIndex - period);
  const end = Math.min(bars.length - 1, centerIndex + period);
  const ranges: number[] = [];

  for (let index = start; index <= end; index += 1) {
    const high = Number(bars[index].high);
    const low = Number(bars[index].low);
    const previousClose = Number(bars[index - 1].close);
    if (![high, low, previousClose].every(Number.isFinite)) continue;
    ranges.push(
      Math.max(
        high - low,
        Math.abs(high - previousClose),
        Math.abs(low - previousClose),
      ),
    );
  }

  if (ranges.length === 0) return 0;
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getTurningThresholdStorageKey() {
  return "gann-turning-threshold";
}
