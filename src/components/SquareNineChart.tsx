import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import { Button, Card, Checkbox, Col, ConfigProvider, InputNumber, Row, Segmented, Slider, Space, Tag } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DownOutlined,
  LeftOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  UpOutlined,
} from '@ant-design/icons'
import 'antd/dist/reset.css'
import {
  calculateClickTrend,
  findNumberPosition,
  generateGannMatrix,
  getTrendExtensionPoints,
  type MatrixPoint,
  type Trend,
} from '../utils/squareNine'

type GuideOption = '1x1' | '1x2' | '1x3' | '1x4' | '1x8' | 'cross'

type Cell = MatrixPoint & {
  key: string
}

type CanvasMetrics = {
  size: number
  cellSize: number
  gridSize: number
  offsetX: number
  offsetY: number
}

const BASE_VALUE = 1
const STEP_VALUE = 1
const CELL_SIZE_MIN = 12
const CELL_SIZE_MAX = 100
const CELL_SIZE_STEP = 2
const GUIDE_OPTIONS: Array<{ label: string; value: GuideOption }> = [
  { label: '角线', value: '1x1' },
  { label: '十字线', value: 'cross' },
  { label: '1x2 / 2x1', value: '1x2' },
]
const EXTRA_GUIDE_OPTIONS: Array<{ label: string; value: GuideOption }> = [
  { label: '1x3 / 3x1', value: '1x3' },
  { label: '1x4 / 4x1', value: '1x4' },
  { label: '1x8 / 8x1', value: '1x8' },
]
const ALL_GUIDE_OPTIONS = [...GUIDE_OPTIONS, ...EXTRA_GUIDE_OPTIONS]

