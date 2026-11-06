import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { create } from 'zustand'
import {
  addField,
  clearFieldValue,
  exportFileName,
  COMB_MIN_SPACING,
  findField,
  fitCombField,
  fitPictureField,
  fitTextField,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  newCheckboxField,
  newCombField,
  newPictureField,
  newSignatureField,
  newTextField,
  nextCheckboxValue,
  placeField,
  removeField,
  scaleCombFont,
  updateField
} from '../../core/fields'
import { displayedSize, type Point, type Rect, type Size } from '../../core/geometry'
import {
  EMPTY_HISTORY,
  edit,
  hasUnsavedChanges,
  NEVER_SAVED,
  redo,
  savePointOf,
  undo,
  type History,
  type SavePoint,
  type Versioned
} from '../../core/history'
import { classifyLoadError, fileKind } from '../../core/loadError'
import { toFormWidget, type FormWidget, type WidgetAnnotation } from '../../core/forms'
import type {
  CheckboxField,
  EditorDocument,
  Field,
  FormValue,
  ImageAsset,
  OcrWord,
  PageRef,
  PdfSource,
  TextStyle
} from '../../core/model'
import { deletePage, movePage, rotatePageClockwise } from '../../core/pageOperations'
import { coversOf, fieldForLine, type LineAppearance, type PageTextRun, type TextLine, type TextWord } from '../../core/textLines'
import { decreaseZoom, DEFAULT_ZOOM, increaseZoom } from '../../core/zoom'
import { buildPdf } from '../../export/buildPdf'
import { pagesWithLeftoverText, type ContentPage } from '../../export/extractContent'
import { imageToPdf } from '../../export/imageToPdf'
import { looksEncrypted } from '../../export/qpdf'
import type { LocalPdfApi, OpenedFile } from '../../preload'
import { DEFAULT_LOCALE, t, type Locale } from './i18n'
import { imageSize, prepareImage } from './render/imageFile'
import { lineAppearance, wordAppearance } from './render/lineAppearance'
import { closeAllPdfs, getPdfPage, loadPdf, openPdf } from './render/pdfjs'
import { protectPdf, unlockPdf } from './render/protection'
import { loadExportFonts, measureText } from './render/textMetrics'

declare global {
  interface Window {
    localpdf: LocalPdfApi
  }
}

export type Tool = 'cursor' | 'edit' | 'text' | 'checkbox' | 'signature' | 'picture' | 'comb'
export type EditScope = 'line' | 'word'

/** How a field looks until something else is chosen for it. */
const DEFAULT_TEXT_STYLE: TextStyle = { bold: false, italic: false, color: { r: 0, g: 0, b: 0 } }

/** Typing after a longer pause than this starts a new undo step. */
const TYPING_PAUSE_MS = 1000

