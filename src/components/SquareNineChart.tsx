import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent,
} from "react";
import {
  Button,
  Card,
  Checkbox,
  Col,
  ConfigProvider,
  Input,
  InputNumber,
  Row,
  Segmented,
  Slider,
  Space,
  Tag,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DownOutlined,
  LeftOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  UpOutlined,
} from "@ant-design/icons";
import "antd/dist/reset.css";
import {
  calculateClickTrend,
  findNumberPosition,
  generateGannMatrix,
  getTrendExtensionPoints,
  type MatrixPoint,
  type Trend,
} from "../utils/squareNine";
import {
  GANN_BRIDGE_EVENT,
  readGannBridgeSelection,
  saveGannProjectionResult,
  type GannBridgePayload,
} from "../utils/gannBridge";

type GuideOption = "1x1" | "1x2" | "1x3" | "1x4" | "1x8" | "cross";
type MatrixMode = "space" | "time";

type StoredSquareNineState = {
  rowColumn?: number;
  matrixMode?: MatrixMode;
  startDate?: string;
  trend?: Trend;
  searchValue?: number | null;
  searchDate?: string;
  selectedValue?: number;
  dimUsClosedDays?: boolean;
  bridgeTurningKind?: "high" | "low" | null;
  bridgeInfo?: {
    symbol?: string;
    symbolName?: string;
    turningKind?: "high" | "low";
    date?: string;
  } | null;
  selectedTimeSymbolTicker?: string;
};

type Cell = MatrixPoint & {
  key: string;
};

type WatchSymbol = {
  ticker: string;
  name: string;
  market: string;
  category?: string;
  nameCn?: string;
  nameHk?: string;
  nameEn?: string;
  exchange?: string;
  board?: string;
};

type MarketBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type TimeTurningPoint = {
  kind: "high" | "low";
  timestamp: number;
  date: string;
  value: number;
  index: number;
  key: string;
  cellKey?: string;
};

type DiagonalHitCandidate = Cell & {
  date: string;
  hitCount: number;
  highCount: number;
  lowCount: number;
};

type CanvasMetrics = {
  size: number;
  cellSize: number;
  gridSize: number;
  offsetX: number;
  offsetY: number;
};

const BASE_VALUE = 1;
const STEP_VALUE = 1;
const CELL_SIZE_MIN = 12;
const CELL_SIZE_MAX = 100;
const CELL_SIZE_STEP = 2;
const AUTO_CELL_SIZE_FLOOR = 2;
const AUTO_FIT_ROW_LIMIT = 25;
const PROJECTION_POINT_LIMIT = 10;
const SMALL_SCREEN_QUERY = "(max-width: 1023px)";
const DEFAULT_START_DATE = "2024-01-01";
const API_BASE = "https://n1-longbridge.johnnywwy.com/api";
const STOCKS_API_URL = `${API_BASE}/stocks`;
const MARKET_API_BASE = `${API_BASE}/kline`;
const KLINE_COUNT = 1000;
const REQUEST_NOW_BUCKET_MS = 30_000;
const DEFAULT_TURNING_THRESHOLD = 1.8;
const EMPTY_KEY_SET = new Set<string>();
const SQUARE_NINE_STATE_KEY = "gann-square-nine-state";
const GUIDE_OPTIONS: Array<{ label: string; value: GuideOption }> = [
  { label: "角线", value: "1x1" },
  { label: "十字线", value: "cross" },
  { label: "1x2 / 2x1", value: "1x2" },
];
const EXTRA_GUIDE_OPTIONS: Array<{ label: string; value: GuideOption }> = [
  { label: "1x3 / 3x1", value: "1x3" },
  { label: "1x4 / 4x1", value: "1x4" },
  { label: "1x8 / 8x1", value: "1x8" },
];
const ALL_GUIDE_OPTIONS = [...GUIDE_OPTIONS, ...EXTRA_GUIDE_OPTIONS];

