import { CopyOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  InputNumber,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { saveKLineActiveSymbol } from "../utils/kLineStore";

const API_BASE = "https://n1-longbridge.johnnywwy.com/api/scanner/us-macd-divergence";

type DivergenceContext = {
  detected: boolean;
  type: "direct" | "separated" | "both" | null;
  detectedAt: string | null;
  priceLow: number | null;
  previousPriceLow: number | null;
  diffLow: number | null;
  previousDiffLow: number | null;
};

type SignalSecurity = {
  symbol: string;
  code: string;
  name: string;
  nameCn?: string;
  signal: string;
  signalAt: string;
  latestClose: number;
  macdBullishDivergence?: DivergenceContext | null;
};

type PerformanceRecord = {
  id: string;
  symbol: string;
  name: string;
  signal: string;
  entryMarketDate: string;
  entryPrice: number;
  latestPrice: number;
  currentReturnPct: number | null;
  nextDayReturnPct: number | null;
  maxReturnPct: number | null;
  minReturnPct: number | null;
  holdingTradingDays: number;
  macdBullishDivergence?: DivergenceContext | null;
};

type Snapshot = {
  result: null | {
    completedAt: string;
    signalDate: string;
    listedCount: number;
    universeCount: number;
    successCount: number;
    failedCount: number;
    groups: {
      bullishDivergence: {
        count: number;
        securities: SignalSecurity[];
      };
    };
  };
  performance: null | {
    updatedAt: string;
    records: PerformanceRecord[];
  };
  run: {
    status: "idle" | "running" | "completed" | "failed";
    total: number;
    processed: number;
    successCount: number;
    failedCount: number;
    signalCount: number;
    currentSymbol?: string | null;
    message?: string | null;
    progress: number;
  };
};

export default function UsMacdDivergencePanel() {
  const [messageApi, contextHolder] = message.useMessage();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minimumReturn, setMinimumReturn] = useState(5);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/signals`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.message || `接口失败：${response.status}`);
      setSnapshot(payload.data);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "美股扫描结果加载失败");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const start = async () => {
    setStarting(true);
    try {
      const response = await fetch(`${API_BASE}/run`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.message || `启动失败：${response.status}`);
      messageApi.success(payload.message);
      await load(true);
    } catch (nextError) {
      messageApi.error(nextError instanceof Error ? nextError.message : "启动失败");
    } finally {
      setStarting(false);
    }
  };

  const refreshPrices = async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`${API_BASE}/performance/refresh`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.message || `刷新失败：${response.status}`);
      await load(true);
      messageApi.success(`已更新 ${payload.data.updatedSymbolCount} 只美股`);
    } catch (nextError) {
      messageApi.error(nextError instanceof Error ? nextError.message : "刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  const result = snapshot?.result;
  const performance = snapshot?.performance;
  const run = snapshot?.run;
  const running = run?.status === "running";
  const profitableRecords = useMemo(() => (
    (performance?.records || [])
      .filter(item => Number(item.currentReturnPct) >= minimumReturn)
      .sort((left, right) => Number(right.currentReturnPct) - Number(left.currentReturnPct))
  ), [minimumReturn, performance]);

  const signalColumns = [
    symbolColumn(),
    { title: "名称", dataIndex: "name", ellipsis: true },
    { title: "背离类型", dataIndex: "signal", width: 120, render: (value: string) => <Tag color="purple">{value}</Tag> },
    { title: "扫描价", dataIndex: "latestClose", width: 100, render: formatPrice },
    { title: "触发日", dataIndex: "signalAt", width: 120, render: formatDate },
    {
      title: "背离证据",
      key: "evidence",
      width: 110,
      render: (_: unknown, row: SignalSecurity) => <Evidence context={row.macdBullishDivergence} />,
    },
  ];
  const performanceColumns = [
    symbolColumn(),
    { title: "名称", dataIndex: "name", ellipsis: true },
    { title: "背离类型", dataIndex: "signal", width: 120, render: (value: string) => <Tag color="purple">{value}</Tag> },
    { title: "触发日", dataIndex: "entryMarketDate", width: 110 },
    { title: "扫描价", dataIndex: "entryPrice", width: 90, render: formatPrice },
    { title: "最新价", dataIndex: "latestPrice", width: 90, render: formatPrice },
    { title: "累计盈亏", dataIndex: "currentReturnPct", width: 105, render: renderReturn },
    { title: "次日盈亏", dataIndex: "nextDayReturnPct", width: 105, render: renderReturn },
    {
      title: "最高 / 最低",
      key: "range",
      width: 145,
      render: (_: unknown, row: PerformanceRecord) => `${formatReturn(row.maxReturnPct)} / ${formatReturn(row.minReturnPct)}`,
    },
    { title: "跟踪日", dataIndex: "holdingTradingDays", width: 80, render: (value: number) => `${value} 天` },
  ];

  return (
    <>
      {contextHolder}
      <Card
        title="全美股 · MACD 底背离"
        extra={(
          <Space>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新结果</Button>
            <Button type="primary" icon={<PlayCircleOutlined />} loading={starting} disabled={running} onClick={() => void start()}>
              {running ? "扫描中" : "立即扫描"}
            </Button>
          </Space>
        )}
      >
        <div className="space-y-4">
          <Typography.Text type="secondary">
            扫描活跃美股普通股票，排除明显的 ETF、ETN、权证、优先股和 Unit。按纽约时间 16:30 自动运行，使用与 LMACD 完全相同的直接/隔段底背离公式。
          </Typography.Text>
          {error && <Alert type="error" showIcon message={error} />}
          {running && run && (
            <Alert
              type="info"
              showIcon
              message={`正在扫描 ${run.currentSymbol || "美股市场"}`}
              description={(
                <div className="mt-2">
                  <Progress percent={run.progress} status="active" />
                  <div className="text-xs text-slate-500">
                    已处理 {run.processed}/{run.total}，当前发现 {run.signalCount} 个底背离，失败 {run.failedCount}
                  </div>
                </div>
              )}
            />
          )}
          {run?.status === "failed" && <Alert type="error" showIcon message="最近一次美股扫描失败" description={run.message} />}
          {result ? (
            <>
              <Row gutter={[12, 12]}>
                <Col xs={24} md={8}><Card size="small"><Statistic title="候选证券" value={result.listedCount} /></Card></Col>
                <Col xs={24} md={8}><Card size="small"><Statistic title="活跃普通股票" value={result.universeCount} /></Card></Col>
                <Col xs={24} md={8}><Card size="small"><Statistic title="今日底背离" value={result.groups.bullishDivergence.count} /></Card></Col>
              </Row>
              <div className="flex flex-wrap gap-x-6 text-xs text-slate-500">
                <span>美股交易日：{result.signalDate}</span>
                <span>完成时间：{formatDateTime(result.completedAt)}</span>
                <span>成功 {result.successCount} / 失败 {result.failedCount}</span>
              </div>
              <div className="flex justify-end">
                <Tooltip title="复制全部代码和名称">
                  <Button
                    aria-label="复制全部美股底背离代码和名称"
                    icon={<CopyOutlined />}
                    disabled={!result.groups.bullishDivergence.securities.length}
                    onClick={() => void copySecurities(result.groups.bullishDivergence.securities, messageApi)}
                  />
                </Tooltip>
              </div>
              <Table<SignalSecurity>
                rowKey="symbol"
                size="small"
                columns={signalColumns}
                dataSource={result.groups.bullishDivergence.securities}
                pagination={{ defaultPageSize: 20, pageSizeOptions: [20, 50, 100], showSizeChanger: true, showTotal: total => `共 ${total} 条` }}
                locale={{ emptyText: "最新美股交易日没有新触发的 MACD 底背离" }}
                scroll={{ x: 850 }}
              />
              <Divider />
              <Card
                size="small"
                title="美股底背离持续盈亏跟踪"
                extra={<Button icon={<ReloadOutlined />} loading={refreshing} disabled={running} onClick={() => void refreshPrices()}>刷新当前价格</Button>}
              >
                <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                  <Typography.Text strong className="text-blue-700">最低累计盈利</Typography.Text>
                  <InputNumber min={0} max={1000} precision={1} value={minimumReturn} addonAfter="%" onChange={value => setMinimumReturn(Number(value ?? 5))} />
                  <Typography.Text type="secondary">当前符合 {profitableRecords.length} 笔 / 全部 {performance?.records.length || 0} 笔</Typography.Text>
                </div>
                <Table<PerformanceRecord>
                  rowKey="id"
                  size="small"
                  columns={performanceColumns}
                  dataSource={profitableRecords}
                  pagination={{ defaultPageSize: 20, pageSizeOptions: [20, 50, 100], showSizeChanger: true, showTotal: total => `共 ${total} 条` }}
                  locale={{ emptyText: "还没有达到该盈利条件的美股底背离记录" }}
                  scroll={{ x: 1150 }}
                />
              </Card>
            </>
          ) : !loading && <Alert type="info" showIcon message="还没有美股扫描结果，请点击立即扫描建立第一批日 K 缓存。" />}
        </div>
      </Card>
    </>
  );
}

function symbolColumn() {
  return {
    title: "代码",
    dataIndex: "symbol",
    width: 105,
    render: (symbol: string) => (
      <Button type="link" size="small" className="!px-0" onClick={() => {
        saveKLineActiveSymbol({ ticker: symbol });
        window.location.hash = "/kline";
      }}>
        {symbol.replace(/\.US$/, "")}
      </Button>
    ),
  } as const;
}

function Evidence({ context }: { context?: DivergenceContext | null }) {
  if (!context?.detected) return <Tag>—</Tag>;
  return (
    <Tooltip title={`价格 ${formatPrice(context.previousPriceLow)} → ${formatPrice(context.priceLow)}；DIFF ${formatIndicator(context.previousDiffLow)} → ${formatIndicator(context.diffLow)}`}>
      <Tag color="purple">查看</Tag>
    </Tooltip>
  );
}

async function copySecurities(securities: SignalSecurity[], messageApi: ReturnType<typeof message.useMessage>[0]) {
  const text = [["代码", "名称"], ...securities.map(item => [item.code, item.name])]
    .map(row => row.join("\t"))
    .join("\n");
  await navigator.clipboard.writeText(text);
  messageApi.success(`已复制 ${securities.length} 只标的`);
}

function formatPrice(value?: number | null) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "—";
}

function formatIndicator(value?: number | null) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(4) : "—";
}

function formatReturn(value?: number | null) {
  if (!Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function renderReturn(value?: number | null) {
  const number = Number(value);
  return <Tag color={number > 0 ? "red" : number < 0 ? "green" : "default"}>{formatReturn(value)}</Tag>;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("zh-CN", { timeZone: "America/New_York" });
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}
