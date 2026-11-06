import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { appendFile, readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, it } from 'vitest'
import { classifyLoadError } from '../src/core/loadError'
import type { EditorDocument, PageRef, TextField } from '../src/core/model'
import { fieldForLine, type TextLine } from '../src/core/textLines'
import { buildPdf, type ExportFonts } from '../src/export/buildPdf'
import { pagesWithLeftoverText, pageTextLines, type ContentPage } from '../src/export/extractContent'
import { decryptPdf, looksEncrypted } from '../src/export/qpdf'
import { loadFonts, openPdf, renderPage, singlePageDocument } from './helpers'

/**
 * Runs real PDFs through export and text removal, and writes what happened to a file.
 * It takes many minutes, and the files are not in the repository, so it runs only when
 * asked: LOCALPDF_CORPUS=folder npx vitest run tests/corpus.private.test.ts
 */
const FOLDER = process.env['LOCALPDF_CORPUS']
const OUT = process.env['LOCALPDF_CORPUS_OUT'] ?? resolve(__dirname, '../samples/private/out/corpus.jsonl')
const WASM = createRequire(import.meta.url).resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm')

const MAX_PAGES = 3
const STEP_TIMEOUT_MS = 30_000
const SAMPLE_COLUMNS = 40
const SAMPLE_ROWS = 56

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), STEP_TIMEOUT_MS)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

const message = (error: unknown) => String((error as Error)?.message ?? error).slice(0, 160)
const words = (text: string) => text.split(/\s+/).filter((word) => word !== '')

async function pageWords(bytes: Uint8Array, pageNumber: number): Promise<string[]> {
  const pdf = await openPdf(bytes)
  const { items } = await (await pdf.getPage(pageNumber)).getTextContent()
  return words(items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' '))
}

/** Share of a grid of points that differ, leaving out an area of the first page if given. */
async function pixelDifference(
  before: Uint8Array,
  after: Uint8Array,
  pageNumber: number,
  size: { width: number; height: number },
  skip?: { x: number; y: number; width: number; height: number }
): Promise<number> {
  const a = await renderPage(before, pageNumber, 1)
  const b = await renderPage(after, pageNumber, 1)
  let different = 0
  let total = 0
  for (let row = 0; row < SAMPLE_ROWS; row++) {
    for (let column = 0; column < SAMPLE_COLUMNS; column++) {
      const x = ((column + 0.5) / SAMPLE_COLUMNS) * size.width
      const y = ((row + 0.5) / SAMPLE_ROWS) * size.height
      if (skip && x >= skip.x && x <= skip.x + skip.width && y >= skip.y && y <= skip.y + skip.height) continue
      total++
      const colorA = a.colorAt(x, y)
      const colorB = b.colorAt(x, y)
      if (Math.abs(colorA[0] - colorB[0]) + Math.abs(colorA[1] - colorB[1]) + Math.abs(colorA[2] - colorB[2]) > 60) different++
    }
  }
  return total === 0 ? 0 : different / total
}

interface Report {
  file: string
  outcome: 'ok' | 'password' | 'unreadable' | 'decrypt-failed'
  pages?: number
  exportError?: string
  exportTextLost?: string[]
  exportPixels?: number
  removal?: 'none' | 'done'
  removalError?: string
  leftover?: boolean
  neighbourWordsLost?: string[]
  removalPixels?: number
  note?: string
}

