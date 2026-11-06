import fontkit from '@pdf-lib/fontkit'
import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib'
import { fitTextField, newTextField, type MeasureText } from '../src/core/fields'
import type { TextField, TextStyle } from '../src/core/model'
import { rotatePageClockwise } from '../src/core/pageOperations'
import { fieldForLine, fontLook, inkAndBackground, toTextLines } from '../src/core/textLines'
import { buildPdf, type ExportFonts } from '../src/export/buildPdf'
import { pageTextLines, type ContentPage } from '../src/export/extractContent'
import { loadFonts, openPdf, readDisplayedText, renderPage, singlePageDocument } from './helpers'

const RED = { r: 200, g: 0, b: 0 }
const WHITE = { r: 255, g: 255, b: 255 }
const YELLOW = { r: 255, g: 240, b: 150 }

function pixels(entries: [{ r: number; g: number; b: number }, number][]): number[] {
  return entries.flatMap(([{ r, g, b }, count]) => Array.from({ length: count }, () => [r, g, b, 255]).flat())
}

describe('inkAndBackground', () => {
  it('finds black text on white', () => {
    const black = { r: 0, g: 0, b: 0 }
    expect(inkAndBackground(pixels([[WHITE, 100], [black, 20]]))).toEqual({ ink: black, background: WHITE })
  })

  it('finds coloured text on a coloured background', () => {
    expect(inkAndBackground(pixels([[YELLOW, 100], [RED, 20]]))).toEqual({ ink: RED, background: YELLOW })
  })

  it('finds light text on a dark background', () => {
    const dark = { r: 20, g: 30, b: 80 }
    expect(inkAndBackground(pixels([[dark, 100], [WHITE, 30]]))).toEqual({ ink: WHITE, background: dark })
  })

  it('takes the solid colour, not the many blended ones at the edges of letters', () => {
    const blended = { r: 228, g: 128, b: 128 }
    const lighter = { r: 240, g: 190, b: 190 }
    const { ink } = inkAndBackground(pixels([[WHITE, 100], [lighter, 30], [blended, 30], [RED, 10]]))
    expect(ink).toEqual(RED)
  })

  it('falls back to black when nothing stands out', () => {
    const near = { r: 250, g: 250, b: 250 }
    expect(inkAndBackground(pixels([[WHITE, 100], [near, 20]])).ink).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('copes with no pixels', () => {
    expect(inkAndBackground([])).toEqual({ ink: { r: 0, g: 0, b: 0 }, background: WHITE })
  })
})

describe('fontLook', () => {
  it.each([
    ['ABCDEE+Arial-BoldMT', true, false],
    ['ABCDEE+Calibri-Bold', true, false],
    ['TimesNewRomanPS-BoldItalicMT', true, true],
    ['Helvetica-Oblique', false, true],
    ['Roboto-Black', true, false],
    ['ArialMT', false, false],
    ['Calibri', false, false]
  ])('reads the name %s', (name, bold, italic) => {
    expect(fontLook({ name })).toEqual({ bold, italic })
  })

  it('trusts what the file states without a telling name', () => {
    expect(fontLook({ name: 'F1', bold: true })).toEqual({ bold: true, italic: false })
    expect(fontLook({ name: 'F1', black: true })).toEqual({ bold: true, italic: false })
    expect(fontLook({ name: 'F1', italic: true })).toEqual({ bold: false, italic: true })
  })

  it('knows nothing without a font', () => {
    expect(fontLook(null)).toEqual({ bold: false, italic: false })
  })
})

describe('the font of a line', () => {
  const run = (text: string, x: number, fontName: string) => ({ text, x, baseline: 100, width: text.length * 6, height: 12, fontName })

  it('is the one most of the line is in', () => {
    const lines = toTextLines([run('Имя:', 10, 'bold'), run('Анна Мария Иванова', 40, 'regular')])
    expect(lines).toHaveLength(1)
    expect(lines[0]!.fontName).toBe('regular')
  })
})

describe('a field keeping the look of its line', () => {
  const style: TextStyle = { bold: true, italic: false, color: RED }

  it('takes style and background from the line', () => {
    const line = { text: 'x', x: 10, baseline: 100, width: 50, height: 12 }
    const field = fieldForLine('f', line, { style, background: YELLOW })
    expect(field.style).toEqual(style)
    expect(field.cover?.color).toEqual(YELLOW)
  })

  it('is measured in its own font', () => {
    const seen: unknown[] = []
    const measure: MeasureText = (_text, _size, look) => {
      seen.push(look)
      return 10
    }
    fitTextField({ ...newTextField('f'), style, value: 'x' }, measure, { width: 100, height: 100 })
    expect(seen).toEqual([style])
  })

  it('keeps its background colour when the page turns', () => {
    const line = { text: 'x', x: 10, baseline: 100, width: 50, height: 12 }
    const field = fieldForLine('f', line, { style, background: YELLOW })
    const document = singlePageDocument(new Uint8Array(), [field])
    rotatePageClockwise(document, 'p1', { width: 595, height: 842 })
    expect((document.pages[0]!.fields[0] as TextField).cover?.color).toEqual(YELLOW)
  })
})

describe('the saved file', () => {
  let fonts: ExportFonts

  beforeAll(async () => {
    fonts = await loadFonts()
  })

  async function page(): Promise<Uint8Array> {
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.HelveticaBold)
    const pdfPage = document.addPage([595, 842])
    pdfPage.drawRectangle({ x: 0, y: 680, width: 595, height: 50, color: rgb(1, 240 / 255, 150 / 255) })
    pdfPage.drawText('Heading line', { x: 60, y: 700, font, size: 20, color: rgb(200 / 255, 0, 0) })
    return document.save()
  }

  const exported = async (look: TextStyle | undefined, background = YELLOW) => {
    const bytes = await page()
    const pdf = await openPdf(bytes)
    const [line] = await pageTextLines((await pdf.getPage(1)) as unknown as ContentPage, 0)
    const field = { ...fieldForLine('f', line!, look ? { style: look, background } : undefined), value: 'Новая Строка' }
    return (await buildPdf(singlePageDocument(bytes, [field]), fonts)).bytes
  }

  /** The fonts the file embeds for what was added. The source's own font stays in it too. */
  const fontNamesOf = async (bytes: Uint8Array) => {
    const document = await PDFDocument.load(bytes)
    return document.context.enumerateIndirectObjects().flatMap(([, object]) => {
      if (!(object instanceof PDFDict)) return []
      const name = object.lookup(PDFName.of('BaseFont'))
      const decoded = name instanceof PDFName ? name.decodeText() : ''
      return decoded.includes('Liberation') && object.has(PDFName.of('DescendantFonts')) ? [decoded] : []
    })
  }

  it.each<[boolean, boolean, string]>([
    [false, false, 'LiberationSans'],
    [true, false, 'LiberationSans-Bold'],
    [false, true, 'LiberationSans-Italic'],
    [true, true, 'LiberationSans-BoldItalic']
  ])('draws bold %s, italic %s in the matching font', async (bold, italic, expected) => {
    const names = await fontNamesOf(await exported({ bold, italic, color: RED }))
    expect(names).toHaveLength(1)
    expect(names[0]!.replace(/-\d+$/, '')).toBe(expected)
  })

  it('all of these fonts carry Cyrillic and German letters', () => {
    for (const family of Object.values(fonts.text)) {
      for (const bytes of Object.values(family)) {
        const font = fontkit.create(bytes)
        expect(font.hasGlyphForCodePoint('Ж'.codePointAt(0)!)).toBe(true)
        expect(font.hasGlyphForCodePoint('ß'.codePointAt(0)!)).toBe(true)
      }
    }
  })

  it('draws the text in its colour, over a patch in the colour behind it', async () => {
    const rendered = await renderPage(await exported({ bold: true, italic: false, color: RED }))
    const seen = new Set<string>()
    for (let x = 60; x < 200; x += 0.5) {
      for (let y = 842 - 716; y < 842 - 700; y += 0.5) seen.add(rendered.colorAt(x, y).join(','))
    }
    expect(seen).toContain('200,0,0')
    // The patch does not show: right past the new text, beyond where the old one ended, it is all background.
    expect(rendered.colorAt(58, 842 - 708)).toEqual([255, 240, 150])
  })

  it('a field without a look stays black and regular on white, as before', async () => {
    const bytes = await exported(undefined)
    expect((await fontNamesOf(bytes))[0]!.replace(/-\d+$/, '')).toBe('LiberationSans')
    expect((await readDisplayedText(bytes)).map((item) => item.text)).toContain('Новая Строка')
  })
})
