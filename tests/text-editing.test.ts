import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import fontkit from '@pdf-lib/fontkit'
import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import { LINE_HEIGHT } from '../src/core/fields'
import { familyInfo, FONT_FACES, FONT_FAMILIES } from '../src/core/fonts'
import type { EditorDocument, Rotation, TextField } from '../src/core/model'
import { rotatePageClockwise } from '../src/core/pageOperations'
import { coverOf, fieldForLine, toTextLines, type PageTextRun, type TextLine } from '../src/core/textLines'
import { buildPdf, type ExportFonts } from '../src/export/buildPdf'
import { extractMarkdown, pageTextLines, type ContentPage } from '../src/export/extractContent'
import { loadFonts, openPdf, readDisplayedText, renderPage, singlePageDocument } from './helpers'

const run = (text: string, x: number, baseline = 100, width = text.length * 6, height = 12): PageTextRun => ({
  text,
  x,
  baseline,
  width,
  height
})

describe('toTextLines', () => {
  it('joins the runs of a line, with spaces where there is a gap', () => {
    expect(toTextLines([run('мир', 60, 100, 20), run('Прив', 10, 100, 24), run('ет,', 34, 100, 18)])).toEqual([
      { text: 'Привет, мир', x: 10, baseline: 100, width: 70, height: 12 }
    ])
  })

  it('keeps lines apart, top to bottom', () => {
    expect(toTextLines([run('Ниже', 10, 120), run('Выше', 10, 100)]).map((line) => line.text)).toEqual(['Выше', 'Ниже'])
  })

  it('keeps columns apart', () => {
    const lines = toTextLines([run('Левая', 10, 100, 30), run('Правая', 300, 100, 36)])
    expect(lines.map((line) => line.text)).toEqual(['Левая', 'Правая'])
  })

  it('takes a slightly shifted run as the same line', () => {
    expect(toTextLines([run('a', 10, 100, 6), run('b', 16, 101, 6)])).toHaveLength(1)
  })

  it('skips what is only spaces', () => {
    expect(toTextLines([run('   ', 10)])).toEqual([])
  })
})

describe('a field for a line', () => {
  const line: TextLine = { text: 'Старый текст', x: 50, baseline: 200, width: 100, height: 20 }

  it('takes its text, size and place', () => {
    const field = fieldForLine('f', line)
    expect(field).toMatchObject({ type: 'TEXT', value: 'Старый текст', fontSize: 20, x: 50 })
    expect(field.y + 20 * familyInfo(undefined).baseline).toBeCloseTo(200)
    expect(field.cover).toEqual(coverOf(line))
  })

  it('covers the line from above its letters to below its descenders', () => {
    const cover = coverOf(line)
    expect(cover.x).toBeLessThan(50)
    expect(cover.x + cover.width).toBeGreaterThan(150)
    expect(cover.y).toBeLessThan(200 - 14)
    expect(cover.y + cover.height).toBeGreaterThan(200 + 4)
  })

  it.each(FONT_FAMILIES)('states the baseline the export really uses for $id', async ({ file, baseline }) => {
    for (const face of FONT_FACES) {
      const bytes = await readFile(join(resolve(__dirname, '..'), `src/renderer/public/fonts/${file}-${face}.ttf`))
      const font = fontkit.create(new Uint8Array(bytes))
      const ascent = font.ascent / font.unitsPerEm
      const descent = Math.abs(font.descent) / font.unitsPerEm
      expect(baseline).toBeCloseTo((LINE_HEIGHT - ascent - descent) / 2 + ascent, 3)
    }
  })
})

