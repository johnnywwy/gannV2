import {
  BarChartOutlined,
  BorderOutlined,
  ClearOutlined,
  ColumnHeightOutlined,
  CompressOutlined,
  DeleteOutlined,
  EyeOutlined,
  LineChartOutlined,
  LockOutlined,
  MenuFoldOutlined,
  SettingOutlined,
  SlidersOutlined,
  StockOutlined,
} from "@ant-design/icons";
import {
  Button,
  Divider,
  Dropdown,
  Popover,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
} from "antd";
import {
  dispose,
  init,
  type Chart,
  type DataLoadMore,
  type DataLoadType,
  type KLineData,
  type Period,
} from "klinecharts";
import { useEffect, useMemo, useRef, useState } from "react";

type PeriodOption = {
  label: string;
  value: string;
  period: Period;
};

type DrawingTool = {
  label: string;
  icon: React.ReactNode;
  overlay: string;
};

type AdjustType = 0 | 1;

const symbol = {
  ticker: "TSLA.US",
  pricePrecision: 2,
  volumePrecision: 2,
};

const MARKET_API_BASE = "http://192.168.2.3:18080/api/kline";
const KLINE_COUNT = 1000;
const REQUEST_RANGE_MULTIPLIER = 3;
const HISTORY_LOAD_DEBOUNCE_MS = 280;

const periodOptions: PeriodOption[] = [
  { label: "1分", value: "1m", period: { type: "minute", span: 1 } },
  { label: "3分", value: "3m", period: { type: "minute", span: 3 } },
  { label: "5分", value: "5m", period: { type: "minute", span: 5 } },
  { label: "15分", value: "15m", period: { type: "minute", span: 15 } },
  { label: "1小时", value: "1h", period: { type: "hour", span: 1 } },
  { label: "3小时", value: "3h", period: { type: "hour", span: 3 } },
  { label: "4小时", value: "4h", period: { type: "hour", span: 4 } },
  { label: "日", value: "1d", period: { type: "day", span: 1 } },
  { label: "周", value: "1w", period: { type: "week", span: 1 } },
  { label: "月", value: "1M", period: { type: "month", span: 1 } },
  { label: "季", value: "1q", period: { type: "month", span: 3 } },
  { label: "年", value: "1y", period: { type: "year", span: 1 } },
];

const mainIndicators = ["MA", "EMA", "BOLL"];
const paneIndicators = ["VOL", "MACD", "KDJ", "RSI", "WR"];
const adjustOptions: Array<{ label: string; value: AdjustType }> = [
  { label: "除权", value: 0 },
  { label: "前复权", value: 1 },
];

const drawingTools: DrawingTool[] = [
  { label: "线段", icon: <LineChartOutlined />, overlay: "segment" },
  { label: "射线", icon: <CompressOutlined />, overlay: "rayLine" },
  {
    label: "水平线",
    icon: <ColumnHeightOutlined />,
    overlay: "horizontalStraightLine",
  },
  {
    label: "垂直线",
    icon: <MenuFoldOutlined />,
    overlay: "verticalStraightLine",
  },
  { label: "价格线", icon: <SlidersOutlined />, overlay: "priceLine" },
  { label: "通道线", icon: <BorderOutlined />, overlay: "priceChannelLine" },
  { label: "斐波那契", icon: <BarChartOutlined />, overlay: "fibonacciLine" },
];