interface EditorState {
  document: EditorDocument | null
  history: History
  savedPoint: SavePoint
  /** Displayed size of each page in points, before rotations added in the editor. */
  pageSizes: Record<string, Size>
  /** The source PDF's own form fields, by page. They never change, only their values do. */
  formWidgets: Record<string, FormWidget[]>
  zoom: number
  currentPageId: string | null
  /** Bumped by a request to scroll the document to a page. */
  scrollRequest: { pageId: string; serial: number } | null
  activeTool: Tool
  /** What a click takes when editing the text of the page. */
  editScope: EditScope
  focusedFieldId: string | null
  /** A copied field waiting to be pasted. While it is set, a click on a page pastes it. */
  clipboard: Field | null
  /** The signature field whose dialog is open. */
  signingFieldId: string | null
  /** A picture or signature is being resized, which can be freed with Shift. */
  resizing: boolean
  saving: boolean
  locale: Locale
  /** The language of the documents to recognize, which can differ from the app's. */
  ocrLocale: Locale
  /** The result of the last output action, such as where the file went. */
  statusNote: string | null
  /** A field is being dragged, which can line up with its neighbours. */
  dragging: boolean
  /** The file waiting for a password, and whether the last attempt failed. */
  passwordRequest: { name: string; wrong: boolean } | null
  /** Saved files get this password when one was opened with "keep password". */
  outputPassword: string | null
  /** A file opened by password is in the document, so its content must not reach the disk. */
  holdsProtectedContent: boolean
  /** A document left over from a crash, while the question of restoring it is open. */
  recoveryOffer: { savedAt: string; names: string[] } | null
  pendingFiles: number
  notices: string[]
  openFiles: (files: OpenedFile[]) => Promise<void>
  closeDocument: () => void
  deletePage: (pageId: string) => void
  rotatePage: (pageId: string) => void
  movePage: (pageId: string, delta: -1 | 1) => void
  undo: () => void
  redo: () => void
  zoomIn: () => void
  zoomOut: () => void
  setCurrentPage: (pageId: string) => void
  goToPage: (pageId: string) => void
  selectTool: (tool: Tool) => void
  clickPage: (pageId: string, point: Point) => void
  /** Turns a line of the page into a field holding its text, ready for typing. */
  editTextLine: (pageId: string, line: PageTextRun, appearance?: LineAppearance) => void
  setEditScope: (scope: EditScope) => void
  /** Changes the look of a text field. A new colour joins the last one, as a picker sends many. */
  setTextStyle: (fieldId: string, change: Partial<TextStyle>) => void
  focusField: (fieldId: string | null) => void
  typeText: (fieldId: string, value: string) => void
  moveField: (fieldId: string, box: Partial<Rect>) => void
  changeFontSize: (fieldId: string, delta: -1 | 1) => void
  changeSpacing: (fieldId: string, delta: -1 | 1) => void
  openSignature: (fieldId: string) => void
  closeSignature: () => void
  setSignature: (fieldId: string, asset: ImageAsset) => void
  setPicture: (fieldId: string, asset: ImageAsset, size: Size) => void
  setResizing: (resizing: boolean) => void
  setDragging: (dragging: boolean) => void
  setPageOcr: (results: Record<string, OcrWord[]>) => void
  addFoundFields: (found: Record<string, Field[]>) => void
  clearPageFields: (pageId: string) => void
  deletePageFields: (pageId: string) => void
  typeFormText: (sourceId: string, fieldName: string, value: string) => void
  setFormValue: (sourceId: string, fieldName: string, value: FormValue) => void
  toggleBackground: (fieldId: string) => void
  cycleCheckbox: (fieldId: string) => void
  setCheckboxValue: (fieldId: string, value: CheckboxField['value']) => void
  deleteField: (fieldId: string) => void
  copyField: (fieldId: string) => void
  cancelPaste: () => void
  dismissNotice: (index: number) => void
}

interface LoadedFile {
  sourceId: string
  source: PdfSource
  pages: PageRef[]
  sizes: Record<string, Size>
  widgets: Record<string, FormWidget[]>
}

const NO_DOCUMENT = {
  document: null,
  history: EMPTY_HISTORY,
  savedPoint: null,
  pageSizes: {},
  formWidgets: {},
  zoom: DEFAULT_ZOOM,
  currentPageId: null,
  scrollRequest: null,
  activeTool: 'cursor' as Tool,
  focusedFieldId: null,
  clipboard: null,
  signingFieldId: null,
  resizing: false,
  dragging: false,
  statusNote: null,
  outputPassword: null,
  holdsProtectedContent: false
}

export interface PasswordAnswer {
  password: string
  keep: boolean
}

let passwordAnswered: ((answer: PasswordAnswer | null) => void) | null = null

function askPassword(name: string, wrong: boolean): Promise<PasswordAnswer | null> {
  useEditor.setState({ passwordRequest: { name, wrong } })
  return new Promise((done) => {
    passwordAnswered = done
  })
}

export function answerPassword(answer: PasswordAnswer | null): void {
  useEditor.setState({ passwordRequest: null })
  passwordAnswered?.(answer)
  passwordAnswered = null
}

