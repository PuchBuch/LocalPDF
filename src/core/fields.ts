import type { Point, Rect, Size } from './geometry'
import { currentFormValue, turnRect, type FormWidget } from './forms'
import type { CheckboxField, CombField, EditorDocument, Field, FormValue, ImageField, TextField, TextStyle } from './model'

/** Text fields use this line height on screen and in the PDF. */
export const LINE_HEIGHT = 1.2
export const DEFAULT_FONT_SIZE = 10
export const MIN_FONT_SIZE = 4
export const MAX_FONT_SIZE = 144
export const CHECKBOX_SIZE = 12
export const SIGNATURE_WIDTH = 180
export const SIGNATURE_HEIGHT = 60
export const PICTURE_SIZE = 60
export const COMB_MIN_CELLS = 8
export const COMB_DEFAULT_SPACING = 7
export const COMB_MIN_SPACING = 4
export const MIN_FIELD_SIZE = 8
export const TEXT_PLACEHOLDER = 'Aa'
/** Keeps the caret from pushing the text sideways at the end of the longest line. */
const TEXT_WIDTH_SLACK = 2

/** Checkbox marks in a 100 by 100 box, the same on screen and in the PDF. */
export const MARK_BASE_SIZE = 100
export const MARK_STROKE_WIDTH = 14
export const TICK_PATH = 'M 16 54 L 40 78 L 86 22'
export const CROSS_PATH = 'M 22 22 L 78 78 M 78 22 L 22 78'
/** A filled circle, unlike the two above, which are drawn with a stroke. */
export const DOT_PATH = 'M 50 26 A 24 24 0 1 1 50 74 A 24 24 0 1 1 50 26 Z'

export function clampToPage(rect: Rect, page: Size): Point {
  return {
    x: Math.max(0, Math.min(rect.x, page.width - rect.width)),
    y: Math.max(0, Math.min(rect.y, page.height - rect.height))
  }
}

/** Text starts at the point it was placed at, a box is centred on it. */
export function placeField<T extends Field>(field: T, point: Point, page: Size): T {
  const startsAtPoint = field.type === 'TEXT' || field.type === 'COMB_TEXT'
  const corner = startsAtPoint
    ? point
    : { x: point.x - field.width / 2, y: point.y - field.height / 2 }
  return { ...field, ...clampToPage({ ...field, ...corner }, page) }
}

export function newTextField(id: string): TextField {
  return { id, type: 'TEXT', x: 0, y: 0, width: 0, height: 0, background: 'transparent', value: '', fontSize: DEFAULT_FONT_SIZE }
}

export function newCheckboxField(id: string): CheckboxField {
  return {
    id,
    type: 'CHECKBOX',
    x: 0,
    y: 0,
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    background: 'transparent',
    value: 'tick'
  }
}

export function newSignatureField(id: string): ImageField {
  return {
    id,
    type: 'SIGNATURE',
    x: 0,
    y: 0,
    width: SIGNATURE_WIDTH,
    height: SIGNATURE_HEIGHT,
    background: 'transparent',
    assetId: null
  }
}

export function newPictureField(id: string): ImageField {
  return {
    id,
    type: 'PICTURE',
    x: 0,
    y: 0,
    width: PICTURE_SIZE,
    height: PICTURE_SIZE,
    background: 'transparent',
    assetId: null
  }
}

export function newCombField(id: string): CombField {
  return {
    id,
    type: 'COMB_TEXT',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    background: 'transparent',
    value: '',
    fontSize: DEFAULT_FONT_SIZE,
    spacing: COMB_DEFAULT_SPACING
  }
}

export function nextCheckboxValue(value: CheckboxField['value']): CheckboxField['value'] {
  if (value === 'tick') return 'cross'
  if (value === 'cross') return 'dot'
  return value === 'dot' ? null : 'tick'
}

/** Measures the widest line at a font size, in points. */
export type MeasureText = (text: string, fontSize: number, style?: Pick<TextStyle, 'bold' | 'italic' | 'family'>) => number

/** Sizes a text field to its content, no larger than the page, and keeps it on the page. */
export function fitTextField(field: TextField, measure: MeasureText, page: Size): TextField {
  const lines = field.value.split('\n')
  const widest = Math.max(
    ...lines.map((line) => measure(line === '' ? TEXT_PLACEHOLDER : line, field.fontSize, field.style))
  )
  const size = {
    width: Math.min(widest + TEXT_WIDTH_SLACK, page.width),
    height: Math.min(lines.length * field.fontSize * LINE_HEIGHT, page.height)
  }
  return { ...field, ...size, ...clampToPage({ x: field.x, y: field.y, ...size }, page) }
}

export function combCellCount(field: Pick<CombField, 'value'>): number {
  return Math.max(COMB_MIN_CELLS, Array.from(field.value).length)
}

