import type { Rect } from './geometry'
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
/** A wall missed in more rows than this is looked for no further away. */
const MAX_MISSED_ROWS = 3
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
  /** Where each cell of each row really is, as the walls of a scan slant. */
  cells?: Rect[][]
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

/** Numbers in order, with those next to each other in one group. */
function neighbours(values: number[]): number[][] {
  const groups: number[][] = []
  for (const value of values) {
    const last = groups.at(-1)
    if (last && value - last.at(-1)! <= 1) last.push(value)
    else groups.push([value])
  }
  return groups
}

interface WallPiece {
  row: number
  x: number
}

/** Where a wall is in a row, between the rows it was found in if it was not found in this one. */
function wallInRow(pieces: WallPiece[], row: number): number {
  const before = pieces.filter((piece) => piece.row <= row).at(-1)
  const after = pieces.find((piece) => piece.row >= row)
  if (!before || !after) return (before ?? after)!.x
  if (before.row === after.row) return before.x
  return before.x + ((after.x - before.x) * (row - before.row)) / (after.row - before.row)
}

/** The walls between the columns, each followed down the rows as it slants: its place in every row. */
function innerWalls(rows: RowWalls[], scale: number): number[][] {
  const found: WallPiece[][] = []
  rows.forEach(({ left, right, walls }, row) => {
    for (const x of walls) {
      if (x - left < MIN_COLUMN_WIDTH * scale || right - x < MIN_COLUMN_WIDTH * scale) continue
      const distance = (pieces: WallPiece[]) => Math.abs(pieces.at(-1)!.x - x)
      const continued = found
        .filter((pieces) => {
          const missed = row - pieces.at(-1)!.row
          return missed > 0 && distance(pieces) <= WALL_TOLERANCE * scale * Math.min(missed, MAX_MISSED_ROWS)
        })
        .sort((a, b) => distance(a) - distance(b))[0]
      if (continued) continued.push({ row, x })
      else found.push([{ row, x }])
    }
  })
  return (
    found
      // A merged cell lacks a wall the other rows have, and a letter makes one no other row has.
      .filter((pieces) => pieces.length * 2 >= rows.length)
      .map((pieces) => rows.map((_, row) => wallInRow(pieces, row)))
      .sort((a, b) => a[0]! - b[0]!)
  )
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
    const walls = neighbours(hits)
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

    const walls = [rows.map(({ left }) => left), ...innerWalls(rows, scale), rows.map(({ right }) => right)]
    const cells = rows.map((_, row) =>
      walls.slice(1).map((wall, index): Rect => {
        const left = walls[index]![row]!
        const width = wall[row]! - left
        const top = heightAt(tableLines[row]!, left + width / 2)
        return { x: left, y: top, width, height: heightAt(tableLines[row + 1]!, left + width / 2) - top }
      })
    )

    const isEmpty = (cell: Rect) => {
      const inset = CELL_INSET * scale
      const area = [cell.x + inset, cell.y + inset, cell.x + cell.width - inset, cell.y + cell.height - inset].map(Math.round) as [
        number,
        number,
        number,
        number
      ]
      // A cell too small to look into has no room for writing in it either.
      return area[2] <= area[0] || area[3] <= area[1] || inkShare(...area) <= MAX_INK_INSIDE
    }

    tables.push({
      columns: walls.map((wall) => average(wall) / scale),
      rows: tableLines.map((line) => middleOf(line) / scale),
      emptyRows: cells.map((row) => row.every(isEmpty)),
      cells: cells.map((row) =>
        row.map(({ x, y, width, height }) => ({ x: x / scale, y: y / scale, width: width / scale, height: height / scale }))
      )
    })
  }
  return tables
}