/** An encrypted PDF as plain bytes, asking for its password if it needs one. Null if not given. */
async function unlockedBytes(file: OpenedFile): Promise<Uint8Array | null> {
  const open = await unlockPdf(file.bytes, '')
  if (open.status === 'ok') return open.bytes
  if (open.status === 'failed') throw new Error('The file could not be read')

  let wrong = false
  for (;;) {
    const answer = await askPassword(file.name, wrong)
    if (!answer) return null
    const result = await unlockPdf(file.bytes, answer.password)
    if (result.status === 'failed') throw new Error('The file could not be decrypted')
    if (result.status === 'ok') {
      useEditor.setState((state) => ({
        holdsProtectedContent: true,
        outputPassword: state.outputPassword ?? (answer.keep ? answer.password : null)
      }))
      return result.bytes
    }
    wrong = true
  }
}

async function pdfBytesOf(file: OpenedFile): Promise<Uint8Array | null> {
  const kind = fileKind(file.name)
  if (kind !== 'pdf') return imageToPdf(await prepareImage(kind, file.bytes))
  return looksEncrypted(file.bytes) ? unlockedBytes(file) : file.bytes
}

/** Reads what the editor keeps about a page of a loaded PDF. */
async function readPageData(
  pdf: PDFDocumentProxy,
  hasForm: boolean,
  pageId: string,
  pageIndex: number,
  sizes: Record<string, Size>,
  widgets: Record<string, FormWidget[]>
): Promise<void> {
  const page = await pdf.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 1 })
  sizes[pageId] = { width: viewport.width, height: viewport.height }
  if (hasForm) widgets[pageId] = await readFormWidgets(page)
}

/** Reads a file into pages. Null if its password was not given. */
async function loadFile(file: OpenedFile): Promise<LoadedFile | null> {
  const bytes = await pdfBytesOf(file)
  if (!bytes) return null
  const sourceId = crypto.randomUUID()
  const pdf = await loadPdf(sourceId, bytes)
  const pages: PageRef[] = []
  const sizes: Record<string, Size> = {}
  const widgets: Record<string, FormWidget[]> = {}
  const hasForm = (await pdf.getFieldObjects()) !== null

  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
    const id = crypto.randomUUID()
    pages.push({ id, sourceId, pageIndex, rotation: 0, fields: [] })
    await readPageData(pdf, hasForm, id, pageIndex, sizes, widgets)
  }
  return { sourceId, source: { name: file.name, bytes }, pages, sizes, widgets }
}

async function readFormWidgets(page: PDFPageProxy): Promise<FormWidget[]> {
  const viewport = page.getViewport({ scale: 1 })
  const annotations = (await page.getAnnotations()) as (WidgetAnnotation & { rect: number[] })[]
  return annotations.flatMap((annotation) => {
    const [left, bottom, right, top] = annotation.rect as [number, number, number, number]
    const [x1, y1] = viewport.convertToViewportPoint(left, bottom) as [number, number]
    const [x2, y2] = viewport.convertToViewportPoint(right, top) as [number, number]
    const rect = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
    return toFormWidget(annotation, rect) ?? []
  })
}

function failureNotice(file: OpenedFile, error: unknown): string {
  return classifyLoadError(error) === 'password' ? t.filePassword(file.name) : t.fileUnreadable(file.name)
}

function rejectionNotice(file: OpenedFile): string | undefined {
  const kind = fileKind(file.name)
  if (kind === 'heic') return t.fileHeic(file.name)
  if (kind === 'other') return t.fileUnsupported(file.name)
  return undefined
}

function appendFiles(document: EditorDocument, files: LoadedFile[]): void {
  for (const file of files) {
    document.sources[file.sourceId] = file.source
    document.pages.push(...file.pages)
  }
}

