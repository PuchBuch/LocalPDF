import { crc32, deflateRawSync } from 'node:zlib'

/** A ZIP archive of the given files, packed unless asked to store them as they are. */
export function makeZip(files: Record<string, string>, stored = false): Uint8Array {
  const locals: Buffer[] = []
  const entries: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const content = Buffer.from(text)
    const packed = stored ? content : deflateRawSync(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(stored ? 0 : 8, 8)
    local.writeUInt32LE(crc32(content), 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(stored ? 0 : 8, 10)
    entry.writeUInt32LE(crc32(content), 16)
    entry.writeUInt32LE(packed.length, 20)
    entry.writeUInt32LE(content.length, 24)
    entry.writeUInt16LE(nameBytes.length, 28)
    entry.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, packed)
    entries.push(entry, nameBytes)
    offset += 30 + nameBytes.length + packed.length
  }
  const directory = Buffer.concat(entries)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}

export interface FixtureSheet {
  name: string
  /** The content of sheetData, and what goes in front of it. */
  data: string
  before?: string
  state?: string
}

export interface FixtureWorkbook {
  sheets: FixtureSheet[]
  sharedStrings?: string[]
  /** The number formats of cell styles 0, 1, … */
  formats?: (number | string)[]
  date1904?: boolean
}

/** The files of an Excel workbook, with its parts written out as Excel does. */
export function workbookFiles({ sheets, sharedStrings = [], formats = [0], date1904 = false }: FixtureWorkbook): Record<string, string> {
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const relations = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  const own = formats.filter((format) => typeof format === 'string')
  const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const idOf = (format: number | string) => (typeof format === 'number' ? format : 164 + own.indexOf(format))
  const files: Record<string, string> = {
    'xl/workbook.xml': `${declaration}<workbook xmlns="${main}" xmlns:r="${relations}"><workbookPr${date1904 ? ' date1904="1"' : ''}/><sheets>${sheets
      .map(({ name, state }, index) => `<sheet name="${name}" sheetId="${index + 1}"${state ? ` state="${state}"` : ''} r:id="rId${index + 1}"/>`)
      .join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${declaration}<Relationships>${sheets
      .map((_, index) => `<Relationship Id="rId${index + 1}" Type="${relations}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
      .join('')}</Relationships>`,
    'xl/sharedStrings.xml': `${declaration}<sst xmlns="${main}">${sharedStrings.map((text) => `<si>${text}</si>`).join('')}</sst>`,
    'xl/styles.xml': `${declaration}<styleSheet xmlns="${main}"><numFmts>${own
      .map((format) => `<numFmt numFmtId="${idOf(format)}" formatCode="${escaped(format)}"/>`)
      .join('')}</numFmts><cellStyleXfs><xf numFmtId="9"/></cellStyleXfs><cellXfs>${formats
      .map((format) => `<xf numFmtId="${idOf(format)}" applyNumberFormat="1"><alignment/></xf>`)
      .join('')}</cellXfs></styleSheet>`
  }
  sheets.forEach(({ data, before = '' }, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] =
      `${declaration}<worksheet xmlns="${main}">${before}<sheetData>${data}</sheetData></worksheet>`
  })
  return files
}

export const makeXlsx = (workbook: FixtureWorkbook): Uint8Array => makeZip(workbookFiles(workbook))
