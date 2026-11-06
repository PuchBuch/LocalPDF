import { clampToPage } from './fields'
import type { Point, Rect, Size } from './geometry'

/** How close to a line, on screen, a dragged edge jumps to it. */
export const SNAP_DISTANCE_PX = 5
/** Lines closer than this count as the same one, whatever rounding did. */
const SAME_LINE = 0.01

export interface SnapGuides {
  x: number[]
  y: number[]
}

export interface Snapped extends Point {
  guides: SnapGuides
}

/** The start, middle and end of a box along an axis. */
const lines = (start: number, length: number) => [start, start + length / 2, start + length]

/** The smallest shift bringing a line of the box onto a line of a neighbour, if one is near. */
function nearestShift(own: number[], others: number[], tolerance: number): number {
  let best = 0
  let bestDistance = tolerance
  let found = false
  for (const line of own) {
    for (const other of others) {
      const distance = Math.abs(other - line)
      if (distance <= bestDistance && (!found || distance < bestDistance)) {
        best = other - line
        bestDistance = distance
        found = true
      }
    }
  }
  return best
}

const touching = (own: number[], others: number[]) =>
  [...new Set(others.filter((other) => own.some((line) => Math.abs(other - line) < SAME_LINE)))]

/**
 * Where a dragged box lands: its edges and middle jump to those of the neighbours
 * within the tolerance, separately along each axis. It stays on the page.
 */
export function snapToNeighbours(box: Rect, neighbours: Rect[], page: Size, tolerance: number): Snapped {
  const verticals = neighbours.flatMap((other) => lines(other.x, other.width))
  const horizontals = neighbours.flatMap((other) => lines(other.y, other.height))
  const start = clampToPage(box, page)
  const moved = {
    ...box,
    x: start.x + nearestShift(lines(start.x, box.width), verticals, tolerance),
    y: start.y + nearestShift(lines(start.y, box.height), horizontals, tolerance)
  }
  const { x, y } = clampToPage(moved, page)
  return {
    x,
    y,
    guides: { x: touching(lines(x, box.width), verticals), y: touching(lines(y, box.height), horizontals) }
  }
}