function SquareNineChart() {
  const storedState = useMemo(readSquareNineState, []);
  const [rowColumn, setRowColumn] = useState(
    normalizeLoop(storedState.rowColumn ?? 16),
  );
  const [matrixMode, setMatrixMode] = useState<MatrixMode>(
    storedState.matrixMode ?? "space",
  );
  const [startDate, setStartDate] = useState(
    storedState.startDate && isValidDateInput(storedState.startDate)
      ? storedState.startDate
      : DEFAULT_START_DATE,
  );
  const [trend, setTrend] = useState<Trend>(storedState.trend ?? "down");
  const [cellSize, setCellSize] = useState(28);
  const [autoFit, setAutoFit] = useState(true);
  const [chartViewport, setChartViewport] = useState({ width: 0, height: 0 });
  const [searchValue, setSearchValue] = useState<number | null>(
    storedState.searchValue ?? 1,
  );
  const [searchDate, setSearchDate] = useState(
    storedState.searchDate && isValidDateInput(storedState.searchDate)
      ? storedState.searchDate
      : DEFAULT_START_DATE,
  );
  const [selectedValue, setSelectedValue] = useState(
    Math.max(1, Math.round(Number(storedState.selectedValue) || 1)),
  );
  const [dimUsClosedDays, setDimUsClosedDays] = useState(
    storedState.dimUsClosedDays ?? true,
  );
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [guideOptions, setGuideOptions] = useState<GuideOption[]>([
    "1x1",
    "1x2",
    "cross",
  ]);
  const [extraGuidesOpen, setExtraGuidesOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(true);
  const [validationOpen, setValidationOpen] = useState(true);
  const [bridgeTurningKind, setBridgeTurningKind] = useState<
    "high" | "low" | null
  >(storedState.bridgeTurningKind ?? null);
  const [bridgeInfo, setBridgeInfo] = useState<{
    symbol?: string;
    symbolName?: string;
    turningKind?: "high" | "low";
    date?: string;
  } | null>(storedState.bridgeInfo ?? null);
  const [watchSymbols, setWatchSymbols] = useState<WatchSymbol[]>([]);
  const [watchKeyword, setWatchKeyword] = useState("");
  const [watchLoading, setWatchLoading] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [selectedTimeSymbolTicker, setSelectedTimeSymbolTicker] = useState(
    storedState.selectedTimeSymbolTicker ?? "",
  );
  const [turningMapLoading, setTurningMapLoading] = useState(false);
  const [turningMapError, setTurningMapError] = useState<string | null>(null);
  const [timeTurningPoints, setTimeTurningPoints] = useState<
    TimeTurningPoint[]
  >([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const hoverKeyRef = useRef<string | null>(null);
  const pendingHoverKeyRef = useRef<string | null>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const loggedPointKeyRef = useRef<string | null>(null);
  const dragStateRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const [isPanning, setIsPanning] = useState(false);

  const loop = normalizeLoop(rowColumn);
  const matrix = useMemo(
    () => generateGannMatrix(BASE_VALUE, STEP_VALUE, loop),
    [loop],
  );
  const size = matrix.length;
  const maxValue = size * size;
  const canAutoFit = rowColumn <= AUTO_FIT_ROW_LIMIT;
  const isAutoFitActive = autoFit && canAutoFit;
  const effectiveCellSize = useMemo(
    () =>
      isAutoFitActive
        ? getAutoCellSize(chartViewport.width, chartViewport.height, size)
        : cellSize,
    [
      cellSize,
      chartViewport.height,
      chartViewport.width,
      isAutoFitActive,
      size,
    ],
  );
  const cellSizeLabel = Number.isInteger(effectiveCellSize)
    ? effectiveCellSize
    : effectiveCellSize.toFixed(1);
  const canvasSize = useMemo(() => {
    const gridSize = size * effectiveCellSize;
    if (!isAutoFitActive) return { width: gridSize, height: gridSize };

    const viewportSize = Math.floor(
      Math.min(chartViewport.width, chartViewport.height),
    );
    const fittedSize = Math.max(1, Math.min(viewportSize, gridSize));
    return { width: fittedSize, height: fittedSize };
  }, [
    chartViewport.height,
    chartViewport.width,
    effectiveCellSize,
    isAutoFitActive,
    size,
  ]);

  const cells = useMemo(
    () =>
      matrix.flatMap((row, r) =>
        row.map((value, c) => ({
          r,
          c,
          value,
          key: `${r}:${c}`,
        })),
      ),
    [matrix],
  );

  const selectedPosition = useMemo(() => {
    const exact = findNumberPosition(matrix, selectedValue);
    if (exact.r !== -1) return exact;
    return { r: loop, c: loop };
  }, [loop, matrix, selectedValue]);

  const selectedKey = `${selectedPosition.r}:${selectedPosition.c}`;
  const trendResult = useMemo(
    () =>
      calculateClickTrend(
        matrix,
        selectedPosition.r,
        selectedPosition.c,
        trend,
        { loop },
      ),
    [loop, matrix, selectedPosition.c, selectedPosition.r, trend],
  );
  const validationPoints = useMemo(
    () =>
      getTrendExtensionPoints(
        matrix,
        selectedPosition.r,
        selectedPosition.c,
        trend,
        { loop },
      ),
    [loop, matrix, selectedPosition.c, selectedPosition.r, trend],
  );
  const mainKeys = useMemo(
    () => new Set(trendResult.mainLine.map((point) => `${point.r}:${point.c}`)),
    [trendResult],
  );
  const crossKeys = useMemo(
    () =>
      new Set(trendResult.crossLine.map((point) => `${point.r}:${point.c}`)),
    [trendResult],
  );
  const visibleMainKeys = matrixMode === "time" ? EMPTY_KEY_SET : mainKeys;
  const visibleCrossKeys = matrixMode === "time" ? EMPTY_KEY_SET : crossKeys;
  const selectedTimeSymbol = useMemo(
    () =>
      watchSymbols.find((item) => item.ticker === selectedTimeSymbolTicker) ??
      null,
    [selectedTimeSymbolTicker, watchSymbols],
  );
  const filteredWatchSymbols = useMemo(
    () => filterWatchSymbols(watchSymbols, watchKeyword).slice(0, 80),
    [watchKeyword, watchSymbols],
  );
  const turningKindByKey = useMemo(() => {
    const markers = new Map<string, "high" | "low">();
    timeTurningPoints.forEach((point) => {
      if (!point.cellKey) return;
      if (point.kind === "high" || !markers.has(point.cellKey)) {
        markers.set(point.cellKey, point.kind);
      }
    });
    return markers;
  }, [timeTurningPoints]);
  const bestDiagonalCandidates = useMemo(
    () =>
      calculateBestDiagonalHitCandidates(cells, timeTurningPoints, startDate),
    [cells, startDate, timeTurningPoints],
  );

  const locateValue = useCallback(() => {
    const value = Math.round(Number(searchValue));
    if (!Number.isFinite(value)) return;
    setSelectedValue(Math.min(maxValue, Math.max(1, value)));
  }, [maxValue, searchValue]);

  const locateDate = useCallback(() => {
    const baseDate = parseDateInput(startDate);
    const targetDate = parseDateInput(searchDate);
    if (!baseDate || !targetDate) return;
    const offset = diffCalendarDays(baseDate, targetDate);
    if (offset < 0) return;
    const rawValue = offset + 1;
    const requiredLoop = getLoopForValue(rawValue);
    if (requiredLoop > rowColumn) setRowColumn(normalizeLoop(requiredLoop));
    const nextMaxValue = (Math.max(requiredLoop, rowColumn) * 2 + 1) ** 2;
    setSelectedValue(Math.min(nextMaxValue, rawValue));
    setBridgeTurningKind(null);
  }, [rowColumn, searchDate, startDate]);

  const applyBridgeSelection = useCallback(
    (payload: GannBridgePayload | null) => {
      if (!payload) return;
      const baseDate = parseDateInput(startDate);
      const hasPayloadDate = Boolean(
        payload.date && isValidDateInput(payload.date),
      );
      const dateValue =
        baseDate && hasPayloadDate
          ? Math.max(
              1,
              diffCalendarDays(baseDate, parseDateInput(payload.date!)!) + 1,
            )
          : null;
      const rawValue = dateValue ?? Math.max(1, Math.round(payload.value));
      const requiredLoop = getLoopForValue(rawValue);
      const nextLoop = normalizeLoop(Math.max(rowColumn, requiredLoop));
      const nextMaxValue = (nextLoop * 2 + 1) ** 2;
      const value = Math.min(nextMaxValue, rawValue);
      if (nextLoop !== rowColumn) setRowColumn(nextLoop);
      setTrend(payload.trend);
      setSelectedValue(value);
      setSearchValue(value);
      setBridgeTurningKind(payload.turningKind ?? null);
      setBridgeInfo({
        symbol: payload.symbol,
        symbolName: payload.symbolName,
        turningKind: payload.turningKind,
        date: payload.date,
      });
      if (hasPayloadDate && payload.date) {
        setMatrixMode("time");
        setSearchDate(payload.date);
        setValidationOpen(false);
      }
    },
    [rowColumn, startDate],
  );

  const pickCell = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      const metrics = getCanvasMetrics(rect.width, rect.height, size);
      const x = clientX - rect.left - metrics.offsetX;
      const y = clientY - rect.top - metrics.offsetY;
      const c = Math.floor(x / metrics.cellSize);
      const r = Math.floor(y / metrics.cellSize);

      if (r < 0 || r >= size || c < 0 || c >= size) return null;
      const value = matrix[r]?.[c];
      if (value === undefined) return null;
      return { r, c, value, key: `${r}:${c}` };
    },
    [matrix, size],
  );

  const clearHoverFrame = useCallback(() => {
    if (hoverFrameRef.current === null) return;
    window.cancelAnimationFrame(hoverFrameRef.current);
    hoverFrameRef.current = null;
  }, []);

  const scheduleHoverCell = useCallback(
    (clientX: number, clientY: number) => {
      const key = pickCell(clientX, clientY)?.key ?? null;
      pendingHoverKeyRef.current = key;

      if (hoverFrameRef.current !== null) return;
      hoverFrameRef.current = window.requestAnimationFrame(() => {
        hoverFrameRef.current = null;
        const nextKey = pendingHoverKeyRef.current;
        if (nextKey === hoverKeyRef.current) return;
        hoverKeyRef.current = nextKey;
        setHoverKey(nextKey);
      });
    },
    [pickCell],
  );

  const startPan = (clientX: number, clientY: number) => {
    const element = chartWrapRef.current;
    if (!element) return;
    clearHoverFrame();
    dragStateRef.current = {
      active: true,
      moved: false,
      startX: clientX,
      startY: clientY,
      lastX: clientX,
      lastY: clientY,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
    };
    setIsPanning(true);
  };

  const movePan = (clientX: number, clientY: number) => {
    const element = chartWrapRef.current;
    const state = dragStateRef.current;
    if (!element || !state.active) return false;
    state.lastX = clientX;
    state.lastY = clientY;
    const dx = clientX - state.startX;
    const dy = clientY - state.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.moved = true;

    if (panFrameRef.current === null) {
      panFrameRef.current = window.requestAnimationFrame(() => {
        panFrameRef.current = null;
        const frameState = dragStateRef.current;
        const target = chartWrapRef.current;
        if (!target || !frameState.active) return;
        target.scrollLeft =
          frameState.scrollLeft - (frameState.lastX - frameState.startX);
        target.scrollTop =
          frameState.scrollTop - (frameState.lastY - frameState.startY);
      });
    }

    return true;
  };

  const stopPan = () => {
    if (!dragStateRef.current.active) return;
    dragStateRef.current.active = false;
    setIsPanning(false);
  };

  const clearHoverCell = useCallback(() => {
    clearHoverFrame();
    pendingHoverKeyRef.current = null;
    if (hoverKeyRef.current !== null) {
      hoverKeyRef.current = null;
      setHoverKey(null);
    }
  }, [clearHoverFrame]);

  const zoomChart = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const element = chartWrapRef.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      const direction = event.deltaY < 0 ? 1 : -1;

      setCellSize((current) => {
        const next = clampCellSize(
          effectiveCellSize + direction * CELL_SIZE_STEP,
        );
        if (next === effectiveCellSize) return current;
        const scale = next / effectiveCellSize;
        window.requestAnimationFrame(() => {
          element.scrollLeft = (element.scrollLeft + offsetX) * scale - offsetX;
          element.scrollTop = (element.scrollTop + offsetY) * scale - offsetY;
        });
        setAutoFit(false);
        return next;
      });
    },
    [effectiveCellSize],
  );

  useEffect(() => {
    if (selectedValue > maxValue) {
      setSelectedValue(maxValue);
      setSearchValue(maxValue);
    }
  }, [maxValue, selectedValue]);

  useEffect(() => {
    applyBridgeSelection(readGannBridgeSelection());

    const handleBridgeSelection = (event: Event) => {
      applyBridgeSelection((event as CustomEvent<GannBridgePayload>).detail);
    };

    window.addEventListener(GANN_BRIDGE_EVENT, handleBridgeSelection);
    return () =>
      window.removeEventListener(GANN_BRIDGE_EVENT, handleBridgeSelection);
  }, [applyBridgeSelection]);

  useEffect(() => {
    if (!canAutoFit && autoFit) setAutoFit(false);
  }, [autoFit, canAutoFit]);

  useEffect(() => {
    writeSquareNineState({
      rowColumn,
      matrixMode,
      startDate,
      trend,
      searchValue,
      searchDate,
      selectedValue,
      dimUsClosedDays,
      bridgeTurningKind,
      bridgeInfo,
      selectedTimeSymbolTicker,
    });
  }, [
    bridgeInfo,
    bridgeTurningKind,
    dimUsClosedDays,
    matrixMode,
    rowColumn,
    searchDate,
    searchValue,
    selectedValue,
    selectedTimeSymbolTicker,
    startDate,
    trend,
  ]);

  useEffect(() => {
    if (matrixMode !== "time" || watchSymbols.length > 0) {
      return;
    }
    let cancelled = false;

    const loadSymbols = async () => {
      setWatchLoading(true);
      setWatchError(null);
      try {
        const symbols = await fetchTimeWatchSymbols();
        if (cancelled) return;
        setWatchSymbols(symbols);
        if (!selectedTimeSymbolTicker && symbols[0]) {
          setSelectedTimeSymbolTicker(symbols[0].ticker);
        }
      } catch (error) {
        console.warn("Square nine watch symbols failed", error);
        if (!cancelled) setWatchError("标的列表加载失败");
      } finally {
        if (!cancelled) setWatchLoading(false);
      }
    };

    void loadSymbols();

    return () => {
      cancelled = true;
    };
  }, [matrixMode, selectedTimeSymbolTicker, watchSymbols.length]);

  useEffect(() => {
    if (matrixMode !== "time" || !selectedTimeSymbol) return;
    let cancelled = false;

    const loadTurningPoints = async () => {
      setTurningMapLoading(true);
      setTurningMapError(null);
      try {
        const bars = await fetchDailyMarketBars(selectedTimeSymbol.ticker);
        const points = mapTurningPointsToTimeCells(
          calculateTimeTurningPoints(bars, DEFAULT_TURNING_THRESHOLD),
          startDate,
          matrix,
        );
        if (cancelled) return;
        setTimeTurningPoints(points);
        setBridgeInfo({
          symbol: selectedTimeSymbol.ticker,
          symbolName: selectedTimeSymbol.name,
          date: points.at(-1)?.date,
          turningKind: points.at(-1)?.kind,
        });
      } catch (error) {
        console.warn("Square nine turning map failed", error);
        if (!cancelled) {
          setTimeTurningPoints([]);
          setTurningMapError("K 线或转折点加载失败");
        }
      } finally {
        if (!cancelled) setTurningMapLoading(false);
      }
    };

    void loadTurningPoints();

    return () => {
      cancelled = true;
    };
  }, [matrix, matrixMode, selectedTimeSymbol, startDate]);

  useEffect(() => {
    if (matrixMode === "time") setValidationOpen(true);
  }, [matrixMode]);

  useEffect(() => {
    if (matrixMode !== "time") return;
    const baseDate = parseDateInput(startDate);
    if (!baseDate) return;
    setSearchDate(formatDateByOffset(baseDate, selectedValue - 1));
  }, [matrixMode, selectedValue, startDate]);

  useEffect(() => {
    const query = window.matchMedia(SMALL_SCREEN_QUERY);
    const syncControls = () => setControlsOpen(!query.matches);

    syncControls();
    query.addEventListener("change", syncControls);

    return () => query.removeEventListener("change", syncControls);
  }, []);

  useEffect(() => {
    const element = chartWrapRef.current;
    if (!element) return;

    const updateViewport = () => {
      setChartViewport({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);

    return () => observer.disconnect();
  }, [controlsOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    drawChart({
      canvas,
      width: canvasSize.width,
      height: canvasSize.height,
      cells,
      size,
      selectedKey,
      hoverKey,
      mainKeys: visibleMainKeys,
      crossKeys: visibleCrossKeys,
      trend,
      guideOptions,
      matrixMode,
      startDate,
      dimUsClosedDays,
      selectedTurningKind: bridgeTurningKind,
      turningKindByKey,
      bestDiagonalCandidates,
    });
  }, [
    bestDiagonalCandidates,
    bridgeTurningKind,
    canvasSize,
    cells,
    crossKeys,
    dimUsClosedDays,
    guideOptions,
    hoverKey,
    visibleMainKeys,
    visibleCrossKeys,
    selectedKey,
    size,
    startDate,
    matrixMode,
    trend,
    turningKindByKey,
  ]);

  useEffect(() => {
    return () => {
      clearHoverFrame();
      if (panFrameRef.current !== null)
        window.cancelAnimationFrame(panFrameRef.current);
    };
  }, [clearHoverFrame]);

  useEffect(() => {
    const logKey = `${selectedValue}:${trend}:${loop}`;
    if (loggedPointKeyRef.current === logKey) return;
    loggedPointKeyRef.current = logKey;

    console.log("九方图点位计算", {
      点击点位: selectedValue,
      趋势: trend,
      主线点位: trendResult.mainLine.map((point) => point.value),
      副线点位: trendResult.crossLine.map((point) => point.value),
      主线延伸点: validationPoints.mainExtension.map((point) => point.value),
      副线延伸点: validationPoints.crossExtension.map((point) => point.value),
    });
  }, [loop, selectedValue, trend, trendResult, validationPoints]);

  useEffect(() => {
    saveGannProjectionResult({
      clickedValue: selectedValue,
      trend,
      source: "九方图",
      lines: [
        ...validationPoints.mainExtension
          .map((point) => ({
            value: point.value,
            kind: "main" as const,
          }))
          .slice(0, trend === "up" ? PROJECTION_POINT_LIMIT : undefined),
        ...validationPoints.crossExtension
          .map((point) => ({
            value: point.value,
            kind: "cross" as const,
          }))
          .slice(0, trend === "up" ? PROJECTION_POINT_LIMIT : undefined),
      ],
    });
  }, [selectedValue, trend, validationPoints]);

  return (
    <ConfigProvider>
      <main className="h-screen overflow-hidden bg-[#f5f5f5] p-2 pb-24 sm:p-3 sm:pb-24 lg:p-4 lg:pb-24">
        <section
          className={`grid h-full w-full grid-rows-[auto_minmax(0,1fr)] gap-3 transition-[grid-template-columns] duration-300 ease-in-out lg:grid-rows-none ${
            controlsOpen
              ? "lg:grid-cols-[minmax(0,1fr)_360px]"
              : "lg:grid-cols-[minmax(0,1fr)_150px]"
          }`}
        >
          <aside className="order-1 flex flex-col gap-4 transition-all duration-300 ease-in-out lg:order-2">
            <Card
              size="small"
              styles={{
                body: {
                  maxHeight: controlsOpen ? "calc(100vh - 96px)" : 0,
                  opacity: controlsOpen ? 1 : 0,
                  overflow: controlsOpen ? "auto" : "hidden",
                  padding: controlsOpen ? undefined : 0,
                  pointerEvents: controlsOpen ? undefined : "none",
                  transform: controlsOpen ? "scaleY(1)" : "scaleY(0.98)",
                  transformOrigin: "top",
                  transition:
                    "max-height 300ms ease, opacity 180ms ease, padding 300ms ease, transform 300ms ease",
                },
                header: {
                  minHeight: 40,
                  paddingInline: controlsOpen ? undefined : 8,
                  transition: "padding 300ms ease",
                },
              }}
              title={
                <Space size={6}>
                  <SettingOutlined />
                  <span className="whitespace-nowrap">基础参数</span>
                </Space>
              }
              extra={
                <Button
                  size="small"
                  type="text"
                  onClick={() => setControlsOpen((open) => !open)}
                >
                  <span className="hidden lg:inline-flex">
                    {controlsOpen ? <RightOutlined /> : <LeftOutlined />}
                  </span>
                  <span className="inline-flex items-center gap-1 lg:hidden">
                    {controlsOpen ? <UpOutlined /> : <DownOutlined />}
                  </span>
                </Button>
              }
            >
              <Row gutter={[12, 14]} align="top">
                <Col xs={24} sm={12} lg={24}>
                  <Control title="类型">
                    <Segmented<MatrixMode>
                      block
                      options={[
                        { label: "空间", value: "space" },
                        { label: "时间", value: "time" },
                      ]}
                      value={matrixMode}
                      onChange={setMatrixMode}
                    />
                  </Control>
                </Col>

                <Col span={24}>
                  <Control
                    title={matrixMode === "time" ? "搜索日期" : "搜索定位"}
                  >
                    <Space.Compact className="w-full">
                      {matrixMode === "time" ? (
                        <Input
                          className="w-full"
                          maxLength={10}
                          placeholder="2024-01-01"
                          value={searchDate}
                          onChange={(event) =>
                            setSearchDate(event.target.value)
                          }
                          onPressEnter={locateDate}
                        />
                      ) : (
                        <InputNumber
                          className="w-full"
                          min={1}
                          max={maxValue}
                          precision={0}
                          value={searchValue}
                          onChange={setSearchValue}
                          onPressEnter={locateValue}
                        />
                      )}
                      <Button
                        type="primary"
                        icon={<SearchOutlined />}
                        onClick={
                          matrixMode === "time" ? locateDate : locateValue
                        }
                      >
                        定位
                      </Button>
                    </Space.Compact>
                  </Control>
                </Col>

                {matrixMode === "time" && (
                  <Col xs={24} sm={12} lg={24}>
                    <Control title="起算时间">
                      <Input
                        maxLength={10}
                        placeholder="2024-01-01"
                        value={startDate}
                        onChange={(event) => setStartDate(event.target.value)}
                      />
                    </Control>
                  </Col>
                )}

                {matrixMode === "time" && (
                  <Col span={24}>
                    <Checkbox
                      checked={dimUsClosedDays}
                      onChange={(event) =>
                        setDimUsClosedDays(event.target.checked)
                      }
                    >
                      淡化美股休市日
                    </Checkbox>
                  </Col>
                )}

                {matrixMode === "space" && (
                  <Col xs={24} sm={12} lg={24}>
                    <Control title="趋势">
                      <Segmented<Trend>
                        block
                        options={[
                          {
                            label: (
                              <Space size={4}>
                                <ArrowUpOutlined />
                                上升
                              </Space>
                            ),
                            value: "up",
                          },
                          {
                            label: (
                              <Space size={4}>
                                <ArrowDownOutlined />
                                下降
                              </Space>
                            ),
                            value: "down",
                          },
                        ]}
                        value={trend}
                        onChange={setTrend}
                      />
                    </Control>
                  </Col>
                )}

                <Col xs={24} sm={12} lg={24}>
                  <Control title="行列">
                    <InputNumber
                      className="w-full"
                      min={1}
                      max={99}
                      precision={0}
                      step={1}
                      value={rowColumn}
                      onChange={(value) =>
                        setRowColumn(normalizeLoop(value ?? 9))
                      }
                    />
                  </Control>
                </Col>

                <Col span={24}>
                  {/* <Control title={`格子大小 ${cellSizeLabel}`}> */}
                  <Checkbox
                    checked={autoFit && canAutoFit}
                    disabled={!canAutoFit}
                    onChange={(event) => setAutoFit(event.target.checked)}
                  >
                    自动适配
                  </Checkbox>
                  <Slider
                    min={CELL_SIZE_MIN}
                    max={CELL_SIZE_MAX}
                    step={CELL_SIZE_STEP}
                    value={effectiveCellSize}
                    disabled={autoFit}
                    onChange={(value) => {
                      setAutoFit(false);
                      setCellSize(clampCellSize(value));
                    }}
                  />
                  {/* </Control> */}
                </Col>

                <Col span={24}>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-700">
                        辅助线
                      </span>
                      <Button
                        size="small"
                        type="link"
                        onClick={() => setExtraGuidesOpen((open) => !open)}
                      >
                        <Space size={4}>
                          {extraGuidesOpen ? (
                            <LeftOutlined rotate={90} />
                          ) : (
                            <DownOutlined />
                          )}
                          {extraGuidesOpen ? "收起" : "更多"}
                        </Space>
                      </Button>
                    </div>
                    <Checkbox.Group
                      value={guideOptions}
                      onChange={(value) =>
                        setGuideOptions(value as GuideOption[])
                      }
                    >
                      <Row gutter={[12, 8]} align="middle">
                        {(extraGuidesOpen
                          ? ALL_GUIDE_OPTIONS
                          : GUIDE_OPTIONS
                        ).map((option) => (
                          <Col span={12} key={option.value}>
                            <Checkbox value={option.value}>
                              {option.label}
                            </Checkbox>
                          </Col>
                        ))}
                      </Row>
                    </Checkbox.Group>
                  </div>
                </Col>
              </Row>
            </Card>

            {matrixMode === "time" && (
              <Card
                size="small"
                title="映射信息"
                styles={{ body: { padding: 12 } }}
              >
                <TimeMappingSummary
                  symbol={selectedTimeSymbol}
                  bridgeInfo={bridgeInfo}
                  loading={turningMapLoading}
                  turningPoints={timeTurningPoints}
                  bestDiagonalCandidates={bestDiagonalCandidates}
                  onAnchorSelect={(candidate) => {
                    setSelectedValue(candidate.value);
                    setSearchValue(candidate.value);
                    setSearchDate(candidate.date);
                    setBridgeTurningKind(null);
                  }}
                />
              </Card>
            )}

            <Card
              size="small"
              title={matrixMode === "time" ? "标的列表" : "验证点位"}
              extra={
                <Button
                  size="small"
                  type="text"
                  onClick={() => setValidationOpen((open) => !open)}
                >
                  {validationOpen ? <UpOutlined /> : <DownOutlined />}
                </Button>
              }
              styles={{ body: { padding: 12 } }}
            >
              <div
                className="overflow-hidden transition-all duration-300 ease-in-out"
                style={{
                  maxHeight: validationOpen
                    ? matrixMode === "time"
                      ? 260
                      : 260
                    : 0,
                  opacity: validationOpen ? 1 : 0,
                }}
              >
                {matrixMode === "time" ? (
                  <TimeSymbolPanel
                    symbols={filteredWatchSymbols}
                    keyword={watchKeyword}
                    loading={watchLoading || turningMapLoading}
                    error={watchError ?? turningMapError}
                    activeTicker={selectedTimeSymbolTicker}
                    onKeywordChange={setWatchKeyword}
                    onSelect={(symbol) => {
                      setSelectedTimeSymbolTicker(symbol.ticker);
                      setBridgeTurningKind(null);
                      setBridgeInfo({
                        symbol: symbol.ticker,
                        symbolName: symbol.name,
                      });
                    }}
                  />
                ) : (
                  <Space direction="vertical" size={10} className="w-full">
                    <PointArray
                      title="主线验证点位"
                      points={validationPoints.mainExtension}
                    />
                    <PointArray
                      title="副线验证点位"
                      points={validationPoints.crossExtension}
                    />
                  </Space>
                )}
              </div>
            </Card>
          </aside>

          <section className="order-2 min-h-0 min-w-0 lg:order-1">
            <Card
              className="h-full"
              size="small"
              styles={{ body: { height: "100%", padding: 8 } }}
            >
              <div
                ref={chartWrapRef}
                className={`h-full select-none overscroll-contain rounded-md bg-white ${
                  isAutoFitActive
                    ? "overflow-hidden cursor-default"
                    : `overflow-auto ${isPanning ? "cursor-grabbing" : "cursor-grab"}`
                }`}
                onWheel={zoomChart}
                onPointerDown={(event) => {
                  if (event.button !== 0 || event.ctrlKey) return;
                  if (isAutoFitActive) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  startPan(event.clientX, event.clientY);
                }}
                onPointerMove={(event) => {
                  if (movePan(event.clientX, event.clientY)) return;
                  scheduleHoverCell(event.clientX, event.clientY);
                }}
                onPointerUp={(event) => {
                  const shouldPickCell =
                    isAutoFitActive ||
                    (dragStateRef.current.active &&
                      !dragStateRef.current.moved);
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  stopPan();
                  if (!shouldPickCell) return;
                  const cell = pickCell(event.clientX, event.clientY);
                  if (!cell) return;
                  setSelectedValue(cell.value);
                  setSearchValue(cell.value);
                  if (matrixMode === "time") {
                    const baseDate = parseDateInput(startDate);
                    if (baseDate)
                      setSearchDate(
                        formatDateByOffset(baseDate, cell.value - 1),
                      );
                  }
                  setBridgeTurningKind(null);
                }}
                onPointerCancel={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  stopPan();
                  clearHoverCell();
                }}
                onPointerLeave={() => {
                  if (dragStateRef.current.active) return;
                  clearHoverCell();
                }}
              >
                <canvas
                  ref={canvasRef}
                  className="block touch-none"
                  style={{ width: canvasSize.width, height: canvasSize.height }}
                />
              </div>
            </Card>
          </section>
        </section>
      </main>
    </ConfigProvider>
  );
}

