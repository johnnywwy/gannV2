export type LmacdFormulaBar = {
  timestamp?: number | string;
  close?: number | string;
};

export type LmacdFormulaValue = {
  diff: number;
  dea: number;
  macd: number;
  bottomBuy: boolean;
  bottomDivergence: boolean;
  bottomAgainDivergence: boolean;
  bottomDisappear: boolean;
  topSell: boolean;
  topDivergence: boolean;
  topAgainDivergence: boolean;
  topDisappear: boolean;
};

export type LmacdFormulaSignalKind =
  | "bottomBuy"
  | "topSell"
  | "bullishDivergence"
  | "bearishDivergence"
  | "bottomDisappear"
  | "topDisappear";

export type LmacdFormulaSignal = {
  timestamp: number;
  value: number;
  text: string;
  kind: LmacdFormulaSignalKind;
};

function emaSeries(values: number[], period: number) {
  const alpha = 2 / (period + 1);
  const result = new Array<number>(values.length);

  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    result[index] = index === 0
      ? value
      : alpha * value + (1 - alpha) * result[index - 1];
  }

  return result;
}

function ref<T>(series: T[], index: number, offset = 1): T | undefined {
  const target = index - Math.max(0, Math.trunc(Number(offset)));
  return target >= 0 ? series[target] : undefined;
}

function countTrue(series: boolean[], index: number, count: number, offset = 0) {
  const end = index - offset;
  const start = Math.max(0, end - count + 1);
  let total = 0;

  for (let cursor = start; cursor <= end; cursor += 1) {
    if (series[cursor]) total += 1;
  }

  return total;
}

function barsLastSeries(conditions: boolean[]) {
  const result = new Array<number>(conditions.length);
  let lastTrue = -1;

  for (let index = 0; index < conditions.length; index += 1) {
    if (conditions[index]) lastTrue = index;
    result[index] = lastTrue >= 0 ? index - lastTrue : index;
  }

  return result;
}

function runningSegmentExtreme(
  values: number[],
  resetConditions: boolean[],
  mode: "min" | "max",
) {
  const result = new Array<number>(values.length);
  let extreme = Number.NaN;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (index === 0 || resetConditions[index] || !Number.isFinite(extreme)) {
      extreme = value;
    } else {
      extreme = mode === "min"
        ? Math.min(extreme, value)
        : Math.max(extreme, value);
    }
    result[index] = extreme;
  }

  return result;
}

