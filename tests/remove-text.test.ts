import fontkit from '@pdf-lib/fontkit'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  decodePDFRawStream,
  degrees,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
  rgb,
  StandardFonts
} from 'pdf-lib'
import type { EditorDocument, Rotation } from '../src/core/model'
import { fieldForLine, type TextLine } from '../src/core/textLines'
import { buildPdf, type ExportFonts } from '../src/export/buildPdf'
import { pagesWithLeftoverText, pageTextLines, type ContentPage } from '../src/export/extractContent'
import { dropUnreachableObjects, removeTextInAreas } from '../src/export/removeText'
import { loadFonts, makeTwoColorPng, openPdf, renderPage, singlePageDocument } from './helpers'

const ROOT = resolve(__dirname, '..')

let fonts: ExportFonts

beforeAll(async () => {
  fonts = await loadFonts()
})

/** Everything text extraction finds on a page. */
async function textOf(bytes: Uint8Array, pageNumber = 1): Promise<string> {
  const pdf = await openPdf(bytes)
  const { items } = await (await pdf.getPage(pageNumber)).getTextContent()
  return items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' ').replace(/\s+/g, ' ').trim()
}

/** All the decoded content of a file, as bytes in a string, for looking for what must be gone. */
async function allStreamText(bytes: Uint8Array): Promise<string> {
  const document = await PDFDocument.load(bytes)
  return document.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) => {
      if (!(object instanceof PDFRawStream)) return []
      try {
        return [new TextDecoder('latin1').decode(decodePDFRawStream(object).decode())]
      } catch {
        return []
      }
    })
    .join('\n')
}

async function linesOf(bytes: Uint8Array, rotation: Rotation = 0) {
  return pageTextLines((await (await openPdf(bytes)).getPage(1)) as unknown as ContentPage, rotation)
}

async function replaceLine(bytes: Uint8Array, text: string, value: string, rotation: Rotation = 0) {
  const line = (await linesOf(bytes, rotation)).find((candidate) => candidate.text === text)!
  expect(line, `line "${text}"`).toBeDefined()
  const document = singlePageDocument(bytes, [{ ...fieldForLine('f', line), value }], rotation)
  return { document, output: (await buildPdf(document, fonts)).bytes }
}

async function standardPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const page = document.addPage([595, 842])
  page.drawText('Heading stays', { x: 60, y: 760, font, size: 24 })
  page.drawText('SECRET 12345', { x: 60, y: 700, font, size: 14 })
  page.drawText('Line that stays', { x: 60, y: 660, font, size: 14 })
  return document.save()
}

async function embeddedFontPdf(text: string): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const font = await document.embedFont(fonts.text.arial.Regular, { subset: true })
  const page = document.addPage([595, 842])
  page.drawText(text, { x: 60, y: 700, font, size: 14 })
  page.drawText('Строка остаётся', { x: 60, y: 660, font, size: 14 })
  return document.save()
}

/** A page whose content is written by hand, to reach what generators do not produce. */
async function handWrittenPdf(content: string, setup?: (document: PDFDocument) => void): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const page = document.addPage([595, 842])
  page.setFont(font)
  const resources = page.node.Resources()!
  resources.set(PDFName.of('Font'), document.context.obj({ F1: font.ref }))
  setup?.(document)
  page.node.set(PDFName.of('Contents'), document.context.register(document.context.flateStream(content)))
  return document.save()
}

