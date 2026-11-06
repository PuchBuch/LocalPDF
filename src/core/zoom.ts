/** 100% fits the page to the width of the document area. */
export const DEFAULT_ZOOM = 1
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 8

export function increaseZoom(zoom: number): number {
  return Math.min(zoom + (zoom < 1 ? 0.25 : 0.5), MAX_ZOOM)
}

export function decreaseZoom(zoom: number): number {
  return Math.max(zoom - (zoom <= 1 ? 0.25 : 0.5), MIN_ZOOM)
}

/** Keeps a page canvas within this many pixels however far the page is zoomed. */
export const MAX_CANVAS_PIXELS = 16_000_000

/**
 * Scale to draw a page at, relative to its size in points. Above the pixel limit
 * the canvas stays smaller and the browser stretches it.
 */
export function canvasScale(
  page: { width: number; height: number },
  displayScale: number,
  devicePixelRatio: number
): number {
  const limit = Math.sqrt(MAX_CANVAS_PIXELS / (page.width * page.height))
  return Math.min(displayScale * devicePixelRatio, limit)
}