describe('editing a line of a real page', () => {
  let fonts: ExportFonts

  beforeAll(async () => {
    fonts = await loadFonts()
  })

  async function pdf(rotate: Rotation = 0): Promise<Uint8Array> {
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.Helvetica)
    const page = document.addPage([595, 842])
    page.drawText('Heading of the page', { x: 60, y: 760, font, size: 24 })
    page.drawText('The line to replace', { x: 60, y: 700, font, size: 14 })
    page.drawText('A line that stays', { x: 60, y: 660, font, size: 14 })
    page.drawText('Other column', { x: 400, y: 700, font, size: 14 })
    if (rotate) page.setRotation(degrees(rotate))
    return document.save()
  }

  const linesOf = async (bytes: Uint8Array, rotation: Rotation = 0) =>
    pageTextLines((await (await openPdf(bytes)).getPage(1)) as unknown as ContentPage, rotation)

  it('finds the lines of the page with their sizes', async () => {
    const lines = await linesOf(await pdf())
    expect(lines.map((line) => line.text)).toEqual([
      'Heading of the page',
      'The line to replace',
      'Other column',
      'A line that stays'
    ])
    expect(lines[0]!.height).toBeCloseTo(24)
    expect(lines[1]!).toMatchObject({ x: 60, baseline: 842 - 700 })
  })

  it.each<[Rotation]>([[0], [180]])('finds upright lines on a page turned %i degrees only when they read across', async (rotation) => {
    const lines = await linesOf(await pdf(), rotation)
    expect(lines.length).toBe(rotation === 0 ? 4 : 0)
  })

  it('finds lines on a page the file itself turns upright', async () => {
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.Helvetica)
    const page = document.addPage([842, 595])
    page.drawText('Across the turned page', { x: 100, y: 100, font, size: 14, rotate: degrees(90) })
    page.setRotation(degrees(90))
    const lines = await linesOf(await document.save())
    expect(lines.map((line) => line.text)).toEqual(['Across the turned page'])
  })

  async function exportEdited(value: string, change: (field: TextField, document: EditorDocument) => void = () => undefined) {
    const bytes = await pdf()
    const line = (await linesOf(bytes)).find((candidate) => candidate.text === 'The line to replace')!
    const field = { ...fieldForLine('f', line), value }
    const document = singlePageDocument(bytes, [field])
    change(field, document)
    return { document, output: (await buildPdf(document, fonts)).bytes }
  }

  const darkInBox = (page: Awaited<ReturnType<typeof renderPage>>, x: number, y: number, width: number, height: number) => {
    let count = 0
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        if (page.colorAt(x + dx, y + dy)[0] < 110) count++
      }
    }
    return count
  }

  it('prints the new text on the baseline of the old one', async () => {
    const { output } = await exportEdited('Новый текст')
    const item = (await readDisplayedText(output)).find((candidate) => candidate.text === 'Новый текст')!
    expect(item.x).toBeCloseTo(60, 1)
    expect(item.y).toBeCloseTo(842 - 700, 1)
  })

  it('paints the old text out where the new text is shorter, and leaves the rest of the page', async () => {
    const { output } = await exportEdited('Кратко')
    const page = await renderPage(output)
    // The old line is about 120 points long, the new one under 50.
    expect(darkInBox(page, 120, 842 - 712, 60, 16)).toBe(0)
    expect(darkInBox(page, 60, 842 - 672, 100, 16)).toBeGreaterThan(20)
    expect(darkInBox(page, 400, 842 - 712, 80, 16)).toBeGreaterThan(20)
    expect(darkInBox(page, 60, 842 - 782, 200, 26)).toBeGreaterThan(20)
  })

  it('removes the line from view when emptied', async () => {
    const { output } = await exportEdited('')
    expect(darkInBox(await renderPage(output), 58, 842 - 712, 130, 16)).toBe(0)
  })

  it('keeps the original when the field moves: the cover stays, the text goes', async () => {
    const { output } = await exportEdited('Перенесено', (field) => {
      field.y = 400
    })
    const page = await renderPage(output)
    expect(darkInBox(page, 58, 842 - 712, 130, 16)).toBe(0)
    expect(darkInBox(page, 60, 400, 80, 16)).toBeGreaterThan(20)
  })

  it('cannot hide another field with its cover', async () => {
    const { output } = await exportEdited('Новый', (field, document) => {
      document.pages[0]!.fields.unshift({
        id: 'other',
        type: 'TEXT',
        x: 100,
        y: field.y,
        width: 80,
        height: 16,
        background: 'transparent',
        value: 'Поверх',
        fontSize: 14
      })
    })
    const texts = (await readDisplayedText(output)).map((item) => item.text)
    expect(texts).toContain('Поверх')
    expect(darkInBox(await renderPage(output), 100, 842 - 712, 50, 16)).toBeGreaterThan(5)
  })

  it('turns the cover with the page', async () => {
    const { document } = await exportEdited('Новый')
    const before = (document.pages[0]!.fields[0] as TextField).cover!
    rotatePageClockwise(document, 'p1', { width: 595, height: 842 })
    const after = (document.pages[0]!.fields[0] as TextField).cover!
    expect(after.width).toBeCloseTo(before.height)
    expect(after.height).toBeCloseTo(before.width)
    expect(after.x).toBeCloseTo(842 - before.y - before.height)
    expect(after.y).toBeCloseTo(before.x)

    // In the file, the covered spot is the same content as before: the line is gone.
    const { bytes } = await buildPdf(document, fonts)
    const page = await renderPage(bytes)
    expect(darkInBox(page, after.x + 2, after.y + 40, after.width - 4, 80)).toBe(0)
  })

  it('leaves replaced lines out of the extracted text, with the new text in their place', async () => {
    const { document } = await exportEdited('Новый текст')
    const pdfFile = await openPdf(document.sources['s1']!.bytes)
    const markdown = await extractMarkdown(document, {}, { p1: { width: 595, height: 842 } }, async (_id, index) => {
      return (await pdfFile.getPage(index + 1)) as unknown as ContentPage
    })
    expect(markdown).toContain('Новый текст')
    expect(markdown).not.toContain('The line to replace')
    expect(markdown).toContain('A line that stays')
  })
})
