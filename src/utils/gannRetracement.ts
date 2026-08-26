import { generateGannMatrix } from "./squareNine";

export type RetracementBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type RetracementPivot = {
  kind: "high" | "low";
  index: number;
  timestamp: number;
  value: number;
};

export type GannProjectionPoint = {
  index: number;
  timestamp: number;
  actual: number;
  projected: number;
  squareIndex: number;
};

export type RetracementFit = {
  startIndex: number;
  endIndex: number;
  startTimestamp: number;
  endTimestamp: number;
  startPrice: number;
  endPrice: number;
  direction: "up" | "down";
  r2: number;
  slope: number;
  intercept: number;
  step: number;
  points: GannProjectionPoint[];
};

export function findZigZagPivots(
  bars: RetracementBar[],
  deviationPct: number,
): RetracementPivot[] {
  if (bars.length < 8) return [];
  const deviation = Math.max(0.001, Number(deviationPct) / 100);
  const pivots: RetracementPivot[] = [];
  let trend: "up" | "down" | null = null;
  let extremeIndex = 0;
  let extremeValue = bars[0].close;

  for (let index = 1; index < bars.length; index += 1) {
    const high = bars[index].high;
    const low = bars[index].low;
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;

    if (trend === null) {
      if (high >= extremeValue * (1 + deviation)) {
        pivots.push(toPivot(bars, extremeIndex, "low"));
        trend = "up";
        extremeIndex = index;
        extremeValue = high;
      } else if (low <= extremeValue * (1 - deviation)) {
        pivots.push(toPivot(bars, extremeIndex, "high"));
        trend = "down";
        extremeIndex = index;
        extremeValue = low;
      } else if (high > extremeValue) {
        extremeIndex = index;
        extremeValue = high;
      } else if (low < extremeValue) {
        extremeIndex = index;
        extremeValue = low;
      }
      continue;
    }

    if (trend === "up") {
      if (high >= extremeValue) {
        extremeIndex = index;
        extremeValue = high;
      } else if (low <= extremeValue * (1 - deviation)) {
        pivots.push(toPivot(bars, extremeIndex, "high"));
        trend = "down";
        extremeIndex = index;
        extremeValue = low;
      }
    } else if (low <= extremeValue) {
      extremeIndex = index;
      extremeValue = low;
    } else if (high >= extremeValue * (1 + deviation)) {
      pivots.push(toPivot(bars, extremeIndex, "low"));
      trend = "up";
      extremeIndex = index;
      extremeValue = high;
    }
  }

  if (extremeIndex > (pivots.at(-1)?.index ?? -1)) {
    pivots.push(toPivot(bars, extremeIndex, trend === "up" ? "high" : "low"));
  }

  return pivots.filter((pivot, index) => index === 0 || pivot.index > pivots[index - 1].index);
}

export function findBestRetracementFits(
  bars: RetracementBar[],
  pivots: RetracementPivot[],
  step: number,
  loop = 18,
): RetracementFit[] {
  const safeStep = Math.max(Number(step) || 0, calculateAtr(bars, 14) * 0.2, 0.0001);
  const matrix = generateGannMatrix(0, safeStep, loop);
  const levels = matrix.flat().flatMap((value) => [value, -value]);
  const fits: RetracementFit[] = [];

  for (let segmentIndex = 0; segmentIndex < pivots.length - 1; segmentIndex += 1) {
    const segmentStart = pivots[segmentIndex];
    const segmentEnd = pivots[segmentIndex + 1];
    const segmentPivots = pivots.filter(
      (pivot) => pivot.index >= segmentStart.index && pivot.index <= segmentEnd.index,
    );
    // The start of a segment is allowed to be any earlier ZigZag pivot. This
    // lets the scoring choose a larger structural turn when it explains the
    // current leg better than the immediately previous pivot.
    const candidates = pivots.filter((pivot) => pivot.index <= segmentStart.index);
    let best: RetracementFit | null = null;

    for (const candidate of candidates) {
      const points = segmentPivots
        .filter((pivot) => pivot.index >= candidate.index)
        .map((pivot) => {
          const delta = pivot.value - candidate.value;
          const nearestOffset = nearestLevel(levels, delta, safeStep);
          const nearest = candidate.value + nearestOffset;
          return {
            index: pivot.index,
            timestamp: pivot.timestamp,
            actual: pivot.value,
            projected: nearest,
            squareIndex: Math.max(1, Math.round((nearest - candidate.value) / safeStep) + 1),
          };
        });
      if (points.length < 2) continue;

      const fit = linearFit(points.map((point) => point.projected), points.map((point) => point.actual));
      const result: RetracementFit = {
        startIndex: candidate.index,
        endIndex: segmentEnd.index,
        startTimestamp: candidate.timestamp,
        endTimestamp: segmentEnd.timestamp,
        startPrice: candidate.value,
        endPrice: segmentEnd.value,
        direction: segmentEnd.value >= candidate.value ? "up" : "down",
        r2: fit.r2,
        slope: fit.slope,
        intercept: fit.intercept,
        step: safeStep,
        points,
      };
      if (!best || result.r2 > best.r2) best = result;
    }

    if (best) fits.push(best);
  }

  return fits;
}

function toPivot(bars: RetracementBar[], index: number, kind: "high" | "low") {
  const bar = bars[index];
  return {
    kind,
    index,
    timestamp: bar.timestamp,
    value: kind === "high" ? bar.high : bar.low,
  } satisfies RetracementPivot;
}

function nearestLevel(levels: number[], target: number, step: number) {
  const nearest = levels.reduce((best, level) =>
    Math.abs(level - target) < Math.abs(best - target) ? level : best,
  );
  return Number.isFinite(nearest) ? nearest : target - (target % step);
}

function linearFit(x: number[], y: number[]) {
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  const denominator = x.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  const slope = denominator === 0
    ? 1
    : x.reduce((sum, value, index) => sum + (value - meanX) * (y[index] - meanY), 0) / denominator;
  const intercept = meanY - slope * meanX;
  const total = y.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
  const residual = y.reduce((sum, value, index) => sum + (value - (slope * x[index] + intercept)) ** 2, 0);
  return { slope, intercept, r2: total === 0 ? 1 : Math.max(0, 1 - residual / total) };
}

function calculateAtr(bars: RetracementBar[], period: number) {
  const ranges: number[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    ranges.push(Math.max(
      bars[index].high - bars[index].low,
      Math.abs(bars[index].high - bars[index - 1].close),
      Math.abs(bars[index].low - bars[index - 1].close),
    ));
  }
  const recent = ranges.slice(-period);
  return recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : 0;
}
