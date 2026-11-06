import type { Rotation } from './model'

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect extends Point, Size {}

export function normalizeRotation(angle: number): Rotation {
  const normalized = ((angle % 360) + 360) % 360
  if (normalized % 90 !== 0) throw new Error(`Page rotation must be a multiple of 90, got ${angle}`)
  return normalized as Rotation
}

/** Size of a page box as it is displayed with the given rotation. */
export function displayedSize(box: Size, rotation: Rotation): Size {
  return rotation === 90 || rotation === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height }
}

const LETTER = { x: 0, y: 0, width: 612, height: 792 }

function normalized({ x, y, width, height }: Rect): Rect {
  return { x: Math.min(x, x + width), y: Math.min(y, y + height), width: Math.abs(width), height: Math.abs(height) }
}

/**
 * The part of a page a viewer shows: its crop box inside its media box. A viewer falls
 * back on the media box for a crop box outside it, and on a Letter page for an empty
 * media box. Places on the screen and in the file only agree if this does too.
 */
export function visibleBox(cropBox: Rect, mediaBox: Rect): Rect {
  const media = normalized(mediaBox)
  if (media.width === 0 || media.height === 0) return LETTER
  const crop = normalized(cropBox)
  const left = Math.max(crop.x, media.x)
  const bottom = Math.max(crop.y, media.y)
  const right = Math.min(crop.x + crop.width, media.x + media.width)
  const top = Math.min(crop.y + crop.height, media.y + media.height)
  if (right <= left || top <= bottom) return media
  return { x: left, y: bottom, width: right - left, height: top - bottom }
}

/**
 * Converts a point on the displayed page (top-left origin, y down) to PDF user
 * space (y up), for a page with the given crop box and total clockwise rotation.
 */
export function displayToPdf(box: Rect, rotation: Rotation, point: Point): Point {
  const { x, y } = point
  switch (rotation) {
    case 0:
      return { x: box.x + x, y: box.y + box.height - y }
    case 90:
      return { x: box.x + y, y: box.y + x }
    case 180:
      return { x: box.x + box.width - x, y: box.y + y }
    case 270:
      return { x: box.x + box.width - y, y: box.y + box.height - x }
  }
}

/**
 * Where a field goes when its page turns 90 degrees clockwise: its centre stays
 * over the same page content, its box stays upright and inside the new page.
 */
export function rotateRectClockwise(rect: Rect, pageBeforeRotation: Size): Rect {
  const centerX = pageBeforeRotation.height - (rect.y + rect.height / 2)
  const centerY = rect.x + rect.width / 2
  return {
    x: clamp(centerX - rect.width / 2, 0, pageBeforeRotation.height - rect.width),
    y: clamp(centerY - rect.height / 2, 0, pageBeforeRotation.width - rect.height),
    width: rect.width,
    height: rect.height
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
