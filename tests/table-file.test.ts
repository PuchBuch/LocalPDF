import { describe, expect, it } from 'vitest'
import { formatCell } from '../src/core/cellFormat'
import { decodeText, readTableFile } from '../src/core/tableFile'
import { parseTableText, toTableText } from '../src/core/tableFill'
import { readXlsx } from '../src/core/xlsx'
import { readZip } from '../src/core/zip'
import { makeXlsx, makeZip, workbookFiles, type FixtureWorkbook } from './xlsxFixture'

/** 1 November 2026. */
const DAY = 46327

const rowsOf = async (workbook: FixtureWorkbook, locale = 'de') => (await readXlsx(makeXlsx(workbook), locale))[0]!.rows

describe('formatCell', () => {
  const show = (value: number, format: number | string, locale = 'de', from1904 = false) =>
    formatCell(value, typeof format === 'number' ? { id: format } : { id: 164, code: format }, { locale, from1904 })

  it('shows dates as their format says', () => {
    expect(show(DAY, 'dd.mm.yyyy')).toBe('01.11.2026')
    expect(show(DAY, 'd.m.yy')).toBe('1.11.26')
    expect(show(DAY, 'yyyy\\-mm\\-dd;@')).toBe('2026-11-01')
    expect(show(DAY, '[$-407]d. mmmm yyyy')).toBe('1. November 2026')
    expect(show(DAY, 'dd"/"mm"/"yyyy')).toBe('01/11/2026')
    expect(show(DAY - 1462, 'dd.mm.yyyy', 'de', true)).toBe('01.11.2026')
  })

  it('shows the standard date as the language writes it', () => {
    expect(show(DAY, 14)).toBe('01.11.2026')
    expect(show(DAY, 14, 'ru')).toBe('01.11.2026')
  })

  it('tells minutes from months', () => {
    expect(show(DAY + 9.5 / 24, 'dd.mm.yyyy hh:mm')).toBe('01.11.2026 09:30')
    expect(show(13.25 / 24, 'h:mm AM/PM')).toBe('1:15 PM')
    expect(show(90 / 86400, 'mm:ss')).toBe('01:30')
    expect(show(1.25, '[h]:mm')).toBe('30:00')
  })

  it('shows numbers as their format says', () => {
    expect(show(1234.5, 0)).toBe('1234,5')
    expect(show(0.1 + 0.2, 0)).toBe('0,3')
    expect(show(0.1 + 0.2, 0, 'en')).toBe('0.3')
    expect(show(1234.5, 4)).toBe('1.234,50')
    expect(show(83026, '00000')).toBe('83026')
    expect(show(1067, '00000')).toBe('01067')
    expect(show(0.19, 9)).toBe('19%')
    expect(show(-12.5, '#,##0.00\\ "€"')).toBe('-12,50 €')
    expect(show(12.5, '#,##0.00\\ [$€-407]')).toBe('12,50 €')
    expect(show(4915112345678, 0)).toBe('4915112345678')
  })

  it('shows a number plainly in a format it does not know', () => {
    expect(show(0.5, '# ?/?')).toBe('0,5')
    expect(show(12345, '0.00E+00')).toBe('12345')
    expect(show(5, '@')).toBe('5')
    expect(show(-5, 'dd.mm.yyyy')).toBe('-5')
  })
})

