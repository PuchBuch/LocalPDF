import { describe, expect, it } from 'vitest'
import { LINE_HEIGHT } from '../src/core/fields'
import { fieldsForTable, parseTableText, withTakenRows, type TableFillOptions } from '../src/core/tableFill'
import type { TableGrid } from '../src/core/tableGrid'

const measure = (text: string, size: number) => Math.max(...text.split('\n').map((line) => line.length)) * size * 0.5

/** Three columns, a heading and three empty rows. */
const TABLE: TableGrid = {
  columns: [40, 100, 200, 260],
  rows: [100, 130, 160, 190, 220],
  emptyRows: [false, true, true, true]
}

function fill(rows: string[][], options?: TableFillOptions, table = TABLE) {
  let counter = 0
  return fieldsForTable(table, rows, measure, () => `f${counter++}`, options)
}

describe('parseTableText', () => {
  it('reads what a spreadsheet copies', () => {
    expect(parseTableText('01.11.2026\tBeispiel GmbH, Musterstadt\t5\r\n02.11.2026\tMuster; Söhne\t\r\n')).toEqual([
      ['01.11.2026', 'Beispiel GmbH, Musterstadt', '5'],
      ['02.11.2026', 'Muster; Söhne', '']
    ])
  })

  it('reads CSV with semicolons, and commas inside the values', () => {
    expect(parseTableText('a;b, c;1,5\nd;e;2,5')).toEqual([['a', 'b, c', '1,5'], ['d', 'e', '2,5']])
  })

  it('reads CSV with commas, and semicolons inside quotes', () => {
    expect(parseTableText('a,b,"x; y"\nc,d,e')).toEqual([['a', 'b', 'x; y'], ['c', 'd', 'e']])
  })

  it('reads quotes with line breaks, separators and quotes in them', () => {
    expect(parseTableText('"one\ntwo"\t"say ""hi"""\t"a\tb"\nx\ty\tz')).toEqual([
      ['one\ntwo', 'say "hi"', 'a\tb'],
      ['x', 'y', 'z']
    ])
    expect(parseTableText('"a\tb";c\n"d;e";f')).toEqual([['a\tb', 'c'], ['d;e', 'f']])
  })

  it('keeps a quote that is only part of a value', () => {
    expect(parseTableText('"Alpha" GmbH\tx\n12" Rohr\ty\n"open\tz')).toEqual([
      ['"Alpha" GmbH', 'x'],
      ['12" Rohr', 'y'],
      ['"open', 'z']
    ])
  })

  it('leaves out rows with nothing in them, and blanks around values', () => {
    expect(parseTableText('﻿\n a ; b \n;;\n  \nc;d\n\n')).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseTableText(' \n\t\n')).toEqual([])
    expect(parseTableText('')).toEqual([])
  })

  it('takes lines without a separator for a single column', () => {
    expect(parseTableText('one\ntwo\nthree, four')).toEqual([['one'], ['two'], ['three, four']])
  })
})