/** The current page, or whichever took its place if it no longer exists. */
function keepCurrentPage(state: EditorState, document: EditorDocument): string | null {
  const { currentPageId } = state
  if (document.pages.some((page) => page.id === currentPageId)) return currentPageId
  const previousIndex = state.document?.pages.findIndex((page) => page.id === currentPageId) ?? 0
  return document.pages[Math.min(previousIndex, document.pages.length - 1)]?.id ?? null
}

function fromVersioned(state: EditorState, next: Versioned<EditorDocument>): Partial<EditorState> {
  const { focusedFieldId } = state
  return {
    document: next.state,
    history: next.history,
    currentPageId: keepCurrentPage(state, next.state),
    // Undo or a deleted page can take the focused field away.
    focusedFieldId: focusedFieldId && findField(next.state, focusedFieldId) ? focusedFieldId : null
  }
}

// The field being typed into, so that a burst of typing is one undo step.
let lastTyping: { fieldId: string; time: number } | null = null

function editDocument(state: EditorState, recipe: (document: EditorDocument) => void): Partial<EditorState> {
  lastTyping = null
  return state.document ? fromVersioned(state, edit(state.document, state.history, recipe)) : {}
}

function currentPageSize(state: EditorState, pageId: string): Size | null {
  const page = state.document?.pages.find((candidate) => candidate.id === pageId)
  const size = state.pageSizes[pageId]
  return page && size ? displayedSize(size, page.rotation) : null
}

/** Adds a field to a page at a point, and focuses it. */
function insertField(state: EditorState, pageId: string, point: Point, field: Field): Partial<EditorState> {
  const page = currentPageSize(state, pageId)
  if (!page) return {}
  const placed = placeField(sizedToContent(field, page), point, page)
  return { ...editDocument(state, (document) => addField(document, pageId, placed)), focusedFieldId: placed.id }
}

function sizedToContent(field: Field, page: Size): Field {
  if (field.type === 'TEXT') return fitTextField(field, measureText, page)
  if (field.type === 'COMB_TEXT') return fitCombField(field, page)
  return field
}

/** Applies a change to a text or comb field and sizes it to its new content. */
function refitted(state: EditorState, fieldId: string, change: (field: Field) => Field): Field | null {
  const found = state.document && findField(state.document, fieldId)
  const page = found && currentPageSize(state, found.pageId)
  return found && page ? sizedToContent(change(found.field), page) : null
}

function assignFormValue(document: EditorDocument, sourceId: string, fieldName: string, value: FormValue): void {
  const values = (document.formValues[sourceId] ??= {})
  values[fieldName] = value
}

function newFieldForTool(tool: Tool, id: string): Field | null {
  switch (tool) {
    case 'text':
      return newTextField(id)
    case 'checkbox':
      return newCheckboxField(id)
    case 'signature':
      return newSignatureField(id)
    case 'picture':
      return newPictureField(id)
    case 'comb':
      return newCombField(id)
    case 'cursor':
    case 'edit':
      return null
  }
}

// Files open one batch at a time, in order.
let openQueue: Promise<void> = Promise.resolve()
// Files still loading when the document is closed must not reappear in the next one.
let documentGeneration = 0

