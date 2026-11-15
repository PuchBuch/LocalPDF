import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { newTextField } from '../src/core/fields'
import { documentFontFor, documentFontReplaced, drawnStyle, plainFontName } from '../src/core/fonts'
import type { DocumentFont, TextField, TextStyle } from '../src/core/model'
import { blobsOf, fromSnapshot, toSnapshot } from '../src/core/recovery'
import { baselineOf, onBaseline } from '../src/core/textLines'
import { buildPdf, type ExportFonts } from '../src/export/buildPdf'
import { cmapTable, prepareDocumentFont, rebuildFont, spaceWidthOf } from '../src/export/documentFont'
import { safeFontkit } from '../src/export/safeFontkit'
import { loadFonts, readDisplayedText, singlePageDocument } from './helpers'

const FONT_DIR = join(resolve(__dirname, '..'), 'src/renderer/public/fonts')
const STANDARD_FONTS = `${join(resolve(__dirname, '..'), 'node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/')}/`
const SOURCE_TEXT = 'Hello World Привет'

let fonts: ExportFonts

beforeAll(async () => {
  fonts = await loadFonts()
})

/**
 * Carlito with only the letters of a text, as PDFs often carry a font. The library that
 * writes these pages loses letters of Carlito when it cuts it down itself.
 */
function carlitoWithOnly(data: Uint8Array, text: string): Uint8Array {
  const font = fontkit.create(data)
  const glyphs = new Map<number, number>()
  for (const character of text) glyphs.set(character.codePointAt(0)!, font.glyphForCodePoint(character.codePointAt(0)!).id)
  return rebuildFont(data, cmapTable(glyphs))
}

/** A page with a line of text in Carlito, embedded whole as office programs often write, or with only its letters. */
async function pageInCarlito(cutDown = false): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  document.registerFontkit(safeFontkit)
  const carlito = new Uint8Array(await readFile(join(FONT_DIR, 'Carlito-Regular.ttf')))
  const font = await document.embedFont(cutDown ? carlitoWithOnly(carlito, SOURCE_TEXT) : carlito, { subset: false })
  document.addPage([595, 842]).drawText(SOURCE_TEXT, { x: 50, y: 780, size: 14, font })
  return document.save()
}

/** The font of the page's first text, as the PDF viewer rebuilds it for the screen. */
async function viewerFont(bytes: Uint8Array): Promise<{ data: Uint8Array; loadedName: string; spaceWidth?: number }> {
  const pdf = await getDocument({
    data: bytes.slice(),
    standardFontDataUrl: STANDARD_FONTS,
    useSystemFonts: false,
    fontExtraProperties: true,
    verbosity: 0
  }).promise
  const page = await pdf.getPage(1)
  const content = await page.getTextContent()
  const item = content.items.find((candidate) => 'str' in candidate && candidate.str.trim() !== '')
  await page.getOperatorList()
  const fontName = (item as { fontName: string }).fontName
  const font = page.commonObjs.get(fontName) as {
    data: Uint8Array
    loadedName: string
    composite?: boolean
    widths?: unknown
  }
  return { data: font.data, loadedName: font.loadedName, spaceWidth: spaceWidthOf(font) }
}

const usingDocumentFont: TextStyle = {
  bold: false,
  italic: false,
  color: { r: 0, g: 0, b: 0 },
  documentFont: 'f1',
  useDocumentFont: true
}

function textField(value: string, style: TextStyle): TextField {
  return { ...newTextField('t1'), x: 50, y: 200, width: 300, height: 20, value, fontSize: 14, style }
}

/** The names of the fonts a page of a PDF draws with. */
async function pageFontNames(bytes: Uint8Array): Promise<string[]> {
  const document = await PDFDocument.load(bytes)
  const resources = document.getPage(0).node.Resources()
  const fontDict = resources?.lookupMaybe(PDFName.of('Font'), PDFDict)
  if (!fontDict) return []
  return fontDict.keys().map((key) => {
    const font = fontDict.lookup(key, PDFDict)
    return plainFontName(font.lookup(PDFName.of('BaseFont'))!.toString().slice(1))
  })
}