async function checkFile(file: string, fonts: ExportFonts): Promise<Report> {
  const report: Report = { file: file.split(/[\\/]/).pop()!, outcome: 'ok' }
  let bytes = new Uint8Array(await readFile(file))

  if (looksEncrypted(bytes)) {
    const plain = await decryptPdf(WASM, bytes, '')
    if (plain) bytes = new Uint8Array(plain)
  }

  let pdf
  try {
    pdf = await withTimeout(openPdf(bytes))
  } catch (error) {
    report.outcome = classifyLoadError(error) === 'password' ? 'password' : 'unreadable'
    report.note = message(error)
    return report
  }
  report.pages = pdf.numPages
  const count = Math.min(pdf.numPages, MAX_PAGES)
  const pages: PageRef[] = Array.from({ length: count }, (_, pageIndex) => ({
    id: `p${pageIndex}`,
    sourceId: 's1',
    pageIndex,
    rotation: 0,
    fields: []
  }))
  const document: EditorDocument = { sources: { s1: { name: 'x.pdf', bytes } }, formValues: {}, assets: {}, pages }

  // Saved without any change, a document must stay what it was.
  let output: Uint8Array
  try {
    output = (await withTimeout(buildPdf(document, fonts))).bytes
  } catch (error) {
    report.exportError = message(error)
    return report
  }
  try {
    const before = await withTimeout(pageWords(bytes, 1))
    const after = new Set(await withTimeout(pageWords(output, 1)))
    const lost = before.filter((word) => !after.has(word))
    if (lost.length > 0) report.exportTextLost = lost.slice(0, 8)
    const { width, height } = (await pdf.getPage(1)).getViewport({ scale: 1 })
    const difference = await withTimeout(pixelDifference(bytes, output, 1, { width, height }))
    if (difference > 0.01) report.exportPixels = Math.round(difference * 1000) / 1000
  } catch (error) {
    report.note = `compare: ${message(error)}`
  }

  // Replacing a line must take it out of the file and nothing else with it.
  const first = await pdf.getPage(1)
  let lines: TextLine[] = []
  try {
    lines = await withTimeout(pageTextLines(first as unknown as ContentPage, 0))
  } catch (error) {
    report.removalError = `lines: ${message(error)}`
    return report
  }
  const target = lines[Math.floor(lines.length / 2)]
  if (!target || target.height < 2) {
    report.removal = 'none'
    return report
  }
  report.removal = 'done'
  const field: TextField = { ...fieldForLine('f', target), value: '' }
  const edited = singlePageDocument(bytes, [field])
  try {
    const { bytes: withoutFields } = await withTimeout(buildPdf(edited, fonts, { withoutFields: true }))
    const reread = await openPdf(withoutFields)
    report.leftover =
      (
        await pagesWithLeftoverText(edited, async (index) => (await reread.getPage(index + 1)) as unknown as ContentPage)
      ).length > 0

    const targetWords = new Set(words(target.text))
    const others = lines.filter((line) => line !== target).flatMap((line) => words(line.text))
    const after = await pageWords(withoutFields, 1)
    // Words can break up where a line is cut, so what is compared is the letters that remain.
    const joined = after.join('')
    const lost = others.filter((word) => !targetWords.has(word) && !joined.includes(word))
    if (lost.length > 0) report.neighbourWordsLost = lost.slice(0, 8)

    const { width, height } = first.getViewport({ scale: 1 })
    const difference = await withTimeout(pixelDifference(bytes, withoutFields, 1, { width, height }, field.cover))
    if (difference > 0.01) report.removalPixels = Math.round(difference * 1000) / 1000
  } catch (error) {
    report.removalError = message(error)
  }
  return report
}

describe.skipIf(!FOLDER)('public documents', () => {
  it('go through export and text removal', { timeout: 4 * 60 * 60 * 1000 }, async () => {
    const fonts = await loadFonts()
    // A run can be continued: a file can hang the renderer for good, and then a driver
    // script kills the process, notes that file and starts this again.
    const resume = process.env['LOCALPDF_CORPUS_RESUME'] === '1'
    if (!resume) await rm(OUT, { force: true })
    const done = new Set(
      resume && existsSync(OUT)
        ? (await readFile(OUT, 'utf8')).split('\n').flatMap((line) => (line ? [(JSON.parse(line) as Report).file] : []))
        : []
    )
    const files = (await readdir(FOLDER!))
      .filter((name) => name.toLowerCase().endsWith('.pdf') && !done.has(name))
      .sort()
    for (const name of files) {
      let report: Report
      try {
        report = await checkFile(join(FOLDER!, name), fonts)
      } catch (error) {
        report = { file: name, outcome: 'unreadable', note: `crash: ${message(error)}` }
      }
      await appendFile(OUT, `${JSON.stringify(report)}\n`)
    }
  })
})
