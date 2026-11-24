import { fitTextField, LINE_HEIGHT, newTextField, type MeasureText } from './fields'
import type { Rect } from './geometry'
import type { TextField } from './model'
import type { TableGrid } from './tableGrid'

const MAX_CELL_FONT_SIZE = 10
const MIN_CELL_FONT_SIZE = 5
const FONT_STEP = 0.5
/** A column is set in one size, but a value that needs a smaller one than this makes only itself smaller. */
const MIN_COLUMN_FONT_SIZE = 7
/** Space between the walls of a cell and its text, in points. */
const INSET_X = 4
const INSET_Y = 2
/** A value this short, such as a number, is centred in its cell. */
const SHORT_VALUE = 3

const DELIMITERS = ['\t', ';', ','] as const
type Delimiter = (typeof DELIMITERS)[number]

/**
 * What separates the columns. Text copied from a spreadsheet has tabs between them, and
 * the rows of a CSV file mostly have the character that separates theirs.
 */
function findDelimiter(text: string): Delimiter {
  const withoutQuoted = text.replace(/(^|[\t;,\n]) *"(?:[^"]|"")*"(?= *(?:[\t;,\n]|$))/g, '$1')
  if (withoutQuoted.includes('\t')) return '\t'
  const lines = withoutQuoted.split('\n').filter((line) => line.trim() !== '')
  const separated = (delimiter: Delimiter) => lines.filter((line) => line.includes(delimiter)).length * 2 >= lines.length
  return DELIMITERS.slice(1).find(separated) ?? '\t'
}

/** The quoted cell starting at a quote, or null if the quote is only part of the text. */
function quotedCell(text: string, start: number, delimiter: Delimiter): { value: string; end: number } | null {
  let value = ''
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] !== '"') {
      value += text[i]
    } else if (text[i + 1] === '"') {
      value += '"'
      i++
    } else {
      let end = i + 1
      while (text[end] === ' ') end++
      return end === text.length || text[end] === delimiter || text[end] === '\n' ? { value, end } : null
    }
  }
  return null
}

/** Reads rows copied from a spreadsheet or a CSV file. Rows with nothing in them are left out. */
export function parseTableText(text: string): string[][] {
  const input = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (input.trim() === '') return []
  const delimiter = findDelimiter(input)
  const rows: string[][] = []
  let row: string[] = []
  let position = 0
  while (position <= input.length) {
    let start = position
    while (input[start] === ' ') start++
    const quoted = input[start] === '"' ? quotedCell(input, start, delimiter) : null
    let end = quoted?.end ?? position
    if (!quoted) while (end < input.length && input[end] !== delimiter && input[end] !== '\n') end++
    row.push((quoted?.value ?? input.slice(position, end)).trim())
    if (input[end] !== delimiter) {
      rows.push(row)
      row = []
    }
    position = end + 1
  }
  return rows.filter((cells) => cells.some((cell) => cell !== ''))
}

/** Rows as text that parseTableText reads the same rows from. */
export function toTableText(rows: string[][]): string {
  const columns = rows.reduce((most, cells) => Math.max(most, cells.length), 0)
  // With no tabs between columns, other separators in the values would be taken for some.
  const special = columns > 1 ? /["\t\n]/ : /["\t\n;,]/
  const written = (value: string) => (special.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
  return rows.map((cells) => Array.from({ length: columns }, (_, column) => written(cells[column] ?? '')).join('\t')).join('\n')
}

/** The table with the rows that have one of these boxes in them no longer empty. */
export function withTakenRows(table: TableGrid, taken: Rect[]): TableGrid {
  const left = table.columns[0]!
  const right = table.columns.at(-1)!
  const isTaken = (row: number) =>
    taken.some((box) => {
      const middle = box.y + box.height / 2
      return box.x < right && box.x + box.width > left && middle > table.rows[row]! && middle < table.rows[row + 1]!
    })
  return { ...table, emptyRows: table.emptyRows.map((empty, row) => empty && !isTaken(row)) }
}

/** Breaks a text into lines between its words, and a word too long for a line between its letters. */
function wrapText(text: string, fits: (line: string) => boolean): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((word) => word !== '')
    if (words.length === 0) continue
    let line = ''
    for (const word of words) {
      const longer = line === '' ? word : `${line} ${word}`
      if (fits(longer)) {
        line = longer
        continue
      }
      if (line !== '') lines.push(line)
      line = ''
      for (const letter of word) {
        if (line !== '' && !fits(line + letter)) {
          lines.push(line)
          line = ''
        }
        line += letter
      }
    }
    lines.push(line)
  }
  return lines
}

