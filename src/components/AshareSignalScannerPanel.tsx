import { CopyOutlined, PlayCircleOutlined, ReloadOutlined, StockOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { saveKLineActiveSymbol } from "../utils/kLineStore";

const API_BASE = "https://n1-longbridge.johnnywwy.com/api";
const SIGNALS_URL = `${API_BASE}/scanner/a-shares/signals`;
const RUN_URL = `${API_BASE}/scanner/a-shares/run`;

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
  universeCount: number;
  scannedCount: number;
  successCount: number;
  failedCount: number;
  groups: {
    ntp: SignalGroup;
    lmacd: SignalGroup;
    confluence: SignalGroup;
  };
  errors?: Array<{ symbol: string; message: string }>;
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
  currentSymbol?: string | null;
  message?: string | null;
  progress: number;
};

type ScanSnapshot = {
  result: ScanResult | null;
  run: ScanRun;
};

export default function AshareSignalScannerPanel() {
  const [messageApi, contextHolder] = message.useMessage();
  const [snapshot, setSnapshot] = useState<ScanSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    void loadSnapshot();
    const timer = window.setInterval(() => void loadSnapshot(true), 10_000);
    return () => window.clearInterval(timer);
  }, [loadSnapshot]);

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
            {symbol}
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
        title: "收盘价",
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

  const tabItems = result
    ? [result.groups.ntp, result.groups.lmacd, result.groups.confluence].map((group) => ({
        key: group.id,
        label: `${group.name} (${group.count})`,
        children: (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Typography.Text type="secondary">{group.description}</Typography.Text>
              <Button
                icon={<CopyOutlined />}
                disabled={!group.securities.length}
                onClick={() => void copyGroupTable(group)}
              >
                复制整个表格（代码、名称）
              </Button>
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
      }))
    : [];

  return (
    <>
      {contextHolder}
      <Card
        title={
          <Space>
            <StockOutlined className="text-red-500" />
            <span>全 A 股 · NTP / LMACD / 共振收盘信号</span>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadSnapshot()}>
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
            每个工作日北京时间 15:30 后自动更新。扫描沪深普通 A 股最近 1000 根前复权日线；LMACD 只统计最新交易日刚触发的“底部买入”。
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
                  <div className="text-xs text-slate-500">
                    已处理 {run.processed} / {run.total}，失败 {run.failedCount}；当前发现 NTP {run.ntpCount}、LMACD {run.lmacdCount}、共振 {run.confluenceCount}
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
                <Col xs={12} md={6}><Card size="small"><Statistic title="A 股标的" value={result.universeCount} /></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Statistic title="成功扫描" value={result.successCount} suffix={result.failedCount ? `/ 失败 ${result.failedCount}` : ""} /></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Statistic title="NTP 买入" value={result.groups.ntp.count} valueStyle={{ color: "#dc2626" }} /></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Statistic title="LMACD 底部买入" value={result.groups.lmacd.count} valueStyle={{ color: "#d97706" }} /></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Statistic title="NTP+LMACD 共振" value={result.groups.confluence.count} valueStyle={{ color: "#7c3aed" }} /></Card></Col>
              </Row>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
                <span>信号交易日：{formatDate(result.signalDate)}</span>
                <span>完成时间：{formatDateTime(result.completedAt)}</span>
                <span>成功率：{result.scannedCount ? ((result.successCount / result.scannedCount) * 100).toFixed(1) : "0.0"}%</span>
              </div>
              <Tabs items={tabItems} />
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
