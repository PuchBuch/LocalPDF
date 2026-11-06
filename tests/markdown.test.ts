import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { pagesToMarkdown, type ContentItem, type TextRun } from '../src/core/markdown'
import { turnRect, toFormWidget, type FormWidget, type WidgetAnnotation } from '../src/core/forms'
import type { EditorDocument, Field, Rotation } from '../src/core/model'
import { extractMarkdown, type ContentPage } from '../src/export/extractContent'
import { makeRichForm } from './formFixture'
import { openPdf } from './helpers'

const run = (text: string, top: number, options: Partial<TextRun> = {}): TextRun => ({
  kind: 'text',
  text,
  x: 50,
  top,
  width: text.length * 6,
  height: 12,
  ...options
})

/** Enough body text to make 12 the document's body size. */
const body = (top: number) => run('Обычный текст абзаца, которого достаточно много на этой странице', top)

describe('pagesToMarkdown', () => {
  it('turns larger text into headings by its size against the body', () => {
    const page: ContentItem[] = [
      run('Заголовок', 50, { height: 24 }),
      run('Подзаголовок', 100, { height: 16 }),
      body(150),
      run('Чуть крупнее', 200, { height: 13 })
    ]
    expect(pagesToMarkdown([page])).toBe(
      `# Заголовок\n\n## Подзаголовок\n\n${body(0).text}\n\nЧуть крупнее`
    )
  })

  it('joins runs of a line in reading order, with spaces only where there is a gap', () => {
    const page = [
      run('мир', 100, { x: 140, width: 30 }),
      run('Прив', 100, { x: 50, width: 30 }),
      run('ет,', 100, { x: 80, width: 20 })
    ]
    expect(pagesToMarkdown([page])).toBe('Привет, мир')
  })

  it('keeps runs on one line despite slightly different heights', () => {
    const page = [run('Имя:', 100, { x: 50, width: 30 }), run('Анна', 99, { x: 100, width: 30, height: 14, entered: true })]
    expect(pagesToMarkdown([page])).toBe('Имя: Анна')
  })

  it('separates paragraphs by the gap between rows', () => {
    const page = [run('Один', 100), run('Два', 114), run('Три', 150), body(200)]
    expect(pagesToMarkdown([page])).toBe(`Один\nДва\n\nТри\n\n${body(0).text}`)
  })

  it('flows a wrapped paragraph and keeps short lines such as an address', () => {
    const wrapped = [
      run('длинная строка абзаца', 100, { width: 400 }),
      run('её продолжение', 114, { width: 100 }),
      run('Улица 1', 150, { width: 60 }),
      run('Берлин', 164, { width: 60 })
    ]
    expect(pagesToMarkdown([wrapped])).toBe('длинная строка абзаца её продолжение\n\nУлица 1\nБерлин')
  })

  it('puts blocks where they stand on the page', () => {
    const page: ContentItem[] = [
      run('Выше', 100),
      { kind: 'block', markdown: '![Signature](signature)', top: 120 },
      run('Ниже', 140)
    ]
    expect(pagesToMarkdown([page])).toBe('Выше\n\n![Signature](signature)\n\nНиже')
  })

  it('does not take a big entered value for a heading', () => {
    expect(pagesToMarkdown([[body(100), run('Анна', 150, { height: 30, entered: true })]])).toBe(
      `${body(0).text}\n\nАнна`
    )
  })

  it('keeps the order of pages and skips the empty ones', () => {
    expect(pagesToMarkdown([[run('Первая', 100)], [], [run('Третья', 100)]])).toBe('Первая\n\n\nТретья')
  })

  it('gives nothing for a document without content', () => {
    expect(pagesToMarkdown([[], []])).toBe('')
  })
})

