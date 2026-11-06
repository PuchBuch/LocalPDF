import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { copyMarkdown } from '../output'
import { findFields, recognizeText } from '../pageTools'
import { useEditor } from '../store'

export interface ThumbnailMenuPlace {
  pageId: string
  x: number
  y: number
}

const SCREEN_MARGIN = 8

interface ThumbnailMenuProps extends ThumbnailMenuPlace {
  onClose: () => void
}

interface PagesChoiceProps {
  label: string
  testId: string
  /** Runs for the given page, or for all pages without one. */
  run: (pageId?: string) => void
  pageId: string
}

/** An item that opens a choice between this page and all pages. */
function PagesChoice({ label, testId, run, pageId }: PagesChoiceProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="menu-parent" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      >
        {label} <span aria-hidden="true">▸</span>
      </button>
      {open && (
        <div className="thumbnail-submenu" role="menu">
          <button type="button" role="menuitem" data-testid={`${testId}-this`} onClick={() => run(pageId)}>
            {t.thumbnailMenu.thisPage}
          </button>
          <button type="button" role="menuitem" data-testid={`${testId}-all`} onClick={() => run()}>
            {t.thumbnailMenu.allPages}
          </button>
        </div>
      )}
    </div>
  )
}

/** What a right click on a thumbnail offers for its page. The page's own form is not touched. */
export function ThumbnailMenu({ pageId, x, y, onClose }: ThumbnailMenuProps) {
  const fieldCount = useEditor(
    (state) => state.document?.pages.find((page) => page.id === pageId)?.fields.length ?? 0
  )
  const [place, setPlace] = useState({ x, y })
  const menu = useRef<HTMLDivElement>(null)
  const { clearPageFields, deletePageFields } = useEditor.getState()

  // Near the bottom of the window, the menu opens upwards so that all of it shows.
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect()
    if (!box) return
    setPlace({
      x: Math.min(x, window.innerWidth - box.width - SCREEN_MARGIN),
      y: Math.max(SCREEN_MARGIN, Math.min(y, window.innerHeight - box.height - SCREEN_MARGIN))
    })
  }, [x, y])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('click', onClose)
    window.addEventListener('blur', onClose)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', onClose)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={menu}
      className="thumbnail-menu"
      role="menu"
      data-testid="thumbnail-menu"
      style={{ left: place.x, top: place.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <PagesChoice
        label={t.thumbnailMenu.copyContent}
        testId="copy-content"
        pageId={pageId}
        run={(page) => void copyMarkdown(page)}
      />
      <PagesChoice label={t.thumbnailMenu.recognize} testId="recognize" pageId={pageId} run={(page) => void recognizeText(page)} />
      <PagesChoice label={t.thumbnailMenu.findFields} testId="find-fields" pageId={pageId} run={(page) => void findFields(page)} />
      <button
        type="button"
        role="menuitem"
        data-testid="clear-fields"
        disabled={fieldCount === 0}
        onClick={() => clearPageFields(pageId)}
      >
        {t.thumbnailMenu.clearFields(fieldCount)}
      </button>
      <button
        type="button"
        role="menuitem"
        className="danger"
        data-testid="delete-fields"
        disabled={fieldCount === 0}
        onClick={() => deletePageFields(pageId)}
      >
        {t.thumbnailMenu.deleteFields(fieldCount)}
      </button>
    </div>
  )
}