export const useEditor = create<EditorState>((set) => ({
  ...NO_DOCUMENT,
  saving: false,
  locale: DEFAULT_LOCALE,
  ocrLocale: DEFAULT_LOCALE,
  editScope: 'line',
  recoveryOffer: null,
  passwordRequest: null,
  pendingFiles: 0,
  notices: [],

  openFiles: (files) => {
    const generation = documentGeneration
    set((state) => ({ pendingFiles: state.pendingFiles + files.length }))

    openQueue = openQueue.then(async () => {
      const loaded: LoadedFile[] = []
      const notices: string[] = []
      for (const file of files) {
        const rejection = rejectionNotice(file)
        if (rejection) {
          notices.push(rejection)
          continue
        }
        try {
          const pages = await loadFile(file)
          if (pages) loaded.push(pages)
        } catch (error) {
          notices.push(failureNotice(file, error))
        }
      }

      set((state) => {
        const pendingFiles = state.pendingFiles - files.length
        if (generation !== documentGeneration) return { pendingFiles }
        const base = { pendingFiles, notices: [...state.notices, ...notices] }
        if (loaded.length === 0) return base

        const pageData = {
          ...base,
          pageSizes: Object.assign({}, state.pageSizes, ...loaded.map((file) => file.sizes)) as Record<string, Size>,
          formWidgets: Object.assign({}, state.formWidgets, ...loaded.map((file) => file.widgets)) as Record<string, FormWidget[]>
        }
        if (state.document) return { ...pageData, ...editDocument(state, (document) => appendFiles(document, loaded)) }

        // Opening the first files starts the document, there is nothing to undo back to.
        const document: EditorDocument = { sources: {}, formValues: {}, assets: {}, pages: [] }
        appendFiles(document, loaded)
        return { ...pageData, document, currentPageId: document.pages[0]?.id ?? null }
      })
    })
    return openQueue
  },

  closeDocument: () => {
    documentGeneration++
    lastTyping = null
    closeAllPdfs()
    set({ ...NO_DOCUMENT, notices: [] })
  },

  deletePage: (pageId) => set((state) => editDocument(state, (document) => deletePage(document, pageId))),

  rotatePage: (pageId) =>
    set((state) => {
      const size = currentPageSize(state, pageId)
      return size ? editDocument(state, (document) => rotatePageClockwise(document, pageId, size)) : {}
    }),

  movePage: (pageId, delta) => set((state) => editDocument(state, (document) => movePage(document, pageId, delta))),

  undo: () =>
    set((state) => {
      lastTyping = null
      return state.document ? fromVersioned(state, undo(state.document, state.history)) : {}
    }),
  redo: () =>
    set((state) => {
      lastTyping = null
      return state.document ? fromVersioned(state, redo(state.document, state.history)) : {}
    }),

  zoomIn: () => set((state) => ({ zoom: increaseZoom(state.zoom) })),
  zoomOut: () => set((state) => ({ zoom: decreaseZoom(state.zoom) })),

  setCurrentPage: (pageId) => set({ currentPageId: pageId }),
  goToPage: (pageId) =>
    set((state) => ({
      currentPageId: pageId,
      scrollRequest: { pageId, serial: (state.scrollRequest?.serial ?? 0) + 1 }
    })),

  selectTool: (tool) => set({ activeTool: tool, clipboard: null, focusedFieldId: null }),

  clickPage: (pageId, point) =>
    set((state) => {
      const id = crypto.randomUUID()
      if (state.clipboard) {
        return { ...insertField(state, pageId, point, { ...state.clipboard, id }), clipboard: null }
      }
      const field = newFieldForTool(state.activeTool, id)
      if (field) {
        // A new signature field asks for its signature straight away.
        return { ...insertField(state, pageId, point, field), signingFieldId: field.type === 'SIGNATURE' ? id : null }
      }
      lastTyping = null
      return { focusedFieldId: null }
    }),

  editTextLine: (pageId, line, appearance) =>
    set((state) => {
      const page = currentPageSize(state, pageId)
      if (!page) return {}
      const field = sizedToContent(fieldForLine(crypto.randomUUID(), line, appearance), page)
      return { ...editDocument(state, (document) => addField(document, pageId, field)), focusedFieldId: field.id }
    }),

  setEditScope: (editScope) => set({ editScope }),

  setTextStyle: (fieldId, change) =>
    set((state) => {
      const fitted = refitted(state, fieldId, (field) =>
        field.type === 'TEXT' ? { ...field, style: { ...DEFAULT_TEXT_STYLE, ...field.style, ...change } } : field
      )
      if (!state.document || !fitted) return {}
      const key = `style:${fieldId}`
      const now = Date.now()
      const mergeWithLast = change.color !== undefined && lastTyping?.fieldId === key && now - lastTyping.time < TYPING_PAUSE_MS
      const next = edit(state.document, state.history, (document) => updateField(document, fieldId, fitted), { mergeWithLast })
      lastTyping = change.color !== undefined ? { fieldId: key, time: now } : null
      return fromVersioned(state, next)
    }),

  focusField: (fieldId) =>
    set((state) => {
      if (state.focusedFieldId === fieldId) return {}
      lastTyping = null
      return { focusedFieldId: fieldId }
    }),

  typeText: (fieldId, value) =>
    set((state) => {
      const fitted = refitted(state, fieldId, (field) => ({ ...field, value }) as Field)
      if (!state.document || !fitted) return {}
      const now = Date.now()
      const mergeWithLast = lastTyping?.fieldId === fieldId && now - lastTyping.time < TYPING_PAUSE_MS
      const next = edit(state.document, state.history, (document) => updateField(document, fieldId, fitted), { mergeWithLast })
      lastTyping = { fieldId, time: now }
      return fromVersioned(state, next)
    }),

  moveField: (fieldId, box) =>
    set((state) => editDocument(state, (document) => updateField(document, fieldId, box))),

  changeFontSize: (fieldId, delta) =>
    set((state) => {
      const fitted = refitted(state, fieldId, (field) => {
        if (field.type !== 'TEXT' && field.type !== 'COMB_TEXT') return field
        const fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, field.fontSize + delta))
        return field.type === 'TEXT' ? { ...field, fontSize } : scaleCombFont(field, fontSize)
      })
      return fitted ? editDocument(state, (document) => updateField(document, fieldId, fitted)) : {}
    }),

  changeSpacing: (fieldId, delta) =>
    set((state) => {
      const fitted = refitted(state, fieldId, (field) =>
        field.type === 'COMB_TEXT' ? { ...field, spacing: Math.max(COMB_MIN_SPACING, field.spacing + delta) } : field
      )
      return fitted ? editDocument(state, (document) => updateField(document, fieldId, fitted)) : {}
    }),

  openSignature: (fieldId) => set({ signingFieldId: fieldId }),
  closeSignature: () => set({ signingFieldId: null }),

  setSignature: (fieldId, asset) =>
    set((state) =>
      editDocument(state, (document) => {
        const assetId = crypto.randomUUID()
        document.assets[assetId] = asset
        updateField(document, fieldId, { assetId } as Partial<Field>)
      })
    ),

  setPicture: (fieldId, asset, size) =>
    set((state) => {
      const found = state.document && findField(state.document, fieldId)
      const page = found && currentPageSize(state, found.pageId)
      if (!found || !page || found.field.type !== 'PICTURE') return {}
      const fitted = fitPictureField(found.field, size, page)
      return editDocument(state, (document) => {
        const assetId = crypto.randomUUID()
        document.assets[assetId] = asset
        updateField(document, fieldId, { ...fitted, assetId })
      })
    }),

  setResizing: (resizing) => set({ resizing }),
  setDragging: (dragging) => set({ dragging }),

  setPageOcr: (results) =>
    set((state) =>
      editDocument(state, (document) => {
        for (const page of document.pages) {
          const words = results[page.id]
          if (words) page.ocr = words
        }
      })
    ),

  addFoundFields: (found) =>
    set((state) =>
      editDocument(state, (document) => {
        for (const [pageId, fields] of Object.entries(found)) {
          for (const field of fields) addField(document, pageId, field)
        }
      })
    ),

  clearPageFields: (pageId) =>
    set((state) => {
      const page = state.document?.pages.find((candidate) => candidate.id === pageId)
      const size = currentPageSize(state, pageId)
      if (!page || !size) return {}
      const cleared = page.fields.map((field) => sizedToContent(clearFieldValue(field), size))
      return editDocument(state, (document) => {
        for (const field of cleared) updateField(document, field.id, field)
      })
    }),

  deletePageFields: (pageId) =>
    set((state) =>
      editDocument(state, (document) => {
        const page = document.pages.find((candidate) => candidate.id === pageId)
        if (page) page.fields = []
      })
    ),

  typeFormText: (sourceId, fieldName, value) =>
    set((state) => {
      if (!state.document) return {}
      const key = `form:${sourceId}:${fieldName}`
      const now = Date.now()
      const mergeWithLast = lastTyping?.fieldId === key && now - lastTyping.time < TYPING_PAUSE_MS
      const next = edit(state.document, state.history, (document) => assignFormValue(document, sourceId, fieldName, value), {
        mergeWithLast
      })
      lastTyping = { fieldId: key, time: now }
      return fromVersioned(state, next)
    }),

  setFormValue: (sourceId, fieldName, value) =>
    set((state) => editDocument(state, (document) => assignFormValue(document, sourceId, fieldName, value))),

  toggleBackground: (fieldId) =>
    set((state) => {
      const found = state.document && findField(state.document, fieldId)
      if (!found) return {}
      const background = found.field.background === 'white' ? 'transparent' : 'white'
      return editDocument(state, (document) => updateField(document, fieldId, { background }))
    }),

  cycleCheckbox: (fieldId) =>
    set((state) => {
      const found = state.document && findField(state.document, fieldId)
      if (!found || found.field.type !== 'CHECKBOX') return {}
      const value = nextCheckboxValue(found.field.value)
      return editDocument(state, (document) => updateField(document, fieldId, { value } as Partial<Field>))
    }),

  setCheckboxValue: (fieldId, value) =>
    set((state) => editDocument(state, (document) => updateField(document, fieldId, { value } as Partial<Field>))),

  deleteField: (fieldId) => set((state) => editDocument(state, (document) => removeField(document, fieldId))),

  copyField: (fieldId) =>
    set((state) => {
      const found = state.document && findField(state.document, fieldId)
      if (!found) return {}
      // A copy is new text, it does not paint out the line the original replaced.
      return { clipboard: found.field.type === 'TEXT' ? { ...found.field, cover: undefined } : found.field }
    }),

  cancelPaste: () => set({ clipboard: null }),

  dismissNotice: (index) =>
    set((state) => ({ notices: state.notices.filter((_, position) => position !== index) }))
}))

