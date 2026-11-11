import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { hasUnsavedChanges } from '../../core/history'
import { MAX_ZOOM, MIN_ZOOM } from '../../core/zoom'
import { PasswordDialog } from './editor/PasswordDialog'
import { FieldsPanel } from './editor/FieldNumbers'
import { RecoveryDialog } from './editor/RecoveryDialog'
import { ScanDialog } from './editor/ScanDialog'
import { SignatureDialog } from './editor/SignatureDialog'
import { DocumentView } from './editor/DocumentView'
import { usePages } from './editor/displayedPages'
import { Thumbnails } from './editor/Thumbnails'
import { LOCALES, t, type Locale } from './i18n'
import { changeLanguage, changeOcrLanguage } from './settings'
import { copyMarkdown, printDocument, saveMarkdown } from './output'
import { chooseAndOpenFiles, requestNewFile, saveDocument, useEditor, type EditScope, type Tool } from './store'

/** Opens files dropped anywhere on the window and keeps the browser from navigating to them. */
function useFileDrop(): boolean {
  const openFiles = useEditor((state) => state.openFiles)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      event.preventDefault()
      setDragging(true)
    }
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      event.preventDefault()
      setDragging(false)
      // The offer to restore a document is answered first.
      if (useEditor.getState().recoveryOffer) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      void Promise.all(
        files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))
      ).then(openFiles)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [openFiles])

  return dragging
}

/** Ctrl+Z and Ctrl+Shift+Z. event.code is the physical key, so they work on any keyboard layout. */
function useHistoryShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyZ' || !(event.ctrlKey || event.metaKey) || event.altKey) return
      const { undo, redo, signingFieldId, scanRequest } = useEditor.getState()
      // The signature dialog has its own undo, and its name input the browser's.
      // Under the scan dialog, the page about to be replaced must stay where it is.
      if (signingFieldId || scanRequest) return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

/** Ctrl+S and Ctrl+P, for an open document with no dialog over it. */
function useOutputShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.code !== 'KeyS' && event.code !== 'KeyP') || !(event.ctrlKey || event.metaKey)) return
      if (event.altKey || event.shiftKey) return
      event.preventDefault()
      const { document, saving, signingFieldId, passwordRequest } = useEditor.getState()
      if (!document?.pages.length || saving || signingFieldId || passwordRequest) return
      void (event.code === 'KeyS' ? saveDocument() : printDocument())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

/** The file name in the title bar, marked while it has unsaved changes. */
function useWindowTitle(): void {
  const name = useEditor((state) => {
    const first = state.document?.pages[0]
    return first ? state.document?.sources[first.sourceId]?.name : undefined
  })
  const unsaved = useEditor((state) => hasUnsavedChanges(state.history, state.savedPoint))
  useEffect(() => {
    document.title = name ? `${unsaved ? '• ' : ''}${name} — ${t.appName}` : t.appName
  }, [name, unsaved])
}