export function calculateLmacdFormulaValues(
  bars: LmacdFormulaBar[],
  [shortPeriod = 12, longPeriod = 26, signalPeriod = 9]: number[] = [12, 26, 9],
): LmacdFormulaValue[] {
  const closes = bars.map((bar) => Number(bar.close));
  const emaShort = emaSeries(closes, shortPeriod);
  const emaLong = emaSeries(closes, longPeriod);
  const diff = closes.map((_, index) => emaShort[index] - emaLong[index]);
  const dea = emaSeries(diff, signalPeriod);
  const macd = diff.map((value, index) => (value - dea[index]) * 2);
  const positiveToNegative = macd.map(
    (value, index) => index > 0 && macd[index - 1] >= 0 && value < 0,
  );
  const negativeToPositive = macd.map(
    (value, index) => index > 0 && macd[index - 1] <= 0 && value > 0,
  );
  const n1 = barsLastSeries(positiveToNegative);
  const m1 = barsLastSeries(negativeToPositive);
  const cl1 = runningSegmentExtreme(closes, positiveToNegative, "min");
  const difl1 = runningSegmentExtreme(diff, positiveToNegative, "min");
  const ch1 = runningSegmentExtreme(closes, negativeToPositive, "max");
  const difh1 = runningSegmentExtreme(diff, negativeToPositive, "max");
  const cl2 = bars.map((_, index) => ref(cl1, index, m1[index] + 1) ?? Number.NaN);
  const cl3 = bars.map((_, index) => ref(cl2, index, m1[index] + 1) ?? Number.NaN);
  const difl2 = bars.map((_, index) => ref(difl1, index, m1[index] + 1) ?? Number.NaN);
  const difl3 = bars.map((_, index) => ref(difl2, index, m1[index] + 1) ?? Number.NaN);
  const ch2 = bars.map((_, index) => ref(ch1, index, n1[index] + 1) ?? Number.NaN);
  const ch3 = bars.map((_, index) => ref(ch2, index, n1[index] + 1) ?? Number.NaN);
  const difh2 = bars.map((_, index) => ref(difh1, index, n1[index] + 1) ?? Number.NaN);
  const difh3 = bars.map((_, index) => ref(difh2, index, n1[index] + 1) ?? Number.NaN);
  const directBottomDivergence = new Array<boolean>(bars.length).fill(false);
  const separatedBottomDivergence = new Array<boolean>(bars.length).fill(false);
  const bottomDivergence = new Array<boolean>(bars.length).fill(false);
  const firstBottomDivergence = new Array<boolean>(bars.length).fill(false);
  const bottomDivergenceDisappear = new Array<boolean>(bars.length).fill(false);
  const bottomStructure = new Array<boolean>(bars.length).fill(false);
  const bottomAgainDivergence = new Array<boolean>(bars.length).fill(false);
  const bottomBuy = new Array<boolean>(bars.length).fill(false);
  const bottomStructureDisappear = new Array<boolean>(bars.length).fill(false);
  const bottomStructureDisappearOnce = new Array<boolean>(bars.length).fill(false);
  const bottomDisappear = new Array<boolean>(bars.length).fill(false);
  const directTopDivergence = new Array<boolean>(bars.length).fill(false);
  const separatedTopDivergence = new Array<boolean>(bars.length).fill(false);
  const topDivergence = new Array<boolean>(bars.length).fill(false);
  const firstTopDivergence = new Array<boolean>(bars.length).fill(false);
  const topDivergenceDisappear = new Array<boolean>(bars.length).fill(false);
  const topStructure = new Array<boolean>(bars.length).fill(false);
  const topSell = new Array<boolean>(bars.length).fill(false);
  const topAgainDivergence = new Array<boolean>(bars.length).fill(false);
  const topStructureDisappear = new Array<boolean>(bars.length).fill(false);
  const topStructureDisappearOnce = new Array<boolean>(bars.length).fill(false);
  const topDisappear = new Array<boolean>(bars.length).fill(false);

  for (let index = 0; index < bars.length; index += 1) {
    const previousMacd = ref(macd, index) ?? Number.NaN;
    directBottomDivergence[index] =
      cl1[index] < cl2[index] && difl1[index] > difl2[index] &&
      previousMacd < 0 && diff[index] < 0;
    separatedBottomDivergence[index] =
      cl1[index] < cl3[index] && difl1[index] < difl2[index] &&
      difl1[index] > difl3[index] && previousMacd < 0 && diff[index] < 0;
    bottomDivergence[index] =
      (directBottomDivergence[index] || separatedBottomDivergence[index]) && diff[index] < 0;
    firstBottomDivergence[index] = !ref(bottomDivergence, index) && bottomDivergence[index];
    bottomDivergenceDisappear[index] =
      (Boolean(ref(directBottomDivergence, index)) &&
        difl1[index] <= difl2[index] && diff[index] < dea[index]) ||
      (Boolean(ref(separatedBottomDivergence, index)) &&
        difl1[index] <= difl3[index] && diff[index] < dea[index]);
    bottomStructure[index] = Boolean(ref(bottomDivergence, index)) &&
      Math.abs(ref(diff, index) ?? Number.NaN) >= Math.abs(diff[index]) * 1.01;
    bottomAgainDivergence[index] = Boolean(ref(bottomStructure, index)) &&
      firstBottomDivergence[index] &&
      Math.abs(ref(diff, index) ?? Number.NaN) * 1.01 <= Math.abs(diff[index]);
    bottomBuy[index] = !ref(bottomStructure, index) && bottomStructure[index];
    bottomStructureDisappear[index] =
      (closes[index] < cl2[index] || closes[index] < cl1[index]) &&
      (Boolean(ref(bottomStructure, index, m1[index] + 1)) ||
        Boolean(ref(bottomStructure, index, m1[index]))) &&
      !ref(firstBottomDivergence, index) && countTrue(bottomStructure, index, 24) >= 1;
    bottomStructureDisappearOnce[index] =
      countTrue(bottomStructureDisappear, index, 2, 1) < 1 && bottomStructureDisappear[index];
    bottomDisappear[index] =
      (bottomDivergenceDisappear[index] || bottomStructureDisappearOnce[index]) &&
      !bottomDivergence[index];

    directTopDivergence[index] =
      ch1[index] > ch2[index] && difh1[index] < difh2[index] &&
      previousMacd > 0 && diff[index] > 0;
    separatedTopDivergence[index] =
      ch1[index] > ch3[index] && difh1[index] > difh2[index] &&
      difh1[index] < difh3[index] && previousMacd > 0 && diff[index] > 0;
    topDivergence[index] =
      (directTopDivergence[index] || separatedTopDivergence[index]) && diff[index] > 0;
    firstTopDivergence[index] =
      !ref(topDivergence, index) && topDivergence[index] && diff[index] > dea[index];
    topDivergenceDisappear[index] =
      (Boolean(ref(directTopDivergence, index)) &&
        difh1[index] >= difh2[index] && diff[index] > dea[index]) ||
      (Boolean(ref(separatedTopDivergence, index)) &&
        difh1[index] >= difh3[index] && diff[index] > dea[index]);
    topStructure[index] = Boolean(ref(topDivergence, index)) &&
      (ref(diff, index) ?? Number.NaN) >= diff[index] * 1.01;
    topSell[index] = !ref(topStructure, index) && topStructure[index];
    topAgainDivergence[index] = Boolean(ref(topStructure, index)) &&
      firstTopDivergence[index] &&
      (ref(diff, index) ?? Number.NaN) * 1.01 <= diff[index];
    topStructureDisappear[index] =
      (closes[index] > ch2[index] || closes[index] > ch1[index]) &&
      (Boolean(ref(topStructure, index, n1[index] + 1)) ||
        Boolean(ref(topStructure, index, n1[index]))) &&
      !ref(firstTopDivergence, index) && countTrue(topStructure, index, 23) >= 1;
    topStructureDisappearOnce[index] =
      countTrue(topStructureDisappear, index, 2, 1) < 1 && topStructureDisappear[index];
    topDisappear[index] =
      (topDivergenceDisappear[index] || topStructureDisappearOnce[index]) &&
      !topDivergence[index];
  }

  return bars.map((_, index) => ({
    diff: diff[index],
    dea: dea[index],
    macd: macd[index],
    bottomBuy: bottomBuy[index],
    bottomDivergence: firstBottomDivergence[index],
    bottomAgainDivergence: bottomAgainDivergence[index],
    bottomDisappear: !ref(bottomDisappear, index) && bottomDisappear[index],
    topSell: topSell[index],
    topDivergence: firstTopDivergence[index],
    topAgainDivergence: topAgainDivergence[index],
    topDisappear: !ref(topDisappear, index) && topDisappear[index],
  }));
}