export async function chooseAndOpenFiles(): Promise<void> {
  const files = await window.localpdf.chooseFiles()
  if (files.length > 0) await useEditor.getState().openFiles(files)
}

/** Closes the document, asking first if that would lose changes. Says whether it closed. */
export async function requestNewFile(): Promise<boolean> {
  const { history, savedPoint, closeDocument } = useEditor.getState()
  if (hasUnsavedChanges(history, savedPoint)) {
    const answer = await window.localpdf.askUnsavedChanges()
    if (answer === 'cancel' || (answer === 'save' && !(await saveDocument()))) return false
  }
  closeDocument()
  return true
}

let readingLine = false

/** Starts editing a line, looking as it does on the page. A second click meanwhile is the same request. */
export async function startEditingLine(page: PageRef, line: TextLine): Promise<void> {
  if (readingLine) return
  readingLine = true
  try {
    const pdfPage = await getPdfPage(page.sourceId, page.pageIndex)
    const appearance = await lineAppearance(pdfPage, line, page.rotation).catch((error: unknown) => {
      // Without its look the line can still be edited, as plain black text.
      console.error(error)
      return undefined
    })
    useEditor.getState().editTextLine(page.id, line, appearance)
  } finally {
    readingLine = false
  }
}

/** Starts editing one word, with its true edges and its look read from the page. */
export async function startEditingWord(page: PageRef, word: TextWord): Promise<void> {
  if (readingLine) return
  readingLine = true
  try {
    const pdfPage = await getPdfPage(page.sourceId, page.pageIndex)
    const read = await wordAppearance(pdfPage, word, page.rotation).catch((error: unknown) => {
      console.error(error)
      return { word, appearance: undefined }
    })
    useEditor.getState().editTextLine(page.id, read.word, read.appearance)
  } finally {
    readingLine = false
  }
}

