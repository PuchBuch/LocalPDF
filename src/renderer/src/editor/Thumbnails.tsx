import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { computeLayout } from '../../../core/pageLayout'
import type { PageRef } from '../../../core/model'
import { t } from '../i18n'
import { usePageRender } from '../render/usePageRender'
import { useVisibleRange } from '../render/useVisibleRange'
import { chooseAndOpenFiles, useEditor } from '../store'
import { useDisplayedSizes, usePages } from './displayedPages'
import { StaticFieldLayer } from './FieldView'
import { FormLayer } from './FormLayer'
import { ThumbnailMenu, type ThumbnailMenuPlace } from './ThumbnailMenu'

const THUMBNAIL_WIDTH = 132
/** Holds the page number under each thumbnail. */
const THUMBNAIL_GAP = 36
const OVERSCAN = 600

export function Thumbnails() {
  const pages = usePages()
  const sizes = useDisplayedSizes(pages)
  const currentPageId = useEditor((state) => state.currentPageId)

  const [menu, setMenu] = useState<ThumbnailMenuPlace | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const container = useRef<HTMLDivElement>(null)
  const layout =useMemo(() => computeLayout(sizes, THUMBNAIL_WIDTH, THUMBNAIL_GAP), [sizes])
  const range = useVisibleRange(container, layout, OVERSCAN)

  const currentIndex = pages.findIndex((page) => page.id === currentPageId)

  useEffect(() => {
    const element = container.current
    if (!element || currentIndex < 0) return
    const top = layout.tops[currentIndex]!
    const bottom = top + layout.heights[currentIndex]! + THUMBNAIL_GAP
    if (top - THUMBNAIL_GAP < element.scrollTop) element.scrollTop = top - THUMBNAIL_GAP
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight
  }, [currentIndex, layout])

  return (
    <nav className="thumbnails" data-testid="thumbnails" ref={container} onScroll={closeMenu}>
      {menu && <ThumbnailMenu {...menu} onClose={closeMenu} />}
      <div className="thumbnail-strip" style={{ paddingTop: THUMBNAIL_GAP / 2 }}>
        {pages.map((page, index) => (
          <Thumbnail
            key={page.id}
            page={page}
            number={index + 1}
            height={layout.heights[index]!}
            pageWidth={sizes[index]!.width}
            active={index >= range.first && index <= range.last}
            current={page.id === currentPageId}
            onlyPage={pages.length === 1}
            first={index === 0}
            last={index === pages.length - 1}
            onMenu={setMenu}
          />
        ))}
        <button
          type="button"
          className="add-pages"
          data-testid="add-pages"
          aria-label={t.addPages}
          title={t.addPages}
          onClick={() => void chooseAndOpenFiles()}
        >
          +
        </button>
      </div>
    </nav>
  )
}

interface ThumbnailProps {
  page: PageRef
  number: number
  height: number
  /** Width of the displayed page in points. */
  pageWidth: number
  active: boolean
  current: boolean
  onlyPage: boolean
  first: boolean
  last: boolean
  onMenu: (place: ThumbnailMenuPlace) => void
}

const Thumbnail = memo(function Thumbnail({
  page,
  number,
  height,
  pageWidth,
  active,
  current,
  onlyPage,
  first,
  last,
  onMenu
}: ThumbnailProps) {
  const canvasHost = useRef<HTMLDivElement>(null)
  usePageRender({ canvasHost, page, width: THUMBNAIL_WIDTH, active })

  // The actions come from the store directly, so they do not break the memo above.
  const { goToPage, deletePage, rotatePage, movePage } = useEditor.getState()

  return (
    <div className="thumbnail-item" style={{ height: height + THUMBNAIL_GAP }}>
      <div className="page-actions">
        <button
          type="button"
          data-testid="delete-page"
          aria-label={t.deletePage}
          title={t.deletePage}
          disabled={onlyPage}
          onClick={() => deletePage(page.id)}
        >
          ✕
        </button>
        <button
          type="button"
          data-testid="rotate-page"
          aria-label={t.rotatePage}
          title={t.rotatePage}
          onClick={() => rotatePage(page.id)}
        >
          ⟳
        </button>
        <button
          type="button"
          data-testid="move-page-up"
          aria-label={t.movePageUp}
          title={t.movePageUp}
          disabled={first}
          onClick={() => movePage(page.id, -1)}
        >
          ↑
        </button>
        <button
          type="button"
          data-testid="move-page-down"
          aria-label={t.movePageDown}
          title={t.movePageDown}
          disabled={last}
          onClick={() => movePage(page.id, 1)}
        >
          ↓
        </button>
      </div>
      <button
        type="button"
        className={current ? 'thumbnail current' : 'thumbnail'}
        data-testid="page-thumbnail"
        aria-label={t.goToPage(number)}
        aria-current={current ? 'page' : undefined}
        onClick={() => goToPage(page.id)}
        onContextMenu={(event) => {
          event.preventDefault()
          onMenu({ pageId: page.id, x: event.clientX, y: event.clientY })
        }}
      >
        <div className="thumbnail-page" style={{ width: THUMBNAIL_WIDTH, height }}>
          <div className="thumbnail-canvas" ref={canvasHost} />
          <FormLayer page={page} scale={THUMBNAIL_WIDTH / pageWidth} readOnly />
          <StaticFieldLayer fields={page.fields} scale={THUMBNAIL_WIDTH / pageWidth} />
        </div>
        <span className="thumbnail-number" data-testid="page-number">
          {number}
        </span>
      </button>
    </div>
  )
})
