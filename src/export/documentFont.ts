import fontkit from '@pdf-lib/fontkit'
import { plainFontName } from '../core/fonts'
import type { DocumentFont } from '../core/model'

/**
 * Turns a font of a page, as the PDF viewer rebuilt it, into one to draw new text with.
 * The viewer gives every glyph a private code besides its Unicode one, and a PDF written
 * with such a font says the private code too when its text is copied or searched. Only
 * the Unicode codes are kept here. Null for a font that cannot be read or used.
 */
export function prepareDocumentFont(data: Uint8Array, look: { bold: boolean; italic: boolean }): DocumentFont | null {
  try {
    const font = fontkit.create(data)
    const name = plainFontName(font.fullName || font.familyName || font.postscriptName || '')
    if (hasTwinInApp(name)) return null

    const glyphs = new Map<number, number>()
    for (const codePoint of font.characterSet) {
      if (!isPlainCharacter(codePoint)) continue
      // Some fonts have a character or two that cannot be read, the rest of them are fine.
      try {
        const glyph = font.glyphForCodePoint(codePoint)
        void glyph.advanceWidth
        if (glyph.id !== 0) glyphs.set(codePoint, glyph.id)
      } catch {
        continue
      }
    }
    if (glyphs.size === 0) return null
    addSpaces(font, glyphs)

    return {
      name,
      bytes: rebuildFont(data, cmapTable(glyphs)),
      ascent: font.ascent / font.unitsPerEm,
      descent: Math.abs(font.descent) / font.unitsPerEm,
      bold: look.bold,
      italic: look.italic,
      codePoints: [...glyphs.keys()].sort((a, b) => a - b)
    }
  } catch {
    return null
  }
}

/**
 * Fonts the app carries a twin of, letter for letter as wide. A PDF often only names
 * them, and the viewer then draws its own stand-in, which is no font of the document.
 */
function hasTwinInApp(name: string): boolean {
  const compact = name.replace(/[\s_,-]/g, '').toLowerCase()
  return /^(arial|arimo|helvetica|times|tinos|courier|cousine|liberation|foxit|symbol|zapfdingbats)/.test(compact)
}

function isPlainCharacter(codePoint: number): boolean {
  if (codePoint < 0x20 || codePoint === 0xffff) return false
  const privateUse = (codePoint >= 0xe000 && codePoint <= 0xf8ff) || codePoint >= 0xf0000
  return !privateUse
}

/**
 * Gives the spaces back their glyph. The viewer leaves out glyphs with nothing to draw,
 * so a space is still in the font but no character leads to it. It is found by its name.
 */
function addSpaces(font: ReturnType<typeof fontkit.create>, glyphs: Map<number, number>): void {
  if (glyphs.has(0x20)) {
    if (!glyphs.has(0xa0)) glyphs.set(0xa0, glyphs.get(0x20)!)
    return
  }
  for (let id = 1; id < font.numGlyphs; id++) {
    try {
      const glyph = font.getGlyph(id)
      // The font reader has the name, its types leave it out.
      const { name } = glyph as typeof glyph & { name?: string }
      if (name !== 'space' && name !== 'uni0020') continue
      if (!(glyph.advanceWidth > 0)) return
      glyphs.set(0x20, id)
      if (!glyphs.has(0xa0)) glyphs.set(0xa0, id)
      return
    } catch {
      continue
    }
  }
}

/** Runs of characters whose glyphs follow on as the characters do. */
function runsOf(glyphs: [number, number][]): { start: number; end: number; glyph: number }[] {
  const runs: { start: number; end: number; glyph: number }[] = []
  for (const [codePoint, glyph] of glyphs) {
    const last = runs.at(-1)
    if (last && codePoint === last.end + 1 && glyph === last.glyph + (codePoint - last.start)) last.end = codePoint
    else runs.push({ start: codePoint, end: codePoint, glyph })
  }
  return runs
}

