import { describe, expect, it } from 'vitest'
import { findTables } from '../src/core/tableGrid'

const SCALE = 2
const PAGE = { width: 1000, height: 700 }
const COLUMNS = [40, 131, 338, 456, 627, 711, 885, 957]
const ROWS = [180, 232, ...Array.from({ length: 12 }, (_, row) => 232 + 33 * (row + 1))]

/** A page picture to draw on, in points, as the mask detection reads, all of it slanted if asked. */
function canvas({ slant = 0, width = PAGE.width, height = PAGE.height } = {}) {
  const w = width * SCALE
  const h = height * SCALE
  const flat = new Uint8Array(w * h)
  const fill = (x: number, y: number, width: number, height: number, ink = 1) => {
    for (let py = Math.round(y * SCALE); py < Math.round((y + height) * SCALE); py++) {
      for (let px = Math.round(x * SCALE); px < Math.round((x + width) * SCALE); px++) flat[py * w + px] = ink
    }
  }
  /** Lines around and between cells, the middle of each at the given place. */
  const table = (columns: number[], rows: number[], { frame = 3, wall = 1 } = {}) => {
    const [left, right] = [columns[0]!, columns.at(-1)!]
    const [top, bottom] = [rows[0]!, rows.at(-1)!]
    for (const y of rows) {
      const thick = y === top || y === bottom ? frame : wall
      fill(left - frame / 2, y - thick / 2, right - left + frame, thick)
    }
    for (const x of columns) {
      const thick = x === left || x === right ? frame : wall
      fill(x - thick / 2, top - frame / 2, thick, bottom - top + frame)
    }
  }
  /** Upright strokes standing in for letters. */
  const text = (x: number, y: number, width: number, height = 8) => {
    for (let dx = 0; dx < width; dx += 5) fill(x + dx, y, 2, height)
  }
  const find = () => {
    if (slant === 0) return findTables(flat, w, h, SCALE)
    // Turned about the middle of the page, as a sheet laid askew on the scanner.
    const mask = new Uint8Array(w * h)
    const [sin, cos] = [Math.sin((slant * Math.PI) / 180), Math.cos((slant * Math.PI) / 180)]
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [dx, dy] = [x - w / 2, y - h / 2]
        const fromX = Math.round(w / 2 + dx * cos + dy * sin)
        const fromY = Math.round(h / 2 - dx * sin + dy * cos)
        if (fromX >= 0 && fromY >= 0 && fromX < w && fromY < h) mask[y * w + x] = flat[fromY * w + fromX]!
      }
    }
    return findTables(mask, w, h, SCALE)
  }
  return { fill, table, text, find }
}

function headings(page: ReturnType<typeof canvas>): void {
  for (const x of COLUMNS.slice(0, -1)) page.text(x + 10, 200, 40)
}

function expectNear(found: number[], expected: number[], tolerance: number): void {
  expect(found).toHaveLength(expected.length)
  found.forEach((value, index) => expect(Math.abs(value - expected[index]!), `${value} for ${expected[index]}`).toBeLessThanOrEqual(tolerance))
}

const EMPTY_AFTER_HEADING = [false, ...Array<boolean>(12).fill(true)]

