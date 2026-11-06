import { beforeAll, describe, expect, it } from 'vitest'
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib'
import { detectSpots, fieldsForSpots, type DetectedSpots } from '../src/core/detectFields'
import type { EditorDocument, OcrWord, Rotation } from '../src/core/model'
import { MIN_OCR_CONFIDENCE, ocrRuns, toOcrWords } from '../src/core/ocr'
import { fieldForLine } from '../src/core/textLines'
import { buildPdf, type ExportFonts } from '../src/export/buildPdf'
import { extractMarkdown, pageHasText, type ContentPage } from '../src/export/extractContent'
import { loadFonts, makePage, makeTwoColorPng, openPdf, renderPage, singlePageDocument } from './helpers'

const SCALE = 2
const PAGE = { width: 595, height: 842 }

/** A page picture to draw on, in points, as the mask detection reads. */
function canvas(width = PAGE.width, height = PAGE.height) {
  const w = width * SCALE
  const h = height * SCALE
  const mask = new Uint8Array(w * h)
  const fill = (x: number, y: number, width: number, height: number) => {
    for (let py = Math.round(y * SCALE); py < Math.round((y + height) * SCALE); py++) {
      for (let px = Math.round(x * SCALE); px < Math.round((x + width) * SCALE); px++) mask[py * w + px] = 1
    }
  }
  const line = (x: number, y: number, length: number, thickness = 1) => fill(x, y, length, thickness)
  const box = (x: number, y: number, width: number, height: number, wall = 1) => {
    fill(x, y, width, wall)
    fill(x, y + height - wall, width, wall)
    fill(x, y, wall, height)
    fill(x + width - wall, y, wall, height)
  }
  /** A block of ink standing in for a word. */
  const text = (x: number, y: number, width: number, height = 8) => {
    for (let dx = 0; dx < width; dx += 5) fill(x + dx, y, 3, height)
  }
  return { mask, w, h, line, box, text, fill, spots: () => detectSpots(mask, w, h, SCALE) }
}

describe('detectSpots', () => {
  it('finds a line to write on', () => {
    const page = canvas()
    page.line(100, 300, 200)
    const { lines, textBoxes, checkBoxes } = page.spots()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ x: 100, y: 300, width: 200 })
    expect(textBoxes).toEqual([])
    expect(checkBoxes).toEqual([])
  })

  it('does not take a short dash or a line with text on it', () => {
    const page = canvas()
    page.line(100, 200, 25)
    page.line(100, 300, 200)
    page.text(110, 289, 100)
    expect(page.spots().lines).toEqual([])
  })

  it('does not take a thick bar for a line', () => {
    const page = canvas()
    page.fill(100, 300, 200, 6)
    expect(page.spots().lines).toEqual([])
  })

  it('finds an empty small square as a place for a mark', () => {
    const page = canvas()
    page.box(100, 300, 12, 12)
    const { checkBoxes, lines, textBoxes } = page.spots()
    expect(checkBoxes).toHaveLength(1)
    expect(checkBoxes[0]).toMatchObject({ x: 100, y: 300, width: 12, height: 12 })
    expect(lines).toEqual([])
    expect(textBoxes).toEqual([])
  })

  it('finds an empty wide box as a place for text', () => {
    const page = canvas()
    page.box(100, 300, 250, 24)
    const { textBoxes, lines, checkBoxes } = page.spots()
    expect(textBoxes).toHaveLength(1)
    expect(textBoxes[0]).toMatchObject({ x: 100, y: 300, width: 250, height: 24 })
    expect(lines).toEqual([])
    expect(checkBoxes).toEqual([])
  })

  it('leaves a box with something in it', () => {
    const page = canvas()
    page.box(100, 300, 250, 24)
    page.text(110, 308, 100)
    page.box(400, 300, 12, 12)
    page.fill(404, 304, 4, 4)
    const { textBoxes, checkBoxes, lines } = page.spots()
    expect(textBoxes).toEqual([])
    expect(checkBoxes).toEqual([])
    // Its top edge has room above it, but it is still not a line to write on.
    expect(lines).toEqual([])
  })

  it('does not take the rules of a table for lines to write on', () => {
    const page = canvas()
    for (const y of [300, 330, 360]) page.line(100, y, 300)
    for (const x of [100, 250, 399]) page.fill(x, 300, 1, 61)
    page.text(110, 310, 100)
    page.text(260, 340, 100)
    expect(page.spots().lines).toEqual([])
  })

  it('does not take the closed bowl of a large letter for a box to mark', () => {
    const page = canvas()
    // An "o": flat top and bottom and curved sides, its corners are empty.
    page.fill(103, 300, 8, 1.5)
    page.fill(103, 311.5, 8, 1.5)
    page.fill(100, 303, 2, 7)
    page.fill(112, 303, 2, 7)
    page.fill(102, 301.5, 1.5, 1.5)
    page.fill(110.5, 301.5, 1.5, 1.5)
    page.fill(102, 310, 1.5, 1.5)
    page.fill(110.5, 310, 1.5, 1.5)
    expect(page.spots().checkBoxes).toEqual([])
  })

  it('does not take a closed part of a letter with something touching it', () => {
    const page = canvas()
    page.box(100, 300, 10, 10, 2)
    // The tail and ear of a "g", and a letter right beside it.
    page.fill(108, 310, 2, 6)
    page.fill(112, 298, 4, 14)
    expect(page.spots().checkBoxes).toEqual([])
  })

  it('finds several things on one page, each once', () => {
    const page = canvas()
    page.line(60, 100, 150)
    page.line(300, 100, 150)
    page.box(60, 200, 14, 14)
    page.box(90, 200, 14, 14)
    page.box(60, 300, 400, 80)
    const { lines, checkBoxes, textBoxes } = page.spots()
    expect(lines).toHaveLength(2)
    expect(checkBoxes).toHaveLength(2)
    expect(textBoxes).toHaveLength(1)
  })

  it('takes a scan with a slightly broken wall', () => {
    const page = canvas()
    page.box(100, 300, 14, 14)
    // A gap of a pixel in a wall.
    const offset = (Math.round(306 * SCALE)) * page.w + Math.round(100 * SCALE)
    page.mask[offset] = 0
    page.mask[offset + 1] = 0
    expect(page.spots().checkBoxes).toHaveLength(1)
  })

  it('finds nothing on an empty page', () => {
    expect(canvas().spots()).toEqual({ lines: [], textBoxes: [], checkBoxes: [] })
  })
})

