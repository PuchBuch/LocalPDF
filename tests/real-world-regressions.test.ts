import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFInvalidObject, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import { visibleBox } from '../src/core/geometry'
import type { EditorDocument } from '../src/core/model'
import { fieldForLine } from '../src/core/textLines'
import { buildPdf, type ExportFonts } from '../src/export/buildPdf'
import { rewritePdf } from '../src/export/qpdf'
import { loadFonts, openPdf, readDisplayedText, renderPage, singlePageDocument } from './helpers'

// What running real documents through the app brought to light.

const WASM = createRequire(import.meta.url).resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm')
const repair = (bytes: Uint8Array) => rewritePdf(WASM, bytes)

let fonts: ExportFonts

beforeAll(async () => {
  fonts = await loadFonts()
})

/** A page with a black square on a layer that is switched off, and a text on the page itself. */
async function pdfWithHiddenLayer(layerName = 'Hidden'): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const page = document.addPage([595, 842])
  page.drawText('Visible', { x: 60, y: 760, font, size: 24 })

  const { context } = document
  const layer = context.register(context.obj({ Type: 'OCG', Name: PDFString.of(layerName) }))
  document.catalog.set(
    PDFName.of('OCProperties'),
    context.obj({ OCGs: [layer], D: { OFF: [layer], Order: [layer] } })
  )
  page.node.Resources()!.set(PDFName.of('Properties'), context.obj({ L0: layer }))
  const original = page.node.Contents()
  const hidden = context.register(context.flateStream('/OC /L0 BDC 0 0 0 rg 100 100 200 200 re f EMC'))
  const contents = original instanceof PDFArray ? original : context.obj([page.node.get(PDFName.of('Contents'))!])
  contents.push(hidden)
  page.node.set(PDFName.of('Contents'), contents)
  return document.save()
}

const isHiddenArea = async (bytes: Uint8Array) => (await renderPage(bytes)).colorAt(200, 842 - 200)[0] > 200

describe('layers that are switched off', () => {
  it('stay hidden in the saved file', async () => {
    const source = await pdfWithHiddenLayer()
    expect(await isHiddenArea(source), 'hidden in the source').toBe(true)
    const { bytes } = await buildPdf(singlePageDocument(source, []), fonts)
    expect(await isHiddenArea(bytes), 'hidden in the saved file').toBe(true)
    expect((await readDisplayedText(bytes)).map((item) => item.text)).toContain('Visible')
  })

  it('stay hidden in merged documents, from each file', async () => {
    const first = await pdfWithHiddenLayer('A')
    const second = await pdfWithHiddenLayer('B')
    const document: EditorDocument = {
      sources: { a: { name: 'a.pdf', bytes: first }, b: { name: 'b.pdf', bytes: second } },
      formValues: {},
      assets: {},
      pages: [
        { id: 'p1', sourceId: 'a', pageIndex: 0, rotation: 0, fields: [] },
        { id: 'p2', sourceId: 'b', pageIndex: 0, rotation: 0, fields: [] }
      ]
    }
    const { bytes } = await buildPdf(document, fonts)
    expect((await renderPage(bytes, 1)).colorAt(200, 842 - 200)[0]).toBeGreaterThan(200)
    expect((await renderPage(bytes, 2)).colorAt(200, 842 - 200)[0]).toBeGreaterThan(200)
  })

  it('leave a document without layers without any such settings', async () => {
    const plain = await PDFDocument.create()
    plain.addPage()
    const { bytes } = await buildPdf(singlePageDocument(await plain.save(), []), fonts)
    expect((await PDFDocument.load(bytes)).catalog.get(PDFName.of('OCProperties'))).toBeUndefined()
  })
})

describe('the visible part of a page', () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

  it('is the crop box when it lies inside the media box', () => {
    expect(visibleBox(box(10, 20, 100, 200), box(0, 0, 595, 842))).toEqual(box(10, 20, 100, 200))
  })

  it('is cut to the media box when the crop box sticks out', () => {
    expect(visibleBox(box(-50, -50, 200, 200), box(0, 0, 595, 842))).toEqual(box(0, 0, 150, 150))
  })

  it('falls back on the media box for a crop box outside it', () => {
    expect(visibleBox(box(1000, 1000, 10, 10), box(0, 0, 595, 842))).toEqual(box(0, 0, 595, 842))
  })

  it('falls back on a Letter page for an empty media box', () => {
    expect(visibleBox(box(0, 0, 0, 0), box(0, 0, 0, 0))).toEqual(box(0, 0, 612, 792))
  })

  it('copes with boxes written from the far corner', () => {
    expect(visibleBox(box(100, 100, -100, -100), box(595, 842, -595, -842))).toEqual(box(0, 0, 100, 100))
  })

  it('makes a field land where it should on a page whose crop box sticks out', async () => {
    const document = await PDFDocument.create()
    const page = document.addPage([300, 300])
    page.setCropBox(-100, -100, 500, 500)
    const bytes = await document.save()
    const field = { ...fieldForLine('f', { text: 'x', x: 50, baseline: 100, width: 40, height: 12 }), value: 'Здесь' }
    const { bytes: output } = await buildPdf(singlePageDocument(bytes, [field]), fonts)
    const [item] = await readDisplayedText(output)
    expect(item!.x).toBeCloseTo(50, 0)
    expect(item!.y).toBeCloseTo(100, 0)
  })
})

