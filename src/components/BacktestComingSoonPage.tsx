import { ExperimentOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Cascader,
  Empty,
  Form,
  InputNumber,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import * as echarts from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  runIndicatorBacktest,
  type AnnualBacktestStats,
  type BacktestBar,
  type BacktestIndicator,
  type BacktestResult,
  type BacktestTrade,
} from "../utils/indicatorBacktest";

type PeriodOption = {
  label: string;
  value: string;
};

type BacktestFormValues = {
  symbols: string[][];
  period: string;
  indicator: BacktestIndicator;
  initialCapital: number;
  feeRate: number;
  slippage: number;
  tickSize: number;
};

type MarketApiBar = {
  timestamp?: string;
  time?: string;
  open?: string | number;
  high?: string | number;
  low?: string | number;
  close?: string | number;
  volume?: string | number;
};

type ChartPoint = {
  timestamp: number;
  value: number;
};

type HistogramBin = {
  label: string;
  value: number;
};

type BacktestChartData = {
  equity: ChartPoint[];
  drawdown: ChartPoint[];
  pnl: ChartPoint[];
  distribution: HistogramBin[];
};

type WatchSymbol = {
  ticker: string;
  name: string;
  market: string;
  category: string;
  nameCn?: string;
  nameHk?: string;
  nameEn?: string;
};

type PortfolioBacktestTrade = BacktestTrade & {
  symbol: string;
};

type PortfolioBacktestResult = Omit<BacktestResult, "trades"> & {
  trades: PortfolioBacktestTrade[];
};

const API_BASE = "https://n1-longbridge.johnnywwy.com/api";
const STOCKS_API_URL = `${API_BASE}/stocks`;
const MARKET_API_BASE = `${API_BASE}/kline`;
const BACKTEST_BAR_COUNT = 12_000;
const visibleStockCategoryValues = new Set(["us", "cn", "hk"]);
const stockCategoryOptions = [
  { label: "美股", value: "us" },
  { label: "A股", value: "cn" },
  { label: "港股", value: "hk" },
];
const periodOptions: PeriodOption[] = [
  { label: "1分", value: "1m" },
  { label: "3分", value: "3m" },
  { label: "5分", value: "5m" },
  { label: "15分", value: "15m" },
  { label: "1小时", value: "1h" },
  { label: "3小时", value: "3h" },
  { label: "4小时", value: "4h" },
  { label: "日", value: "day" },
  { label: "周", value: "week" },
  { label: "月", value: "month" },
  { label: "季", value: "quarter" },
  { label: "年", value: "year" },
];

const defaultValues: BacktestFormValues = {
  symbols: [["us", "TSLA.US"]],
  period: "day",
  indicator: "NTP",
  initialCapital: 10000,
  feeRate: 0.00025,
  slippage: 0.2,
  tickSize: 0.01,
};

