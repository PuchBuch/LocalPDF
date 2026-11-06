import { LINE_HEIGHT, type MeasureText } from '../core/fields'
import { automaticFontSize, currentFormValue, turnRect, type FormWidget } from '../core/forms'
import { displayedSize, normalizeRotation, type Rect, type Size } from '../core/geometry'
import { pagesToMarkdown, type ContentItem, type TextRun } from '../core/markdown'
import type { EditorDocument, Field, PageRef, Rotation } from '../core/model'
import {
  coversOf,
  isCovered,
  toTextLines,
  toTextWords,
  type PageTextRun,
  type TextLine,
  type TextWord
} from '../core/textLines'

type Matrix = number[]

/** The parts of a pdf.js page that extraction reads. */
export interface ContentPage {
  rotate: number
  getViewport(options: { scale: number; rotation?: number }): { width: number; height: number; transform: Matrix }
  getTextContent(): Promise<{ items: object[] }>
}

interface PdfTextItem {
  str: string
  width: number
  transform: Matrix
  fontName?: string
}

export type GetContentPage = (sourceId: string, pageIndex: number) => Promise<ContentPage>

/** How much a text direction may lean and still count as horizontal. */
const HORIZONTAL_TOLERANCE = 0.01

const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0]! * b[0]! + a[2]! * b[1]!,
  a[1]! * b[0]! + a[3]! * b[1]!,
  a[0]! * b[2]! + a[2]! * b[3]!,
  a[1]! * b[2]! + a[3]! * b[3]!,
  a[0]! * b[4]! + a[2]! * b[5]! + a[4]!,
  a[1]! * b[4]! + a[3]! * b[5]! + a[5]!
]

const isText = (item: object): item is PdfTextItem => 'str' in item && (item as PdfTextItem).str.trim() !== ''

/**
 * The turn that makes most of the text read left to right. A page can be displayed
 * sideways or upside down, and reading order follows the text, not the display.
 */
function readingTurn(items: PdfTextItem[], transform: Matrix): Rotation {
  const characters = new Map<number, number>()
  for (const item of items) {
    const placed = multiply(transform, item.transform)
    const angle = normalizeRotation(Math.round(Math.atan2(placed[1]!, placed[0]!) / (Math.PI / 2)) * 90)
    characters.set(angle, (characters.get(angle) ?? 0) + item.str.length)
  }
  const [angle] = [...characters].reduce((best, entry) => (entry[1] > best[1] ? entry : best), [0, 0])
  return normalizeRotation(360 - angle)
}

function textRuns(items: PdfTextItem[], transform: Matrix): TextRun[] {
  return items.map(({ str, width, transform: own }) => {
    const placed = multiply(transform, own)
    const height = Math.hypot(placed[2]!, placed[3]!)
    return { kind: 'text', text: str, x: placed[4]!, top: placed[5]! - height, width, height }
  })
}

/** Runs for a value entered in a box, a line of it per run. */
function enteredLines(value: string, box: Rect, lineHeight: number): TextRun[] {
  return value.split('\n').flatMap((line, index) =>
    line.trim() === ''
      ? []
      : [
          {
            kind: 'text' as const,
            text: line,
            x: box.x,
            top: box.y + index * lineHeight,
            width: box.width,
            height: Math.min(box.height, lineHeight),
            entered: true
          }
        ]
  )
}

function fieldItems(field: Field): ContentItem[] {
  switch (field.type) {
    case 'TEXT':
      return enteredLines(field.value, field, field.fontSize * LINE_HEIGHT)
    case 'CHECKBOX':
      return enteredLines(field.value ? '[x]' : '[ ]', field, field.height)
    case 'COMB_TEXT':
      return field.value === '' ? [] : [{ kind: 'block', markdown: `\`\`\`\n${field.value}\n\`\`\``, top: field.y }]
    case 'SIGNATURE':
      return field.assetId ? [{ kind: 'block', markdown: '![Signature](signature)', top: field.y }] : []
    case 'PICTURE':
      return field.assetId ? [{ kind: 'block', markdown: '![Image](image)', top: field.y }] : []
  }
}

function widgetItems(widget: FormWidget, value: unknown, box: Rect): ContentItem[] {
  switch (widget.kind) {
    case 'text': {
      const size = widget.fontSize > 0 ? widget.fontSize : automaticFontSize(widget.rect.height, widget.multiline)
      return enteredLines(String(value), box, widget.multiline ? size * LINE_HEIGHT : box.height)
    }
    case 'checkbox':
      return enteredLines(value === true ? '[x]' : '[ ]', box, box.height)
    case 'radio':
      return enteredLines(value === widget.buttonValue ? '[x]' : '[ ]', box, box.height)
    case 'dropdown':
    case 'list':
      return enteredLines((value as string[]).join(', '), box, box.height)
  }
}