describe('cutting text out of the file', () => {
  it('removes a replaced line from the text of the page', async () => {
    const { output } = await replaceLine(await standardPdf(), 'SECRET 12345', 'Новое')
    const text = await textOf(output)
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('12345')
    expect(text).toContain('Новое')
    expect(text).toContain('Heading stays')
    expect(text).toContain('Line that stays')
  })

  it('leaves no trace of it in any stream of the file', async () => {
    const { output } = await replaceLine(await standardPdf(), 'SECRET 12345', 'x')
    const streams = await allStreamText(output)
    // pdf-lib writes standard font text in hex.
    const hex = Buffer.from('SECRET').toString('hex').toUpperCase()
    expect(streams.toUpperCase()).not.toContain(hex)
    expect(streams).not.toContain('SECRET')
  })

  it('removes it when emptied too', async () => {
    const { output } = await replaceLine(await standardPdf(), 'SECRET 12345', '')
    expect(await textOf(output)).toBe('Heading stays Line that stays')
  })

  it('keeps the rest of the page looking the same, pixel for pixel', async () => {
    const source = await standardPdf()
    const { output } = await replaceLine(source, 'SECRET 12345', '')
    const before = await renderPage(source)
    const after = await renderPage(output)
    for (const [x, y] of [[62, 842 - 750], [120, 842 - 770], [66, 842 - 656], [100, 842 - 664]] as const) {
      expect(after.colorAt(x, y)).toEqual(before.colorAt(x, y))
    }
  })

  it('works for an embedded font, Cyrillic text included', async () => {
    const { output } = await replaceLine(await embeddedFontPdf('Паспорт номер 777'), 'Паспорт номер 777', 'Убрано')
    const text = await textOf(output)
    expect(text).not.toContain('Паспорт')
    expect(text).not.toContain('777')
    expect(text).toContain('Строка остаётся')
    expect(text).toContain('Убрано')
  })

  it('leaves a document without replaced text byte-identical in its content', async () => {
    const source = await standardPdf()
    const plain = singlePageDocument(source, [])
    expect(await allStreamText((await buildPdf(plain, fonts)).bytes)).toContain(
      await allStreamText(source).then((text) => text.slice(0, 40))
    )
  })
})

describe('cutting one word out of a line', () => {
  async function pdfWithDate(font: StandardFonts, size = 14): Promise<Uint8Array> {
    const document = await PDFDocument.create()
    const pdfFont = await document.embedFont(font)
    document.addPage([595, 842]).drawText('Datum 15.10.2026 in Berlin', { x: 60, y: 700, font: pdfFont, size })
    return document.save()
  }

  /** The word's exact place, from the real widths of the font. */
  async function exactBox(bytes: Uint8Array, font: StandardFonts, size = 14): Promise<TextLine> {
    const document = await PDFDocument.create()
    const pdfFont = await document.embedFont(font)
    return {
      text: '15.10.2026',
      x: 60 + pdfFont.widthOfTextAtSize('Datum ', size),
      baseline: 842 - 700,
      width: pdfFont.widthOfTextAtSize('15.10.2026', size),
      height: size
    }
  }

  it.each([StandardFonts.Helvetica, StandardFonts.TimesRoman, StandardFonts.Courier])(
    'removes the word in %s, its neighbours stay real text in their places',
    async (font) => {
      const bytes = await pdfWithDate(font)
      const word = await exactBox(bytes, font)
      const document = singlePageDocument(bytes, [{ ...fieldForLine('f', word), value: '' }])
      const { bytes: output } = await buildPdf(document, fonts)

      const text = await textOf(output)
      expect(text).not.toMatch(/15|10\.|2026/)
      expect(text).toContain('Datum')
      expect(text).toContain('in Berlin')

      // The end of the line, which is measured the same way before and after.
      const before = await pageTextItems(bytes)
      const after = await pageTextItems(output)
      expect(after.at(-1)!.right).toBeCloseTo(before.at(-1)!.right, 1)
    }
  )

  it('does not take a letter of the next word along', async () => {
    const bytes = await pdfWithDate(StandardFonts.Helvetica)
    const word = await exactBox(bytes, StandardFonts.Helvetica)
    const document = singlePageDocument(bytes, [{ ...fieldForLine('f', word), value: '' }])
    const page = await renderPage((await buildPdf(document, fonts)).bytes)
    const original = await renderPage(bytes)
    // A column through the "i" of "in", right after the word.
    let same = true
    const x = word.x + word.width + 5
    for (let y = 130; y < 146; y += 0.5) {
      if (page.colorAt(x, y)[0] !== original.colorAt(x, y)[0]) same = false
    }
    expect(same).toBe(true)
  })
})