describe('fieldsForSpots', () => {
  const measure = (text: string, size: number) => text.length * size * 0.5
  let counter = 0
  const newId = () => `f${counter++}`
  const empty: DetectedSpots = { lines: [], textBoxes: [], checkBoxes: [] }

  it('puts a text field sitting on a line', () => {
    const [field] = fieldsForSpots({ ...empty, lines: [{ x: 100, y: 300, width: 200, height: 1 }] }, [], PAGE, measure, newId)
    expect(field).toMatchObject({ type: 'TEXT', value: '', x: 101 })
    expect(field!.y + field!.height).toBeLessThanOrEqual(300)
    expect(field!.y + field!.height).toBeGreaterThan(298)
  })

  it('puts an empty mark in the middle of a square', () => {
    const [field] = fieldsForSpots({ ...empty, checkBoxes: [{ x: 100, y: 300, width: 14, height: 14 }] }, [], PAGE, measure, newId)
    expect(field).toMatchObject({ type: 'CHECKBOX', value: null })
    expect(field!.x + field!.width / 2).toBeCloseTo(107)
    expect(field!.y + field!.height / 2).toBeCloseTo(307)
  })

  it('fits the text in a low box', () => {
    const [field] = fieldsForSpots({ ...empty, textBoxes: [{ x: 100, y: 300, width: 200, height: 14 }] }, [], PAGE, measure, newId)
    expect(field!.y).toBeGreaterThanOrEqual(300)
    expect(field!.y + field!.height).toBeLessThanOrEqual(314)
  })

  it('leaves spots where something already is', () => {
    const spots = { ...empty, checkBoxes: [{ x: 100, y: 300, width: 14, height: 14 }] }
    expect(fieldsForSpots(spots, [{ x: 95, y: 295, width: 30, height: 30 }], PAGE, measure, newId)).toEqual([])
  })

  it('leaves spots that would stick out of the page', () => {
    const spots = { ...empty, lines: [{ x: 100, y: 3, width: 200, height: 1 }] }
    expect(fieldsForSpots(spots, [], PAGE, measure, newId)).toEqual([])
  })
})

