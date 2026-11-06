import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { getDocument, Util, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { FONT_FACES, FONT_FAMILIES, type FontFamily } from '../src/core/fonts'
import type { ExportFonts } from '../src/export/buildPdf'
import type { EditorDocument, Field, PageRef, Rotation } from '../src/core/model'

const ROOT = resolve(__dirname, '..')
const STANDARD_FONTS = `${join(ROOT, 'node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/')}/`

export async function loadFonts(): Promise<ExportFonts> {
  const fontDir = join(ROOT, 'src/renderer/public/fonts')
  const text = {} as ExportFonts['text']
  for (const { id, file } of FONT_FAMILIES) {
    const faces = {} as ExportFonts['text'][FontFamily]
    for (const face of FONT_FACES) faces[face] = new Uint8Array(await readFile(join(fontDir, `${file}-${face}.ttf`)))
    text[id] = faces
  }
  return {
    text,
    mono: new Uint8Array(await readFile(join(fontDir, 'RobotoMono-Regular.ttf')))
  }
}

export interface FixtureOptions {
  rotate?: Rotation
  crop?: { x: number; y: number; width: number; height: number }
  blackBackground?: boolean
}

/** A one-page A4 PDF with the given /Rotate and crop box. */
export async function makePage(options: FixtureOptions = {}): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const page = document.addPage([595, 842])
  if (options.blackBackground) {
    page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(0, 0, 0) })
  }
  if (options.rotate) page.setRotation(degrees(options.rotate))
  if (options.crop) {
    const { x, y, width, height } = options.crop
    page.setCropBox(x, y, width, height)
  }
  return document.save()
}

/** A PDF whose AcroForm has a text field and a checkbox, with fixed field names. */
export async function makeForm(label: string): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const page = document.addPage([595, 842])
  const font = await document.embedFont(StandardFonts.Helvetica)
  page.drawText(label, { x: 50, y: 800, font, size: 12 })
  const form = document.getForm()
  form.createTextField('name').addToPage(page, { x: 50, y: 700, width: 300, height: 24 })
  form.createCheckBox('agree').addToPage(page, { x: 50, y: 650, width: 16, height: 16 })
  return document.save()
}

/** A horizontal PNG, left half red and right half blue. */
export function makeTwoColorPng(): Uint8Array {
  const canvas = createCanvas(40, 20)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ff0000'
  context.fillRect(0, 0, 20, 20)
  context.fillStyle = '#0000ff'
  context.fillRect(20, 0, 20, 20)
  return new Uint8Array(canvas.toBuffer('image/png'))
}

export function singlePageDocument(
  bytes: Uint8Array,
  fields: Field[],
  rotation: Rotation = 0,
  assets: EditorDocument['assets'] = {}
): EditorDocument {
  const page: PageRef = { id: 'p1', sourceId: 's1', pageIndex: 0, rotation, fields }
  return { sources: { s1: { name: 'test.pdf', bytes } }, formValues: {}, assets, pages: [page] }
}

export function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({
    data: bytes.slice(),
    standardFontDataUrl: STANDARD_FONTS,
    useSystemFonts: false,
    verbosity: 0
  }).promise
}

export interface DisplayedText {
  text: string
  x: number
  y: number
}

/** Text items with their baseline origin on the displayed page, the way a viewer sees them. */
export async function readDisplayedText(bytes: Uint8Array, pageNumber = 1): Promise<DisplayedText[]> {
  const pdf = await openPdf(bytes)
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const items: DisplayedText[] = []
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue
    const transform = Util.transform(viewport.transform, item.transform)
    items.push({ text: item.str, x: transform[4]!, y: transform[5]! })
  }
  return items
}

export async function displayedPageSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const pdf = await openPdf(bytes)
  const { width, height } = (await pdf.getPage(1)).getViewport({ scale: 1 })
  return { width, height }
}

export interface RenderedPage {
  png: Buffer
  /** RGB of the pixel at a point on the displayed page, in PDF points. */
  colorAt: (x: number, y: number) => [number, number, number]
}

export async function renderPage(bytes: Uint8Array, pageNumber = 1, scale = 2): Promise<RenderedPage> {
  const pdf = await openPdf(bytes)
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = canvas.getContext('2d')
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport
  }).promise
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  return {
    png: canvas.toBuffer('image/png'),
    colorAt: (x, y) => {
      const offset = (Math.floor(y * scale) * canvas.width + Math.floor(x * scale)) * 4
      return [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!]
    }
  }
}
