import {
  BorderHorizontalOutlined,
  BorderVerticleOutlined,
  ClearOutlined,
  DeleteOutlined,
  DollarOutlined,
  EyeOutlined,
  FunctionOutlined,
  GatewayOutlined,
  LineOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RiseOutlined,
  SettingOutlined,
  StockOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Divider,
  Dropdown,
  Input,
  InputNumber,
  Popover,
  Select,
  Segmented,
  Slider,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
} from "antd";
import {
  dispose,
  init,
  registerIndicator,
  registerOverlay,
  type Chart,
  type DataLoadMore,
  type DataLoadType,
  type IndicatorTemplate,
  type KLineData,
  type OverlayCreate,
  type OverlayTemplate,
  type Period,
} from "klinecharts";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  GANN_PROJECTION_EVENT,
  readGannProjectionResult,
  saveGannBridgeSelection,
  saveGannProjectionResult,
  type GannProjectionPayload,
} from "../utils/gannBridge";
import { readKLineActiveSymbol, saveKLineActiveSymbol } from "../utils/kLineStore";
import {
  findNumberPosition,
  generateGannMatrix,
  getTrendExtensionPoints,
  type Trend,
} from "../utils/squareNine";

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

type TurningPointKind = "high" | "low";

type TurningPoint = {
  kind: TurningPointKind;
  timestamp: number;
  value: number;
  index: number;
  key: string;
};

type TurningPointMarkerData = {
  kind: TurningPointKind;
  label: string;
};

type ProjectionLineData = {
  kind: "main" | "cross";
  label: string;
};

type BuySellSignalData = {
  text: string;
  side: "buy" | "sell";
};

type LmacdData = {
  diff?: number;
  dea?: number;
  macd?: number;
};

type TurningPointHover = TurningPoint & {
  x: number;
  y: number;
  roundedValue: number;
};

type AdjustType = 0 | 1;

type WatchSymbol = {
  ticker: string;
  name: string;
  market: string;
  category?: string;
  nameCn?: string;
  nameHk?: string;
  nameEn?: string;
  exchange?: string;
  currency?: string;
  board?: string;
  watchedAt?: string;
  watchedPrice?: string;
  pricePrecision: number;
  volumePrecision: number;
};

const defaultSymbol = {
  ticker: "TSLA.US",
  name: "Tesla",
  market: "US",
  category: "us",
  pricePrecision: 2,
  volumePrecision: 2,
};

const API_BASE = "https://n1-longbridge.johnnywwy.com/api";
const STOCKS_API_URL = `${API_BASE}/stocks`;
const MARKET_API_BASE = `${API_BASE}/kline`;
const KLINE_COUNT = 1000;
const REQUEST_RANGE_MULTIPLIER = 3;
const HISTORY_LOAD_DEBOUNCE_MS = 280;
const REQUEST_NOW_BUCKET_MS = 30_000;
const MARKET_REQUEST_CACHE_MS = 20_000;
const MAX_SCROLL_DISTANCE = 10_000_000;
const KLINE_RIGHT_OFFSET = 96;
const KLINE_MAX_RIGHT_OFFSET = 720;
const TREND_TURNING_GROUP_ID = "trend-turning-points";
const GANN_PROJECTION_GROUP_ID = "gann-projection-lines";
const BUY_SELL_SIGNAL_GROUP_ID = "buy-sell-signals";
const BUY_SELL_SIGNAL_INDICATOR = "BUYSELL";
const GANN_PROJECTION_LOOP = 9;
const GANN_PROJECTION_POINT_LIMIT = 10;
const DEFAULT_TURNING_THRESHOLD = 1.8;
const stockCategoryOptions = [
  { label: "美股", value: "us" },
  { label: "A股", value: "cn" },
  { label: "港股", value: "hk" },
  { label: "期权", value: "usOptions" },
  { label: "其他", value: "other" },
];
const inflightMarketRequests = new Map<
  string,
  Promise<{ bars: KLineData[]; more: DataLoadMore }>
>();
const marketRequestCache = new Map<
  string,
  { expiresAt: number; data: { bars: KLineData[]; more: DataLoadMore } }
>();

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
const paneIndicators = ["VOL", "MACD", "LMACD", BUY_SELL_SIGNAL_INDICATOR, "KDJ", "RSI", "WR"];
const drawablePaneIndicators = paneIndicators.filter(
  (name) => name !== BUY_SELL_SIGNAL_INDICATOR,
);
const adjustOptions: Array<{ label: string; value: AdjustType }> = [
  { label: "除权", value: 0 },
  { label: "前复权", value: 1 },
];

const drawingTools: DrawingTool[] = [
  { label: "趋势线", icon: <LineOutlined />, overlay: "segment" },
  { label: "射线", icon: <RiseOutlined />, overlay: "rayLine" },
  {
    label: "水平线",
    icon: <BorderHorizontalOutlined />,
    overlay: "horizontalStraightLine",
  },
  {
    label: "垂直线",
    icon: <BorderVerticleOutlined />,
    overlay: "verticalStraightLine",
  },
  { label: "价格线", icon: <DollarOutlined />, overlay: "priceLine" },
  { label: "价格通道", icon: <GatewayOutlined />, overlay: "priceChannelLine" },
  { label: "斐波那契", icon: <FunctionOutlined />, overlay: "fibonacciLine" },
];

const turningPointTheme: Record<
  TurningPointKind,
  {
    textColor: string;
    backgroundColor: string;
    borderColor: string;
    lineColor: string;
    popupShadow: string;
  }
> = {
  // 文字统一黑色；高点/低点只通过标注背景色区分。
  high: {
    textColor: "#111827",
    backgroundColor: "rgba(242, 54, 69, 0.18)",
    borderColor: "rgba(242, 54, 69, 0.78)",
    lineColor: "rgba(242, 54, 69, 0.42)",
    popupShadow: "0 12px 30px rgba(242, 54, 69, 0.12)",
  },
  low: {
    textColor: "#111827",
    backgroundColor: "rgba(8, 153, 129, 0.18)",
    borderColor: "rgba(8, 153, 129, 0.78)",
    lineColor: "rgba(8, 153, 129, 0.42)",
    popupShadow: "0 12px 30px rgba(8, 153, 129, 0.12)",
  },
};