/** A cell where it really is, or else where its row and column cross. */
function cellAt(table: TableGrid, row: number, column: number): Rect {
  const x = table.columns[column]!
  const y = table.rows[row]!
  return table.cells?.[row]?.[column] ?? { x, y, width: table.columns[column + 1]! - x, height: table.rows[row + 1]! - y }
}

export interface TableFillOptions {
  /** The first row of the table to write in, or else its first empty one. */
  firstRow?: number
  /** The first row of the data is its headings, which the table has already. */
  skipHeading?: boolean
}

export interface TableFill {
  fields: TextField[]
  /** Rows and columns of the data the table has no room for. */
  leftOutRows: number
  leftOutColumns: number
  /** Values that stick out of their cells even in the smallest font. */
  tooLong: number
}

/** Text fields writing rows of data into the empty rows of a table, each value in its cell. */
export function fieldsForTable(
  table: TableGrid,
  rows: string[][],
  measure: MeasureText,
  newId: () => string,
  { firstRow = 0, skipHeading = false }: TableFillOptions = {}
): TableFill {
  const data = (skipHeading ? rows.slice(1) : rows).filter((cells) => cells.some((cell) => cell.trim() !== ''))
  const places = table.emptyRows.flatMap((empty, row) => (empty && row >= firstRow ? [row] : []))
  const columnCount = table.columns.length - 1
  const usedColumns = data.reduce(
    (most, cells) => cells.reduce((used, cell, column) => (cell.trim() === '' ? used : Math.max(used, column + 1)), most),
    0
  )
  const values: { value: string; column: number; cell: Rect; fontSize: number; fits: boolean }[] = []
  const wrapped = (value: string, cell: Rect, fontSize: number) =>
    wrapText(value, (line) => measure(line, fontSize) <= cell.width - INSET_X * 2)
  const fitsHeight = (lines: string[], cell: Rect, fontSize: number) =>
    lines.length * fontSize * LINE_HEIGHT <= cell.height - INSET_Y * 2

  for (const [index, row] of places.slice(0, data.length).entries()) {
    for (const [column, cell] of data[index]!.slice(0, columnCount).entries()) {
      const value = cell.trim()
      if (value === '') continue
      const cell = cellAt(table, row, column)
      let fontSize = MAX_CELL_FONT_SIZE
      while (!fitsHeight(wrapped(value, cell, fontSize), cell, fontSize) && fontSize > MIN_CELL_FONT_SIZE) fontSize -= FONT_STEP
      values.push({ value, column, cell, fontSize, fits: fitsHeight(wrapped(value, cell, fontSize), cell, fontSize) })
    }
  }

  const columnSizes = new Map<number, number>()
  for (const { column, fontSize } of values) {
    columnSizes.set(column, Math.min(columnSizes.get(column) ?? MAX_CELL_FONT_SIZE, Math.max(fontSize, MIN_COLUMN_FONT_SIZE)))
  }
  const fields = values.map(({ value, column, cell, fits, fontSize: largest }) => {
    // What fits in a size fits in a smaller one too.
    const fontSize = Math.min(largest, columnSizes.get(column)!)
    const lines = wrapped(value, cell, fontSize)
    const text = lines.join('\n')
    const centred = lines.length === 1 && Array.from(value).length <= SHORT_VALUE
    const field = {
      ...newTextField(newId()),
      value: text,
      fontSize,
      x: centred ? cell.x + (cell.width - measure(text, fontSize)) / 2 : cell.x + INSET_X,
      // Text too long for its cell runs out of it at the bottom only.
      y: fits ? cell.y + (cell.height - lines.length * fontSize * LINE_HEIGHT) / 2 : cell.y + INSET_Y
    }
    return fitTextField(field, measure, { width: Infinity, height: Infinity })
  })
  return {
    fields,
    leftOutRows: Math.max(0, data.length - places.length),
    leftOutColumns: Math.max(0, usedColumns - columnCount),
    tooLong: values.filter(({ fits }) => !fits).length
  }
}
