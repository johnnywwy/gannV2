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
  PlusOutlined,
  RiseOutlined,
  SettingOutlined,
  StockOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Divider,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popover,
  Select,
  Segmented,
  Slider,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  message,
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
  saveGannTrendSegments,
  saveGannProjectionResult,
  type GannProjectionPayload,
} from "../utils/gannBridge";
import { readKLineActiveSymbol, saveKLineActiveSymbol } from "../utils/kLineStore";
import {
  calculateLmacdFormulaSignals,
  calculateLmacdFormulaValues,
  type LmacdFormulaSignalKind,
} from "../utils/lmacdFormula";
import {
  findNumberPosition,
  generateGannMatrix,
  getTrendExtensionPoints,
  type Trend,
} from "../utils/squareNine";
import {
  calculateMajorTurningPoints,
  buildDailyTrendSegments,
  readStoredTurningThreshold,
  formatDateFromTimestamp,
  normalizeTurningThreshold,
  saveTurningThreshold,
  type TurningPoint,
  type TurningPointKind,
  type DailyTrendSegment,
} from "../utils/turningPoints";

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

type TurningPointMarkerData = {
  kind: TurningPointKind;
  label: string;
};

type ProjectionLineData = {
  kind: "main" | "cross";
  label: string;
};

type DailyTrendSegmentOverlayData = {
  direction: "up" | "down";
  intervalDays: number;
};

type NtpSignalData = {
  text: string;
  side: "buy" | "sell";
  slot: number;
};

type LmacdData = {
  diff?: number;
  dea?: number;
  macd?: number;
};

type LmacdSignalKind = LmacdFormulaSignalKind;

type LmacdSignalData = {
  text: string;
  kind: LmacdSignalKind;
  slot: number;
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
  groupId?: number | null;
  groupName?: string;
  isSignalGroup?: boolean;
  pricePrecision: number;
  volumePrecision: number;
};

