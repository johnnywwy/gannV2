import { CopyOutlined, HistoryOutlined, PlayCircleOutlined, ReloadOutlined, StockOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { saveKLineActiveSymbol } from "../utils/kLineStore";

const API_BASE = "https://n1-longbridge.johnnywwy.com/api";

type MarketVariant = "cn" | "us";

const MARKET_CONFIG = {
  cn: {
    slug: "a-shares",
    marketName: "A 股",
    title: "全 A 股 · 日线 / 周线信号",
    scheduleText: "每个工作日北京时间 15:30",
    scheduleTime: "15:30",
    historyText: "每天 15:30",
    universeText: "",
    iconClass: "text-red-500",
  },
  us: {
    slug: "us-macd-divergence",
    marketName: "美股",
    title: "全美股 · 日线 / 周线信号",
    scheduleText: "每个美股交易日纽约时间 16:30",
    scheduleTime: "16:30（纽约时间）",
    historyText: "每个美股交易日 16:30（纽约时间）",
    universeText: "仅扫描市值不低于 3 亿美元且股价不低于 1 美元的股票。",
    iconClass: "text-blue-500",
  },
} satisfies Record<MarketVariant, Record<string, string>>;

type SignalSecurity = {
  symbol: string;
  name?: string;
  nameCn?: string;
  exchange?: string;
  signal: string;
  signalAt: string;
  latestClose?: number | string | null;
  latestBarAt?: string | null;
  barCount?: number;
};

type SignalGroup = {
  id: string;
  name: string;
  description: string;
  count: number;
  securities: SignalSecurity[];
};

type ScanResult = {
  startedAt: string;
  completedAt: string;
  signalDate?: string | null;
  weeklySignalDate?: string | null;
  universeCount: number;
  scannedCount: number;
  successCount: number;
  failedCount: number;
  groups: {
    ntp: SignalGroup;
    lmacd: SignalGroup;
    confluence: SignalGroup;
  };
  weeklyGroups: {
    ntp: SignalGroup;
    lmacd: SignalGroup;
    confluence: SignalGroup;
  };
  errors?: Array<{ symbol: string; message: string }>;
};

type ScanHistorySummary = {
  date: string;
  startedAt?: string | null;
  completedAt?: string | null;
  successCount: number;
  failedCount: number;
  counts: {
    ntp: number;
    lmacd: number;
    confluence: number;
    weeklyNtp: number;
    weeklyLmacd: number;
    weeklyConfluence: number;
  };
};

type ScanRun = {
  status: "idle" | "running" | "completed" | "failed";
  startedAt?: string | null;
  completedAt?: string | null;
  total: number;
  processed: number;
  successCount: number;
  failedCount: number;
  ntpCount: number;
  lmacdCount: number;
  confluenceCount: number;
  weeklyNtpCount: number;
  weeklyLmacdCount: number;
  weeklyConfluenceCount: number;
  currentSymbol?: string | null;
  message?: string | null;
  progress: number;
};

type ScanSnapshot = {
  result: ScanResult | null;
  performance: SignalPerformance | null;
  run: ScanRun;
};

type PerformanceStrategy = "ntp" | "lmacd" | "confluence";
type NtpSignalFilter = "all" | "买1" | "买2";

type PerformanceSummary = {
  strategy: PerformanceStrategy;
  label: string;
  count: number;
  trackedCount: number;
  profitableCount: number;
  losingCount: number;
  flatCount: number;
  winRate: number | null;
  averageReturnPct: number | null;
  bestReturnPct: number | null;
  worstReturnPct: number | null;
  nextDayTrackedCount: number;
  averageNextDayReturnPct: number | null;
  updatedAt: string;
};

type PerformanceRecord = {
  id: string;
  strategy: PerformanceStrategy;
  strategyLabel: string;
  symbol: string;
  code: string;
  name: string;
  signal: string;
  signalAt: string;
  entryPrice: number;
  entryAt: string;
  entryMarketDate: string;
  latestPrice: number;
  latestPriceAt: string;
  currentReturnPct: number | null;
  nextDayReturnPct: number | null;
  maxReturnPct: number | null;
  minReturnPct: number | null;
  holdingTradingDays: number;
  macdBullishDivergence?: {
    version: number;
    analyzed: boolean;
    detected: boolean;
    type: "direct" | "separated" | "both" | null;
    detectedAt: string | null;
    lookbackTradingDays: number;
    priceLow: number | null;
    previousPriceLow: number | null;
    diffLow: number | null;
    previousDiffLow: number | null;
  } | null;
};

type SignalPerformance = {
  version: number;
  updatedAt: string;
  scanTime: string;
  selectedDate?: string | null;
  availableDates?: Array<{
    date: string;
    count: number;
    trackedCount: number;
  }>;
  summary: {
    totalCount: number;
    strategies: Record<PerformanceStrategy, PerformanceSummary>;
  };
  records: PerformanceRecord[];
};

type PerformancePage = SignalPerformance & {
  pagination: {
    page: number;
    pageSize: number;
    pageCount: number;
    total: number;
  };
};

async function loadAllPerformancePages(performanceUrl: string) {
  const loadPage = async (page: number): Promise<PerformancePage> => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const url = new URL(performanceUrl);
        url.searchParams.set("performanceDate", "all");
        url.searchParams.set("page", String(page));
        url.searchParams.set("pageSize", "500");
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`盈亏跟踪接口失败：${response.status}`);
        const payload = await response.json();
        if (!payload?.success || !payload?.data?.pagination) throw new Error("盈亏跟踪格式不正确");
        return payload.data as PerformancePage;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("盈亏跟踪加载失败");
  };

  const firstPage = await loadPage(1);
  const remainingPages = await Promise.all(
    Array.from({ length: Math.max(0, firstPage.pagination.pageCount - 1) }, (_, index) => loadPage(index + 2)),
  );

  return {
    ...firstPage,
    records: [firstPage, ...remainingPages].flatMap((page) => page.records),
  } satisfies PerformancePage;
}

