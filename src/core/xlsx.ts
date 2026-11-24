import { formatCell, type CellFormat, type FormatSettings } from './cellFormat'
import { readZip } from './zip'

export interface SheetRows {
  name: string
  rows: string[][]
}

/** No sheet has more columns than this. */
const MAX_COLUMNS = 16_384

interface XmlElement {
  attributes: Record<string, string>
  content: string
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function plainText(xml: string): string {
  return xml.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (whole, hex?: string, decimal?: string, name?: string) => {
    if (name) return ENTITIES[name] ?? whole
    const code = hex ? parseInt(hex, 16) : Number(decimal)
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

/** The elements of a name, whatever prefix the file gives its names. They must not hold others of that name. */
function elements(xml: string, name: string): XmlElement[] {
  const pattern = new RegExp(
    `<(?:\\w+:)?${name}((?:\\s+[\\w:.-]+\\s*=\\s*(?:"[^"]*"|'[^']*'))*)\\s*(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${name}\\s*>)`,
    'g'
  )
  return [...xml.matchAll(pattern)].map(([, attributes = '', content = '']) => ({
    attributes: Object.fromEntries(
      [...attributes.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([, key, double, single]) => [
        key!,
        plainText(double ?? single ?? '')
      ])
    ),
    content
  }))
}

/** The text of a cell, whose pieces can each look different. */
function textOf(xml: string): string {
  // How a word is pronounced, beside the word itself.
  const written = xml.replace(/<(?:\w+:)?rPh[\s>][\s\S]*?<\/(?:\w+:)?rPh\s*>/g, '')
  return elements(written, 't')
    .map(({ content }) => plainText(content).replace(/_x([0-9a-f]{4})_/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16))))
    .join('')
    .replace(/\r\n?/g, '\n')
}

/** The column a cell such as AB12 is in, from 0. */
function columnOf(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? ''
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1
}

const isTrue = (value: string | undefined) => value === '1' || value === 'true'

function cellFormats(styles: string): CellFormat[] {
  const codes = new Map(elements(styles, 'numFmt').map(({ attributes }) => [Number(attributes['numFmtId']), attributes['formatCode']]))
  const cells = elements(styles, 'cellXfs')[0]?.content ?? ''
  return elements(cells, 'xf').map(({ attributes }) => {
    const id = Number(attributes['numFmtId'] ?? 0)
    return { id, code: codes.get(id) }
  })
}

function sheetRows(xml: string, sharedTexts: string[], formats: CellFormat[], settings: FormatSettings): string[][] {
  const hiddenColumns = elements(elements(xml, 'cols')[0]?.content ?? '', 'col')
    .filter(({ attributes }) => isTrue(attributes['hidden']))
    .map(({ attributes }) => ({ from: Number(attributes['min']) - 1, to: Number(attributes['max']) - 1 }))
  const isHidden = (column: number) => hiddenColumns.some(({ from, to }) => column >= from && column <= to)

  const valueOf = ({ attributes, content }: XmlElement): string => {
    const value = plainText(elements(content, 'v')[0]?.content ?? '')
    switch (attributes['t']) {
      case 's':
        return sharedTexts[Number(value)] ?? ''
      case 'inlineStr':
        return textOf(content)
      case 'str':
      case 'e':
        return value
      case 'b':
        return isTrue(value) ? 'TRUE' : 'FALSE'
      case 'd':
        return value
    }
    if (value === '' || !Number.isFinite(Number(value))) return value
    return formatCell(Number(value), formats[Number(attributes['s'] ?? 0)] ?? { id: 0 }, settings)
  }

  return elements(elements(xml, 'sheetData')[0]?.content ?? '', 'row').flatMap((row) => {
    // Left out, as copying what is shown would do.
    if (isTrue(row.attributes['hidden'])) return []
    const values: string[] = []
    let next = 0
    for (const cell of elements(row.content, 'c')) {
      const column = cell.attributes['r'] ? columnOf(cell.attributes['r']) : next
      if (column < 0 || column >= MAX_COLUMNS) continue
      next = column + 1
      while (values.length < column) values.push('')
      values[column] = valueOf(cell).trim()
    }
    const shown = values.filter((_, column) => !isHidden(column))
    return shown.some((value) => value !== '') ? [shown] : []
  })
}

/** The rows of the sheets of an Excel file, as the sheets show them. Sheets without any are left out. */
export async function readXlsx(bytes: Uint8Array, locale: string): Promise<SheetRows[]> {
  const files = readZip(bytes)
  const read = async (path: string) => {
    const file = files.get(path)
    return file ? new TextDecoder().decode(await file()) : ''
  }
  const workbook = await read('xl/workbook.xml')
  if (workbook === '') throw new Error('Not an Excel file')
  const targets = new Map(
    elements(await read('xl/_rels/workbook.xml.rels'), 'Relationship').map(({ attributes }) => [
      attributes['Id'],
      // Given from the folder of the workbook, or from the top of the archive.
      decodeURIComponent(new URL(attributes['Target'] ?? '', 'file:///xl/').pathname).slice(1)
    ])
  )
  const sharedTexts = elements(await read('xl/sharedStrings.xml'), 'si').map(({ content }) => textOf(content))
  const formats = cellFormats(await read('xl/styles.xml'))
  const settings = { locale, from1904: isTrue(elements(workbook, 'workbookPr')[0]?.attributes['date1904']) }

  const sheets: SheetRows[] = []
  for (const { attributes } of elements(elements(workbook, 'sheets')[0]?.content ?? '', 'sheet')) {
    if (attributes['state'] === 'hidden' || attributes['state'] === 'veryHidden') continue
    const relation = Object.entries(attributes).find(([key]) => key.endsWith(':id'))?.[1]
    const rows = sheetRows(await read(targets.get(relation) ?? ''), sharedTexts, formats, settings)
    if (rows.length > 0) sheets.push({ name: attributes['name'] ?? '', rows })
  }
  return sheets
}