async function pageItems(
  document: EditorDocument,
  ref: PageRef,
  widgets: FormWidget[],
  size: Size,
  getPage: GetContentPage
): Promise<ContentItem[]> {
  const page = await getPage(ref.sourceId, ref.pageIndex)
  const values = document.formValues[ref.sourceId]
  const displayed = normalizeRotation(page.rotate + ref.rotation)
  const items = (await page.getTextContent()).items.filter(isText)
  // Recognized words are upright before the editor's rotation, so they set the reading frame.
  const turn =
    items.length === 0 && ref.ocr
      ? normalizeRotation(-ref.rotation)
      : readingTurn(items, page.getViewport({ scale: 1, rotation: displayed }).transform)
  const upright = page.getViewport({ scale: 1, rotation: normalizeRotation(displayed + turn) })
  const shownSize = displayedSize(size, ref.rotation)
  const covers = coversOf(ref.fields).map((cover) => turnRect(cover, shownSize, turn))
  const recognized: TextRun[] = (ref.ocr ?? []).map(({ text, x, y, width, height }) => ({
    kind: 'text',
    text,
    x,
    top: y,
    width,
    height,
    // A size measured from a scan says little about headings.
    entered: true
  }))
  // Lines replaced by a field are no longer part of what the document says.
  const visible = [...textRuns(items, upright.transform), ...recognized].filter(
    (run) => !isCovered({ x: run.x + run.width / 2, y: run.top + run.height / 2 }, covers)
  )
  return [
    ...visible,
    ...widgets.flatMap((widget) =>
      widgetItems(
        widget,
        currentFormValue(widget, values),
        turnRect(widget.rect, size, normalizeRotation(ref.rotation + turn))
      )
    ),
    ...ref.fields.flatMap((field) =>
      fieldItems({ ...field, ...turnRect(field, shownSize, turn) })
    )
  ]
}

/**
 * Numbers of the pages where a viewer still finds text under an area that should have
 * been emptied. This reads the finished bytes independently of the code that cut the
 * text out, so that nothing is ever reported as removed without having been.
 */
export async function pagesWithLeftoverText(
  document: EditorDocument,
  getOutputPage: (pageIndex: number) => Promise<ContentPage>
): Promise<number[]> {
  const leftovers: number[] = []
  for (const [index, ref] of document.pages.entries()) {
    const covers = coversOf(ref.fields)
    if (covers.length === 0) continue
    const page = await getOutputPage(index)
    const { transform } = page.getViewport({ scale: 1 })
    const { items } = await page.getTextContent()
    const found = textRuns(items.filter(isText), transform).some((run) => {
      const placed = run.width > 0 ? run.x + run.width / 2 : run.x
      return isCovered({ x: placed, y: run.top + run.height * 0.7 }, covers)
    })
    if (found) leftovers.push(index + 1)
  }
  return leftovers
}

/** The horizontal text of a page as displayed. Text at an angle is left out. */
async function horizontalRuns(page: ContentPage, rotation: Rotation): Promise<PageTextRun[]> {
  const { transform } = page.getViewport({ scale: 1, rotation: normalizeRotation(page.rotate + rotation) })
  const items = (await page.getTextContent()).items.filter(isText)
  return items.flatMap(({ str, width, transform: own, fontName }) => {
    const placed = multiply(transform, own)
    if (Math.abs(placed[1]!) > HORIZONTAL_TOLERANCE || placed[0]! <= 0) return []
    return [{ text: str, x: placed[4]!, baseline: placed[5]!, width, height: Math.hypot(placed[2]!, placed[3]!), fontName }]
  })
}

/** The lines of text of a page, for editing, with any more runs known about it. */
export async function pageTextLines(page: ContentPage, rotation: Rotation, extra: PageTextRun[] = []): Promise<TextLine[]> {
  return toTextLines([...(await horizontalRuns(page, rotation)), ...extra])
}

/** The words of a page, for editing, with any more runs known about it. */
export async function pageTextWords(
  page: ContentPage,
  rotation: Rotation,
  measure: MeasureText,
  extra: PageTextRun[] = []
): Promise<TextWord[]> {
  return toTextWords([...(await horizontalRuns(page, rotation)), ...extra], measure)
}

/** Whether a page has any text of its own, as opposed to being a picture. */
export async function pageHasText(page: ContentPage): Promise<boolean> {
  return (await page.getTextContent()).items.some(isText)
}

/** The document as it stands now as Markdown: its text, form values and added fields. */
export async function extractMarkdown(
  document: EditorDocument,
  formWidgets: Record<string, FormWidget[]>,
  pageSizes: Record<string, Size>,
  getPage: GetContentPage
): Promise<string> {
  const pages = await Promise.all(
    document.pages.map((ref) =>
      pageItems(document, ref, formWidgets[ref.id] ?? [], pageSizes[ref.id] ?? { width: 0, height: 0 }, getPage)
    )
  )
  return pagesToMarkdown(pages)
}