export function calculateLmacdFormulaSignals(
  bars: LmacdFormulaBar[],
): LmacdFormulaSignal[] {
  const values = calculateLmacdFormulaValues(bars);
  const result: LmacdFormulaSignal[] = [];

  values.forEach((item, index) => {
    const rawTimestamp = bars[index]?.timestamp;
    const timestamp = typeof rawTimestamp === "number"
      ? rawTimestamp
      : new Date(String(rawTimestamp ?? "")).getTime();
    if (!Number.isFinite(timestamp)) return;

    if (item.bottomBuy) {
      result.push({ timestamp, value: item.diff / 0.8, text: "底部买入", kind: "bottomBuy" });
    }
    if (item.bottomDivergence || item.bottomAgainDivergence) {
      result.push({ timestamp, value: item.diff / 0.85, text: "背离", kind: "bullishDivergence" });
    }
    if (item.bottomDisappear) {
      result.push({ timestamp, value: item.diff / 0.75, text: "消失", kind: "bottomDisappear" });
    }
    if (item.topSell) {
      result.push({ timestamp, value: item.diff * 1.2, text: "顶部卖出", kind: "topSell" });
    }
    if (item.topDivergence || item.topAgainDivergence) {
      result.push({ timestamp, value: item.diff * 1.15, text: "背离", kind: "bearishDivergence" });
    }
    if (item.topDisappear) {
      result.push({ timestamp, value: item.diff * 1.25, text: "消失", kind: "topDisappear" });
    }
  });

  return result;
}