describe('prepareDocumentFont', () => {
  let font: DocumentFont

  beforeAll(async () => {
    const { data, spaceWidth } = await viewerFont(await pageInCarlito())
    font = prepareDocumentFont(data, { bold: false, italic: false, spaceWidth })!
  })

  it('reads the font the viewer rebuilt from the page', () => {
    expect(font).not.toBeNull()
    expect(font.ascent).toBeGreaterThan(0.5)
    expect(font.descent).toBeGreaterThan(0.1)
  })

  it('keeps the letters by their Unicode code points alone', () => {
    for (const character of SOURCE_TEXT) expect(font.codePoints).toContain(character.codePointAt(0))
    expect(font.codePoints.some((codePoint) => codePoint >= 0xe000 && codePoint <= 0xf8ff)).toBe(false)
    const rebuilt = fontkit.create(font.bytes)
    expect(rebuilt.characterSet.some((codePoint) => codePoint >= 0xe000 && codePoint <= 0xf8ff)).toBe(false)
    expect(rebuilt.glyphForCodePoint('W'.codePointAt(0)!).id).not.toBe(0)
  })

  it('finds the space again, which the viewer leaves out, at the width of Carlito’s', () => {
    const rebuilt = fontkit.create(font.bytes)
    const space = rebuilt.glyphForCodePoint(0x20)
    expect(space.id).not.toBe(0)
    expect(space.advanceWidth / rebuilt.unitsPerEm).toBeCloseTo(0.226, 2)
    expect(rebuilt.glyphForCodePoint(0xa0).id).toBe(space.id)
  })

  it('can draw every letter of the page with a font cut down to them', async () => {
    const { data, spaceWidth } = await viewerFont(await pageInCarlito(true))
    const subset = prepareDocumentFont(data, { bold: false, italic: false, spaceWidth })!
    const missing = [...SOURCE_TEXT].filter((character) => !subset.codePoints.includes(character.codePointAt(0)!))
    expect(missing).toEqual([])
  })

  it('gives up a font it cannot read', () => {
    expect(prepareDocumentFont(new Uint8Array([1, 2, 3, 4]), { bold: false, italic: false })).toBeNull()
  })

  it('goes by the name the PDF gives a font', async () => {
    const data = new Uint8Array(await readFile(join(FONT_DIR, 'Carlito-Regular.ttf')))
    expect(prepareDocumentFont(data, { bold: false, italic: false, name: 'ABCDEF+Calibri' })?.name).toBe('Calibri')
    expect(prepareDocumentFont(data, { bold: false, italic: false, name: 'ArialMT' })).toBeNull()
  })

  it('takes the width of a space from a font of one byte per character', () => {
    expect(spaceWidthOf({ composite: false, widths: { 32: 250 } })).toBe(0.25)
    expect(spaceWidthOf({ composite: true, widths: { 32: 250 } })).toBeUndefined()
    expect(spaceWidthOf({ composite: false, widths: {} })).toBeUndefined()
  })

  it('leaves to the app a font it has a twin of, which the viewer may only have stood in for', async () => {
    const data = new Uint8Array(await readFile(join(FONT_DIR, 'LiberationSans-Regular.ttf')))
    expect(prepareDocumentFont(data, { bold: false, italic: false })).toBeNull()
  })

  it('writes new text that a PDF reader finds as typed, in the font of the document', async () => {
    const source = await pageInCarlito()
    const field = textField('Hello Привет World', usingDocumentFont)
    const document = { ...singlePageDocument(source, [field]), fonts: { f1: font } }
    const { bytes, missingCharacters } = await buildPdf(document, fonts)
    expect(missingCharacters).toEqual([])
    const texts = (await readDisplayedText(bytes)).map((item) => item.text)
    expect(texts.join(' ')).toContain('Hello Привет World')
    // The app's own font for this text would be Liberation Sans.
    expect((await pageFontNames(bytes)).some((name) => name.startsWith('LiberationSans'))).toBe(false)
  })

  it('writes in the app’s font a text with a letter the document’s font lacks', async () => {
    const source = await pageInCarlito()
    const lacking: DocumentFont = { ...font, codePoints: font.codePoints.filter((codePoint) => codePoint !== 0x5a) }
    const field = textField('Zoo', usingDocumentFont)
    const document = { ...singlePageDocument(source, [field]), fonts: { f1: lacking } }
    const { bytes } = await buildPdf(document, fonts)
    expect((await readDisplayedText(bytes)).map((item) => item.text).join(' ')).toContain('Zoo')
    expect((await pageFontNames(bytes)).some((name) => name.startsWith('LiberationSans'))).toBe(true)
  })
})