describe('readXlsx', () => {
  it('reads texts, numbers and dates in their columns', async () => {
    const rows = await rowsOf({
      sharedStrings: ['<t>Beispiel &amp; Söhne</t>', '<r><t xml:space="preserve">fett </t></r><r><rPr><b/></rPr><t>und mager</t></r>'],
      formats: [0, 'dd.mm.yyyy'],
      sheets: [
        {
          name: 'Liste',
          data:
            `<row r="1"><c r="A1" s="1"><v>${DAY}</v></c><c r="B1" t="s"><v>0</v></c><c r="D1"><v>5</v></c></row>` +
            '<row r="3"><c r="B3" t="s"><v>1</v></c><c r="C3" t="inlineStr"><is><t>a&#10;b</t></is></c><c r="D3" t="str"><f>1+1</f><v>zwei</v></c></row>'
        }
      ]
    })
    expect(rows).toEqual([
      ['01.11.2026', 'Beispiel & Söhne', '', '5'],
      ['', 'fett und mager', 'a\nb', 'zwei']
    ])
  })

  it('leaves out hidden rows, columns and sheets, and empty ones', async () => {
    const cell = (reference: string, text: string) => `<c r="${reference}" t="str"><v>${text}</v></c>`
    const sheets = await readXlsx(
      makeXlsx({
        sheets: [
          { name: 'Weg', state: 'hidden', data: `<row r="1">${cell('A1', 'x')}</row>` },
          { name: 'Leer', data: '<row r="1"><c r="A1" s="0"/></row>' },
          {
            name: 'Da',
            before: '<cols><col min="2" max="2" hidden="1"/></cols>',
            data:
              `<row r="1">${cell('A1', 'a')}${cell('B1', 'geheim')}${cell('C1', 'c')}</row>` +
              `<row r="2" hidden="1">${cell('A2', 'versteckt')}</row>`
          },
          { name: 'Auch da', data: `<row r="1">${cell('AB1', 'weit')}</row>` }
        ]
      }),
      'de'
    )
    expect(sheets.map(({ name }) => name)).toEqual(['Da', 'Auch da'])
    expect(sheets[0]!.rows).toEqual([['a', 'c']])
    expect(sheets[1]!.rows[0]).toHaveLength(28)
  })

  it('counts days from 1904 where the file says so', async () => {
    const data = `<row r="1"><c r="A1" s="0"><v>${DAY - 1462}</v></c></row>`
    expect(await rowsOf({ formats: ['dd.mm.yyyy'], date1904: true, sheets: [{ name: 'a', data }] })).toEqual([['01.11.2026']])
  })

  it('reads a file with stored parts, prefixed names and absolute paths', async () => {
    const files = workbookFiles({ sheets: [{ name: 'a', data: '' }] })
    files['xl/_rels/workbook.xml.rels'] = '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>'
    files['xl/worksheets/sheet1.xml'] =
      '<x:worksheet xmlns:x="x"><x:sheetData><x:row><x:c t="str"><x:v>eins</x:v></x:c><x:c><x:v>2</x:v></x:c></x:row></x:sheetData></x:worksheet>'
    expect(await readXlsx(makeZip(files, true), 'de')).toEqual([{ name: 'a', rows: [['eins', '2']] }])
  })

  it('refuses archives that hold no workbook, or are damaged', async () => {
    await expect(readXlsx(makeZip({ 'word/document.xml': '<a/>' }), 'de')).rejects.toThrow('Not an Excel file')
    expect(() => readZip(new Uint8Array([0x50, 0x4b, 3, 4, 0]))).toThrow('Not a ZIP archive')
  })
})

describe('toTableText', () => {
  it('gives text the same rows are read from', () => {
    const several = [['a, b', 'x\ny', '"q"'], ['c;d', '', 'e\tf']]
    expect(parseTableText(toTableText(several))).toEqual(several)
    const single = [['Beispiel, Musterstadt'], ['Muster; Söhne']]
    expect(parseTableText(toTableText(single))).toEqual(single)
    expect(parseTableText(toTableText([['a'], ['b', 'c']]))).toEqual([['a', ''], ['b', 'c']])
  })
})

describe('readTableFile', () => {
  const encode = (text: string) => new TextEncoder().encode(text)

  it('reads an Excel file, sheet by sheet', async () => {
    const data = '<row r="1"><c r="A1" t="str"><v>a, b</v></c><c r="B1"><v>1</v></c></row>'
    const sheets = await readTableFile(makeXlsx({ sheets: [{ name: 'Eins', data }, { name: 'Zwei', data }] }), 'de')
    expect(sheets.map(({ name }) => name)).toEqual(['Eins', 'Zwei'])
    expect(parseTableText(sheets[0]!.text)).toEqual([['a, b', '1']])
  })

  it('reads a CSV file however its letters are written', async () => {
    const [sheet] = await readTableFile(encode('﻿Firma;Straße\nMüller;Иванов'), 'ru')
    expect(parseTableText(sheet!.text)).toEqual([['Firma', 'Straße'], ['Müller', 'Иванов']])
    // "Größe;Müller" and "Привет" as Windows writes them in Western Europe and in Russia.
    expect(decodeText(new Uint8Array([0x47, 0x72, 0xf6, 0xdf, 0x65, 0x3b, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]))).toBe('Größe;Müller')
    expect(decodeText(new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]))).toBe('Привет')
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0, 0x3b, 0, 0x62, 0]))).toBe('a;b')
  })

  it('finds nothing in an empty file', async () => {
    expect(await readTableFile(encode(' \n'), 'de')).toEqual([])
    expect(await readTableFile(makeXlsx({ sheets: [{ name: 'a', data: '' }] }), 'de')).toEqual([])
  })

  it('refuses the older Excel format, and other files that are not text', async () => {
    const old = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
    await expect(readTableFile(old, 'de')).rejects.toThrow('Not a text file')
  })
})
