import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Card, Checkbox, Col, ConfigProvider, InputNumber, Row, Segmented, Slider, Space } from 'antd'
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

type Trend = 'up' | 'down'
type GuideOption = '1x1' | '1x2' | '1x3' | '1x4' | '1x8' | 'cross'

type MatrixPoint = {
  r: number
  c: number
  value: number
}

type SpiralPoint = {
  row: number
  col: number
}

type AbsPoint = {
  x: number
  y: number
}

type TrendResult = {
  clickedValue: number
  clickedIndex: number
  trend: Trend
  point?: SpiralPoint
  absPoint?: AbsPoint
  type?: number
  sector?: number
  distance?: number
  mainLine: MatrixPoint[]
  crossLine: MatrixPoint[]
  trendCells: MatrixPoint[]
}

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

const CLASS_TABLE = [0, 0, 0, 1, 2, 3, 3, 4, 4]
const BASE_VALUE = 1
const STEP_VALUE = 1
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
  const [rowColumn, setRowColumn] = useState(15)
  const [trend, setTrend] = useState<Trend>('down')
  const [cellSize, setCellSize] = useState(28)
  const [searchValue, setSearchValue] = useState<number | null>(1)
  const [selectedValue, setSelectedValue] = useState(1)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [guideOptions, setGuideOptions] = useState<GuideOption[]>(['1x1', '1x2', 'cross'])
  const [extraGuidesOpen, setExtraGuidesOpen] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const loop = Math.floor(normalizeRowColumn(rowColumn) / 2)
  const matrix = useMemo(() => generateGannMatrix(BASE_VALUE, STEP_VALUE, loop), [loop])
  const size = matrix.length
  const maxValue = size * size
  const canvasSize = useMemo(() => {
    const gridSize = size * cellSize
    return { width: gridSize, height: gridSize }
  }, [cellSize, size])

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
      return cells.find((cell) => cell.r === r && cell.c === c) ?? null
    },
    [cells, size],
  )

  useEffect(() => {
    if (selectedValue > maxValue) {
      setSelectedValue(maxValue)
      setSearchValue(maxValue)
    }
  }, [maxValue, selectedValue])

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

  return (
    <ConfigProvider>
      <main className="min-h-screen bg-[#f5f5f5] p-2 sm:p-3 lg:p-4">
        <section
          className={`grid w-full gap-3 transition-[grid-template-columns] duration-200 ${
            controlsOpen ? 'lg:grid-cols-[360px_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(48px,48px)_minmax(0,1fr)]'
          }`}
        >
          <aside className="order-1 flex flex-col gap-4">
            <Card
              size="small"
              styles={{
                body: {
                  display: controlsOpen ? undefined : 'none',
                  padding: controlsOpen ? undefined : 0,
                },
                header: {
                  minHeight: 40,
                  paddingInline: controlsOpen ? undefined : 8,
                },
              }}
              title={(
                <Space>
                  <SettingOutlined />
                  <span>基础设置</span>
                </Space>
              )}
              extra={
                <Button
                  size="small"
                  type="text"
                  onClick={() => setControlsOpen((open) => !open)}
                >
                  <span className="hidden lg:inline-flex">
                    {controlsOpen ? <LeftOutlined /> : <RightOutlined />}
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
                      min={7}
                      max={99}
                      precision={0}
                      step={2}
                      value={rowColumn}
                      onChange={(value) => setRowColumn(normalizeRowColumn(value ?? 19))}
                    />
                  </Control>
                </Col>

                <Col xs={24} sm={12} lg={24}>
                  <Control title={`格子大小 ${cellSize}`}>
                    <Slider min={12} max={100} step={2} value={cellSize} onChange={setCellSize} />
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
          </aside>

          <section className="order-2 min-w-0">
            <Card size="small" styles={{ body: { padding: 8 } }}>
              <div className="overflow-auto rounded-md bg-white">
                <canvas
                  ref={canvasRef}
                  className="block touch-none"
                  style={{ width: canvasSize.width, height: canvasSize.height }}
                  onClick={(event) => {
                    const cell = pickCell(event.clientX, event.clientY)
                    if (!cell) return
                    setSelectedValue(cell.value)
                    setSearchValue(cell.value)
                  }}
                  onMouseMove={(event) => setHoverKey(pickCell(event.clientX, event.clientY)?.key ?? null)}
                  onMouseLeave={() => setHoverKey(null)}
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
  const hoverFill = '#e6f4ff'

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

function generateGannMatrix(base = 1, step = 1, loop = 9) {
  const radius = Math.max(1, Number(loop) || 1)
  const size = radius * 2 + 1
  const max = size * size
  const { numToPos } = buildGannSpiral(max)
  const matrix = Array.from({ length: size }, () => Array<number>(size).fill(0))

  for (let n = 1; n <= max; n += 1) {
    const pos = numToPos.get(n)
    if (pos) matrix[pos.row + radius][pos.col + radius] = base + (n - 1) * step
  }

  return matrix
}

function normalizeRowColumn(value: number) {
  const normalized = Math.max(7, Math.min(99, Math.trunc(Number(value) || 19)))
  return normalized % 2 === 0 ? normalized + 1 : normalized
}

function findNumberPosition(matrix: number[][], target: number) {
  const value = Number(target)
  if (!Number.isFinite(value)) return { r: -1, c: -1 }

  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix[r].length; c += 1) {
      if (Number(matrix[r][c]) === value) return { r, c }
    }
  }

  return { r: -1, c: -1 }
}

