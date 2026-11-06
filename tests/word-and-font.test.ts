import fontkit from '@pdf-lib/fontkit'
import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { closestFamily, faceOf, familyInfo, FONT_FACES, FONT_FAMILIES, type FontFamily } from '../src/core/fonts'
import type { TextField } from '../src/core/model'
import { fieldForLine, inkColumns, inkSpan, overlapsAny, toTextWords, type PageTextRun } from '../src/core/textLines'
import { buildPdf, type ExportFonts } from '../src/export/buildPdf'
import { loadFonts, makePage, readDisplayedText, renderPage, singlePageDocument } from './helpers'

/** Every letter is 6 points wide at size 12. */
const measure = (text: string, size: number) => (text.length * size) / 2
const run = (text: string, x: number, baseline = 100, fontName = 'f1'): PageTextRun => ({
  text,
  x,
  baseline,
  width: measure(text, 12),
  height: 12,
  fontName
})

describe('toTextWords', () => {
  it('finds each word of a run with its place', () => {
    const words = toTextWords([run('Hello big world', 10)], measure)
    expect(words.map(({ text, x, width }) => ({ text, x, width }))).toEqual([
      { text: 'Hello', x: 10, width: 30 },
      { text: 'big', x: 46, width: 18 },
      { text: 'world', x: 70, width: 30 }
    ])
  })

  it('scales places to the width the run really has', () => {
    const [, second] = toTextWords([{ ...run('aa bb', 0), width: 60 }], measure)
    expect(second!.x).toBeCloseTo(36)
    expect(second!.width).toBeCloseTo(24)
  })

  it('takes a word split over two runs as one word', () => {
    const words = toTextWords([run('Hel', 10), run('lo world', 28)], measure)
    expect(words.map((word) => word.text)).toEqual(['Hello', 'world'])
    expect(words[0]!.width).toBe(30)
  })

  it('keeps apart words of two runs with a gap between them', () => {
    expect(toTextWords([run('one', 10), run('two', 40)], measure).map((word) => word.text)).toEqual(['one', 'two'])
  })

  it('tells each word which line it stands in', () => {
    const words = toTextWords([run('left part', 10), run('other column', 300), run('next line', 10, 120)], measure)
    expect(words.find((word) => word.text === 'part')!.line.text).toBe('left part')
    expect(words.find((word) => word.text === 'column')!.line.text).toBe('other column')
    expect(words.find((word) => word.text === 'next')!.line.baseline).toBe(120)
  })

  it('keeps numbers and dates whole', () => {
    expect(toTextWords([run('am 15.10.2026, Berlin', 10)], measure).map((word) => word.text)).toEqual([
      'am',
      '15.10.2026,',
      'Berlin'
    ])
  })
})

describe('inkSpan', () => {
  /** Columns from a picture: # is ink. */
  const columns = (picture: string) => Array.from(picture, (mark) => mark === '#')

  it('takes letters as one word across their small gaps, and stops at a word gap', () => {
    //                        word one   word two   word three
    const row = columns('###.##.###.....##.###.##.....####')
    expect(inkSpan(row, 15, 24, 3)).toEqual([15, 24])
  })

  it('corrects an expected place that is off by a few columns', () => {
    const row = columns('####.....#####.....####')
    expect(inkSpan(row, 7, 12, 3)).toEqual([9, 14])
  })

  it('does not take a neighbour in because its edge is in the range', () => {
    const row = columns('#####....#####....#####')
    expect(inkSpan(row, 3, 16, 3)).toEqual([9, 14])
  })

  it('gives nothing where there is no ink', () => {
    expect(inkSpan(columns('.........'), 2, 6, 3)).toBeNull()
    expect(inkSpan(columns('##.......'), 4, 8, 3)).toBeNull()
  })
})

describe('inkColumns', () => {
  it('marks columns where something stands out from the background', () => {
    const white = [255, 255, 255, 255]
    const black = [0, 0, 0, 255]
    const pixels = [...white, ...black, ...white, ...white, ...white, ...black]
    expect(inkColumns(pixels, 3, 2, { r: 255, g: 255, b: 255 })).toEqual([false, true, true])
  })
})

describe('overlapsAny', () => {
  const box = { x: 10, y: 10, width: 10, height: 10 }

  it('tells overlapping areas from separate ones', () => {
    expect(overlapsAny(box, [{ x: 15, y: 15, width: 10, height: 10 }])).toBe(true)
    expect(overlapsAny(box, [{ x: 30, y: 10, width: 10, height: 10 }])).toBe(false)
    expect(overlapsAny(box, [])).toBe(false)
  })
})

describe('closestFamily', () => {
  /** Calibri-like text is narrower than Arial-like text. */
  const widths = (text: string, size: number, style?: { family?: FontFamily }) =>
    (text.length * size * (style?.family === 'calibri' ? 0.45 : 0.5))
  const look = { bold: false, italic: false }

  it('picks by the width the line has', () => {
    const line = { text: 'x'.repeat(100), height: 10 }
    expect(closestFamily({ ...line, width: 500 }, look, 'sans-serif', widths)).toBe('arial')
    expect(closestFamily({ ...line, width: 451 }, look, 'sans-serif', widths)).toBe('calibri')
  })

  it('goes by the kind of font when it says serif or monospace', () => {
    const line = { text: 'x'.repeat(100), height: 10, width: 451 }
    expect(closestFamily(line, look, 'serif', widths)).toBe('times')
    expect(closestFamily(line, look, 'monospace', widths)).toBe('courier')
  })

  it('takes an unknown kind as sans', () => {
    expect(closestFamily({ text: 'xx', height: 10, width: 10 }, look, undefined, widths)).toBe('arial')
  })
})

