import { Icon } from '@iconify/react'
import { Button } from '@heroui/react'
import { useEffect, useRef, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import BacktestComingSoonPage from './components/BacktestComingSoonPage'
import KLineChartPage from './components/KLineChartPage'
import SquareNineWebPage from './platforms/web/SquareNineWebPage'
import StatisticsPage from './components/StatisticsPage'
import WatchlistPage from './components/WatchlistPage'

const menuItems = [
  { path: '/watchlist', label: '自选', icon: { width: 24, height: 24, body: '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>' } },
  {
    path: '/',
    label: '九方图',
    icon: {
      width: 24,
      height: 24,
      body: '<g fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></g>',
    },
  },
  { path: '/kline', label: 'K线图', icon: 'gravity-ui:chart-column' },
  { path: '/backtest', label: '回溯测试', icon: 'gravity-ui:flask' },
]

function App() {
  return (
    <HashRouter>
      <div className="min-h-screen bg-background">
        <PullToRefresh />
        <AnimatedRoutes />
        <BottomMenu />
      </div>
    </HashRouter>
  )
}

function PullToRefresh() {
  const start = useRef<number | null>(null)
  const distance = useRef(0)
  const [pull, setPull] = useState(0)

  useEffect(() => {
    const reset = () => {
      start.current = null
      distance.current = 0
      setPull(0)
    }
    const begin = (event: TouchEvent) => {
      if (!window.matchMedia('(max-width: 767px)').matches || window.scrollY > 0 || event.touches.length !== 1) return
      const target = event.target as Element
      if (target.closest('input, button, canvas, textarea, select')) return
      start.current = event.touches[0].clientY
    }
    const move = (event: TouchEvent) => {
      if (start.current === null) return
      if (window.scrollY > 0 || event.touches.length !== 1) return reset()
      distance.current = Math.max(0, event.touches[0].clientY - start.current)
      setPull(Math.min(distance.current, 120))
    }
    const end = () => {
      const refresh = distance.current >= 90
      reset()
      if (refresh) window.location.reload()
    }
    document.addEventListener('touchstart', begin, { passive: true })
    document.addEventListener('touchmove', move, { passive: true })
    document.addEventListener('touchend', end)
    document.addEventListener('touchcancel', reset)
    return () => {
      document.removeEventListener('touchstart', begin)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', end)
      document.removeEventListener('touchcancel', reset)
    }
  }, [])

  if (pull < 15) return null
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top))] z-[60] flex justify-center md:hidden">
      <span className="rounded-full border border-separator bg-surface px-4 py-2 text-sm text-foreground shadow-lg">
        {pull >= 90 ? '松开刷新' : '下拉刷新'}
      </span>
    </div>
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
        <Route path="/watchlist" element={<WatchlistPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

function BottomMenu() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav aria-label="主导航" className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 w-[min(252px,calc(100%-2rem))] -translate-x-1/2">
      <div className="grid grid-cols-4 gap-1 rounded-full border border-separator/60 bg-surface/85 p-1 shadow-lg backdrop-blur-2xl">
        {menuItems.map((item) => {
          const active = location.pathname === item.path
          return (
            <Button
              key={item.path}
              size="sm"
              variant="ghost"
              onPress={() => navigate(item.path)}
              aria-current={active ? 'page' : undefined}
              className={`relative !h-12 !w-full !min-w-0 !max-w-none rounded-full !p-0 ${active ? 'bg-default text-accent' : 'text-foreground'}`}
            >
              <span className="absolute inset-0 grid grid-rows-[20px_14px] content-center justify-items-center gap-0.5">
                <Icon icon={item.icon} className="block size-5 shrink-0" aria-hidden="true" />
                <span className="block w-full text-center text-[10px] font-medium leading-[14px]">{item.label}</span>
              </span>
            </Button>
          )
        })}
      </div>
    </nav>
  )
}

export default App