describe('findTables', () => {
  it('finds the cells of a table with a thick frame, and its heading', () => {
    const page = canvas()
    page.table(COLUMNS, ROWS)
    headings(page)
    const tables = page.find()
    expect(tables).toHaveLength(1)
    expectNear(tables[0]!.columns, COLUMNS, 0.5)
    expectNear(tables[0]!.rows, ROWS, 0.5)
    expect(tables[0]!.emptyRows).toEqual(EMPTY_AFTER_HEADING)
  })

  it('leaves out a rule above the table, even one as wide as it', () => {
    const page = canvas()
    page.fill(39, 150, 919, 1)
    page.table(COLUMNS, ROWS)
    headings(page)
    const tables = page.find()
    expect(tables).toHaveLength(1)
    expectNear(tables[0]!.rows, ROWS, 0.5)
  })

  it.each([0.1, -0.2, 0.4])('finds a table slanted by %s degrees', (slant) => {
    const page = canvas({ slant })
    page.table(COLUMNS, ROWS)
    headings(page)
    const tables = page.find()
    expect(tables).toHaveLength(1)
    expectNear(tables[0]!.columns, COLUMNS, 2)
    expectNear(tables[0]!.rows, ROWS, 2)
    expect(tables[0]!.emptyRows).toEqual(EMPTY_AFTER_HEADING)
  })

  it('finds a table whose lines are broken', () => {
    const page = canvas()
    page.table(COLUMNS, ROWS)
    headings(page)
    // Across every line, horizontal ones every 60 points and walls once a row.
    for (let x = 75; x < 950; x += 60) page.fill(x, 170, 1.5, 480, 0)
    for (const y of ROWS) page.fill(30, y + 12, 940, 1.5, 0)
    const tables = page.find()
    expect(tables).toHaveLength(1)
    expectNear(tables[0]!.columns, COLUMNS, 1)
    expectNear(tables[0]!.rows, ROWS, 1)
    expect(tables[0]!.emptyRows).toEqual(EMPTY_AFTER_HEADING)
  })

  it('takes a double line for one', () => {
    const page = canvas()
    page.table(COLUMNS, ROWS, { frame: 1 })
    page.fill(40, ROWS[1]! + 2.5, 917, 1)
    const [table] = page.find()
    expect(table!.rows).toHaveLength(ROWS.length)
    expect(Math.abs(table!.rows[1]! - 233.5)).toBeLessThan(1)
  })

  it('does not take the strokes of letters for columns', () => {
    const page = canvas()
    page.table(COLUMNS, ROWS)
    // Letters nearly as high as their row, in less than half of the rows.
    for (const row of [0, 1, 2]) page.text(150, ROWS[row]! + 1, 60, ROWS[row + 1]! - ROWS[row]! - 2)
    const [table] = page.find()
    expectNear(table!.columns, COLUMNS, 0.5)
    expect(table!.emptyRows.slice(0, 4)).toEqual([false, false, false, true])
  })

  it('keeps a column whose wall a merged cell lacks', () => {
    const page = canvas()
    page.table(COLUMNS, ROWS)
    page.fill(330, 183, 16, 47, 0)
    const [table] = page.find()
    expectNear(table!.columns, COLUMNS, 0.5)
  })

  it('sees a short value in a single cell', () => {
    const page = canvas()
    page.table(COLUMNS, ROWS)
    page.text(50, ROWS[3]! + 12, 30)
    expect(page.find()[0]!.emptyRows.map((empty, row) => (empty ? -1 : row)).filter((row) => row >= 0)).toEqual([3])
  })

  it('overlooks specks', () => {
    const page = canvas()
    page.table(COLUMNS, ROWS)
    for (let x = 60; x < 950; x += 47) page.fill(x, ROWS[2]! + 15, 1, 1)
    expect(page.find()[0]!.emptyRows.every(Boolean)).toBe(true)
  })

  it('finds two tables, above and beside each other', () => {
    const page = canvas()
    page.table([40, 150, 300], [100, 130, 160, 190])
    page.table([400, 500, 600, 700], [105, 140, 175])
    page.table([40, 170, 300], [300, 340, 380])
    const tables = page.find()
    expect(tables.map(({ columns, rows }) => [columns.length - 1, rows.length - 1])).toEqual([[2, 3], [3, 2], [2, 2]])
  })

  it('does not take a filled bar, a lone box or lines without walls for a table', () => {
    const page = canvas()
    page.fill(40, 60, 600, 20)
    page.fill(40, 100, 600, 20)
    page.table([40, 640], [200, 260])
    for (const y of [400, 430, 460, 490]) page.fill(40, y, 600, 1)
    expect(page.find()).toEqual([])
  })

  it('finds nothing in lines of text, or on an empty page', () => {
    const page = canvas()
    for (let y = 60; y < 600; y += 14) page.text(60, y, 800)
    expect(page.find()).toEqual([])
    expect(canvas().find()).toEqual([])
  })
})