function calculateClickTrend(
  matrix: number[][],
  r: number,
  c: number,
  trendDirection: Trend,
  options: { base?: number; step?: number; loop?: number } = {},
): TrendResult {
  const clickedValue = matrix[r]?.[c] ?? 1
  const base = Number(options.base ?? 1)
  const step = Number(options.step ?? 1)
  const loop = Math.max(1, Number(options.loop ?? Math.floor(matrix.length / 2)) || 1)
  const rawIndex = step === 0 ? clickedValue : (clickedValue - base) / step + 1
  const clickedIndex = Math.round(rawIndex)

  const highlight = calcHighlights(clickedIndex, trendDirection, loop)
  const toValue = (n: number) => base + (n - 1) * step
  const mainValues = highlight.mainHighlight.map(toValue)
  const crossValues = highlight.subHighlight.map(toValue)
  const mainLine = valuesToPoints(matrix, mainValues)
  const crossLine = valuesToPoints(matrix, crossValues)

  return {
    clickedValue,
    clickedIndex,
    trend: trendDirection,
    point: highlight.point,
    absPoint: highlight.absPoint,
    type: highlight.type,
    sector: highlight.sector,
    distance: highlight.distance,
    mainLine,
    crossLine,
    trendCells: [...mainLine, ...crossLine],
  }
}

function valuesToPoints(matrix: number[][], values: number[]) {
  const index = new Map<number, MatrixPoint>()
  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix[r].length; c += 1) {
      index.set(Number(matrix[r][c]), { r, c, value: matrix[r][c] })
    }
  }
  return dedupe(values)
    .map((value) => index.get(Number(value)))
    .filter((point): point is MatrixPoint => Boolean(point))
}

function buildGannSpiral(max: number) {
  const numToPos = new Map<number, SpiralPoint>()
  const posToNum = new Map<string, number>()
  let row = 0
  let col = 0
  let n = 1
  setPoint(n, row, col)

  const dirs = [
    [0, -1],
    [-1, 0],
    [0, 1],
    [1, 0],
  ]
  let stepLen = 1
  let dirIndex = 0

  while (n < max) {
    for (let repeat = 0; repeat < 2 && n < max; repeat += 1) {
      const [dr, dc] = dirs[dirIndex % 4]
      for (let i = 0; i < stepLen && n < max; i += 1) {
        row += dr
        col += dc
        n += 1
        setPoint(n, row, col)
      }
      dirIndex += 1
    }
    stepLen += 1
  }

  function setPoint(value: number, pointRow: number, pointCol: number) {
    numToPos.set(value, { row: pointRow, col: pointCol })
    posToNum.set(`${pointRow},${pointCol}`, value)
  }

  return { numToPos, posToNum }
}

