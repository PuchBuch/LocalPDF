import type { PDFPageProxy } from 'pdfjs-dist'
import { MAX_CANVAS_PIXELS } from '../../../core/zoom'
import type { PrintResult } from '../../../preload'
import { openPdf } from './pdfjs'

const PRINT_DPI = 300
const POINTS_PER_INCH = 72

interface PrintedPage {
  url: string
  width: number
  height: number
}

async function renderForPrint(page: PDFPageProxy): Promise<PrintedPage> {
  const { width, height } = page.getViewport({ scale: 1 })
  const scale = Math.min(PRINT_DPI / POINTS_PER_INCH, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvas, viewport }).promise
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'))
  // Browsers hold canvas memory until it is shrunk or collected.
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error('A page could not be turned into an image')
  return { url: URL.createObjectURL(blob), width, height }
}

/** One named page size per distinct size, so that a mixed document keeps its shapes on paper. */
function pageSizeRules(pages: PrintedPage[]): { rules: string; nameOf: (page: PrintedPage) => string } {
  const sizes = [...new Set(pages.map((page) => `${page.width} ${page.height}`))]
  return {
    rules: sizes
      .map((size, index) => {
        const [width, height] = size.split(' ')
        return `@page print-size-${index} { size: ${width}pt ${height}pt; margin: 0; }`
      })
      .join('\n'),
    nameOf: (page) => `print-size-${sizes.indexOf(`${page.width} ${page.height}`)}`
  }
}

/**
 * Prints finished PDF bytes through the system dialog. Chromium cannot print a PDF
 * it shows, so the pages go to the printer as images drawn at printing resolution.
 */
export async function printPdf(bytes: Uint8Array): Promise<PrintResult> {
  const pdf = await openPdf(bytes)
  const pages: PrintedPage[] = []
  const root = document.createElement('div')
  const style = document.createElement('style')
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      pages.push(await renderForPrint(await pdf.getPage(number)))
    }
    const { rules, nameOf } = pageSizeRules(pages)
    style.textContent = rules
    root.className = 'print-root'
    root.dataset['testid'] = 'print-root'
    const images = pages.map((page) => {
      const sheet = document.createElement('div')
      sheet.className = 'print-page'
      sheet.style.setProperty('page', nameOf(page))
      sheet.style.width = `${page.width}pt`
      sheet.style.height = `${page.height}pt`
      const image = document.createElement('img')
      image.src = page.url
      sheet.append(image)
      root.append(sheet)
      return image
    })
    document.head.append(style)
    document.body.append(root)
    await Promise.all(images.map((image) => image.decode()))
    return await window.localpdf.print()
  } finally {
    root.remove()
    style.remove()
    for (const page of pages) URL.revokeObjectURL(page.url)
    void pdf.loadingTask.destroy()
  }
}