describe('extractMarkdown', () => {
  async function samplePdf(rotate = 0): Promise<Uint8Array> {
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.Helvetica)
    for (const label of ['Page one', 'Page two']) {
      const page = document.addPage([595, 842])
      page.drawText(`${label} title`, { x: 50, y: 780, font, size: 28 })
      page.drawText('Body text of this page that sets the common size of the text here', { x: 50, y: 740, font, size: 12 })
      if (rotate) page.setRotation({ type: 'degrees', angle: rotate } as never)
    }
    return document.save()
  }

  async function extract(
    bytes: Uint8Array,
    arrange: (document: EditorDocument) => void = () => undefined,
    widgets: Record<string, FormWidget[]> = {},
    rotation: Rotation = 0
  ) {
    const pdf = await openPdf(bytes)
    const document: EditorDocument = {
      sources: { s1: { name: 'x.pdf', bytes } },
      formValues: {},
      assets: { a1: { mime: 'image/png', bytes: new Uint8Array() } },
      pages: Array.from({ length: pdf.numPages }, (_, pageIndex) => ({
        id: `p${pageIndex}`,
        sourceId: 's1',
        pageIndex,
        rotation,
        fields: []
      }))
    }
    arrange(document)
    const sizes = Object.fromEntries(document.pages.map((page) => [page.id, { width: 595, height: 842 }]))
    return extractMarkdown(document, widgets, sizes, async (_sourceId, pageIndex) => {
      return (await pdf.getPage(pageIndex + 1)) as unknown as ContentPage
    })
  }

  it('reads the text of the source with its headings, page after page', async () => {
    const markdown = await extract(await samplePdf())
    const body = 'Body text of this page that sets the common size of the text here'
    expect(markdown).toBe(`# Page one title\n\n${body}\n\n\n# Page two title\n\n${body}`)
  })

  it('follows the current order of pages and leaves out the deleted ones', async () => {
    const reversed = await extract(await samplePdf(), (document) => {
      document.pages.reverse()
    })
    expect(reversed.indexOf('Page two')).toBeLessThan(reversed.indexOf('Page one'))

    const without = await extract(await samplePdf(), (document) => {
      document.pages.shift()
    })
    expect(without).not.toContain('Page one')
  })

  it.each<[Rotation]>([[90], [180], [270]])('reads a page turned %i degrees in the editor the same way', async (rotation) => {
    const markdown = await extract(await samplePdf(), undefined, {}, rotation)
    expect(markdown.split('\n\n')[0]).toBe('# Page one title')
  })

  it('reads a page whose file stores it sideways', async () => {
    const markdown = await extract(await samplePdf(90))
    expect(markdown.split('\n\n')[0]).toBe('# Page one title')
  })

  it('places a field by the reading order of a turned page', async () => {
    const field = { id: '1', type: 'TEXT', value: 'Вписано', fontSize: 12, width: 100, height: 14, background: 'transparent' } as const
    // On a page turned 180 degrees, the bottom of the display is the top of the text.
    const markdown = await extract(
      await samplePdf(),
      (document) => {
        document.pages.pop()
        document.pages[0]!.fields = [{ ...field, x: 300, y: 820 }]
      },
      {},
      180
    )
    expect(markdown.indexOf('Вписано')).toBeLessThan(markdown.indexOf('Page one'))
  })

  it('includes added fields, in the spec format', async () => {
    const base = { width: 200, height: 20, background: 'transparent' as const }
    const fields: Field[] = [
      { ...base, id: '1', type: 'TEXT', x: 50, y: 300, value: 'Строка один\nСтрока два', fontSize: 12 },
      { ...base, id: '2', type: 'COMB_TEXT', x: 50, y: 400, value: '12345', fontSize: 12, spacing: 20 },
      { ...base, id: '3', type: 'CHECKBOX', x: 50, y: 500, value: 'tick' },
      { ...base, id: '4', type: 'CHECKBOX', x: 50, y: 550, value: null },
      { ...base, id: '5', type: 'SIGNATURE', x: 50, y: 600, assetId: 'a1' },
      { ...base, id: '6', type: 'SIGNATURE', x: 50, y: 640, assetId: null },
      { ...base, id: '7', type: 'PICTURE', x: 50, y: 680, assetId: 'a1' },
      { ...base, id: '8', type: 'TEXT', x: 50, y: 720, value: '', fontSize: 12 }
    ]
    const markdown = await extract(await samplePdf(), (document) => {
      document.pages[0]!.fields = fields
      document.pages.pop()
    })
    const afterText = markdown.split('size of the text here\n\n')[1]!
    expect(afterText).toBe(
      ['Строка один\nСтрока два', '```\n12345\n```', '[x]', '[ ]', '![Signature](signature)', '![Image](image)'].join('\n\n')
    )
  })

  describe('with a form', () => {
    let bytes: Uint8Array
    let widgets: FormWidget[]

    beforeAll(async () => {
      bytes = await makeRichForm()
      const pdf = await openPdf(bytes)
      const page = await pdf.getPage(1)
      const viewport = page.getViewport({ scale: 1 })
      const annotations = (await page.getAnnotations()) as (WidgetAnnotation & { rect: number[] })[]
      widgets = annotations.flatMap((annotation) => {
        const [left, bottom, right, top] = annotation.rect as [number, number, number, number]
        const [x1, y1] = viewport.convertToViewportPoint(left, bottom) as [number, number]
        const [x2, y2] = viewport.convertToViewportPoint(right, top) as [number, number]
        return (
          toFormWidget(annotation, {
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1)
          }) ?? []
        )
      })
    })

    it('includes current values and leaves empty fields out', async () => {
      const markdown = await extract(
        bytes,
        (document) => {
          document.pages.pop()
          document.formValues['s1'] = { name: 'Анна', city: ['Киев'], langs: ['Русский'], agree: true }
        },
        { p0: widgets }
      )
      expect(markdown).toContain('Анна')
      expect(markdown).toContain('Preset value')
      expect(markdown).toContain('Киев')
      expect(markdown).toContain('Русский')
      expect(markdown).toContain('[x]')
    })

    it('uses the boxes of turnRect on a turned page without losing values', async () => {
      expect(turnRect(widgets[0]!.rect, { width: 595, height: 842 }, 90).width).toBe(widgets[0]!.rect.height)
      const markdown = await extract(
        bytes,
        (document) => {
          document.pages.pop()
          document.formValues['s1'] = { name: 'Анна' }
        },
        { p0: widgets },
        90
      )
      expect(markdown).toContain('Анна')
    })
  })
})