describe('text written in every way a file can', () => {
  const area = { x: 50, y: 690, width: 200, height: 30 }

  async function cut(bytes: Uint8Array, areas = [area]) {
    const document = await PDFDocument.load(bytes)
    const result = removeTextInAreas(document, document.getPage(0), areas)
    dropUnreachableObjects(document)
    return { result, output: await document.save() }
  }

  it.each([
    ['Tj with a literal string', 'BT /F1 14 Tf 60 700 Td (SECRET) Tj ET BT /F1 14 Tf 60 400 Td (Stays) Tj ET'],
    ['Tj with a hex string', 'BT /F1 14 Tf 60 700 Td <534543524554> Tj ET BT /F1 14 Tf 60 400 Td (Stays) Tj ET'],
    ['TJ with kerning', 'BT /F1 14 Tf 60 700 Td [(SEC) -20 (RET)] TJ ET BT /F1 14 Tf 60 400 Td (Stays) Tj ET'],
    ['a text matrix', 'BT /F1 1 Tf 14 0 0 14 60 700 Tm (SECRET) Tj ET BT /F1 14 Tf 60 400 Td (Stays) Tj ET'],
    ['the current matrix', 'q 1 0 0 1 60 700 cm BT /F1 14 Tf (SECRET) Tj ET Q BT /F1 14 Tf 60 400 Td (Stays) Tj ET'],
    ['a scale in the matrix', 'q 2 0 0 2 60 700 cm BT /F1 7 Tf 0 0 Td (SECRET) Tj ET Q BT /F1 14 Tf 60 400 Td (Stays) Tj ET'],
    ["the ' operator", "BT /F1 14 Tf 14 TL 60 714 Td (SECRET) ' ET BT /F1 14 Tf 60 400 Td (Stays) Tj ET"],
    ['the " operator', 'BT /F1 14 Tf 14 TL 60 714 Td 0 0 (SECRET) " ET BT /F1 14 Tf 60 400 Td (Stays) Tj ET'],
    ['T* with a leading', 'BT /F1 14 Tf 14 TL 60 714 Td T* (SECRET) Tj ET BT /F1 14 Tf 60 400 Td (Stays) Tj ET'],
    ['TD setting the leading', 'BT /F1 14 Tf 60 714 Td 0 -14 TD (SECRET) Tj ET BT /F1 14 Tf 60 400 Td (Stays) Tj ET'],
    ['escapes in a string', 'BT /F1 14 Tf 60 700 Td (SE\\103RET\\051) Tj ET BT /F1 14 Tf 60 400 Td (Stays) Tj ET'],
    ['hidden text', 'BT /F1 14 Tf 3 Tr 60 700 Td (SECRET) Tj ET BT 0 Tr /F1 14 Tf 60 400 Td (Stays) Tj ET'],
    ['text before an inline image', 'BI /W 1 /H 1 /CS /G /BPC 8 ID \xff EI BT /F1 14 Tf 60 700 Td (SECRET) Tj ET BT /F1 14 Tf 60 400 Td (Stays) Tj ET']
  ])('cuts out %s', async (_name, content) => {
    const source = await handWrittenPdf(content)
    expect(await textOf(source)).toContain('S')
    const { output, result } = await cut(source)
    expect(result.removed).toBeGreaterThan(0)
    const text = await textOf(output)
    expect(text).not.toMatch(/SEC|RET/)
    expect(text).toBe('Stays')
  })

  it('keeps following text in place with character and word spacing', async () => {
    const source = await handWrittenPdf('BT /F1 14 Tf 2 Tc 5 Tw 60 700 Td (SECRET and after) Tj ET')
    const { output } = await cut(source, [{ x: 50, y: 690, width: 80, height: 30 }])
    expect(await textOf(output)).not.toContain('SECRET')

    // Through the pixels, since each viewer measures spaced text its own way.
    const before = await renderPage(source)
    const after = await renderPage(output)
    let dark = 0
    for (let x = 145; x < 240; x += 0.5) {
      for (let y = 842 - 712; y < 842 - 696; y += 0.5) {
        expect(after.colorAt(x, y)).toEqual(before.colorAt(x, y))
        if (before.colorAt(x, y)[0] < 128) dark++
      }
    }
    expect(dark).toBeGreaterThan(100)
  })

  it('takes statements of what the text stands for along', async () => {
    const source = await handWrittenPdf(
      '/Span <</ActualText (SECRET)>> BDC BT /F1 14 Tf 60 700 Td (SECRET) Tj ET EMC BT /F1 14 Tf 60 400 Td (Stays) Tj ET'
    )
    const { output } = await cut(source)
    expect(await allStreamText(output)).not.toContain('SECRET')
    expect(await textOf(output)).toBe('Stays')
  })

  it('looks inside a form drawn on the page, and leaves a form other pages share alone', async () => {
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.Helvetica)
    const form = document.context.register(
      document.context.flateStream('BT /F1 14 Tf 10 10 Td (SECRET) Tj ET', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 300, 50],
        Resources: { Font: { F1: font.ref } }
      })
    )
    for (let index = 0; index < 2; index++) {
      const page = document.addPage([595, 842])
      page.node.Resources()!.set(PDFName.of('XObject'), document.context.obj({ X1: form }))
      page.node.set(PDFName.of('Contents'), document.context.register(document.context.flateStream('q 1 0 0 1 50 690 cm /X1 Do Q')))
    }
    const source = await document.save()
    expect(await textOf(source, 1)).toBe('SECRET')

    const loaded = await PDFDocument.load(source)
    const { removed } = removeTextInAreas(loaded, loaded.getPage(0), [area])
    expect(removed).toBe(6)
    const output = await loaded.save()
    expect(await textOf(output, 1)).toBe('')
    expect(await textOf(output, 2)).toBe('SECRET')
  })

  it('reports an image lying under an area, which it cannot cut', async () => {
    const document = await PDFDocument.create()
    const page = document.addPage([595, 842])
    page.drawImage(await document.embedPng(makeTwoColorPng()), { x: 50, y: 680, width: 100, height: 50 })
    const loaded = await PDFDocument.load(await document.save())
    expect(removeTextInAreas(loaded, loaded.getPage(0), [area]).imageUnderArea).toBe(true)
    expect(removeTextInAreas(loaded, loaded.getPage(0), [{ x: 300, y: 100, width: 50, height: 50 }]).imageUnderArea).toBe(false)
  })

  it('changes nothing away from the areas', async () => {
    const source = await handWrittenPdf('BT /F1 14 Tf 60 400 Td (Stays) Tj ET')
    const { result, output } = await cut(source)
    expect(result.removed).toBe(0)
    expect(await textOf(output)).toBe('Stays')
  })
})