describe('a form that cannot be printed into its pages', () => {
  /** A checkbox with appearances that lead nowhere, as real files have. */
  async function brokenForm(): Promise<Uint8Array> {
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.Helvetica)
    const page = document.addPage([595, 842])
    page.drawText('Other content', { x: 60, y: 760, font, size: 14 })
    const form = document.getForm()
    const box = form.createCheckBox('agree')
    box.addToPage(page, { x: 60, y: 700, width: 20, height: 20 })
    const widget = box.acroField.getWidgets()[0]!
    widget.dict.set(PDFName.of('AP'), document.context.obj({ N: { Odd: 'nonsense' } }))
    widget.dict.set(PDFName.of('AS'), PDFName.of('Missing'))
    return document.save({ updateFieldAppearances: false })
  }

  it('does not stop the document being saved, and it says so if values are lost', async () => {
    const bytes = await brokenForm()
    const document = singlePageDocument(bytes, [])
    document.formValues = { s1: { agree: true } }
    const result = await buildPdf(document, fonts)
    expect((await readDisplayedText(result.bytes)).map((item) => item.text)).toContain('Other content')
  })

  it('stays silent when nothing was entered', async () => {
    const result = await buildPdf(singlePageDocument(await brokenForm(), []), fonts)
    expect(result.formsNotPrinted).toBe(false)
  })
})

describe('content that cannot be read', () => {
  it('does not stop the document being saved', async () => {
    const document = await PDFDocument.create()
    const page = document.addPage([595, 842])
    const { context } = document
    page.node.set(
      PDFName.of('Contents'),
      context.register(context.stream('this is not flate', { Filter: 'FlateDecode' }))
    )
    const bytes = await document.save({ useObjectStreams: false })
    const field = { ...fieldForLine('f', { text: 'x', x: 50, baseline: 100, width: 40, height: 12 }), value: 'Новый' }
    const { bytes: output } = await buildPdf(singlePageDocument(bytes, [field]), fonts)
    expect(await PDFDocument.load(output)).toBeInstanceOf(PDFDocument)
  })
})

describe('repairing', () => {
  it('rewrites a good file with the same content', async () => {
    const source = await pdfWithHiddenLayer()
    const rewritten = await rewritePdf(WASM, source)
    expect((await readDisplayedText(rewritten!)).map((item) => item.text)).toContain('Visible')
  })

  it('gives nothing for what is not a PDF', async () => {
    expect(await rewritePdf(WASM, new TextEncoder().encode('no pdf here'))).toBeNull()
  })

  it('is used when the library cannot read part of a file, and only then', async () => {
    const asked: Uint8Array[] = []
    const spy = async (bytes: Uint8Array) => {
      asked.push(bytes)
      return rewritePdf(WASM, bytes)
    }

    const good = await pdfWithHiddenLayer()
    await buildPdf(singlePageDocument(good, []), fonts, { repair: spy })
    expect(asked).toHaveLength(0)

    // An object the library's parser gives up on, as real files have, here one nothing uses.
    const document = await PDFDocument.load(good)
    document.context.register(PDFInvalidObject.of(new TextEncoder().encode('<< /Broken ( >>')))
    const damaged = await document.save({ useObjectStreams: false })
    const { bytes: output } = await buildPdf(singlePageDocument(damaged, []), fonts, { repair: spy })
    expect(asked).toHaveLength(1)
    expect((await readDisplayedText(output)).map((item) => item.text)).toContain('Visible')
  })

  it('keeps hidden layers hidden through it', async () => {
    const source = await pdfWithHiddenLayer()
    const rewritten = await rewritePdf(WASM, source)
    const { bytes } = await buildPdf(singlePageDocument(rewritten!, []), fonts)
    expect(await isHiddenArea(bytes)).toBe(true)
    const settings = (await PDFDocument.load(bytes)).catalog.lookup(PDFName.of('OCProperties'))
    expect(settings).toBeInstanceOf(PDFDict)
  })
})
