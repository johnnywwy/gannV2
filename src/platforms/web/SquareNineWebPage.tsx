import { Icon } from '@iconify/react'
import { Button, Card, Label, NumberField, Slider } from '@heroui/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  calculateClickTrend,
  findNumberPosition,
  generateGannMatrix,
  getTrendExtensionPoints,
  type MatrixPoint,
  type Trend,
} from '../../utils/squareNine'

const MOBILE_QUERY = '(max-width: 767px)'
const DESKTOP_LOOPS = [8, 12, 16]
const MOBILE_LOOPS = [3, 4, 5, 6]
const STORAGE_KEY = 'gann-square-nine-layout-v2'

type LayoutState = {
  desktopLoop: number
  mobileLoop: number
}

function readLayoutState(): LayoutState {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<LayoutState>
    return {
      desktopLoop: normalizeLoop(value.desktopLoop ?? 16),
      mobileLoop: normalizeLoop(value.mobileLoop ?? 5),
    }
  } catch {
    return { desktopLoop: 16, mobileLoop: 5 }
  }
}

export default function SquareNineWebPage() {
  const [initialLayout] = useState(() => readLayoutState())
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  const [desktopLoop, setDesktopLoop] = useState(initialLayout.desktopLoop)
  const [mobileLoop, setMobileLoop] = useState(initialLayout.mobileLoop)
  const [trend, setTrend] = useState<Trend>('down')
  const [selectedValue, setSelectedValue] = useState(1)
  const [searchValue, setSearchValue] = useState(1)
  const [autoFit, setAutoFit] = useState(true)
  const [manualCellSize, setManualCellSize] = useState(28)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const loop = isMobile ? mobileLoop : desktopLoop
  const setLoop = isMobile ? setMobileLoop : setDesktopLoop
  const presets = isMobile ? MOBILE_LOOPS : DESKTOP_LOOPS
  const matrix = useMemo(() => generateGannMatrix(1, 1, loop), [loop])
  const size = matrix.length
  const maxValue = size * size
  const effectiveSelectedValue = Math.min(selectedValue, maxValue)
  const selectedPosition = useMemo(
    () => findNumberPosition(matrix, effectiveSelectedValue),
    [effectiveSelectedValue, matrix],
  )
  const trendResult = useMemo(() => {
    if (selectedPosition.r < 0) return null
    return calculateClickTrend(matrix, selectedPosition.r, selectedPosition.c, trend, { loop })
  }, [loop, matrix, selectedPosition, trend])
  const validationPoints = useMemo(() => {
    if (selectedPosition.r < 0) return { mainExtension: [], crossExtension: [] }
    return getTrendExtensionPoints(matrix, selectedPosition.r, selectedPosition.c, trend, { loop })
  }, [loop, matrix, selectedPosition, trend])

  const cellSize = useMemo(() => {
    if (!autoFit) return manualCellSize
    const available = Math.max(
      220,
      Math.min(viewport.width, viewport.height || viewport.width),
    )
    if (isMobile) return Math.max(22, available / size)
    return Math.max(12, Math.floor(available / size))
  }, [autoFit, isMobile, manualCellSize, size, viewport])
  const canvasSize = size * cellSize

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY)
    const sync = () => setIsMobile(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ desktopLoop, mobileLoop }))
  }, [desktopLoop, mobileLoop])

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const update = () => setViewport({ width: element.clientWidth, height: element.clientHeight })
    const observer = new ResizeObserver(update)
    update()
    observer.observe(element)
    return () => observer.disconnect()
  }, [isMobile])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    drawSquareNine(canvas, matrix, {
      cellSize,
      selectedValue: effectiveSelectedValue,
      trend,
      mainLine: trendResult?.mainLine ?? [],
      crossLine: trendResult?.crossLine ?? [],
    })
  }, [cellSize, effectiveSelectedValue, matrix, trend, trendResult])

  const locate = useCallback(() => {
    const value = clamp(Math.round(searchValue || 1), 1, maxValue)
    setSearchValue(value)
    setSelectedValue(value)
  }, [maxValue, searchValue])

  const selectFromCanvas = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const col = Math.floor((clientX - rect.left) / (rect.width / size))
    const row = Math.floor((clientY - rect.top) / (rect.height / size))
    const value = matrix[row]?.[col]
    if (!value) return
    setSelectedValue(value)
    setSearchValue(value)
  }, [matrix, size])

  const controls = (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground">趋势方向</span>
          <span className="text-xs text-muted">影响验证线方向</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="ghost"
            onPress={() => setTrend('up')}
            className={`min-h-11 bg-danger text-white hover:bg-danger ${trend === 'up' ? '' : 'opacity-55'}`}
          >
            <Icon icon="gravity-ui:arrow-up" aria-hidden="true" />
            上升
          </Button>
          <Button
            variant="ghost"
            onPress={() => setTrend('down')}
            className={`min-h-11 bg-success text-white hover:bg-success ${trend === 'down' ? '' : 'opacity-55'}`}
          >
            <Icon icon="gravity-ui:arrow-down" aria-hidden="true" />
            下降
          </Button>
        </div>
      </section>

      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground">图表行列</span>
          <Pill>{size} × {size}</Pill>
        </div>
        <div className={`grid gap-2 ${isMobile ? 'grid-cols-3' : 'grid-cols-3'}`}>
          {presets.map((preset) => {
            const dimension = preset * 2 + 1
            return (
              <Button
                key={preset}
                size="sm"
                variant={loop === preset ? 'primary' : 'secondary'}
                onPress={() => setLoop(preset)}
                aria-label={`设置为 ${dimension} 乘 ${dimension} 行列`}
                className="min-h-11"
              >
                {dimension}×{dimension}
              </Button>
            )
          })}
        </div>
        <p className="text-xs leading-5 text-muted">
          {isMobile ? '手机端限制为紧凑档位，减少纵向滚动与误触。' : '桌面端保留高密度档位，适合大屏观察延伸关系。'}
        </p>
      </section>

      <section className="grid gap-2">
        <NumberField
          value={searchValue}
          minValue={1}
          maxValue={maxValue}
          step={1}
          onChange={(value) => setSearchValue(value ?? 1)}
          fullWidth
          variant="secondary"
        >
          <Label>定位数值</Label>
          <NumberField.Group>
            <NumberField.DecrementButton />
            <NumberField.Input onKeyDown={(event) => event.key === 'Enter' && locate()} />
            <NumberField.IncrementButton />
          </NumberField.Group>
        </NumberField>
        <Button variant="primary" onPress={locate} fullWidth className="min-h-11">
          <Icon icon="gravity-ui:magnifier" aria-hidden="true" />
          定位到九方图
        </Button>
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground">格子尺寸</span>
          <Button size="sm" variant={autoFit ? 'primary' : 'secondary'} onPress={() => setAutoFit(!autoFit)}>
            自动适配
          </Button>
        </div>
        <Slider
          aria-label="格子尺寸"
          minValue={18}
          maxValue={56}
          step={2}
          value={manualCellSize}
          isDisabled={autoFit}
          onChange={(value) => setManualCellSize(Number(Array.isArray(value) ? value[0] : value))}
        >
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
      </section>
    </div>
  )

  const chart = (
    <canvas
      ref={canvasRef}
      width={canvasSize}
      height={canvasSize}
      className={`block max-w-none touch-manipulation ${isMobile ? '' : 'rounded-xl shadow-surface'}`}
      style={{ width: canvasSize, height: canvasSize }}
      onPointerUp={(event) => selectFromCanvas(event.clientX, event.clientY)}
      aria-label={`${size} 乘 ${size} 江恩九方图，当前选择 ${effectiveSelectedValue}`}
    />
  )

  if (isMobile) {
    return (
      <main className="min-h-dvh bg-background px-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] text-foreground">
        <header className="flex items-center justify-between gap-3 px-1 pb-3 pt-1">
          <div className="min-w-0">
            <p className="text-xs font-medium text-accent">GANN TOOLKIT</p>
            <h1 className="truncate text-xl font-semibold tracking-tight">江恩九方图</h1>
          </div>
          <Pill>{size}×{size}</Pill>
        </header>

        <section className="overflow-hidden rounded-[1.75rem] border border-separator bg-surface shadow-surface">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm font-semibold">选中 {effectiveSelectedValue}</p>
              <p className="text-xs text-muted">
                {trend === 'up' ? '上升趋势' : '下降趋势'} · {size > 13 ? '拖动画布查看全部格子' : '点击格子查看点位'}
              </p>
            </div>
            <div className="flex rounded-full bg-surface-secondary p-1">
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => setTrend('up')}
                aria-label="上升趋势"
                className={`rounded-full bg-danger text-white hover:bg-danger ${trend === 'up' ? '' : 'opacity-55'}`}
              >
                <Icon icon="gravity-ui:arrow-up" />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => setTrend('down')}
                aria-label="下降趋势"
                className={`rounded-full bg-success text-white hover:bg-success ${trend === 'down' ? '' : 'opacity-55'}`}
              >
                <Icon icon="gravity-ui:arrow-down" />
              </Button>
            </div>
          </div>

          <div
            ref={viewportRef}
            className="aspect-square w-full touch-pan-x touch-pan-y overflow-auto overscroll-contain bg-surface-secondary"
          >
            <div className="grid min-h-full min-w-full place-items-center">{chart}</div>
          </div>

          <div className="border-t border-separator p-3">
            <div
              className="grid grid-cols-4 gap-1 rounded-2xl bg-surface-secondary p-1"
              role="group"
              aria-label="九方图行列密度"
            >
              {MOBILE_LOOPS.map((preset) => {
                const dimension = preset * 2 + 1
                const active = loop === preset
                return (
                  <Button
                    key={preset}
                    size="sm"
                    variant="ghost"
                    onPress={() => setMobileLoop(preset)}
                    aria-label={`设置为 ${dimension} 乘 ${dimension} 行列`}
                    aria-pressed={active}
                    className={`relative min-h-10 w-full min-w-0 rounded-xl !px-0 transition-shadow ${
                      active ? 'bg-surface font-semibold shadow-sm ring-1 ring-separator' : 'text-muted'
                    }`}
                  >
                    <span className="absolute inset-0 grid place-items-center text-center tabular-nums">
                      {dimension}×{dimension}
                    </span>
                  </Button>
                )
              })}
            </div>
            <NumberField
              value={size}
              minValue={3}
              maxValue={99}
              step={2}
              onChange={(value) => {
                const dimension = normalizeOddDimension(value ?? size)
                setMobileLoop((dimension - 1) / 2)
              }}
              fullWidth
              variant="secondary"
              className="mt-2"
            >
              <Label>自定义行列</Label>
              <NumberField.Group className="h-11">
                <NumberField.DecrementButton className="!size-11 !min-h-11 !min-w-11 shrink-0 p-0 [&>svg]:translate-x-[0.5px]" />
                <NumberField.Input className="min-w-0 flex-1 text-center tabular-nums" inputMode="numeric" />
                <NumberField.IncrementButton className="!size-11 !min-h-11 !min-w-11 shrink-0 p-0 [&>svg]:translate-x-[-0.5px]" />
              </NumberField.Group>
            </NumberField>
          </div>
        </section>

        <div className="mt-3 grid gap-3">
          <section
            className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-separator bg-surface p-3 shadow-surface"
            aria-label="图表参数"
          >
            <NumberField
              value={searchValue}
              minValue={1}
              maxValue={maxValue}
              step={1}
              onChange={(value) => setSearchValue(value ?? 1)}
              fullWidth
              variant="secondary"
              className="min-w-0 flex-1"
            >
              <Label className="sr-only">定位数值</Label>
              <NumberField.Group className="h-11">
                <NumberField.DecrementButton className="!size-11 !min-h-11 !min-w-11 shrink-0 p-0 [&>svg]:translate-x-[0.5px]" />
                <NumberField.Input
                  className="min-w-0 flex-1 text-center tabular-nums"
                  onKeyDown={(event) => event.key === 'Enter' && locate()}
                />
                <NumberField.IncrementButton className="!size-11 !min-h-11 !min-w-11 shrink-0 p-0 [&>svg]:translate-x-[-0.5px]" />
              </NumberField.Group>
            </NumberField>
            <Button
              size="sm"
              variant="secondary"
              onPress={locate}
              aria-label="定位到九方图"
              className="h-11 min-h-11 rounded-xl px-4 font-semibold"
            >
              定位
            </Button>
          </section>

          <MobilePanel icon="gravity-ui:target" title="验证点位" subtitle="主线与副线延伸结果">
            <div className="grid gap-4 pt-2">
              <PointTags title="主线" points={validationPoints.mainExtension} />
              <PointTags title="副线" points={validationPoints.crossExtension} />
            </div>
          </MobilePanel>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-dvh bg-background px-3 pb-28 pt-3 text-foreground sm:px-5 sm:pt-5 lg:h-dvh lg:overflow-hidden lg:px-6 lg:pb-6">
      <div className="mx-auto grid h-full max-w-[1680px] gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-h-[58dvh] overflow-hidden lg:min-h-0">
          <Card.Header className="flex-row items-start justify-between gap-4 border-b border-separator">
            <div>
              <Card.Title>江恩九方图</Card.Title>
              <Card.Description>
                当前 {size}×{size} · 选中 {effectiveSelectedValue} · {trend === 'up' ? '上升趋势' : '下降趋势'}
              </Card.Description>
            </div>
            <Pill>{isMobile ? '手机布局' : '桌面布局'}</Pill>
          </Card.Header>
          <Card.Content className="min-h-0 flex-1 p-2 sm:p-3">
            <div
              ref={viewportRef}
              className="flex h-[58dvh] min-h-[340px] items-center justify-center overflow-auto rounded-2xl bg-surface-secondary p-2 lg:h-full lg:min-h-0"
            >
              {chart}
            </div>
          </Card.Content>
        </Card>

        <aside className="grid content-start gap-4">
          <Card>
            <Card.Header>
              <Card.Title>图表参数</Card.Title>
              <Card.Description>{isMobile ? '适合触控的紧凑配置' : '桌面高密度配置'}</Card.Description>
            </Card.Header>
            <Card.Content>{controls}</Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title>验证点位</Card.Title>
              <Card.Description>点击图中任意格子可即时更新</Card.Description>
            </Card.Header>
            <Card.Content className="grid gap-4">
              <PointTags title="主线" points={validationPoints.mainExtension} />
              <PointTags title="副线" points={validationPoints.crossExtension} />
            </Card.Content>
          </Card>
        </aside>
      </div>
    </main>
  )
}