/** Text items with where they end, in points. */
async function pageTextItems(bytes: Uint8Array) {
  const pdf = await openPdf(bytes)
  const { items } = await (await pdf.getPage(1)).getTextContent()
  return items.flatMap((item) =>
    'str' in item && item.str.trim() !== '' ? [{ text: item.str, right: item.transform[4] + item.width }] : []
  )
}

describe('on turned pages', () => {
  it.each<[Rotation]>([[0], [90], [180], [270]])('with a page the file turns %i degrees', async (rotate) => {
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.Helvetica)
    const page = document.addPage([595, 842])
    // Each direction of text reads upright once the page is displayed.
    const at = { 0: { x: 100, y: 700 }, 90: { x: 100, y: 200 }, 180: { x: 400, y: 200 }, 270: { x: 400, y: 600 } }[rotate]
    const angle = { 0: 0, 90: 90, 180: 180, 270: 270 }[rotate]
    page.drawText('SECRET', { ...at, font, size: 14, rotate: degrees(angle) })
    page.drawText('Other line', { x: at.x + (rotate === 90 ? 40 : rotate === 270 ? -40 : 0), y: at.y + (rotate === 0 ? -40 : rotate === 180 ? 40 : 0), font, size: 14, rotate: degrees(angle) })
    page.setRotation(degrees(rotate))
    const source = await document.save()

    const { output } = await replaceLine(source, 'SECRET', 'Новый')
    const text = await textOf(output)
    expect(text).not.toContain('SECRET')
    expect(text).toContain('Other line')
    expect(text).toContain('Новый')
  })

  it('after turning the page in the editor', async () => {
    const source = await standardPdf()
    const line = (await linesOf(source)).find((candidate) => candidate.text === 'SECRET 12345')!
    const field = { ...fieldForLine('f', line), value: '' }
    const document = singlePageDocument(source, [field])
    const { rotatePageClockwise } = await import('../src/core/pageOperations')
    rotatePageClockwise(document, 'p1', { width: 595, height: 842 })
    const text = await textOf((await buildPdf(document, fonts)).bytes)
    expect(text).not.toContain('SECRET')
    expect(text).toContain('Line that stays')
  })
})