function Control({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-slate-700">{title}</span>
      {children}
    </div>
  );
}

function PointArray({
  title,
  points,
}: {
  title: string;
  points: MatrixPoint[];
}) {
  return (
    <Card
      size="small"
      type="inner"
      title={title}
      styles={{ body: { padding: 8 } }}
    >
      {points.length > 0 ? (
        <Space size={[6, 6]} wrap>
          {points.map((point) => (
            <Tag
              key={`${point.r}:${point.c}:${point.value}`}
              color="processing"
              bordered={false}
            >
              {point.value}
            </Tag>
          ))}
        </Space>
      ) : (
        <span className="block py-1 text-xs text-slate-400">暂无点位</span>
      )}
    </Card>
  );
}

function TimeMappingSummary({
  symbol,
  bridgeInfo,
  loading,
  turningPoints,
  bestDiagonalCandidates,
  onAnchorSelect,
}: {
  symbol: WatchSymbol | null;
  bridgeInfo: {
    symbol?: string;
    symbolName?: string;
    turningKind?: "high" | "low";
    date?: string;
  } | null;
  loading: boolean;
  turningPoints: TimeTurningPoint[];
  bestDiagonalCandidates: DiagonalHitCandidate[];
  onAnchorSelect: (candidate: DiagonalHitCandidate) => void;
}) {
  const mappedCount = turningPoints.filter((point) => point.cellKey).length;
  const overflowCount = Math.max(0, turningPoints.length - mappedCount);
  const bestHitCount = bestDiagonalCandidates[0]?.hitCount ?? 0;
  const symbolText =
    symbol?.ticker ??
    bridgeInfo?.symbol ??
    (loading ? "加载中..." : "未选择标的");
  const symbolName = symbol?.name ?? bridgeInfo?.symbolName ?? "";

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="text-sm font-semibold text-slate-800">
          {symbolText}
          {symbolName ? ` · ${symbolName}` : ""}
        </div>
        {bridgeInfo?.date && (
          <div className="mt-1 text-xs text-slate-600">
            {bridgeInfo.turningKind === "high" ? "高点" : "低点"} ·{" "}
            {bridgeInfo.date}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <div className="text-slate-500">已映射</div>
          <div className="mt-1 text-lg font-semibold text-slate-800">
            {loading ? "-" : mappedCount}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <div className="text-slate-500">超出范围</div>
          <div className="mt-1 text-lg font-semibold text-slate-800">
            {loading ? "-" : overflowCount}
          </div>
        </div>
      </div>

      {bestHitCount > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50/70 p-2">
          <div className="mb-1 flex items-center justify-between text-xs font-semibold text-red-700">
            <span>主要对角线锚点</span>
            <span>最高命中 {bestHitCount}</span>
          </div>
          <div className="flex max-h-20 flex-wrap gap-1 overflow-auto">
            {bestDiagonalCandidates.map((candidate) => (
              <button
                key={candidate.key}
                type="button"
                onClick={() => onAnchorSelect(candidate)}
                className="rounded border border-red-200 bg-white px-2 py-1 text-left text-xs text-red-700 transition-colors hover:border-red-400 hover:bg-red-100"
              >
                <span className="font-semibold">{candidate.date}</span>
                <span className="ml-1 text-red-500">
                  高{candidate.highCount}/低{candidate.lowCount}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimeSymbolPanel({
  symbols,
  keyword,
  loading,
  error,
  activeTicker,
  onKeywordChange,
  onSelect,
}: {
  symbols: WatchSymbol[];
  keyword: string;
  loading: boolean;
  error: string | null;
  activeTicker: string;
  onKeywordChange: (value: string) => void;
  onSelect: (symbol: WatchSymbol) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Input.Search
        allowClear
        size="small"
        placeholder="搜索代码 / 名称"
        value={keyword}
        onChange={(event) => onKeywordChange(event.target.value)}
      />
      {loading && <div className="text-xs text-slate-500">加载中...</div>}
      {error && <div className="text-xs text-amber-600">{error}</div>}
      <div className="flex max-h-[270px] flex-col gap-1 overflow-auto pr-1">
        {symbols.map((symbol) => {
          const active = symbol.ticker === activeTicker;
          return (
            <button
              key={symbol.ticker}
              type="button"
              onClick={() => onSelect(symbol)}
              className={`rounded-md border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-[#1677ff] bg-blue-50 text-[#1677ff]"
                  : "border-transparent bg-white text-slate-700 hover:border-slate-200 hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">
                  {symbol.ticker}
                </span>
                <Tag color={active ? "processing" : "default"} bordered={false}>
                  {symbol.market}
                </Tag>
              </div>
              <div className="mt-1 truncate text-xs text-slate-500">
                {symbol.name}
              </div>
            </button>
          );
        })}
        {!loading && symbols.length === 0 && (
          <span className="px-2 py-3 text-xs text-slate-400">暂无匹配标的</span>
        )}
      </div>
    </div>
  );
}

function drawChart({
  canvas,
  width,
  height,
  cells,
  size,
  selectedKey,
  hoverKey,
  mainKeys,
  crossKeys,
  trend,
  guideOptions,
  matrixMode,
  startDate,
  dimUsClosedDays,
  selectedTurningKind,
  turningKindByKey,
  bestDiagonalCandidates,
}: {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  cells: Cell[];
  size: number;
  selectedKey: string;
  hoverKey: string | null;
  mainKeys: Set<string>;
  crossKeys: Set<string>;
  trend: Trend;
  guideOptions: GuideOption[];
  matrixMode: MatrixMode;
  startDate: string;
  dimUsClosedDays: boolean;
  selectedTurningKind: "high" | "low" | null;
  turningKindByKey: Map<string, "high" | "low">;
  bestDiagonalCandidates: DiagonalHitCandidate[];
}) {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(width * ratio));
  canvas.height = Math.max(1, Math.floor(height * ratio));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const metrics = getCanvasMetrics(width, height, size);
  const guides = new Set(guideOptions);

  paintSurface(ctx, width, height);
  paintCellBase(
    ctx,
    cells,
    metrics,
    selectedKey,
    hoverKey,
    mainKeys,
    crossKeys,
    trend,
    matrixMode,
    selectedTurningKind,
    turningKindByKey,
  );
  paintCenterGuides(ctx, metrics, guides);
  if (matrixMode === "time") {
    paintBestDiagonalCandidates(ctx, metrics, bestDiagonalCandidates);
    paintSelectedTimeDiagonals(ctx, cells, metrics, selectedKey);
  }
  paintNumbers(
    ctx,
    cells,
    metrics,
    selectedKey,
    hoverKey,
    mainKeys,
    crossKeys,
    trend,
    matrixMode,
    startDate,
    dimUsClosedDays,
    turningKindByKey,
  );
}

function paintSurface(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
}

function paintCellBase(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  metrics: CanvasMetrics,
  selectedKey: string,
  hoverKey: string | null,
  mainKeys: Set<string>,
  crossKeys: Set<string>,
  trend: Trend,
  matrixMode: MatrixMode,
  selectedTurningKind: "high" | "low" | null,
  turningKindByKey: Map<string, "high" | "low">,
) {
  ctx.save();
  const selectedFill =
    selectedTurningKind === "high"
      ? "#f23645"
      : selectedTurningKind === "low"
        ? "#089981"
        : matrixMode === "time"
          ? "#1677ff"
          : trend === "down"
            ? "#ffccc7"
            : "#52c41a";
  const highlightFill = trend === "down" ? "#52c41a" : "#ffccc7";
  const hoverFill = "#ffd666";

  for (const cell of cells) {
    const rect = cellRect(cell, metrics);
    const isSelected = cell.key === selectedKey;
    const isTrendHit = mainKeys.has(cell.key) || crossKeys.has(cell.key);
    const turningKind = turningKindByKey.get(cell.key);
    const isHover = cell.key === hoverKey;

    ctx.fillStyle =
      ringBandIndex(cell, metrics) % 2 === 0 ? "#ffffff" : "#eef4ff";
    if (isTrendHit) ctx.fillStyle = highlightFill;
    if (turningKind === "high") ctx.fillStyle = "rgba(242, 54, 69, 0.84)";
    if (turningKind === "low") ctx.fillStyle = "rgba(8, 153, 129, 0.84)";
    if (isHover) ctx.fillStyle = hoverFill;
    if (isSelected && (matrixMode !== "time" || selectedTurningKind)) {
      ctx.fillStyle = selectedFill;
    }

    ctx.strokeStyle = "#d9d9d9";
    ctx.lineWidth = 1;
    ctx.fillRect(rect.x, rect.y, rect.size, rect.size);
    ctx.strokeRect(rect.x, rect.y, rect.size, rect.size);
  }

  ctx.restore();
}

function paintCenterGuides(
  ctx: CanvasRenderingContext2D,
  metrics: CanvasMetrics,
  guides: Set<GuideOption>,
) {
  const centerX = metrics.offsetX + metrics.gridSize / 2;
  const centerY = metrics.offsetY + metrics.gridSize / 2;
  const top = metrics.offsetY;
  const left = metrics.offsetX;
  const right = metrics.offsetX + metrics.gridSize;
  const bottom = metrics.offsetY + metrics.gridSize;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, metrics.cellSize * 0.035);
  ctx.strokeStyle = "rgba(15, 23, 42, 0.2)";

  if (guides.has("cross")) {
    drawLine(ctx, centerX, top, centerX, bottom);
    drawLine(ctx, left, centerY, right, centerY);
  }

  ctx.lineWidth = Math.max(1, metrics.cellSize * 0.025);

  for (const guide of ALL_GUIDE_OPTIONS) {
    const ratio = guide.value;
    if (ratio === "cross" || !guides.has(ratio)) continue;
    for (const [index, slope] of guideSlopes(ratio).entries()) {
      ctx.setLineDash(
        ratio === "1x2"
          ? [metrics.cellSize * 0.28, metrics.cellSize * 0.18]
          : [],
      );
      const positive = clipLineThroughCenter(
        slope,
        centerX,
        centerY,
        left,
        top,
        right,
        bottom,
      );
      const negative = clipLineThroughCenter(
        -slope,
        centerX,
        centerY,
        left,
        top,
        right,
        bottom,
      );
      ctx.strokeStyle = guideLineColor(ratio, index, 1);
      if (positive)
        drawLine(ctx, positive.x1, positive.y1, positive.x2, positive.y2);
      ctx.strokeStyle = guideLineColor(ratio, index, -1);
      if (negative)
        drawLine(ctx, negative.x1, negative.y1, negative.x2, negative.y2);
    }
  }

  ctx.setLineDash([]);
  ctx.restore();
}

function paintNumbers(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  metrics: CanvasMetrics,
  selectedKey: string,
  hoverKey: string | null,
  mainKeys: Set<string>,
  crossKeys: Set<string>,
  trend: Trend,
  matrixMode: MatrixMode,
  startDate: string,
  dimUsClosedDays: boolean,
  turningKindByKey: Map<string, "high" | "low">,
) {
  if (metrics.cellSize < 8) return;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const numberFontSize = Math.max(7, Math.min(16, metrics.cellSize * 0.3));
  const yearFontSize = Math.max(6, Math.min(13, metrics.cellSize * 0.24));
  const dateFontSize = Math.max(7, Math.min(15, metrics.cellSize * 0.28));
  const selectedText = "#ffffff";
  const highlightText = trend === "down" ? "#ffffff" : "#a8071a";
  const hoverText = "#0f172a";
  const baseDate = parseDateInput(startDate);

  for (const cell of cells) {
    const isSelected = cell.key === selectedKey;
    const isTrendHit = mainKeys.has(cell.key) || crossKeys.has(cell.key);
    const isTurningPoint = turningKindByKey.has(cell.key);
    const isHover = cell.key === hoverKey;
    const center = pointCenter(cell.r, cell.c, metrics);

    ctx.fillStyle = "#0f172a";
    if (isTrendHit) ctx.fillStyle = highlightText;
    if (isTurningPoint) ctx.fillStyle = "#ffffff";
    if (isHover) ctx.fillStyle = hoverText;
    if (isSelected) ctx.fillStyle = selectedText;

    if (matrixMode === "time" && baseDate) {
      const dateParts = getDatePartsByOffset(baseDate, cell.value - 1);
      const isUsClosedDay =
        dimUsClosedDays && isUsMarketClosedDate(dateParts.date);
      ctx.globalAlpha = isUsClosedDay && !isSelected ? 0.34 : 1;
      if (metrics.cellSize < 14) {
        ctx.font = `600 ${numberFontSize}px Inter, Arial, sans-serif`;
        ctx.fillText(dateParts.short, center.x, center.y);
      } else {
        ctx.font = `600 ${yearFontSize}px Inter, Arial, sans-serif`;
        ctx.fillText(
          dateParts.year,
          center.x,
          center.y - metrics.cellSize * 0.14,
        );
        ctx.font = `700 ${dateFontSize}px Inter, Arial, sans-serif`;
        ctx.fillText(
          dateParts.monthDay,
          center.x,
          center.y + metrics.cellSize * 0.16,
        );
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.font = `600 ${numberFontSize}px Inter, Arial, sans-serif`;
      ctx.fillText(
        compactValue(cell.value, metrics.cellSize),
        center.x,
        center.y,
      );
    }
  }

  ctx.restore();
}

function paintSelectedTimeDiagonals(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  metrics: CanvasMetrics,
  selectedKey: string,
) {
  const selectedCell = cells.find((cell) => cell.key === selectedKey);
  if (!selectedCell) return;

  const rect = cellRect(selectedCell, metrics);

  ctx.save();
  ctx.strokeStyle = "rgba(242, 54, 69, 0.95)";
  ctx.lineWidth = Math.max(1.5, metrics.cellSize * 0.075);
  ctx.lineCap = "round";
  drawCellDiagonalExtensions(ctx, rect, metrics);
  ctx.restore();
}

function paintBestDiagonalCandidates(
  ctx: CanvasRenderingContext2D,
  metrics: CanvasMetrics,
  candidates: DiagonalHitCandidate[],
) {
  if (candidates.length === 0) return;

  ctx.save();
  ctx.lineCap = "round";
  const bestHitCount = candidates[0]?.hitCount ?? 1;

  candidates.forEach((candidate) => {
    const rect = cellRect(candidate, metrics);
    const strength = candidate.hitCount / bestHitCount;
    ctx.strokeStyle = `rgba(242, 54, 69, ${0.16 + strength * 0.34})`;
    ctx.lineWidth = Math.max(1, metrics.cellSize * (0.032 + strength * 0.03));
    drawCellDiagonalExtensions(ctx, rect, metrics);
  });

  ctx.setLineDash([]);
  candidates.forEach((candidate) => {
    const rect = cellRect(candidate, metrics);
    const strength = candidate.hitCount / bestHitCount;
    ctx.strokeStyle = `rgba(242, 54, 69, ${0.42 + strength * 0.5})`;
    ctx.lineWidth = Math.max(1.2, metrics.cellSize * (0.04 + strength * 0.04));
    ctx.strokeRect(
      rect.x + metrics.cellSize * 0.12,
      rect.y + metrics.cellSize * 0.12,
      rect.size - metrics.cellSize * 0.24,
      rect.size - metrics.cellSize * 0.24,
    );
  });
  ctx.restore();
}

function drawCellDiagonalExtensions(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; size: number },
  metrics: CanvasMetrics,
) {
  const gridRect = {
    left: metrics.offsetX,
    top: metrics.offsetY,
    right: metrics.offsetX + metrics.gridSize,
    bottom: metrics.offsetY + metrics.gridSize,
  };
  const topLeftLine = clipDiagonalLine(1, rect.y - rect.x, gridRect);
  const topRightLine = clipDiagonalLine(
    -1,
    rect.y + rect.x + rect.size,
    gridRect,
  );

  if (topLeftLine) {
    drawLine(
      ctx,
      topLeftLine.x1,
      topLeftLine.y1,
      topLeftLine.x2,
      topLeftLine.y2,
    );
  }
  if (topRightLine) {
    drawLine(
      ctx,
      topRightLine.x1,
      topRightLine.y1,
      topRightLine.x2,
      topRightLine.y2,
    );
  }
}

function getCanvasMetrics(
  width: number,
  height: number,
  size: number,
): CanvasMetrics {
  const padding = 0;
  const gridSize = Math.max(1, Math.min(width, height) - padding * 2);
  return {
    size,
    cellSize: gridSize / size,
    gridSize,
    offsetX: (width - gridSize) / 2,
    offsetY: (height - gridSize) / 2,
  };
}

function cellRect(cell: MatrixPoint, metrics: CanvasMetrics) {
  return {
    x: metrics.offsetX + cell.c * metrics.cellSize,
    y: metrics.offsetY + cell.r * metrics.cellSize,
    size: metrics.cellSize,
  };
}

function ringBandIndex(cell: MatrixPoint, metrics: CanvasMetrics) {
  const center = Math.floor(metrics.size / 2);
  const ring = Math.max(Math.abs(cell.r - center), Math.abs(cell.c - center));
  return Math.floor(ring / 2);
}

function pointCenter(r: number, c: number, metrics: CanvasMetrics) {
  return {
    x: metrics.offsetX + (c + 0.5) * metrics.cellSize,
    y: metrics.offsetY + (r + 0.5) * metrics.cellSize,
  };
}

function compactValue(value: number, cellSize: number) {
  if (cellSize < 20 && value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

function readSquareNineState(): StoredSquareNineState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SQUARE_NINE_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredSquareNineState;
    return {
      ...parsed,
      matrixMode: parsed.matrixMode === "time" ? "time" : "space",
      trend: parsed.trend === "up" ? "up" : "down",
      bridgeTurningKind:
        parsed.bridgeTurningKind === "high" ||
        parsed.bridgeTurningKind === "low"
          ? parsed.bridgeTurningKind
          : null,
      bridgeInfo: parsed.bridgeInfo ?? null,
      selectedTimeSymbolTicker: parsed.selectedTimeSymbolTicker,
      dimUsClosedDays: parsed.dimUsClosedDays ?? true,
    };
  } catch {
    return {};
  }
}

function writeSquareNineState(state: StoredSquareNineState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SQUARE_NINE_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures; the chart should remain usable.
  }
}

async function fetchTimeWatchSymbols() {
  const response = await fetch(STOCKS_API_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Stock api failed: ${response.status}`);

  const payload = await response.json();
  return extractStockRows(payload)
    .map(normalizeWatchSymbol)
    .filter((item: WatchSymbol | null): item is WatchSymbol => item !== null)
    .filter((item) => ["us", "cn", "hk"].includes(item.category ?? ""))
    .filter(createWatchSymbolDedupe());
}

async function fetchDailyMarketBars(ticker: string) {
  const to =
    Math.floor(Date.now() / REQUEST_NOW_BUCKET_MS) * REQUEST_NOW_BUCKET_MS;
  const from = Math.max(0, to - 365 * 24 * 60 * 60 * 1000 * 4);
  const url = new URL(`${MARKET_API_BASE}/day/${encodeURIComponent(ticker)}`);
  url.searchParams.set("count", String(KLINE_COUNT));
  url.searchParams.set("refresh", "1");
  url.searchParams.set("from", String(from));
  url.searchParams.set("to", String(to));
  url.searchParams.set("adjust", "1");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Market api failed: ${response.status}`);

  const payload = await response.json();
  const rawBars = payload?.data?.klines;
  if (!payload?.success || !Array.isArray(rawBars)) {
    throw new Error("Market api returned an unexpected payload");
  }

  return rawBars
    .map(normalizeApiBar)
    .filter((bar: MarketBar | null): bar is MarketBar => bar !== null)
    .sort((a: MarketBar, b: MarketBar) => a.timestamp - b.timestamp);
}

function calculateTimeTurningPoints(
  bars: MarketBar[],
  threshold: number,
): TimeTurningPoint[] {
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
  const candidates: TimeTurningPoint[] = [];

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

    const timestamp = Number(bars[index].timestamp);
    if (isHigh) {
      candidates.push({
        kind: "high",
        timestamp,
        date: formatDateFromTimestamp(timestamp),
        value: high,
        index,
        key: `high:${timestamp}:${high}`,
      });
    }
    if (isLow) {
      candidates.push({
        kind: "low",
        timestamp,
        date: formatDateFromTimestamp(timestamp),
        value: low,
        index,
        key: `low:${timestamp}:${low}`,
      });
    }
  }

  return compressTimeTurningPoints(candidates, minMove, pivotWindow).slice(-36);
}

function compressTimeTurningPoints(
  candidates: TimeTurningPoint[],
  minMove: number,
  pivotWindow: number,
) {
  const points: TimeTurningPoint[] = [];
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
      if (hasEnoughMove || hasEnoughDistance) points.push(candidate);
    });
  return points;
}

function mapTurningPointsToTimeCells(
  points: TimeTurningPoint[],
  startDate: string,
  matrix: number[][],
) {
  const baseDate = parseDateInput(startDate);
  if (!baseDate) return points;
  const maxValue = matrix.length * matrix.length;
  const keyByValue = new Map<number, string>();
  matrix.forEach((row, r) =>
    row.forEach((value, c) => keyByValue.set(value, `${r}:${c}`)),
  );

  return points.map((point) => {
    const date = parseDateInput(point.date);
    if (!date) return point;
    const value = diffCalendarDays(baseDate, date) + 1;
    if (value < 1 || value > maxValue) return { ...point, cellKey: undefined };
    return { ...point, cellKey: keyByValue.get(value) };
  });
}

function calculateBestDiagonalHitCandidates(
  cells: Cell[],
  points: TimeTurningPoint[],
  startDate: string,
) {
  const baseDate = parseDateInput(startDate);
  if (!baseDate) return [];

  const cellByKey = new Map(cells.map((cell) => [cell.key, cell]));
  const mappedPoints = points
    .map((point) => {
      if (!point.cellKey) return null;
      const cell = cellByKey.get(point.cellKey);
      return cell ? { ...point, cell } : null;
    })
    .filter(
      (
        point,
      ): point is TimeTurningPoint & {
        cell: Cell;
      } => point !== null,
    );

  if (mappedPoints.length === 0) return [];

  let bestHitCount = 0;
  const candidates: DiagonalHitCandidate[] = [];

  cells.forEach((cell) => {
    const hits = mappedPoints.filter(
      (point) =>
        Math.abs(point.cell.r - cell.r) === Math.abs(point.cell.c - cell.c),
    );
    if (hits.length === 0) return;

    const hitCount = hits.length;
    const candidate: DiagonalHitCandidate = {
      ...cell,
      date: formatDateByOffset(baseDate, cell.value - 1),
      hitCount,
      highCount: hits.filter((point) => point.kind === "high").length,
      lowCount: hits.filter((point) => point.kind === "low").length,
    };

    if (hitCount > bestHitCount) {
      bestHitCount = hitCount;
      candidates.length = 0;
      candidates.push(candidate);
      return;
    }

    if (hitCount === bestHitCount) {
      candidates.push(candidate);
    }
  });

  return candidates.sort((a, b) => a.value - b.value);
}

function calculateAverageTrueRange(bars: MarketBar[], period: number) {
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

function normalizeApiBar(raw: Record<string, unknown>): MarketBar | null {
  const timestamp = new Date(String(raw.timestamp ?? raw.time)).getTime();
  const open = Number(raw.open);
  const high = Number(raw.high);
  const low = Number(raw.low);
  const close = Number(raw.close);
  if (![timestamp, open, high, low, close].every(Number.isFinite)) return null;
  return { timestamp, open, high, low, close };
}

function normalizeWatchSymbol(
  raw: Record<string, unknown>,
): WatchSymbol | null {
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
    board: getStringValue(raw.board),
  };
}

function filterWatchSymbols(symbols: WatchSymbol[], keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return symbols;
  return symbols.filter((item) =>
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
      .some((value) => String(value).toLowerCase().includes(normalizedKeyword)),
  );
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
  return ["us", "cn", "hk"].flatMap((category) =>
    asRecordArray(categories[category]).map((row) => ({
      ...row,
      __category: category,
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatDateFromTimestamp(timestamp: number) {
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Boolean(parseDateInput(value));
}

function parseDateInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function getDatePartsByOffset(baseDate: Date, offset: number) {
  const date = new Date(baseDate);
  date.setDate(baseDate.getDate() + offset);
  return getDateParts(date);
}

function formatDateByOffset(baseDate: Date, offset: number) {
  const date = new Date(baseDate);
  date.setDate(baseDate.getDate() + offset);
  const { year, monthDay } = getDateParts(date);
  return `${year}-${monthDay}`;
}

function diffCalendarDays(from: Date, to: Date) {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / 86_400_000);
}

function getDateParts(date: Date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return {
    date,
    year,
    monthDay: `${month}-${day}`,
    short: `${month}/${day}`,
  };
}

function isUsMarketClosedDate(date: Date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return true;
  return getUsMarketHolidayKeys(date.getFullYear()).has(toDateKey(date));
}

function getUsMarketHolidayKeys(year: number) {
  const holidays = [
    observedDate(new Date(year, 0, 1)),
    nthWeekdayOfMonth(year, 0, 1, 3),
    nthWeekdayOfMonth(year, 1, 1, 3),
    getGoodFriday(year),
    lastWeekdayOfMonth(year, 4, 1),
    observedDate(new Date(year, 6, 4)),
    nthWeekdayOfMonth(year, 8, 1, 1),
    nthWeekdayOfMonth(year, 10, 4, 4),
    observedDate(new Date(year, 11, 25)),
    observedDate(new Date(year + 1, 0, 1)),
  ];

  if (year >= 2022) {
    holidays.push(observedDate(new Date(year, 5, 19)));
  }

  return new Set(
    holidays.filter((holiday) => holiday.getFullYear() === year).map(toDateKey),
  );
}

function observedDate(date: Date) {
  const day = date.getDay();
  const observed = new Date(date);
  if (day === 0) observed.setDate(date.getDate() + 1);
  if (day === 6) observed.setDate(date.getDate() - 1);
  return observed;
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number,
) {
  const date = new Date(year, month, 1);
  const offset = (weekday - date.getDay() + 7) % 7;
  date.setDate(1 + offset + (nth - 1) * 7);
  return date;
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number) {
  const date = new Date(year, month + 1, 0);
  const offset = (date.getDay() - weekday + 7) % 7;
  date.setDate(date.getDate() - offset);
  return date;
}

function getGoodFriday(year: number) {
  const easter = getEasterSunday(year);
  easter.setDate(easter.getDate() - 2);
  return easter;
}

function getEasterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeLoop(value: number) {
  return Math.max(1, Math.min(99, Math.trunc(Number(value) || 9)));
}

function getLoopForValue(value: number) {
  return Math.ceil((Math.sqrt(Math.max(1, value)) - 1) / 2);
}

function clampCellSize(value: number) {
  return Math.max(
    CELL_SIZE_MIN,
    Math.min(
      CELL_SIZE_MAX,
      Math.round(Number(value) / CELL_SIZE_STEP) * CELL_SIZE_STEP,
    ),
  );
}

function getAutoCellSize(width: number, height: number, size: number) {
  if (width <= 0 || height <= 0 || size <= 0) return CELL_SIZE_MIN;
  return Math.max(AUTO_CELL_SIZE_FLOOR, Math.min(width, height) / size);
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function clipDiagonalLine(
  slope: 1 | -1,
  intercept: number,
  rect: { left: number; top: number; right: number; bottom: number },
) {
  const points: Array<{ x: number; y: number; key: string }> = [];
  const pushPoint = (x: number, y: number) => {
    const eps = 1e-7;
    if (
      x < rect.left - eps ||
      x > rect.right + eps ||
      y < rect.top - eps ||
      y > rect.bottom + eps
    ) {
      return;
    }
    const px = Math.min(rect.right, Math.max(rect.left, x));
    const py = Math.min(rect.bottom, Math.max(rect.top, y));
    const key = `${px.toFixed(4)},${py.toFixed(4)}`;
    if (!points.some((point) => point.key === key)) {
      points.push({ x: px, y: py, key });
    }
  };

  pushPoint(rect.left, slope * rect.left + intercept);
  pushPoint(rect.right, slope * rect.right + intercept);
  pushPoint((rect.top - intercept) / slope, rect.top);
  pushPoint((rect.bottom - intercept) / slope, rect.bottom);

  if (points.length < 2) return null;

  let best: {
    a: { x: number; y: number };
    b: { x: number; y: number };
    dist: number;
  } | null = null;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dist =
        (points[i].x - points[j].x) ** 2 + (points[i].y - points[j].y) ** 2;
      if (!best || dist > best.dist) {
        best = { a: points[i], b: points[j], dist };
      }
    }
  }

  return best
    ? { x1: best.a.x, y1: best.a.y, x2: best.b.x, y2: best.b.y }
    : null;
}

function guideSlopes(ratio: GuideOption) {
  const slopes: Partial<Record<GuideOption, number[]>> = {
    "1x1": [1],
    "1x2": [1 / 2, 2],
    "1x3": [1 / 3, 3],
    "1x4": [1 / 4, 4],
    "1x8": [1 / 8, 8],
  };

  return slopes[ratio] ?? [];
}

function guideLineColor(ratio: GuideOption, index: number, direction: 1 | -1) {
  if (ratio === "1x1")
    return direction === 1
      ? "rgba(82, 82, 91, 0.36)"
      : "rgba(120, 113, 108, 0.34)";
  if (ratio === "1x2")
    return index === 0 ? "rgba(250, 140, 22, 0.42)" : "rgba(114, 46, 209, 0.4)";

  const colors: Partial<Record<GuideOption, string[]>> = {
    "1x3": [
      "rgba(82, 196, 26, 0.36)",
      "rgba(235, 47, 150, 0.34)",
      "rgba(47, 84, 235, 0.34)",
      "rgba(250, 173, 20, 0.36)",
    ],
    "1x4": [
      "rgba(250, 84, 28, 0.34)",
      "rgba(22, 119, 255, 0.32)",
      "rgba(83, 29, 171, 0.32)",
      "rgba(8, 151, 156, 0.34)",
    ],
    "1x8": [
      "rgba(124, 179, 66, 0.32)",
      "rgba(211, 47, 47, 0.3)",
      "rgba(94, 53, 177, 0.3)",
      "rgba(0, 137, 123, 0.32)",
    ],
  };
  const palette = colors[ratio];
  if (!palette) return "rgba(22, 119, 255, 0.32)";
  return palette[index * 2 + (direction === 1 ? 0 : 1)];
}

function clipLineThroughCenter(
  slope: number,
  centerX: number,
  centerY: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  const points: Array<{ x: number; y: number; key: string }> = [];
  const pushPoint = (x: number, y: number) => {
    const eps = 1e-7;
    if (x < left - eps || x > right + eps || y < top - eps || y > bottom + eps)
      return;
    const px = Math.min(right, Math.max(left, x));
    const py = Math.min(bottom, Math.max(top, y));
    const key = `${px.toFixed(4)},${py.toFixed(4)}`;
    if (!points.some((point) => point.key === key))
      points.push({ x: px, y: py, key });
  };

  pushPoint(left, centerY + slope * (left - centerX));
  pushPoint(right, centerY + slope * (right - centerX));
  if (slope !== 0) {
    pushPoint(centerX + (top - centerY) / slope, top);
    pushPoint(centerX + (bottom - centerY) / slope, bottom);
  }

  if (points.length < 2) return null;

  let best: {
    a: { x: number; y: number };
    b: { x: number; y: number };
    dist: number;
  } | null = null;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dist =
        (points[i].x - points[j].x) ** 2 + (points[i].y - points[j].y) ** 2;
      if (!best || dist > best.dist)
        best = { a: points[i], b: points[j], dist };
    }
  }

  return best
    ? { x1: best.a.x, y1: best.a.y, x2: best.b.x, y2: best.b.y }
    : null;
}

export default SquareNineChart;