function BacktestComingSoonPage() {
  const [form] = Form.useForm<BacktestFormValues>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PortfolioBacktestResult | null>(null);
  const [barsLoaded, setBarsLoaded] = useState(0);
  const [watchSymbols, setWatchSymbols] = useState<WatchSymbol[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const symbolOptions = useMemo(() => buildSymbolOptions(watchSymbols), [watchSymbols]);
  const chartData = useMemo(
    () => (result ? buildBacktestChartData(result) : null),
    [result],
  );

  useEffect(() => {
    let cancelled = false;

    const loadWatchSymbols = async () => {
      setWatchlistLoading(true);
      setWatchlistError(null);
      try {
        const stocks = await fetchWatchSymbols();
        if (!cancelled) setWatchSymbols(stocks);
      } catch (nextError) {
        if (!cancelled) {
          console.warn("Backtest stock list api failed", nextError);
          setWatchlistError("自选股接口加载失败");
        }
      } finally {
        if (!cancelled) setWatchlistLoading(false);
      }
    };

    void loadWatchSymbols();
    return () => {
      cancelled = true;
    };
  }, []);

  const tradeColumns = useMemo(
    () => [
      {
        title: "标的",
        dataIndex: "symbol",
        fixed: "left" as const,
        width: 96,
      },
      {
        title: "买入时间",
        dataIndex: "entryTime",
        render: formatDateTime,
      },
      {
        title: "买入信号",
        dataIndex: "entrySignal",
        render: (value: string) => <Tag color="success">{value}</Tag>,
      },
      {
        title: "买入价",
        dataIndex: "entryPrice",
        align: "right" as const,
        render: formatMoney,
      },
      {
        title: "卖出时间",
        dataIndex: "exitTime",
        render: formatDateTime,
      },
      {
        title: "卖出信号",
        dataIndex: "exitSignal",
        render: (value: string) => <Tag color="error">{value}</Tag>,
      },
      {
        title: "卖出价",
        dataIndex: "exitPrice",
        align: "right" as const,
        render: formatMoney,
      },
      {
        title: "手续费",
        dataIndex: "fees",
        align: "right" as const,
        render: formatMoney,
      },
      {
        title: "总盈亏",
        dataIndex: "netPnl",
        align: "right" as const,
        render: renderMoneyWithColor,
      },
      {
        title: "收益率",
        dataIndex: "returnPct",
        align: "right" as const,
        render: renderPercentWithColor,
      },
    ],
    [],
  );

  const annualColumns = useMemo(
    () => [
      { title: "年度", dataIndex: "year", width: 90 },
      {
        title: "交易次数",
        dataIndex: "trades",
        align: "right" as const,
      },
      {
        title: "结束资金",
        dataIndex: "endCapital",
        align: "right" as const,
        render: formatMoney,
      },
      {
        title: "总收益率",
        dataIndex: "totalReturnPct",
        align: "right" as const,
        render: renderPercentWithColor,
      },
      {
        title: "年化收益",
        dataIndex: "annualizedReturnPct",
        align: "right" as const,
        render: renderPercentWithColor,
      },
      {
        title: "最大回撤金额",
        dataIndex: "maxDrawdownAmount",
        align: "right" as const,
        render: formatMoney,
      },
      {
        title: "最大回撤百分比",
        dataIndex: "maxDrawdownPct",
        align: "right" as const,
        render: formatPercent,
      },
      {
        title: "最大回撤天数",
        dataIndex: "maxDrawdownDays",
        align: "right" as const,
        render: (value: number) => `${value} 天`,
      },
      {
        title: "总盈亏",
        dataIndex: "totalPnl",
        align: "right" as const,
        render: renderMoneyWithColor,
      },
    ],
    [],
  );

  const handleRun = async (values: BacktestFormValues) => {
    setLoading(true);
    setError(null);
    try {
      const symbols = normalizeSelectedSymbols(values.symbols ?? [], watchSymbols);
      if (symbols.length === 0) {
        throw new Error("请至少选择一个标的");
      }

      const allocation = values.initialCapital / symbols.length;
      const results = await Promise.all(
        symbols.map(async (symbol) => {
          const bars = await fetchBacktestBars(symbol, values.period);
          if (bars.length < 60) {
            throw new Error(`${symbol} K 线数量不足，无法完成指标回测`);
          }
          return {
            symbol,
            barsLoaded: bars.length,
            result: runIndicatorBacktest(bars, {
              ...values,
              initialCapital: allocation,
            }),
          };
        }),
      );
      const nextResult = mergePortfolioResults(
        results.map((item) => ({
          symbol: item.symbol,
          result: item.result,
        })),
        values.initialCapital,
      );
      setBarsLoaded(results.reduce((total, item) => total + item.barsLoaded, 0));
      setResult(nextResult);
    } catch (nextError) {
      setResult(null);
      setBarsLoaded(0);
      setError(nextError instanceof Error ? nextError.message : "回测失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-3 pb-28 pt-3 sm:px-5 sm:pt-5">
      <section className="mx-auto flex max-w-7xl flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <Card
            title={
              <Space size={10}>
                <ExperimentOutlined />
                <span>指标回溯测试</span>
              </Space>
            }
          >
            <Form
              form={form}
              layout="inline"
              initialValues={defaultValues}
              onFinish={handleRun}
              className="gap-y-3"
            >
              <Form.Item
                label="标的"
                name="symbols"
                rules={[{ required: true, message: "请选择至少一个标的" }]}
              >
                <Cascader
                  multiple
                  showSearch
                  loading={watchlistLoading}
                  className="min-w-[260px]"
                  maxTagCount="responsive"
                  placeholder="选择标的"
                  options={symbolOptions}
                />
              </Form.Item>

              <Form.Item label="K线周期" name="period" rules={[{ required: true }]}>
                <Select className="w-[104px]" options={periodOptions} />
              </Form.Item>

              <Form.Item label="指标" name="indicator" rules={[{ required: true }]}>
                <Select
                  className="w-[116px]"
                  options={[
                    { label: "NTP", value: "NTP" },
                    { label: "LMACD", value: "LMACD" },
                    { label: "ORB", value: "ORB" },
                  ]}
                />
              </Form.Item>

              <Form.Item label="手续费" name="feeRate" rules={[{ required: true }]}>
                <InputNumber className="w-[112px]" min={0} step={0.00001} />
              </Form.Item>

              <Form.Item label="滑点" name="slippage" rules={[{ required: true }]}>
                <InputNumber className="w-[96px]" min={0} step={0.01} />
              </Form.Item>

              <Form.Item label="价格跳动" name="tickSize" rules={[{ required: true }]}>
                <InputNumber className="w-[96px]" min={0.000001} step={0.01} />
              </Form.Item>

              <Form.Item
                label="回测资金"
                name="initialCapital"
                rules={[{ required: true }]}
              >
                <InputNumber className="w-[128px]" min={1} step={1000} />
              </Form.Item>

              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading}>
                  开始回测
                </Button>
              </Form.Item>
            </Form>

            {watchlistError && (
              <Alert
                className="mt-3"
                type="warning"
                showIcon
                message={watchlistError}
              />
            )}

            <Typography.Paragraph className="mb-0 mt-3 text-xs text-slate-500">
              信号只在当前 K 线收盘后确认，统一下一根 K 线开盘成交；买入价加滑点并向上按跳动取整，卖出价减滑点并向下按跳动取整。
            </Typography.Paragraph>
          </Card>

          <Card
            title="汇总统计"
            extra={
              result ? (
                <Tag color="processing">已加载 {barsLoaded} 根 K 线</Tag>
              ) : (
                <Tag>等待回测</Tag>
              )
            }
          >
            {result ? (
              <div className="grid grid-cols-2 gap-4">
                <Statistic title="结束资金" value={result.stats.endCapital} precision={2} />
                <Statistic
                  title="总收益率"
                  value={result.stats.totalReturnPct * 100}
                  precision={2}
                  suffix="%"
                />
                <Statistic
                  title="年化收益"
                  value={result.stats.annualizedReturnPct * 100}
                  precision={2}
                  suffix="%"
                />
                <Statistic title="总盈亏" value={result.stats.totalPnl} precision={2} />
                <Statistic
                  title="最大回撤金额"
                  value={result.stats.maxDrawdownAmount}
                  precision={2}
                />
                <Statistic
                  title="最大回撤百分比"
                  value={result.stats.maxDrawdownPct * 100}
                  precision={2}
                  suffix="%"
                />
                <Statistic
                  title="最大回撤天数"
                  value={result.stats.maxDrawdownDays}
                  suffix="天"
                />
                <Statistic title="交易次数" value={result.trades.length} />
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="运行后显示统计" />
            )}
          </Card>
        </div>

        {error && <Alert type="error" showIcon message={error} />}

        {result && chartData && (
          <>
            <div className="grid gap-4 xl:grid-cols-2">
              <BacktestChartCard title="账户净值">
                <EChartPanel option={createEquityOption(chartData.equity)} />
              </BacktestChartCard>

              <BacktestChartCard title="净值回撤">
                <EChartPanel option={createDrawdownOption(chartData.drawdown)} />
              </BacktestChartCard>

              <BacktestChartCard title="每日盈亏">
                <EChartPanel option={createPnlOption(chartData.pnl)} />
              </BacktestChartCard>

              <BacktestChartCard title="盈亏分布">
                <EChartPanel option={createDistributionOption(chartData.distribution)} />
              </BacktestChartCard>
            </div>

            <Card title="按自然年度统计">
              <Table<AnnualBacktestStats>
                rowKey="year"
                size="small"
                columns={annualColumns}
                dataSource={result.annualStats}
                pagination={false}
                scroll={{ x: 980 }}
              />
            </Card>

            <Card title="交易明细">
              <Table<PortfolioBacktestTrade>
                rowKey={(trade, index) => `${trade.entryTime}-${trade.exitTime}-${index}`}
                size="small"
                columns={tradeColumns}
                dataSource={result.trades}
                pagination={{ pageSize: 12 }}
                scroll={{ x: 1080 }}
              />
            </Card>
          </>
        )}
      </section>
    </main>
  );
}

async function fetchWatchSymbols() {
  const response = await fetch(STOCKS_API_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Stock api failed: ${response.status}`);
  }

  const payload = await response.json();
  const rawStocks = extractStockRows(payload);
  const stocks = rawStocks
    .map(normalizeWatchSymbol)
    .filter((item: WatchSymbol | null): item is WatchSymbol => item !== null)
    .filter((item) => visibleStockCategoryValues.has(item.category))
    .filter(createWatchSymbolDedupe());

  if (stocks.length > 0) return stocks;
  return [
    {
      ticker: "TSLA.US",
      name: "Tesla",
      market: "US",
      category: "us",
    },
  ];
}

async function fetchBacktestBars(symbol: string, period: string) {
  const url = new URL(`${MARKET_API_BASE}/${period}/${encodeURIComponent(symbol)}`);
  url.searchParams.set("count", String(BACKTEST_BAR_COUNT));
  url.searchParams.set("refresh", "1");
  url.searchParams.set("to", String(Date.now()));
  url.searchParams.set("adjust", "1");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`行情接口失败: ${response.status}`);
  }

  const payload = await response.json();
  const rawBars = payload?.data?.klines;
  if (!payload?.success || !Array.isArray(rawBars)) {
    throw new Error("行情接口返回格式不正确");
  }

  return rawBars
    .map(normalizeApiBar)
    .filter((bar: BacktestBar | null): bar is BacktestBar => bar !== null)
    .sort((a: BacktestBar, b: BacktestBar) => a.timestamp - b.timestamp);
}

function normalizeApiBar(raw: MarketApiBar): BacktestBar | null {
  const timestamp = new Date(String(raw.timestamp ?? raw.time)).getTime();
  const open = Number(raw.open);
  const high = Number(raw.high);
  const low = Number(raw.low);
  const close = Number(raw.close);
  const volume = Number(raw.volume ?? 0);
  if (![timestamp, open, high, low, close].every(Number.isFinite)) return null;

  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0,
  };
}

function normalizeWatchSymbol(raw: Record<string, unknown>): WatchSymbol | null {
  const ticker = String(raw.ticker ?? raw.symbol ?? raw.code ?? "").trim();
  if (!ticker) return null;

  const suffixMarket = ticker.includes(".") ? ticker.split(".").at(-1) : "";
  const nameCn = getStringValue(raw.nameCn);
  const nameHk = getStringValue(raw.nameHk);
  const nameEn = getStringValue(raw.nameEn);
  const market =
    getStringValue(raw.market) ||
    getStringValue(raw.region) ||
    getStringValue(raw.exchange) ||
    suffixMarket ||
    "";
  const board = getStringValue(raw.board);

  return {
    ticker,
    name:
      nameCn ||
      getStringValue(raw.name) ||
      getStringValue(raw.displayName) ||
      getStringValue(raw.companyName) ||
      nameEn ||
      ticker,
    market,
    category:
      getStringValue(raw.category ?? raw.__category) ||
      inferStockCategory(ticker, market, board),
    nameCn,
    nameHk,
    nameEn,
  };
}

function inferStockCategory(ticker: string, market: string, board: string) {
  if (board.toLowerCase().includes("option")) return "usOptions";
  if (ticker.endsWith(".HK") || market === "HK") return "hk";
  if (ticker.endsWith(".SH") || ticker.endsWith(".SZ") || market === "CN") {
    return "cn";
  }
  if (ticker.endsWith(".US") || market === "US") return "us";
  return "other";
}

function extractStockRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const source = data ?? root;
  if (!source) return asRecordArray(payload);

  const categoryRows = extractCategoryRows(source);
  if (categoryRows.length > 0) return categoryRows;

  const directRows = [
    ...asRecordArray(source.stocks),
    ...asRecordArray(source.securities),
  ];
  if (directRows.length > 0) return directRows;

  const stockMap = collectStockDetails(source);
  const orderedSymbols = asStringArray(source.symbols);
  if (orderedSymbols.length > 0) {
    return orderedSymbols.map((symbol) => stockMap.get(symbol) ?? { symbol });
  }

  return Array.from(stockMap.values());
}

function extractCategoryRows(source: Record<string, unknown>) {
  const categories = asRecord(source.categories);
  if (!categories) return [];

  return stockCategoryOptions.flatMap((option) =>
    visibleStockCategoryValues.has(option.value)
      ? asRecordArray(categories[option.value]).map((row) => ({
          ...row,
          __category: option.value,
        }))
      : [],
  );
}

function collectStockDetails(source: Record<string, unknown>) {
  const stockMap = new Map<string, Record<string, unknown>>();
  const saveRows = (rows: Record<string, unknown>[], category?: string) => {
    rows.forEach((row) => {
      const symbol = getStringValue(row.symbol ?? row.ticker ?? row.code);
      if (symbol && !stockMap.has(symbol)) {
        stockMap.set(symbol, category ? { ...row, __category: category } : row);
      }
    });
  };

  const categories = asRecord(source.categories);
  if (categories) {
    Object.entries(categories).forEach(([category, rows]) =>
      saveRows(asRecordArray(rows), category),
    );
  }

  asRecordArray(source.groups).forEach((group) => {
    saveRows(asRecordArray(group.securities));
  });

  saveRows(asRecordArray(source.stocks));
  saveRows(asRecordArray(source.securities));

  return stockMap;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => getStringValue(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

function getStringValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function createWatchSymbolDedupe() {
  const seen = new Set<string>();
  return (item: WatchSymbol) => {
    if (seen.has(item.ticker)) return false;
    seen.add(item.ticker);
    return true;
  };
}

function buildSymbolOptions(symbols: WatchSymbol[]) {
  const source =
    symbols.length > 0
      ? symbols
      : [
          {
            ticker: "TSLA.US",
            name: "Tesla",
            market: "US",
            category: "us",
          },
        ];

  return stockCategoryOptions
    .map((category) => {
      const children = source
        .filter((item) => item.category === category.value)
        .map((item) => ({
          label: `${item.ticker} ${item.name}`,
          value: item.ticker,
        }));
      return {
        label: category.label,
        value: category.value,
        children,
      };
    })
    .filter((group) => group.children.length > 0);
}

function normalizeSelectedSymbols(paths: string[][], symbols: WatchSymbol[]) {
  const selected = new Set<string>();
  const categoryValues = new Set(stockCategoryOptions.map((item) => item.value));

  paths.forEach((path) => {
    const leaf = path.at(-1);
    if (!leaf) return;
    if (categoryValues.has(leaf)) {
      symbols
        .filter((item) => item.category === leaf)
        .forEach((item) => selected.add(item.ticker));
      return;
    }
    selected.add(leaf);
  });

  return Array.from(selected);
}

function mergePortfolioResults(
  items: Array<{ symbol: string; result: BacktestResult }>,
  initialCapital: number,
): PortfolioBacktestResult {
  const equityCurve = mergeEquityCurves(items);
  const trades = items
    .flatMap(({ symbol, result }) =>
      result.trades.map((trade) => ({ ...trade, symbol })),
    )
    .sort((a, b) => a.entryTime - b.entryTime);
  const endCapital = equityCurve.at(-1)?.equity ?? initialCapital;

  return {
    stats: buildStatsFromEquityCurve(equityCurve, initialCapital, endCapital),
    annualStats: buildAnnualStatsFromEquityCurve(
      equityCurve,
      trades,
      initialCapital,
    ),
    trades,
    equityCurve,
  };
}

function mergeEquityCurves(items: Array<{ symbol: string; result: BacktestResult }>) {
  const timestamps = Array.from(
    new Set(
      items.flatMap(({ result }) =>
        result.equityCurve.map((point) => point.timestamp),
      ),
    ),
  ).sort((a, b) => a - b);
  const positions = new Map<string, number>();
  const latest = new Map<string, number>();

  items.forEach(({ symbol, result }) => {
    positions.set(symbol, 0);
    latest.set(symbol, result.stats.startCapital);
  });

  return timestamps.map((timestamp) => {
    items.forEach(({ symbol, result }) => {
      let position = positions.get(symbol) ?? 0;
      while (
        position < result.equityCurve.length &&
        result.equityCurve[position].timestamp <= timestamp
      ) {
        latest.set(symbol, result.equityCurve[position].equity);
        position += 1;
      }
      positions.set(symbol, position);
    });

    return {
      timestamp,
      equity: Array.from(latest.values()).reduce((sum, equity) => sum + equity, 0),
    };
  });
}

function buildStatsFromEquityCurve(
  equityCurve: BacktestResult["equityCurve"],
  startCapital: number,
  endCapital: number,
) {
  const drawdown = calculateDrawdownFromEquityCurve(equityCurve, startCapital);
  const totalReturnPct = endCapital / startCapital - 1;
  const firstTimestamp = equityCurve[0]?.timestamp;
  const lastTimestamp = equityCurve.at(-1)?.timestamp;
  const years =
    firstTimestamp && lastTimestamp
      ? Math.max((lastTimestamp - firstTimestamp) / (365.25 * 24 * 60 * 60 * 1000), 1 / 365.25)
      : 1;

  return {
    startCapital,
    endCapital,
    totalReturnPct,
    annualizedReturnPct:
      endCapital > 0 ? (endCapital / startCapital) ** (1 / years) - 1 : -1,
    maxDrawdownAmount: drawdown.amount,
    maxDrawdownPct: drawdown.percent,
    maxDrawdownDays: drawdown.days,
    totalPnl: endCapital - startCapital,
  };
}

function buildAnnualStatsFromEquityCurve(
  equityCurve: BacktestResult["equityCurve"],
  trades: PortfolioBacktestTrade[],
  initialCapital: number,
) {
  const grouped = new Map<number, BacktestResult["equityCurve"]>();
  equityCurve.forEach((point) => {
    const year = new Date(point.timestamp).getUTCFullYear();
    const list = grouped.get(year) ?? [];
    list.push(point);
    grouped.set(year, list);
  });

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, points], index, entries) => {
      const previousYear = entries[index - 1]?.[0];
      const previousPoints =
        previousYear === undefined ? undefined : grouped.get(previousYear);
      const startCapital = previousPoints?.at(-1)?.equity ?? initialCapital;
      const endCapital = points.at(-1)?.equity ?? startCapital;
      return {
        year,
        trades: trades.filter(
          (trade) => new Date(trade.exitTime).getUTCFullYear() === year,
        ).length,
        ...buildStatsFromEquityCurve(points, startCapital, endCapital),
      };
    });
}

function calculateDrawdownFromEquityCurve(
  equityCurve: BacktestResult["equityCurve"],
  fallbackPeak: number,
) {
  let peak = fallbackPeak;
  let peakTime = equityCurve[0]?.timestamp ?? 0;
  let amount = 0;
  let percent = 0;
  let days = 0;

  equityCurve.forEach((point) => {
    if (point.equity > peak) {
      peak = point.equity;
      peakTime = point.timestamp;
    }
    const nextAmount = Math.max(0, peak - point.equity);
    if (nextAmount > amount) {
      amount = nextAmount;
      percent = peak > 0 ? nextAmount / peak : 0;
      days = Math.ceil(Math.max(0, point.timestamp - peakTime) / (24 * 60 * 60 * 1000));
    }
  });

  return { amount, percent, days };
}

function BacktestChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card size="small" title={title} styles={{ body: { padding: 12 } }}>
      {children}
    </Card>
  );
}

function EChartPanel({ option }: { option: echarts.EChartsOption }) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;

    const chart = echarts.init(element);
    chart.setOption(option, true);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);

    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [option]);

  return <div ref={chartRef} className="h-[280px] w-full" />;
}

function buildBacktestChartData(result: BacktestResult): BacktestChartData {
  const equity = result.equityCurve.map((point) => ({
    timestamp: point.timestamp,
    value: point.equity,
  }));
  const drawdown = buildDrawdownSeries(result.equityCurve);
  const pnl = result.equityCurve.map((point, index, list) => ({
    timestamp: point.timestamp,
    value: index === 0 ? 0 : point.equity - list[index - 1].equity,
  }));
  const distribution = buildPnlDistribution(result.trades);

  return { equity, drawdown, pnl, distribution };
}

function buildDrawdownSeries(equityCurve: BacktestResult["equityCurve"]) {
  let peak = equityCurve[0]?.equity ?? 0;
  return equityCurve.map((point) => {
    peak = Math.max(peak, point.equity);
    return {
      timestamp: point.timestamp,
      value: peak > 0 ? point.equity / peak - 1 : 0,
    };
  });
}

function buildPnlDistribution(trades: BacktestTrade[]) {
  if (trades.length === 0) return [];

  const values = trades.map((trade) => trade.netPnl);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ label: formatMoney(min), value: values.length }];
  }

  const binCount = Math.min(10, Math.max(5, Math.ceil(Math.sqrt(values.length))));
  const step = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => {
    const start = min + index * step;
    const end = index === binCount - 1 ? max : start + step;
    return {
      label: `${formatCompactNumber(start)} ~ ${formatCompactNumber(end)}`,
      value: 0,
    };
  });

  values.forEach((value) => {
    const index = Math.min(binCount - 1, Math.floor((value - min) / step));
    bins[index].value += 1;
  });

  return bins;
}

function createEquityOption(data: ChartPoint[]): echarts.EChartsOption {
  return createTimeLineOption({
    data,
    color: "#1677ff",
    tooltipName: "账户净值",
    yFormatter: formatMoney,
    areaColor: "rgba(22, 119, 255, 0.12)",
  });
}

function createDrawdownOption(data: ChartPoint[]): echarts.EChartsOption {
  return createTimeLineOption({
    data,
    color: "#089981",
    tooltipName: "净值回撤",
    yFormatter: formatPercent,
    areaColor: "rgba(8, 153, 129, 0.14)",
  });
}

function createPnlOption(data: ChartPoint[]): echarts.EChartsOption {
  return {
    animation: false,
    grid: { left: 58, right: 18, top: 24, bottom: 48 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => formatMoney(Number(value)),
    },
    dataZoom: [
      { type: "inside", throttle: 60 },
      { type: "slider", height: 18, bottom: 8 },
    ],
    xAxis: {
      type: "time",
      axisLabel: { color: "#64748b" },
      axisLine: { lineStyle: { color: "#cbd5e1" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#64748b", formatter: compactAxisLabel },
      splitLine: { lineStyle: { color: "#edf2f7" } },
    },
    series: [
      {
        name: "每日盈亏",
        type: "bar",
        data: data.map((point) => [point.timestamp, point.value]),
        itemStyle: {
          color: ({ value }) => {
            const item = Array.isArray(value) ? Number(value[1]) : Number(value);
            return item >= 0 ? "#cf1322" : "#089981";
          },
        },
      },
    ],
  };
}

function createDistributionOption(data: HistogramBin[]): echarts.EChartsOption {
  return {
    animation: false,
    grid: { left: 48, right: 18, top: 24, bottom: 62 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => `${Number(value)} 笔`,
    },
    xAxis: {
      type: "category",
      data: data.map((item) => item.label),
      axisLabel: { color: "#64748b", rotate: 26 },
      axisLine: { lineStyle: { color: "#cbd5e1" } },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { color: "#64748b" },
      splitLine: { lineStyle: { color: "#edf2f7" } },
    },
    series: [
      {
        name: "交易笔数",
        type: "bar",
        data: data.map((item) => item.value),
        itemStyle: { color: "#1677ff", borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 34,
      },
    ],
  };
}

function createTimeLineOption({
  data,
  color,
  tooltipName,
  yFormatter,
  areaColor,
}: {
  data: ChartPoint[];
  color: string;
  tooltipName: string;
  yFormatter: (value: number) => string;
  areaColor: string;
}): echarts.EChartsOption {
  return {
    animation: false,
    grid: { left: 58, right: 18, top: 24, bottom: 48 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => yFormatter(Number(value)),
    },
    dataZoom: [
      { type: "inside", throttle: 60 },
      { type: "slider", height: 18, bottom: 8 },
    ],
    xAxis: {
      type: "time",
      axisLabel: { color: "#64748b" },
      axisLine: { lineStyle: { color: "#cbd5e1" } },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { color: "#64748b", formatter: compactAxisLabel },
      splitLine: { lineStyle: { color: "#edf2f7" } },
    },
    series: [
      {
        name: tooltipName,
        type: "line",
        data: data.map((point) => [point.timestamp, point.value]),
        showSymbol: false,
        smooth: true,
        lineStyle: { color, width: 2 },
        areaStyle: { color: areaColor },
      },
    ],
  };
}

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatMoney(value: number) {
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function formatCompactNumber(value: number) {
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function compactAxisLabel(value: number | string) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(1)}万`;
  if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(1)}k`;
  if (Math.abs(number) < 1 && number !== 0) return number.toFixed(2);
  return number.toFixed(0);
}

function renderMoneyWithColor(value: number) {
  const color = value >= 0 ? "#cf1322" : "#089981";
  return <span style={{ color }}>{formatMoney(value)}</span>;
}

function renderPercentWithColor(value: number) {
  const color = value >= 0 ? "#cf1322" : "#089981";
  return <span style={{ color }}>{formatPercent(value)}</span>;
}

export default BacktestComingSoonPage;