type SecuritySearchResult = {
  symbol: string;
  ticker?: string;
  code?: string;
  market?: string;
  name?: string;
  nameCn?: string;
  nameHk?: string;
  nameEn?: string;
  exchange?: string;
  currency?: string;
  board?: string;
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
const WATCHLIST_SYMBOLS_API_URL = `${API_BASE}/watchlist/symbols`;
const SECURITY_SEARCH_API_URL = `${API_BASE}/securities/search`;
const MARKET_API_BASE = `${API_BASE}/kline`;
const MIN_KLINE_REQUEST_COUNT = 1000;
const MAX_KLINE_REQUEST_COUNT = 12_000;
const DAILY_REQUEST_WINDOW_DAYS = 10_000;
const HOUR_REQUEST_WINDOW_DAYS = 120;
const MINUTE_REQUEST_WINDOW_DAYS = 7;
const HISTORY_LOAD_DEBOUNCE_MS = 280;
const REQUEST_NOW_BUCKET_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MARKET_REQUEST_CACHE_MS = 5_000;
const MARKET_POLL_INTERVAL_MS = 10_000;
const MAX_SCROLL_DISTANCE = 10_000_000;
const KLINE_RIGHT_OFFSET = 96;
const KLINE_MAX_RIGHT_OFFSET = 720;
const INDICATOR_PANE_ID = "indicator_pane";
const TREND_TURNING_GROUP_ID = "trend-turning-points";
const GANN_PROJECTION_GROUP_ID = "gann-projection-lines";
const NTP_SIGNAL_GROUP_ID = "ntp-signals";
const LMACD_SIGNAL_GROUP_ID = "lmacd-signals";
const ORB_OVERLAY_GROUP_ID = "orb-overlays";
const DAILY_TREND_GROUP_ID = "daily-trend-segments";
const NTP_INDICATOR = "NTP";
const ORB_INDICATOR = "ORB";
const ORB_RANGE_MINUTES = 30;
const GANN_PROJECTION_LOOP = 9;
const GANN_PROJECTION_POINT_LIMIT = 10;
const visibleStockCategoryValues = new Set([
  "us",
  "cn",
  "hk",
  "ntpSignals",
  "lmacdSignals",
  "confluenceSignals",
]);
const stockCategoryOptions = [
  { label: "美股", value: "us" },
  { label: "A股", value: "cn" },
  { label: "港股", value: "hk" },
  { label: "NTP", value: "ntpSignals" },
  { label: "LMACD", value: "lmacdSignals" },
  { label: "共振", value: "confluenceSignals" },
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

const mainIndicators = ["MA", "EMA", "BOLL", ORB_INDICATOR];
const paneIndicators = ["VOL", "MACD", "LMACD", NTP_INDICATOR, "KDJ", "RSI", "WR"];
const defaultPaneIndicators = ["LMACD", NTP_INDICATOR];
const drawablePaneIndicators = paneIndicators.filter(
  (name) => name !== NTP_INDICATOR,
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
    const triangleWidth = 12;
    const triangleHeight = 8;
    const triangleY = isHigh ? coordinate.y - 13 : coordinate.y + 13;

    return [
      {
        type: "polygon",
        attrs: {
          coordinates: isHigh
            ? [
                { x: coordinate.x - triangleWidth / 2, y: triangleY },
                { x: coordinate.x + triangleWidth / 2, y: triangleY },
                { x: coordinate.x, y: triangleY + triangleHeight },
              ]
            : [
                { x: coordinate.x, y: triangleY - triangleHeight },
                { x: coordinate.x - triangleWidth / 2, y: triangleY },
                { x: coordinate.x + triangleWidth / 2, y: triangleY },
              ],
        },
        styles: {
          style: "fill",
          color: theme.borderColor,
        },
        ignoreEvent: true,
      },
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

const dailyTrendSegmentOverlay: OverlayTemplate<DailyTrendSegmentOverlayData> = {
  name: "dailyTrendSegment",
  totalStep: 2,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ overlay, coordinates, bounding }) => {
    const first = coordinates[0];
    const second = coordinates[1];
    if (!first || !second) return [];
    const left = Math.min(first.x, second.x);
    const width = Math.max(1, Math.abs(second.x - first.x));
    const isUp = overlay.extendData.direction === "up";
    const color = isUp ? "rgba(242, 54, 69, 0.12)" : "rgba(8, 153, 129, 0.12)";
    const borderColor = isUp ? "rgba(242, 54, 69, 0.42)" : "rgba(8, 153, 129, 0.42)";
    const intervalDays = Math.max(
      1,
      Math.round(Number(overlay.extendData.intervalDays) || 1),
    );
    const centerX = left + width / 2;
    const topY = 16;
    return [
      {
        type: "rect",
        attrs: { x: left, y: 0, width, height: bounding.height },
        styles: { style: "fill", color },
        ignoreEvent: true,
      },
      {
        type: "line",
        attrs: { coordinates: [{ x: left, y: 0 }, { x: left, y: bounding.height }] },
        styles: { color: borderColor, size: 1, style: "dashed", dashedValue: [3, 3] },
        ignoreEvent: true,
      },
      {
        type: "line",
        attrs: { coordinates: [{ x: left + width, y: 0 }, { x: left + width, y: bounding.height }] },
        styles: { color: borderColor, size: 1, style: "dashed", dashedValue: [3, 3] },
        ignoreEvent: true,
      },
      {
        type: "line",
        attrs: {
          coordinates: [
            { x: left + 6, y: topY },
            { x: left + width - 6, y: topY },
          ],
        },
        styles: {
          color: "rgba(15, 23, 42, 0.82)",
          size: 1,
          style: "dashed",
          dashedValue: [6, 4],
        },
        ignoreEvent: true,
      },
      {
        type: "text",
        attrs: {
          x: centerX,
          y: topY,
          text: `${intervalDays}`,
          align: "center",
          baseline: "middle",
        },
        styles: {
          color: "#111827",
          size: 11,
          weight: "600",
          backgroundColor: "rgba(255,255,255,0.92)",
          borderColor: "transparent",
          borderSize: 0,
          borderRadius: 2,
          paddingLeft: 4,
          paddingRight: 4,
          paddingTop: 1,
          paddingBottom: 1,
        },
        ignoreEvent: true,
      },
    ];
  },
};

registerOverlay(dailyTrendSegmentOverlay);

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

const ntpSignalOverlay: OverlayTemplate<NtpSignalData> = {
  name: "ntpSignal",
  totalStep: 1,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ overlay, coordinates }) => {
    const coordinate = coordinates[0];
    const data = overlay.extendData as NtpSignalData;
    const isBuy = data.side === "buy";
    const backgroundColor = isBuy
      ? "rgba(8, 153, 129, 0.14)"
      : "rgba(242, 54, 69, 0.14)";
    const borderColor = isBuy ? "rgba(8, 153, 129, 0.72)" : "rgba(242, 54, 69, 0.72)";
    const textColor = isBuy ? "#065f46" : "#991b1b";
    const labelY = coordinate.y + (isBuy ? 38 + data.slot * 24 : -38 - data.slot * 24);
    const arrowBaseY = coordinate.y + (isBuy ? 10 : -10);
    const arrowWingY = coordinate.y + (isBuy ? 18 : -18);

    return [
      {
        type: "line",
        attrs: {
          coordinates: [
            { x: coordinate.x, y: labelY + (isBuy ? -12 : 12) },
            { x: coordinate.x, y: arrowBaseY },
          ],
        },
        styles: {
          color: borderColor,
          size: 2,
          style: "solid",
        },
        ignoreEvent: true,
      },
      {
        type: "polygon",
        attrs: {
          coordinates: isBuy
            ? [
                { x: coordinate.x, y: coordinate.y },
                { x: coordinate.x - 6, y: arrowWingY },
                { x: coordinate.x + 6, y: arrowWingY },
              ]
            : [
                { x: coordinate.x, y: coordinate.y },
                { x: coordinate.x - 6, y: arrowWingY },
                { x: coordinate.x + 6, y: arrowWingY },
              ],
        },
        styles: {
          style: "fill",
          color: borderColor,
        },
        ignoreEvent: true,
      },
      {
        type: "text",
        attrs: {
          x: coordinate.x,
          y: labelY,
          text: data.text,
          align: "center",
          baseline: "middle",
        },
        styles: {
          color: textColor,
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

registerOverlay(ntpSignalOverlay);

const lmacdSignalOverlay: OverlayTemplate<LmacdSignalData> = {
  name: "lmacdSignal",
  totalStep: 1,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ overlay, coordinates }) => {
    const coordinate = coordinates[0];
    const data = overlay.extendData as LmacdSignalData;
    const isBottom =
      data.kind === "bottomBuy" ||
      data.kind === "bullishDivergence" ||
      data.kind === "bottomDisappear";
    const isDivergence =
      data.kind === "bullishDivergence" || data.kind === "bearishDivergence";
    const isDisappear =
      data.kind === "bottomDisappear" || data.kind === "topDisappear";
    const theme = isDisappear
      ? {
          color: "#166534",
          backgroundColor: "rgba(34, 197, 94, 0.14)",
          borderColor: "rgba(34, 197, 94, 0.72)",
        }
      : isDivergence
      ? {
          color: "#6b21a8",
          backgroundColor: "rgba(147, 51, 234, 0.14)",
          borderColor: "rgba(147, 51, 234, 0.72)",
        }
      : isBottom
        ? {
            color: "#065f46",
            backgroundColor: "rgba(8, 153, 129, 0.14)",
            borderColor: "rgba(8, 153, 129, 0.72)",
          }
        : {
            color: "#991b1b",
            backgroundColor: "rgba(242, 54, 69, 0.14)",
            borderColor: "rgba(242, 54, 69, 0.72)",
          };
    const labelY =
      coordinate.y + (isBottom ? 20 + data.slot * 22 : -20 - data.slot * 22);

    return [
      {
        type: "line",
        attrs: {
          coordinates: [
            { x: coordinate.x, y: coordinate.y },
            { x: coordinate.x, y: labelY },
          ],
        },
        styles: {
          color: theme.borderColor,
          size: 1,
          style: "dashed",
          dashedValue: [3, 3],
        },
        ignoreEvent: true,
      },
      {
        type: "text",
        attrs: {
          x: coordinate.x,
          y: labelY,
          text: data.text,
          align: "center",
          baseline: "middle",
        },
        styles: {
          color: theme.color,
          size: 12,
          weight: "700",
          backgroundColor: theme.backgroundColor,
          borderColor: theme.borderColor,
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

registerOverlay(lmacdSignalOverlay);

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
  calc: (dataList, indicator) =>
    calculateLmacdValues(dataList, indicator.calcParams),
};

registerIndicator(lmacdIndicator);

function calculateLmacdValues(
  dataList: KLineData[],
  calcParams: number[] = [12, 26, 9],
) {
  return calculateLmacdFormulaValues(dataList, calcParams).map<LmacdData>(
    ({ diff, dea, macd }) => ({ diff, dea, macd }),
  );
}

function KLineChartPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const marketBarsRef = useRef<KLineData[]>([]);
  const turningPointsRef = useRef<TurningPoint[]>([]);
  const dailyTrendSegmentsRef = useRef<DailyTrendSegment[]>([]);
  const showTurningPointsRef = useRef(true);
  const showDailyTrendSegmentsRef = useRef(true);
  const initialTurningThreshold = useMemo(() => readStoredTurningThreshold(), []);
  const turningThresholdRef = useRef(initialTurningThreshold);
  const projectionRef = useRef<GannProjectionPayload | null>(null);
  const projectionLineVisibleRef = useRef({ main: true, cross: false });
  const paneIndicatorsRef = useRef<string[]>(defaultPaneIndicators);
  const mainIndicatorRef = useRef("MA");
  const [activeSymbol, setActiveSymbol] = useState<WatchSymbol>(() => ({
    ...defaultSymbol,
    ticker: readKLineActiveSymbol()?.ticker ?? defaultSymbol.ticker,
  }));
  const initialChartSymbolRef = useRef<WatchSymbol | null>(null);
  const [watchSymbols, setWatchSymbols] =
    useState<WatchSymbol[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [watchlistUpdating, setWatchlistUpdating] = useState(false);
  const [addingWatchSymbol, setAddingWatchSymbol] = useState<string | null>(null);
  const [securitySearchOpen, setSecuritySearchOpen] = useState(false);
  const [securitySearchKeyword, setSecuritySearchKeyword] = useState("");
  const [securitySearchResults, setSecuritySearchResults] = useState<
    SecuritySearchResult[]
  >([]);
  const [securitySearchLoading, setSecuritySearchLoading] = useState(false);
  const [periodValue, setPeriodValue] = useState("1d");
  const [mainIndicator, setMainIndicator] = useState("MA");
  const [selectedPaneIndicators, setSelectedPaneIndicators] =
    useState<string[]>(defaultPaneIndicators);
  const [drawingTool, setDrawingTool] = useState<string | null>(null);
  const [zoomEnabled, setZoomEnabled] = useState(true);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [showTools, setShowTools] = useState(true);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(false);
  const [showTurningPoints, setShowTurningPoints] = useState(true);
  const [showDailyTrendSegments, setShowDailyTrendSegments] = useState(true);
  const [turningThreshold, setTurningThreshold] = useState(
    initialTurningThreshold,
  );
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
      periodOptions.find((item) => item.value === "1d") ??
      periodOptions[0],
    [periodValue],
  );
  const initialChartPeriodRef = useRef<Period | null>(null);

  if (initialChartSymbolRef.current === null) {
    initialChartSymbolRef.current = activeSymbol;
  }

  if (initialChartPeriodRef.current === null) {
    initialChartPeriodRef.current = activePeriod.period;
  }

  const loadWatchSymbols = async (options?: { preserveActive?: boolean }) => {
    setWatchlistLoading(true);
    setWatchlistError(null);
    try {
      const stocks = await fetchWatchSymbols();
      if (stocks.length > 0) {
        setWatchSymbols(stocks);
        setActiveSymbol((current) => {
          const storedTicker = readKLineActiveSymbol()?.ticker;
          const preferredTicker = options?.preserveActive
            ? current.ticker
            : storedTicker ?? current.ticker;
          const matched = stocks.find((item) => item.ticker === preferredTicker);
          return matched ?? stocks[0];
        });
      } else {
        setWatchSymbols([]);
      }
      return stocks;
    } catch (error) {
      console.warn("Stock list api fallback", error);
      setWatchlistError("自选股接口加载失败");
      setWatchSymbols([]);
      throw error;
    } finally {
      setWatchlistLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadStocks = async () => {
      try {
        const stocks = await loadWatchSymbols();
        if (cancelled) return;
        if (stocks.length === 0) setWatchSymbols([]);
      } catch {
        if (!cancelled) {
          setWatchSymbols([]);
        }
      }
    };

    void loadStocks();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSearchSecurities = async (rawKeyword?: string) => {
    const keyword = (rawKeyword ?? securitySearchKeyword).trim();

    if (!keyword) {
      messageApi.warning("请输入代码或名称");
      return;
    }

    setSecuritySearchKeyword(keyword);
    setSecuritySearchLoading(true);
    try {
      const results = await searchSecurities(keyword);
      setSecuritySearchResults(results);
      if (results.length === 0) {
        messageApi.info("没有找到匹配标的");
      }
    } catch (error) {
      console.warn("Security search failed", error);
      messageApi.error(getErrorMessage(error, "搜索标的失败"));
    } finally {
      setSecuritySearchLoading(false);
    }
  };

  const handleOpenSecuritySearch = () => {
    setSecuritySearchOpen(true);
    setSecuritySearchResults([]);
    setSecuritySearchKeyword("");
  };

  const handleAddWatchSymbol = async (rawSymbol: string) => {
    const symbol = normalizeTickerInput(rawSymbol);

    if (!symbol) return;

    setAddingWatchSymbol(symbol);
    try {
      await updateWatchlistSymbol({
        symbol,
        mode: "add",
        groupId: activeSymbol.groupId ?? watchSymbols[0]?.groupId ?? null,
      });
      messageApi.success(`已添加 ${symbol}`);
      const stocks = await loadWatchSymbols({ preserveActive: true });
      const added = stocks.find((item) => item.ticker === symbol);
      if (added) setActiveSymbol(added);
    } catch (error) {
      console.warn("Add watchlist symbol failed", error);
      messageApi.error(getErrorMessage(error, "添加自选股失败"));
    } finally {
      setAddingWatchSymbol(null);
    }
  };

  const handleAddSearchResult = async (item: SecuritySearchResult) => {
    await handleAddWatchSymbol(item.symbol || item.ticker || "");
  };

  const handleRemoveWatchSymbol = async (symbol: WatchSymbol) => {
    if (symbol.isSignalGroup) {
      messageApi.info("收盘扫描分组由系统自动维护，不能手动删除");
      return;
    }
    setWatchlistUpdating(true);
    try {
      await updateWatchlistSymbol({
        symbol: symbol.ticker,
        mode: "remove",
        groupId: symbol.groupId ?? activeSymbol.groupId ?? null,
      });
      messageApi.success(`已删除 ${symbol.ticker}`);
      const stocks = await loadWatchSymbols({ preserveActive: true });
      if (activeSymbol.ticker === symbol.ticker && stocks.length > 0) {
        setActiveSymbol(stocks[0]);
      }
    } catch (error) {
      console.warn("Remove watchlist symbol failed", error);
      messageApi.error(getErrorMessage(error, "删除自选股失败"));
    } finally {
      setWatchlistUpdating(false);
    }
  };

  useEffect(() => {
    const host = chartHostRef.current;
    if (!host) return;

    const chart = init(host, {
      layout: [
        { type: "candle", options: { id: "candle_pane" } },
        {
          type: "indicator",
          content: ["VOL"],
          options: { id: INDICATOR_PANE_ID, height: 116, minHeight: 80 },
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
            upColor: "#f23645",
            downColor: "#089981",
            noChangeColor: "#6b7280",
            upBorderColor: "#f23645",
            downBorderColor: "#089981",
            noChangeBorderColor: "#6b7280",
            upWickColor: "#f23645",
            downWickColor: "#089981",
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
            if (period.type === "day") {
              dailyTrendSegmentsRef.current = buildDailyTrendSegments(
                marketBarsRef.current,
              );
              saveGannTrendSegments(
                dailyTrendSegmentsRef.current,
                currentSymbol.ticker,
                String(currentSymbol.name ?? currentSymbol.ticker),
              );
              renderDailyTrendSegments(
                chart,
                dailyTrendSegmentsRef.current,
                showDailyTrendSegmentsRef.current,
              );
            } else {
              dailyTrendSegmentsRef.current = [];
              chart.removeOverlay({ groupId: DAILY_TREND_GROUP_ID });
            }
            turningPointsRef.current = renderTrendTurningPoints(
              chart,
              marketBarsRef.current,
              showTurningPointsRef.current,
              turningThresholdRef.current,
            );
            renderDailyTrendSegments(
              chart,
              dailyTrendSegmentsRef.current,
              showDailyTrendSegmentsRef.current,
            );
            renderNtpSignalOverlays(
              chart,
              marketBarsRef.current,
              paneIndicatorsRef.current.includes(NTP_INDICATOR),
            );
            renderLmacdSignalOverlays(
              chart,
              marketBarsRef.current,
              paneIndicatorsRef.current.includes("LMACD"),
            );
            renderOrbOverlays(
              chart,
              marketBarsRef.current,
              mainIndicatorRef.current === ORB_INDICATOR,
            );
          } catch (error) {
            console.warn("K line api failed", error);
            if (type === "init") {
              marketBarsRef.current = [];
              turningPointsRef.current = [];
              setSelectedTurningPoint(null);
              chart.removeOverlay({ groupId: TREND_TURNING_GROUP_ID });
              chart.removeOverlay({ groupId: DAILY_TREND_GROUP_ID });
              chart.removeOverlay({ groupId: GANN_PROJECTION_GROUP_ID });
              chart.removeOverlay({ groupId: NTP_SIGNAL_GROUP_ID });
              chart.removeOverlay({ groupId: LMACD_SIGNAL_GROUP_ID });
              chart.removeOverlay({ groupId: ORB_OVERLAY_GROUP_ID });
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
    if (initialChartSymbolRef.current) chart.setSymbol(initialChartSymbolRef.current);
    if (initialChartPeriodRef.current) chart.setPeriod(initialChartPeriodRef.current);
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
    dailyTrendSegmentsRef.current = [];
    turningPointsRef.current = [];
    setSelectedTurningPoint(null);
    chart.removeOverlay({ groupId: TREND_TURNING_GROUP_ID });
    chart.removeOverlay({ groupId: DAILY_TREND_GROUP_ID });
    chart.removeOverlay({ groupId: GANN_PROJECTION_GROUP_ID });
    chart.removeOverlay({ groupId: NTP_SIGNAL_GROUP_ID });
    chart.removeOverlay({ groupId: LMACD_SIGNAL_GROUP_ID });
    chart.removeOverlay({ groupId: ORB_OVERLAY_GROUP_ID });
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
    dailyTrendSegmentsRef.current = [];
    turningPointsRef.current = [];
    setSelectedTurningPoint(null);
    chartRef.current?.removeOverlay({ groupId: TREND_TURNING_GROUP_ID });
    chartRef.current?.removeOverlay({ groupId: DAILY_TREND_GROUP_ID });
    chartRef.current?.removeOverlay({ groupId: GANN_PROJECTION_GROUP_ID });
    chartRef.current?.removeOverlay({ groupId: NTP_SIGNAL_GROUP_ID });
    chartRef.current?.removeOverlay({ groupId: LMACD_SIGNAL_GROUP_ID });
    chartRef.current?.removeOverlay({ groupId: ORB_OVERLAY_GROUP_ID });
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
    dailyTrendSegmentsRef.current = [];
    turningPointsRef.current = [];
    setSelectedTurningPoint(null);
    chart.removeOverlay({ groupId: TREND_TURNING_GROUP_ID });
    chart.removeOverlay({ groupId: DAILY_TREND_GROUP_ID });
    chart.removeOverlay({ groupId: GANN_PROJECTION_GROUP_ID });
    chart.removeOverlay({ groupId: NTP_SIGNAL_GROUP_ID });
    chart.removeOverlay({ groupId: LMACD_SIGNAL_GROUP_ID });
    chart.removeOverlay({ groupId: ORB_OVERLAY_GROUP_ID });
    projectionRef.current = null;
    chart.setPeriod(activePeriod.period);
    chart.resetData();
  }, [activePeriod, periodValue]);

  useEffect(() => {
    if (!autoRefreshEnabled) return;
    if (activePeriod.period.type !== "minute") return;

    const timer = window.setInterval(() => {
      marketRequestCache.clear();
      chartRef.current?.resetData();
    }, MARKET_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [
    activePeriod.period.type,
    activePeriod.period.span,
    activeSymbol.ticker,
    autoRefreshEnabled,
  ]);

  useEffect(() => {
    showDailyTrendSegmentsRef.current = showDailyTrendSegments;
    renderDailyTrendSegments(
      chartRef.current,
      dailyTrendSegmentsRef.current,
      showDailyTrendSegments,
    );
  }, [showDailyTrendSegments]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    mainIndicatorRef.current = mainIndicator;
    chart.removeOverlay({ groupId: ORB_OVERLAY_GROUP_ID });
    mainIndicators.forEach((name) =>
      chart.removeIndicator({ name, paneId: "candle_pane" }),
    );
    if (mainIndicator === ORB_INDICATOR) {
      renderOrbOverlays(chart, marketBarsRef.current, true);
    } else {
      chart.createIndicator(mainIndicator, true, { id: "candle_pane" });
    }
  }, [mainIndicator]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    paneIndicatorsRef.current = selectedPaneIndicators;
    drawablePaneIndicators.forEach((name) =>
      chart.removeIndicator({ name, paneId: INDICATOR_PANE_ID }),
    );
    selectedPaneIndicators
      .filter((name) => name !== NTP_INDICATOR)
      .forEach((name) => {
        chart.createIndicator(name, false, {
          id: INDICATOR_PANE_ID,
          height: 116,
          minHeight: 80,
        });
      });
    renderNtpSignalOverlays(
      chart,
      marketBarsRef.current,
      selectedPaneIndicators.includes(NTP_INDICATOR),
    );
    renderLmacdSignalOverlays(
      chart,
      marketBarsRef.current,
      selectedPaneIndicators.includes("LMACD"),
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
    saveTurningThreshold(turningThreshold);
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

  const updateSelectedTurningPointByClientPoint = (clientX: number, clientY: number) => {
    const chart = chartRef.current;
    const host = chartHostRef.current;
    if (!chart || !host || turningPointsRef.current.length === 0) {
      setSelectedTurningPoint(null);
      return;
    }

    const rect = host.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const match = findTurningPointByPixel(chart, turningPointsRef.current, x, y);

    if (match) {
      setSelectedTurningPoint(match);
      return;
    }

    setSelectedTurningPoint(null);
  };

  const handleChartClick = (event: React.MouseEvent<HTMLDivElement>) => {
    updateSelectedTurningPointByClientPoint(event.clientX, event.clientY);
  };

  const handleChartTouch = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0] ?? event.changedTouches[0];
    if (!touch) return;
    updateSelectedTurningPointByClientPoint(touch.clientX, touch.clientY);
  };

  const handleTrendSelect = (trend: Trend) => {
    if (!selectedTurningPoint) return;
    const turningDate = formatDateFromTimestamp(selectedTurningPoint.timestamp);
    const source = `${activeSymbol.ticker} ${
      selectedTurningPoint.kind === "high" ? "高点" : "低点"
    }${turningDate ? ` ${turningDate}` : ""}`;
    saveGannBridgeSelection({
      value: selectedTurningPoint.roundedValue,
      trend,
      source,
      symbol: activeSymbol.ticker,
      symbolName: activeSymbol.name,
      turningKind: selectedTurningPoint.kind,
      timestamp: selectedTurningPoint.timestamp,
      date: turningDate,
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
      {contextHolder}
      <section className="flex h-full min-h-0 gap-3 bg-[#f7f9fc] p-3">
        <WatchlistCard
          symbols={watchSymbols}
          activeTicker={activeSymbol.ticker}
          loading={watchlistLoading}
          error={watchlistError}
          collapsed={watchlistCollapsed}
          onCollapsedChange={setWatchlistCollapsed}
          onOpenSearch={handleOpenSecuritySearch}
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
            autoRefreshEnabled={autoRefreshEnabled}
            showTools={showTools}
            showTurningPoints={showTurningPoints}
            showDailyTrendSegments={showDailyTrendSegments}
            turningThreshold={turningThreshold}
            showMainProjection={showMainProjection}
            showCrossProjection={showCrossProjection}
            onPeriodChange={setPeriodValue}
            onMainIndicatorChange={setMainIndicator}
            onPaneIndicatorsChange={setSelectedPaneIndicators}
            onZoomEnabledChange={setZoomEnabled}
            onScrollEnabledChange={setScrollEnabled}
            onAutoRefreshEnabledChange={setAutoRefreshEnabled}
            onShowToolsChange={setShowTools}
            onShowTurningPointsChange={setShowTurningPoints}
            onShowDailyTrendSegmentsChange={setShowDailyTrendSegments}
            onTurningThresholdChange={setTurningThreshold}
            onShowMainProjectionChange={setShowMainProjection}
            onShowCrossProjectionChange={setShowCrossProjection}
            adjustType={adjustType}
            onAdjustTypeChange={setAdjustType}
            watchlistUpdating={watchlistUpdating}
            canRemoveSymbol={!activeSymbol.isSignalGroup}
            onRemoveSymbol={() => handleRemoveWatchSymbol(activeSymbol)}
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
              onTouchStart={handleChartTouch}
              onTouchMove={handleChartTouch}
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
      <SecuritySearchModal
        open={securitySearchOpen}
        keyword={securitySearchKeyword}
        results={securitySearchResults}
        loading={securitySearchLoading}
        addingSymbol={addingWatchSymbol}
        onKeywordChange={setSecuritySearchKeyword}
        onSearch={handleSearchSecurities}
        onAdd={handleAddSearchResult}
        onClose={() => setSecuritySearchOpen(false)}
      />
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
      <div className="mb-2 text-xs text-slate-500">
        {formatDateFromTimestamp(point.timestamp)}
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
  autoRefreshEnabled,
  showTools,
  showTurningPoints,
  showDailyTrendSegments,
  turningThreshold,
  showMainProjection,
  showCrossProjection,
  onPeriodChange,
  onMainIndicatorChange,
  onPaneIndicatorsChange,
  onZoomEnabledChange,
  onScrollEnabledChange,
  onAutoRefreshEnabledChange,
  onShowToolsChange,
  onShowTurningPointsChange,
  onShowDailyTrendSegmentsChange,
  onTurningThresholdChange,
  onShowMainProjectionChange,
  onShowCrossProjectionChange,
  adjustType,
  onAdjustTypeChange,
  watchlistUpdating,
  canRemoveSymbol,
  onRemoveSymbol,
}: {
  symbol: WatchSymbol;
  periodValue: string;
  mainIndicator: string;
  selectedPaneIndicators: string[];
  zoomEnabled: boolean;
  scrollEnabled: boolean;
  autoRefreshEnabled: boolean;
  showTools: boolean;
  showTurningPoints: boolean;
  showDailyTrendSegments: boolean;
  turningThreshold: number;
  showMainProjection: boolean;
  showCrossProjection: boolean;
  onPeriodChange: (value: string) => void;
  onMainIndicatorChange: (value: string) => void;
  onPaneIndicatorsChange: (value: string[]) => void;
  onZoomEnabledChange: (value: boolean) => void;
  onScrollEnabledChange: (value: boolean) => void;
  onAutoRefreshEnabledChange: (value: boolean) => void;
  onShowToolsChange: (value: boolean) => void;
  onShowTurningPointsChange: (value: boolean) => void;
  onShowDailyTrendSegmentsChange: (value: boolean) => void;
  onTurningThresholdChange: (value: number) => void;
  onShowMainProjectionChange: (value: boolean) => void;
  onShowCrossProjectionChange: (value: boolean) => void;
  adjustType: AdjustType;
  onAdjustTypeChange: (value: AdjustType) => void;
  watchlistUpdating: boolean;
  canRemoveSymbol: boolean;
  onRemoveSymbol: () => void;
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
      <SettingRow label="日线趋势分段">
        <Switch
          size="small"
          checked={showDailyTrendSegments}
          onChange={onShowDailyTrendSegmentsChange}
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
              if (typeof value === "number") {
                onTurningThresholdChange(normalizeTurningThreshold(value));
              }
            }}
          />
        </div>
        <Slider
          min={0.5}
          max={8}
          step={0.1}
          value={turningThreshold}
          onChange={(value) =>
            onTurningThresholdChange(normalizeTurningThreshold(value))
          }
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
            className="min-w-[44px] px-2 font-medium tracking-normal"
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

      <Space size={6} className="shrink-0 rounded-md bg-slate-50 px-2 py-1">
        <span className="text-xs text-slate-600">自动刷新</span>
        <Switch
          size="small"
          checked={autoRefreshEnabled}
          onChange={onAutoRefreshEnabledChange}
        />
      </Space>

      <Popover placement="bottomRight" trigger="click" content={settings}>
        <Button size="small" type="text" icon={<SettingOutlined />}>
          设置
        </Button>
      </Popover>

      {canRemoveSymbol && (
        <Tooltip title={`删除当前自选股 ${symbol.ticker}`}>
          <Button
            danger
            size="small"
            type="text"
            icon={<DeleteOutlined />}
            loading={watchlistUpdating}
            onClick={onRemoveSymbol}
          />
        </Tooltip>
      )}
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
  onOpenSearch,
  onSelect,
}: {
  symbols: WatchSymbol[];
  activeTicker: string;
  loading: boolean;
  error: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpenSearch: () => void;
  onSelect: (symbol: WatchSymbol) => void;
}) {
  const [activeCategory, setActiveCategory] = useState("us");
  const [keyword, setKeyword] = useState("");
  const visibleCategoryOptions = stockCategoryOptions
    .map((option) => ({
      ...option,
      count: symbols.filter((item) => item.category === option.value).length,
    }))
    .filter(
      (option) =>
        option.count > 0 ||
        option.value === "ntpSignals" ||
        option.value === "lmacdSignals" ||
        option.value === "confluenceSignals",
    );
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
          <Space size={2}>
            <Tooltip title="搜索添加自选股">
              <Button
                size="small"
                type="text"
                icon={<PlusOutlined />}
                onClick={onOpenSearch}
              />
            </Tooltip>
            <Tooltip title="折叠自选股">
              <Button
                size="small"
                type="text"
                icon={<MenuFoldOutlined />}
                onClick={() => onCollapsedChange(true)}
              />
            </Tooltip>
          </Space>
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

function SecuritySearchModal({
  open,
  keyword,
  results,
  loading,
  addingSymbol,
  onKeywordChange,
  onSearch,
  onAdd,
  onClose,
}: {
  open: boolean;
  keyword: string;
  results: SecuritySearchResult[];
  loading: boolean;
  addingSymbol: string | null;
  onKeywordChange: (value: string) => void;
  onSearch: (keyword?: string) => void;
  onAdd: (item: SecuritySearchResult) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="添加自选股"
      open={open}
      footer={null}
      width={560}
      onCancel={onClose}
      destroyOnHidden
    >
      <div className="flex flex-col gap-3">
        <Input.Search
          autoFocus
          allowClear
          placeholder="输入股票代码或名称，例如 Tesla、腾讯、AAPL"
          value={keyword}
          loading={loading}
          enterButton="搜索"
          onChange={(event) => onKeywordChange(event.target.value)}
          onSearch={(value) => onSearch(value)}
        />
        <div className="max-h-[420px] overflow-auto rounded-md border border-slate-200">
          <Spin spinning={Boolean(addingSymbol)} tip="正在添加自选股">
            {results.length === 0 && !loading ? (
              <div className="py-10">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="输入关键词搜索" />
              </div>
            ) : (
              results.map((item) => (
                <div
                  key={item.symbol}
                  className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">
                        {item.symbol}
                      </span>
                      <Tag bordered={false}>{item.market || "--"}</Tag>
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">
                      {item.nameCn || item.name || item.nameEn || item.nameHk || item.symbol}
                    </div>
                  </div>
                  <Tooltip title="添加到自选股">
                    <Button
                      size="small"
                      type="primary"
                      icon={<PlusOutlined />}
                      loading={addingSymbol === item.symbol}
                      disabled={Boolean(addingSymbol)}
                      onClick={() => onAdd(item)}
                    />
                  </Tooltip>
                </div>
              ))
            )}
          </Spin>
        </div>
      </div>
    </Modal>
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
    .filter((item) => visibleStockCategoryValues.has(item.category ?? ""))
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
  const category =
    getStringValue(raw.category ?? raw.__category) ||
    inferStockCategory(ticker, market, getStringValue(raw.board));
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
    category,
    nameCn,
    nameHk,
    nameEn,
    exchange: getStringValue(raw.exchange),
    currency: getStringValue(raw.currency),
    board: getStringValue(raw.board),
    watchedAt: getStringValue(raw.watchedAt),
    watchedPrice,
    groupId: normalizeGroupId(raw.groupId ?? raw.group_id),
    groupName: getStringValue(raw.groupName ?? raw.group_name),
    isSignalGroup:
      category === "ntpSignals" ||
      category === "lmacdSignals" ||
      category === "confluenceSignals",
    pricePrecision: Number(raw.pricePrecision ?? 2),
    volumePrecision: Number(raw.volumePrecision ?? 2),
  };
}

function normalizeGroupId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeTickerInput(value: string) {
  return value.trim().toUpperCase();
}

async function updateWatchlistSymbol({
  symbol,
  mode,
  groupId,
}: {
  symbol: string;
  mode: "add" | "remove";
  groupId?: number | null;
}) {
  const response = await fetch(WATCHLIST_SYMBOLS_API_URL, {
    method: mode === "add" ? "POST" : "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, groupId }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      getStringValue(payload?.message) ||
        `Watchlist ${mode} api failed: ${response.status}`,
    );
  }

  return response.json();
}

async function searchSecurities(keyword: string) {
  const url = new URL(SECURITY_SEARCH_API_URL);
  url.searchParams.set("q", keyword);
  url.searchParams.set("limit", "30");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      getStringValue(payload?.message) ||
        `Security search api failed: ${response.status}`,
    );
  }

  const payload = await response.json();
  const data = Array.isArray(payload?.data) ? payload.data : [];

  return data
    .map(normalizeSecuritySearchResult)
    .filter(
      (item: SecuritySearchResult | null): item is SecuritySearchResult =>
        item !== null,
    );
}

function normalizeSecuritySearchResult(
  raw: Record<string, unknown>,
): SecuritySearchResult | null {
  const symbol = getStringValue(raw.symbol ?? raw.ticker);
  if (!symbol) return null;

  return {
    symbol,
    ticker: getStringValue(raw.ticker) || symbol,
    code: getStringValue(raw.code),
    market: getStringValue(raw.market),
    name: getStringValue(raw.name),
    nameCn: getStringValue(raw.nameCn),
    nameHk: getStringValue(raw.nameHk),
    nameEn: getStringValue(raw.nameEn),
    exchange: getStringValue(raw.exchange),
    currency: getStringValue(raw.currency),
    board: getStringValue(raw.board),
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
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
    const key = `${item.category || "other"}:${item.ticker}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

function renderNtpSignalOverlays(
  chart: Chart,
  bars: KLineData[],
  visible: boolean,
) {
  chart.removeOverlay({ groupId: NTP_SIGNAL_GROUP_ID });
  if (!visible || bars.length < 16) return;

  const stackSlots = new Map<string, number>();
  const overlays = calculateNtpSignals(bars).map<OverlayCreate>((signal) => {
    const stackKey = `${signal.timestamp}:${signal.side}`;
    const slot = stackSlots.get(stackKey) ?? 0;
    stackSlots.set(stackKey, slot + 1);

    return {
      name: "ntpSignal",
      groupId: NTP_SIGNAL_GROUP_ID,
      lock: true,
      zLevel: 24,
      points: [{ timestamp: signal.timestamp, value: signal.value }],
      extendData: {
        text: signal.text,
        side: signal.side,
        slot,
      },
    };
  });

  if (overlays.length > 0) chart.createOverlay(overlays);
}

function calculateNtpSignals(bars: KLineData[]) {
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

    if (buy1 && !previousBuy1) {
      result.push({
        timestamp: Number(bar.timestamp),
        value: low,
        text: "买1",
        side: "buy",
      });
    }
    if (buy2 && !previousBuy2) {
      result.push({
        timestamp: Number(bar.timestamp),
        value: low,
        text: "买2",
        side: "buy",
      });
    }
    if (sell1 && !previousSell1) {
      result.push({
        timestamp: Number(bar.timestamp),
        value: high,
        text: "卖1",
        side: "sell",
      });
    }
    if (sell2 && !previousSell2) {
      result.push({
        timestamp: Number(bar.timestamp),
        value: high,
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

function renderLmacdSignalOverlays(
  chart: Chart,
  bars: KLineData[],
  visible: boolean,
) {
  chart.removeOverlay({ groupId: LMACD_SIGNAL_GROUP_ID });
  if (!visible || bars.length < 40) return;

  const stackSlots = new Map<string, number>();
  const overlays = calculateLmacdSignals(bars).map<OverlayCreate>(
    (signal) => {
      const stackSide =
        signal.kind === "bottomBuy" ||
        signal.kind === "bullishDivergence" ||
        signal.kind === "bottomDisappear"
          ? "bottom"
          : "top";
      const stackKey = `${signal.timestamp}:${stackSide}`;
      const slot = stackSlots.get(stackKey) ?? 0;
      stackSlots.set(stackKey, slot + 1);

      return {
        name: "lmacdSignal",
        groupId: LMACD_SIGNAL_GROUP_ID,
        paneId: INDICATOR_PANE_ID,
        lock: true,
        zLevel: 28,
        points: [{ timestamp: signal.timestamp, value: signal.value }],
        extendData: {
          text: signal.text,
          kind: signal.kind,
          slot,
        },
      };
    },
  );

  if (overlays.length > 0) chart.createOverlay(overlays);
}

function renderOrbOverlays(chart: Chart, bars: KLineData[], visible: boolean) {
  chart.removeOverlay({ groupId: ORB_OVERLAY_GROUP_ID });
  if (!visible || bars.length < 2) return;

  const { ranges, signals } = calculateOrbData(bars);
  const overlays: OverlayCreate[] = [];

  ranges.forEach((range) => {
    overlays.push(
      {
        name: "segment",
        groupId: ORB_OVERLAY_GROUP_ID,
        lock: true,
        zLevel: 12,
        needDefaultPointFigure: false,
        points: [
          { timestamp: range.startTimestamp, value: range.high },
          { timestamp: range.endTimestamp, value: range.high },
        ],
        styles: {
          line: {
            color: "rgba(242, 54, 69, 0.72)",
            size: 1,
            style: "dashed",
            dashedValue: [5, 4],
          },
        },
      },
      {
        name: "segment",
        groupId: ORB_OVERLAY_GROUP_ID,
        lock: true,
        zLevel: 12,
        needDefaultPointFigure: false,
        points: [
          { timestamp: range.startTimestamp, value: range.low },
          { timestamp: range.endTimestamp, value: range.low },
        ],
        styles: {
          line: {
            color: "rgba(8, 153, 129, 0.72)",
            size: 1,
            style: "dashed",
            dashedValue: [5, 4],
          },
        },
      },
    );
  });

  const stackSlots = new Map<string, number>();
  signals.forEach((signal) => {
    const stackKey = `${signal.timestamp}:${signal.side}`;
    const slot = stackSlots.get(stackKey) ?? 0;
    stackSlots.set(stackKey, slot + 1);
    overlays.push({
      name: "ntpSignal",
      groupId: ORB_OVERLAY_GROUP_ID,
      lock: true,
      zLevel: 26,
      points: [{ timestamp: signal.timestamp, value: signal.value }],
      extendData: {
        text: signal.text,
        side: signal.side,
        slot,
      },
    });
  });

  if (overlays.length > 0) chart.createOverlay(overlays);
}

function calculateOrbData(bars: KLineData[]) {
  const ranges: Array<{
    startTimestamp: number;
    endTimestamp: number;
    high: number;
    low: number;
  }> = [];
  const signals: Array<{
    timestamp: number;
    value: number;
    text: string;
    side: "buy" | "sell";
  }> = [];
  const sessions = groupBarsBySession(bars);

  sessions.forEach((sessionBars) => {
    if (sessionBars.length < 2) return;
    const firstTimestamp = Number(sessionBars[0].timestamp);
    const rangeEndTime = firstTimestamp + ORB_RANGE_MINUTES * 60 * 1000;
    const rangeBars = sessionBars.filter(
      (bar) => Number(bar.timestamp) < rangeEndTime,
    );
    if (rangeBars.length === 0 || rangeBars.length === sessionBars.length) return;

    const high = Math.max(...rangeBars.map((bar) => Number(bar.high)));
    const low = Math.min(...rangeBars.map((bar) => Number(bar.low)));
    const lastSessionTimestamp = Number(sessionBars.at(-1)?.timestamp ?? firstTimestamp);
    ranges.push({
      startTimestamp: firstTimestamp,
      endTimestamp: lastSessionTimestamp,
      high,
      low,
    });

    let previousClose = Number(rangeBars.at(-1)?.close);
    for (let index = rangeBars.length; index < sessionBars.length; index += 1) {
      const bar = sessionBars[index];
      const close = Number(bar.close);
      if (previousClose <= high && close > high) {
        signals.push({
          timestamp: Number(bar.timestamp),
          value: Number(bar.high),
          text: "ORB买",
          side: "buy",
        });
      }
      if (previousClose >= low && close < low) {
        signals.push({
          timestamp: Number(bar.timestamp),
          value: Number(bar.low),
          text: "ORB卖",
          side: "sell",
        });
      }
      previousClose = close;
    }
  });

  return { ranges, signals };
}

function groupBarsBySession<T extends { timestamp?: number }>(bars: T[]) {
  const sessions = new Map<string, T[]>();
  bars.forEach((bar) => {
    const timestamp = Number(bar.timestamp);
    if (!Number.isFinite(timestamp)) return;
    const key = new Date(timestamp).toISOString().slice(0, 10);
    const list = sessions.get(key) ?? [];
    list.push(bar);
    sessions.set(key, list);
  });

  return Array.from(sessions.values()).map((sessionBars) =>
    sessionBars.sort((a, b) => Number(a.timestamp) - Number(b.timestamp)),
  );
}

function calculateLmacdSignals(bars: KLineData[]) {
  return calculateLmacdFormulaSignals(bars);
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

function renderDailyTrendSegments(
  chart: Chart | null,
  segments: DailyTrendSegment[],
  visible: boolean,
) {
  if (!chart) return;
  chart.removeOverlay({ groupId: DAILY_TREND_GROUP_ID });
  if (!visible || segments.length === 0) return;

  chart.createOverlay(
    segments.map((segment) => ({
      name: "dailyTrendSegment",
      groupId: DAILY_TREND_GROUP_ID,
      lock: true,
      zLevel: 1,
      points: [
        { timestamp: segment.startTimestamp, value: segment.startPrice },
        { timestamp: segment.endTimestamp, value: segment.endPrice },
      ],
      extendData: {
        direction: segment.direction,
        intervalDays: Math.max(
          1,
          Math.round(
            Math.abs(segment.endTimestamp - segment.startTimestamp) / DAY_MS,
          ),
        ),
      },
    })),
  );
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
  const { from, to, count } = getMarketRequestRange(
    period,
    loadType,
    anchorTimestamp,
  );
  const url = new URL(
    `${MARKET_API_BASE}/${apiPeriod}/${encodeURIComponent(ticker)}`,
  );
  url.searchParams.set("count", String(count));
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
  const span = getRequestTimeSpan(period, step);

  if (loadType === "forward" && anchorTimestamp) {
    const to = anchorTimestamp - 1;
    const from = Math.max(0, to - span);
    return { from, to, count: getRequestCount(period, from, to) };
  }

  if ((loadType === "backward" || loadType === "update") && anchorTimestamp) {
    const from = anchorTimestamp + 1;
    const to = Math.max(from, Math.min(now, from + span));
    return { from, to, count: getRequestCount(period, from, to) };
  }

  const from = Math.max(0, now - span);
  return { from, to: now, count: getRequestCount(period, from, now) };
}

function getRequestNow() {
  return Math.floor(Date.now() / REQUEST_NOW_BUCKET_MS) * REQUEST_NOW_BUCKET_MS;
}

function getRequestTimeSpan(period: Period, step: number) {
  if (period.type === "minute") return MINUTE_REQUEST_WINDOW_DAYS * DAY_MS;
  if (period.type === "hour") return HOUR_REQUEST_WINDOW_DAYS * DAY_MS;
  if (period.type === "day") return DAILY_REQUEST_WINDOW_DAYS * DAY_MS;
  return step * MIN_KLINE_REQUEST_COUNT;
}

function getRequestCount(period: Period, from: number, to: number) {
  const step = periodToMilliseconds(period);
  const estimatedBars = Math.ceil(Math.max(0, to - from) / step) + 1;
  return Math.min(
    MAX_KLINE_REQUEST_COUNT,
    Math.max(MIN_KLINE_REQUEST_COUNT, estimatedBars),
  );
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
