import { Icon } from '@iconify/react'
import { Button } from '@heroui/react'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import BacktestComingSoonPage from './components/BacktestComingSoonPage'
import KLineChartPage from './components/KLineChartPage'
import SquareNineWebPage from './platforms/web/SquareNineWebPage'
import StatisticsPage from './components/StatisticsPage'

const menuItems = [
  { path: '/', label: '九方图', icon: 'gravity-ui:grid' },
  { path: '/kline', label: 'K线图', icon: 'gravity-ui:chart-column' },
  { path: '/backtest', label: '回溯测试', icon: 'gravity-ui:flask' },
]

function App() {
  return (
    <HashRouter>
      <div className="min-h-screen bg-background">
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
        <Route path="/" element={<SquareNineWebPage />} />
        <Route path="/kline" element={<KLineChartPage />} />
        <Route path="/backtest" element={<BacktestComingSoonPage />} />
        <Route path="/statistics" element={<StatisticsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

function BottomMenu() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 sm:w-auto sm:max-w-none sm:px-3">
      <div className="flex items-center gap-1 rounded-full border border-separator bg-surface/95 p-1.5 shadow-surface backdrop-blur-xl sm:gap-2 sm:p-2">
        {menuItems.map((item) => {
          const active = location.pathname === item.path
          return (
            <Button
              key={item.path}
              size="sm"
              variant={active ? 'primary' : 'ghost'}
              onPress={() => navigate(item.path)}
              aria-current={active ? 'page' : undefined}
              className="min-h-11 flex-1 rounded-full px-2.5 sm:flex-none sm:px-4"
            >
              <Icon icon={item.icon} aria-hidden="true" />
              {item.label}
            </Button>
          )
        })}
      </div>
    </nav>
  )
}

export default App