describe('toOcrWords', () => {
  const word = (text: string, confidence = 90) => ({
    text,
    confidence,
    bbox: { x0: 100, y0: 200, x1: 200, y1: 240 },
    baseline: { x0: 0, y0: 236, x1: 1000, y1: 246 },
    rowHeight: 44
  })

  it('turns pixels into points', () => {
    const [result] = toOcrWords([word('Berlin')], 4)
    expect(result).toEqual({ text: 'Berlin', x: 25, y: 50, width: 25, height: 10, baseline: expect.any(Number), fontSize: 13.2 })
  })

  it('follows a slanted baseline to the word', () => {
    expect(toOcrWords([word('x')], 1)[0]!.baseline).toBeCloseTo(237)
  })

  it('drops doubtful and empty words', () => {
    expect(toOcrWords([word('шум', MIN_OCR_CONFIDENCE - 1), word('  '), word('ok')], 1).map((item) => item.text)).toEqual(['ok'])
  })

  it('takes the height of the word without a row height', () => {
    expect(toOcrWords([{ ...word('x'), rowHeight: undefined }], 2)[0]!.fontSize).toBe(20)
  })

  it('gives runs for editing', () => {
    const [run] = ocrRuns(toOcrWords([word('x')], 1))
    expect(run).toMatchObject({ text: 'x', x: 100, height: 52.8 })
    expect(ocrRuns(undefined)).toEqual([])
  })
})

describe('a scanned page with its text read', () => {
  let fonts: ExportFonts
  const words: OcrWord[] = [
    { text: 'Rechnung', x: 60, y: 90, width: 90, height: 16, baseline: 104, fontSize: 16 },
    { text: 'Счёт', x: 160, y: 90, width: 50, height: 16, baseline: 104, fontSize: 16 },
    { text: '12345', x: 60, y: 140, width: 60, height: 16, baseline: 154, fontSize: 16 }
  ]

  beforeAll(async () => {
    fonts = await loadFonts()
  })

  /** A one-page PDF that is only a picture. */
  async function scan(rotate: Rotation = 0): Promise<Uint8Array> {
    const document = await PDFDocument.create()
    const page = document.addPage([595, 842])
    page.drawImage(await document.embedPng(makeTwoColorPng()), { x: 0, y: 0, width: 595, height: 842 })
    if (rotate) page.setRotation(degrees(rotate))
    return document.save()
  }

  const itemsOf = async (bytes: Uint8Array) => {
    const { items } = await (await (await openPdf(bytes)).getPage(1)).getTextContent()
    return items.flatMap((item) => ('str' in item && item.str.trim() !== '' ? [item.str] : []))
  }

  const scanned = async (rotation: Rotation = 0) => {
    const bytes = await scan()
    const document = singlePageDocument(bytes, [], rotation)
    document.pages[0]!.ocr = words
    return document
  }

  it('knows a picture from a page with text', async () => {
    expect(await pageHasText((await (await openPdf(await scan())).getPage(1)) as unknown as ContentPage)).toBe(false)
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.Helvetica)
    document.addPage().drawText('Text', { font, x: 10, y: 10 })
    const withText = await document.save()
    expect(await pageHasText((await (await openPdf(withText)).getPage(1)) as unknown as ContentPage)).toBe(true)
  })

  it('saves a file that can be searched, without changing how it looks', async () => {
    const document = await scanned()
    const { bytes } = await buildPdf(document, fonts)
    expect(await itemsOf(bytes)).toEqual(['Rechnung', 'Счёт', '12345'])

    const before = await renderPage(await scan())
    const after = await renderPage(bytes)
    for (const [x, y] of [[70, 100], [100, 100], [170, 100], [80, 150], [300, 400]] as const) {
      expect(after.colorAt(x, y)).toEqual(before.colorAt(x, y))
    }
  })

  it.each<[Rotation]>([[90], [180], [270]])('keeps the words on the same content on a page turned %i degrees', async (rotation) => {
    const { bytes } = await buildPdf(await scanned(rotation), fonts)
    expect(await itemsOf(bytes)).toEqual(['Rechnung', 'Счёт', '12345'])
  })

  it('a word replaced by a field leaves the searchable text, the picture gets reported', async () => {
    const document = await scanned()
    const line = { text: '12345', x: 60, baseline: 154, width: 60, height: 16 }
    document.pages[0]!.fields = [{ ...fieldForLine('f', line), value: '67890' }]
    const { bytes, imagesUnderCovers } = await buildPdf(document, fonts)
    const items = await itemsOf(bytes)
    expect(items).toContain('67890')
    expect(items).not.toContain('12345')
    expect(imagesUnderCovers).toEqual([1])
  })

  it('extraction reads it, in reading order', async () => {
    const document: EditorDocument = await scanned()
    const pdf = await openPdf(document.sources['s1']!.bytes)
    const markdown = await extractMarkdown(document, {}, { p1: PAGE }, async (_id, index) => {
      return (await pdf.getPage(index + 1)) as unknown as ContentPage
    })
    expect(markdown).toBe('Rechnung Счёт\n\n12345')
  })

  it('a page without recognized text saves as it always did', async () => {
    const { bytes } = await buildPdf(singlePageDocument(await makePage(), []), fonts)
    expect(await itemsOf(bytes)).toEqual([])
  })
})
