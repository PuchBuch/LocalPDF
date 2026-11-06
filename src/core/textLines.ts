import { LINE_HEIGHT, newTextField, type MeasureText } from './fields'
import { familyInfo } from './fonts'
import type { Rect } from './geometry'
import type { Field, RgbColor, TextCover, TextField, TextStyle } from './model'

/** A piece of horizontal text on the displayed page, in points from its top-left corner. */
export interface PageTextRun {
  text: string
  x: number
  baseline: number
  width: number
  /** The font size. */
  height: number
  /** The name the PDF viewer knows the font by. */
  fontName?: string
}

export type TextLine = PageTextRun

/** A word on the page, and the line it stands in. */
export interface TextWord extends PageTextRun {
  line: TextLine
}

/** How a line of the page looks, read from the page itself. */
export interface LineAppearance {
  style: TextStyle
  background: RgbColor
}

/** Colours that differ by less than this from the background are not text. */
const MIN_INK_DISTANCE = 40
/** Edges of letters blend into the background. Solid ink is at least this far of the furthest colour. */
const SOLID_INK = 0.7
const BLACK: RgbColor = { r: 0, g: 0, b: 0 }

const distance = (a: RgbColor, b: RgbColor) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)

/** The colours of text and of what is behind it, from RGBA pixels of a line drawn large. */
export function inkAndBackground(pixels: ArrayLike<number>): { ink: RgbColor; background: RgbColor } {
  const counts = new Map<number, number>()
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    const key = (pixels[offset]! << 16) | (pixels[offset + 1]! << 8) | pixels[offset + 2]!
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const colors = [...counts].map(([key, count]) => ({
    color: { r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255 },
    count
  }))
  if (colors.length === 0) return { ink: BLACK, background: { r: 255, g: 255, b: 255 } }

  const background = colors.reduce((best, entry) => (entry.count > best.count ? entry : best)).color
  const furthest = Math.max(...colors.map((entry) => distance(entry.color, background)))
  if (furthest < MIN_INK_DISTANCE) return { ink: BLACK, background }
  const solid = colors.filter((entry) => distance(entry.color, background) >= furthest * SOLID_INK)
  return { ink: solid.reduce((best, entry) => (entry.count > best.count ? entry : best)).color, background }
}

/** For each column of RGBA pixels, whether anything in it stands out from the background. */
export function inkColumns(pixels: ArrayLike<number>, width: number, height: number, background: RgbColor): boolean[] {
  const columns = new Array<boolean>(width).fill(false)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const color = { r: pixels[offset]!, g: pixels[offset + 1]!, b: pixels[offset + 2]! }
      if (distance(color, background) >= MIN_INK_DISTANCE) columns[x] = true
    }
  }
  return columns
}

/**
 * Where the ink of a word really starts and ends, given columns of ink and where it
 * should roughly be. Ink belongs together across gaps smaller than minGap, which are
 * the gaps between letters. Null if there is no ink there.
 */
export function inkSpan(columns: boolean[], start: number, end: number, minGap: number): [number, number] | null {
  const clusters: [number, number][] = []
  let current: [number, number] | null = null
  columns.forEach((ink, x) => {
    if (!ink) return
    if (current && x - current[1] - 1 < minGap) current[1] = x
    else {
      current = [x, x]
      clusters.push(current)
    }
  })
  const inside = clusters.filter(([from, to]) => {
    const middle = (from + to) / 2
    return middle >= start && middle <= end
  })
  if (inside.length === 0) return null
  return [inside[0]![0], inside.at(-1)![1] + 1]
}

const BOLD_NAME = /bold|black|heavy|semibold|demi/i
const ITALIC_NAME = /italic|oblique/i

/** Whether a font is bold or italic, from what the file says about it. */
export function fontLook(font: { name?: string; bold?: boolean; black?: boolean; italic?: boolean } | null): {
  bold: boolean
  italic: boolean
} {
  const name = font?.name ?? ''
  return {
    bold: font?.bold === true || font?.black === true || BOLD_NAME.test(name),
    italic: font?.italic === true || ITALIC_NAME.test(name)
  }
}

/** Runs on one baseline further apart than this share of their height are separate lines, as columns are. */
const COLUMN_GAP = 1.5
/** Runs further apart than this share of their height have a space between them. */
const WORD_GAP = 0.2
/** Baselines closer than this share of the height are the same line. */
const SAME_BASELINE = 0.3

/** How far a cover reaches around the baseline, as shares of the font size. */
const COVER_ABOVE = 0.9
const COVER_BELOW = 0.25
const COVER_MARGIN = 0.5

