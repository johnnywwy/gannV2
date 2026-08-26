import { BarChartOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Space, Table, Tabs, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildDailyTrendSegments,
  formatDateFromTimestamp,
  type DailyTrendSegment,
} from "../utils/turningPoints";

const API_BASE = "https://n1-longbridge.johnnywwy.com/api";
const SYMBOL = "TSLA.US";
const START_DATE = "2010-06-29";

type StatisticsBar = {
  timestamp: number;
  high: number;
  low: number;
  close: number;
};

type StatisticsPoint = {
  key: string;
  kind: "high" | "low";
  timestamp: number;
  date: string;
  price: number;
  difference: number | null;
  tradingDays: number | null;
  calendarDays: number | null;
};

type IntervalRow = {
  key: string;
  startDate: string;
  endDate: string;
  days: number;
  weeks: number;
  months: number;
};

export default function StatisticsPage() {
  const [bars, setBars] = useState<StatisticsBar[]>([]);
  const [segments, setSegments] = useState<DailyTrendSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatistics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextBars = await fetchDailyBars();
      setBars(nextBars);
      setSegments(buildDailyTrendSegments(nextBars));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "统计数据加载失败");
      setBars([]);
      setSegments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The page owns this initial data load; the effect only starts the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatistics();
  }, [loadStatistics]);

  const points = useMemo(() => buildStatisticsPoints(segments, bars), [bars, segments]);
  const intervalTables = useMemo(
    () => ({
      highHigh: buildIntervalRows(points, "high", "high"),
      lowLow: buildIntervalRows(points, "low", "low"),
      lowHigh: buildIntervalRows(points, "low", "high"),
      highLow: buildIntervalRows(points, "high", "low"),
    }),
    [points],
  );
  const columns = useMemo(
    () => [
      {
        title: "高低点",
        dataIndex: "kind",
        width: 110,
        render: (kind: StatisticsPoint["kind"]) => (
          <Tag color={kind === "high" ? "red" : "green"}>
            {kind === "high" ? "高点" : "低点"}
          </Tag>
        ),
      },
      { title: "日期", dataIndex: "date", width: 130 },
      {
        title: "高低价",
        dataIndex: "price",
        width: 120,
        render: (value: number) => value.toFixed(2),
      },
      {
        title: "点位差",
        dataIndex: "difference",
        width: 120,
        render: (value: number | null) => value ?? "-",
      },
      {
        title: "交易日",
        dataIndex: "tradingDays",
        width: 110,
        render: (value: number | null) => value ?? "-",
      },
      {
        title: "日历日",
        dataIndex: "calendarDays",
        width: 110,
        render: (value: number | null) => value ?? "-",
      },
    ],
    [],
  );
  const intervalColumns = useMemo(
    () => [
      { title: "开始时间", dataIndex: "startDate", width: 180 },
      { title: "结束时间", dataIndex: "endDate", width: 180 },
      { title: "间隔天", dataIndex: "days", width: 140 },
      { title: "间隔周", dataIndex: "weeks", width: 140, render: formatInterval },
      { title: "间隔月", dataIndex: "months", width: 140, render: formatInterval },
    ],
    [],
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-28 pt-6 sm:px-8">
      <div className="mx-auto max-w-[1200px]">
        <Card
          title={
            <Space>
              <BarChartOutlined className="text-[#1677ff]" />
              <span>{SYMBOL} 日线趋势分段统计</span>
            </Space>
          }
          extra={
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadStatistics()}>
              重新计算
            </Button>
          }
        >
          <Space direction="vertical" size={4} className="mb-4">
            <Typography.Text type="secondary">
              统计区间：{START_DATE} 至今 · 数据来源：日线趋势分段
            </Typography.Text>
            <Typography.Text type="secondary">
              点位差按前后价格差取绝对值；差值较小时乘 100，例如 |2.43 - 1.41| × 100 = 102。
            </Typography.Text>
          </Space>

          {error && <Alert className="mb-4" type="error" showIcon message={error} />}
          <Table<StatisticsPoint>
            rowKey="key"
            loading={loading}
            columns={columns}
            dataSource={points}
            pagination={false}
            scroll={{ x: 720, y: "calc(100vh - 290px)" }}
            size="middle"
          />
          <div className="mt-6 border-t border-slate-200 pt-5">
            <Typography.Title level={4} className="!mb-3">附表：趋势段时间周期</Typography.Title>
            <Tabs
              items={[
                ["highHigh", "高点到高点"],
                ["lowLow", "低点到低点"],
                ["lowHigh", "低点到高点"],
                ["highLow", "高点到低点"],
              ].map(([key, label]) => ({
                key,
                label,
                children: (
                  <Table<IntervalRow>
                    rowKey="key"
                    columns={intervalColumns}
                    dataSource={intervalTables[key as keyof typeof intervalTables]}
                    pagination={false}
                    scroll={{ x: 700, y: 420 }}
                    size="small"
                  />
                ),
              }))}
            />
          </div>
        </Card>
      </div>
    </main>
  );
}

