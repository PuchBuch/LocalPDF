import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { toFormWidget, type FormWidget, type WidgetAnnotation } from '../src/core/forms'
import type { EditorDocument, FormValue, PageRef } from '../src/core/model'
import { buildPdf } from '../src/export/buildPdf'
import { loadFonts, openPdf, renderPage } from './helpers'

// Real government forms, kept outside git. Skipped when they are not present.
const FOLDER = resolve(__dirname, '../samples/private/corpus/forms')
const OUT = resolve(__dirname, '../samples/private/out/forms')

async function widgetsOf(pdf: Awaited<ReturnType<typeof openPdf>>) {
  const all: FormWidget[] = []
  const counts: Record<string, number> = {}
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number)
    const viewport = page.getViewport({ scale: 1 })
    const annotations = (await page.getAnnotations()) as (WidgetAnnotation & { rect: number[] })[]
    for (const annotation of annotations) {
      const [left, bottom, right, top] = annotation.rect as [number, number, number, number]
      const [x1, y1] = viewport.convertToViewportPoint(left, bottom) as [number, number]
      const [x2, y2] = viewport.convertToViewportPoint(right, top) as [number, number]
      const widget = toFormWidget(annotation, {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1)
      })
      const kind = widget?.kind ?? `other:${annotation.subtype}:${annotation.fieldType ?? ''}`
      counts[kind] = (counts[kind] ?? 0) + 1
      if (widget) all.push(widget)
    }
  }
  return { all, counts }
}

const names = existsSync(FOLDER) ? (await readdir(FOLDER)).filter((name) => name.endsWith('.pdf')) : []

describe.skipIf(names.length === 0)('real government forms', () => {
  it.each(names)('%s: every kind of field can be filled in and saved', { timeout: 120_000 }, async (name) => {
    const bytes = new Uint8Array(await readFile(join(FOLDER, name)))
    const pdf = await openPdf(bytes)
    const { all, counts } = await widgetsOf(pdf)
    await mkdir(OUT, { recursive: true })
    console.log(name, 'pages', pdf.numPages, JSON.stringify(counts))
    expect(all.length, 'fields found').toBeGreaterThan(0)

    const values: Record<string, FormValue> = {}
    const texts = new Map<string, string>()
    let index = 0
    for (const widget of all) {
      if (widget.fieldName in values) continue
      index++
      if (widget.kind === 'text') {
        // Fields can hold just a few characters.
        const text = `T${index}`.slice(0, widget.maxLength ?? 12)
        values[widget.fieldName] = text
        texts.set(widget.fieldName, text)
      } else if (widget.kind === 'checkbox') values[widget.fieldName] = true
      else if (widget.kind === 'radio') values[widget.fieldName] = widget.buttonValue
      else if (widget.options[0]) values[widget.fieldName] = [widget.options[0]]
    }

    const pages: PageRef[] = Array.from({ length: pdf.numPages }, (_, pageIndex) => ({
      id: `p${pageIndex}`,
      sourceId: 's1',
      pageIndex,
      rotation: 0,
      fields: []
    }))
    const document: EditorDocument = { sources: { s1: { name, bytes } }, formValues: { s1: values }, assets: {}, pages }
    const { bytes: output } = await buildPdf(document, await loadFonts())

    await writeFile(join(OUT, `${name}.filled.pdf`), output)
    await writeFile(join(OUT, `${name}.png`), (await renderPage(output, 1, 1.2)).png)

    const saved = await PDFDocument.load(output)
    expect(saved.getPageCount()).toBe(pdf.numPages)
    expect(saved.getForm().getFields(), 'form flattened').toHaveLength(0)

    const reread = await openPdf(output)
    const found: string[] = []
    for (let number = 1; number <= reread.numPages; number++) {
      const { items } = await (await reread.getPage(number)).getTextContent()
      for (const item of items) if ('str' in item) found.push(item.str.trim())
    }
    // A field with cells is printed one letter at a time, so the text is compared as one run.
    const allText = found.join('')
    const missing = [...texts.values()].filter((text) => !allText.includes(text))
    console.log(name, 'text values', texts.size, 'missing after save', missing.length, missing.slice(0, 10).join(' '))
    expect(missing.length / Math.max(texts.size, 1), 'share of values lost').toBeLessThan(0.02)
  })
})