describe('baselineOf', () => {
  it('moves a field so its text stays on its baseline in another font and size', () => {
    const font: DocumentFont = {
      name: 'Tall',
      bytes: new Uint8Array(),
      ascent: 1.1,
      descent: 0.3,
      bold: false,
      italic: false,
      codePoints: [...'Hello'].map((character) => character.codePointAt(0)!)
    }
    const before = textField('Hello', { bold: false, italic: false, color: { r: 0, g: 0, b: 0 } })
    const baseline = baselineOf(before)
    const after = onBaseline({ ...before, fontSize: 20, style: usingDocumentFont }, baseline, { f1: font })
    expect(baselineOf(after, { f1: font })).toBeCloseTo(baseline, 6)
    expect(after.x).toBe(before.x)
    expect(after.y).not.toBeCloseTo(before.y, 1)
  })
})

describe('documentFontFor', () => {
  const font: DocumentFont = {
    name: 'Verdana',
    bytes: new Uint8Array(),
    ascent: 0.9,
    descent: 0.2,
    bold: false,
    italic: false,
    codePoints: [...'Helo Wrd'].map((character) => character.codePointAt(0)!)
  }

  it('gives the font while it has every letter of the text', () => {
    expect(documentFontFor(usingDocumentFont, 'Hello\nWorld', { f1: font })).toBe(font)
    expect(documentFontFor(usingDocumentFont, 'Hello World', { f1: font })).toBe(font)
    expect(documentFontFor(usingDocumentFont, 'Help', { f1: font })).toBeUndefined()
  })

  it('gives nothing to a field that does not use it', () => {
    expect(documentFontFor({ ...usingDocumentFont, useDocumentFont: false }, 'Hello', { f1: font })).toBeUndefined()
    expect(documentFontFor(usingDocumentFont, 'Hello', {})).toBeUndefined()
    expect(documentFontFor(undefined, 'Hello', { f1: font })).toBeUndefined()
  })

  it('says when the font is given up, and draws with the family then', () => {
    expect(documentFontReplaced(usingDocumentFont, 'Help', { f1: font })).toBe(true)
    expect(documentFontReplaced(usingDocumentFont, 'Hello', { f1: font })).toBe(false)
    expect(drawnStyle(usingDocumentFont, 'Help', { f1: font })?.useDocumentFont).toBe(false)
    expect(drawnStyle(usingDocumentFont, 'Hello', { f1: font })).toBe(usingDocumentFont)
  })

  it('reads a font name without its subset tag', () => {
    expect(plainFontName('ABCDEF+Verdana-Bold')).toBe('Verdana-Bold')
    expect(plainFontName('Verdana')).toBe('Verdana')
  })
})

describe('rebuildFont', () => {
  it('maps characters to the glyphs given, and nothing else', async () => {
    const data = new Uint8Array(await readFile(join(FONT_DIR, 'LiberationSans-Regular.ttf')))
    const original = fontkit.create(data)
    const glyphs = new Map<number, number>()
    for (const character of 'ABCacbЖ€') {
      const codePoint = character.codePointAt(0)!
      glyphs.set(codePoint, original.glyphForCodePoint(codePoint).id)
    }
    const rebuilt = fontkit.create(rebuildFont(data, cmapTable(glyphs)))
    expect(rebuilt.characterSet.sort((a, b) => a - b)).toEqual([...glyphs.keys()].sort((a, b) => a - b))
    for (const [codePoint, glyph] of glyphs) expect(rebuilt.glyphForCodePoint(codePoint).id).toBe(glyph)
    expect(rebuilt.unitsPerEm).toBe(original.unitsPerEm)
  })
})

describe('recovery', () => {
  it('keeps the fonts of a document', async () => {
    const font: DocumentFont = {
      name: 'Verdana',
      bytes: new Uint8Array([7, 8, 9]),
      ascent: 0.9,
      descent: 0.2,
      bold: true,
      italic: false,
      codePoints: [65, 66]
    }
    const document = { ...singlePageDocument(new Uint8Array([1]), []), fonts: { f1: font } }
    const snapshot = JSON.parse(JSON.stringify(toSnapshot(document, '2026-11-15T10:00:00Z')))
    const back = fromSnapshot(snapshot, blobsOf(document))
    expect(back?.fonts?.f1).toEqual(font)
  })
})
