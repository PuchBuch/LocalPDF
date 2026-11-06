import { describe, expect, it } from 'vitest'
import { classifyLoadError } from '../src/core/loadError'
import { anchorAt, anchorPosition, computeLayout, pageIndexAt, visibleRange } from '../src/core/pageLayout'
import { canvasScale, decreaseZoom, increaseZoom, MAX_CANVAS_PIXELS, MAX_ZOOM, MIN_ZOOM } from '../src/core/zoom'

const A4 = { width: 595, height: 842 }
const LANDSCAPE = { width: 842, height: 595 }

describe('zoom steps', () => {
  it('goes through the steps from the spec', () => {
    const steps = [MIN_ZOOM]
    while (steps.at(-1)! < 3) steps.push(increaseZoom(steps.at(-1)!))
    expect(steps).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3])
  })

  it('comes back down by the same steps', () => {
    const steps = [3]
    while (steps.at(-1)! > MIN_ZOOM) steps.push(decreaseZoom(steps.at(-1)!))
    expect(steps).toEqual([3, 2.5, 2, 1.5, 1, 0.75, 0.5, 0.25])
  })

  it('stops at both limits', () => {
    expect(decreaseZoom(MIN_ZOOM)).toBe(MIN_ZOOM)
    expect(increaseZoom(MAX_ZOOM)).toBe(MAX_ZOOM)
  })
})

describe('canvasScale', () => {
  it('follows the display scale and pixel density of ordinary zoom levels', () => {
    expect(canvasScale(A4, 1.5, 2)).toBeCloseTo(3)
  })

  it('never exceeds the pixel limit', () => {
    const scale = canvasScale(A4, 12, 2)
    expect(A4.width * scale * A4.height * scale).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1)
  })
})

describe('computeLayout', () => {
  it('gives every page the same width, so a landscape page is fitted to the width too', () => {
    const layout = computeLayout([A4, LANDSCAPE], 800, 8)
    expect(layout.widths).toEqual([800, 800])
    expect(layout.heights).toEqual([1132, 565])
  })

  it('stacks pages with a gap around each one', () => {
    const layout = computeLayout([A4, A4], 595, 10)
    expect(layout.tops).toEqual([10, 862])
    expect(layout.totalHeight).toBe(1714)
  })
})

describe('positions in the strip', () => {
  const layout = computeLayout(Array.from({ length: 100 }, () => A4), 595, 8)

  it('finds the page at a position', () => {
    expect(pageIndexAt(layout, 0)).toBe(0)
    expect(pageIndexAt(layout, layout.tops[50]!)).toBe(50)
    expect(pageIndexAt(layout, layout.tops[50]! - 1)).toBe(49)
    expect(pageIndexAt(layout, layout.totalHeight + 500)).toBe(99)
  })

  it('selects only the pages near the view', () => {
    expect(visibleRange(layout, layout.tops[50]!, 800, 0)).toEqual({ first: 50, last: 50 })
    expect(visibleRange(layout, layout.tops[50]!, 800, 900)).toEqual({ first: 48, last: 52 })
    expect(visibleRange(layout, 0, 800, 900)).toEqual({ first: 0, last: 1 })
  })

  it('keeps an anchor on the same spot of the page through a zoom', () => {
    const y = layout.tops[20]! + layout.heights[20]! / 4
    const anchor = anchorAt(layout, y)
    expect(anchor.index).toBe(20)
    expect(anchor.fraction).toBeCloseTo(0.25)

    const zoomed = computeLayout(Array.from({ length: 100 }, () => A4), 1190, 8)
    expect(anchorPosition(zoomed, anchor)).toBeCloseTo(zoomed.tops[20]! + zoomed.heights[20]! / 4)
  })

  it('moves an anchor to the last page when its page is gone', () => {
    const shorter = computeLayout([A4, A4], 595, 8)
    expect(anchorPosition(shorter, { index: 50, fraction: 0 })).toBe(shorter.tops[1])
  })
})

describe('opening files', () => {
  it('tells a password from any other failure', () => {
    expect(classifyLoadError({ name: 'PasswordException' })).toBe('password')
    expect(classifyLoadError({ name: 'InvalidPDFException' })).toBe('unreadable')
    expect(classifyLoadError(null)).toBe('unreadable')
  })

})
