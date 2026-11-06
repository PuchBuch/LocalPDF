import type { PDFPageProxy } from 'pdfjs-dist'
import { createWorker, OEM, type Worker } from 'tesseract.js'
import { toOcrWords, type RecognizedWord } from '../../../core/ocr'
import type { OcrWord } from '../../../core/model'
import { MAX_CANVAS_PIXELS } from '../../../core/zoom'
import type { Locale } from '../i18n'

/** Fine for print-sized text. More takes longer without reading better. */
const OCR_DPI = 300
const POINTS_PER_INCH = 72
/**
 * What to read for a chosen language. English goes along, it turns up in every kind of
 * document. Reading more languages at once is slower and less accurate, so only
 * Russian and Ukrainian, which often come with German here, take more.
 */
const LANGUAGES: Record<Locale, string> = {
  en: 'eng',
  de: 'deu+eng',
  fr: 'fra+eng',
  es: 'spa+eng',
  it: 'ita+eng',
  pl: 'pol+eng',
  uk: 'ukr+rus+deu+eng',
  ru: 'rus+ukr+deu+eng'
}

const assetUrl = (path: string) => new URL(`ocr/${path}`, window.location.href).href

/** Starts the engine, from the files that come with the app. */
export function startOcr(locale: Locale): Promise<Worker> {
  return createWorker(LANGUAGES[locale], OEM.LSTM_ONLY, {
    workerPath: assetUrl('worker.min.js'),
    corePath: assetUrl('core/'),
    langPath: assetUrl('lang'),
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'none'
  })
}

/** Reads the words of a page. Their places are on the page before rotations added in the editor. */
export async function recognizePage(worker: Worker, page: PDFPageProxy): Promise<OcrWord[]> {
  const { width, height } = page.getViewport({ scale: 1 })
  const scale = Math.min(OCR_DPI / POINTS_PER_INCH, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvas, viewport }).promise

  const { data } = await worker.recognize(canvas, {}, { blocks: true })
  canvas.width = 0
  canvas.height = 0

  const words: RecognizedWord[] = []
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          words.push({
            text: word.text,
            confidence: word.confidence,
            bbox: word.bbox,
            baseline: line.baseline,
            rowHeight: line.rowAttributes?.rowHeight
          })
        }
      }
    }
  }
  return toOcrWords(words, scale)
}