export default function AshareSignalScannerPanel({ market = "cn" }: { market?: MarketVariant }) {
  const config = MARKET_CONFIG[market];
  const SIGNALS_URL = `${API_BASE}/scanner/${config.slug}/signals`;
  const RUN_URL = `${API_BASE}/scanner/${config.slug}/run`;
  const HISTORY_URL = `${API_BASE}/scanner/${config.slug}/history`;
  const PERFORMANCE_URL = `${API_BASE}/scanner/${config.slug}/performance`;
  const PERFORMANCE_REFRESH_URL = `${API_BASE}/scanner/${config.slug}/performance/refresh`;
  const [messageApi, contextHolder] = message.useMessage();
  const [snapshot, setSnapshot] = useState<ScanSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyIndex, setHistoryIndex] = useState<ScanHistorySummary[]>([]);
  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string | null>(null);
  const [historyResult, setHistoryResult] = useState<ScanResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [performanceDate, setPerformanceDate] = useState("all");
  const [ntpSignalFilter, setNtpSignalFilter] = useState<NtpSignalFilter>("all");

  const loadSnapshot = useCallback(async (quiet = false, requestedPerformanceDate = "all") => {
    if (!quiet) setLoading(true);
    try {
      const url = new URL(SIGNALS_URL);
      url.searchParams.set("performanceDate", requestedPerformanceDate === "all" ? "latest" : requestedPerformanceDate);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`扫描结果接口失败：${response.status}`);
      const payload = await response.json();
      if (!payload?.success || !payload?.data) throw new Error("扫描结果格式不正确");
      const nextSnapshot = requestedPerformanceDate === "all"
        ? { ...payload.data, performance: await loadAllPerformancePages(PERFORMANCE_URL) }
        : payload.data;
      setSnapshot(nextSnapshot);
      const selectedDate = nextSnapshot.performance?.selectedDate;
      setPerformanceDate(requestedPerformanceDate === "all" ? "all" : selectedDate || requestedPerformanceDate);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "扫描结果加载失败");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [PERFORMANCE_URL, SIGNALS_URL]);

  const loadHistoryIndex = useCallback(async () => {
    try {
      const response = await fetch(HISTORY_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`历史扫描接口失败：${response.status}`);
      const payload = await response.json();
      if (!payload?.success || !Array.isArray(payload?.data)) throw new Error("历史扫描格式不正确");
      const index = payload.data as ScanHistorySummary[];
      setHistoryIndex(index);
      setSelectedHistoryDate((current) => (
        current && index.some((item) => item.date === current)
          ? current
          : index[0]?.date ?? null
      ));
      setHistoryError(null);
    } catch (nextError) {
      setHistoryError(nextError instanceof Error ? nextError.message : "历史扫描记录加载失败");
    }
  }, [HISTORY_URL]);

  useEffect(() => {
    void loadSnapshot();
    void loadHistoryIndex();
  }, [loadHistoryIndex, loadSnapshot]);

  useEffect(() => {
    if (snapshot?.run?.status !== "running") return undefined;
    const timer = window.setInterval(() => void loadSnapshot(true, performanceDate), 10_000);
    return () => window.clearInterval(timer);
  }, [loadSnapshot, performanceDate, snapshot?.run?.status]);

  useEffect(() => {
    const historyTimer = window.setInterval(() => void loadHistoryIndex(), 60_000);
    return () => window.clearInterval(historyTimer);
  }, [loadHistoryIndex]);

  useEffect(() => {
    if (!selectedHistoryDate) {
      setHistoryResult(null);
      return;
    }

    const controller = new AbortController();
    const loadHistoryDate = async () => {
      setHistoryLoading(true);
      try {
        const response = await fetch(`${HISTORY_URL}/${selectedHistoryDate}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success || !payload?.data) {
          throw new Error(payload?.message || `历史扫描详情失败：${response.status}`);
        }
        setHistoryResult(payload.data);
        setHistoryError(null);
      } catch (nextError) {
        if (controller.signal.aborted) return;
        setHistoryError(nextError instanceof Error ? nextError.message : "历史扫描详情加载失败");
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    };

    void loadHistoryDate();
    return () => controller.abort();
  }, [HISTORY_URL, selectedHistoryDate]);

  const startScan = async () => {
    setStarting(true);
    try {
      const response = await fetch(RUN_URL, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || `启动扫描失败：${response.status}`);
      }
      await loadSnapshot(true, performanceDate);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "启动扫描失败");
    } finally {
      setStarting(false);
    }
  };

  const refreshPerformancePrices = async () => {
    setRefreshingPrices(true);
    try {
      const response = await fetch(PERFORMANCE_REFRESH_URL, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || `刷新当前价格失败：${response.status}`);
      }
      await loadSnapshot(true, performanceDate);
      const marketDate = payload?.data?.marketDates?.at(-1);
      messageApi.success(
        `已更新 ${payload?.data?.updatedSymbolCount || 0} 只股票${marketDate ? `（行情日期 ${marketDate}）` : ""}`,
      );
    } catch (nextError) {
      messageApi.error(nextError instanceof Error ? nextError.message : "刷新当前价格失败");
    } finally {
      setRefreshingPrices(false);
    }
  };

  const result = snapshot?.result ?? null;
  const performance = snapshot?.performance ?? null;
  const run = snapshot?.run;
  const running = run?.status === "running";
  const performanceDates = useMemo(
    () => performance?.availableDates || [],
    [performance],
  );
  const performanceRecordCount = useMemo(
    () => performanceDates.reduce((total, item) => total + item.count, 0),
    [performanceDates],
  );

  const copyGroupTable = async (group: SignalGroup) => {
    try {
      await writeClipboardText(buildGroupClipboardText(group));
      messageApi.success(`已复制 ${group.count} 只标的的代码和名称`);
    } catch {
      messageApi.error("复制失败，请检查浏览器剪贴板权限");
    }
  };

  const columns = useMemo(
    () => [
      {
        title: "代码",
        dataIndex: "symbol",
        width: 120,
        render: (symbol: string) => (
          <Button
            type="link"
            size="small"
            className="!px-0"
            onClick={() => {
              saveKLineActiveSymbol({ ticker: symbol });
              window.location.hash = "/kline";
            }}
          >
            {symbol.split(".")[0]}
          </Button>
        ),
      },
      {
        title: "名称",
        key: "name",
        render: (_: unknown, row: SignalSecurity) => row.nameCn || row.name || "—",
      },
      {
        title: "信号",
        dataIndex: "signal",
        width: 110,
        render: (value: string) => <Tag color="red">{value}</Tag>,
      },
      {
        title: "扫描价",
        dataIndex: "latestClose",
        width: 100,
        render: (value: number | string | null) =>
          value === null || value === undefined ? "—" : Number(value).toFixed(2),
      },
      {
        title: "触发日期",
        dataIndex: "signalAt",
        width: 120,
        render: formatDate,
      },
    ],
    [],
  );

  const performanceColumns = useMemo(
    () => [
      {
        title: "代码",
        dataIndex: "symbol",
        width: 95,
        render: (symbol: string) => (
          <Button
            type="link"
            size="small"
            className="!px-0"
            onClick={() => {
              saveKLineActiveSymbol({ ticker: symbol });
              window.location.hash = "/kline";
            }}
          >
            {symbol.split(".")[0]}
          </Button>
        ),
      },
      { title: "名称", dataIndex: "name", width: 110 },
      {
        title: "信号",
        dataIndex: "signal",
        width: 165,
        render: (value: string) => <Tag color="red">{value}</Tag>,
      },
      { title: "触发日", dataIndex: "entryMarketDate", width: 110 },
      {
        title: "扫描价",
        dataIndex: "entryPrice",
        width: 90,
        render: formatPrice,
      },
      {
        title: "最新价",
        dataIndex: "latestPrice",
        width: 90,
        render: formatPrice,
      },
      {
        title: "MACD底背离",
        key: "macdBullishDivergence",
        width: 125,
        render: (_: unknown, row: PerformanceRecord) => renderMacdDivergence(row),
      },
      {
        title: "累计盈亏",
        dataIndex: "currentReturnPct",
        width: 105,
        render: renderReturnPct,
      },
      {
        title: "次日盈亏",
        dataIndex: "nextDayReturnPct",
        width: 105,
        render: renderReturnPct,
      },
      {
        title: "最高 / 最低",
        key: "range",
        width: 150,
        render: (_: unknown, row: PerformanceRecord) => (
          <span>{formatReturnPct(row.maxReturnPct)} / {formatReturnPct(row.minReturnPct)}</span>
        ),
      },
      {
        title: "跟踪日",
        dataIndex: "holdingTradingDays",
        width: 80,
        render: (value: number) => `${value} 天`,
      },
    ],
    [],
  );

  const buildGroupTabs = (groups: ScanResult["groups"]) =>
    [groups.ntp, groups.lmacd, groups.confluence].map((group) => ({
        key: group.id,
        label: `${group.name.replace(/^(日线|周线)/, "")} (${group.count})`,
        children: (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Typography.Text type="secondary">{group.description}</Typography.Text>
              <Tooltip title="复制全部代码和名称">
                <Button
                  aria-label={`复制${group.name}全部代码和名称`}
                  icon={<CopyOutlined />}
                  disabled={!group.securities.length}
                  onClick={() => void copyGroupTable(group)}
                />
              </Tooltip>
            </div>
            <Table<SignalSecurity>
              rowKey="symbol"
              size="small"
              columns={columns}
              dataSource={group.securities}
              pagination={{
                defaultPageSize: 20,
                pageSizeOptions: [20, 50, 100],
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`,
              }}
              locale={{ emptyText: "最新交易日没有标的触发该信号" }}
              scroll={{ x: 680 }}
            />
          </div>
        ),
      }));

  const buildTimeframePanel = (
    groups: ScanResult["groups"],
    signalDate: string | null | undefined,
    dateLabel: string,
  ) => (
    <div className="space-y-4">
      <Row gutter={[12, 12]}>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title="NTP 买入" value={groups.ntp.count} valueStyle={{ color: "#dc2626" }} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title="LMACD 底部买入" value={groups.lmacd.count} valueStyle={{ color: "#d97706" }} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title="NTP+LMACD 共振" value={groups.confluence.count} valueStyle={{ color: "#7c3aed" }} />
          </Card>
        </Col>
      </Row>
      <Typography.Text type="secondary" className="text-xs">
        {dateLabel}：{formatDate(signalDate)}
      </Typography.Text>
      <Tabs items={buildGroupTabs(groups)} />
    </div>
  );

  const timeframeItems = result
    ? [
        {
          key: "day",
          label: "日线",
          children: buildTimeframePanel(result.groups, result.signalDate, "信号交易日"),
        },
        {
          key: "week",
          label: "周线",
          children: buildTimeframePanel(result.weeklyGroups, result.weeklySignalDate, "完整周截止日"),
        },
      ]
    : [];

  const performanceItems = performance
    ? (["ntp", "lmacd", "confluence"] as PerformanceStrategy[]).map((strategy) => {
        const dateRecords = performance.records.filter((item) => (
          item.strategy === strategy &&
          (performanceDate === "all" || item.entryMarketDate === performanceDate)
        ));
        const ntpSignalCounts = strategy === "ntp"
          ? {
              all: dateRecords.length,
              "买1": dateRecords.filter((item) => item.signal === "买1").length,
              "买2": dateRecords.filter((item) => item.signal === "买2").length,
            }
          : null;
        const filteredRecords = strategy === "ntp" && ntpSignalFilter !== "all"
          ? dateRecords.filter((item) => item.signal === ntpSignalFilter)
          : dateRecords;
        const summary = summarizePerformanceRecords(filteredRecords, strategy, performance.updatedAt);
        const records = [...filteredRecords]
          .sort((left, right) => Number(right.currentReturnPct ?? -Infinity) - Number(left.currentReturnPct ?? -Infinity));

        return {
          key: strategy,
          label: `${summary.label} (${summary.count})`,
          children: (
            <div className="space-y-4">
              {strategy === "ntp" && ntpSignalCounts && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <Typography.Text strong className="text-red-700">NTP 信号筛选</Typography.Text>
                  <Select<NtpSignalFilter>
                    aria-label="筛选NTP买入信号"
                    value={ntpSignalFilter}
                    className="min-w-48"
                    options={[
                      { value: "all", label: `全部买入 · ${ntpSignalCounts.all} 笔` },
                      { value: "买1", label: `买1 · ${ntpSignalCounts["买1"]} 笔` },
                      { value: "买2", label: `买2 · ${ntpSignalCounts["买2"]} 笔` },
                    ]}
                    onChange={setNtpSignalFilter}
                  />
                  <Typography.Text type="secondary" className="text-xs">
                    筛选后，下方统计和明细表会同步重算。
                  </Typography.Text>
                </div>
              )}
              <Row gutter={[12, 12]}>
                <Col xs={24} md={12} xl={6}>
                  <Card size="small"><Statistic title="累计记录" value={summary.count} /></Card>
                </Col>
                <Col xs={24} md={12} xl={6}>
                  <Card size="small"><Statistic title="当前胜率" value={summary.winRate ?? 0} precision={2} suffix="%" /></Card>
                </Col>
                <Col xs={24} md={12} xl={6}>
                  <Card size="small"><Statistic title="平均累计收益" value={summary.averageReturnPct ?? 0} precision={2} suffix="%" valueStyle={returnColor(summary.averageReturnPct)} /></Card>
                </Col>
                <Col xs={24} md={12} xl={6}>
                  <Card size="small"><Statistic title={`平均次日收益 · ${summary.nextDayTrackedCount} 笔`} value={summary.averageNextDayReturnPct ?? 0} precision={2} suffix="%" valueStyle={returnColor(summary.averageNextDayReturnPct)} /></Card>
                </Col>
              </Row>
              <div className="text-xs text-slate-500">
                当前盈利 {summary.profitableCount} 笔，亏损 {summary.losingCount} 笔，持平 {summary.flatCount} 笔；每个交易日 {config.scheduleTime} 更新一次。
              </div>
              <Table<PerformanceRecord>
                rowKey="id"
                size="small"
                columns={performanceColumns}
                dataSource={records}
                pagination={{
                  defaultPageSize: 20,
                  pageSizeOptions: [20, 50, 100],
                  showSizeChanger: true,
                  showTotal: (total) => `共 ${total} 条`,
                }}
                locale={{ emptyText: "当前筛选条件下没有信号跟踪记录" }}
                scroll={{ x: 1230 }}
              />
            </div>
          ),
        };
      })
    : [];
  const selectedHistorySummary = historyIndex.find((item) => item.date === selectedHistoryDate);
  const historyTimeframeItems = historyResult
    ? [
        {
          key: "history-day",
          label: "日线",
          children: buildTimeframePanel(historyResult.groups, historyResult.signalDate, "信号交易日"),
        },
        {
          key: "history-week",
          label: "周线",
          children: buildTimeframePanel(historyResult.weeklyGroups, historyResult.weeklySignalDate, "完整周截止日"),
        },
      ]
    : [];

  return (
    <>
      {contextHolder}
      <Card
        title={
          <Space>
            <StockOutlined className={config.iconClass} />
            <span>{config.title}</span>
          </Space>
        }
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => {
                void loadSnapshot(false, performanceDate);
                void loadHistoryIndex();
              }}
            >
              刷新结果
            </Button>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={starting}
              disabled={running}
              onClick={() => void startScan()}
            >
              {running ? "扫描中" : "立即扫描"}
            </Button>
          </Space>
        }
      >
        <div className="space-y-4">
          <Typography.Text type="secondary">
            {config.scheduleText} 自动扫描，使用完整收盘日 K 和收盘扫描价记录信号。周线只使用已经收盘的完整周 K。LMACD 只统计刚触发的“底部买入”。
            {config.universeText && ` ${config.universeText}`}
          </Typography.Text>

          {error && <Alert type="error" showIcon message={error} />}

          {running && run && (
            <Alert
              type="info"
              showIcon
              message={`正在扫描 ${run.currentSymbol || `${config.marketName}市场`}`}
              description={
                <div className="mt-2">
                  <Progress percent={run.progress} status="active" />
                  <div className="space-y-1 text-xs text-slate-500">
                    <div>已处理 {run.processed} / {run.total}，失败 {run.failedCount}</div>
                    <div>日线：NTP {run.ntpCount}、LMACD {run.lmacdCount}、共振 {run.confluenceCount}</div>
                    <div>周线：NTP {run.weeklyNtpCount}、LMACD {run.weeklyLmacdCount}、共振 {run.weeklyConfluenceCount}</div>
                  </div>
                </div>
              }
            />
          )}

          {run?.status === "failed" && (
            <Alert type="error" showIcon message="最近一次扫描失败" description={run.message} />
          )}

          {result ? (
            <>
              <Row gutter={[12, 12]}>
                <Col xs={24} md={12}><Card size="small"><Statistic title={`${config.marketName}标的`} value={result.universeCount} /></Card></Col>
                <Col xs={24} md={12}><Card size="small"><Statistic title="成功扫描" value={result.successCount} suffix={result.failedCount ? `/ 失败 ${result.failedCount}` : ""} /></Card></Col>
              </Row>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
                <span>完成时间：{formatDateTime(result.completedAt)}</span>
                <span>成功率：{result.scannedCount ? ((result.successCount / result.scannedCount) * 100).toFixed(1) : "0.0"}%</span>
              </div>
              <Tabs tabPlacement="start" items={timeframeItems} />
              <section className="pt-2">
                <Divider className="!my-6" />
                <Card
                  size="small"
                  className="border-t-4 border-t-amber-500 shadow-sm"
                  title={
                    <Space>
                      <HistoryOutlined />
                      <span>历史扫描记录</span>
                    </Space>
                  }
                  extra={
                    <Select
                      aria-label="选择历史扫描日期"
                      value={selectedHistoryDate}
                      placeholder="选择扫描日期"
                      className="min-w-64"
                      loading={historyLoading}
                      options={historyIndex.map((item) => ({
                        value: item.date,
                        label: `${item.date} · NTP ${item.counts.ntp} / LMACD ${item.counts.lmacd} / 共振 ${item.counts.confluence}`,
                      }))}
                      onChange={setSelectedHistoryDate}
                    />
                  }
                >
                  <div className="space-y-4">
                    <Typography.Text type="secondary">
                      {config.historyText} 的完整扫描名单都会按日期永久保存，可以随时切换日期查看，不受最新扫描结果覆盖。
                    </Typography.Text>
                    {historyError && <Alert type="error" showIcon message={historyError} />}
                    {selectedHistorySummary && (
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
                        <span>扫描日期：{selectedHistorySummary.date}</span>
                        <span>完成时间：{formatDateTime(selectedHistorySummary.completedAt)}</span>
                        <span>成功 {selectedHistorySummary.successCount} / 失败 {selectedHistorySummary.failedCount}</span>
                      </div>
                    )}
                    {historyResult ? (
                      <Tabs tabPlacement="start" items={historyTimeframeItems} />
                    ) : (
                      !historyLoading && !historyError && <Alert type="info" showIcon message="还没有历史扫描记录" />
                    )}
                  </div>
                </Card>
              </section>
              {performance && (
                <section className="pt-2">
                  <Divider className="!my-6" />
                  <Card
                    size="small"
                    className="border-t-4 border-t-blue-500 shadow-sm"
                    title="信号触发后的持续盈亏跟踪"
                    extra={
                      <Button
                        type="primary"
                        icon={<ReloadOutlined />}
                        loading={refreshingPrices}
                        disabled={running}
                        onClick={() => void refreshPerformancePrices()}
                      >
                        刷新当前价格
                      </Button>
                    }
                  >
                    <div className="mb-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                        <Typography.Text strong className="text-blue-700">触发日过滤</Typography.Text>
                        <Select
                          aria-label="选择盈亏跟踪触发日期"
                          value={performanceDate}
                          className="min-w-56"
                          options={[
                            { value: "all", label: `全部日期 · ${performanceRecordCount} 笔` },
                            ...performanceDates.map((item) => ({
                              value: item.date,
                              label: `${item.date} · ${item.count} 笔`,
                            })),
                          ]}
                          onChange={(date) => {
                            setPerformanceDate(date);
                            void loadSnapshot(true, date);
                          }}
                        />
                      </div>
                      <div className="text-xs text-slate-500">
                        每次触发都会按 {config.scheduleTime} 收盘扫描价建立一笔独立记录；从下一交易日开始持续更新，不会因为信号消失或自选股变化而删除。
                        最近更新：{formatDateTime(performance.updatedAt)}
                      </div>
                    </div>
                    <Tabs tabPlacement="start" items={performanceItems} />
                  </Card>
                </section>
              )}
            </>
          ) : (
            !loading && <Alert type="warning" showIcon message="还没有扫描结果，请点击“立即扫描”生成第一批分组。" />
          )}
        </div>
      </Card>
    </>
  );
}