function join(line: TextLine, run: PageTextRun): TextLine {
  const separated = run.x - (line.x + line.width) > run.height * WORD_GAP && !/\s$/.test(line.text) && !/^\s/.test(run.text)
  return {
    text: line.text + (separated ? ' ' : '') + run.text,
    x: line.x,
    baseline: line.baseline,
    width: Math.max(line.width, run.x + run.width - line.x),
    height: Math.max(line.height, run.height),
    // A line in two fonts gets the one most of it is in.
    fontName: run.text.length > line.text.length ? run.fontName : line.fontName
  }
}

/** The runs of a page in rows by baseline, top to bottom, and left to right within a row. */
function toRows(runs: PageTextRun[]): PageTextRun[][] {
  const sorted = [...runs].sort((a, b) => a.baseline - b.baseline || a.x - b.x)
  const rows: PageTextRun[][] = []
  for (const run of sorted) {
    const row = rows.at(-1)
    if (row && Math.abs(row[0]!.baseline - run.baseline) < Math.min(row[0]!.height, run.height) * SAME_BASELINE) row.push(run)
    else rows.push([run])
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x))
}

/** Puts the runs of a page together into lines, each as one piece the reader would call a line. */
export function toTextLines(runs: PageTextRun[]): TextLine[] {
  const lines: TextLine[] = []
  for (const row of toRows(runs)) {
    let line: TextLine | null = null
    for (const run of row) {
      if (line && run.x - (line.x + line.width) <= run.height * COLUMN_GAP) {
        line = join(line, run)
      } else {
        if (line) lines.push(line)
        line = run
      }
    }
    if (line) lines.push(line)
  }
  return lines.map((line) => ({ ...line, text: line.text.trim() })).filter((line) => line.text !== '')
}

/**
 * The words of a page. A run holds no positions for its letters, so a word's place
 * inside it is worked out from how wide the text before it is, and is approximate.
 * Clicking a word settles its true edges from the ink on the page, see inkSpan.
 */
export function toTextWords(runs: PageTextRun[], measure: MeasureText): TextWord[] {
  const lines = toTextLines(runs)
  const words: PageTextRun[] = []

  for (const row of toRows(runs)) {
    for (const run of row) {
      const scale = run.width / Math.max(measure(run.text, run.height), 0.001)
      for (const match of run.text.matchAll(/\S+/g)) {
        const before = run.text.slice(0, match.index)
        const x = run.x + measure(before, run.height) * scale
        const width = measure(match[0], run.height) * scale
        const previous = words.at(-1)
        const touches =
          previous !== undefined &&
          previous.baseline === run.baseline &&
          match.index === 0 &&
          x - (previous.x + previous.width) <= run.height * WORD_GAP
        // A word split over two runs, as kerning often does, is still one word.
        if (touches && previous) {
          previous.text += match[0]
          previous.width = x + width - previous.x
        } else {
          words.push({ text: match[0], x, baseline: run.baseline, width, height: run.height, fontName: run.fontName })
        }
      }
    }
  }

  return words.map((word) => ({
    ...word,
    line:
      lines.find(
        (line) =>
          Math.abs(line.baseline - word.baseline) < word.height * SAME_BASELINE &&
          word.x >= line.x - 1 &&
          word.x <= line.x + line.width
      ) ?? word
  }))
}

/** The area a line takes on the page. */
export function coverOf(line: PageTextRun): Rect {
  return {
    x: line.x - COVER_MARGIN,
    y: line.baseline - line.height * COVER_ABOVE,
    width: line.width + COVER_MARGIN * 2,
    height: line.height * (COVER_ABOVE + COVER_BELOW)
  }
}

/** A text field holding a line or word of the page, on the same baseline and looking like it, that paints the original out. */
export function fieldForLine(id: string, line: PageTextRun, appearance?: LineAppearance): TextField {
  return {
    ...newTextField(id),
    x: line.x,
    y: line.baseline - line.height * familyInfo(appearance?.style.family).baseline,
    width: line.width,
    height: line.height * LINE_HEIGHT,
    value: line.text,
    fontSize: line.height,
    cover: { ...coverOf(line), color: appearance?.background },
    style: appearance?.style
  }
}

/** Whether a point lies in any of the areas. */
export function isCovered(point: { x: number; y: number }, covers: Rect[]): boolean {
  return covers.some(
    (cover) =>
      point.x >= cover.x && point.x <= cover.x + cover.width && point.y >= cover.y && point.y <= cover.y + cover.height
  )
}

/** Whether an area shares anything with any of the others. */
export function overlapsAny(area: Rect, others: Rect[]): boolean {
  return others.some(
    (other) =>
      area.x < other.x + other.width &&
      other.x < area.x + area.width &&
      area.y < other.y + other.height &&
      other.y < area.y + area.height
  )
}

/** The areas painted out on a page. */
export function coversOf(fields: Field[]): TextCover[] {
  return fields.flatMap((field) => (field.type === 'TEXT' && field.cover ? field.cover : []))
}