/** Sizes a comb field to its cells. Cells shrink, and extra characters go, rather than leave the page. */
export function fitCombField(field: CombField, page: Size): CombField {
  const spacing = Math.max(COMB_MIN_SPACING, Math.min(field.spacing, page.width / COMB_MIN_CELLS))
  const maxCells = Math.floor(page.width / spacing)
  const value = Array.from(field.value).slice(0, maxCells).join('')
  const size = {
    width: combCellCount({ value }) * spacing,
    height: field.fontSize * LINE_HEIGHT
  }
  return { ...field, value, spacing, ...size, ...clampToPage({ x: field.x, y: field.y, ...size }, page) }
}

/** A changed font size carries the cell width along with it. */
export function scaleCombFont(field: CombField, fontSize: number): CombField {
  return { ...field, fontSize, spacing: (field.spacing * fontSize) / field.fontSize }
}

/** A picture keeps its field's width and takes its height from the image, within the page. */
export function fitPictureField(field: ImageField, image: Size, page: Size): ImageField {
  const ratio = image.height / image.width
  const scale = Math.min(1, page.width / field.width, page.height / (field.width * ratio))
  const size = { width: field.width * scale, height: field.width * ratio * scale }
  return { ...field, ...size, ...clampToPage({ x: field.x, y: field.y, ...size }, page) }
}

/**
 * The box after dragging its bottom-right corner. The top-left corner stays put and
 * the box stays on the page, in proportion when lockRatio is set.
 */
export function resizeBox(start: Rect, delta: Point, page: Size, lockRatio: boolean): Rect {
  const maxWidth = page.width - start.x
  const maxHeight = page.height - start.y
  if (!lockRatio) {
    return {
      x: start.x,
      y: start.y,
      width: Math.max(MIN_FIELD_SIZE, Math.min(start.width + delta.x, maxWidth)),
      height: Math.max(MIN_FIELD_SIZE, Math.min(start.height + delta.y, maxHeight))
    }
  }
  const wanted = Math.max((start.width + delta.x) / start.width, (start.height + delta.y) / start.height)
  const smallest = MIN_FIELD_SIZE / Math.min(start.width, start.height)
  const largest = Math.min(maxWidth / start.width, maxHeight / start.height)
  const scale = Math.max(smallest, Math.min(wanted, largest))
  return { x: start.x, y: start.y, width: start.width * scale, height: start.height * scale }
}

export function findField(document: EditorDocument, fieldId: string): { pageId: string; field: Field } | null {
  for (const page of document.pages) {
    const field = page.fields.find((candidate) => candidate.id === fieldId)
    if (field) return { pageId: page.id, field }
  }
  return null
}

export function addField(document: EditorDocument, pageId: string, field: Field): void {
  document.pages.find((page) => page.id === pageId)?.fields.push(field)
}

export function updateField(document: EditorDocument, fieldId: string, change: Partial<Field>): void {
  for (const page of document.pages) {
    const field = page.fields.find((candidate) => candidate.id === fieldId)
    if (field) Object.assign(field, change)
  }
}

export function removeField(document: EditorDocument, fieldId: string): void {
  for (const page of document.pages) {
    const index = page.fields.findIndex((candidate) => candidate.id === fieldId)
    if (index >= 0) page.fields.splice(index, 1)
  }
}

/** The field with nothing in it, still in its place. */
export function clearFieldValue(field: Field): Field {
  switch (field.type) {
    case 'TEXT':
    case 'COMB_TEXT':
      return { ...field, value: '' }
    case 'CHECKBOX':
      return { ...field, value: null }
    case 'SIGNATURE':
    case 'PICTURE':
      return { ...field, assetId: null }
  }
}

/** The name offered when saving: report.pdf becomes report-document.pdf. */
export function exportFileName(sourceName: string, extension: 'pdf' | 'md' = 'pdf'): string {
  return `${sourceName.replace(/\.[^.]+$/, '')}-document.${extension}`
}

/** What a numbered field is, as people would call it. */
export type NumberedFieldType = 'text' | 'checkbox' | 'radio' | 'choice' | 'signature' | 'picture' | 'cells'

/** A field the editor added, or a field of the file's own form, found by its name in its file. */
export type NumberedTarget =
  | { kind: 'added'; fieldId: string }
  | { kind: 'form'; sourceId: string; fieldName: string; widgetId: string }

export interface NumberedField {
  number: number
  pageId: string
  target: NumberedTarget
  type: NumberedFieldType
  /** The form field's own name; empty for a field added in the editor. */
  name: string
  /** The value as text: what is typed or chosen, a mark for a box, empty when there is none. */
  value: string
  /** Where it is on the page as shown, in points. */
  box: Rect
  /** What a radio group or a list can be set to. */
  options?: string[]
  /** A list where several options can be chosen. */
  multiple?: boolean
}