function buildGroupClipboardText(group: SignalGroup) {
  const rows = group.securities.map((security) => [
    security.symbol.split(".")[0],
    security.nameCn || security.name || "",
  ]);

  return [["代码", "名称"], ...rows]
    .map((row) => row.join("\t"))
    .join("\n");
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) throw new Error("Copy command failed");
  } finally {
    textarea.remove();
  }
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

function formatPrice(value?: number | string | null) {
  const price = Number(value);
  return Number.isFinite(price) ? price.toFixed(2) : "—";
}

function formatReturnPct(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function returnColor(value?: number | null) {
  if (value === null || value === undefined) return undefined;
  if (value > 0) return { color: "#dc2626" };
  if (value < 0) return { color: "#16a34a" };
  return undefined;
}

function renderReturnPct(value?: number | null) {
  const color = value === null || value === undefined
    ? undefined
    : value > 0
      ? "red"
      : value < 0
        ? "green"
        : "default";

  return <Tag color={color}>{formatReturnPct(value)}</Tag>;
}

function renderMacdDivergence(row: PerformanceRecord) {
  const context = row.macdBullishDivergence;
  if (!context?.analyzed) return <Tag>待分析</Tag>;
  if (!context.detected) return <Tag>无</Tag>;

  const typeLabel = context.type === "direct"
    ? "直接"
    : context.type === "separated"
      ? "隔段"
      : "直接+隔段";

  return (
    <Tooltip
      title={(
        <div>
          <div>背离日期：{formatDate(context.detectedAt)}</div>
          <div>价格低点：{formatPrice(context.previousPriceLow)} → {formatPrice(context.priceLow)}</div>
          <div>DIFF 低点：{formatIndicatorValue(context.previousDiffLow)} → {formatIndicatorValue(context.diffLow)}</div>
        </div>
      )}
    >
      <Tag color="purple">有 · {typeLabel}</Tag>
    </Tooltip>
  );
}

function formatIndicatorValue(value?: number | null) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toFixed(4);
}

