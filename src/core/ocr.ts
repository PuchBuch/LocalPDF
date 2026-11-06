import type { OcrWord } from './model'
import type { PageTextRun } from './textLines'

/** Words read with less confidence than this are more likely noise than text. */
export const MIN_OCR_CONFIDENCE = 40

/** The engine's row height leaves out part of the letters' reach, measured on Arial-like text. */
const ROW_HEIGHT_TO_FONT_SIZE = 1.2

/** What the OCR engine reports for a word and its line, in pixels of the picture it read. */
export interface RecognizedWord {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
  /** The line's baseline, from its start to its end. */
  baseline: { x0: number; y0: number; x1: number; y1: number }
  rowHeight?: number
}

/** Words read from a picture, in points on the page. */
export function toOcrWords(recognized: RecognizedWord[], scale: number): OcrWord[] {
  return recognized.flatMap(({ text, confidence, bbox, baseline, rowHeight }) => {
    const trimmed = text.trim()
    if (trimmed === '' || confidence < MIN_OCR_CONFIDENCE) return []
    const span = baseline.x1 - baseline.x0
    const along = span === 0 ? 0 : (bbox.x0 - baseline.x0) / span
    const baselineY = baseline.y0 + along * (baseline.y1 - baseline.y0)
    return [
      {
        text: trimmed,
        x: bbox.x0 / scale,
        y: bbox.y0 / scale,
        width: (bbox.x1 - bbox.x0) / scale,
        height: (bbox.y1 - bbox.y0) / scale,
        baseline: baselineY / scale,
        fontSize: (rowHeight && rowHeight > 0 ? rowHeight * ROW_HEIGHT_TO_FONT_SIZE : bbox.y1 - bbox.y0) / scale
      }
    ]
  })
}

/** Recognized words as text of the page, for editing. */
export function ocrRuns(words: OcrWord[] | undefined): PageTextRun[] {
  return (words ?? []).map(({ text, x, baseline, width, fontSize }) => ({ text, x, baseline, width, height: fontSize }))
}