function calcHighlights(clickedValue: number, trend: Trend, gridRadius: number) {
  const maxNumber = (gridRadius * 2 + 1) ** 2
  const { numToPos, posToNum } = buildGannSpiral(maxNumber)
  const point = numToPos.get(clickedValue)
  const gridSize = gridRadius * 2 + 1
  const center = Math.floor(gridSize / 2)

  if (!point) {
    return {
      clickedValue,
      trend,
      gridRadius,
      maxNumber,
      mainHighlight: [] as number[],
      subHighlight: [] as number[],
      numToPos,
      posToNum,
    }
  }

  const absPoint = relToAbs(point, center)
  const sector = getSector(absPoint, gridSize)
  const type = getPointType(point)
  const distance = getAxisDistance(absPoint, center, sector)
  const trendMode = trend === 'up' ? 1 : 0
  const ctx = {
    clickedValue,
    trend,
    trendMode,
    gridRadius,
    maxNumber,
    gridSize,
    center,
    posToNum,
    line1: [] as number[],
    line2: [] as number[],
    distance,
  }

  if (type === 2) renderType2(ctx, absPoint, sector, trendMode)
  else renderDiagonal(ctx, absPoint, sector, trendMode)

  return {
    clickedValue,
    trend,
    point,
    absPoint,
    type,
    sector,
    distance,
    trendMode,
    gridRadius,
    maxNumber,
    gridSize,
    center,
    mainHighlight: dedupe(ctx.line1),
    subHighlight: normalizeSegment(dedupe(ctx.line2), point, trend),
    numToPos,
    posToNum,
  }
}

function getValue(posToNum: Map<string, number>, row: number, col: number) {
  return posToNum.get(`${row},${col}`)
}

function trunc(n: number) {
  return n < 0 ? Math.ceil(n) : Math.floor(n)
}

