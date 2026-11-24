import { toTableText } from './tableFill'
import { readXlsx } from './xlsx'

/** No list to fill a table from is larger. */
const MAX_FILE_SIZE = 20 * 1024 * 1024

/** Rows of a file as text, as if they had been pasted. */
export interface TableSheet {
  /** Empty for a file that has no sheets. */
  name: string
  text: string
}

const startsWith = (bytes: Uint8Array, start: number[]) => start.every((value, index) => bytes[index] === value)

/** The text of a CSV file, which does not say how its letters are written. */
export function decodeText(bytes: Uint8Array): string {
  if (startsWith(bytes, [0xff, 0xfe])) return new TextDecoder('utf-16le').decode(bytes)
  if (startsWith(bytes, [0xfe, 0xff])) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Words all of letters beyond the Latin ones are Cyrillic, single ones are umlauts and accents.
    const cyrillic = bytes.some((_, index) => index >= 2 && [0, 1, 2].every((back) => bytes[index - back]! >= 0xc0))
    return new TextDecoder(cyrillic ? 'windows-1251' : 'windows-1252').decode(bytes)
  }
}

/** Reads the rows of an Excel or CSV file. Throws if it is neither. */
export async function readTableFile(bytes: Uint8Array, locale: string): Promise<TableSheet[]> {
  if (bytes.length > MAX_FILE_SIZE) throw new Error('The file is too large')
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return (await readXlsx(bytes, locale)).map(({ name, rows }) => ({ name, text: toTableText(rows) }))
  }
  const text = decodeText(bytes)
  // Other kinds of files, such as the older Excel ones, are not text.
  if (text.includes('\0')) throw new Error('Not a text file')
  return text.trim() === '' ? [] : [{ name: '', text }]
}
