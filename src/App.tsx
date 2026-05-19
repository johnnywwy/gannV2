import { AppstoreOutlined, ExperimentOutlined, StockOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import BacktestComingSoonPage from './components/BacktestComingSoonPage'
import KLineChartPage from './components/KLineChartPage'
import SquareNineChart from './components/SquareNineChart'

const menuItems = [
  { path: '/', label: '九方图', icon: <AppstoreOutlined /> },
  { path: '/kline', label: 'K线图', icon: <StockOutlined /> },
  { path: '/backtest', label: '回溯测试', icon: <ExperimentOutlined /> },
]

function App() {
  return (
    <HashRouter>
      <div className="min-h-screen bg-[#f5f5f5]">
        <AnimatedRoutes />
        <BottomMenu />
      </div>
    </HashRouter>
  )
}

function AnimatedRoutes() {
  const location = useLocation()

  return (
    <div key={location.pathname} className="page-route">
      <Routes location={location}>
        <Route path="/" element={<SquareNineChart />} />
        <Route path="/kline" element={<KLineChartPage />} />
        <Route path="/backtest" element={<BacktestComingSoonPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

function BottomMenu() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 px-3">
      <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-2 shadow-lg">
        {menuItems.map((item) => {
          const active = location.pathname === item.path
          return (
            <Button
              key={item.path}
              type={active ? 'primary' : 'default'}
              shape="round"
              icon={item.icon}
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </Button>
          )
        })}
      </div>
    </nav>
  )
}

export default App
