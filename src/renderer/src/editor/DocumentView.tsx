import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { anchorAt, anchorPosition, computeLayout, type ScrollAnchor } from '../../../core/pageLayout'
import { useVisibleRange } from '../render/useVisibleRange'
import { useEditor } from '../store'
import { useDisplayedSizes, usePages } from './displayedPages'
import { PageView } from './PageView'

const PAGE_GAP = 8
const SIDE_PADDING = 8

export function DocumentView() {
  const pages = usePages()
  const sizes = useDisplayedSizes(pages)
  const zoom = useEditor((state) => state.zoom)
  const setCurrentPage = useEditor((state) => state.setCurrentPage)
  const scrollRequest = useEditor((state) => state.scrollRequest)

  const container = useRef<HTMLDivElement>(null)
  const [areaWidth, setAreaWidth] = useState(0)

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const measure = () => setAreaWidth(element.clientWidth)
    measure()
    const resizes = new ResizeObserver(measure)
    resizes.observe(element)
    return () => resizes.disconnect()
  }, [])

  const layout = useMemo(
    () => computeLayout(sizes, (areaWidth - SIDE_PADDING * 2) * zoom, PAGE_GAP),
    [sizes, areaWidth, zoom]
  )
  const contentWidth = (layout.widths[0] ?? 0) + SIDE_PADDING * 2
  const range = useVisibleRange(container, layout, window.innerHeight)

  // What the middle of the view is showing, so zooming or changing other pages stays on the same spot.
  const anchor = useRef<{ pageId: string; position: ScrollAnchor } | null>(null)
  const horizontalCentre = useRef(0.5)
  // Where the app itself last scrolled to. Only the reader's own scrolling picks
  // the current page: at the end of a document, the page in the middle of the view
  // is not the one a thumbnail click asked for.
  const appScrollTop = useRef<number | null>(null)

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    if (anchor.current) {
      const { pageId, position } = anchor.current
      const index = pages.findIndex((page) => page.id === pageId)
      // A deleted page leaves its neighbour in view, through the index it had.
      const target = index >= 0 ? { ...position, index } : position
      element.scrollTop = anchorPosition(layout, target) - element.clientHeight / 2
    }
    element.scrollLeft = horizontalCentre.current * element.scrollWidth - element.clientWidth / 2
    appScrollTop.current = element.scrollTop
    // Pages and layout change together, the layout is what moves things on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout])

  useEffect(() => {
    const element = container.current
    if (!element) return
    const onScroll = () => {
      const middle = element.scrollTop + element.clientHeight / 2
      const position = anchorAt(layout, middle)
      const page = pages[position.index]
      horizontalCentre.current = (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth
      if (!page) return
      anchor.current = { pageId: page.id, position }
      const scrolledByApp = appScrollTop.current !== null && Math.abs(element.scrollTop - appScrollTop.current) < 1
      appScrollTop.current = null
      if (!scrolledByApp) setCurrentPage(page.id)
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [layout, pages, setCurrentPage])

  useEffect(() => {
    const element = container.current
    if (!element || !scrollRequest) return
    const index = pages.findIndex((page) => page.id === scrollRequest.pageId)
    if (index >= 0) {
      element.scrollTop = layout.tops[index]! - PAGE_GAP
      appScrollTop.current = element.scrollTop
    }
    // Only a new request scrolls. Layout changes keep the reader's position through the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest])

  return (
    <section className="document-area">
      <div
        className="document-scroll"
        data-testid="document-scroll"
        ref={container}
        onClick={(event) => {
          // A click beside the pages takes the focus off the field. A page handles its own clicks.
          if (!(event.target as Element).closest('.page')) useEditor.getState().focusField(null)
        }}
      >
        <div className="page-strip" style={{ gap: PAGE_GAP, padding: PAGE_GAP, minWidth: contentWidth }}>
          {pages.map((page, index) => (
            <PageView
              key={page.id}
              page={page}
              width={layout.widths[index]!}
              height={layout.heights[index]!}
              pageWidth={sizes[index]!.width}
              pageHeight={sizes[index]!.height}
              active={index >= range.first && index <= range.last}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
