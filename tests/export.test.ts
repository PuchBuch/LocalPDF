import { beforeAll, describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { LINE_HEIGHT, buildPdf, type ExportFonts } from '../src/export/buildPdf'
import type { EditorDocument, Field, Rotation } from '../src/core/model'
import { normalizeRotation } from '../src/core/geometry'
import {
  displayedPageSize,
  loadFonts,
  makeForm,
  makePage,
  makeTwoColorPng,
  readDisplayedText,
  renderPage,
  singlePageDocument
} from './helpers'

const ROTATIONS: Rotation[] = [0, 90, 180, 270]
const CROP = { x: 40, y: 60, width: 500, height: 700 }
// CSS line box baseline for Liberation Sans: half-leading plus ascent.
const SANS_ASCENT = 0.905
const SANS_DESCENT = 0.212
const baseline = (fontSize: number) => ((LINE_HEIGHT - SANS_ASCENT - SANS_DESCENT) / 2 + SANS_ASCENT) * fontSize

const textField = (overrides: Partial<Field> & { value?: string } = {}): Field => ({
  id: 'text',
  type: 'TEXT',
  x: 100,
  y: 150,
  width: 200,
  height: 24,
  background: 'transparent',
  value: 'Привет, Grüße',
  fontSize: 20,
  ...overrides
} as Field)

const isRed = ([r, g, b]: number[]) => r! > 200 && g! < 60 && b! < 60
const isBlue = ([r, g, b]: number[]) => r! < 60 && g! < 60 && b! > 200
const isWhite = ([r, g, b]: number[]) => r! > 240 && g! > 240 && b! > 240
const isDark = ([r, g, b]: number[]) => r! < 90 && g! < 90 && b! < 90

let fonts: ExportFonts

beforeAll(async () => {
  fonts = await loadFonts()
})

describe('text position', () => {
  // Every mix of the source's own /Rotate, a rotation in the editor and an offset crop box.
  const cases = ROTATIONS.flatMap((sourceRotate) =>
    ROTATIONS.flatMap((editorRotate) => [
      { sourceRotate, editorRotate, crop: undefined },
      { sourceRotate, editorRotate, crop: CROP }
    ])
  )

  it.each(cases)(
    'lands where it was placed: source $sourceRotate, editor $editorRotate, crop $crop',
    async ({ sourceRotate, editorRotate, crop }) => {
      const bytes = await makePage({ rotate: sourceRotate, ...(crop ? { crop } : {}) })
      const result = await buildPdf(singlePageDocument(bytes, [textField()], editorRotate), fonts)

      const [item] = await readDisplayedText(result.bytes)
      expect(item?.text).toBe('Привет, Grüße')
      expect(item?.x).toBeCloseTo(100, 1)
      expect(item?.y).toBeCloseTo(150 + baseline(20), 1)

      const total = normalizeRotation(sourceRotate + editorRotate)
      const size = await displayedPageSize(result.bytes)
      const base = crop ?? { width: 595, height: 842 }
      expect(size.width).toBeCloseTo(total % 180 === 0 ? base.width : base.height)
      expect(size.height).toBeCloseTo(total % 180 === 0 ? base.height : base.width)
    }
  )

  it('places each line of a multi-line field one line height apart', async () => {
    const bytes = await makePage()
    const field = textField({ value: 'Первая\nВторая' })
    const { bytes: output } = await buildPdf(singlePageDocument(bytes, [field]), fonts)

    const items = await readDisplayedText(output)
    expect(items.map((item) => item.text)).toEqual(['Первая', 'Вторая'])
    expect(items[1]!.y - items[0]!.y).toBeCloseTo(20 * LINE_HEIGHT, 1)
  })
})

describe('characters missing from the font', () => {
  it('are reported and left out instead of failing the export', async () => {
    const bytes = await makePage()
    const result = await buildPdf(singlePageDocument(bytes, [textField({ value: 'Да漢字' })]), fonts)

    expect(result.missingCharacters).toEqual([
      { fieldId: 'text', character: '漢' },
      { fieldId: 'text', character: '字' }
    ])
    const [item] = await readDisplayedText(result.bytes)
    expect(item?.text).toBe('Да')
  })
})

describe('comb text', () => {
  it('centres each character in its own cell', async () => {
    const bytes = await makePage()
    const field: Field = {
      id: 'comb',
      type: 'COMB_TEXT',
      x: 100,
      y: 200,
      width: 160,
      height: 20,
      background: 'transparent',
      value: 'ИНН42',
      fontSize: 10,
      spacing: 20
    }
    const { bytes: output } = await buildPdf(singlePageDocument(bytes, [field]), fonts)

    const items = await readDisplayedText(output)
    expect(items.map((item) => item.text).join('')).toBe('ИНН42')
    // Roboto Mono advances 0.6 em, so each 6 pt glyph sits 7 pt into its 20 pt cell.
    items.forEach((item, index) => expect(item.x).toBeCloseTo(100 + index * 20 + 7, 0))
  })
})

describe('images', () => {
  it.each(ROTATIONS)('stay upright and in place with an editor rotation of %i', async (rotation) => {
    const bytes = await makePage()
    const field: Field = {
      id: 'picture',
      type: 'PICTURE',
      x: 100,
      y: 200,
      width: 80,
      height: 40,
      background: 'transparent',
      assetId: 'a1'
    }
    const assets = { a1: { mime: 'image/png' as const, bytes: makeTwoColorPng() } }
    const { bytes: output } = await buildPdf(singlePageDocument(bytes, [field], rotation, assets), fonts)

    const page = await renderPage(output)
    expect(isRed(page.colorAt(120, 220))).toBe(true)
    expect(isBlue(page.colorAt(160, 220))).toBe(true)
    expect(isWhite(page.colorAt(90, 220))).toBe(true)
    expect(isWhite(page.colorAt(190, 220))).toBe(true)
  })

  it('stretch with a picture field of another shape', async () => {
    const bytes = await makePage()
    const field: Field = {
      id: 'picture',
      type: 'PICTURE',
      x: 100,
      y: 200,
      width: 80,
      height: 200,
      background: 'transparent',
      assetId: 'a1'
    }
    const assets = { a1: { mime: 'image/png' as const, bytes: makeTwoColorPng() } }
    const { bytes: output } = await buildPdf(singlePageDocument(bytes, [field], 0, assets), fonts)

    const page = await renderPage(output)
    expect(isRed(page.colorAt(120, 210))).toBe(true)
    expect(isBlue(page.colorAt(160, 390))).toBe(true)
  })

  it('keep their proportions inside a signature field of another shape', async () => {
    const bytes = await makePage()
    const field: Field = {
      id: 'picture',
      type: 'SIGNATURE',
      x: 100,
      y: 200,
      width: 80,
      height: 200,
      background: 'transparent',
      assetId: 'a1'
    }
    const assets = { a1: { mime: 'image/png' as const, bytes: makeTwoColorPng() } }
    const { bytes: output } = await buildPdf(singlePageDocument(bytes, [field], 0, assets), fonts)

    const page = await renderPage(output)
    // The 80x40 picture is centred vertically: 280..320 of the field's 200..400.
    expect(isRed(page.colorAt(120, 300))).toBe(true)
    expect(isWhite(page.colorAt(120, 270))).toBe(true)
    expect(isWhite(page.colorAt(120, 330))).toBe(true)
  })
})

describe('checkboxes', () => {
  const checkbox = (value: 'tick' | 'cross' | 'dot' | null): Field => ({
    id: 'check',
    type: 'CHECKBOX',
    x: 100,
    y: 200,
    width: 60,
    height: 60,
    background: 'transparent',
    value
  })

  it.each(ROTATIONS)('draw an upright tick with an editor rotation of %i', async (rotation) => {
    const bytes = await makePage()
    const { bytes: output } = await buildPdf(singlePageDocument(bytes, [checkbox('tick')], rotation), fonts)

    const page = await renderPage(output)
    // The tick's low point is near the bottom of the box, its top-left stays empty.
    expect(isDark(page.colorAt(100 + 24, 200 + 46.8))).toBe(true)
    expect(isWhite(page.colorAt(100 + 8, 200 + 8))).toBe(true)
  })

  it('draw a cross through the centre', async () => {
    const bytes = await makePage()
    const { bytes: output } = await buildPdf(singlePageDocument(bytes, [checkbox('cross')]), fonts)
    expect(isDark((await renderPage(output)).colorAt(130, 230))).toBe(true)
  })

  it.each(ROTATIONS)('draw a round dot in the centre with an editor rotation of %i', async (rotation) => {
    const bytes = await makePage()
    const { bytes: output } = await buildPdf(singlePageDocument(bytes, [checkbox('dot')], rotation), fonts)
    const page = await renderPage(output)
    // Filled in the middle and out to its radius of 24%, and clear beyond it and in the corners.
    expect(isDark(page.colorAt(130, 230))).toBe(true)
    expect(isDark(page.colorAt(130 + 11, 230))).toBe(true)
    expect(isDark(page.colorAt(130, 230 - 11))).toBe(true)
    expect(isWhite(page.colorAt(130 + 18, 230))).toBe(true)
    expect(isWhite(page.colorAt(130, 230 + 18))).toBe(true)
    expect(isWhite(page.colorAt(130 + 12, 230 + 12))).toBe(true)
  })

  it('draw nothing when empty', async () => {
    const bytes = await makePage()
    const { bytes: output } = await buildPdf(singlePageDocument(bytes, [checkbox(null)]), fonts)
    const page = await renderPage(output)
    expect(isWhite(page.colorAt(130, 230))).toBe(true)
    expect(isWhite(page.colorAt(124, 246.8))).toBe(true)
  })
})

describe('white background', () => {
  it.each(ROTATIONS)('covers the field area with an editor rotation of %i', async (rotation) => {
    const bytes = await makePage({ blackBackground: true })
    const field = textField({ value: '', background: 'white', x: 100, y: 150, width: 200, height: 50 })
    const { bytes: output } = await buildPdf(singlePageDocument(bytes, [field], rotation), fonts)

    const page = await renderPage(output)
    expect(isWhite(page.colorAt(290, 190))).toBe(true)
    expect(isDark(page.colorAt(310, 190))).toBe(true)
    expect(isDark(page.colorAt(290, 210))).toBe(true)
  })
})

describe('AcroForm', () => {
  const pageTexts = async (bytes: Uint8Array, pageNumber = 1) =>
    (await readDisplayedText(bytes, pageNumber)).map((item) => item.text)

  it('prints Cyrillic values into the page and removes the form', async () => {
    const source = await makeForm('Form')
    const document = singlePageDocument(source, [])
    document.formValues = { s1: { name: 'Анна Müller', agree: true } }

    const { bytes: output } = await buildPdf(document, fonts)

    expect(await pageTexts(output)).toContain('Анна Müller')
    const reloaded = await PDFDocument.load(output)
    expect(reloaded.catalog.lookup(PDFName.of('AcroForm'))).toBeUndefined()
    const annots = reloaded.getPage(0).node.lookup(PDFName.of('Annots'))
    expect(annots === undefined || (annots instanceof PDFArray && annots.size() === 0)).toBe(true)
  })

  it('paints the checkbox state into the page', async () => {
    // Inside the 16 pt box at (50, 176) on the displayed page, without its border.
    const darkPixelsInBox = async (agree: boolean) => {
      const document = singlePageDocument(await makeForm('Form'), [])
      document.formValues = { s1: { agree } }
      const page = await renderPage((await buildPdf(document, fonts)).bytes)
      let count = 0
      for (let y = 179; y < 189; y += 0.5) {
        for (let x = 53; x < 63; x += 0.5) {
          if (isDark(page.colorAt(x, y))) count++
        }
      }
      return count
    }

    expect(await darkPixelsInBox(true)).toBeGreaterThan(5)
    expect(await darkPixelsInBox(false)).toBe(0)
  })

  it('keeps other annotations such as links', async () => {
    const source = await PDFDocument.load(await makeForm('Form'))
    const link = source.context.register(
      source.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [50, 500, 200, 520],
        Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/') }
      })
    )
    source.getPage(0).node.addAnnot(link)

    const { bytes: output } = await buildPdf(singlePageDocument(await source.save(), []), fonts)

    const reloaded = await PDFDocument.load(output)
    const annots = reloaded.getPage(0).node.Annots()!
    expect(annots.size()).toBe(1)
    const remaining = annots.lookup(0, PDFDict)
    expect(remaining.get(PDFName.of('Subtype'))).toBe(PDFName.of('Link'))
  })

  it('keeps same-named fields of two merged files apart', async () => {
    const document: EditorDocument = {
      sources: {
        a: { name: 'a.pdf', bytes: await makeForm('First') },
        b: { name: 'b.pdf', bytes: await makeForm('Second') }
      },
      formValues: { a: { name: 'Значение А' }, b: { name: 'Значение Б' } },
      assets: {},
      pages: [
        { id: 'p1', sourceId: 'a', pageIndex: 0, rotation: 0, fields: [] },
        { id: 'p2', sourceId: 'b', pageIndex: 0, rotation: 0, fields: [] }
      ]
    }

    const { bytes: output } = await buildPdf(document, fonts)

    expect(await pageTexts(output, 1)).toEqual(expect.arrayContaining(['First', 'Значение А']))
    expect(await pageTexts(output, 2)).toEqual(expect.arrayContaining(['Second', 'Значение Б']))
  })
})

