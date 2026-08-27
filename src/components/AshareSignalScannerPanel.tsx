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
const SIGNALS_URL = `${API_BASE}/scanner/a-shares/signals`;
const RUN_URL = `${API_BASE}/scanner/a-shares/run`;
const HISTORY_URL = `${API_BASE}/scanner/a-shares/history`;

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
};

type SignalPerformance = {
  version: number;
  updatedAt: string;
  scanTime: string;
  summary: {
    totalCount: number;
    strategies: Record<PerformanceStrategy, PerformanceSummary>;
  };
  records: PerformanceRecord[];
};

export default function AshareSignalScannerPanel() {
  const [messageApi, contextHolder] = message.useMessage();
  const [snapshot, setSnapshot] = useState<ScanSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyIndex, setHistoryIndex] = useState<ScanHistorySummary[]>([]);
  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string | null>(null);
  const [historyResult, setHistoryResult] = useState<ScanResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadSnapshot = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(SIGNALS_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`扫描结果接口失败：${response.status}`);
      const payload = await response.json();
      if (!payload?.success || !payload?.data) throw new Error("扫描结果格式不正确");
      setSnapshot(payload.data);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "扫描结果加载失败");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

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
  }, []);

  useEffect(() => {
    void loadSnapshot();
    void loadHistoryIndex();
    const timer = window.setInterval(() => void loadSnapshot(true), 10_000);
    const historyTimer = window.setInterval(() => void loadHistoryIndex(), 60_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(historyTimer);
    };
  }, [loadHistoryIndex, loadSnapshot]);

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
  }, [selectedHistoryDate]);

  const startScan = async () => {
    setStarting(true);
    try {
      const response = await fetch(RUN_URL, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || `启动扫描失败：${response.status}`);
      }
      await loadSnapshot(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "启动扫描失败");
    } finally {
      setStarting(false);
    }
  };

  const result = snapshot?.result ?? null;
  const performance = snapshot?.performance ?? null;
  const run = snapshot?.run;
  const running = run?.status === "running";

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
              pagination={{ pageSize: 20, showSizeChanger: true }}
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
        const summary = performance.summary.strategies[strategy];
        const records = performance.records.filter((item) => item.strategy === strategy);

        return {
          key: strategy,
          label: `${summary.label} (${summary.count})`,
          children: (
            <div className="space-y-4">
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
                当前盈利 {summary.profitableCount} 笔，亏损 {summary.losingCount} 笔，持平 {summary.flatCount} 笔；每个交易日 15:30 更新一次。
              </div>
              <Table<PerformanceRecord>
                rowKey="id"
                size="small"
                columns={performanceColumns}
                dataSource={records}
                pagination={{ pageSize: 20, showSizeChanger: true }}
                locale={{ emptyText: "还没有该类信号跟踪记录" }}
                scroll={{ x: 1100 }}
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
            <StockOutlined className="text-red-500" />
            <span>全 A 股 · 日线 / 周线信号</span>
          </Space>
        }
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => {
                void loadSnapshot();
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
            每个工作日北京时间 15:30 自动扫描，使用完整收盘日 K 和收盘扫描价记录信号。周线只使用已经收盘的完整周 K。LMACD 只统计刚触发的“底部买入”。
          </Typography.Text>

          {error && <Alert type="error" showIcon message={error} />}

          {running && run && (
            <Alert
              type="info"
              showIcon
              message={`正在扫描 ${run.currentSymbol || "A 股市场"}`}
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
                <Col xs={24} md={12}><Card size="small"><Statistic title="A 股标的" value={result.universeCount} /></Card></Col>
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
                      每天 15:30 的完整扫描名单都会按日期永久保存，可以随时切换日期查看，不受最新扫描结果覆盖。
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
                  >
                    <div className="mb-4 text-xs text-slate-500">
                      每次触发都会按 15:30 收盘扫描价建立一笔独立记录；从下一交易日开始持续更新，不会因为信号消失或自选股变化而删除。
                      最近更新：{formatDateTime(performance.updatedAt)}
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