function summarizePerformanceRecords(
  records: PerformanceRecord[],
  strategy: PerformanceStrategy,
  updatedAt: string,
): PerformanceSummary {
  const returns = records
    .map((item) => item.currentReturnPct)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const nextDayReturns = records
    .map((item) => item.nextDayReturnPct)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const profitableCount = returns.filter((value) => value > 0).length;
  const losingCount = returns.filter((value) => value < 0).length;

  return {
    strategy,
    label: records[0]?.strategyLabel || ({
      ntp: "NTP买入",
      lmacd: "LMACD底部买入",
      confluence: "NTP+LMACD共振",
    } satisfies Record<PerformanceStrategy, string>)[strategy],
    count: records.length,
    trackedCount: returns.length,
    profitableCount,
    losingCount,
    flatCount: returns.length - profitableCount - losingCount,
    winRate: returns.length ? roundPerformanceMetric((profitableCount / returns.length) * 100, 2) : null,
    averageReturnPct: averageMetric(returns),
    bestReturnPct: returns.length ? Math.max(...returns) : null,
    worstReturnPct: returns.length ? Math.min(...returns) : null,
    nextDayTrackedCount: nextDayReturns.length,
    averageNextDayReturnPct: averageMetric(nextDayReturns),
    updatedAt,
  };
}

function averageMetric(values: number[]) {
  return values.length
    ? roundPerformanceMetric(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
}

function roundPerformanceMetric(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}