async function fetchDailyBars() {
  const from = new Date(`${START_DATE}T00:00:00`).getTime();
  const to = Date.now();
  const url = new URL(`${API_BASE}/kline/day/${encodeURIComponent(SYMBOL)}`);
  url.searchParams.set("from", String(from));
  url.searchParams.set("to", String(to));
  url.searchParams.set("count", "12000");
  url.searchParams.set("refresh", "1");
  url.searchParams.set("adjust", "1");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`日线接口失败：${response.status}`);
  const payload = await response.json();
  if (!payload?.success || !Array.isArray(payload?.data?.klines)) {
    throw new Error("日线接口返回格式不正确");
  }

  return payload.data.klines
    .map(normalizeBar)
    .filter((bar: StatisticsBar | null): bar is StatisticsBar => bar !== null)
    .filter((bar: StatisticsBar) => bar.timestamp >= from)
    .sort((a: StatisticsBar, b: StatisticsBar) => a.timestamp - b.timestamp);
}

function normalizeBar(raw: Record<string, unknown>): StatisticsBar | null {
  const timestamp = new Date(String(raw.timestamp ?? raw.time)).getTime();
  const high = Number(raw.high);
  const low = Number(raw.low);
  const close = Number(raw.close);
  if (![timestamp, high, low, close].every(Number.isFinite)) return null;
  return { timestamp, high, low, close };
}

function buildStatisticsPoints(
  segments: DailyTrendSegment[],
  bars: StatisticsBar[],
): StatisticsPoint[] {
  if (segments.length === 0) return [];
  const rawPoints = segments.flatMap((segment, index) => {
    const startKind = segment.direction === "up" ? "low" : "high";
    const endKind = segment.direction === "up" ? "high" : "low";
    const start = {
      kind: startKind as "high" | "low",
      timestamp: segment.startTimestamp,
      price: segment.startPrice,
      key: `${segment.startTimestamp}:${startKind}`,
    };
    if (index !== segments.length - 1) return [start];
    return [
      start,
      {
        kind: endKind as "high" | "low",
        timestamp: segment.endTimestamp,
        price: segment.endPrice,
        key: `${segment.endTimestamp}:${endKind}`,
      },
    ];
  });

  return rawPoints.map((point, index) => {
    const previous = rawPoints[index - 1];
    const difference = previous
      ? calculatePointDifference(previous.price, point.price)
      : null;
    const calendarDays = previous ? differenceInCalendarDays(previous.timestamp, point.timestamp) : null;
    const tradingDays = previous ? countTradingDays(bars, previous.timestamp, point.timestamp) : null;
    return {
      ...point,
      date: formatDateFromTimestamp(point.timestamp),
      difference,
      tradingDays,
      calendarDays,
    };
  });
}

function calculatePointDifference(previousPrice: number, currentPrice: number) {
  const rawDifference = Math.abs(previousPrice - currentPrice);
  return rawDifference < 10
    ? Math.round(rawDifference * 100)
    : Math.round(rawDifference);
}

function buildIntervalRows(
  points: StatisticsPoint[],
  startKind: StatisticsPoint["kind"],
  endKind: StatisticsPoint["kind"],
): IntervalRow[] {
  const source = startKind === endKind
    ? points.filter((point) => point.kind === startKind)
    : points;
  return source.slice(0, -1).flatMap((start, index) => {
    const end = source[index + 1];
    if (start.kind !== startKind || end.kind !== endKind) return [];
    const days = differenceInCalendarDays(start.timestamp, end.timestamp);
    return [{
      key: `${start.key}-${end.key}-${startKind}-${endKind}`,
      startDate: formatDisplayDate(start.date),
      endDate: formatDisplayDate(end.date),
      days,
      weeks: days / 7,
      months: days / 30,
    }];
  });
}

function formatInterval(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatDisplayDate(value: string) {
  return value.replaceAll("-", "/");
}

function differenceInCalendarDays(from: number, to: number) {
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

function countTradingDays(bars: StatisticsBar[], from: number, to: number) {
  return bars.filter((bar) => bar.timestamp > from && bar.timestamp <= to).length;
}
