import { CHECKBOX_SIZE, LINE_HEIGHT, newCheckboxField, newTextField, type MeasureText } from './fields'
import type { Rect, Size } from './geometry'
import type { CheckboxField, Field, TextField } from './model'

/** Sizes are in points, the picture is scanned in pixels. */
const MIN_LINE_LENGTH = 40
const MAX_LINE_THICKNESS = 2.5
const MAX_LINE_SHARE = 0.7
/** Pieces of a line this close together are one line. */
const LINE_BREAK = 3
const MIN_SPACE_ABOVE_LINE = 9
const MIN_CHECKBOX = 6
const MAX_CHECKBOX = 22
/** A box this much wider than tall takes text, a squarer one a mark. */
const SQUARE_TOLERANCE = 1.35
const MIN_TEXT_BOX_HEIGHT = 9
const MAX_TEXT_BOX_HEIGHT = 120
/** A wall of a box may be broken for this share of its length, as scans are. */
const WALL_COVERAGE = 0.85
/** The inside of an empty box or the space above a line may hold this share of specks. */
const MAX_INK_INSIDE = 0.02
const INSET = 2
const MAX_FONT_SIZE = 12

/** Where blank fields seem to be on a page: lines to write on, boxes, and boxes to mark. */
export interface DetectedSpots {
  lines: Rect[]
  textBoxes: Rect[]
  checkBoxes: Rect[]
}

interface Segment {
  x: number
  y: number
  length: number
  thickness: number
}

/**
 * Finds places to fill in on a page, from a picture of it. The mask has one entry per
 * pixel, true where it is dark, and scale is its pixels per point.
 */
