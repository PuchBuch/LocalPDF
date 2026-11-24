import { readMask } from './maskReader'

/** Sizes are in points, the picture is scanned in pixels. */
const MIN_LINE_LENGTH = 120
const MAX_LINE_THICKNESS = 4
/** Pieces of a line this close together are one line. */
const LINE_BREAK = 2
/** A line with breaks still has this share of ink. A row of letters does not. */
const MIN_LINE_INK = 0.85
/** The two rules of a double line are this close. */
const DOUBLE_LINE = 4
/** How far the edges of the lines of one table may differ, as scans are. */
const EDGE_TOLERANCE = 8
const MIN_ROWS = 2
const MIN_ROW_HEIGHT = 6
const MIN_COLUMN_WIDTH = 6
/** The same wall is found this far apart in neighbouring rows. */
const WALL_TOLERANCE = 3
const WALL_COVERAGE = 0.8
/** Left out along the walls when looking for ink in a cell. */
const CELL_INSET = 3
const MAX_INK_INSIDE = 0.01
/** Where the height of a line's ends is read, away from the walls that meet it there. */
const END_SKIP = 5
const END_LENGTH = 20

/** The lines of a table in points: one more of each than there are columns and rows. */
export interface TableGrid {
  columns: number[]
  rows: number[]
  /** For each row, whether nothing is written in any of its cells. */
  emptyRows: boolean[]
}

/** A horizontal line in pixels, which may slant a little. */
interface HorizontalLine {
  left: number
  right: number
  /** Its middle at its left and right ends. */
  leftY: number
  rightY: number
}

interface RowWalls {
  left: number
  right: number
  /** All the walls of the row, the outer ones too. */
  walls: number[]
}

const average = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length
const middleOf = (line: HorizontalLine) => (line.leftY + line.rightY) / 2
const heightAt = (line: HorizontalLine, x: number) =>
  line.leftY + ((line.rightY - line.leftY) * (x - line.left)) / Math.max(1, line.right - line.left)

function horizontalLines(mask: Uint8Array, width: number, height: number, scale: number): HorizontalLine[] {
  interface Shape {
    left: number
    right: number
    top: number
    bottom: number
    area: number
  }
  interface Run {
    left: number
    right: number
    shape: Shape
  }
  // A slanted line is a staircase of short runs. Taking in the rows beside it makes them long.
  const dark = (x: number, y: number) => {
    const offset = y * width + x
    return mask[offset] === 1 || (y > 0 && mask[offset - width] === 1) || (y < height - 1 && mask[offset + width] === 1)
  }
  const added = 2
  const maxGap = Math.round(LINE_BREAK * scale)
  const minLength = MIN_LINE_LENGTH * scale
  const shapes = new Set<Shape>()
  let above: Run[] = []

  for (let y = 0; y < height; y++) {
    const runs: Run[] = []
    let x = 0
    while (x < width) {
      if (!dark(x, y)) {
        x++
        continue
      }
      const left = x
      let right = x
      let ink = 0
      for (; x < width && x - right <= maxGap + 1; x++) {
        if (!dark(x, y)) continue
        ink++
        right = x
      }
      const length = right - left + 1
      if (length < minLength || ink < length * MIN_LINE_INK) continue

      const run: Run = { left, right, shape: { left, right, top: y, bottom: y, area: ink } }
      shapes.add(run.shape)
      runs.push(run)
      for (const other of above) {
        const joined = other.shape
        if (other.left > right + maxGap || other.right < left - maxGap || joined === run.shape) continue
        shapes.delete(joined)
        run.shape.left = Math.min(run.shape.left, joined.left)
        run.shape.right = Math.max(run.shape.right, joined.right)
        run.shape.top = Math.min(run.shape.top, joined.top)
        run.shape.area += joined.area
        for (const same of [...above, ...runs]) if (same.shape === joined) same.shape = run.shape
      }
    }
    above = runs
  }

  const lines: HorizontalLine[] = []
  for (const { left, right, top, bottom, area } of shapes) {
    const length = right - left + 1
    if (area / length - added > MAX_LINE_THICKNESS * scale) continue
    const middle = (top + bottom + 1) / 2
    const endHeight = (from: number) => {
      let sum = 0
      let count = 0
      for (let y = top; y <= bottom; y++) {
        for (let x = Math.round(from); x < from + END_LENGTH * scale; x++) {
          if (mask[y * width + x] !== 1) continue
          sum += y + 0.5
          count++
        }
      }
      return count === 0 ? middle : sum / count
    }
    lines.push({
      left,
      right,
      leftY: endHeight(left + END_SKIP * scale),
      rightY: endHeight(right - (END_SKIP + END_LENGTH) * scale)
    })
  }
  return lines.sort((a, b) => middleOf(a) - middleOf(b))
}

function sameEdges(a: HorizontalLine, b: HorizontalLine, scale: number): boolean {
  return Math.abs(a.left - b.left) <= EDGE_TOLERANCE * scale && Math.abs(a.right - b.right) <= EDGE_TOLERANCE * scale
}

