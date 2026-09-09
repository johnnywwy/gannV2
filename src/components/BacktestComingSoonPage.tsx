import { Tabs, Typography } from "antd";
import AshareSignalScannerPanel from "./AshareSignalScannerPanel";
import UsMacdDivergencePanel from "./UsMacdDivergencePanel";

export default function BacktestComingSoonPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-28 pt-6 sm:px-8">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <div>
          <Typography.Title level={2} className="!mb-1">
            市场收盘信号扫描
          </Typography.Title>
          <Typography.Text type="secondary">
            分市场扫描日线技术信号，并持续跟踪信号触发后的盈亏表现。
          </Typography.Text>
        </div>

        <Tabs
          size="large"
          items={[
            { key: "cn", label: "A 股", children: <AshareSignalScannerPanel /> },
            { key: "us", label: "美股 · MACD底背离", children: <UsMacdDivergencePanel /> },
          ]}
        />
      </div>
    </main>
  );
}