describe('document assembly', () => {
  it('follows the editor page order and drops pages left out of it', async () => {
    const source = await PDFDocument.create()
    const font = await source.embedFont('Helvetica')
    for (const label of ['One', 'Two', 'Three']) {
      source.addPage([300, 300]).drawText(label, { x: 20, y: 200, font, size: 14 })
    }
    const bytes = await source.save()
    const document: EditorDocument = {
      sources: { s1: { name: 'three.pdf', bytes } },
      formValues: {},
      assets: {},
      pages: [
        { id: 'c', sourceId: 's1', pageIndex: 2, rotation: 0, fields: [] },
        { id: 'a', sourceId: 's1', pageIndex: 0, rotation: 0, fields: [] }
      ]
    }

    const { bytes: output } = await buildPdf(document, fonts)

    expect((await PDFDocument.load(output)).getPageCount()).toBe(2)
    expect((await readDisplayedText(output, 1))[0]?.text).toBe('Three')
    expect((await readDisplayedText(output, 2))[0]?.text).toBe('One')
  })

  it('does not change the source bytes', async () => {
    const source = await makeForm('Source')
    const before = source.slice()
    const document = singlePageDocument(source, [textField()], 90)
    document.formValues = { s1: { name: 'x' } }

    await buildPdf(document, fonts)

    expect(source).toEqual(before)
  })
})