const MARK_TEXT: Record<'tick' | 'cross' | 'dot', string> = { tick: '✓', cross: '✗', dot: '•' }

function addedEntry(field: Field): Omit<NumberedField, 'number' | 'pageId' | 'box'> {
  const target = { kind: 'added' as const, fieldId: field.id }
  switch (field.type) {
    case 'TEXT':
      return { target, type: 'text', name: '', value: field.value }
    case 'COMB_TEXT':
      return { target, type: 'cells', name: '', value: field.value }
    case 'CHECKBOX':
      return { target, type: 'checkbox', name: '', value: field.value ? MARK_TEXT[field.value] : '' }
    case 'SIGNATURE':
      return { target, type: 'signature', name: '', value: field.assetId ? '✓' : '' }
    case 'PICTURE':
      return { target, type: 'picture', name: '', value: field.assetId ? '✓' : '' }
  }
}

function formEntry(widget: FormWidget, sourceId: string, value: FormValue): Omit<NumberedField, 'number' | 'pageId' | 'box'> {
  const target = { kind: 'form' as const, sourceId, fieldName: widget.fieldName, widgetId: widget.id }
  const choices = widget.kind === 'dropdown' || widget.kind === 'list' ? { options: widget.options, multiple: widget.multiple } : {}
  const shown = Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? '✓' : '') : value
  const type: NumberedFieldType =
    widget.kind === 'text' ? 'text' : widget.kind === 'checkbox' ? 'checkbox' : widget.kind === 'radio' ? 'radio' : 'choice'
  // A radio group holds the chosen button's value; "Off" means none is chosen.
  return { target, type, name: widget.fieldName, value: widget.kind === 'radio' && shown === 'Off' ? '' : shown, ...choices }
}

/**
 * Orders boxes as they are read: from the top down, and boxes about level with each other
 * from left to right. A box joins a row when its middle lies within the height of the row's first box.
 */
function inReadingOrder<T extends { box: Rect; key: string }>(items: T[]): T[] {
  const byTop = [...items].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x || a.key.localeCompare(b.key))
  const ordered: T[] = []
  let row: T[] = []
  let rowTop = 0
  let rowBottom = 0
  const closeRow = () => ordered.push(...row.sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y || a.key.localeCompare(b.key)))
  for (const item of byTop) {
    const middle = item.box.y + item.box.height / 2
    if (row.length > 0 && middle >= rowTop && middle <= rowBottom) {
      row.push(item)
      continue
    }
    closeRow()
    row = [item]
    rowTop = item.box.y
    rowBottom = item.box.y + item.box.height
  }
  closeRow()
  return ordered
}

/**
 * Numbers every field of the document 1…N in reading order: page by page, then from the
 * top down and from left to right, on the page as it is shown. The same fields in the same
 * places always get the same numbers. All the buttons of a radio group, and every widget of
 * one form field, share the number of the first one read.
 */
export function numberFields(
  document: EditorDocument,
  formWidgets: Record<string, FormWidget[]>,
  pageSizes: Record<string, Size>
): NumberedField[] {
  const numbered: NumberedField[] = []
  const formFieldsSeen = new Set<string>()
  // A radio group can be set to the value of any of its buttons, wherever they are.
  const radioOptions = new Map<string, string[]>()
  for (const page of document.pages) {
    for (const widget of formWidgets[page.id] ?? []) {
      if (widget.kind !== 'radio') continue
      const options = radioOptions.get(`\u0000`) ?? []
      if (!options.includes(widget.buttonValue)) options.push(widget.buttonValue)
      radioOptions.set(`\u0000`, options)
    }
  }
  for (const page of document.pages) {
    const size = pageSizes[page.id]
    const items: (Omit<NumberedField, 'number'> & { key: string })[] = page.fields.map((field) => ({
      ...addedEntry(field),
      pageId: page.id,
      box: { x: field.x, y: field.y, width: field.width, height: field.height },
      key: `added:${field.id}`
    }))
    if (size) {
      for (const widget of formWidgets[page.id] ?? []) {
        const value = currentFormValue(widget, document.formValues[page.sourceId])
        items.push({
          ...formEntry(widget, page.sourceId, value),
          pageId: page.id,
          box: turnRect(widget.rect, size, page.rotation),
          key: `form:${widget.fieldName}:${widget.id}`
        })
      }
    }
    for (const { key, ...item } of inReadingOrder(items)) {
      if (item.target.kind === 'form') {
        const formField = `${item.target.sourceId}\u0000${item.target.fieldName}`
        if (formFieldsSeen.has(formField)) continue
        formFieldsSeen.add(formField)
      }
      const options = item.target.kind === 'form' && item.type === 'radio' ? radioOptions.get(`\u0000`) : undefined
      numbered.push({ ...item, ...(options ? { options } : {}), number: numbered.length + 1 })
    }
  }
  return numbered
}