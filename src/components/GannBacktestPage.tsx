// src/pages/GannBacktestPage.jsx

import { useState } from 'react';
import { runGannBacktestFromPublicJson } from '../utils/gannBacktest';

const pageStyle = {
  padding: 24,
};

const statsGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '12px 20px',
  marginTop: 16,
};

const statCardStyle = {
  padding: '12px 14px',
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fafafa',
};

const statLabelStyle = {
  fontSize: 13,
  color: '#666',
  marginBottom: 6,
};

const statValueStyle = {
  fontSize: 18,
  fontWeight: 600,
};

const tableWrapStyle = {
  marginTop: 16,
  overflowX: 'auto',
  border: '1px solid #ddd',
  borderRadius: 8,
  padding: 8,
  background: '#fff',
};

const tableStyle = {
  width: '100%',
  minWidth: 1100,
  borderCollapse: 'separate',
  borderSpacing: '0 8px',
};

const thStyle = {
  padding: '12px 16px',
  textAlign: 'left',
  background: '#f5f5f5',
  whiteSpace: 'nowrap',
  fontWeight: 600,
  borderBottom: '1px solid #ddd',
};

const tdStyle = {
  padding: '12px 16px',
  whiteSpace: 'nowrap',
  background: '#fafafa',
  borderTop: '1px solid #eee',
  borderBottom: '1px solid #eee',
};

export default function GannBacktestPage() {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [trades, setTrades] = useState([]);

  const handleRunBacktest = async () => {
    try {
      setLoading(true);

      const result = await runGannBacktestFromPublicJson(
        // 如果你的文件在 public/stockData/AAPL_US/AAPL_US.json，用这个：
        '/stockData/AAPL_US/AAPL_US.json',

        // 如果你真的把 AAPL_US.json 放在 AVAV_US 文件夹下面，才用这个：
        // '/stockData/AVAV_US/AAPL_US.json',

        {
          symbol: 'AAPL_US',

          // 你手动观察图形后确定的起算点
          anchorDate: '2025-04-08',
          anchorPrice: 168,

          // 九方图参数
          loop: 40,
          step: 1,
          trend: 'up',

          // 触发条件
          tolerancePct: 0.005,

          // 交易参数
          takeProfitPct: 0.08,
          stopLossPct: 0.04,
          maxHoldDays: 15,
          nearestLevelCount: 3,
          costPct: 0.001,
        },
      );

      console.log('完整回测结果:', result);
      console.log('统计:', result.stats);
      console.table(result.trades);

      setStats(result.stats);
      setTrades(result.trades);
    } catch (error) {
      console.error('回测失败:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={pageStyle}>
      <h2>江恩九方图回测 - AAPL</h2>

      <button onClick={handleRunBacktest} disabled={loading}>
        {loading ? '回测中...' : '开始回测 AAPL'}
      </button>

      {stats && (
        <div style={{ marginTop: 28 }}>
          <h3>统计结果</h3>

          <div style={statsGridStyle}>
            <StatItem label="交易次数" value={stats.totalTrades} />
            <StatItem label="胜率" value={stats.winRateText} />
            <StatItem label="平均收益" value={stats.avgReturnText} />
            <StatItem label="中位数收益" value={stats.medianReturnText} />
            <StatItem label="平均盈利" value={stats.avgWinText} />
            <StatItem label="平均亏损" value={stats.avgLossText} />
            <StatItem label="期望值" value={stats.expectancyText} />
            <StatItem label="Profit Factor" value={formatNumber(stats.profitFactor)} />
            <StatItem label="最大回撤" value={stats.maxDrawdownText} />
            <StatItem label="平均持有天数" value={stats.avgHoldingDays?.toFixed?.(2)} />
          </div>
        </div>
      )}

      {trades.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h3>交易记录</h3>

          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>信号日</th>
                  <th style={thStyle}>支撑位</th>
                  <th style={thStyle}>线型</th>
                  <th style={thStyle}>买入日</th>
                  <th style={thStyle}>买入价</th>
                  <th style={thStyle}>卖出日</th>
                  <th style={thStyle}>卖出价</th>
                  <th style={thStyle}>退出原因</th>
                  <th style={thStyle}>收益</th>
                  <th style={thStyle}>最大浮盈</th>
                  <th style={thStyle}>最大浮亏</th>
                </tr>
              </thead>

              <tbody>
                {trades.map((trade, index) => (
                  <tr key={`${trade.signalDate}-${index}`}>
                    <td style={tdStyle}>{trade.signalDate}</td>
                    <td style={tdStyle}>{formatNumber(trade.level)}</td>
                    <td style={tdStyle}>{trade.lineType}</td>
                    <td style={tdStyle}>{trade.entryDate}</td>
                    <td style={tdStyle}>{formatNumber(trade.entryPrice)}</td>
                    <td style={tdStyle}>{trade.exitDate}</td>
                    <td style={tdStyle}>{formatNumber(trade.exitPrice)}</td>
                    <td style={tdStyle}>{formatExitReason(trade.exitReason)}</td>
                    <td style={tdStyle}>{trade.returnPctText}</td>
                    <td style={tdStyle}>{trade.mfePctText}</td>
                    <td style={tdStyle}>{trade.maePctText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatItem({ label, value }) {
  return (
    <div style={statCardStyle}>
      <div style={statLabelStyle}>{label}</div>
      <div style={statValueStyle}>{value ?? '-'}</div>
    </div>
  );
}

function formatNumber(value) {
  if (value === Infinity) return 'Infinity';
  if (value === null || value === undefined) return '-';

  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);

  return num.toFixed(3);
}

function formatExitReason(reason) {
  const map = {
    takeProfit: '止盈',
    stopLoss: '止损',
    timeout: '到期退出',
  };

  return map[reason] || reason;
}