function useEscape(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const { cancelPaste, closeSignature } = useEditor.getState()
      cancelPaste()
      closeSignature()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

const TOOLS: { tool: Tool; icon: string }[] = [
  { tool: 'cursor', icon: '➤' },
  { tool: 'edit', icon: '✎' },
  { tool: 'text', icon: 'Aa' },
  { tool: 'checkbox', icon: '☑' },
  { tool: 'signature', icon: '✍' },
  { tool: 'picture', icon: '🖼' },
  { tool: 'comb', icon: '▦' }
]

function ToolPicker() {
  const activeTool = useEditor((state) => state.activeTool)
  const selectTool = useEditor((state) => state.selectTool)

  return (
    <div className="tool-picker">
      <div className="tool-buttons">
        {TOOLS.map(({ tool, icon }) => (
          <button
            key={tool}
            type="button"
            className={tool === activeTool ? 'active' : undefined}
            data-testid={`tool-${tool}`}
            aria-label={t.tools[tool].label}
            aria-pressed={tool === activeTool}
            title={t.tools[tool].label}
            onClick={() => selectTool(tool)}
          >
            {icon}
          </button>
        ))}
      </div>
      {activeTool === 'edit' && <EditScopePicker />}
      <p className="tool-hint" data-testid="tool-hint">
        {t.tools[activeTool].hint}
      </p>
    </div>
  )
}

function EditScopePicker() {
  const editScope = useEditor((state) => state.editScope)
  const setEditScope = useEditor((state) => state.setEditScope)
  const scopes: EditScope[] = ['line', 'word']

  return (
    <div className="edit-scope" role="group" aria-label={t.editScope.label}>
      {scopes.map((scope) => (
        <button
          key={scope}
          type="button"
          className={scope === editScope ? 'active' : undefined}
          data-testid={`edit-scope-${scope}`}
          aria-pressed={scope === editScope}
          onClick={() => setEditScope(scope)}
        >
          {t.editScope[scope]}
        </button>
      ))}
    </div>
  )
}

function ZoomControls() {
  const zoom = useEditor((state) => state.zoom)
  const zoomIn = useEditor((state) => state.zoomIn)
  const zoomOut = useEditor((state) => state.zoomOut)

  return (
    <div className="zoom-controls">
      <button
        type="button"
        data-testid="decrease-zoom-level"
        aria-label={t.zoomOut}
        title={t.zoomOut}
        disabled={zoom <= MIN_ZOOM}
        onClick={zoomOut}
      >
        −
      </button>
      <output data-testid="zoom-level">{t.zoomPercent(zoom)}</output>
      <button
        type="button"
        data-testid="increase-zoom-level"
        aria-label={t.zoomIn}
        title={t.zoomIn}
        disabled={zoom >= MAX_ZOOM}
        onClick={zoomIn}
      >
        +
      </button>
    </div>
  )
}

/** Space between the output menu and its button or the edge of the window. */
const MENU_GAP = 4

function DownloadButton() {
  const saving = useEditor((state) => state.saving)
  const statusNote = useEditor((state) => state.statusNote)
  const [menuOpen, setMenuOpen] = useState(false)
  const group = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    // Capturing, because a scroll inside the panel does not reach the window otherwise.
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menuOpen])

  // The panel scrolls and would cut the menu off, so it is placed on the window itself.
  useLayoutEffect(() => {
    const anchor = group.current?.getBoundingClientRect()
    const element = menu.current
    if (!menuOpen || !anchor || !element) return
    const height = element.getBoundingClientRect().height
    const below = anchor.bottom + MENU_GAP
    const fitsBelow = below + height <= window.innerHeight - MENU_GAP
    element.style.top = `${fitsBelow ? below : Math.max(MENU_GAP, anchor.top - MENU_GAP - height)}px`
    element.style.right = `${window.innerWidth - anchor.right}px`
  }, [menuOpen])

  const outputs = [
    { testId: 'print-document', label: t.print, run: printDocument },
    { testId: 'copy-markdown', label: t.copyMarkdown, run: () => copyMarkdown() },
    { testId: 'save-markdown', label: t.saveMarkdown, run: saveMarkdown }
  ]

  return (
    <>
      <div className="download-group" ref={group}>
        <button type="button" className="primary" data-testid="download" disabled={saving} onClick={() => void saveDocument()}>
          {saving ? t.saving : t.download}
        </button>
        <button
          type="button"
          className="primary"
          data-testid="more-download"
          aria-label={t.moreOptions}
          aria-expanded={menuOpen}
          title={t.moreOptions}
          disabled={saving}
          onClick={(event) => {
            event.stopPropagation()
            setMenuOpen((open) => !open)
          }}
        >
          ▾
        </button>
        {menuOpen && (
          <div className="download-menu" role="menu" ref={menu}>
            {outputs.map(({ testId, label, run }) => (
              <button key={testId} type="button" role="menuitem" data-testid={testId} onClick={() => void run()}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {statusNote && (
        <p className="saved-note" data-testid="saved-note">
          {statusNote}
        </p>
      )}
    </>
  )
}

function ContextBanners() {
  const pasting = useEditor((state) => state.clipboard !== null)
  const resizing = useEditor((state) => state.resizing)
  const dragging = useEditor((state) => state.dragging)
  if (dragging) {
    return (
      <div className="context-banner" data-testid="move-banner">
        {t.moveHint}
      </div>
    )
  }
  if (pasting) {
    return (
      <div className="context-banner" data-testid="paste-banner">
        {t.pasteHint}
      </div>
    )
  }
  if (resizing) {
    return (
      <div className="context-banner" data-testid="resize-banner">
        {t.resizeHint}
      </div>
    )
  }
  return null
}

function LanguagePicker() {
  const locale = useEditor((state) => state.locale)
  return (
    <label className="language-picker">
      <span>{t.language}</span>
      <select
        data-testid="language"
        value={locale}
        onChange={(event) => changeLanguage(event.target.value as Locale)}
      >
        {LOCALES.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}

function OcrLanguagePicker() {
  const ocrLocale = useEditor((state) => state.ocrLocale)
  return (
    <label className="language-picker">
      <span>{t.ocrLanguage}</span>
      <select
        data-testid="ocr-language"
        value={ocrLocale}
        onChange={(event) => changeOcrLanguage(event.target.value as Locale)}
      >
        {LOCALES.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}

function EmptyState({ opening }: { opening: boolean }) {
  return (
    <main className="empty-state">
      <div className="empty-state-settings">
        <LanguagePicker />
      </div>
      <h1>{t.appName}</h1>
      <div className="dropzone">
        <button
          type="button"
          className="primary"
          data-testid="select-file"
          disabled={opening}
          onClick={() => void chooseAndOpenFiles()}
        >
          {t.selectFile}
        </button>
        <p>{opening ? t.opening : t.dropHint}</p>
      </div>
    </main>
  )
}

function Workspace({ pageCount }: { pageCount: number }) {
  const pages = usePages()
  const currentPageId = useEditor((state) => state.currentPageId)
  const canUndo = useEditor((state) => state.history.past.length > 0)
  const canRedo = useEditor((state) => state.history.future.length > 0)
  const undo = useEditor((state) => state.undo)
  const redo = useEditor((state) => state.redo)
  const currentNumber = pages.findIndex((page) => page.id === currentPageId) + 1

  return (
    <div className="workspace">
      <Thumbnails />
      <DocumentView />
      <aside className="tools">
        <div className="history-buttons">
          <button type="button" data-testid="undo" title="Ctrl+Z" disabled={!canUndo} onClick={undo}>
            ↶ {t.undo}
          </button>
          <button type="button" data-testid="redo" title="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}>
            ↷ {t.redo}
          </button>
        </div>
        <ToolPicker />
        <FieldsPanel />
        <p className="page-counter" data-testid="page-counter">
          {t.pageOf(currentNumber, pageCount)}
        </p>
        <ZoomControls />
        <DownloadButton />
        <button type="button" data-testid="new-file" onClick={() => void requestNewFile()}>
          {t.newFile}
        </button>
        <div className="panel-settings">
          <LanguagePicker />
          <OcrLanguagePicker />
        </div>
      </aside>
    </div>
  )
}

function Notices() {
  const notices = useEditor((state) => state.notices)
  const dismissNotice = useEditor((state) => state.dismissNotice)
  if (notices.length === 0) return null

  return (
    <div className="notices" role="alert">
      {notices.map((notice, index) => (
        <p key={`${index}-${notice}`} data-testid="notice">
          <span>{notice}</span>
          <button type="button" aria-label={t.close} title={t.close} onClick={() => dismissNotice(index)}>
            ✕
          </button>
        </p>
      ))}
    </div>
  )
}

export function App() {
  const pageCount = useEditor((state) => state.document?.pages.length ?? 0)
  const opening = useEditor((state) => state.pendingFiles > 0)
  const dragging = useFileDrop()
  const signingFieldId = useEditor((state) => state.signingFieldId)
  const recoveryOffer = useEditor((state) => state.recoveryOffer)
  const passwordRequest = useEditor((state) => state.passwordRequest)
  const scanRequest = useEditor((state) => state.scanRequest)
  useHistoryShortcuts()
  useOutputShortcuts()
  useWindowTitle()
  useEscape()

  return (
    <>
      {pageCount > 0 ? <Workspace pageCount={pageCount} /> : <EmptyState opening={opening} />}
      {signingFieldId && <SignatureDialog fieldId={signingFieldId} />}
      {recoveryOffer && <RecoveryDialog savedAt={recoveryOffer.savedAt} names={recoveryOffer.names} />}
      {passwordRequest && <PasswordDialog name={passwordRequest.name} wrong={passwordRequest.wrong} />}
      {scanRequest && <ScanDialog request={scanRequest} />}
      <ContextBanners />
      <Notices />
      {dragging && <div className="drop-overlay">{t.dropOverlay}</div>}
    </>
  )
}
