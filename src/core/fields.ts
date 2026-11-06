import type { Point, Rect, Size } from './geometry'
import type { CheckboxField, CombField, EditorDocument, Field, ImageField, TextField, TextStyle } from './model'

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
