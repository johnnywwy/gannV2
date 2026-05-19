// src/utils/gannBacktest.js
// 单文件版本：九方图核心算法 + 日线数据读取 + 手动起算点回测

const CLASS_TABLE = [0, 0, 0, 1, 2, 3, 3, 4, 4];

/**
 * 读取 Vite public 目录下的 JSON。
 * 例如：
 * public/stockData/AVAV_US/AVAV_US.json
 *
 * 浏览器访问路径应该写：
 * /stockData/AVAV_US/AVAV_US.json
 */
export async function loadDailyBarsFromPublicJson(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`读取数据失败: ${res.status} ${res.statusText}`);
  }

  const raw = await res.json();
  return normalizeDailyBars(raw);
}

/**
 * 把你的 JSON 数组转成统一日线格式。
 *
 * 你的原始结构：
 * {
 *   close: "23.930",
 *   high: "26.220",
 *   low: "22.600",
 *   open: "25.000",
 *   timestamp: "2007-01-23T05:00:00+00:00",
 *   tradeSession: "Intraday",
 *   turnover: "0",
 *   volume: 6806621
 * }
 */
export function normalizeDailyBars(rawList) {
  if (!Array.isArray(rawList)) return [];

  return rawList
    .map((item) => {
      const date = formatDate(item.timestamp || item.date);
      const open = toNumber(item.open);
      const high = toNumber(item.high);
      const low = toNumber(item.low);
      const close = toNumber(item.close);
      const volume = toNumber(item.volume);

      if (!date) return null;
      if (![open, high, low, close].every(Number.isFinite)) return null;

      return {
        date,
        open,
        high,
        low,
        close,
        volume,
        raw: item,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function formatDate(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  // 你的 timestamp 是 2007-01-23T05:00:00+00:00
  // 这里直接取 UTC 日期。
  return d.toISOString().slice(0, 10);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 最方便入口：直接读取 public JSON 并回测。
 */
export async function runGannBacktestFromPublicJson(url, config) {
  const bars = await loadDailyBarsFromPublicJson(url);
  return backtestGannSupport(bars, config);
}

/**
 * 日线江恩支撑位反弹回测。
 *
 * 简化规则：
 * 1. 你手动指定 anchorDate + anchorPrice；
 * 2. 程序只从 anchorDate 之后开始测；
 * 3. 每天根据当天 close 找当前九方图位置；
 * 4. 取当前价下方最近几个江恩支撑；
 * 5. 如果当天 low 打到支撑附近，且 close 收回支撑上方，则下一交易日开盘买入；
 * 6. 后续按止盈 / 止损 / 最大持有天数退出。
 */
export function backtestGannSupport(bars, userConfig) {
  const config = normalizeBacktestConfig(userConfig);
  const sortedBars = [...bars].sort((a, b) => a.date.localeCompare(b.date));

  const startIndex = sortedBars.findIndex((bar) => bar.date > config.anchorDate);

  if (startIndex < 0) {
    return {
      config,
      trades: [],
      stats: buildStats([]),
      levelSnapshots: [],
    };
  }

  const trades = [];
  const levelSnapshots = [];

  // 避免同一段行情连续重复触发
  let nextAllowedIndex = startIndex;

  for (let i = startIndex; i < sortedBars.length - 1; i += 1) {
    if (i < nextAllowedIndex) continue;

    const bar = sortedBars[i];
    const nextBar = sortedBars[i + 1];
    if (!nextBar) break;

    const levels = getNearestSupportLevels(bar.close, config);

    if (config.keepLevelSnapshots) {
      levelSnapshots.push({
        date: bar.date,
        close: bar.close,
        levels,
      });
    }

    const touchedLevel = levels.find((level) => {
      const tolerancePrice = level.price * (1 + config.tolerancePct);

      // 支撑触发条件：
      // 1. 最低价打到支撑位 + 容忍误差范围；
      // 2. 收盘重新站上支撑位。
      return bar.low <= tolerancePrice && bar.close >= level.price;
    });

    if (!touchedLevel) continue;

    const trade = simulateLongTrade({
      bars: sortedBars,
      signalIndex: i,
      entryIndex: i + 1,
      level: touchedLevel,
      config,
    });

    if (!trade) continue;

    trades.push(trade);

    const exitIndex = sortedBars.findIndex((item) => item.date === trade.exitDate);
    nextAllowedIndex = exitIndex >= 0 ? exitIndex + 1 : i + trade.holdingDays + 1;
  }

  return {
    config,
    trades,
    stats: buildStats(trades),
    levelSnapshots,
  };
}

function normalizeBacktestConfig(userConfig = {}) {
  const config = {
    symbol: 'UNKNOWN',

    // 手动起算点
    anchorDate: '',
    anchorPrice: 1,

    // 九方图参数
    loop: 30,
    step: 1,
    trend: 'up',

    // 触发参数
    tolerancePct: 0.005,

    // 交易参数
    takeProfitPct: 0.06,
    stopLossPct: 0.03,
    maxHoldDays: 10,
    nearestLevelCount: 3,
    costPct: 0.001,

    // 调试用：是否保存每天候选支撑
    keepLevelSnapshots: false,

    ...userConfig,
  };

  if (!config.anchorDate) {
    throw new Error('缺少 anchorDate，例如：2007-01-23');
  }

  if (!Number.isFinite(Number(config.anchorPrice))) {
    throw new Error('anchorPrice 必须是数字');
  }

  config.anchorPrice = Number(config.anchorPrice);
  config.loop = Math.max(1, Math.trunc(Number(config.loop) || 30));
  config.step = Number(config.step) || 1;
  config.tolerancePct = Number(config.tolerancePct) || 0;
  config.takeProfitPct = Number(config.takeProfitPct) || 0;
  config.stopLossPct = Number(config.stopLossPct) || 0;
  config.maxHoldDays = Math.max(1, Math.trunc(Number(config.maxHoldDays) || 10));
  config.nearestLevelCount = Math.max(1, Math.trunc(Number(config.nearestLevelCount) || 3));
  config.costPct = Number(config.costPct) || 0;
  config.trend = config.trend === 'down' ? 'down' : 'up';

  return config;
}

/**
 * 根据当前价格，获取当前价格下方最近的几个江恩支撑位。
 */
export function getNearestSupportLevels(currentPrice, config) {
  const maxIndex = (config.loop * 2 + 1) ** 2;

  const clickedIndex = clamp(
    priceToNearestGannIndex(currentPrice, config.anchorPrice, config.step),
    1,
    maxIndex,
  );

  const matrix = generateGannMatrix(config.anchorPrice, config.step, config.loop);
  const clickedValue = indexToPrice(clickedIndex, config.anchorPrice, config.step);
  const pos = findNumberPosition(matrix, clickedValue);

  if (pos.r === -1 || pos.c === -1) return [];

  const trendResult = calculateClickTrend(matrix, pos.r, pos.c, config.trend, {
    base: config.anchorPrice,
    step: config.step,
    loop: config.loop,
  });

  const mainLevels = trendResult.mainLine.map((point) => ({
    price: point.value,
    lineType: 'mainLine',
    gannIndex: priceToNearestGannIndex(point.value, config.anchorPrice, config.step),
    sector: trendResult.sector,
    pointType: trendResult.type,
    distance: trendResult.distance,
  }));

  const crossLevels = trendResult.crossLine.map((point) => ({
    price: point.value,
    lineType: 'crossLine',
    gannIndex: priceToNearestGannIndex(point.value, config.anchorPrice, config.step),
    sector: trendResult.sector,
    pointType: trendResult.type,
    distance: trendResult.distance,
  }));

  return dedupeLevels([...mainLevels, ...crossLevels])
    .filter((level) => Number.isFinite(level.price))
    .filter((level) => level.price < currentPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, config.nearestLevelCount);
}

function dedupeLevels(levels) {
  const seen = new Set();

  return levels.filter((level) => {
    const key = `${roundPrice(level.price)}:${level.lineType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function priceToNearestGannIndex(price, anchorPrice, step) {
  const index = Math.round((Number(price) - Number(anchorPrice)) / Number(step)) + 1;
  return Math.max(1, index);
}

function indexToPrice(index, anchorPrice, step) {
  return roundPrice(Number(anchorPrice) + (Number(index) - 1) * Number(step));
}

function roundPrice(value) {
  return Number(Number(value).toFixed(8));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function simulateLongTrade(params) {
  const { bars, signalIndex, entryIndex, level, config } = params;
  const signalBar = bars[signalIndex];
  const entryBar = bars[entryIndex];

  if (!entryBar) return null;

  // 简化版：触发后的下一根日线开盘买入
  const entryPrice = entryBar.open;

  const takeProfitPrice = entryPrice * (1 + config.takeProfitPct);
  const stopLossPrice = entryPrice * (1 - config.stopLossPct);

  let exitDate = entryBar.date;
  let exitPrice = entryPrice;
  let exitReason = 'timeout';
  let holdingDays = 0;

  let highestHigh = entryPrice;
  let lowestLow = entryPrice;

  const maxExitIndex = Math.min(bars.length - 1, entryIndex + config.maxHoldDays - 1);

  for (let i = entryIndex; i <= maxExitIndex; i += 1) {
    const bar = bars[i];
    holdingDays = i - entryIndex + 1;

    highestHigh = Math.max(highestHigh, bar.high);
    lowestLow = Math.min(lowestLow, bar.low);

    const hitStopLoss = bar.low <= stopLossPrice;
    const hitTakeProfit = bar.high >= takeProfitPrice;

    // 日线不知道当天先后顺序，所以保守处理：
    // 同一天既止盈又止损，按止损算。
    if (hitStopLoss) {
      exitDate = bar.date;
      exitPrice = stopLossPrice;
      exitReason = 'stopLoss';
      break;
    }

    if (hitTakeProfit) {
      exitDate = bar.date;
      exitPrice = takeProfitPrice;
      exitReason = 'takeProfit';
      break;
    }

    if (i === maxExitIndex) {
      exitDate = bar.date;
      exitPrice = bar.close;
      exitReason = 'timeout';
      break;
    }
  }

  const rawReturn = exitPrice / entryPrice - 1;
  const returnPct = rawReturn - config.costPct;

  const mfePct = highestHigh / entryPrice - 1;
  const maePct = lowestLow / entryPrice - 1;

  return {
    symbol: config.symbol,
    anchorDate: config.anchorDate,
    anchorPrice: config.anchorPrice,

    signalDate: signalBar.date,
    signalClose: signalBar.close,
    signalLow: signalBar.low,

    level: level.price,
    lineType: level.lineType,
    gannIndex: level.gannIndex,
    sector: level.sector,
    pointType: level.pointType,
    distance: level.distance,

    entryDate: entryBar.date,
    entryPrice: roundPrice(entryPrice),

    stopLossPrice: roundPrice(stopLossPrice),
    takeProfitPrice: roundPrice(takeProfitPrice),

    exitDate,
    exitPrice: roundPrice(exitPrice),
    exitReason,

    holdingDays,

    returnPct,
    returnPctText: toPctText(returnPct),

    mfePct,
    mfePctText: toPctText(mfePct),

    maePct,
    maePctText: toPctText(maePct),
  };
}

function buildStats(trades) {
  const totalTrades = trades.length;

  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      winRateText: '0.00%',
      avgReturn: 0,
      avgReturnText: '0.00%',
      medianReturn: 0,
      medianReturnText: '0.00%',
      avgWin: 0,
      avgWinText: '0.00%',
      avgLoss: 0,
      avgLossText: '0.00%',
      expectancy: 0,
      expectancyText: '0.00%',
      profitFactor: 0,
      maxDrawdown: 0,
      maxDrawdownText: '0.00%',
      avgHoldingDays: 0,
      exitReasonCount: {},
      lineTypeStats: {},
    };
  }

  const returns = trades.map((trade) => trade.returnPct);
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r <= 0);

  const winRate = wins.length / totalTrades;
  const avgReturn = average(returns);
  const medianReturn = median(returns);
  const avgWin = wins.length ? average(wins) : 0;

  const avgLossRaw = losses.length ? average(losses) : 0;
  const avgLoss = Math.abs(avgLossRaw);

  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

  const grossProfit = wins.reduce((sum, r) => sum + r, 0);
  const grossLoss = Math.abs(losses.reduce((sum, r) => sum + r, 0));
  const profitFactor = grossLoss === 0 ? Infinity : grossProfit / grossLoss;

  const maxDrawdown = calcMaxDrawdown(returns);
  const avgHoldingDays = average(trades.map((trade) => trade.holdingDays));

  return {
    totalTrades,

    winRate,
    winRateText: toPctText(winRate),

    avgReturn,
    avgReturnText: toPctText(avgReturn),

    medianReturn,
    medianReturnText: toPctText(medianReturn),

    avgWin,
    avgWinText: toPctText(avgWin),

    avgLoss,
    avgLossText: toPctText(avgLoss),

    expectancy,
    expectancyText: toPctText(expectancy),

    profitFactor,

    maxDrawdown,
    maxDrawdownText: toPctText(maxDrawdown),

    avgHoldingDays,

    exitReasonCount: countBy(trades, 'exitReason'),
    lineTypeStats: buildGroupStats(trades, 'lineType'),
  };
}

function buildGroupStats(trades, key) {
  const groups = {};

  for (const trade of trades) {
    const groupKey = trade[key] || 'UNKNOWN';
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(trade);
  }

  const result = {};

  for (const [groupKey, list] of Object.entries(groups)) {
    result[groupKey] = buildStatsLite(list);
  }

  return result;
}

function buildStatsLite(trades) {
  const returns = trades.map((trade) => trade.returnPct);
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r <= 0);

  const grossProfit = wins.reduce((sum, r) => sum + r, 0);
  const grossLoss = Math.abs(losses.reduce((sum, r) => sum + r, 0));

  return {
    totalTrades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    winRateText: trades.length ? toPctText(wins.length / trades.length) : '0.00%',
    avgReturn: average(returns),
    avgReturnText: toPctText(average(returns)),
    profitFactor: grossLoss === 0 ? Infinity : grossProfit / grossLoss,
  };
}

function countBy(list, key) {
  return list.reduce((acc, item) => {
    const value = item[key] || 'UNKNOWN';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[mid];

  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function calcMaxDrawdown(returns) {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;

  for (const r of returns) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);

    const drawdown = equity / peak - 1;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
  }

  return maxDrawdown;
}

function toPctText(value) {
  if (!Number.isFinite(value)) return String(value);
  return `${(value * 100).toFixed(2)}%`;
}

// ============================================================================
// 九方图核心算法：从你之前 React/TS 版本拆出来的纯 JS 版本
// ============================================================================

export function generateGannMatrix(base = 1, step = 1, loop = 9) {
  const radius = Math.max(1, Number(loop) || 1);
  const size = radius * 2 + 1;
  const max = size * size;
  const { numToPos } = buildGannSpiral(max);
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));

  for (let n = 1; n <= max; n += 1) {
    const pos = numToPos.get(n);
    if (pos) {
      matrix[pos.row + radius][pos.col + radius] = indexToPrice(n, base, step);
    }
  }

  return matrix;
}

export function findNumberPosition(matrix, target) {
  const value = roundPrice(Number(target));
  if (!Number.isFinite(value)) return { r: -1, c: -1 };

  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix[r].length; c += 1) {
      if (roundPrice(Number(matrix[r][c])) === value) {
        return { r, c };
      }
    }
  }

  return { r: -1, c: -1 };
}

export function calculateClickTrend(matrix, r, c, trendDirection, options = {}) {
  const clickedValue = matrix[r]?.[c] ?? 1;
  const base = Number(options.base ?? 1);
  const step = Number(options.step ?? 1);
  const loop = Math.max(1, Number(options.loop ?? Math.floor(matrix.length / 2)) || 1);

  const rawIndex = step === 0 ? clickedValue : (clickedValue - base) / step + 1;
  const clickedIndex = Math.round(rawIndex);

  const highlight = calcHighlights(clickedIndex, trendDirection, loop);
  const toValue = (n) => indexToPrice(n, base, step);

  const mainValues = highlight.mainHighlight.map(toValue);
  const crossValues = highlight.subHighlight.map(toValue);

  const mainLine = valuesToPoints(matrix, mainValues);
  const crossLine = valuesToPoints(matrix, crossValues);

  return {
    clickedValue,
    clickedIndex,
    trend: trendDirection,
    point: highlight.point,
    absPoint: highlight.absPoint,
    type: highlight.type,
    sector: highlight.sector,
    distance: highlight.distance,
    mainLine,
    crossLine,
    trendCells: [...mainLine, ...crossLine],
  };
}

function valuesToPoints(matrix, values) {
  const index = new Map();

  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix[r].length; c += 1) {
      index.set(roundPrice(Number(matrix[r][c])), {
        r,
        c,
        value: matrix[r][c],
      });
    }
  }

  return dedupe(values.map(roundPrice))
    .map((value) => index.get(roundPrice(Number(value))))
    .filter(Boolean);
}

export function buildGannSpiral(max) {
  const numToPos = new Map();
  const posToNum = new Map();

  let row = 0;
  let col = 0;
  let n = 1;

  setPoint(n, row, col);

  // 你的规则：
  // 1 在中心；
  // 2 在 1 的左边；
  // 然后左、上、右、下螺旋扩展。
  const dirs = [
    [0, -1],
    [-1, 0],
    [0, 1],
    [1, 0],
  ];

  let stepLen = 1;
  let dirIndex = 0;

  while (n < max) {
    for (let repeat = 0; repeat < 2 && n < max; repeat += 1) {
      const [dr, dc] = dirs[dirIndex % 4];

      for (let i = 0; i < stepLen && n < max; i += 1) {
        row += dr;
        col += dc;
        n += 1;
        setPoint(n, row, col);
      }

      dirIndex += 1;
    }

    stepLen += 1;
  }

  function setPoint(value, pointRow, pointCol) {
    numToPos.set(value, { row: pointRow, col: pointCol });
    posToNum.set(`${pointRow},${pointCol}`, value);
  }

  return {
    numToPos,
    posToNum,
  };
}

export function calcHighlights(clickedValue, trend, gridRadius) {
  const maxNumber = (gridRadius * 2 + 1) ** 2;
  const { numToPos, posToNum } = buildGannSpiral(maxNumber);
  const point = numToPos.get(clickedValue);

  const gridSize = gridRadius * 2 + 1;
  const center = Math.floor(gridSize / 2);

  if (!point) {
    return {
      clickedValue,
      trend,
      gridRadius,
      maxNumber,
      mainHighlight: [],
      subHighlight: [],
      numToPos,
      posToNum,
    };
  }

  const absPoint = relToAbs(point, center);
  const sector = getSector(absPoint, gridSize);
  const type = getPointType(point);
  const distance = getAxisDistance(absPoint, center, sector);
  const trendMode = trend === 'up' ? 1 : 0;

  const ctx = {
    clickedValue,
    trend,
    trendMode,
    gridRadius,
    maxNumber,
    gridSize,
    center,
    posToNum,
    line1: [],
    line2: [],
    distance,
  };

  if (type === 2) {
    renderType2(ctx, absPoint, sector, trendMode);
  } else {
    renderDiagonal(ctx, absPoint, sector, trendMode);
  }

  return {
    clickedValue,
    trend,
    point,
    absPoint,
    type,
    sector,
    distance,
    trendMode,
    gridRadius,
    maxNumber,
    gridSize,
    center,
    mainHighlight: dedupe(ctx.line1),
    subHighlight: normalizeSegment(dedupe(ctx.line2), point, trend),
    numToPos,
    posToNum,
  };
}

function getValue(posToNum, row, col) {
  return posToNum.get(`${row},${col}`);
}

function trunc(n) {
  return n < 0 ? Math.ceil(n) : Math.floor(n);
}

function dedupe(values) {
  const seen = new Set();

  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function ptInRect(rect, p) {
  return p.x >= rect.left && p.x < rect.right && p.y >= rect.top && p.y < rect.bottom;
}

function calcY(line, x) {
  return trunc(x * line.k + line.b);
}

function classifyPointByLine(line, p) {
  const diff = trunc(p.x * line.k + line.b - p.y);

  if (diff === 0) return 0;

  return diff >= 0 ? 2 : 1;
}

function relToAbs(point, center) {
  return {
    x: point.col + center,
    y: point.row + center,
  };
}

function absToRel(x, y, center) {
  return {
    row: y - center,
    col: x - center,
  };
}

function absValue(ctx, x, y) {
  const rel = absToRel(x, y, ctx.center);
  return getValue(ctx.posToNum, rel.row, rel.col);
}

function getPointType(point) {
  const x = point.col;
  const y = point.row;

  if (x === 0 || y === 0) return 2;

  const dx = Math.abs(x);
  const dy = Math.abs(y);

  if (x < 0 && y > 0 && ((dx === 3 && dy === 5) || (dx === 4 && dy === 7))) {
    return 1;
  }

  const limit = dx > 8 ? dx - 4 : CLASS_TABLE[dx];

  if (dy <= limit) return 2;
  if (dy < 9) return dx <= CLASS_TABLE[dy] ? 2 : 1;

  return dx <= dy - 4 ? 2 : 1;
}

function getSector(absPoint, gridSize) {
  const x = absPoint.x;
  const y = absPoint.y;

  const rect = {
    left: x * 2,
    top: y * 2,
    right: x * 2 + 2,
    bottom: y * 2 + 2,
  };

  const testPoint = {
    x: x * 2 + 1,
    y: y * 2 + 1,
  };

  const lineC0 = {
    k: -1,
    b: gridSize * 2,
  };

  const lineD0 = {
    k: 1,
    b: 0,
  };

  if (ptInRect(rect, { x: testPoint.x, y: calcY(lineC0, testPoint.x) })) return 7;
  if (ptInRect(rect, { x: testPoint.x, y: calcY(lineD0, testPoint.x) })) return 6;

  const signC0 = classifyPointByLine(lineC0, testPoint);
  const signD0 = classifyPointByLine(lineD0, testPoint);

  if (signC0 === 2) return signD0 !== 1 ? 2 : 1;

  return signD0 !== 2 ? 4 : 3;
}

function getAxisDistance(absPoint, center, sector) {
  const dx = Math.abs(absPoint.x - center);
  const dy = Math.abs(absPoint.y - center);

  if ([1, 3, 6, 7].includes(sector)) return dx;
  if ([2, 4].includes(sector)) return dy;

  return 0;
}

function getMajorMinor(absPoint, center) {
  const dx = Math.abs(absPoint.x - center);
  const dy = Math.abs(absPoint.y - center);

  return {
    major: Math.max(dx, dy),
    minor: Math.min(dx, dy),
  };
}

function record(ctx, x, y, segment) {
  const value = absValue(ctx, x, y);

  if (!value) return false;

  if (value === ctx.clickedValue) return true;

  if (segment === 'line1') ctx.line1.push(value);
  if (segment === 'line2') ctx.line2.push(value);

  return true;
}

function normalizeSegment(values, point, trend) {
  if (trend === 'down' && point.row < 0) return values.slice().reverse();
  return values.slice();
}

function renderType2(ctx, absPoint, sector, trendMode) {
  const up = trendMode === 1;

  let x = absPoint.x;
  let y = absPoint.y;

  const d = ctx.distance;
  const c = ctx.center;
  const N = ctx.gridSize;

  switch (sector) {
    case 1: {
      const origY = y;
      const targetX = x + d;

      record(ctx, x, y, 'current');

      if (up) {
        for (let i = 0; i < d * 2; i += 1) {
          record(ctx, ++x, y, 'line1');
        }

        y = origY - 1;
        x = targetX;

        for (let i = 0, count = origY - c + d; i < count && y >= 0; i += 1, y -= 1) {
          record(ctx, x, y, 'line2');
        }
      } else {
        for (let i = 0; i < Math.max(0, d * 2 - 1); i += 1) {
          record(ctx, ++x, y, 'line1');
        }

        y = origY + 1;
        x = targetX;

        for (let i = 0, count = c - origY - 1 + d; i < count && y <= N; i += 1, y += 1) {
          record(ctx, x, y, 'line2');
        }
      }

      break;
    }

    case 2: {
      const origX = x;
      const targetY = y + d;

      record(ctx, x, y, 'current');

      if (up) {
        for (let i = 0; i < d * 2; i += 1) {
          record(ctx, x, ++y, 'line1');
        }

        x = origX;
        y = targetY;

        for (let i = 0, count = d - origX + 1 + c; i < count && x < N; i += 1, x += 1) {
          record(ctx, x, y, 'line2');
        }
      } else {
        for (let i = 0; i < Math.max(0, d * 2 - 1); i += 1) {
          record(ctx, x, ++y, 'line1');
        }

        x = origX;
        y = targetY;

        for (let i = 0, count = origX - c + 1 + d; i < count; i += 1, x -= 1) {
          record(ctx, x, y, 'line2');
        }
      }

      break;
    }

    case 3: {
      const targetX = x - d;
      const origY = y;

      record(ctx, x, y, 'current');

      if (up) {
        for (let i = 0; i < d * 2 + 1; i += 1) {
          x -= 1;
          if (x < 0) break;
          record(ctx, x, y, 'line1');
        }

        x = targetX;
        y = origY;

        for (let i = 0, count = c - origY + 1 + d; i < count; i += 1, y += 1) {
          record(ctx, x, y, 'line2');
        }
      } else {
        for (let i = 0; i < d * 2; i += 1) {
          record(ctx, --x, y, 'line1');
        }

        x = targetX;
        y = origY;

        for (let i = 0, count = origY - c + 1 + d; i < count; i += 1, y -= 1) {
          record(ctx, x, y, 'line2');
        }
      }

      break;
    }

    case 4: {
      const targetY = y - d;
      const origX = x;

      record(ctx, x, y, 'current');

      if (up) {
        for (let i = 0; i < d * 2 + 1; i += 1) {
          y -= 1;
          if (y < 0) break;
          record(ctx, x, y, 'line1');
        }

        y = targetY;
        x = origX - 1;

        for (let i = 0, count = origX - c + 1 + d; i < count && x >= 0; i += 1, x -= 1) {
          record(ctx, x, y, 'line2');
        }
      } else {
        for (let i = 0; i < d * 2; i += 1) {
          record(ctx, x, --y, 'line1');
        }

        x = origX + 1;
        y = targetY;

        for (let i = 0, count = c + d - origX; i < count && x <= N; i += 1, x += 1) {
          record(ctx, x, y, 'line2');
        }
      }

      break;
    }

    default:
      record(ctx, x, y, 'current');
  }
}

function renderDiagLabel14614(ctx, absPoint, sector, trendMode, major, minor) {
  const up = trendMode === 1;

  let { x, y } = absPoint;
  let d = ctx.distance;

  const c = ctx.center;
  const N = ctx.gridSize;

  record(ctx, x, y, 'current');

  if (up) {
    for (let i = 0, count = major + minor + (sector !== 1 ? 1 : 0); i < count; i += 1) {
      x += 1;
      y -= 1;

      if (N <= x || y < 0) break;

      record(ctx, x, y, 'line1');
    }

    x = c;
    y = c;

    if (sector === 4) {
      const diff = major - minor;
      x = c + diff;
      y = c + diff;
      d += diff + 1;
    } else if (sector !== 1) {
      d += 1;
    }

    for (let i = 0; i < d; i += 1) {
      record(ctx, --x, --y, 'line2');
    }
  } else {
    for (let i = 0, count = major - 1 + minor + (sector !== 1 ? 1 : 0); i < count; i += 1) {
      x += 1;
      y -= 1;
      record(ctx, x, y, 'line1');
    }

    x = c;
    y = c;

    if (sector === 1) {
      const diff = major - minor;
      x = c - diff;
      y = c - diff;
      d += diff - 1;
    }

    for (let i = 0; i < d; i += 1) {
      record(ctx, ++x, ++y, 'line2');
    }
  }
}

function renderDiagLabel14ba7(ctx, absPoint, sector, trendMode, major, minor) {
  const up = trendMode === 1;

  let { x, y } = absPoint;
  let d = ctx.distance;

  const c = ctx.center;

  record(ctx, x, y, 'current');

  for (let i = 0, count = up ? major + 1 + minor : major + minor; i < count; i += 1) {
    record(ctx, --x, --y, 'line1');
  }

  x = c;
  y = c;

  if (up && sector === 3) {
    const diff = major - minor;
    x = c + diff;
    y = c - diff;
    d += diff;
  }

  if (!up && sector === 4) {
    const diff = major - minor;
    x = c - diff;
    y = c + diff;
    d += diff;
  }

  for (let i = 0; i < d; i += 1) {
    if (up) {
      record(ctx, --x, ++y, 'line2');
    } else {
      record(ctx, ++x, --y, 'line2');
    }
  }
}

function renderDiagLabel149e7(ctx, absPoint, sector, trendMode, major, minor) {
  const up = trendMode === 1;

  let { x, y } = absPoint;
  let d = ctx.distance;

  const c = ctx.center;

  record(ctx, x, y, 'current');

  for (
    let i = 0, count = (up ? major + minor : major - 1 + minor) + (sector === 2 ? 1 : 0);
    i < count;
    i += 1
  ) {
    record(ctx, --x, ++y, 'line1');
  }

  x = c;
  y = c;

  if (up && sector === 2) {
    const diff = major - minor;
    x = c - diff;
    y = c - diff;
    d += diff;
  }

  if (!up && sector === 3) {
    const diff = major - minor;
    x = c + diff;
    y = c + diff;
    d += diff;
  }

  for (let i = 0; i < d; i += 1) {
    if (up) {
      record(ctx, ++x, ++y, 'line2');
    } else {
      record(ctx, --x, --y, 'line2');
    }
  }
}

function renderDiagLabel14821(ctx, absPoint, sector, trendMode, major, minor) {
  const up = trendMode === 1;

  let { x, y } = absPoint;
  let d = ctx.distance;

  const c = ctx.center;

  record(ctx, x, y, 'current');

  for (let i = 0, count = up ? major + minor : major - 1 + minor; i < count; i += 1) {
    record(ctx, ++x, ++y, 'line1');
  }

  x = c;
  y = c;

  if (up && sector === 1) {
    const diff = major - minor;
    x = c - diff;
    y = c + diff;
    d += diff;

    for (let i = 0; i < d; i += 1) {
      record(ctx, ++x, --y, 'line2');
    }

    return;
  }

  if (!up && sector === 2) {
    const diff = major - minor;
    x = c + diff;
    y = c - diff;
    d += diff;
  }

  if (!up) {
    while ((d -= 1) !== 0) {
      record(ctx, --x, ++y, 'line2');
    }

    return;
  }

  for (let i = 0; i < d; i += 1) {
    record(ctx, ++x, --y, 'line2');
  }
}

function renderDiagonal(ctx, absPoint, sector, trendMode) {
  const { major, minor } = getMajorMinor(absPoint, ctx.center);
  const { x, y } = absPoint;
  const c = ctx.center;

  if (sector === 1) {
    if (c < y) {
      return renderDiagLabel14614(ctx, absPoint, sector, trendMode, major, minor);
    }

    if (y < c) {
      return renderDiagLabel14821(ctx, absPoint, sector, trendMode, major, minor);
    }
  }

  if (sector === 4) {
    if (x < c) {
      return renderDiagLabel14614(ctx, absPoint, sector, trendMode, major, minor);
    }

    if (c < x) {
      return renderDiagLabel14ba7(ctx, absPoint, sector, trendMode, major, minor);
    }
  }

  if (sector === 7) {
    if (x < c) {
      return renderDiagLabel14614(ctx, absPoint, sector, trendMode, major, minor);
    }

    if (c < x) {
      return renderDiagLabel149e7(ctx, absPoint, sector, trendMode, major, minor);
    }
  }

  if (sector === 2) {
    if (c <= x) {
      return renderDiagLabel149e7(ctx, absPoint, sector, trendMode, major, minor);
    }

    return renderDiagLabel14821(ctx, absPoint, sector, trendMode, major, minor);
  }

  if (sector === 6) {
    if (x < c) {
      return renderDiagLabel14821(ctx, absPoint, sector, trendMode, major, minor);
    }

    if (c < x) {
      return renderDiagLabel14ba7(ctx, absPoint, sector, trendMode, major, minor);
    }
  }

  if (sector === 3) {
    if (c <= y) {
      return renderDiagLabel14ba7(ctx, absPoint, sector, trendMode, major, minor);
    }

    return renderDiagLabel149e7(ctx, absPoint, sector, trendMode, major, minor);
  }

  return undefined;
}

// ============================================================================
// 使用示例
// ============================================================================

/**
 * 你可以在浏览器控制台或者页面按钮里调用这个函数。
 *
 * 注意：
 * Vite public 目录的访问路径不是 public/xxx，而是 /xxx。
 */
export async function demoRunAVAV() {
  const result = await runGannBacktestFromPublicJson('/stockData/AVAV_US/AVAV_US.json', {
    symbol: 'AVAV.US',

    // 改成你手动观察后确认的起算点
    anchorDate: '2007-01-23',
    anchorPrice: 22.6,

    // 九方图参数
    loop: 40,
    step: 0.5,
    trend: 'up',

    // 触发条件：最低价接近支撑 0.5%，且收盘重新站上支撑
    tolerancePct: 0.005,

    // 交易规则
    takeProfitPct: 0.08,
    stopLossPct: 0.04,
    maxHoldDays: 15,
    nearestLevelCount: 3,
    costPct: 0.001,

    keepLevelSnapshots: false,
  });

  console.log('江恩回测统计:', result.stats);
  console.table(result.trades);

  return result;
}

// 临时挂到 window 上，方便你在浏览器控制台直接调用。
if (typeof window !== 'undefined') {
  window.demoRunAVAV = demoRunAVAV;
  window.runGannBacktestFromPublicJson = runGannBacktestFromPublicJson;
  window.backtestGannSupport = backtestGannSupport;
}