function MobilePanel({
  children,
  icon,
  subtitle,
  title,
}: {
  children: ReactNode
  icon: string
  subtitle: string
  title: string
}) {
  return (
    <details className="group overflow-hidden rounded-2xl border border-separator bg-surface shadow-surface">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 py-3 [-webkit-tap-highlight-color:transparent]">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-secondary text-foreground">
          <Icon icon={icon} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block truncate text-xs text-muted">{subtitle}</span>
        </span>
        <Icon icon="gravity-ui:chevron-down" className="transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-separator px-4 pb-4 pt-2">{children}</div>
    </details>
  )
}

function PointTags({ title, points }: { title: string; points: MatrixPoint[] }) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted">{points.length} 个</span>
      </div>
      <div className="flex max-h-24 flex-wrap gap-1.5 overflow-auto">
        {points.length > 0 ? points.slice(0, 24).map((point) => (
          <Pill key={`${point.r}:${point.c}:${point.value}`}>{point.value}</Pill>
        )) : <span className="text-sm text-muted">暂无点位</span>}
      </div>
    </section>
  )
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-6 items-center rounded-full bg-surface-secondary px-2.5 text-xs font-medium text-foreground">
      {children}
    </span>
  )
}

function drawSquareNine(
  canvas: HTMLCanvasElement,
  matrix: number[][],
  options: {
    cellSize: number
    selectedValue: number
    trend: Trend
    mainLine: MatrixPoint[]
    crossLine: MatrixPoint[]
  },
) {
  const { cellSize, selectedValue, trend, mainLine, crossLine } = options
  const size = matrix.length
  const cssSize = size * cellSize
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.floor(cssSize * ratio))
  canvas.height = Math.max(1, Math.floor(cssSize * ratio))
  canvas.style.width = `${cssSize}px`
  canvas.style.height = `${cssSize}px`
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)

  const background = '#ffffff'
  const foreground = '#0f172a'
  const separator = '#d9d9d9'
  const selectedFill = trend === 'down' ? '#ffccc7' : '#52c41a'
  const highlightFill = trend === 'down' ? '#52c41a' : '#ffccc7'
  const highlightText = trend === 'down' ? '#ffffff' : '#a8071a'

  const mainKeys = new Set(mainLine.map((point) => `${point.r}:${point.c}`))
  const crossKeys = new Set(crossLine.map((point) => `${point.r}:${point.c}`))
  context.clearRect(0, 0, cssSize, cssSize)
  context.fillStyle = background
  context.fillRect(0, 0, cssSize, cssSize)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = `${Math.max(9, Math.min(13, cellSize * 0.34))}px ui-monospace, SFMono-Regular, Menlo, monospace`

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const value = matrix[row][col]
      const x = col * cellSize
      const y = row * cellSize
      const key = `${row}:${col}`
      const selected = value === selectedValue
      const isTrendHit = mainKeys.has(key) || crossKeys.has(key)
      const center = Math.floor(size / 2)
      const ringBand = Math.max(Math.abs(row - center), Math.abs(col - center))
      context.fillStyle = ringBand % 2 === 0 ? '#ffffff' : '#eef4ff'
      if (isTrendHit) context.fillStyle = highlightFill
      if (selected) context.fillStyle = selectedFill
      context.fillRect(x, y, cellSize, cellSize)
      context.strokeStyle = separator
      context.lineWidth = selected ? 2 : 0.75
      context.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1)
      context.fillStyle = selected ? '#ffffff' : isTrendHit ? highlightText : foreground
      if (cellSize >= 20) context.fillText(String(value), x + cellSize / 2, y + cellSize / 2)
    }
  }

  if (cellSize < 20) {
    context.fillStyle = '#71717a'
    context.font = '11px ui-sans-serif, system-ui'
    context.fillText(`${size} × ${size}`, cssSize / 2, cssSize - 10)
  }
}

function normalizeLoop(value: number) {
  return clamp(Math.round(Number(value) || 1), 1, 99)
}

function normalizeOddDimension(value: number) {
  const dimension = clamp(Math.round(Number(value) || 3), 3, 99)
  return dimension % 2 === 0 ? Math.min(99, dimension + 1) : dimension
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