function getTurningPointTheme(kind: TurningPointKind) {
  return turningPointTheme[kind];
}

const trendTurnMarkerOverlay: OverlayTemplate<TurningPointMarkerData> = {
  name: "trendTurnMarker",
  totalStep: 1,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ overlay, coordinates }) => {
    const coordinate = coordinates[0];
    const data = overlay.extendData as TurningPointMarkerData;
    const isHigh = data.kind === "high";
    const theme = getTurningPointTheme(data.kind);
    const width = Math.max(48, data.label.length * 11 + 16);
    const height = 22;
    const y = coordinate.y + (isHigh ? -34 : 12);

    return [
      {
        type: "rect",
        attrs: {
          x: coordinate.x - width / 2,
          y,
          width,
          height,
        },
        styles: {
          style: "fill",
          color: theme.backgroundColor,
          borderColor: theme.borderColor,
          borderSize: 1,
          borderRadius: 6,
        },
        ignoreEvent: true,
      },
      {
        type: "text",
        attrs: {
          x: coordinate.x,
          y: y + height / 2,
          text: data.label,
          align: "center",
          baseline: "middle",
        },
        styles: {
          // 注意：KLineCharts 的 text 图形默认自带蓝色 backgroundColor/borderColor。
          // 这里必须显式清掉，否则会看到一层蓝色框包住“高点/低点”。
          color: theme.textColor,
          size: 11,
          weight: "600",
          backgroundColor: "transparent",
          borderColor: "transparent",
          borderSize: 0,
          borderRadius: 0,
          paddingLeft: 0,
          paddingRight: 0,
          paddingTop: 0,
          paddingBottom: 0,
        },
        ignoreEvent: true,
      },
    ];
  },
};

registerOverlay(trendTurnMarkerOverlay);

const gannProjectionLineOverlay: OverlayTemplate<ProjectionLineData> = {
  name: "gannProjectionLine",
  totalStep: 1,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ overlay, coordinates, bounding }) => {
    const coordinate = coordinates[0];
    const isMain = overlay.extendData.kind === "main";
    const color = isMain ? "#1677ff" : "#fa8c16";
    return [
      {
        type: "line",
        attrs: {
          coordinates: [
            { x: 0, y: coordinate.y },
            { x: bounding.width, y: coordinate.y },
          ],
        },
        styles: {
          color,
          size: 2,
          style: "dashed",
          dashedValue: isMain ? [6, 4] : [3, 4],
        },
        ignoreEvent: true,
      },
      {
        type: "text",
        attrs: {
          x: 8,
          y: coordinate.y - 8,
          text: overlay.extendData.label,
          align: "left",
          baseline: "bottom",
        },
        styles: {
          color,
          size: 14,
          weight: "600",
          backgroundColor: "rgba(255,255,255,0.88)",
          borderRadius: 4,
          paddingLeft: 5,
          paddingRight: 5,
          paddingTop: 2,
          paddingBottom: 2,
        },
        ignoreEvent: true,
      },
    ];
  },
};

registerOverlay(gannProjectionLineOverlay);

const buySellSignalOverlay: OverlayTemplate<BuySellSignalData> = {
  name: "buySellSignal",
  totalStep: 1,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ overlay, coordinates }) => {
    const coordinate = coordinates[0];
    const data = overlay.extendData as BuySellSignalData;
    const isBuy = data.side === "buy";
    const backgroundColor = isBuy
      ? "rgba(8, 153, 129, 0.14)"
      : "rgba(242, 54, 69, 0.14)";
    const borderColor = isBuy ? "rgba(8, 153, 129, 0.72)" : "rgba(242, 54, 69, 0.72)";
    const y = coordinate.y + (isBuy ? 18 : -18);

    return [
      {
        type: "text",
        attrs: {
          x: coordinate.x,
          y,
          text: data.text,
          align: "center",
          baseline: "middle",
        },
        styles: {
          color: "#9d174d",
          size: 12,
          weight: "700",
          backgroundColor,
          borderColor,
          borderSize: 1,
          borderRadius: 6,
          paddingLeft: 6,
          paddingRight: 6,
          paddingTop: 3,
          paddingBottom: 3,
        },
        ignoreEvent: true,
      },
    ];
  },
};

registerOverlay(buySellSignalOverlay);

