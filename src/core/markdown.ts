/** A piece of text on the displayed page, in points from its top-left corner. */
export interface TextRun {
  kind: 'text'
  text: string
  x: number
  top: number
  width: number
  height: number
  /** Entered in a field: its size says nothing about headings. */
  entered?: boolean
}

/** Something that stands on its own line, such as an image. */
export interface BlockItem {
  kind: 'block'
  markdown: string
  top: number
}

export type ContentItem = TextRun | BlockItem

interface Row {
  top: number
  right: number
  text: string
  height: number
  /** Size of the page's own text in this row, null if it only holds entered values. */
  size: number | null
}

const H1_RATIO = 1.6
const H2_RATIO = 1.25
/** Runs further apart than this share of their height have a space between them. */
const WORD_GAP = 0.2
/** Rows further apart than this share of their height start a new paragraph. */
const PARAGRAPH_GAP = 1.6
/** A row reaching this share of the widest row was wrapped, the next one continues it. */
const WRAPPED_ROW = 0.8

const center = (run: TextRun) => run.top + run.height / 2

function toRow(runs: TextRun[]): Row {
  const sorted = [...runs].sort((a, b) => a.x - b.x)
  let text = ''
  let right = Number.NEGATIVE_INFINITY
  for (const run of sorted) {
    const separated = text !== '' && run.x - right > run.height * WORD_GAP && !/\s$/.test(text) && !/^\s/.test(run.text)
    text += (separated ? ' ' : '') + run.text
    right = Math.max(right, run.x + run.width)
  }
  const own = sorted.filter((run) => !run.entered).map((run) => run.height)
  return {
    top: Math.min(...sorted.map((run) => run.top)),
    right,
    text: text.trim(),
    height: Math.max(...sorted.map((run) => run.height)),
    size: own.length > 0 ? Math.max(...own) : null
  }
}

function toRows(runs: TextRun[]): Row[] {
  const groups: TextRun[][] = []
  for (const run of [...runs].sort((a, b) => center(a) - center(b))) {
    const group = groups.at(-1)
    const last = group?.at(-1)
    if (group && last && Math.abs(center(run) - center(last)) < Math.min(run.height, last.height) / 2) group.push(run)
    else groups.push([run])
  }
  return groups.map(toRow)
}

/** The size most of the document's own text is in, by the number of characters. */
function bodySize(pages: ContentItem[][]): number {
  const characters = new Map<number, number>()
  for (const item of pages.flat()) {
    if (item.kind !== 'text' || item.entered) continue
    const size = Math.round(item.height * 2) / 2
    characters.set(size, (characters.get(size) ?? 0) + item.text.length)
  }
  let body = 0
  let most = 0
  for (const [size, count] of characters) {
    if (count > most) {
      body = size
      most = count
    }
  }
  return body
}

function headingPrefix(size: number | null, body: number): string {
  if (size === null || body === 0) return ''
  if (size >= body * H1_RATIO) return '# '
  if (size >= body * H2_RATIO) return '## '
  return ''
}

function pageToMarkdown(items: ContentItem[], body: number): string {
  const rows = toRows(items.filter((item): item is TextRun => item.kind === 'text'))
  const blocks = items.filter((item): item is BlockItem => item.kind === 'block')
  const widest = Math.max(0, ...rows.map((row) => row.right))
  const entries: (Row | BlockItem)[] = [...rows, ...blocks].sort((a, b) => a.top - b.top)

  const paragraphs: string[] = []
  let previous: Row | null = null
  for (const entry of entries) {
    if (!('text' in entry)) {
      paragraphs.push(entry.markdown)
      previous = null
      continue
    }
    const prefix = headingPrefix(entry.size, body)
    const continues =
      previous !== null &&
      prefix === '' &&
      headingPrefix(previous.size, body) === '' &&
      entry.top - previous.top < entry.height * PARAGRAPH_GAP
    if (continues && previous) {
      const joint = previous.right >= widest * WRAPPED_ROW ? ' ' : '\n'
      paragraphs[paragraphs.length - 1] += joint + entry.text
    } else {
      paragraphs.push(prefix + entry.text)
    }
    previous = entry
  }
  return paragraphs.join('\n\n')
}

/** The content of the pages, in their current order, as Markdown. */
export function pagesToMarkdown(pages: ContentItem[][]): string {
  const body = bodySize(pages)
  return pages
    .map((items) => pageToMarkdown(items, body))
    .filter((page) => page !== '')
    .join('\n\n\n')
}
