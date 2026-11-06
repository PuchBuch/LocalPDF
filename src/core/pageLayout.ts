import type { Size } from './geometry'

export interface PageLayout {
  widths: number[]
  heights: number[]
  tops: number[]
  totalHeight: number
}

export interface PageRange {
  first: number
  last: number
}

/** A vertical strip of pages, all scaled to the same width. */
export function computeLayout(pages: Size[], pageWidth: number, gap: number): PageLayout {
  const width = Math.max(1, Math.round(pageWidth))
  const widths: number[] = []
  const heights: number[] = []
  const tops: number[] = []
  let y = gap
  for (const page of pages) {
    const height = Math.max(1, Math.round((width * page.height) / page.width))
    widths.push(width)
    heights.push(height)
    tops.push(y)
    y += height + gap
  }
  return { widths, heights, tops, totalHeight: y }
}

/** The page at a vertical position. A position in a gap belongs to the page above it. */
export function pageIndexAt(layout: PageLayout, y: number): number {
  let low = 0
  let high = layout.tops.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (layout.tops[middle]! <= y) low = middle
    else high = middle - 1
  }
  return low
}

export function visibleRange(
  layout: PageLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan: number
): PageRange {
  return {
    first: pageIndexAt(layout, scrollTop - overscan),
    last: pageIndexAt(layout, scrollTop + viewportHeight + overscan)
  }
}

export interface ScrollAnchor {
  index: number
  /** Position inside the page, from 0 at its top to 1 at its bottom. */
  fraction: number
}

export function anchorAt(layout: PageLayout, y: number): ScrollAnchor {
  const index = pageIndexAt(layout, y)
  const fraction = (y - layout.tops[index]!) / layout.heights[index]!
  return { index, fraction: Math.min(Math.max(fraction, 0), 1) }
}

export function anchorPosition(layout: PageLayout, anchor: ScrollAnchor): number {
  const index = Math.min(anchor.index, layout.tops.length - 1)
  return layout.tops[index]! + anchor.fraction * layout.heights[index]!
}