function dedupe<T>(values: T[]) {
  const seen = new Set<T>()
  return values.filter((value) => {
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

function ptInRect(rect: { left: number; top: number; right: number; bottom: number }, p: AbsPoint) {
  return p.x >= rect.left && p.x < rect.right && p.y >= rect.top && p.y < rect.bottom
}

function calcY(line: { k: number; b: number }, x: number) {
  return trunc(x * line.k + line.b)
}

function classifyPointByLine(line: { k: number; b: number }, p: AbsPoint) {
  const diff = trunc(p.x * line.k + line.b - p.y)
  if (diff === 0) return 0
  return diff >= 0 ? 2 : 1
}

function relToAbs(point: SpiralPoint, center: number) {
  return { x: point.col + center, y: point.row + center }
}

function absToRel(x: number, y: number, center: number) {
  return { row: y - center, col: x - center }
}

function absValue(ctx: { center: number; posToNum: Map<string, number> }, x: number, y: number) {
  const rel = absToRel(x, y, ctx.center)
  return getValue(ctx.posToNum, rel.row, rel.col)
}

function getPointType(point: SpiralPoint) {
  const x = point.col
  const y = point.row
  if (x === 0 || y === 0) return 2

  const dx = Math.abs(x)
  const dy = Math.abs(y)
  if (x < 0 && y > 0 && ((dx === 3 && dy === 5) || (dx === 4 && dy === 7))) return 1

  const limit = dx > 8 ? dx - 4 : CLASS_TABLE[dx]
  if (dy <= limit) return 2
  if (dy < 9) return dx <= CLASS_TABLE[dy] ? 2 : 1
  return dx <= dy - 4 ? 2 : 1
}

function getSector(absPoint: AbsPoint, gridSize: number) {
  const x = absPoint.x
  const y = absPoint.y
  const rect = { left: x * 2, top: y * 2, right: x * 2 + 2, bottom: y * 2 + 2 }
  const testPoint = { x: x * 2 + 1, y: y * 2 + 1 }
  const lineC0 = { k: -1, b: gridSize * 2 }
  const lineD0 = { k: 1, b: 0 }

  if (ptInRect(rect, { x: testPoint.x, y: calcY(lineC0, testPoint.x) })) return 7
  if (ptInRect(rect, { x: testPoint.x, y: calcY(lineD0, testPoint.x) })) return 6

  const signC0 = classifyPointByLine(lineC0, testPoint)
  const signD0 = classifyPointByLine(lineD0, testPoint)
  if (signC0 === 2) return signD0 !== 1 ? 2 : 1
  return signD0 !== 2 ? 4 : 3
}

function getAxisDistance(absPoint: AbsPoint, center: number, sector: number) {
  const dx = Math.abs(absPoint.x - center)
  const dy = Math.abs(absPoint.y - center)
  if ([1, 3, 6, 7].includes(sector)) return dx
  if ([2, 4].includes(sector)) return dy
  return 0
}

function getMajorMinor(absPoint: AbsPoint, center: number) {
  const dx = Math.abs(absPoint.x - center)
  const dy = Math.abs(absPoint.y - center)
  return { major: Math.max(dx, dy), minor: Math.min(dx, dy) }
}

function record(
  ctx: { clickedValue: number; center: number; posToNum: Map<string, number>; line1: number[]; line2: number[] },
  x: number,
  y: number,
  segment: 'current' | 'line1' | 'line2',
) {
  const value = absValue(ctx, x, y)
  if (!value) return false

  if (value === ctx.clickedValue) return true
  if (segment === 'line1') ctx.line1.push(value)
  if (segment === 'line2') ctx.line2.push(value)
  return true
}

function normalizeSegment(values: number[], point: SpiralPoint, trend: Trend) {
  if (trend === 'down' && point.row < 0) return values.slice().reverse()
  return values.slice()
}

function renderType2(
  ctx: { clickedValue: number; center: number; gridSize: number; distance: number; posToNum: Map<string, number>; line1: number[]; line2: number[] },
  absPoint: AbsPoint,
  sector: number,
  trendMode: number,
) {
  const up = trendMode === 1
  let x = absPoint.x
  let y = absPoint.y
  const d = ctx.distance
  const c = ctx.center
  const N = ctx.gridSize

  switch (sector) {
    case 1: {
      const origY = y
      const targetX = x + d
      record(ctx, x, y, 'current')
      if (up) {
        for (let i = 0; i < d * 2; i += 1) record(ctx, ++x, y, 'line1')
        y = origY - 1
        x = targetX
        for (let i = 0, count = origY - c + d; i < count && y >= 0; i += 1, y -= 1) record(ctx, x, y, 'line2')
      } else {
        for (let i = 0; i < Math.max(0, d * 2 - 1); i += 1) record(ctx, ++x, y, 'line1')
        y = origY + 1
        x = targetX
        for (let i = 0, count = c - origY - 1 + d; i < count && y <= N; i += 1, y += 1) record(ctx, x, y, 'line2')
      }
      break
    }
    case 2: {
      const origX = x
      const targetY = y + d
      record(ctx, x, y, 'current')
      if (up) {
        for (let i = 0; i < d * 2; i += 1) record(ctx, x, ++y, 'line1')
        x = origX
        y = targetY
        for (let i = 0, count = d - origX + 1 + c; i < count && x < N; i += 1, x += 1) record(ctx, x, y, 'line2')
      } else {
        for (let i = 0; i < Math.max(0, d * 2 - 1); i += 1) record(ctx, x, ++y, 'line1')
        x = origX
        y = targetY
        for (let i = 0, count = origX - c + 1 + d; i < count; i += 1, x -= 1) record(ctx, x, y, 'line2')
      }
      break
    }
    case 3: {
      const targetX = x - d
      const origY = y
      record(ctx, x, y, 'current')
      if (up) {
        for (let i = 0; i < d * 2 + 1; i += 1) {
          x -= 1
          if (x < 0) break
          record(ctx, x, y, 'line1')
        }
        x = targetX
        y = origY
        for (let i = 0, count = c - origY + 1 + d; i < count; i += 1, y += 1) record(ctx, x, y, 'line2')
      } else {
        for (let i = 0; i < d * 2; i += 1) record(ctx, --x, y, 'line1')
        x = targetX
        y = origY
        for (let i = 0, count = origY - c + 1 + d; i < count; i += 1, y -= 1) record(ctx, x, y, 'line2')
      }
      break
    }
    case 4: {
      const targetY = y - d
      const origX = x
      record(ctx, x, y, 'current')
      if (up) {
        for (let i = 0; i < d * 2 + 1; i += 1) {
          y -= 1
          if (y < 0) break
          record(ctx, x, y, 'line1')
        }
        y = targetY
        x = origX - 1
        for (let i = 0, count = origX - c + 1 + d; i < count && x >= 0; i += 1, x -= 1) record(ctx, x, y, 'line2')
      } else {
        for (let i = 0; i < d * 2; i += 1) record(ctx, x, --y, 'line1')
        x = origX + 1
        y = targetY
        for (let i = 0, count = c + d - origX; i < count && x <= N; i += 1, x += 1) record(ctx, x, y, 'line2')
      }
      break
    }
    default:
      record(ctx, x, y, 'current')
  }
}

function renderDiagLabel14614(ctx: HighlightContext, absPoint: AbsPoint, sector: number, trendMode: number, major: number, minor: number) {
  const up = trendMode === 1
  let { x, y } = absPoint
  let d = ctx.distance
  const c = ctx.center
  const N = ctx.gridSize
  record(ctx, x, y, 'current')

  if (up) {
    for (let i = 0, count = major + minor + (sector !== 1 ? 1 : 0); i < count; i += 1) {
      x += 1
      y -= 1
      if (N <= x || y < 0) break
      record(ctx, x, y, 'line1')
    }
    x = c
    y = c
    if (sector === 4) {
      const diff = major - minor
      x = c + diff
      y = c + diff
      d += diff + 1
    } else if (sector !== 1) d += 1
    for (let i = 0; i < d; i += 1) record(ctx, --x, --y, 'line2')
  } else {
    for (let i = 0, count = major - 1 + minor + (sector !== 1 ? 1 : 0); i < count; i += 1) {
      x += 1
      y -= 1
      record(ctx, x, y, 'line1')
    }
    x = c
    y = c
    if (sector === 1) {
      const diff = major - minor
      x = c - diff
      y = c - diff
      d += diff - 1
    }
    for (let i = 0; i < d; i += 1) record(ctx, ++x, ++y, 'line2')
  }
}

function renderDiagLabel14ba7(ctx: HighlightContext, absPoint: AbsPoint, sector: number, trendMode: number, major: number, minor: number) {
  const up = trendMode === 1
  let { x, y } = absPoint
  let d = ctx.distance
  const c = ctx.center
  record(ctx, x, y, 'current')
  for (let i = 0, count = up ? major + 1 + minor : major + minor; i < count; i += 1) record(ctx, --x, --y, 'line1')

  x = c
  y = c
  if (up && sector === 3) {
    const diff = major - minor
    x = c + diff
    y = c - diff
    d += diff
  }
  if (!up && sector === 4) {
    const diff = major - minor
    x = c - diff
    y = c + diff
    d += diff
  }
  for (let i = 0; i < d; i += 1) {
    if (up) record(ctx, --x, ++y, 'line2')
    else record(ctx, ++x, --y, 'line2')
  }
}

function renderDiagLabel149e7(ctx: HighlightContext, absPoint: AbsPoint, sector: number, trendMode: number, major: number, minor: number) {
  const up = trendMode === 1
  let { x, y } = absPoint
  let d = ctx.distance
  const c = ctx.center
  record(ctx, x, y, 'current')

  for (let i = 0, count = (up ? major + minor : major - 1 + minor) + (sector === 2 ? 1 : 0); i < count; i += 1) {
    record(ctx, --x, ++y, 'line1')
  }
  x = c
  y = c
  if (up && sector === 2) {
    const diff = major - minor
    x = c - diff
    y = c - diff
    d += diff
  }
  if (!up && sector === 3) {
    const diff = major - minor
    x = c + diff
    y = c + diff
    d += diff
  }
  for (let i = 0; i < d; i += 1) {
    if (up) record(ctx, ++x, ++y, 'line2')
    else record(ctx, --x, --y, 'line2')
  }
}

function renderDiagLabel14821(ctx: HighlightContext, absPoint: AbsPoint, sector: number, trendMode: number, major: number, minor: number) {
  const up = trendMode === 1
  let { x, y } = absPoint
  let d = ctx.distance
  const c = ctx.center
  record(ctx, x, y, 'current')

  for (let i = 0, count = up ? major + minor : major - 1 + minor; i < count; i += 1) record(ctx, ++x, ++y, 'line1')
  x = c
  y = c
  if (up && sector === 1) {
    const diff = major - minor
    x = c - diff
    y = c + diff
    d += diff
    for (let i = 0; i < d; i += 1) record(ctx, ++x, --y, 'line2')
    return
  }
  if (!up && sector === 2) {
    const diff = major - minor
    x = c + diff
    y = c - diff
    d += diff
  }
  if (!up) {
    while ((d -= 1) !== 0) record(ctx, --x, ++y, 'line2')
    return
  }
  for (let i = 0; i < d; i += 1) record(ctx, ++x, --y, 'line2')
}

type HighlightContext = {
  clickedValue: number
  center: number
  gridSize: number
  distance: number
  posToNum: Map<string, number>
  line1: number[]
  line2: number[]
}

function renderDiagonal(ctx: HighlightContext, absPoint: AbsPoint, sector: number, trendMode: number) {
  const { major, minor } = getMajorMinor(absPoint, ctx.center)
  const { x, y } = absPoint
  const c = ctx.center

  if (sector === 1) {
    if (c < y) return renderDiagLabel14614(ctx, absPoint, sector, trendMode, major, minor)
    if (y < c) return renderDiagLabel14821(ctx, absPoint, sector, trendMode, major, minor)
  }
  if (sector === 4) {
    if (x < c) return renderDiagLabel14614(ctx, absPoint, sector, trendMode, major, minor)
    if (c < x) return renderDiagLabel14ba7(ctx, absPoint, sector, trendMode, major, minor)
  }
  if (sector === 7) {
    if (x < c) return renderDiagLabel14614(ctx, absPoint, sector, trendMode, major, minor)
    if (c < x) return renderDiagLabel149e7(ctx, absPoint, sector, trendMode, major, minor)
  }
  if (sector === 2) {
    if (c <= x) return renderDiagLabel149e7(ctx, absPoint, sector, trendMode, major, minor)
    return renderDiagLabel14821(ctx, absPoint, sector, trendMode, major, minor)
  }
  if (sector === 6) {
    if (x < c) return renderDiagLabel14821(ctx, absPoint, sector, trendMode, major, minor)
    if (c < x) return renderDiagLabel14ba7(ctx, absPoint, sector, trendMode, major, minor)
  }
  if (sector === 3) {
    if (c <= y) return renderDiagLabel14ba7(ctx, absPoint, sector, trendMode, major, minor)
    return renderDiagLabel149e7(ctx, absPoint, sector, trendMode, major, minor)
  }
  return undefined
}

export default SquareNineChart