/** A character map with the two usual Windows tables: one for the first 65536 code points, one for all. */
export function cmapTable(glyphs: Map<number, number>): Uint8Array {
  const sorted = [...glyphs].sort((a, b) => a[0] - b[0])
  const basic = runsOf(sorted.filter(([codePoint]) => codePoint <= 0xfffe))
  basic.push({ start: 0xffff, end: 0xffff, glyph: 0 })
  const all = runsOf(sorted)

  const segments = basic.length
  const format4Length = 16 + segments * 8
  if (format4Length > 0xffff) throw new Error('Too many characters for a font')
  const format12Length = 16 + all.length * 12
  const header = 4 + 2 * 8
  const out = new DataView(new ArrayBuffer(header + format4Length + format12Length))

  out.setUint16(0, 0)
  out.setUint16(2, 2)
  out.setUint16(4, 3)
  out.setUint16(6, 1)
  out.setUint32(8, header)
  out.setUint16(12, 3)
  out.setUint16(14, 10)
  out.setUint32(16, header + format4Length)

  let at = header
  const entrySelector = Math.floor(Math.log2(segments))
  const searchRange = 2 * 2 ** entrySelector
  out.setUint16(at, 4)
  out.setUint16(at + 2, format4Length)
  out.setUint16(at + 4, 0)
  out.setUint16(at + 6, segments * 2)
  out.setUint16(at + 8, searchRange)
  out.setUint16(at + 10, entrySelector)
  out.setUint16(at + 12, segments * 2 - searchRange)
  const ends = at + 14
  const starts = ends + segments * 2 + 2
  const deltas = starts + segments * 2
  const rangeOffsets = deltas + segments * 2
  basic.forEach((run, index) => {
    out.setUint16(ends + index * 2, run.end)
    out.setUint16(starts + index * 2, run.start)
    // The last segment maps 0xFFFF to glyph 0, as the format asks.
    const delta = run.start === 0xffff ? 1 : run.glyph - run.start
    out.setUint16(deltas + index * 2, (delta + 0x10000) % 0x10000)
    out.setUint16(rangeOffsets + index * 2, 0)
  })

  at += format4Length
  out.setUint16(at, 12)
  out.setUint16(at + 2, 0)
  out.setUint32(at + 4, format12Length)
  out.setUint32(at + 8, 0)
  out.setUint32(at + 12, all.length)
  all.forEach((run, index) => {
    const group = at + 16 + index * 12
    out.setUint32(group, run.start)
    out.setUint32(group + 4, run.end)
    out.setUint32(group + 8, run.glyph)
  })
  return new Uint8Array(out.buffer)
}

const tagOf = (view: DataView, at: number) =>
  String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))

function checksum(bytes: Uint8Array): number {
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4)
  padded.set(bytes)
  const view = new DataView(padded.buffer)
  let sum = 0
  for (let at = 0; at < padded.length; at += 4) sum = (sum + view.getUint32(at)) >>> 0
  return sum
}

/**
 * The font with a new character map. Its heights are also made the same in every table
 * that holds them, so the screen sets its lines as the export does, whatever the system.
 */
export function rebuildFont(data: Uint8Array, cmap: Uint8Array): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const tables = new Map<string, Uint8Array>()
  const count = view.getUint16(4)
  for (let index = 0; index < count; index++) {
    const record = 12 + index * 16
    const offset = view.getUint32(record + 8)
    const length = view.getUint32(record + 12)
    tables.set(tagOf(view, record), data.slice(offset, offset + length))
  }
  tables.set('cmap', cmap)
  matchHeights(tables)

  const tags = [...tables.keys()].sort()
  const directory = 12 + tags.length * 16
  let size = directory
  for (const tag of tags) size += Math.ceil(tables.get(tag)!.length / 4) * 4
  const out = new Uint8Array(size)
  const outView = new DataView(out.buffer)

  outView.setUint32(0, view.getUint32(0))
  const entrySelector = Math.floor(Math.log2(tags.length))
  const searchRange = 2 ** entrySelector * 16
  outView.setUint16(4, tags.length)
  outView.setUint16(6, searchRange)
  outView.setUint16(8, entrySelector)
  outView.setUint16(10, tags.length * 16 - searchRange)

  const head = tables.get('head')
  if (head && head.length >= 12) new DataView(head.buffer, head.byteOffset).setUint32(8, 0)
  let offset = directory
  tags.forEach((tag, index) => {
    const table = tables.get(tag)!
    const record = 12 + index * 16
    for (let at = 0; at < 4; at++) outView.setUint8(record + at, tag.charCodeAt(at))
    outView.setUint32(record + 4, checksum(table))
    outView.setUint32(record + 8, offset)
    outView.setUint32(record + 12, table.length)
    out.set(table, offset)
    offset += Math.ceil(table.length / 4) * 4
  })
  const headIndex = tags.indexOf('head')
  if (head && head.length >= 12) {
    const headOffset = outView.getUint32(12 + headIndex * 16 + 8)
    outView.setUint32(headOffset + 8, (0xb1b0afba - checksum(out)) >>> 0)
  }
  return out
}

/** Gives the OS/2 table the heights of the hhea table, which the export measures by. */
function matchHeights(tables: Map<string, Uint8Array>): void {
  const hhea = tables.get('hhea')
  const os2 = tables.get('OS/2')
  if (!hhea || !os2 || hhea.length < 10 || os2.length < 78) return
  const from = new DataView(hhea.buffer, hhea.byteOffset, hhea.length)
  const to = new DataView(os2.buffer, os2.byteOffset, os2.length)
  const ascender = from.getInt16(4)
  const descender = from.getInt16(6)
  to.setInt16(68, ascender)
  to.setInt16(70, descender)
  to.setInt16(72, 0)
  to.setUint16(74, Math.max(0, ascender))
  to.setUint16(76, Math.max(0, -descender))
  // Use the typographic heights, which now are the same.
  to.setUint16(62, to.getUint16(62) | 0x80)
  from.setInt16(8, 0)
}
