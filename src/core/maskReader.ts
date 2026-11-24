/** A wall may be broken for the rest of this share of its length, as scans are. */
const WALL_COVERAGE = 0.85

export interface MaskReader {
  dark: (x: number, y: number) => boolean
  /** The share of dark pixels in an area, whose right and bottom are outside it. */
  inkShare: (left: number, top: number, right: number, bottom: number) => number
  /** Whether a vertical line runs at x, give or take a point, from top to bottom. */
  verticalWall: (x: number, top: number, bottom: number, coverage?: number) => boolean
}

/**
 * Reads the picture of a page. The mask has one entry per pixel, true where it is dark,
 * and scale is its pixels per point.
 */
export function readMask(mask: Uint8Array, width: number, height: number, scale: number): MaskReader {
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

  const verticalWall = (x: number, top: number, bottom: number, coverage = WALL_COVERAGE) => {
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
    return covered >= (bottom - top + 1) * coverage
  }

  return { dark, inkShare, verticalWall }
}
