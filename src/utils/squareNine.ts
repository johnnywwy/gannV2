export type Trend = 'up' | 'down'

export type MatrixPoint = {
  r: number
  c: number
  value: number
}

export type SpiralPoint = {
  row: number
  col: number
}

export type AbsPoint = {
  x: number
  y: number
}

export type TrendResult = {
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

export type UpwardExtensionResult = {
  clickedValue: number
  clickedIndex: number
  mainExtension: MatrixPoint[]
  crossExtension: MatrixPoint[]
}

const CLASS_TABLE = [0, 0, 0, 1, 2, 3, 3, 4, 4]

// Generate a Gann Square of Nine matrix. `loop` means cells from center to each edge.
export function generateGannMatrix(base = 1, step = 1, loop = 9) {
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

export function findNumberPosition(matrix: number[][], target: number) {
  const value = Number(target)
  if (!Number.isFinite(value)) return { r: -1, c: -1 }

  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix[r].length; c += 1) {
      if (Number(matrix[r][c]) === value) return { r, c }
    }
  }

  return { r: -1, c: -1 }
}

// Calculate which cells are highlighted after clicking a point under up/down trend.
export function calculateClickTrend(
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

// Get validation points extended from the clicked point in the upward direction.
export function getUpwardExtensionPoints(
  matrix: number[][],
  r: number,
  c: number,
  options: { base?: number; step?: number; loop?: number } = {},
): UpwardExtensionResult {
  return getTrendExtensionPoints(matrix, r, c, 'up', options)
}

// Get validation points extended from the clicked point under the selected trend.
export function getTrendExtensionPoints(
  matrix: number[][],
  r: number,
  c: number,
  trendDirection: Trend,
  options: { base?: number; step?: number; loop?: number } = {},
): UpwardExtensionResult {
  const result = calculateClickTrend(matrix, r, c, trendDirection, options)
  const loop = Math.max(1, Number(options.loop ?? Math.floor(matrix.length / 2)) || 1)
  const clicked = { row: r - loop, col: c - loop }
  const mainExtension =
    trendDirection === 'down'
      ? buildDownValidationPoints(result.mainLine, result.clickedValue)
      : buildMainExtension(matrix, result.mainLine, clicked, loop, trendDirection)
  const crossExtension =
    trendDirection === 'down'
      ? buildDownValidationPoints(result.crossLine, result.clickedValue)
      : buildCrossExtension(matrix, result.crossLine, loop, trendDirection)

  return {
    clickedValue: result.clickedValue,
    clickedIndex: result.clickedIndex,
    mainExtension,
    crossExtension,
  }
}

function buildDownValidationPoints(line: MatrixPoint[], clickedValue: number) {
  return dedupePointsByValue(line)
    .filter((point) => Number(point.value) < Number(clickedValue))
    .sort((a, b) => Number(b.value) - Number(a.value))
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

function buildMainExtension(matrix: number[][], mainLine: MatrixPoint[], clicked: SpiralPoint, loop: number, trend: Trend) {
  if (mainLine.length === 0) return []

  const points: MatrixPoint[] = []
  const clickedPoint = matrixPointAtRel(matrix, clicked, loop)
  if (clickedPoint) points.push(clickedPoint)

  const first = toRelPoint(mainLine[0], loop)
  const last = toRelPoint(mainLine[mainLine.length - 1], loop)

  if (last.row === clicked.row) {
    const edgePoint = trend === 'up' ? last : first
    const fallback = trend === 'up' ? -Math.sign(clicked.col || 1) : Math.sign(clicked.col || 1)
    const firstSide = edgePoint.col === 0 ? fallback : Math.sign(edgePoint.col)
    const edgeRing = Math.max(Math.abs(edgePoint.row), Math.abs(edgePoint.col))
    pushAxisPair(points, matrix, [
      { row: clicked.row, col: firstSide * edgeRing },
      { row: clicked.row, col: -firstSide * edgeRing },
    ], loop)
    for (let ring = edgeRing + 1; ring <= loop; ring += 1) {
      pushAxisPair(points, matrix, [
        { row: clicked.row, col: firstSide * ring },
        { row: clicked.row, col: -firstSide * ring },
      ], loop)
    }
    return dedupePoints(points)
  }

  if (last.col === clicked.col) {
    const edgePoint = trend === 'up' ? last : first
    const fallback = trend === 'up' ? -Math.sign(clicked.row || 1) : Math.sign(clicked.row || 1)
    const firstSide = edgePoint.row === 0 ? fallback : Math.sign(edgePoint.row)
    const edgeRing = Math.max(Math.abs(edgePoint.row), Math.abs(edgePoint.col))
    pushAxisPair(points, matrix, [
      { row: firstSide * edgeRing, col: clicked.col },
      { row: -firstSide * edgeRing, col: clicked.col },
    ], loop)
    for (let ring = edgeRing + 1; ring <= loop; ring += 1) {
      pushAxisPair(points, matrix, [
        { row: firstSide * ring, col: clicked.col },
        { row: -firstSide * ring, col: clicked.col },
      ], loop)
    }
    return dedupePoints(points)
  }

  return dedupePoints([...points, ...extendFromLineEnd(matrix, mainLine, loop, true)])
}

function buildCrossExtension(matrix: number[][], crossLine: MatrixPoint[], loop: number, trend: Trend) {
  return trend === 'up' ? extendFromLineEnd(matrix, crossLine, loop, false) : extendFromLineStart(matrix, crossLine, loop)
}

function extendFromLineEnd(matrix: number[][], line: MatrixPoint[], loop: number, includeUntilEdge: boolean) {
  if (line.length === 0) return []
  if (line.length === 1) return [line[0]]

  const points: MatrixPoint[] = []
  const prev = toRelPoint(line[line.length - 2], loop)
  const last = toRelPoint(line[line.length - 1], loop)
  const step = {
    row: Math.sign(last.row - prev.row),
    col: Math.sign(last.col - prev.col),
  }
  let current = { ...last }

  while (isInsideExtensionBounds(current, loop, includeUntilEdge)) {
    pushRel(points, matrix, current, loop)
    current = { row: current.row + step.row, col: current.col + step.col }
    if (step.row === 0 && step.col === 0) break
  }

  return dedupePoints(points)
}

function extendFromLineStart(matrix: number[][], line: MatrixPoint[], loop: number) {
  if (line.length === 0) return []
  if (line.length === 1) return [line[0]]

  const points: MatrixPoint[] = []
  const first = toRelPoint(line[0], loop)
  const next = toRelPoint(line[1], loop)
  const step = {
    row: Math.sign(first.row - next.row),
    col: Math.sign(first.col - next.col),
  }
  let current = { ...first }

  while (isInsideExtensionBounds(current, loop, false)) {
    pushRel(points, matrix, current, loop)
    current = { row: current.row + step.row, col: current.col + step.col }
    if (step.row === 0 && step.col === 0) break
  }

  return dedupePoints(points)
}

function isInsideExtensionBounds(point: SpiralPoint, loop: number, includeUntilEdge: boolean) {
  const ring = Math.max(Math.abs(point.row), Math.abs(point.col))
  return includeUntilEdge ? ring <= loop : ring < loop
}

function toRelPoint(point: MatrixPoint, loop: number) {
  return { row: point.r - loop, col: point.c - loop }
}

function matrixPointAtRel(matrix: number[][], point: SpiralPoint, loop: number) {
  const r = point.row + loop
  const c = point.col + loop
  const value = matrix[r]?.[c]
  if (value === undefined) return null
  return { r, c, value }
}

function pushRel(points: MatrixPoint[], matrix: number[][], point: SpiralPoint, loop: number) {
  const matrixPoint = matrixPointAtRel(matrix, point, loop)
  if (matrixPoint) points.push(matrixPoint)
}

function pushAxisPair(points: MatrixPoint[], matrix: number[][], pair: SpiralPoint[], loop: number) {
  pair
    .map((point) => matrixPointAtRel(matrix, point, loop))
    .filter((point): point is MatrixPoint => Boolean(point))
    .sort((a, b) => Number(a.value) - Number(b.value))
    .forEach((point) => points.push(point))
}

function dedupePoints(points: MatrixPoint[]) {
  const seen = new Set<string>()
  return points.filter((point) => {
    const key = `${point.r}:${point.c}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function dedupePointsByValue(points: MatrixPoint[]) {
  const seen = new Set<number>()
  return points.filter((point) => {
    const value = Number(point.value)
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
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