describe('fieldsForTable', () => {
  it('puts each value in its cell, below the heading', () => {
    const { fields, leftOutRows, leftOutColumns, tooLong } = fill([['Montag', 'Beispiel', 'Brief'], ['Dienstag', 'Muster', 'Anruf']])
    expect(fields.map(({ value }) => value)).toEqual(['Montag', 'Beispiel', 'Brief', 'Dienstag', 'Muster', 'Anruf'])
    fields.forEach((field, index) => {
      const column = index % 3
      const row = 1 + Math.floor(index / 3)
      expect(field.x).toBe(TABLE.columns[column]! + 4)
      expect(field.x + field.width).toBeLessThanOrEqual(TABLE.columns[column + 1]!)
      expect(field.y + field.height / 2).toBeCloseTo((TABLE.rows[row]! + TABLE.rows[row + 1]!) / 2)
      expect(field).toMatchObject({ type: 'TEXT', fontSize: 10, background: 'transparent' })
    })
    expect(new Set(fields.map(({ id }) => id)).size).toBe(6)
    expect({ leftOutRows, leftOutColumns, tooLong }).toEqual({ leftOutRows: 0, leftOutColumns: 0, tooLong: 0 })
  })

  it('follows the cells where the walls of a scan slant', () => {
    const cells = TABLE.emptyRows.map((_, row) =>
      TABLE.columns.slice(1).map((right, column) => ({
        x: TABLE.columns[column]! - row * 5,
        y: TABLE.rows[row]! + column,
        width: right - TABLE.columns[column]!,
        height: 30
      }))
    )
    const { fields } = fill([['eins', '5'], ['zwei', '6']], {}, { ...TABLE, cells })
    expect(fields.map(({ x }) => x)[0]).toBe(40 - 5 + 4)
    expect(fields.map(({ x }) => x)[2]).toBe(40 - 10 + 4)
    expect(fields[1]!.x + measure('5', 10) / 2).toBeCloseTo(150 - 5)
    expect(fields[1]!.y + fields[1]!.height / 2).toBeCloseTo(130 + 1 + 15)
  })

  it('centres a short value', () => {
    const [field] = fill([['', '5']]).fields
    expect(field!.x + measure('5', 10) / 2).toBeCloseTo(150)
  })

  it('wraps between words, in the largest font the lines fit in', () => {
    const { fields, tooLong } = fill([['aaaa bbbb cccc dddd']])
    // 52 points hold 10 letters in size 10, so two lines of nine, of which 26 points hold two.
    expect(fields[0]).toMatchObject({ value: 'aaaa bbbb\ncccc dddd', fontSize: 10 })
    expect(tooLong).toBe(0)

    const longer = fill([['aaaa bbbb cccc dddd eeee ffff']]).fields[0]!
    expect(longer.fontSize).toBeLessThan(10)
    expect(longer.value.split('\n').length * longer.fontSize * LINE_HEIGHT).toBeLessThanOrEqual(26)
    expect(longer.value.split('\n').join(' ')).toBe('aaaa bbbb cccc dddd eeee ffff')
  })

  it('sets a column in one size, in which each value stays in its cell', () => {
    const { fields, tooLong } = fill([
      ['kurz', 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk', 'x'],
      ['aaaa bbbb cccc dddd eeee ffff', 'kurz', 'y'],
      ['auch kurz', 'kurz', 'z']
    ])
    expect(tooLong).toBe(0)
    const sizes = fields.map(({ fontSize }) => fontSize)
    const column = (index: number) => [sizes[index], sizes[index + 3], sizes[index + 6]]
    for (const index of [0, 1, 2]) expect(new Set(column(index)).size, `column ${index}`).toBe(1)
    expect(column(0)[0]).toBeLessThan(10)
    expect(column(2)[0]).toBe(10)
    fields.forEach((field, index) => {
      const [row, place] = [1 + Math.floor(index / 3), index % 3]
      expect(field.y).toBeGreaterThanOrEqual(TABLE.rows[row]!)
      expect(field.y + field.height).toBeLessThanOrEqual(TABLE.rows[row + 1]!)
      expect(field.x).toBeGreaterThanOrEqual(TABLE.columns[place]!)
      expect(field.x + field.width).toBeLessThanOrEqual(TABLE.columns[place + 1]!)
    })
  })

  it('makes only a very long value very small, not the whole column', () => {
    const { fields } = fill([['x'.repeat(300)], ['kurz']])
    expect(fields.map(({ fontSize }) => fontSize)).toEqual([5, 7])
  })

  it('breaks a word too long for a line between its letters', () => {
    const [field] = fill([['abcdefghijklmno']]).fields
    expect(field!.value).toBe('abcdefghij\nklmno')
  })

  it('keeps the line breaks of a value', () => {
    expect(fill([['', 'one\n\n two  three']]).fields[0]!.value).toBe('one\ntwo three')
  })

  it('says which values are too long even in the smallest font', () => {
    const { fields, tooLong } = fill([['x'.repeat(300), 'ok']])
    expect(tooLong).toBe(1)
    expect(fields[0]!.fontSize).toBe(5)
    expect(fields[0]!.y).toBeGreaterThanOrEqual(TABLE.rows[1]!)
  })

  it('leaves out rows and columns the table has no room for', () => {
    const rows = Array.from({ length: 5 }, (_, row) => [`r${row}`, 'b', 'c', 'd', row === 0 ? 'e' : '', ''])
    const { fields, leftOutRows, leftOutColumns } = fill(rows)
    expect(fields).toHaveLength(9)
    expect(leftOutRows).toBe(2)
    expect(leftOutColumns).toBe(2)
  })

  it('makes no field of an empty value, and none of an empty row', () => {
    const { fields } = fill([['a', '', 'c'], ['', ' ', ''], ['d', '', '']])
    expect(fields.map(({ value }) => value)).toEqual(['a', 'c', 'd'])
    expect(fields[2]!.y).toBeLessThan(TABLE.rows[3]!)
  })

  it('skips the headings of the data, rows that are not empty, and rows before the first', () => {
    const table = { ...TABLE, emptyRows: [true, true, false, true] }
    const rows = [['Kopf'], ['eins'], ['zwei']]
    const at = (options: TableFillOptions) =>
      fill(rows, options, table).fields.map(({ value, y }) => [value, table.rows.filter((top) => top < y).length - 1])
    expect(at({})).toEqual([['Kopf', 0], ['eins', 1], ['zwei', 3]])
    expect(at({ skipHeading: true })).toEqual([['eins', 0], ['zwei', 1]])
    expect(at({ skipHeading: true, firstRow: 1 })).toEqual([['eins', 1], ['zwei', 3]])
  })

  it('finds nothing to do in a table without an empty row, or without data', () => {
    expect(fill([['a']], {}, { ...TABLE, emptyRows: [false, false, false, false] })).toMatchObject({ fields: [], leftOutRows: 1 })
    expect(fill([])).toEqual({ fields: [], leftOutRows: 0, leftOutColumns: 0, tooLong: 0 })
  })
})

describe('withTakenRows', () => {
  it('does not count rows with something in them as empty', () => {
    const inSecond = { x: 110, y: 165, width: 20, height: 12 }
    const beside = { x: 300, y: 135, width: 20, height: 12 }
    expect(withTakenRows(TABLE, [inSecond, beside]).emptyRows).toEqual([false, true, false, true])
  })
})
