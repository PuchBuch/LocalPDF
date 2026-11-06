import type { PDFPageProxy } from 'pdfjs-dist'
import { closestFamily } from '../../../core/fonts'
import { normalizeRotation } from '../../../core/geometry'
import type { Rotation } from '../../../core/model'
import {
  fontLook,
  inkAndBackground,
  inkColumns,
  inkSpan,
  type LineAppearance,
  type PageTextRun,
  type TextLine,
  type TextWord
} from '../../../core/textLines'
import { measureText } from './textMetrics'

/** Large enough that the strokes of small letters have solid pixels, free of blending at the edges. */
const SAMPLE_SCALE = 4
/** The band of a line that holds its letters, as shares of the font size around the baseline. */
const BAND_ABOVE = 0.75
const BAND_BELOW = 0.2
/** A gap between words is at least this share of the font size, a gap between letters less. */
const WORD_INK_GAP = 0.13
/** How far beside a word's expected place its ink is looked for, as a share of the font size. */
const WORD_SEARCH = 1.5

interface PdfFontInfo {
  name?: string
  bold?: boolean
  black?: boolean
  italic?: boolean
  fallbackName?: string
}

async function fontOf(page: PDFPageProxy, fontName: string | undefined): Promise<PdfFontInfo | null> {
  if (!fontName) return null
  // Fonts reach the page's shared objects once its drawing instructions have been read.
  await page.getOperatorList()
  try {
    return page.commonObjs.get(fontName) as PdfFontInfo
  } catch {
    return null
  }
}

/** Draws a stretch of a line large, for reading its pixels. */
async function drawBand(page: PDFPageProxy, run: PageTextRun, rotation: Rotation, left: number, right: number) {
  const width = Math.max(1, Math.ceil((right - left) * SAMPLE_SCALE))
  const height = Math.max(1, Math.ceil(run.height * (BAND_ABOVE + BAND_BELOW) * SAMPLE_SCALE))
  const viewport = page.getViewport({
    scale: SAMPLE_SCALE,
    rotation: normalizeRotation(page.rotate + rotation),
    offsetX: -left * SAMPLE_SCALE,
    offsetY: -(run.baseline - run.height * BAND_ABOVE) * SAMPLE_SCALE
  })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  await page.render({ canvas, viewport }).promise
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data
  canvas.width = 0
  canvas.height = 0
  return { pixels, width, height }
}

/** How a line of the page looks: its font, its colour and what is behind it. */
export async function lineAppearance(page: PDFPageProxy, line: TextLine, rotation: Rotation): Promise<LineAppearance> {
  const [font, band] = await Promise.all([
    fontOf(page, line.fontName),
    drawBand(page, line, rotation, line.x, line.x + line.width)
  ])
  const { ink, background } = inkAndBackground(band.pixels)
  const look = fontLook(font)
  const family = closestFamily(line, look, font?.fallbackName, measureText)
  return { style: { ...look, color: ink, family }, background }
}

/**
 * A word with its true edges and its look. The edges come from the ink on the page,
 * since only the ends of a run of text have known positions. The family comes from
 * the line, which has far more text to compare widths on.
 */
export async function wordAppearance(
  page: PDFPageProxy,
  word: TextWord,
  rotation: Rotation
): Promise<{ word: TextWord; appearance: LineAppearance }> {
  const search = word.height * WORD_SEARCH
  const left = word.x - search
  const band = await drawBand(page, word, rotation, left, word.x + word.width + search)
  const { ink, background } = inkAndBackground(band.pixels)
  const span = inkSpan(
    inkColumns(band.pixels, band.width, band.height, background),
    search * SAMPLE_SCALE,
    (search + word.width) * SAMPLE_SCALE,
    word.height * WORD_INK_GAP * SAMPLE_SCALE
  )
  const placed = span ? { ...word, x: left + span[0] / SAMPLE_SCALE, width: (span[1] - span[0]) / SAMPLE_SCALE } : word

  const [font, lineFont] = await Promise.all([fontOf(page, word.fontName), fontOf(page, word.line.fontName)])
  const look = fontLook(font)
  const family = closestFamily(word.line, fontLook(lineFont), lineFont?.fallbackName, measureText)
  return { word: placed, appearance: { style: { ...look, color: ink, family }, background } }
}