export function detectSpots(mask: Uint8Array, width: number, height: number, scale: number): DetectedSpots {
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1

  const inkShare = (left: number, top: number, right: number, bottom: number) => {
    let ink = 0
    let total = 0
    for (let y = Math.max(0, top); y < Math.min(height, bottom); y++) {
      for (let x = Math.max(0, left); x < Math.min(width, right); x++) {
        total++
        if (mask[y * width + x] === 1) ink++
      }
    }
    return total === 0 ? 1 : ink / total
  }

  const verticalWall = (x: number, top: number, bottom: number) => {
    const wiggle = Math.max(1, Math.round(scale))
    let covered = 0
    for (let y = top; y <= bottom; y++) {
      for (let offset = -wiggle; offset <= wiggle; offset++) {
        if (dark(x + offset, y)) {
          covered++
          break
        }
      }
    }
    return covered >= (bottom - top + 1) * WALL_COVERAGE
  }

  // Dark runs along each row, joined with the same run in the rows below it.
  const minRun = Math.round(MIN_CHECKBOX * scale)
  const open = new Map<string, Segment>()
  const segments: Segment[] = []
  for (let y = 0; y <= height; y++) {
    const seen = new Set<string>()
    if (y < height) {
      let x = 0
      while (x < width) {
        if (mask[y * width + x] !== 1) {
          x++
          continue
        }
        const start = x
        while (x < width && mask[y * width + x] === 1) x++
        if (x - start < minRun) continue
        const key = `${Math.round(start / 4)}:${Math.round((x - start) / 4)}`
        const previous = open.get(key)
        if (previous) previous.thickness++
        else open.set(key, { x: start, y, length: x - start, thickness: 1 })
        seen.add(key)
      }
    }
    for (const [key, segment] of open) {
      if (seen.has(key)) continue
      open.delete(key)
      if (segment.thickness <= MAX_LINE_THICKNESS * scale) segments.push(segment)
    }
  }

  const boxes: { box: Rect; top: Segment; bottom: Segment }[] = []
  const used = new Set<Segment>()
  const near = (a: number, b: number) => Math.abs(a - b) <= 2 * scale

  for (const top of [...segments].sort((a, b) => a.y - b.y)) {
    if (used.has(top)) continue
    // The nearest line below of the same span that walls join up makes a box.
    const bottom = segments
      .filter(
        (other) =>
          other !== top &&
          !used.has(other) &&
          other.y > top.y + MIN_CHECKBOX * scale * 0.8 &&
          other.y - top.y <= MAX_TEXT_BOX_HEIGHT * scale &&
          near(other.x, top.x) &&
          near(other.length, top.length)
      )
      .sort((a, b) => a.y - b.y)[0]
    if (!bottom) continue
    const bottomY = bottom.y + bottom.thickness - 1
    const right = top.x + top.length - 1
    if (!verticalWall(top.x, top.y, bottomY) || !verticalWall(right, top.y, bottomY)) continue
    // The bowl of a large letter is closed too, but it has no corners.
    if (!(dark(top.x, top.y) && dark(right, top.y) && dark(top.x, bottomY) && dark(right, bottomY))) continue
    const margin = Math.ceil(3 * scale)
    const empty =
      inkShare(top.x + margin, top.y + top.thickness + margin, top.x + top.length - margin, bottom.y - margin) <= MAX_INK_INSIDE
    if (!empty) continue
    used.add(top)
    used.add(bottom)
    boxes.push({
      top,
      bottom,
      box: { x: top.x / scale, y: top.y / scale, width: top.length / scale, height: (bottomY - top.y + 1) / scale }
    })
  }

  /** A box to mark stands free. A letter that looks like one has its neighbours and tails around it. */
  const standsFree = (box: Rect) => {
    const left = Math.round(box.x * scale)
    const top = Math.round(box.y * scale)
    const right = Math.round((box.x + box.width) * scale)
    const bottom = Math.round((box.y + box.height) * scale)
    const gap = Math.ceil(scale)
    const ring = Math.ceil(2 * scale)
    return (
      inkShare(left - ring, top - gap - ring, right + ring, top - gap) <= MAX_INK_INSIDE &&
      inkShare(left - ring, bottom + gap, right + ring, bottom + gap + ring) <= MAX_INK_INSIDE &&
      inkShare(left - gap - ring, top, left - gap, bottom) <= MAX_INK_INSIDE &&
      inkShare(right + gap, top, right + gap + ring, bottom) <= MAX_INK_INSIDE
    )
  }

  const textBoxes: Rect[] = []
  const checkBoxes: Rect[] = []
  for (const { box } of boxes) {
    const squarish = Math.max(box.width, box.height) / Math.min(box.width, box.height) <= SQUARE_TOLERANCE
    if (squarish && box.width >= MIN_CHECKBOX && box.width <= MAX_CHECKBOX) {
      if (standsFree(box)) checkBoxes.push(box)
    } else if (box.height >= MIN_TEXT_BOX_HEIGHT && box.width >= MIN_LINE_LENGTH) textBoxes.push(box)
  }

  const lines: Rect[] = []
  const inBox = (segment: Segment) =>
    boxes.some(({ box }) => {
      const x = segment.x / scale
      const y = segment.y / scale
      return x >= box.x - 2 && x <= box.x + box.width + 2 && y >= box.y - 2 && y <= box.y + box.height + 2
    })
  // A wall going up or down from the end of a line makes it the edge of a box or a table.
  const wallLength = Math.round(MIN_CHECKBOX * scale)
  const hasWall = (x: number, y: number) =>
    verticalWall(x, y - wallLength, y - 1) || verticalWall(x, y + 1, y + wallLength)
  // Crossing marks and rendering can break one line into pieces, which would each look short.
  const pieces = segments.filter((segment) => !used.has(segment)).sort((a, b) => a.y - b.y || a.x - b.x)
  const whole: Segment[] = []
  for (const piece of pieces) {
    const line = whole.find(
      (other) =>
        Math.abs(other.y - piece.y) <= scale &&
        piece.x >= other.x &&
        piece.x - (other.x + other.length) <= LINE_BREAK * scale
    )
    if (line) line.length = Math.max(line.length, piece.x + piece.length - line.x)
    else whole.push({ ...piece })
  }

  for (const segment of whole) {
    if (segment.length < MIN_LINE_LENGTH * scale || inBox(segment)) continue
    // Across nearly the whole page, a line divides the page more often than it is written on.
    if (segment.length > width * MAX_LINE_SHARE) continue
    if (hasWall(segment.x, segment.y) || hasWall(segment.x + segment.length - 1, segment.y)) continue
    const room = Math.round(MIN_SPACE_ABOVE_LINE * scale)
    const gap = Math.ceil(scale)
    // A line under written text, or a rule through a table, has no room to write on.
    if (inkShare(segment.x, segment.y - room - gap, segment.x + segment.length, segment.y - gap) > MAX_INK_INSIDE) continue
    lines.push({ x: segment.x / scale, y: segment.y / scale, width: segment.length / scale, height: segment.thickness / scale })
  }

  return { lines, textBoxes, checkBoxes }
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** Fields for the spots found on a page, leaving out those where something is already. */
export function fieldsForSpots(
  spots: DetectedSpots,
  taken: Rect[],
  page: Size,
  measure: MeasureText,
  newId: () => string
): Field[] {
  const fields: Field[] = []
  const place = (field: Field) => {
    if (taken.some((rect) => overlaps(rect, field)) || fields.some((other) => overlaps(other, field))) return
    if (field.x < 0 || field.y < 0 || field.x + field.width > page.width || field.y + field.height > page.height) return
    fields.push(field)
  }
  const textField = (x: number, y: number, fontSize: number): TextField => ({
    ...newTextField(newId()),
    x,
    y,
    fontSize,
    width: measure('Aa', fontSize),
    height: fontSize * LINE_HEIGHT
  })

  for (const box of spots.checkBoxes) {
    const size = Math.max(CHECKBOX_SIZE * 0.5, Math.min(box.width, box.height) - INSET)
    const field: CheckboxField = {
      ...newCheckboxField(newId()),
      value: null,
      width: size,
      height: size,
      x: box.x + (box.width - size) / 2,
      y: box.y + (box.height - size) / 2
    }
    place(field)
  }
  for (const box of spots.textBoxes) {
    const fontSize = Math.min(MAX_FONT_SIZE, (box.height - INSET * 2) / LINE_HEIGHT)
    const field = textField(box.x + INSET, box.y + (box.height - fontSize * LINE_HEIGHT) / 2, fontSize)
    place(field)
  }
  for (const line of spots.lines) {
    const fontSize = MAX_FONT_SIZE
    place(textField(line.x + 1, line.y - fontSize * LINE_HEIGHT - 0.5, fontSize))
  }
  return fields
}