export function addNotice(notice: string): void {
  useEditor.setState((state) => ({ notices: [...state.notices, notice] }))
}

export function reportMissingCharacters(missing: { character: string }[]): void {
  const characters = [...new Set(missing.map(({ character }) => character))]
  if (characters.length > 0) addNotice(t.missingCharacters(characters.join(' ')))
}

/** Brings back a document after a crash. No file holds its changes, so it counts as unsaved. */
export async function restoreDocument(document: EditorDocument): Promise<void> {
  const pageSizes: Record<string, Size> = {}
  const formWidgets: Record<string, FormWidget[]> = {}
  for (const [sourceId, source] of Object.entries(document.sources)) {
    const pdf = await loadPdf(sourceId, source.bytes)
    const hasForm = (await pdf.getFieldObjects()) !== null
    for (const page of document.pages) {
      if (page.sourceId === sourceId) await readPageData(pdf, hasForm, page.id, page.pageIndex, pageSizes, formWidgets)
    }
  }
  useEditor.setState({
    document,
    history: EMPTY_HISTORY,
    savedPoint: NEVER_SAVED,
    pageSizes,
    formWidgets,
    currentPageId: document.pages[0]?.id ?? null
  })
}

/** Puts a chosen image file into a picture field. */
export async function addPictureFromFile(fieldId: string, file: File): Promise<void> {
  const kind = fileKind(file.name)
  if (kind === 'heic') return addNotice(t.fileHeic(file.name))
  if (kind === 'pdf' || kind === 'other') return addNotice(t.pictureUnsupported(file.name))
  try {
    const asset = await prepareImage(kind, new Uint8Array(await file.arrayBuffer()))
    const size = await imageSize(asset)
    useEditor.getState().setPicture(fieldId, asset, size)
  } catch (error) {
    console.error(error)
    addNotice(t.fileUnreadable(file.name))
  }
}