function KLineChartPage() {
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const [periodValue, setPeriodValue] = useState("1d");
  const [mainIndicator, setMainIndicator] = useState("MA");
  const [paneIndicator, setPaneIndicator] = useState("VOL");
  const [drawingTool, setDrawingTool] = useState<string | null>(null);
  const [zoomEnabled, setZoomEnabled] = useState(true);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [showTools, setShowTools] = useState(true);
  const [dataSource, setDataSource] = useState<"api" | "fallback">("api");
  const [loadingCount, setLoadingCount] = useState(0);
  const [loadingText, setLoadingText] = useState("正在加载 K 线数据");
  const [adjustType, setAdjustType] = useState<AdjustType>(1);
  const adjustTypeRef = useRef<AdjustType>(1);
  const historyLoadTimerRef = useRef<ReturnType<
    typeof window.setTimeout
  > | null>(null);

  const activePeriod = useMemo(
    () =>
      periodOptions.find((item) => item.value === periodValue) ??
      periodOptions[7],
    [periodValue],
  );

  useEffect(() => {
    const host = chartHostRef.current;
    if (!host) return;

    const chart = init(host, {
      layout: [
        { type: "candle", options: { id: "candle_pane" } },
        {
          type: "indicator",
          content: ["VOL"],
          options: { id: "indicator_pane", height: 116, minHeight: 80 },
        },
        { type: "xAxis" },
      ],
      styles: {
        grid: {
          horizontal: {
            color: "#e6edf5",
            size: 1,
            style: "solid",
            dashedValue: [],
          },
          vertical: {
            color: "#edf2f7",
            size: 1,
            style: "solid",
            dashedValue: [],
          },
        },
        candle: {
          bar: {
            upColor: "#089981",
            downColor: "#f23645",
            noChangeColor: "#6b7280",
            upBorderColor: "#089981",
            downBorderColor: "#f23645",
            noChangeBorderColor: "#6b7280",
            upWickColor: "#089981",
            downWickColor: "#f23645",
            noChangeWickColor: "#6b7280",
          },
          priceMark: {
            last: {
              line: {
                show: true,
                style: "dashed",
                dashedValue: [4, 4],
                size: 1,
              },
              text: { show: true, size: 12, color: "#ffffff", borderRadius: 2 },
            },
          },
        },
        crosshair: {
          horizontal: {
            line: {
              color: "#64748b",
              size: 1,
              style: "dashed",
              dashedValue: [4, 4],
            },
          },
          vertical: {
            line: {
              color: "#64748b",
              size: 1,
              style: "dashed",
              dashedValue: [4, 4],
            },
          },
        },
      },
    });

    if (!chart) return;
    chartRef.current = chart;
    chart.setDataLoader({
      getBars: async ({
        type,
        timestamp,
        symbol: currentSymbol,
        period,
        callback,
      }) => {
        const load = async () => {
          setLoadingText(
            type === "forward" ? "正在加载更早 K 线" : "正在加载 K 线数据",
          );
          setLoadingCount((count) => count + 1);
          try {
            const { bars, more } = await fetchMarketBars(
              currentSymbol.ticker,
              period,
              type,
              timestamp,
              adjustTypeRef.current,
            );
            callback(bars, more);
            setDataSource("api");
          } catch (error) {
            console.warn("K line api fallback", error);
            callback(type === "init" ? generateMockBars(period) : [], {
              backward: false,
              forward: false,
            });
            setDataSource("fallback");
          } finally {
            setLoadingCount((count) => Math.max(0, count - 1));
          }
        };

        if (type === "forward") {
          if (historyLoadTimerRef.current !== null) {
            window.clearTimeout(historyLoadTimerRef.current);
          }
          historyLoadTimerRef.current = window.setTimeout(() => {
            historyLoadTimerRef.current = null;
            void load();
          }, HISTORY_LOAD_DEBOUNCE_MS);
          return;
        }

        await load();
      },
    });
    chart.setSymbol(symbol);
    chart.setPeriod(activePeriod.period);
    chart.createIndicator("MA", true, { id: "candle_pane" });
    chart.setOffsetRightDistance(24);

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(host);

    return () => {
      if (historyLoadTimerRef.current !== null) {
        window.clearTimeout(historyLoadTimerRef.current);
      }
      observer.disconnect();
      dispose(chart);
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    adjustTypeRef.current = adjustType;
    chartRef.current?.resetData();
  }, [adjustType]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setPeriod(activePeriod.period);
  }, [activePeriod]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    mainIndicators.forEach((name) =>
      chart.removeIndicator({ name, paneId: "candle_pane" }),
    );
    chart.createIndicator(mainIndicator, true, { id: "candle_pane" });
  }, [mainIndicator]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    paneIndicators.forEach((name) =>
      chart.removeIndicator({ name, paneId: "indicator_pane" }),
    );
    chart.createIndicator(paneIndicator, false, {
      id: "indicator_pane",
      height: 116,
      minHeight: 80,
    });
  }, [paneIndicator]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setZoomEnabled(zoomEnabled);
  }, [zoomEnabled]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setScrollEnabled(scrollEnabled);
  }, [scrollEnabled]);

  const createOverlay = (tool: DrawingTool) => {
    setDrawingTool(tool.overlay);
    chartRef.current?.createOverlay({
      name: tool.overlay,
      groupId: "drawing-tools",
      mode: "weak_magnet",
    });
  };

  const clearOverlays = () => {
    chartRef.current?.removeOverlay({ groupId: "drawing-tools" });
    setDrawingTool(null);
  };

  return (
    <main className="h-screen overflow-hidden bg-[#f5f5f5] pb-24">
      <section className="flex h-full flex-col border-b border-slate-200 bg-[#f7f9fc]">
        <TopToolbar
          periodValue={periodValue}
          mainIndicator={mainIndicator}
          paneIndicator={paneIndicator}
          zoomEnabled={zoomEnabled}
          scrollEnabled={scrollEnabled}
          showTools={showTools}
          onPeriodChange={setPeriodValue}
          onMainIndicatorChange={setMainIndicator}
          onPaneIndicatorChange={setPaneIndicator}
          onZoomEnabledChange={setZoomEnabled}
          onScrollEnabledChange={setScrollEnabled}
          onShowToolsChange={setShowTools}
          dataSource={dataSource}
          adjustType={adjustType}
          onAdjustTypeChange={setAdjustType}
        />

        <div className="min-h-0 flex-1 overflow-hidden">
          <div
            className="grid h-full min-h-0"
            style={{
              gridTemplateColumns: showTools
                ? "52px minmax(0, 1fr)"
                : "0 minmax(0, 1fr)",
            }}
          >
            <LeftToolbar
              visible={showTools}
              activeTool={drawingTool}
              onToolSelect={createOverlay}
              onClear={clearOverlays}
            />
            <div className="relative min-w-0 border-l border-slate-200 bg-white">
              <div ref={chartHostRef} className="h-full w-full" />
              {loadingCount > 0 && (
                <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-white/38 backdrop-blur-[1px]">
                  <div className="rounded-lg border border-slate-200 bg-white/95 px-4 py-3 shadow-lg">
                    <Spin tip={loadingText} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function TopToolbar({
  periodValue,
  mainIndicator,
  paneIndicator,
  zoomEnabled,
  scrollEnabled,
  showTools,
  onPeriodChange,
  onMainIndicatorChange,
  onPaneIndicatorChange,
  onZoomEnabledChange,
  onScrollEnabledChange,
  onShowToolsChange,
  dataSource,
  adjustType,
  onAdjustTypeChange,
}: {
  periodValue: string;
  mainIndicator: string;
  paneIndicator: string;
  zoomEnabled: boolean;
  scrollEnabled: boolean;
  showTools: boolean;
  onPeriodChange: (value: string) => void;
  onMainIndicatorChange: (value: string) => void;
  onPaneIndicatorChange: (value: string) => void;
  onZoomEnabledChange: (value: boolean) => void;
  onScrollEnabledChange: (value: boolean) => void;
  onShowToolsChange: (value: boolean) => void;
  dataSource: "api" | "fallback";
  adjustType: AdjustType;
  onAdjustTypeChange: (value: AdjustType) => void;
}) {
  const settings = (
    <Space direction="vertical" size={12}>
      <SettingRow label="缩放">
        <Switch
          size="small"
          checked={zoomEnabled}
          onChange={onZoomEnabledChange}
        />
      </SettingRow>
      <SettingRow label="滚动">
        <Switch
          size="small"
          checked={scrollEnabled}
          onChange={onScrollEnabledChange}
        />
      </SettingRow>
      <SettingRow label="左侧工具">
        <Switch size="small" checked={showTools} onChange={onShowToolsChange} />
      </SettingRow>
    </Space>
  );

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3">
      <div className="flex h-8 items-center gap-2 border-r border-slate-200 pr-3">
        <StockOutlined className="text-[#1677ff]" />
        <span className="text-base font-semibold text-slate-950">
          {symbol.ticker}
        </span>
        <Tag
          color={dataSource === "api" ? "success" : "warning"}
          bordered={false}
        >
          {dataSource === "api" ? "接口" : "模拟"}
        </Tag>
      </div>

      <Space size={2} className="shrink-0">
        {periodOptions.map((item) => (
          <Button
            key={item.value}
            size="small"
            type={periodValue === item.value ? "primary" : "text"}
            onClick={() => onPeriodChange(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </Space>

      <Divider type="vertical" />

      <Dropdown
        trigger={["click"]}
        menu={{
          selectable: true,
          selectedKeys: [mainIndicator],
          items: mainIndicators.map((name) => ({ key: name, label: name })),
          onClick: ({ key }) => onMainIndicatorChange(key),
        }}
      >
        <Button size="small" type="text">
          指标 {mainIndicator}
        </Button>
      </Dropdown>

      <Select
        size="small"
        value={paneIndicator}
        className="w-[92px]"
        options={paneIndicators.map((name) => ({ label: name, value: name }))}
        onChange={onPaneIndicatorChange}
      />

      <Divider type="vertical" />

      <Select
        size="small"
        value={adjustType}
        className="w-[92px]"
        options={adjustOptions}
        onChange={onAdjustTypeChange}
      />

      <Divider type="vertical" />

      <Button size="small" type="text">
        实时区间
      </Button>

      <Popover placement="bottomRight" trigger="click" content={settings}>
        <Button size="small" type="text" icon={<SettingOutlined />}>
          设置
        </Button>
      </Popover>
    </header>
  );
}

function LeftToolbar({
  visible,
  activeTool,
  onToolSelect,
  onClear,
}: {
  visible: boolean;
  activeTool: string | null;
  onToolSelect: (tool: DrawingTool) => void;
  onClear: () => void;
}) {
  return (
    <aside
      className={`min-h-0 overflow-hidden border-r border-slate-200 bg-white transition-opacity ${visible ? "opacity-100" : "opacity-0"}`}
    >
      <div className="flex h-full w-[52px] flex-col items-center gap-1 py-3">
        {drawingTools.map((tool) => (
          <Tooltip key={tool.overlay} placement="right" title={tool.label}>
            <Button
              className={
                activeTool === tool.overlay ? "bg-blue-50 text-[#1677ff]" : ""
              }
              type="text"
              icon={tool.icon}
              onClick={() => onToolSelect(tool)}
            />
          </Tooltip>
        ))}
        <Divider className="my-2" />
        <Tooltip placement="right" title="显示/隐藏">
          <Button type="text" icon={<EyeOutlined />} />
        </Tooltip>
        <Tooltip placement="right" title="锁定">
          <Button type="text" icon={<LockOutlined />} />
        </Tooltip>
        <div className="flex-1" />
        <Tooltip placement="right" title="清除画线">
          <Button
            danger
            type="text"
            icon={<DeleteOutlined />}
            onClick={onClear}
          />
        </Tooltip>
        <Tooltip placement="right" title="重置">
          <Button type="text" icon={<ClearOutlined />} onClick={onClear} />
        </Tooltip>
      </div>
    </aside>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-[140px] items-center justify-between gap-6">
      <span className="text-sm text-slate-600">{label}</span>
      {children}
    </div>
  );
}

async function fetchMarketBars(
  ticker: string,
  period: Period,
  loadType: DataLoadType,
  anchorTimestamp: number | null,
  adjustType: AdjustType,
): Promise<{ bars: KLineData[]; more: DataLoadMore }> {
  const apiPeriod = periodToApiPeriod(period);
  const { from, to } = getMarketRequestRange(period, loadType, anchorTimestamp);
  const url = new URL(
    `${MARKET_API_BASE}/${apiPeriod}/${encodeURIComponent(ticker)}`,
  );
  url.searchParams.set("count", String(KLINE_COUNT));
  url.searchParams.set("refresh", "1");
  url.searchParams.set("from", String(from));
  url.searchParams.set("to", String(to));
  url.searchParams.set("adjust", adjustType);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Market api failed: ${response.status}`);
  }

  const payload = await response.json();
  const rawBars = payload?.data?.klines;
  if (!payload?.success || !Array.isArray(rawBars)) {
    throw new Error("Market api returned an unexpected payload");
  }

  const bars = rawBars
    .map(normalizeApiBar)
    .filter((bar: KLineData | null): bar is KLineData => bar !== null)
    .filter((bar: KLineData) => {
      if (loadType === "forward" && anchorTimestamp)
        return bar.timestamp < anchorTimestamp;
      if (loadType === "backward" && anchorTimestamp)
        return bar.timestamp > anchorTimestamp;
      return true;
    })
    .sort((a: KLineData, b: KLineData) => a.timestamp - b.timestamp);

  if (bars.length === 0 && loadType === "init") {
    throw new Error("Market api returned no bars");
  }

  return {
    bars,
    more: getMarketLoadMore(loadType, bars.length),
  };
}

function getMarketRequestRange(
  period: Period,
  loadType: DataLoadType,
  anchorTimestamp: number | null,
) {
  const now = Date.now();
  const step = periodToMilliseconds(period);
  const span = step * KLINE_COUNT * REQUEST_RANGE_MULTIPLIER;

  if (loadType === "forward" && anchorTimestamp) {
    const to = anchorTimestamp - 1;
    return { from: Math.max(0, to - span), to };
  }

  if ((loadType === "backward" || loadType === "update") && anchorTimestamp) {
    const from = anchorTimestamp + 1;
    return { from, to: Math.max(from, Math.min(now, from + span)) };
  }

  return { from: now - span, to: now };
}

function getMarketLoadMore(
  loadType: DataLoadType,
  barCount: number,
): DataLoadMore {
  const hasMore = barCount >= Math.floor(KLINE_COUNT * 0.8);

  if (loadType === "backward" || loadType === "update") {
    return { backward: hasMore, forward: true };
  }

  return { backward: false, forward: hasMore };
}

function normalizeApiBar(raw: Record<string, unknown>): KLineData | null {
  const timestamp = new Date(String(raw.timestamp)).getTime();
  const open = Number(raw.open);
  const high = Number(raw.high);
  const low = Number(raw.low);
  const close = Number(raw.close);
  const volume = Number(raw.volume ?? 0);
  const turnover = Number(raw.turnover ?? 0);

  if (![timestamp, open, high, low, close].every(Number.isFinite)) return null;

  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0,
    turnover: Number.isFinite(turnover) ? turnover : undefined,
  };
}

function periodToApiPeriod(period: Period) {
  if (period.type === "minute") return `${period.span}m`;
  if (period.type === "hour") return `${period.span}h`;
  if (period.type === "day") return "day";
  if (period.type === "week") return "week";
  if (period.type === "month") return period.span === 3 ? "quarter" : "month";
  if (period.type === "year") return "year";
  return `${period.span}s`;
}

function generateMockBars(period: Period): KLineData[] {
  const count = 360;
  const step = periodToMilliseconds(period);
  const end = floorTimestamp(Date.now(), step);
  let close = 205;
  let trend = 0;

  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index / 14) * 2.4 + Math.cos(index / 31) * 3.2;
    trend += (Math.random() - 0.48) * 0.18;
    const open = close;
    close = Math.max(
      80,
      open + wave * 0.22 + trend + (Math.random() - 0.5) * 5.2,
    );
    const high = Math.max(open, close) + Math.random() * 4.6;
    const low = Math.min(open, close) - Math.random() * 4.6;

    return {
      timestamp: end - (count - index - 1) * step,
      open: roundPrice(open),
      high: roundPrice(high),
      low: roundPrice(low),
      close: roundPrice(close),
      volume: Math.round(1_800_000 + Math.random() * 6_000_000),
    };
  });
}

function periodToMilliseconds(period: Period) {
  const unitMap = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  };
  return unitMap[period.type] * period.span;
}

function floorTimestamp(timestamp: number, step: number) {
  return Math.floor(timestamp / step) * step;
}

function roundPrice(value: number) {
  return Number(value.toFixed(2));
}

export default KLineChartPage;