const lmacdIndicator: IndicatorTemplate<LmacdData, number> = {
  name: "LMACD",
  shortName: "LMACD",
  calcParams: [12, 26, 9],
  figures: [
    { key: "diff", title: "DIFF: ", type: "line" },
    { key: "dea", title: "DEA: ", type: "line" },
    {
      key: "macd",
      title: "MACD: ",
      type: "bar",
      baseValue: 0,
      styles: ({ data, defaultStyles }) => {
        const currentMacd = data.current?.macd ?? 0;
        const prevMacd = data.prev?.macd ?? currentMacd;
        const fallbackBars = defaultStyles?.bars ?? [];
        const upColor = fallbackBars[0]?.upColor ?? "#f23645";
        const downColor = fallbackBars[0]?.downColor ?? "#089981";
        const noChangeColor = fallbackBars[0]?.noChangeColor ?? "#888888";
        const color =
          currentMacd > 0 ? upColor : currentMacd < 0 ? downColor : noChangeColor;

        return {
          color,
          borderColor: color,
          style: prevMacd < currentMacd ? "stroke" : "fill",
        };
      },
    },
  ],
  calc: (dataList, indicator) => {
    const [shortPeriod, longPeriod, signalPeriod] = indicator.calcParams;
    const maxPeriod = Math.max(shortPeriod, longPeriod);
    let closeSum = 0;
    let emaShort = 0;
    let emaLong = 0;
    let diff = 0;
    let diffSum = 0;
    let dea = 0;

    return dataList.map((bar, index) => {
      const item: LmacdData = {};
      const close = Number(bar.close);
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
  },
};

registerIndicator(lmacdIndicator);

function KLineChartPage() {
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const marketBarsRef = useRef<KLineData[]>([]);
  const turningPointsRef = useRef<TurningPoint[]>([]);
  const showTurningPointsRef = useRef(true);
  const turningThresholdRef = useRef(DEFAULT_TURNING_THRESHOLD);
  const projectionRef = useRef<GannProjectionPayload | null>(null);
  const projectionLineVisibleRef = useRef({ main: true, cross: false });
  const paneIndicatorsRef = useRef<string[]>(["RSI"]);
  const [activeSymbol, setActiveSymbol] = useState<WatchSymbol>(() => ({
    ...defaultSymbol,
    ticker: readKLineActiveSymbol()?.ticker ?? defaultSymbol.ticker,
  }));
  const [watchSymbols, setWatchSymbols] =
    useState<WatchSymbol[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [periodValue, setPeriodValue] = useState("1d");
  const [mainIndicator, setMainIndicator] = useState("MA");
  const [selectedPaneIndicators, setSelectedPaneIndicators] = useState<string[]>(["RSI"]);
  const [drawingTool, setDrawingTool] = useState<string | null>(null);
  const [zoomEnabled, setZoomEnabled] = useState(true);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [showTools, setShowTools] = useState(true);
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(false);
  const [showTurningPoints, setShowTurningPoints] = useState(true);
  const [turningThreshold, setTurningThreshold] = useState(DEFAULT_TURNING_THRESHOLD);
  const [showMainProjection, setShowMainProjection] = useState(true);
  const [showCrossProjection, setShowCrossProjection] = useState(true);
  const [selectedTurningPoint, setSelectedTurningPoint] =
    useState<TurningPointHover | null>(null);
  const [loadingCount, setLoadingCount] = useState(0);
  const [loadingText, setLoadingText] = useState("正在加载 K 线数据");
  const [adjustType, setAdjustType] = useState<AdjustType>(1);
  const adjustTypeRef = useRef<AdjustType>(1);
  const adjustEffectReadyRef = useRef(false);
  const periodEffectReadyRef = useRef(false);
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
    let cancelled = false;

    const loadStocks = async () => {
      setWatchlistLoading(true);
      setWatchlistError(null);
      try {
        const stocks = await fetchWatchSymbols();
        if (cancelled) return;
        if (stocks.length > 0) {
          setWatchSymbols(stocks);
          setActiveSymbol((current) => {
            const storedTicker = readKLineActiveSymbol()?.ticker;
            const matched = stocks.find(
              (item) => item.ticker === (storedTicker ?? current.ticker),
            );
            return matched ?? stocks[0];
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Stock list api fallback", error);
          setWatchlistError("自选股接口加载失败");
          setWatchSymbols([]);
        }
      } finally {
        if (!cancelled) setWatchlistLoading(false);
      }
    };

    void loadStocks();

    return () => {
      cancelled = true;
    };
  }, []);

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
            marketBarsRef.current = mergeMarketBars(
              marketBarsRef.current,
              bars,
              type,
            );
            turningPointsRef.current = renderTrendTurningPoints(
              chart,
              marketBarsRef.current,
              showTurningPointsRef.current,
              turningThresholdRef.current,
            );
            renderBuySellSignalOverlays(
              chart,
              marketBarsRef.current,
              paneIndicatorsRef.current.includes(BUY_SELL_SIGNAL_INDICATOR),
            );
          } catch (error) {
            console.warn("K line api failed", error);
            if (type === "init") {
              marketBarsRef.current = [];
              turningPointsRef.current = [];
              setSelectedTurningPoint(null);
              chart.removeOverlay({ groupId: TREND_TURNING_GROUP_ID });
              chart.removeOverlay({ groupId: GANN_PROJECTION_GROUP_ID });
              chart.removeOverlay({ groupId: BUY_SELL_SIGNAL_GROUP_ID });
              projectionRef.current = null;
            }
            callback([], {
              backward: false,
              forward: false,
            });
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
    chart.setSymbol(activeSymbol);
    chart.setPeriod(activePeriod.period);
    chart.createIndicator("MA", true, { id: "candle_pane" });
    chart.setMaxOffsetLeftDistance(MAX_SCROLL_DISTANCE);
    chart.setMaxOffsetRightDistance(KLINE_MAX_RIGHT_OFFSET);
    chart.setOffsetRightDistance(KLINE_RIGHT_OFFSET);

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
    const chart = chartRef.current;
    if (!chart) return;
    saveKLineActiveSymbol(activeSymbol);
    marketBarsRef.current = [];
    turningPointsRef.current = [];
    setSelectedTurningPoint(null);
    chart.removeOverlay({ groupId: TREND_TURNING_GROUP_ID });
    chart.removeOverlay({ groupId: GANN_PROJECTION_GROUP_ID });
    chart.removeOverlay({ groupId: BUY_SELL_SIGNAL_GROUP_ID });
    projectionRef.current = null;
    chart.setSymbol(activeSymbol);
    chart.resetData();
  }, [activeSymbol]);

  useEffect(() => {
    adjustTypeRef.current = adjustType;
    if (!adjustEffectReadyRef.current) {
      adjustEffectReadyRef.current = true;
      return;
    }
    marketBarsRef.current = [];
    turningPointsRef.current = [];
    setSelectedTurningPoint(null);
    chartRef.current?.removeOverlay({ groupId: TREND_TURNING_GROUP_ID });
    chartRef.current?.removeOverlay({ groupId: GANN_PROJECTION_GROUP_ID });
    chartRef.current?.removeOverlay({ groupId: BUY_SELL_SIGNAL_GROUP_ID });
    projectionRef.current = null;
    chartRef.current?.resetData();
  }, [adjustType]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!periodEffectReadyRef.current) {
      periodEffectReadyRef.current = true;
      return;
    }
    marketBarsRef.current = [];
    turningPointsRef.current = [];
    setSelectedTurningPoint(null);
    chart.removeOverlay({ groupId: TREND_TURNING_GROUP_ID });
    chart.removeOverlay({ groupId: GANN_PROJECTION_GROUP_ID });
    chart.removeOverlay({ groupId: BUY_SELL_SIGNAL_GROUP_ID });
    projectionRef.current = null;
    chart.setPeriod(activePeriod.period);
    chart.resetData();
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
    paneIndicatorsRef.current = selectedPaneIndicators;
    drawablePaneIndicators.forEach((name) =>
      chart.removeIndicator({ name, paneId: "indicator_pane" }),
    );
    selectedPaneIndicators
      .filter((name) => name !== BUY_SELL_SIGNAL_INDICATOR)
      .forEach((name) => {
        chart.createIndicator(name, false, {
          id: "indicator_pane",
          height: 116,
          minHeight: 80,
        });
      });
    renderBuySellSignalOverlays(
      chart,
      marketBarsRef.current,
      selectedPaneIndicators.includes(BUY_SELL_SIGNAL_INDICATOR),
    );
  }, [selectedPaneIndicators]);

  useEffect(() => {
    paneIndicatorsRef.current = selectedPaneIndicators;
  }, [selectedPaneIndicators]);

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

  useEffect(() => {
    const storedProjection = readGannProjectionResult();
    if (storedProjection) {
      projectionRef.current = storedProjection;
      renderGannProjectionLines(
        chartRef.current,
        storedProjection,
        projectionLineVisibleRef.current,
      );
    }

    const handleProjection = (event: Event) => {
      const detail = (event as CustomEvent<GannProjectionPayload>).detail;
      if (!detail) return;
      projectionRef.current = detail;
      renderGannProjectionLines(
        chartRef.current,
        detail,
        projectionLineVisibleRef.current,
      );
    };

    window.addEventListener(GANN_PROJECTION_EVENT, handleProjection);
    return () =>
      window.removeEventListener(GANN_PROJECTION_EVENT, handleProjection);
  }, []);

  useEffect(() => {
    const visible = {
      main: showMainProjection,
      cross: showCrossProjection,
    };
    projectionLineVisibleRef.current = visible;
    if (projectionRef.current) {
      renderGannProjectionLines(chartRef.current, projectionRef.current, visible);
    }
  }, [showMainProjection, showCrossProjection]);

  useEffect(() => {
    showTurningPointsRef.current = showTurningPoints;
    turningThresholdRef.current = turningThreshold;
    const chart = chartRef.current;
    if (!chart) return;
    turningPointsRef.current = renderTrendTurningPoints(
      chart,
      marketBarsRef.current,
      showTurningPoints,
      turningThreshold,
    );
    setSelectedTurningPoint(null);
  }, [showTurningPoints, turningThreshold]);

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

  const handleChartClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const chart = chartRef.current;
    const host = chartHostRef.current;
    if (!chart || !host || turningPointsRef.current.length === 0) {
      setSelectedTurningPoint(null);
      return;
    }

    const rect = host.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const match = findTurningPointByPixel(chart, turningPointsRef.current, x, y);

    if (match) {
      setSelectedTurningPoint(match);
      return;
    }

    setSelectedTurningPoint(null);
  };

  const handleTrendSelect = (trend: Trend) => {
    if (!selectedTurningPoint) return;
    const source = `${activeSymbol.ticker} ${
      selectedTurningPoint.kind === "high" ? "高点" : "低点"
    }`;
    saveGannBridgeSelection({
      value: selectedTurningPoint.roundedValue,
      trend,
      source,
    });
    const projection = calculateGannProjectionFromPrice(
      selectedTurningPoint.roundedValue,
      trend,
      source,
    );
    projectionRef.current = projection as GannProjectionPayload;
    renderGannProjectionLines(
      chartRef.current,
      projection,
      projectionLineVisibleRef.current,
    );
    saveGannProjectionResult(projection);
    setSelectedTurningPoint(null);
  };

  return (
    <main className="h-screen overflow-hidden bg-[#f5f5f5] pb-24">
      <section className="flex h-full min-h-0 gap-3 bg-[#f7f9fc] p-3">
        <WatchlistCard
          symbols={watchSymbols}
          activeTicker={activeSymbol.ticker}
          loading={watchlistLoading}
          error={watchlistError}
          collapsed={watchlistCollapsed}
          onCollapsedChange={setWatchlistCollapsed}
          onSelect={setActiveSymbol}
        />

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
          <TopToolbar
            symbol={activeSymbol}
            periodValue={periodValue}
            mainIndicator={mainIndicator}
            selectedPaneIndicators={selectedPaneIndicators}
            zoomEnabled={zoomEnabled}
            scrollEnabled={scrollEnabled}
            showTools={showTools}
            showTurningPoints={showTurningPoints}
            turningThreshold={turningThreshold}
            showMainProjection={showMainProjection}
            showCrossProjection={showCrossProjection}
            onPeriodChange={setPeriodValue}
            onMainIndicatorChange={setMainIndicator}
            onPaneIndicatorsChange={setSelectedPaneIndicators}
            onZoomEnabledChange={setZoomEnabled}
            onScrollEnabledChange={setScrollEnabled}
            onShowToolsChange={setShowTools}
            onShowTurningPointsChange={setShowTurningPoints}
            onTurningThresholdChange={setTurningThreshold}
            onShowMainProjectionChange={setShowMainProjection}
            onShowCrossProjectionChange={setShowCrossProjection}
            adjustType={adjustType}
            onAdjustTypeChange={setAdjustType}
          />

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <LeftToolbar
              visible={showTools}
              activeTool={drawingTool}
              onToolSelect={createOverlay}
              onClear={clearOverlays}
            />
            <div
              className="relative min-w-0 flex-1 bg-white"
              onClick={handleChartClick}
            >
              <div ref={chartHostRef} className="h-full w-full" />
              {selectedTurningPoint && (
                <TurningPointActionPopup
                  point={selectedTurningPoint}
                  onClose={() => setSelectedTurningPoint(null)}
                  onTrendSelect={handleTrendSelect}
                />
              )}
              {loadingCount > 0 && (
                <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-white/38 backdrop-blur-[1px]">
                  <div className="rounded-lg border border-slate-200 bg-white/95 px-4 py-3 shadow-lg">
                    <Spin tip={loadingText} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}


function TurningPointActionPopup({
  point,
  onClose,
  onTrendSelect,
}: {
  point: TurningPointHover;
  onClose: () => void;
  onTrendSelect: (trend: Trend) => void;
}) {
  const title = point.kind === "high" ? "高点" : "低点";
  const theme = getTurningPointTheme(point.kind);
  const popupLeft = point.x + 18;
  const popupTop = Math.max(8, point.y - 36);

  return (
    <div
      className="absolute z-20 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"
      style={{
        left: popupLeft,
        top: popupTop,
        boxShadow: theme.popupShadow,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="mb-2 flex items-center justify-between gap-3 text-xs font-medium"
        style={{ color: theme.textColor }}
      >
        <span>
          {title} {point.roundedValue}
        </span>
        <Button size="small" type="text" onClick={onClose}>
          ×
        </Button>
      </div>
      <Space size={6}>
        <Button
          size="small"
          type="primary"
          danger
          onClick={() => onTrendSelect("up")}
        >
          推上升
        </Button>
        <Button
          size="small"
          type="primary"
          className="bg-[#089981]"
          onClick={() => onTrendSelect("down")}
        >
          推下降
        </Button>
      </Space>
    </div>
  );
}

function TopToolbar({
  symbol,
  periodValue,
  mainIndicator,
  selectedPaneIndicators,
  zoomEnabled,
  scrollEnabled,
  showTools,
  showTurningPoints,
  turningThreshold,
  showMainProjection,
  showCrossProjection,
  onPeriodChange,
  onMainIndicatorChange,
  onPaneIndicatorsChange,
  onZoomEnabledChange,
  onScrollEnabledChange,
  onShowToolsChange,
  onShowTurningPointsChange,
  onTurningThresholdChange,
  onShowMainProjectionChange,
  onShowCrossProjectionChange,
  adjustType,
  onAdjustTypeChange,
}: {
  symbol: WatchSymbol;
  periodValue: string;
  mainIndicator: string;
  selectedPaneIndicators: string[];
  zoomEnabled: boolean;
  scrollEnabled: boolean;
  showTools: boolean;
  showTurningPoints: boolean;
  turningThreshold: number;
  showMainProjection: boolean;
  showCrossProjection: boolean;
  onPeriodChange: (value: string) => void;
  onMainIndicatorChange: (value: string) => void;
  onPaneIndicatorsChange: (value: string[]) => void;
  onZoomEnabledChange: (value: boolean) => void;
  onScrollEnabledChange: (value: boolean) => void;
  onShowToolsChange: (value: boolean) => void;
  onShowTurningPointsChange: (value: boolean) => void;
  onTurningThresholdChange: (value: number) => void;
  onShowMainProjectionChange: (value: boolean) => void;
  onShowCrossProjectionChange: (value: boolean) => void;
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
      <SettingRow label="转折点">
        <Switch
          size="small"
          checked={showTurningPoints}
          onChange={onShowTurningPointsChange}
        />
      </SettingRow>
      <SettingRow label="主线">
        <Switch
          size="small"
          checked={showMainProjection}
          onChange={onShowMainProjectionChange}
        />
      </SettingRow>
      <SettingRow label="副线">
        <Switch
          size="small"
          checked={showCrossProjection}
          onChange={onShowCrossProjectionChange}
        />
      </SettingRow>
      <div className="min-w-[220px]">
        <div className="mb-2 flex items-center justify-between gap-4 text-sm text-slate-600">
          <span>转折阈值</span>
          <InputNumber
            size="small"
            min={0.5}
            max={8}
            step={0.1}
            value={turningThreshold}
            onChange={(value) => {
              if (typeof value === "number") onTurningThresholdChange(value);
            }}
          />
        </div>
        <Slider
          min={0.5}
          max={8}
          step={0.1}
          value={turningThreshold}
          onChange={onTurningThresholdChange}
        />
      </div>
    </Space>
  );

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3">
      <div className="flex h-8 items-center gap-2 border-r border-slate-200 pr-3">
        <StockOutlined className="text-[#1677ff]" />
        <span className="text-base font-semibold text-slate-950">
          {symbol.ticker}
        </span>
        <Tag color="success" bordered={false}>
          接口
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
        mode="multiple"
        size="small"
        value={selectedPaneIndicators}
        className="min-w-[168px]"
        maxTagCount="responsive"
        placeholder="副图"
        options={paneIndicators.map((name) => ({ label: name, value: name }))}
        onChange={onPaneIndicatorsChange}
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

function WatchlistCard({
  symbols,
  activeTicker,
  loading,
  error,
  collapsed,
  onCollapsedChange,
  onSelect,
}: {
  symbols: WatchSymbol[];
  activeTicker: string;
  loading: boolean;
  error: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onSelect: (symbol: WatchSymbol) => void;
}) {
  const [activeCategory, setActiveCategory] = useState("us");
  const [keyword, setKeyword] = useState("");
  const visibleCategoryOptions = stockCategoryOptions
    .map((option) => ({
      ...option,
      count: symbols.filter((item) => item.category === option.value).length,
    }))
    .filter((option) => option.count > 0);
  const selectedCategory = visibleCategoryOptions.some(
    (option) => option.value === activeCategory,
  )
    ? activeCategory
    : visibleCategoryOptions[0]?.value || "us";
  const visibleSymbols = symbols.filter(
    (item) => item.category === selectedCategory,
  );
  const normalizedKeyword = keyword.trim().toLowerCase();
  const searchedSymbols = normalizedKeyword
    ? visibleSymbols.filter((item) =>
        [
          item.ticker,
          item.name,
          item.nameCn,
          item.nameHk,
          item.nameEn,
          item.market,
          item.exchange,
        ]
          .filter(Boolean)
          .some((value) =>
            String(value).toLowerCase().includes(normalizedKeyword),
          ),
      )
    : visibleSymbols;

  if (collapsed) {
    return (
      <aside className="flex h-full w-12 shrink-0 flex-col items-center rounded-lg border border-slate-200 bg-white py-3 transition-all">
        <Tooltip placement="right" title="展开自选股">
          <Button
            type="text"
            icon={<MenuUnfoldOutlined />}
            onClick={() => onCollapsedChange(false)}
          />
        </Tooltip>
        <div className="mt-3 [writing-mode:vertical-rl] text-xs font-medium tracking-wide text-slate-500">
          自选股
        </div>
      </aside>
    );
  }

  return (
    <aside className="h-full min-h-0 w-[320px] shrink-0 rounded-lg border border-slate-200 bg-white transition-all">
      <Card
        size="small"
        title="自选股"
        extra={
          <Tooltip title="折叠自选股">
            <Button
              size="small"
              type="text"
              icon={<MenuFoldOutlined />}
              onClick={() => onCollapsedChange(true)}
            />
          </Tooltip>
        }
        className="h-full"
        styles={{ body: { height: "calc(100% - 38px)", padding: 8 } }}
      >
        <div className="flex h-full min-h-0 flex-col gap-2">
          <Segmented
            block
            size="small"
            value={selectedCategory}
            options={visibleCategoryOptions.map((option) => ({
              label: `${option.label} ${option.count}`,
              value: option.value,
            }))}
            onChange={(value) => setActiveCategory(String(value))}
          />
          <Input.Search
            allowClear
            size="small"
            placeholder="搜索代码 / 名称"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
          {loading && (
            <div className="px-2 py-1 text-xs text-slate-400">加载中...</div>
          )}
          {error && !loading && (
            <div className="px-2 py-1 text-xs text-amber-600">{error}</div>
          )}
          {searchedSymbols.map((item) => {
            const active = item.ticker === activeTicker;
            return (
              <button
                key={item.ticker}
                type="button"
                onClick={() => onSelect(item)}
                className={`rounded-md border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-[#1677ff] bg-blue-50 text-[#1677ff]"
                    : "border-transparent bg-white text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{item.ticker}</span>
                  <Tag color={active ? "processing" : "default"} bordered={false}>
                    {item.market}
                  </Tag>
                </div>
                <div className="mt-1 truncate text-xs text-slate-500">
                  {item.name}
                </div>
              </button>
            );
          })}
          </div>
        </div>
      </Card>
    </aside>
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

async function fetchWatchSymbols() {
  const response = await fetch(STOCKS_API_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Stock api failed: ${response.status}`);
  }

  const payload = await response.json();
  const rawStocks = extractStockRows(payload);

  return rawStocks
    .map(normalizeWatchSymbol)
    .filter((item: WatchSymbol | null): item is WatchSymbol => item !== null)
    .filter(createWatchSymbolDedupe());
}

function normalizeWatchSymbol(raw: Record<string, unknown>): WatchSymbol | null {
  const ticker = String(raw.ticker ?? raw.symbol ?? raw.code ?? "").trim();
  if (!ticker) return null;

  const suffixMarket = ticker.includes(".") ? ticker.split(".").at(-1) : "";
  const nameCn = getStringValue(raw.nameCn);
  const nameHk = getStringValue(raw.nameHk);
  const nameEn = getStringValue(raw.nameEn);
  const watchedPrice = getStringValue(raw.watchedPrice);
  const market =
    getStringValue(raw.market) ||
    getStringValue(raw.region) ||
    getStringValue(raw.exchange) ||
    suffixMarket ||
    "";
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
      inferStockCategory(ticker, market, getStringValue(raw.board)),
    nameCn,
    nameHk,
    nameEn,
    exchange: getStringValue(raw.exchange),
    currency: getStringValue(raw.currency),
    board: getStringValue(raw.board),
    watchedAt: getStringValue(raw.watchedAt),
    watchedPrice,
    pricePrecision: Number(raw.pricePrecision ?? 2),
    volumePrecision: Number(raw.volumePrecision ?? 2),
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
  if (categoryRows.length > 0) {
    return categoryRows;
  }

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
    asRecordArray(categories[option.value]).map((row) => ({
      ...row,
      __category: option.value,
    })),
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

function renderBuySellSignalOverlays(
  chart: Chart,
  bars: KLineData[],
  visible: boolean,
) {
  chart.removeOverlay({ groupId: BUY_SELL_SIGNAL_GROUP_ID });
  if (!visible || bars.length < 16) return;

  const overlays = calculateBuySellSignals(bars).map<OverlayCreate>((signal) => ({
    name: "buySellSignal",
    groupId: BUY_SELL_SIGNAL_GROUP_ID,
    lock: true,
    zLevel: 24,
    points: [{ timestamp: signal.timestamp, value: signal.value }],
    extendData: {
      text: signal.text,
      side: signal.side,
    },
  }));

  if (overlays.length > 0) chart.createOverlay(overlays);
}

function calculateBuySellSignals(bars: KLineData[]) {
  const result: Array<{
    timestamp: number;
    value: number;
    text: string;
    side: "buy" | "sell";
  }> = [];
  let previousBuy1 = false;
  let previousBuy2 = false;
  let previousSell1 = false;
  let previousSell2 = false;

  for (let index = 0; index < bars.length; index += 1) {
    const buy1 = isContinuousCloseCompare(bars, index, 9, "lt");
    const buy2 = isContinuousCloseCompare(bars, index, 12, "lt");
    const sell1 = isContinuousCloseCompare(bars, index, 9, "gt");
    const sell2 = isContinuousCloseCompare(bars, index, 12, "gt");
    const bar = bars[index];
    const high = Number(bar.high);
    const low = Number(bar.low);
    const close = Number(bar.close);
    const padding = Math.max((high - low) * 0.35, close * 0.002);

    if (buy1 && !previousBuy1) {
      result.push({
        timestamp: Number(bar.timestamp),
        value: low - padding,
        text: "买1",
        side: "buy",
      });
    }
    if (buy2 && !previousBuy2) {
      result.push({
        timestamp: Number(bar.timestamp),
        value: low - padding * 1.9,
        text: "买2",
        side: "buy",
      });
    }
    if (sell1 && !previousSell1) {
      result.push({
        timestamp: Number(bar.timestamp),
        value: high + padding,
        text: "卖1",
        side: "sell",
      });
    }
    if (sell2 && !previousSell2) {
      result.push({
        timestamp: Number(bar.timestamp),
        value: high + padding * 1.9,
        text: "卖2",
        side: "sell",
      });
    }

    previousBuy1 = buy1;
    previousBuy2 = buy2;
    previousSell1 = sell1;
    previousSell2 = sell2;
  }

  return result;
}

function isContinuousCloseCompare(
  bars: KLineData[],
  index: number,
  count: number,
  direction: "lt" | "gt",
) {
  if (index - count - 3 < 0) return false;

  for (let offset = 0; offset < count; offset += 1) {
    const current = Number(bars[index - offset]?.close);
    const reference = Number(bars[index - offset - 4]?.close);
    if (!Number.isFinite(current) || !Number.isFinite(reference)) return false;
    if (direction === "lt" && current >= reference) return false;
    if (direction === "gt" && current <= reference) return false;
  }

  return true;
}

function renderTrendTurningPoints(
  chart: Chart,
  bars: KLineData[],
  visible: boolean,
  threshold: number,
) {
  chart.removeOverlay({ groupId: TREND_TURNING_GROUP_ID });
  if (!visible) {
    return [];
  }

  const points = calculateMajorTurningPoints(bars, threshold);
  if (points.length < 2) return points;

  const overlays: OverlayCreate[] = [];
  points.forEach((point) => {
    overlays.push({
      name: "trendTurnMarker",
      groupId: TREND_TURNING_GROUP_ID,
      lock: true,
      zLevel: 20,
      points: [{ timestamp: point.timestamp, value: point.value }],
      extendData: {
        kind: point.kind,
        label: `${point.kind === "high" ? "高点" : "低点"} ${Math.round(point.value)}`,
      },
    });
  });

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    overlays.push({
      name: "segment",
      groupId: TREND_TURNING_GROUP_ID,
      lock: true,
      zLevel: 10,
      needDefaultPointFigure: false,
      points: [
        { timestamp: previous.timestamp, value: previous.value },
        { timestamp: current.timestamp, value: current.value },
      ],
      styles: {
        line: {
          color: getTurningPointTheme(current.kind).lineColor,
          size: 1,
          style: "dashed",
          dashedValue: [5, 4],
        },
      },
    });
  }

  chart.createOverlay(overlays);
  return points;
}

function calculateMajorTurningPoints(
  bars: KLineData[],
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
    for (let offset = index - pivotWindow; offset <= index + pivotWindow; offset += 1) {
      if (offset === index) continue;
      if (high < highs[offset]) isHigh = false;
      if (low > lows[offset]) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) {
      candidates.push({
        kind: "high",
        timestamp: Number(bars[index].timestamp),
        value: high,
        index,
        key: `high:${bars[index].timestamp}:${high}`,
      });
    }
    if (isLow) {
      candidates.push({
        kind: "low",
        timestamp: Number(bars[index].timestamp),
        value: low,
        index,
        key: `low:${bars[index].timestamp}:${low}`,
      });
    }
  }

  return compressTurningPoints(candidates, minMove, pivotWindow).slice(-36);
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

function calculateAverageTrueRange(bars: KLineData[], period: number) {
  const trueRanges: number[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const high = Number(bars[index].high);
    const low = Number(bars[index].low);
    const prevClose = Number(bars[index - 1].close);
    if (![high, low, prevClose].every(Number.isFinite)) continue;
    trueRanges.push(
      Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)),
    );
  }

  const recent = trueRanges.slice(-period * 3);
  if (recent.length === 0) return 0;
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatPrice(value: number) {
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(4);
}

function mergeMarketBars(
  current: KLineData[],
  next: KLineData[],
  loadType: DataLoadType,
) {
  if (next.length === 0) return current;
  const merged =
    loadType === "forward"
      ? [...next, ...current]
      : loadType === "backward" || loadType === "update"
        ? [...current, ...next]
        : next;
  const byTimestamp = new Map<number, KLineData>();
  merged.forEach((bar) => byTimestamp.set(Number(bar.timestamp), bar));
  return Array.from(byTimestamp.values()).sort(
    (a, b) => Number(a.timestamp) - Number(b.timestamp),
  );
}

function findTurningPointByPixel(
  chart: Chart,
  points: TurningPoint[],
  x: number,
  y: number,
): TurningPointHover | null {
  for (const point of points) {
    const pixel = chart.convertToPixel(
      { timestamp: point.timestamp, value: point.value },
      { paneId: "candle_pane", absolute: true },
    ) as Partial<{ x: number; y: number }>;
    if (typeof pixel.x !== "number" || typeof pixel.y !== "number") continue;

    const labelY = pixel.y + (point.kind === "high" ? -23 : 23);
    const labelWidth = Math.max(48, `${point.kind === "high" ? "高点" : "低点"} ${Math.round(point.value)}`.length * 11 + 16);
    const isInside =
      x >= pixel.x - labelWidth / 2 &&
      x <= pixel.x + labelWidth / 2 &&
      y >= labelY - 14 &&
      y <= labelY + 14;
    if (isInside) {
      return {
        ...point,
        x: pixel.x,
        y: labelY,
        roundedValue: Math.max(1, Math.round(point.value)),
      };
    }
  }
  return null;
}

function calculateGannProjectionFromPrice(
  price: number,
  trend: Trend,
  source?: string,
): Omit<GannProjectionPayload, "updatedAt"> {
  const clickedValue = Math.max(1, Math.round(Number(price) || 1));
  const loop = getProjectionLoopForValue(clickedValue);
  const matrix = generateGannMatrix(1, 1, loop);
  const position = findNumberPosition(matrix, clickedValue);
  const r = position.r === -1 ? loop : position.r;
  const c = position.c === -1 ? loop : position.c;
  const result = getTrendExtensionPoints(matrix, r, c, trend, {
    loop,
  });

  const lines = [
    ...limitProjectionPoints(result.mainExtension, trend).map((point) => ({
      value: point.value,
      kind: "main" as const,
    })),
    ...limitProjectionPoints(result.crossExtension, trend).map((point) => ({
      value: point.value,
      kind: "cross" as const,
    })),
  ].filter((line) => line.value !== clickedValue);

  return {
    clickedValue,
    trend,
    source,
    lines: dedupeProjectionLines(lines),
  };
}

function getProjectionLoopForValue(value: number) {
  const requiredLoop = Math.ceil((Math.sqrt(Math.max(1, value)) - 1) / 2);
  return Math.max(GANN_PROJECTION_LOOP, requiredLoop + GANN_PROJECTION_POINT_LIMIT);
}

function limitProjectionPoints<T>(points: T[], trend: Trend) {
  return trend === "up" ? points.slice(0, GANN_PROJECTION_POINT_LIMIT) : points;
}

function renderGannProjectionLines(
  chart: Chart | null,
  projection: Omit<GannProjectionPayload, "updatedAt"> | GannProjectionPayload,
  visible: { main: boolean; cross: boolean } = { main: true, cross: false },
) {
  if (!chart) return;
  chart.removeOverlay({ groupId: GANN_PROJECTION_GROUP_ID });

  const overlays: OverlayCreate[] = dedupeProjectionLines(projection.lines)
    .filter((line) => visible[line.kind])
    .slice(0, 96)
    .map((line) => ({
      name: "gannProjectionLine",
      groupId: GANN_PROJECTION_GROUP_ID,
      lock: true,
      zLevel: 16,
      points: [{ timestamp: Date.now(), value: line.value }],
      extendData: {
        kind: line.kind,
        label: formatPrice(line.value),
      },
    }));

  if (overlays.length > 0) chart.createOverlay(overlays);
}

function dedupeProjectionLines(
  lines: Array<{ value: number; kind: "main" | "cross" }>,
) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const value = Number(line.value);
    if (!Number.isFinite(value) || value <= 0) return false;
    const key = `${line.kind}:${value.toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  if (from !== undefined) url.searchParams.set("from", String(from));
  url.searchParams.set("to", String(to));
  url.searchParams.set("adjust", String(adjustType));

  const requestKey = url.toString();
  const cachedRequest = marketRequestCache.get(requestKey);
  if (cachedRequest && cachedRequest.expiresAt > Date.now()) {
    return cachedRequest.data;
  }

  const existingRequest = inflightMarketRequests.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = fetch(url, { cache: "no-store" })
    .then(async (response) => {
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

      const result = {
        bars,
        more: getMarketLoadMore(loadType, bars.length),
      };

      marketRequestCache.set(requestKey, {
        expiresAt: Date.now() + MARKET_REQUEST_CACHE_MS,
        data: result,
      });

      return result;
    })
    .finally(() => {
      inflightMarketRequests.delete(requestKey);
    });

  inflightMarketRequests.set(requestKey, request);
  return request;
}

function getMarketRequestRange(
  period: Period,
  loadType: DataLoadType,
  anchorTimestamp: number | null,
) {
  const now = getRequestNow();
  const step = periodToMilliseconds(period);
  const span = step * KLINE_COUNT * REQUEST_RANGE_MULTIPLIER;
  const initSpan = getInitialRequestSpan(period, step);

  if (loadType === "forward" && anchorTimestamp) {
    const to = anchorTimestamp - 1;
    return { from: Math.max(0, to - span), to };
  }

  if ((loadType === "backward" || loadType === "update") && anchorTimestamp) {
    const from = anchorTimestamp + 1;
    return { from, to: Math.max(from, Math.min(now, from + span)) };
  }

  return { from: Math.max(0, now - initSpan), to: now };
}

function getRequestNow() {
  return Math.floor(Date.now() / REQUEST_NOW_BUCKET_MS) * REQUEST_NOW_BUCKET_MS;
}

function getInitialRequestSpan(period: Period, step: number) {
  if (period.type === "minute") return Math.max(step * KLINE_COUNT, 7 * 24 * 60 * 60 * 1000);
  if (period.type === "hour") return Math.max(step * KLINE_COUNT, 120 * 24 * 60 * 60 * 1000);
  return step * KLINE_COUNT;
}

function getMarketLoadMore(
  loadType: DataLoadType,
  barCount: number,
): DataLoadMore {
  const hasMore = barCount > 0;

  if (loadType === "init") {
    return { backward: false, forward: hasMore };
  }

  if (loadType === "forward") {
    return { backward: false, forward: hasMore };
  }

  if (loadType === "backward") {
    return { backward: hasMore, forward: true };
  }

  if (loadType === "update") {
    return { backward: hasMore, forward: true };
  }

  return { backward: false, forward: hasMore };
}

function normalizeApiBar(raw: Record<string, unknown>): KLineData | null {
  const timestamp = new Date(String(raw.timestamp ?? raw.time)).getTime();
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

export default KLineChartPage;