/**
 * Replaced text must leave the file. This reads the result without the added fields,
 * through the viewer, and says so on any page where that did not work.
 */
async function reportWhatStaysInTheFile(document: EditorDocument, imagesUnderCovers: number[]): Promise<void> {
  if (!document.pages.some((page) => coversOf(page.fields).length > 0)) return
  const { bytes } = await buildPdf(document, await loadExportFonts(), { withoutFields: true })
  const pdf = await openPdf(bytes)
  try {
    const getPage = async (index: number) => (await pdf.getPage(index + 1)) as unknown as ContentPage
    const leftover = await pagesWithLeftoverText(document, getPage)
    if (leftover.length > 0) addNotice(t.textLeftInFile(leftover.join(', ')))
  } finally {
    void pdf.loadingTask.destroy()
  }
  if (imagesUnderCovers.length > 0) addNotice(t.imageLeftInFile(imagesUnderCovers.join(', ')))
}

/** Builds the final PDF and asks where to save it. Says whether it was saved. */
export async function saveDocument(): Promise<boolean> {
  const { document, history, outputPassword } = useEditor.getState()
  const firstPage = document?.pages[0]
  if (!document || !firstPage) return false

  useEditor.setState({ saving: true, statusNote: null })
  try {
    const fonts = await loadExportFonts()
    const { bytes, missingCharacters, imagesUnderCovers } = await buildPdf(document, fonts)
    await reportWhatStaysInTheFile(document, imagesUnderCovers)
    const name = exportFileName(document.sources[firstPage.sourceId]!.name)
    const output = outputPassword ? await protectPdf(bytes, outputPassword) : bytes
    const result = await window.localpdf.saveFile(name, output)
    if (result.status === 'failed') addNotice(t.saveFailed)
    if (result.status !== 'saved') return false
    // Typing on from here is a new step, undoing it must lead back to what was saved.
    lastTyping = null
    useEditor.setState({ statusNote: t.savedAs(result.name), savedPoint: savePointOf(history) })
    reportMissingCharacters(missingCharacters)
    return true
  } catch (error) {
    console.error(error)
    addNotice(t.saveFailed)
    return false
  } finally {
    useEditor.setState({ saving: false })
  }
}