describe('faces', () => {
  it('match bold and italic', () => {
    expect(faceOf(undefined)).toBe('Regular')
    expect(faceOf({ bold: true, italic: false })).toBe('Bold')
    expect(faceOf({ bold: false, italic: true })).toBe('Italic')
    expect(faceOf({ bold: true, italic: true })).toBe('BoldItalic')
  })
})

describe('a field in another family', () => {
  let fonts: ExportFonts

  beforeAll(async () => {
    fonts = await loadFonts()
  })

  /**
   * Reading the text back cannot catch letters that are in the file but not drawn,
   * which is how a badly cut-down font fails. So every letter is looked for in pixels.
   */
  describe.each(FONT_FAMILIES)('draws every letter in $id', ({ id: family }) => {
    it.each(FONT_FACES)('%s', async (face) => {
      const text = 'АБЖЗЫЯабжзыяёъь ÄÖÜäöüß 0123456789 Times,.-'
      const style = {
        bold: face === 'Bold' || face === 'BoldItalic',
        italic: face === 'Italic' || face === 'BoldItalic',
        color: { r: 0, g: 0, b: 0 },
        family
      }
      const fontSize = 16
      const field: TextField = { id: 'f', type: 'TEXT', x: 20, y: 100, width: 550, height: 20, background: 'transparent', value: text, fontSize, style }
      const { bytes, missingCharacters } = await buildPdf(singlePageDocument(await makePage(), [field]), fonts)
      expect(missingCharacters).toEqual([])

      const font = fontkit.create(fonts.text[family][face])
      const scale = 3
      const rendered = await renderPage(bytes, 1, scale)
      let x = 20
      const blank: string[] = []
      for (const character of text) {
        const advance = (font.layout(character).advanceWidth / font.unitsPerEm) * fontSize
        let ink = 0
        for (let px = x; px < x + advance; px += 1 / scale) {
          for (let py = 100; py < 100 + fontSize * 1.2; py += 1 / scale) {
            if (rendered.colorAt(px, py)[0] < 128) ink++
          }
        }
        if (character !== ' ' && ink === 0) blank.push(character)
        x += advance
      }
      expect(blank).toEqual([])
    })
  })

  it.each(FONT_FAMILIES)('$id prints a no-break space as a space', async ({ id: family }) => {
    const field: TextField = {
      ...fieldForLine('f', { text: 'x', x: 50, baseline: 200, width: 40, height: 12 }, {
        style: { bold: false, italic: false, color: { r: 0, g: 0, b: 0 }, family },
        background: { r: 255, g: 255, b: 255 }
      }),
      value: '10 000 Euro'
    }
    const { bytes, missingCharacters } = await buildPdf(singlePageDocument(await makePage(), [field]), fonts)
    expect(missingCharacters).toEqual([])
    const text = (await readDisplayedText(bytes)).map((item) => item.text).join(' ')
    expect(text.replace(/\s+/g, ' ')).toBe('10 000 Euro')
  })

  it('keeps the file a reasonable size with whole fonts', async () => {
    const sizes: Record<string, number> = {}
    for (const { id: family } of FONT_FAMILIES) {
      const field: TextField = {
        ...fieldForLine('f', { text: 'x', x: 50, baseline: 200, width: 40, height: 12 }, {
          style: { bold: false, italic: false, color: { r: 0, g: 0, b: 0 }, family },
          background: { r: 255, g: 255, b: 255 }
        }),
        value: 'Текст'
      }
      sizes[family] = (await buildPdf(singlePageDocument(await makePage(), [field]), fonts)).bytes.length
    }
    for (const size of Object.values(sizes)) expect(size).toBeLessThan(1_500_000)
  })

  const embedded = async (bytes: Uint8Array) => {
    const document = await PDFDocument.load(bytes)
    return document.context.enumerateIndirectObjects().flatMap(([, object]) => {
      if (!(object instanceof PDFDict) || !object.has(PDFName.of('DescendantFonts'))) return []
      const name = object.lookup(PDFName.of('BaseFont'))
      return name instanceof PDFName ? [name.decodeText().replace(/-\d+$/, '')] : []
    })
  }

  it.each<[FontFamily, string]>([
    ['arial', 'LiberationSans'],
    ['times', 'Tinos-Regular'],
    ['calibri', 'Carlito-Regular'],
    ['courier', 'Cousine-Regular']
  ])('%s is drawn in its font, with Cyrillic', async (family, expected) => {
    const line = { text: 'x', x: 50, baseline: 200, width: 40, height: 12 }
    const field: TextField = {
      ...fieldForLine('f', line, {
        style: { bold: false, italic: false, color: { r: 0, g: 0, b: 0 }, family },
        background: { r: 255, g: 255, b: 255 }
      }),
      value: 'Жёлтый'
    }
    const { bytes, missingCharacters } = await buildPdf(singlePageDocument(await makePage(), [field]), fonts)
    expect(missingCharacters).toEqual([])
    expect(await embedded(bytes)).toEqual([expected])
    const [item] = await readDisplayedText(bytes)
    expect(item!.text).toBe('Жёлтый')
    // The baseline of the original stays, whatever the family.
    expect(item!.y).toBeCloseTo(200, 1)
    expect(item!.x).toBeCloseTo(50, 1)
    expect(familyInfo(family).baseline).toBeGreaterThan(0.8)
  })
})