/** The lines from the top down, with the two rules of each double line made one. */
function joinDoubleLines(lines: HorizontalLine[], scale: number): HorizontalLine[] {
  const joined: HorizontalLine[] = []
  for (const line of lines) {
    const index = joined.findIndex((other) => sameEdges(other, line, scale) && middleOf(line) - middleOf(other) <= DOUBLE_LINE * scale)
    const other = joined[index]
    if (!other) {
      joined.push(line)
      continue
    }
    joined[index] = {
      left: Math.min(line.left, other.left),
      right: Math.max(line.right, other.right),
      leftY: (line.leftY + other.leftY) / 2,
      rightY: (line.rightY + other.rightY) / 2
    }
  }
  return joined
}

/** Values close to the one before them, in groups. */
function grouped<T>(items: T[], valueOf: (item: T) => number, gap: number): T[][] {
  const groups: T[][] = []
  for (const item of [...items].sort((a, b) => valueOf(a) - valueOf(b))) {
    const last = groups.at(-1)
    if (last && valueOf(item) - valueOf(last.at(-1)!) <= gap) last.push(item)
    else groups.push([item])
  }
  return groups
}

/**
 * Finds the ruled tables of a page, from a picture of it. The mask has one entry per
 * pixel, true where it is dark, and scale is its pixels per point.
 */
export function findTables(mask: Uint8Array, width: number, height: number, scale: number): TableGrid[] {
  const { inkShare, verticalWall } = readMask(mask, width, height, scale)
  const lines = joinDoubleLines(horizontalLines(mask, width, height, scale), scale)
  // A wall is found this much to either side of it too.
  const wiggle = Math.max(1, Math.round(scale))
  const maxWall = MAX_LINE_THICKNESS * scale + wiggle * 2

  /** The walls between two lines, or null unless both ends of the lines are joined by one. */
  const rowWalls = (top: HorizontalLine, bottom: HorizontalLine): RowWalls | null => {
    const reach = Math.round(EDGE_TOLERANCE * scale)
    const from = Math.min(top.left, bottom.left) - wiggle
    const to = Math.max(top.right, bottom.right) + wiggle
    const hits: number[] = []
    for (let x = from; x <= to; x++) {
      if (verticalWall(x, Math.round(heightAt(top, x)), Math.round(heightAt(bottom, x)), WALL_COVERAGE)) hits.push(x)
    }
    const walls = grouped(hits, (x) => x, 1)
      .filter((group) => group.length <= maxWall)
      .map((group) => (group[0]! + group.at(-1)!) / 2 + 0.5)
    const left = walls[0]
    const right = walls.at(-1)
    if (left === undefined || right === undefined || left === right) return null
    if (left > Math.max(top.left, bottom.left) + reach || right < Math.min(top.right, bottom.right) - reach) return null
    return { left, right, walls }
  }

  const tables: TableGrid[] = []
  const used = new Set<HorizontalLine>()
  for (const first of lines) {
    if (used.has(first)) continue
    const tableLines = [first]
    const rows: RowWalls[] = []
    for (;;) {
      const top = tableLines.at(-1)!
      const bottom = lines.find(
        (line) => !used.has(line) && middleOf(line) - middleOf(top) >= MIN_ROW_HEIGHT * scale && sameEdges(line, top, scale)
      )
      const walls = bottom && rowWalls(top, bottom)
      if (!bottom || !walls) break
      tableLines.push(bottom)
      rows.push(walls)
    }
    if (rows.length < MIN_ROWS) continue
    for (const line of tableLines) used.add(line)

    const inner = rows.flatMap(({ left, right, walls }, row) =>
      walls
        .filter((x) => x - left >= MIN_COLUMN_WIDTH * scale && right - x >= MIN_COLUMN_WIDTH * scale)
        .map((x) => ({ x, row }))
    )
    const columns = [
      average(rows.map(({ left }) => left)),
      // A merged cell lacks a wall the other rows have, and a letter makes one no other row has.
      ...grouped(inner, ({ x }) => x, WALL_TOLERANCE * scale)
        .filter((group) => new Set(group.map(({ row }) => row)).size * 2 >= rows.length)
        .map((group) => average(group.map(({ x }) => x))),
      average(rows.map(({ right }) => right))
    ]

    const isEmpty = ({ walls }: RowWalls, row: number) => {
      const inset = CELL_INSET * scale
      // Where a column's wall is in this row, as a slanted table shifts it.
      const edges = columns.map((column) => walls.find((x) => Math.abs(x - column) <= EDGE_TOLERANCE * scale * 0.5) ?? column)
      return edges.slice(1).every((right, index) => {
        const left = edges[index]!
        const middle = (left + right) / 2
        const top = heightAt(tableLines[row]!, middle)
        const bottom = heightAt(tableLines[row + 1]!, middle)
        const area = [left + inset, top + inset, right - inset, bottom - inset].map(Math.round) as [number, number, number, number]
        // A cell too small to look into has no room for writing in it either.
        return area[2] <= area[0] || area[3] <= area[1] || inkShare(...area) <= MAX_INK_INSIDE
      })
    }

    tables.push({
      columns: columns.map((x) => x / scale),
      rows: tableLines.map((line) => middleOf(line) / scale),
      emptyRows: rows.map(isEmpty)
    })
  }
  return tables
}