describe('the independent check', () => {
  const check = async (document: EditorDocument, bytes: Uint8Array) => {
    const pdf = await openPdf(bytes)
    return pagesWithLeftoverText(document, async (index) => (await pdf.getPage(index + 1)) as unknown as ContentPage)
  }

  it('finds nothing after a clean removal', async () => {
    const { document } = await replaceLine(await standardPdf(), 'SECRET 12345', 'Новое')
    const { bytes } = await buildPdf(document, fonts, { withoutFields: true })
    expect(await check(document, bytes)).toEqual([])
  })

  it('catches text that is still there', async () => {
    const source = await standardPdf()
    const { document } = await replaceLine(source, 'SECRET 12345', 'Новое')
    expect(await check(document, source)).toEqual([1])
  })

  it('leaves the added text out of what it reads', async () => {
    const { document } = await replaceLine(await standardPdf(), 'SECRET 12345', 'Новое')
    const { bytes } = await buildPdf(document, fonts, { withoutFields: true })
    expect(await textOf(bytes)).not.toContain('Новое')
  })
})

describe('with other parts of a document', () => {
  it('removes text under a form value too, and keeps the other forms', async () => {
    const { makeRichForm } = await import('./formFixture')
    const bytes = await makeRichForm()
    const document = singlePageDocument(bytes, [])
    document.formValues = { s1: { name: 'Анна' } }
    const line: TextLine = { text: 'Form page one', x: 50, baseline: 842 - 800, width: 90, height: 12 }
    document.pages[0]!.fields = [{ ...fieldForLine('f', line), value: '' }]
    const { bytes: output } = await buildPdf(document, fonts)
    const text = await textOf(output)
    expect(text).not.toContain('Form page one')
    expect(text).toContain('Анна')
  })

  it('a page used twice is cut only where it was edited', async () => {
    const source = await standardPdf()
    const line = (await linesOf(source)).find((candidate) => candidate.text === 'SECRET 12345')!
    const document: EditorDocument = {
      sources: { s1: { name: 'x.pdf', bytes: source } },
      formValues: {},
      assets: {},
      pages: [
        { id: 'a', sourceId: 's1', pageIndex: 0, rotation: 0, fields: [{ ...fieldForLine('f', line), value: '' }] },
        { id: 'b', sourceId: 's1', pageIndex: 0, rotation: 0, fields: [] }
      ]
    }
    const { bytes } = await buildPdf(document, fonts)
    expect(await textOf(bytes, 1)).not.toContain('SECRET')
    expect(await textOf(bytes, 2)).toContain('SECRET')
  })

  it('does not carry a string like the old one in the file as metadata', async () => {
    const source = await PDFDocument.load(await standardPdf())
    source.setTitle('SECRET title')
    source.getPage(0).node.set(PDFName.of('Marker'), PDFString.of('x'))
    const { output } = await replaceLine(await source.save(), 'SECRET 12345', '')
    expect(new TextDecoder('latin1').decode(output)).not.toContain('SECRET title')
  })

  it('draws the new text, and only it, over a coloured background', async () => {
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.Helvetica)
    const page = document.addPage([595, 842])
    page.drawRectangle({ x: 0, y: 680, width: 595, height: 60, color: rgb(1, 1, 0) })
    page.drawText('SECRET', { x: 60, y: 700, font, size: 14 })
    const { output } = await replaceLine(await document.save(), 'SECRET', 'Новое')
    expect(await textOf(output)).toBe('Новое')
  })
})

describe.skipIf(!existsSync(join(ROOT, 'samples/private/sample-letter.pdf')))('on real documents', () => {
  it.each(['sample-letter.pdf', 'sample-cv.pdf'])('%s: a line leaves, everything else stays', async (name) => {
    const bytes = new Uint8Array(await readFile(join(ROOT, 'samples/private', name)))
    const lines = await linesOf(bytes)
    const target = lines[1]!
    const others = lines.filter((line) => line !== target)

    const document = singlePageDocument(bytes, [{ ...fieldForLine('f', target), value: 'ZZZ' }])
    document.pages[0]!.pageIndex = 0
    const { bytes: output } = await buildPdf(document, fonts)
    const after = await linesOf(output)
    const texts = after.map((line) => line.text)

    expect(texts).not.toContain(target.text)
    expect(texts).toContain('ZZZ')
    for (const other of others) expect(texts, `lost: ${other.text}`).toContain(other.text)
  })
})
