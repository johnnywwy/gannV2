export type BacktestIndicator = "NTP" | "LMACD" | "ORB";

export type BacktestBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type BacktestConfig = {
  indicator: BacktestIndicator;
  initialCapital: number;
  feeRate: number;
  slippage: number;
  tickSize: number;
};

export type BacktestTrade = {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  entrySignal: string;
  exitSignal: string;
  grossPnl: number;
  fees: number;
  netPnl: number;
  returnPct: number;
};

export type EquityPoint = {
  timestamp: number;
  equity: number;
};

export type BacktestStats = {
  startCapital: number;
  endCapital: number;
  totalReturnPct: number;
  annualizedReturnPct: number;
  maxDrawdownAmount: number;
  maxDrawdownPct: number;
  maxDrawdownDays: number;
  totalPnl: number;
};

export type AnnualBacktestStats = BacktestStats & {
  year: number;
  trades: number;
};

export type BacktestResult = {
  stats: BacktestStats;
  annualStats: AnnualBacktestStats[];
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
};

type TradeSignal = {
  index: number;
  side: "buy" | "sell";
  label: string;
};

type Position = {
  entryTime: number;
  entryPrice: number;
  quantity: number;
  entryFee: number;
  entrySignal: string;
};

type LmacdValue = {
  diff?: number;
  dea?: number;
  macd?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ORB_RANGE_MINUTES = 30;

export function runIndicatorBacktest(
  rawBars: BacktestBar[],
  config: BacktestConfig,
): BacktestResult {
  const bars = normalizeBars(rawBars);
  if (bars.length < 2) {
    return {
      stats: buildStats([], config.initialCapital, config.initialCapital),
      annualStats: [],
      trades: [],
      equityCurve: [],
    };
  }

  const signals = buildSignalMap(calculateTradeSignals(bars, config.indicator));
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  let cash = config.initialCapital;
  let position: Position | null = null;
  let pendingSignal: TradeSignal | null = null;

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];

    if (pendingSignal) {
      if (pendingSignal.side === "buy" && !position) {
        position = openPosition(bar, pendingSignal, cash, config);
        cash = 0;
      } else if (pendingSignal.side === "sell" && position) {
        const exit = closePosition(bar, pendingSignal, position, config);
        cash = exit.cashAfterExit;
        trades.push(exit.trade);
        position = null;
      }
      pendingSignal = null;
    }

    const equity = position
      ? position.quantity * bar.close
      : cash;
    equityCurve.push({ timestamp: bar.timestamp, equity });

    const barSignals = signals.get(index) ?? [];
    const actionableSignal = position
      ? barSignals.find((signal) => signal.side === "sell")
      : barSignals.find((signal) => signal.side === "buy");
    if (actionableSignal && index < bars.length - 1) {
      pendingSignal = actionableSignal;
    }
  }

  const lastBar = bars.at(-1);
  if (position && lastBar) {
    const forcedExit = closePosition(
      lastBar,
      { index: bars.length - 1, side: "sell", label: "期末平仓" },
      position,
      config,
      "close",
    );
    cash = forcedExit.cashAfterExit;
    trades.push(forcedExit.trade);
    equityCurve.push({ timestamp: lastBar.timestamp, equity: cash });
  }

  return {
    stats: buildStats(equityCurve, config.initialCapital, cash),
    annualStats: buildAnnualStats(equityCurve, trades, config.initialCapital),
    trades,
    equityCurve,
  };
}