function SquareNineChart() {
  const [rowColumn, setRowColumn] = useState(13)
  const [trend, setTrend] = useState<Trend>('down')
  const [cellSize, setCellSize] = useState(28)
  const [autoFit, setAutoFit] = useState(true)
  const [chartViewport, setChartViewport] = useState({ width: 0, height: 0 })
  const [searchValue, setSearchValue] = useState<number | null>(1)
  const [selectedValue, setSelectedValue] = useState(1)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [guideOptions, setGuideOptions] = useState<GuideOption[]>(['1x1', '1x2', 'cross'])
  const [extraGuidesOpen, setExtraGuidesOpen] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const chartWrapRef = useRef<HTMLDivElement | null>(null)
  const hoverKeyRef = useRef<string | null>(null)
  const pendingHoverKeyRef = useRef<string | null>(null)
  const hoverFrameRef = useRef<number | null>(null)
  const panFrameRef = useRef<number | null>(null)
  const loggedPointKeyRef = useRef<string | null>(null)
  const dragStateRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  })
  const [isPanning, setIsPanning] = useState(false)

  const loop = normalizeLoop(rowColumn)
  const matrix = useMemo(() => generateGannMatrix(BASE_VALUE, STEP_VALUE, loop), [loop])
  const size = matrix.length
  const maxValue = size * size
  const effectiveCellSize = useMemo(
    () => (autoFit ? getAutoCellSize(chartViewport.width, chartViewport.height, size) : cellSize),
    [autoFit, cellSize, chartViewport.height, chartViewport.width, size],
  )
  const canvasSize = useMemo(() => {
    const gridSize = size * effectiveCellSize
    return { width: gridSize, height: gridSize }
  }, [effectiveCellSize, size])

  const cells = useMemo(
    () =>
      matrix.flatMap((row, r) =>
        row.map((value, c) => ({
          r,
          c,
          value,
          key: `${r}:${c}`,
        })),
      ),
    [matrix],
  )

  const selectedPosition = useMemo(() => {
    const exact = findNumberPosition(matrix, selectedValue)
    if (exact.r !== -1) return exact
    return { r: loop, c: loop }
  }, [loop, matrix, selectedValue])

  const selectedKey = `${selectedPosition.r}:${selectedPosition.c}`
  const trendResult = useMemo(
    () => calculateClickTrend(matrix, selectedPosition.r, selectedPosition.c, trend, { loop }),
    [loop, matrix, selectedPosition.c, selectedPosition.r, trend],
  )
  const validationPoints = useMemo(
    () => getTrendExtensionPoints(matrix, selectedPosition.r, selectedPosition.c, trend, { loop }),
    [loop, matrix, selectedPosition.c, selectedPosition.r, trend],
  )
  const mainKeys = useMemo(() => new Set(trendResult.mainLine.map((point) => `${point.r}:${point.c}`)), [trendResult])
  const crossKeys = useMemo(() => new Set(trendResult.crossLine.map((point) => `${point.r}:${point.c}`)), [trendResult])

  const locateValue = useCallback(() => {
    const value = Math.round(Number(searchValue))
    if (!Number.isFinite(value)) return
    setSelectedValue(Math.min(maxValue, Math.max(1, value)))
  }, [maxValue, searchValue])

  const pickCell = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return null

      const rect = canvas.getBoundingClientRect()
      const metrics = getCanvasMetrics(rect.width, rect.height, size)
      const x = clientX - rect.left - metrics.offsetX
      const y = clientY - rect.top - metrics.offsetY
      const c = Math.floor(x / metrics.cellSize)
      const r = Math.floor(y / metrics.cellSize)

      if (r < 0 || r >= size || c < 0 || c >= size) return null
      const value = matrix[r]?.[c]
      if (value === undefined) return null
      return { r, c, value, key: `${r}:${c}` }
    },
    [matrix, size],
  )

  const clearHoverFrame = useCallback(() => {
    if (hoverFrameRef.current === null) return
    window.cancelAnimationFrame(hoverFrameRef.current)
    hoverFrameRef.current = null
  }, [])

  const scheduleHoverCell = useCallback(
    (clientX: number, clientY: number) => {
      const key = pickCell(clientX, clientY)?.key ?? null
      pendingHoverKeyRef.current = key

      if (hoverFrameRef.current !== null) return
      hoverFrameRef.current = window.requestAnimationFrame(() => {
        hoverFrameRef.current = null
        const nextKey = pendingHoverKeyRef.current
        if (nextKey === hoverKeyRef.current) return
        hoverKeyRef.current = nextKey
        setHoverKey(nextKey)
      })
    },
    [pickCell],
  )

  const startPan = (clientX: number, clientY: number) => {
    const element = chartWrapRef.current
    if (!element) return
    clearHoverFrame()
    dragStateRef.current = {
      active: true,
      moved: false,
      startX: clientX,
      startY: clientY,
      lastX: clientX,
      lastY: clientY,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
    }
    setIsPanning(true)
  }

  const movePan = (clientX: number, clientY: number) => {
    const element = chartWrapRef.current
    const state = dragStateRef.current
    if (!element || !state.active) return false
    state.lastX = clientX
    state.lastY = clientY
    const dx = clientX - state.startX
    const dy = clientY - state.startY
    if (Math.abs(dx) + Math.abs(dy) > 3) state.moved = true

    if (panFrameRef.current === null) {
      panFrameRef.current = window.requestAnimationFrame(() => {
        panFrameRef.current = null
        const frameState = dragStateRef.current
        const target = chartWrapRef.current
        if (!target || !frameState.active) return
        target.scrollLeft = frameState.scrollLeft - (frameState.lastX - frameState.startX)
        target.scrollTop = frameState.scrollTop - (frameState.lastY - frameState.startY)
      })
    }

    return true
  }

  const stopPan = () => {
    if (!dragStateRef.current.active) return
    dragStateRef.current.active = false
    setIsPanning(false)
  }

  const clearHoverCell = useCallback(() => {
    clearHoverFrame()
    pendingHoverKeyRef.current = null
    if (hoverKeyRef.current !== null) {
      hoverKeyRef.current = null
      setHoverKey(null)
    }
  }, [clearHoverFrame])

  const zoomChart = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return
    event.preventDefault()
    const element = chartWrapRef.current
    if (!element) return

    const rect = element.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top
    const direction = event.deltaY < 0 ? 1 : -1

    setCellSize((current) => {
      const next = clampCellSize(effectiveCellSize + direction * CELL_SIZE_STEP)
      if (next === effectiveCellSize) return current
      const scale = next / effectiveCellSize
      window.requestAnimationFrame(() => {
        element.scrollLeft = (element.scrollLeft + offsetX) * scale - offsetX
        element.scrollTop = (element.scrollTop + offsetY) * scale - offsetY
      })
      setAutoFit(false)
      return next
    })
  }, [effectiveCellSize])

  useEffect(() => {
    if (selectedValue > maxValue) {
      setSelectedValue(maxValue)
      setSearchValue(maxValue)
    }
  }, [maxValue, selectedValue])

  useEffect(() => {
    const element = chartWrapRef.current
    if (!element) return

    const updateViewport = () => {
      setChartViewport({
        width: element.clientWidth,
        height: element.clientHeight,
      })
    }

    updateViewport()
    const observer = new ResizeObserver(updateViewport)
    observer.observe(element)

    return () => observer.disconnect()
  }, [controlsOpen])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    drawChart({
      canvas,
      width: canvasSize.width,
      height: canvasSize.height,
      cells,
      size,
      selectedKey,
      hoverKey,
      mainKeys,
      crossKeys,
      trend,
      guideOptions,
    })
  }, [canvasSize, cells, crossKeys, guideOptions, hoverKey, mainKeys, selectedKey, size, trend])

  useEffect(() => {
    return () => {
      clearHoverFrame()
      if (panFrameRef.current !== null) window.cancelAnimationFrame(panFrameRef.current)
    }
  }, [clearHoverFrame])

  useEffect(() => {
    const logKey = `${selectedValue}:${trend}:${loop}`
    if (loggedPointKeyRef.current === logKey) return
    loggedPointKeyRef.current = logKey

    console.log('九方图点位计算', {
      点击点位: selectedValue,
      趋势: trend,
      主线点位: trendResult.mainLine.map((point) => point.value),
      副线点位: trendResult.crossLine.map((point) => point.value),
      主线延伸点: validationPoints.mainExtension.map((point) => point.value),
      副线延伸点: validationPoints.crossExtension.map((point) => point.value),
    })
  }, [loop, selectedValue, trend, trendResult, validationPoints])

  return (
    <ConfigProvider>
      <main className="h-screen overflow-hidden bg-[#f5f5f5] p-2 sm:p-3 lg:p-4">
        <section
          className={`grid h-full w-full grid-rows-[auto_minmax(0,1fr)] gap-3 transition-[grid-template-columns] duration-300 ease-in-out lg:grid-rows-none ${
            controlsOpen ? 'lg:grid-cols-[minmax(0,1fr)_360px]' : 'lg:grid-cols-[minmax(0,1fr)_150px]'
          }`}
        >
          <aside className="order-1 flex flex-col gap-4 transition-all duration-300 ease-in-out lg:order-2">
            <Card
              size="small"
              styles={{
                body: {
                  maxHeight: controlsOpen ? 'calc(100vh - 96px)' : 0,
                  opacity: controlsOpen ? 1 : 0,
                  overflow: controlsOpen ? 'auto' : 'hidden',
                  padding: controlsOpen ? undefined : 0,
                  pointerEvents: controlsOpen ? undefined : 'none',
                  transform: controlsOpen ? 'scaleY(1)' : 'scaleY(0.98)',
                  transformOrigin: 'top',
                  transition: 'max-height 300ms ease, opacity 180ms ease, padding 300ms ease, transform 300ms ease',
                },
                header: {
                  minHeight: 40,
                  paddingInline: controlsOpen ? undefined : 8,
                  transition: 'padding 300ms ease',
                },
              }}
              title={(
                <Space size={6}>
                  <SettingOutlined />
                  <span className="whitespace-nowrap">基础参数</span>
                </Space>
              )}
              extra={
                <Button
                  size="small"
                  type="text"
                  onClick={() => setControlsOpen((open) => !open)}
                >
                  <span className="hidden lg:inline-flex">
                    {controlsOpen ? <RightOutlined /> : <LeftOutlined />}
                  </span>
                  <span className="inline-flex items-center gap-1 lg:hidden">
                    {controlsOpen ? <UpOutlined /> : <DownOutlined />}
                  </span>
                </Button>
              }
            >
              <Row gutter={[12, 14]} align="top">
                <Col span={24}>
                  <Control title="搜索定位">
                  <Space.Compact className="w-full">
                    <InputNumber
                      className="w-full"
                      min={1}
                      max={maxValue}
                      precision={0}
                      value={searchValue}
                      onChange={setSearchValue}
                      onPressEnter={locateValue}
                    />
                    <Button type="primary" icon={<SearchOutlined />} onClick={locateValue}>
                      定位
                    </Button>
                  </Space.Compact>
                  </Control>
                </Col>

                <Col xs={24} sm={12} lg={24}>
                  <Control title="趋势">
                    <Segmented<Trend>
                      block
                      options={[
                        { label: <Space size={4}><ArrowUpOutlined />上升</Space>, value: 'up' },
                        { label: <Space size={4}><ArrowDownOutlined />下降</Space>, value: 'down' },
                      ]}
                      value={trend}
                      onChange={setTrend}
                    />
                  </Control>
                </Col>

                <Col xs={24} sm={12} lg={24}>
                  <Control title="行列">
                    <InputNumber
                      className="w-full"
                      min={1}
                      max={99}
                      precision={0}
                      step={1}
                      value={rowColumn}
                      onChange={(value) => setRowColumn(normalizeLoop(value ?? 9))}
                    />
                  </Control>
                </Col>

                <Col span={24}>
                  <Control title={`格子大小 ${effectiveCellSize}`}>
                    <Checkbox checked={autoFit} onChange={(event) => setAutoFit(event.target.checked)}>
                      自动适配
                    </Checkbox>
                    <Slider
                      min={CELL_SIZE_MIN}
                      max={CELL_SIZE_MAX}
                      step={CELL_SIZE_STEP}
                      value={effectiveCellSize}
                      disabled={autoFit}
                      onChange={(value) => {
                        setAutoFit(false)
                        setCellSize(clampCellSize(value))
                      }}
                    />
                  </Control>
                </Col>

                <Col span={24}>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-700">辅助线</span>
                      <Button size="small" type="link" onClick={() => setExtraGuidesOpen((open) => !open)}>
                        <Space size={4}>
                          {extraGuidesOpen ? <LeftOutlined rotate={90} /> : <DownOutlined />}
                          {extraGuidesOpen ? '收起' : '更多'}
                        </Space>
                      </Button>
                    </div>
                    <Checkbox.Group value={guideOptions} onChange={(value) => setGuideOptions(value as GuideOption[])}>
                      <Row gutter={[12, 8]} align="middle">
                        {(extraGuidesOpen ? ALL_GUIDE_OPTIONS : GUIDE_OPTIONS).map((option) => (
                          <Col span={12} key={option.value}>
                            <Checkbox value={option.value}>{option.label}</Checkbox>
                          </Col>
                        ))}
                      </Row>
                    </Checkbox.Group>
                  </div>
                </Col>
              </Row>
            </Card>

            <Card
              size="small"
              title="点位"
              styles={{ body: { padding: 12 } }}
            >
              <Space direction="vertical" size={10} className="w-full">
                <PointArray title="主线" points={validationPoints.mainExtension} />
                <PointArray title="副线" points={validationPoints.crossExtension} />
              </Space>
            </Card>
          </aside>

          <section className="order-2 min-h-0 min-w-0 lg:order-1">
            <Card
              className="h-full"
              size="small"
              styles={{ body: { height: '100%', padding: 8 } }}
            >
              <div
                ref={chartWrapRef}
                className={`h-full select-none overflow-auto overscroll-contain rounded-md bg-white ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
                onWheel={zoomChart}
                onPointerDown={(event) => {
                  if (event.button !== 0 || event.ctrlKey) return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  startPan(event.clientX, event.clientY)
                }}
                onPointerMove={(event) => {
                  if (movePan(event.clientX, event.clientY)) return
                  scheduleHoverCell(event.clientX, event.clientY)
                }}
                onPointerUp={(event) => {
                  const shouldPickCell = dragStateRef.current.active && !dragStateRef.current.moved
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                  stopPan()
                  if (!shouldPickCell) return
                  const cell = pickCell(event.clientX, event.clientY)
                  if (!cell) return
                  setSelectedValue(cell.value)
                  setSearchValue(cell.value)
                }}
                onPointerCancel={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                  stopPan()
                  clearHoverCell()
                }}
                onPointerLeave={() => {
                  if (dragStateRef.current.active) return
                  clearHoverCell()
                }}
              >
                <canvas
                  ref={canvasRef}
                  className="block touch-none"
                  style={{ width: canvasSize.width, height: canvasSize.height }}
                />
              </div>
            </Card>
          </section>
        </section>
      </main>
    </ConfigProvider>
  )
}

function Control({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-slate-700">{title}</span>
      {children}
    </div>
  )
}

function PointArray({ title, points }: { title: string; points: MatrixPoint[] }) {
  return (
    <Card
      size="small"
      type="inner"
      title={title}
      styles={{ body: { padding: 8 } }}
    >
      {points.length > 0 ? (
        <Space size={[6, 6]} wrap>
          {points.map((point) => (
            <Tag key={`${point.r}:${point.c}:${point.value}`} color="processing" bordered={false}>
              {point.value}
            </Tag>
          ))}
        </Space>
      ) : (
        <span className="block py-1 text-xs text-slate-400">暂无点位</span>
      )}
    </Card>
  )
}

function drawChart({
  canvas,
  width,
  height,
  cells,
  size,
  selectedKey,
  hoverKey,
  mainKeys,
  crossKeys,
  trend,
  guideOptions,
}: {
  canvas: HTMLCanvasElement
  width: number
  height: number
  cells: Cell[]
  size: number
  selectedKey: string
  hoverKey: string | null
  mainKeys: Set<string>
  crossKeys: Set<string>
  trend: Trend
  guideOptions: GuideOption[]
}) {
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.floor(width * ratio))
  canvas.height = Math.max(1, Math.floor(height * ratio))
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const metrics = getCanvasMetrics(width, height, size)
  const guides = new Set(guideOptions)

  paintSurface(ctx, width, height)
  paintCellBase(ctx, cells, metrics, selectedKey, hoverKey, mainKeys, crossKeys, trend)
  paintCenterGuides(ctx, metrics, guides)
  paintNumbers(ctx, cells, metrics, selectedKey, hoverKey, mainKeys, crossKeys, trend)
}

function paintSurface(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
}

function paintCellBase(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  metrics: CanvasMetrics,
  selectedKey: string,
  hoverKey: string | null,
  mainKeys: Set<string>,
  crossKeys: Set<string>,
  trend: Trend,
) {
  ctx.save()
  const selectedFill = trend === 'down' ? '#ffccc7' : '#52c41a'
  const highlightFill = trend === 'down' ? '#52c41a' : '#ffccc7'
  const hoverFill = '#ffd666'

  for (const cell of cells) {
    const rect = cellRect(cell, metrics)
    const isSelected = cell.key === selectedKey
    const isTrendHit = mainKeys.has(cell.key) || crossKeys.has(cell.key)
    const isHover = cell.key === hoverKey

    ctx.fillStyle = ringBandIndex(cell, metrics) % 2 === 0 ? '#ffffff' : '#eef4ff'
    if (isTrendHit) ctx.fillStyle = highlightFill
    if (isHover) ctx.fillStyle = hoverFill
    if (isSelected) ctx.fillStyle = selectedFill

    ctx.strokeStyle = '#d9d9d9'
    ctx.lineWidth = 1
    ctx.fillRect(rect.x, rect.y, rect.size, rect.size)
    ctx.strokeRect(rect.x, rect.y, rect.size, rect.size)
  }

  ctx.restore()
}

function paintCenterGuides(ctx: CanvasRenderingContext2D, metrics: CanvasMetrics, guides: Set<GuideOption>) {
  const centerX = metrics.offsetX + metrics.gridSize / 2
  const centerY = metrics.offsetY + metrics.gridSize / 2
  const top = metrics.offsetY
  const left = metrics.offsetX
  const right = metrics.offsetX + metrics.gridSize
  const bottom = metrics.offsetY + metrics.gridSize

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(1, metrics.cellSize * 0.035)
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.2)'

  if (guides.has('cross')) {
    drawLine(ctx, centerX, top, centerX, bottom)
    drawLine(ctx, left, centerY, right, centerY)
  }

  ctx.lineWidth = Math.max(1, metrics.cellSize * 0.025)

  for (const guide of ALL_GUIDE_OPTIONS) {
    const ratio = guide.value
    if (ratio === 'cross' || !guides.has(ratio)) continue
    for (const [index, slope] of guideSlopes(ratio).entries()) {
      ctx.setLineDash(ratio === '1x2' ? [metrics.cellSize * 0.28, metrics.cellSize * 0.18] : [])
      const positive = clipLineThroughCenter(slope, centerX, centerY, left, top, right, bottom)
      const negative = clipLineThroughCenter(-slope, centerX, centerY, left, top, right, bottom)
      ctx.strokeStyle = guideLineColor(ratio, index, 1)
      if (positive) drawLine(ctx, positive.x1, positive.y1, positive.x2, positive.y2)
      ctx.strokeStyle = guideLineColor(ratio, index, -1)
      if (negative) drawLine(ctx, negative.x1, negative.y1, negative.x2, negative.y2)
    }
  }

  ctx.setLineDash([])
  ctx.restore()
}

function paintNumbers(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  metrics: CanvasMetrics,
  selectedKey: string,
  hoverKey: string | null,
  mainKeys: Set<string>,
  crossKeys: Set<string>,
  trend: Trend,
) {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${Math.max(10, Math.min(16, metrics.cellSize * 0.3))}px Inter, Arial, sans-serif`
  const selectedText = '#ffffff'
  const highlightText = trend === 'down' ? '#ffffff' : '#a8071a'
  const hoverText = '#0f172a'

  for (const cell of cells) {
    const isSelected = cell.key === selectedKey
    const isTrendHit = mainKeys.has(cell.key) || crossKeys.has(cell.key)
    const isHover = cell.key === hoverKey
    const center = pointCenter(cell.r, cell.c, metrics)

    ctx.fillStyle = '#0f172a'
    if (isTrendHit) ctx.fillStyle = highlightText
    if (isHover) ctx.fillStyle = hoverText
    if (isSelected) ctx.fillStyle = selectedText

    ctx.fillText(compactValue(cell.value, metrics.cellSize), center.x, center.y)
  }

  ctx.restore()
}

function getCanvasMetrics(width: number, height: number, size: number): CanvasMetrics {
  const padding = 0
  const gridSize = Math.max(1, Math.min(width, height) - padding * 2)
  return {
    size,
    cellSize: gridSize / size,
    gridSize,
    offsetX: (width - gridSize) / 2,
    offsetY: (height - gridSize) / 2,
  }
}

function cellRect(cell: MatrixPoint, metrics: CanvasMetrics) {
  return {
    x: metrics.offsetX + cell.c * metrics.cellSize,
    y: metrics.offsetY + cell.r * metrics.cellSize,
    size: metrics.cellSize,
  }
}

function ringBandIndex(cell: MatrixPoint, metrics: CanvasMetrics) {
  const center = Math.floor(metrics.size / 2)
  const ring = Math.max(Math.abs(cell.r - center), Math.abs(cell.c - center))
  return Math.floor(ring / 2)
}

function pointCenter(r: number, c: number, metrics: CanvasMetrics) {
  return {
    x: metrics.offsetX + (c + 0.5) * metrics.cellSize,
    y: metrics.offsetY + (r + 0.5) * metrics.cellSize,
  }
}

function compactValue(value: number, cellSize: number) {
  if (cellSize < 20 && value >= 1000) return `${Math.round(value / 1000)}k`
  return String(value)
}

function normalizeLoop(value: number) {
  return Math.max(1, Math.min(99, Math.trunc(Number(value) || 9)))
}

function clampCellSize(value: number) {
  return Math.max(CELL_SIZE_MIN, Math.min(CELL_SIZE_MAX, Math.round(Number(value) / CELL_SIZE_STEP) * CELL_SIZE_STEP))
}

function getAutoCellSize(width: number, height: number, size: number) {
  if (width <= 0 || height <= 0 || size <= 0) return CELL_SIZE_MIN
  const fitSize = Math.floor(Math.min(width, height) / size)
  return clampCellSize(fitSize)
}

function drawLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function guideSlopes(ratio: GuideOption) {
  const slopes: Partial<Record<GuideOption, number[]>> = {
    '1x1': [1],
    '1x2': [1 / 2, 2],
    '1x3': [1 / 3, 3],
    '1x4': [1 / 4, 4],
    '1x8': [1 / 8, 8],
  }

  return slopes[ratio] ?? []
}

function guideLineColor(ratio: GuideOption, index: number, direction: 1 | -1) {
  if (ratio === '1x1') return direction === 1 ? 'rgba(82, 82, 91, 0.36)' : 'rgba(120, 113, 108, 0.34)'
  if (ratio === '1x2') return index === 0 ? 'rgba(250, 140, 22, 0.42)' : 'rgba(114, 46, 209, 0.4)'

  const colors: Partial<Record<GuideOption, string[]>> = {
    '1x3': [
      'rgba(82, 196, 26, 0.36)',
      'rgba(235, 47, 150, 0.34)',
      'rgba(47, 84, 235, 0.34)',
      'rgba(250, 173, 20, 0.36)',
    ],
    '1x4': [
      'rgba(250, 84, 28, 0.34)',
      'rgba(22, 119, 255, 0.32)',
      'rgba(83, 29, 171, 0.32)',
      'rgba(8, 151, 156, 0.34)',
    ],
    '1x8': [
      'rgba(124, 179, 66, 0.32)',
      'rgba(211, 47, 47, 0.3)',
      'rgba(94, 53, 177, 0.3)',
      'rgba(0, 137, 123, 0.32)',
    ],
  }
  const palette = colors[ratio]
  if (!palette) return 'rgba(22, 119, 255, 0.32)'
  return palette[index * 2 + (direction === 1 ? 0 : 1)]
}

function clipLineThroughCenter(
  slope: number,
  centerX: number,
  centerY: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  const points: Array<{ x: number; y: number; key: string }> = []
  const pushPoint = (x: number, y: number) => {
    const eps = 1e-7
    if (x < left - eps || x > right + eps || y < top - eps || y > bottom + eps) return
    const px = Math.min(right, Math.max(left, x))
    const py = Math.min(bottom, Math.max(top, y))
    const key = `${px.toFixed(4)},${py.toFixed(4)}`
    if (!points.some((point) => point.key === key)) points.push({ x: px, y: py, key })
  }

  pushPoint(left, centerY + slope * (left - centerX))
  pushPoint(right, centerY + slope * (right - centerX))
  if (slope !== 0) {
    pushPoint(centerX + (top - centerY) / slope, top)
    pushPoint(centerX + (bottom - centerY) / slope, bottom)
  }

  if (points.length < 2) return null

  let best: { a: { x: number; y: number }; b: { x: number; y: number }; dist: number } | null = null
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dist = (points[i].x - points[j].x) ** 2 + (points[i].y - points[j].y) ** 2
      if (!best || dist > best.dist) best = { a: points[i], b: points[j], dist }
    }
  }

  return best ? { x1: best.a.x, y1: best.a.y, x2: best.b.x, y2: best.b.y } : null
}

export default SquareNineChart
