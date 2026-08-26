import { Typography } from "antd";
import AshareSignalScannerPanel from "./AshareSignalScannerPanel";

export default function BacktestComingSoonPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-28 pt-6 sm:px-8">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <div>
          <Typography.Title level={2} className="!mb-1">
            A 股收盘信号扫描
          </Typography.Title>
          <Typography.Text type="secondary">
            扫描全 A 股日线与完整周线，分别统计 NTP、LMACD 底部买入及共振信号。
          </Typography.Text>
        </div>

        <AshareSignalScannerPanel />
      </div>
    </main>
  );
}