function normalizeBars(rawBars: BacktestBar[]) {
  return rawBars
    .map((bar) => ({
      timestamp: Number(bar.timestamp),
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
      volume: Number(bar.volume ?? 0),
    }))
    .filter((bar) =>
      [bar.timestamp, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite),
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

function buildSignalMap(signals: TradeSignal[]) {
  const map = new Map<number, TradeSignal[]>();
  signals.forEach((signal) => {
    const list = map.get(signal.index) ?? [];
    list.push(signal);
    map.set(signal.index, list);
  });
  return map;
}

function calculateTradeSignals(
  bars: BacktestBar[],
  indicator: BacktestIndicator,
) {
  if (indicator === "NTP") return calculateNtpTradeSignals(bars);
  if (indicator === "LMACD") return calculateLmacdTradeSignals(bars);
  return calculateOrbTradeSignals(bars);
}

function openPosition(
  bar: BacktestBar,
  signal: TradeSignal,
  cash: number,
  config: BacktestConfig,
): Position {
  const entryPrice = roundPrice(bar.open + config.slippage, config.tickSize, "up");
  const quantity = cash / (entryPrice * (1 + config.feeRate));
  const entryFee = quantity * entryPrice * config.feeRate;

  return {
    entryTime: bar.timestamp,
    entryPrice,
    quantity,
    entryFee,
    entrySignal: signal.label,
  };
}

function closePosition(
  bar: BacktestBar,
  signal: TradeSignal,
  position: Position,
  config: BacktestConfig,
  source: "open" | "close" = "open",
) {
  const sourcePrice = source === "open" ? bar.open : bar.close;
  const exitPrice = roundPrice(sourcePrice - config.slippage, config.tickSize, "down");
  const proceeds = position.quantity * exitPrice;
  const exitFee = proceeds * config.feeRate;
  const entryValue = position.quantity * position.entryPrice;
  const grossPnl = proceeds - entryValue;
  const fees = position.entryFee + exitFee;
  const netPnl = grossPnl - fees;
  const cashAfterExit = proceeds - exitFee;
  const trade: BacktestTrade = {
    entryTime: position.entryTime,
    exitTime: bar.timestamp,
    entryPrice: position.entryPrice,
    exitPrice,
    quantity: position.quantity,
    entrySignal: position.entrySignal,
    exitSignal: signal.label,
    grossPnl,
    fees,
    netPnl,
    returnPct: netPnl / (entryValue + position.entryFee),
  };

  return { trade, cashAfterExit };
}

function calculateNtpTradeSignals(bars: BacktestBar[]): TradeSignal[] {
  const result: TradeSignal[] = [];
  let previousBuy1 = false;
  let previousBuy2 = false;
  let previousSell1 = false;
  let previousSell2 = false;

  for (let index = 0; index < bars.length; index += 1) {
    const buy1 = isContinuousCloseCompare(bars, index, 9, "lt");
    const buy2 = isContinuousCloseCompare(bars, index, 12, "lt");
    const sell1 = isContinuousCloseCompare(bars, index, 9, "gt");
    const sell2 = isContinuousCloseCompare(bars, index, 12, "gt");

    if (buy2 && !previousBuy2) {
      result.push({ index, side: "buy", label: "买2" });
    } else if (buy1 && !previousBuy1) {
      result.push({ index, side: "buy", label: "买1" });
    }

    if (sell2 && !previousSell2) {
      result.push({ index, side: "sell", label: "卖2" });
    } else if (sell1 && !previousSell1) {
      result.push({ index, side: "sell", label: "卖1" });
    }

    previousBuy1 = buy1;
    previousBuy2 = buy2;
    previousSell1 = sell1;
    previousSell2 = sell2;
  }

  return result;
}

function calculateLmacdTradeSignals(bars: BacktestBar[]): TradeSignal[] {
  const result: TradeSignal[] = [];
  const lmacdValues = calculateLmacdValues(bars);
  const pivotRadius = 3;
  let previousLowPivot: { price: number; diff: number } | null = null;
  let previousHighPivot: { price: number; diff: number } | null = null;

  for (let index = 1; index < bars.length; index += 1) {
    const previous = lmacdValues[index - 1];
    const current = lmacdValues[index];
    if (hasLmacdLines(previous) && hasLmacdLines(current)) {
      const crossedUp = previous.diff <= previous.dea && current.diff > current.dea;
      const crossedDown = previous.diff >= previous.dea && current.diff < current.dea;

      if (crossedUp && current.diff < 0 && current.dea < 0) {
        result.push({ index, side: "buy", label: "底部买入" });
      }

      if (crossedDown && current.diff > 0 && current.dea > 0) {
        result.push({ index, side: "sell", label: "顶部卖出" });
      }
    }

    const confirmedPivotIndex = index - pivotRadius;
    if (confirmedPivotIndex < pivotRadius) continue;
    const diff = Number(lmacdValues[confirmedPivotIndex]?.diff);
    if (!Number.isFinite(diff)) continue;

    if (isConfirmedPivotLow(bars, confirmedPivotIndex, index, pivotRadius)) {
      const price = bars[confirmedPivotIndex].low;
      if (
        previousLowPivot &&
        price < previousLowPivot.price &&
        diff > previousLowPivot.diff &&
        hasMeaningfulPriceMove(price, previousLowPivot.price)
      ) {
        result.push({ index, side: "buy", label: "底背离" });
      }
      previousLowPivot = { price, diff };
    }

    if (isConfirmedPivotHigh(bars, confirmedPivotIndex, index, pivotRadius)) {
      const price = bars[confirmedPivotIndex].high;
      if (
        previousHighPivot &&
        price > previousHighPivot.price &&
        diff < previousHighPivot.diff &&
        hasMeaningfulPriceMove(price, previousHighPivot.price)
      ) {
        result.push({ index, side: "sell", label: "顶背离" });
      }
      previousHighPivot = { price, diff };
    }
  }

  return result;
}

function calculateOrbTradeSignals(bars: BacktestBar[]): TradeSignal[] {
  const result: TradeSignal[] = [];
  const sessions = groupBarsBySession(bars);

  sessions.forEach((sessionBars) => {
    if (sessionBars.length < 2) return;
    const firstTimestamp = sessionBars[0].timestamp;
    const rangeEndTime = firstTimestamp + ORB_RANGE_MINUTES * 60 * 1000;
    const rangeBars = sessionBars.filter((bar) => bar.timestamp < rangeEndTime);
    if (rangeBars.length === 0 || rangeBars.length === sessionBars.length) return;

    const high = Math.max(...rangeBars.map((bar) => bar.high));
    const low = Math.min(...rangeBars.map((bar) => bar.low));
    let previousClose = rangeBars.at(-1)?.close ?? sessionBars[0].close;

    for (let index = rangeBars.length; index < sessionBars.length; index += 1) {
      const bar = sessionBars[index];
      const close = bar.close;
      if (previousClose <= high && close > high) {
        result.push({ index: bar.__index, side: "buy", label: "ORB买" });
      }
      if (previousClose >= low && close < low) {
        result.push({ index: bar.__index, side: "sell", label: "ORB卖" });
      }
      previousClose = close;
    }
  });

  return result.sort((a, b) => a.index - b.index);
}

function groupBarsBySession(bars: BacktestBar[]) {
  const sessions = new Map<string, Array<BacktestBar & { __index: number }>>();
  bars.forEach((bar, index) => {
    const key = new Date(bar.timestamp).toISOString().slice(0, 10);
    const list = sessions.get(key) ?? [];
    list.push({ ...bar, __index: index });
    sessions.set(key, list);
  });

  return Array.from(sessions.values()).map((sessionBars) =>
    sessionBars.sort((a, b) => a.timestamp - b.timestamp),
  );
}

function isContinuousCloseCompare(
  bars: BacktestBar[],
  index: number,
  count: number,
  direction: "lt" | "gt",
) {
  if (index - count - 3 < 0) return false;

  for (let offset = 0; offset < count; offset += 1) {
    const current = bars[index - offset]?.close;
    const reference = bars[index - offset - 4]?.close;
    if (!Number.isFinite(current) || !Number.isFinite(reference)) return false;
    if (direction === "lt" && current >= reference) return false;
    if (direction === "gt" && current <= reference) return false;
  }

  return true;
}

function calculateLmacdValues(
  bars: BacktestBar[],
  [shortPeriod, longPeriod, signalPeriod] = [12, 26, 9],
) {
  const maxPeriod = Math.max(shortPeriod, longPeriod);
  let closeSum = 0;
  let emaShort = 0;
  let emaLong = 0;
  let diff = 0;
  let diffSum = 0;
  let dea = 0;

  return bars.map((bar, index) => {
    const item: LmacdValue = {};
    const close = bar.close;
    closeSum += close;

    if (index >= shortPeriod - 1) {
      emaShort =
        index > shortPeriod - 1
          ? (2 * close + (shortPeriod - 1) * emaShort) / (shortPeriod + 1)
          : closeSum / shortPeriod;
    }

    if (index >= longPeriod - 1) {
      emaLong =
        index > longPeriod - 1
          ? (2 * close + (longPeriod - 1) * emaLong) / (longPeriod + 1)
          : closeSum / longPeriod;
    }

    if (index >= maxPeriod - 1) {
      diff = emaShort - emaLong;
      item.diff = diff;
      diffSum += diff;
      if (index >= maxPeriod + signalPeriod - 2) {
        dea =
          index > maxPeriod + signalPeriod - 2
            ? (diff * 2 + dea * (signalPeriod - 1)) / (signalPeriod + 1)
            : diffSum / signalPeriod;
        item.dea = dea;
        item.macd = (diff - dea) * 2;
      }
    }

    return item;
  });
}

function hasLmacdLines(
  value: LmacdValue | undefined,
): value is LmacdValue & { diff: number; dea: number } {
  return Number.isFinite(value?.diff) && Number.isFinite(value?.dea);
}

function isConfirmedPivotLow(
  bars: BacktestBar[],
  pivotIndex: number,
  currentIndex: number,
  radius: number,
) {
  const currentLow = bars[pivotIndex]?.low;
  if (!Number.isFinite(currentLow)) return false;

  for (let offset = -radius; offset <= radius; offset += 1) {
    if (offset === 0) continue;
    const compareIndex = pivotIndex + offset;
    if (compareIndex > currentIndex) return false;
    const low = bars[compareIndex]?.low;
    if (!Number.isFinite(low) || low <= currentLow) return false;
  }

  return true;
}

function isConfirmedPivotHigh(
  bars: BacktestBar[],
  pivotIndex: number,
  currentIndex: number,
  radius: number,
) {
  const currentHigh = bars[pivotIndex]?.high;
  if (!Number.isFinite(currentHigh)) return false;

  for (let offset = -radius; offset <= radius; offset += 1) {
    if (offset === 0) continue;
    const compareIndex = pivotIndex + offset;
    if (compareIndex > currentIndex) return false;
    const high = bars[compareIndex]?.high;
    if (!Number.isFinite(high) || high >= currentHigh) return false;
  }

  return true;
}

function hasMeaningfulPriceMove(current: number, previous: number) {
  const base = Math.max(Math.abs(previous), 1);
  return Math.abs(current - previous) / base >= 0.003;
}

function roundPrice(price: number, tickSize: number, direction: "up" | "down") {
  const tick = Math.max(Number(tickSize) || 0.01, 0.000001);
  const multiplier = direction === "up" ? Math.ceil(price / tick) : Math.floor(price / tick);
  return Number((multiplier * tick).toFixed(8));
}

function buildStats(
  equityCurve: EquityPoint[],
  startCapital: number,
  endCapital: number,
): BacktestStats {
  const drawdown = calculateDrawdown(equityCurve, startCapital);
  const totalReturnPct = endCapital / startCapital - 1;
  const firstTimestamp = equityCurve[0]?.timestamp;
  const lastTimestamp = equityCurve.at(-1)?.timestamp;
  const years =
    firstTimestamp && lastTimestamp
      ? Math.max((lastTimestamp - firstTimestamp) / (365.25 * DAY_MS), 1 / 365.25)
      : 1;
  const annualizedReturnPct =
    endCapital > 0 ? (endCapital / startCapital) ** (1 / years) - 1 : -1;

  return {
    startCapital,
    endCapital,
    totalReturnPct,
    annualizedReturnPct,
    maxDrawdownAmount: drawdown.amount,
    maxDrawdownPct: drawdown.percent,
    maxDrawdownDays: drawdown.days,
    totalPnl: endCapital - startCapital,
  };
}

function buildAnnualStats(
  equityCurve: EquityPoint[],
  trades: BacktestTrade[],
  initialCapital: number,
): AnnualBacktestStats[] {
  const grouped = new Map<number, EquityPoint[]>();
  equityCurve.forEach((point) => {
    const year = new Date(point.timestamp).getUTCFullYear();
    const list = grouped.get(year) ?? [];
    list.push(point);
    grouped.set(year, list);
  });

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, points], index, allYears) => {
      const previousYear = allYears[index - 1]?.[0];
      const previousPoints =
        previousYear === undefined ? undefined : grouped.get(previousYear);
      const startCapital = previousPoints?.at(-1)?.equity ?? initialCapital;
      const endCapital = points.at(-1)?.equity ?? startCapital;
      const stats = buildStats(points, startCapital, endCapital);
      return {
        year,
        trades: trades.filter(
          (trade) => new Date(trade.exitTime).getUTCFullYear() === year,
        ).length,
        ...stats,
      };
    });
}

function calculateDrawdown(equityCurve: EquityPoint[], fallbackPeak: number) {
  let peak = fallbackPeak;
  let peakTime = equityCurve[0]?.timestamp ?? 0;
  let maxAmount = 0;
  let maxPercent = 0;
  let maxDays = 0;

  equityCurve.forEach((point) => {
    if (point.equity > peak) {
      peak = point.equity;
      peakTime = point.timestamp;
    }

    const amount = Math.max(0, peak - point.equity);
    const percent = peak > 0 ? amount / peak : 0;
    if (amount > maxAmount) {
      maxAmount = amount;
      maxPercent = percent;
      maxDays = Math.ceil(Math.max(0, point.timestamp - peakTime) / DAY_MS);
    }
  });

  return { amount: maxAmount, percent: maxPercent, days: maxDays };
}
