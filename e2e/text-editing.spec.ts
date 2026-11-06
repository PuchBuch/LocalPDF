import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { answerFileDialog, answerSaveDialog, canvasHasInk, expectSavedMatchesScreen, inkBox, launchApp, ROOT } from './harness'

const OUT = join(ROOT, 'samples', 'private', 'out')
const SAMPLE = join(ROOT, 'samples', 'private', 'sample-letter.pdf')

let directory: string
let app: ElectronApplication
let page: Page
let userData: string

const pages = () => page.getByTestId('pdf-page')
const lines = () => page.getByTestId('editable-line')
const fields = () => page.getByTestId('field')
const line = (text: string) => page.getByRole('button', { name: text, exact: true })

async function writeDocument(): Promise<string> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const pdfPage = document.addPage([595, 842])
  pdfPage.drawText('Heading of the page', { x: 60, y: 760, font, size: 24 })
  pdfPage.drawText('The line to replace', { x: 60, y: 700, font, size: 14 })
  pdfPage.drawText('A line that stays', { x: 60, y: 660, font, size: 14 })
  const path = join(directory, 'edit.pdf')
  await writeFile(path, await document.save())
  return path
}

async function openDocument(path?: string): Promise<void> {
  await answerFileDialog(app, [path ?? (await writeDocument())])
  await page.getByTestId('select-file').click()
  await expect(pages().first()).toBeVisible()
}

async function startEditing(): Promise<void> {
  await page.getByTestId('tool-edit').click()
  await expect(lines()).toHaveCount(3)
}

async function savedText(name: string): Promise<string[]> {
  const path = join(directory, name)
  await answerSaveDialog(app, path)
  await page.getByTestId('download').click()
  await expect(page.getByTestId('saved-note')).toBeVisible()
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)), verbosity: 0 }).promise
  const { items } = await (await pdf.getPage(1)).getTextContent()
  return items.flatMap((item) => ('str' in item && item.str.trim() !== '' ? [item.str] : []))
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'localpdf-e2e-edit-'))
})

test.afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

test.beforeEach(async () => {
  ;({ app, page, userData } = await launchApp())
  await page.getByTestId('select-file').waitFor()
})

test.afterEach(async () => {
  await app.close()
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
})

test('offers the lines of the page only while the tool is on', async () => {
  await openDocument()
  await expect(lines()).toHaveCount(0)
  await startEditing()
  await expect(page.getByTestId('tool-hint')).toContainText('Править текст')
  await page.getByTestId('tool-cursor').click()
  await expect(lines()).toHaveCount(0)
})

test('clicking a line gives its text, at its size, ready for typing', async () => {
  await openDocument()
  await startEditing()
  await line('The line to replace').click()

  const input = page.getByTestId('field-input')
  await expect(input).toHaveValue('The line to replace')
  await expect(input).toBeFocused()
  await expect(page.getByTestId('font-size')).toHaveText('14')
  await expect(lines()).toHaveCount(2)

  await page.keyboard.type(' and more')
  await expect(input).toHaveValue('The line to replace and more')
  await expect(pages().getByTestId('text-cover')).toHaveCount(1)
})

test('the screen and the saved file agree, with the old text painted out', async () => {
  await openDocument()
  await startEditing()
  await line('The line to replace').click()
  await page.getByTestId('field-input').fill('Short')
  await expectSavedMatchesScreen(app, page, join(directory, 'match.pdf'), { x: 40, y: 125, width: 300, height: 30 })
})

test('saves the new text, and keeps the other lines', async () => {
  await openDocument()
  await startEditing()
  await line('The line to replace').click()
  await page.getByTestId('field-input').fill('Заменённый текст')
  const text = await savedText('replaced.pdf')
  expect(text).toContain('Заменённый текст')
  expect(text).toContain('A line that stays')
})

test('emptying a line removes it from the page on screen', async () => {
  await openDocument()
  await startEditing()
  await line('The line to replace').click()
  await page.getByTestId('field-input').fill('')
  await page.getByTestId('tool-cursor').click()
  await expect(page.getByTestId('field-input')).toHaveValue('')

  // The placeholder of the empty field is pale, so dark ink here could only be the old line.
  const box = (await pages().getByTestId('text-cover').first().boundingBox())!
  expect((await inkBox(await page.screenshot({ clip: box }))).right).toBe(-1)
  expect(await canvasHasInk(page, 0)).toBe(true)
})

test('moving the field leaves the line painted out, deleting it brings the line back', async () => {
  await openDocument()
  await startEditing()
  const cover = async () => pages().getByTestId('text-cover').boundingBox()

  await line('The line to replace').click()
  const before = await cover()

  const handle = (await page.getByTestId('field-grab-handle').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + 200, handle.y + 300, { steps: 4 })
  await page.mouse.up()
  expect(await cover()).toEqual(before)

  await page.getByTestId('field-delete').click()
  await expect(pages().getByTestId('text-cover')).toHaveCount(0)
  await expect(fields()).toHaveCount(0)
  await expect(line('The line to replace')).toBeVisible()
})

test('undo brings the line back, redo the edit', async () => {
  await openDocument()
  await startEditing()
  await line('The line to replace').click()
  await expect(fields()).toHaveCount(1)
  await page.getByTestId('undo').click()
  await expect(fields()).toHaveCount(0)
  await expect(lines()).toHaveCount(3)
  await page.getByTestId('redo').click()
  await expect(fields()).toHaveCount(1)
  await expect(lines()).toHaveCount(2)
})

test('a copy of the field is new text and paints nothing out', async () => {
  await openDocument()
  await startEditing()
  await line('The line to replace').click()
  await page.getByTestId('field-copy').click()
  const box = (await pages().first().boundingBox())!
  await page.mouse.click(box.x + 300, box.y + 500)
  await expect(fields()).toHaveCount(2)
  await expect(pages().getByTestId('text-cover')).toHaveCount(1)
})

test('clearing the fields of the page keeps the lines painted out', async () => {
  await openDocument()
  await startEditing()
  await line('The line to replace').click()
  await page.getByTestId('tool-cursor').click()
  await page.getByTestId('page-thumbnail').first().click({ button: 'right' })
  await page.getByTestId('clear-fields').click()
  await expect(page.getByTestId('field-input')).toHaveValue('')
  await expect(pages().getByTestId('text-cover')).toHaveCount(1)
})

test('thumbnails show the edit', async () => {
  await openDocument()
  await startEditing()
  await line('The line to replace').click()
  await expect(page.locator('.thumbnails [data-testid="text-cover"]')).toHaveCount(1)
})

test('survives a turn of the page and comes back editable', async () => {
  await openDocument()
  await startEditing()
  await line('A line that stays').click()
  await page.getByTestId('rotate-page').click()
  await expect(pages().getByTestId('text-cover')).toHaveCount(1)
  // On a page lying on its side the text reads along, not across, so nothing is on offer.
  await expect(lines()).toHaveCount(0)
  for (let turn = 0; turn < 3; turn++) await page.getByTestId('rotate-page').click()
  await expect(lines()).toHaveCount(2)
})

test.describe('editing one word', () => {
  const words = () => page.getByTestId('editable-word')
  const word = (text: string) => page.getByRole('button', { name: text, exact: true })

  async function writeInFont(font: StandardFonts, name: string): Promise<string> {
    const document = await PDFDocument.create()
    const pdfFont = await document.embedFont(font)
    const pdfPage = document.addPage([595, 842])
    pdfPage.drawText('Datum 15.10.2026 in Berlin', { x: 60, y: 700, font: pdfFont, size: 16 })
    const path = join(directory, name)
    await writeFile(path, await document.save())
    return path
  }

  async function startWordEditing(path: string): Promise<void> {
    await openDocument(path)
    await page.getByTestId('tool-edit').click()
    await page.getByTestId('edit-scope-word').click()
    await expect(words()).toHaveCount(4)
  }

  /** How much dark ink a part of the first page has, given in points. */
  async function inkAt(x: number, y: number, width: number, height: number): Promise<number> {
    const box = (await pages().first().boundingBox())!
    const scale = box.width / 595
    const found = await inkBox(
      await page.screenshot({
        clip: { x: box.x + x * scale, y: box.y + y * scale, width: width * scale, height: height * scale }
      })
    )
    return found.right
  }

  test('offers words, and only while that is chosen', async () => {
    await openDocument(await writeInFont(StandardFonts.Helvetica, 'scope.pdf'))
    await page.getByTestId('tool-edit').click()
    await expect(page.getByTestId('editable-line')).toHaveCount(1)
    await expect(words()).toHaveCount(0)
    await page.getByTestId('edit-scope-word').click()
    await expect(words()).toHaveCount(4)
    await expect(page.getByTestId('editable-line')).toHaveCount(0)
  })

  test('replaces one word and leaves the rest of the line as it was', async () => {
    await startWordEditing(await writeInFont(StandardFonts.Helvetica, 'word.pdf'))
    await word('15.10.2026').click()
    const input = page.getByTestId('field-input')
    await expect(input).toHaveValue('15.10.2026')
    await input.fill('16.11.2027')
    await expect(words()).toHaveCount(3)

    await page.getByTestId('tool-cursor').click()
    await page.screenshot({ path: join(OUT, 'word-edit.png') })

    const text = await savedText('word-saved.pdf')
    expect(text).toContain('16.11.2027')
    // The old word has left the file, its neighbours are still real text of the page.
    expect(text.join(' ')).not.toContain('15.10.2026')
    expect(text.join(' ')).toContain('Datum')
    expect(text.join(' ')).toContain('Berlin')
  })

  test('its patch does not bite into the neighbouring words', async () => {
    await startWordEditing(await writeInFont(StandardFonts.Helvetica, 'neighbours.pdf'))
    const before = (await word('15.10.2026').boundingBox())!
    await word('15.10.2026').click()
    await page.getByTestId('field-input').fill('')
    await page.getByTestId('tool-cursor').click()
    const cover = (await pages().getByTestId('text-cover').boundingBox())!
    expect(Math.abs(cover.x - before.x)).toBeLessThan(6)

    // The word is gone, and both neighbours still have ink right up to it.
    const box = (await pages().first().boundingBox())!
    const scale = box.width / 595
    const coverLeft = (cover.x - box.x) / scale
    const coverRight = (cover.x + cover.width - box.x) / scale
    expect(await inkAt(coverLeft + 1, 842 - 716, coverRight - coverLeft - 2, 18)).toBe(-1)
    expect(await inkAt(60, 842 - 716, coverLeft - 60, 18)).toBeGreaterThan(0)
    expect(await inkAt(coverRight, 842 - 716, 30, 18)).toBeGreaterThan(0)
  })

  test('picks up a font like the document: Times here', async () => {
    await startWordEditing(await writeInFont(StandardFonts.TimesRoman, 'times.pdf'))
    await word('15.10.2026').click()
    await expect(page.getByTestId('field-input')).toHaveValue('15.10.2026')
    await page.getByTestId('font-tool').click()
    await expect(page.getByTestId('font-family')).toHaveValue('times')
  })

  test('picks up a font like the document: Courier here', async () => {
    await startWordEditing(await writeInFont(StandardFonts.Courier, 'courier.pdf'))
    await word('15.10.2026').click()
    await expect(page.getByTestId('field-input')).toHaveValue('15.10.2026')
    await page.getByTestId('font-tool').click()
    await expect(page.getByTestId('font-family')).toHaveValue('courier')
  })

  test('a line with a word replaced cannot also be taken whole', async () => {
    await startWordEditing(await writeInFont(StandardFonts.Helvetica, 'both.pdf'))
    await word('Berlin').click()
    await expect(page.getByTestId('field-input')).toHaveValue('Berlin')
    await page.getByTestId('edit-scope-line').click()
    await expect(page.getByTestId('editable-line')).toHaveCount(0)
  })

  for (const [font, id] of [
    [StandardFonts.Helvetica, 'arial'],
    [StandardFonts.TimesRoman, 'times'],
    [StandardFonts.Courier, 'courier']
  ] as const) {
    test(`the screen and the saved file agree in the ${id} family`, async () => {
      await startWordEditing(await writeInFont(font, `match-${id}.pdf`))
      await word('15.10.2026').click()
      await page.getByTestId('field-input').fill('16.11.2027')
      await expectSavedMatchesScreen(app, page, join(directory, `match-${id}-saved.pdf`), { x: 40, y: 125, width: 400, height: 25 })
    })
  }
})

test.describe('the font tool', () => {
  const look = () =>
    page.getByTestId('field-input').evaluate((element) => {
      const { fontFamily, fontWeight, fontStyle, color } = getComputedStyle(element)
      return { fontFamily, fontWeight, fontStyle, color }
    })

  async function addFocusedText(text: string): Promise<void> {
    await page.getByTestId('tool-text').click()
    const box = (await pages().first().boundingBox())!
    const scale = box.width / 595
    await page.mouse.click(box.x + 100 * scale, box.y + 400 * scale)
    await page.keyboard.type(text)
    await page.getByTestId('font-tool').click()
    await expect(page.getByTestId('font-tool-panel')).toBeVisible()
  }

  test('changes family, bold, italic and colour, and resizes the field to fit', async () => {
    await openDocument()
    await addFocusedText('Новый текст')
    const before = (await fields().first().boundingBox())!

    await page.getByTestId('font-family').selectOption('times')
    expect((await look()).fontFamily).toContain('Tinos')
    await page.getByTestId('font-bold').click()
    expect((await look()).fontWeight).toBe('700')
    await page.getByTestId('font-italic').click()
    expect((await look()).fontStyle).toBe('italic')
    await page.getByTestId('font-color').fill('#cc0000')
    expect((await look()).color).toBe('rgb(204, 0, 0)')

    await page.screenshot({ path: join(OUT, 'font-tool.png') })
    expect((await fields().first().boundingBox())!.width).not.toBe(before.width)
  })

  test('each change is a step to undo, and a run of colours is one', async () => {
    await openDocument()
    await addFocusedText('Текст')
    await page.getByTestId('font-bold').click()
    await page.getByTestId('font-color').fill('#cc0000')
    await page.getByTestId('font-color').fill('#00cc00')
    expect((await look()).color).toBe('rgb(0, 204, 0)')

    await page.getByTestId('undo').click()
    expect((await look()).color).toBe('rgb(0, 0, 0)')
    expect((await look()).fontWeight).toBe('700')
    await page.getByTestId('undo').click()
    expect((await look()).fontWeight).toBe('400')
  })

  test('saves what it shows, for a field added by hand too', async () => {
    await openDocument()
    await addFocusedText('Жирный Times')
    await page.getByTestId('font-family').selectOption('times')
    await page.getByTestId('font-bold').click()
    await expectSavedMatchesScreen(app, page, join(directory, 'font-tool.pdf'), { x: 90, y: 390, width: 300, height: 30 })
  })

  test('is only there for text fields', async () => {
    await openDocument()
    await page.getByTestId('tool-checkbox').click()
    const box = (await pages().first().boundingBox())!
    await page.mouse.click(box.x + 150, box.y + 300)
    await expect(fields()).toHaveCount(1)
    await expect(page.getByTestId('field-grab-handle')).toBeVisible()
    await expect(page.getByTestId('font-tool')).toHaveCount(0)
  })
})

async function expectRealDocumentSaved(): Promise<void> {
  const output = join(OUT, 'edit-saved.pdf')
  await answerSaveDialog(app, output)
  await page.getByTestId('download').click()
  await expect(page.getByTestId('saved-note')).toBeVisible()
  const pdf = await PDFDocument.load(await readFile(output))
  expect(pdf.getPageCount()).toBeGreaterThan(0)
}

test.describe('keeping the look of the line', () => {
  async function writeStyled(): Promise<string> {
    const document = await PDFDocument.create()
    const pdfPage = document.addPage([595, 842])
    const bold = await document.embedFont(StandardFonts.HelveticaBold)
    const italic = await document.embedFont(StandardFonts.HelveticaOblique)
    const regular = await document.embedFont(StandardFonts.Helvetica)
    pdfPage.drawRectangle({ x: 0, y: 690, width: 595, height: 40, color: rgb(1, 240 / 255, 150 / 255) })
    pdfPage.drawText('Red bold heading', { x: 60, y: 700, font: bold, size: 20, color: rgb(200 / 255, 0, 0) })
    pdfPage.drawText('Blue slanted line', { x: 60, y: 640, font: italic, size: 14, color: rgb(0, 0, 200 / 255) })
    pdfPage.drawText('Plain line', { x: 60, y: 600, font: regular, size: 14 })
    pdfPage.drawText('Black bold line', { x: 60, y: 560, font: bold, size: 18 })
    const path = join(directory, 'styled.pdf')
    await writeFile(path, await document.save())
    return path
  }

  const look = (locator: ReturnType<typeof page.getByTestId>) =>
    locator.evaluate((element) => {
      const { fontWeight, fontStyle, color } = getComputedStyle(element)
      return { fontWeight, fontStyle, color }
    })

  test('a bold red line on yellow stays so, and its patch cannot be seen', async () => {
    await openDocument(await writeStyled())
    await page.getByTestId('tool-edit').click()
    await line('Red bold heading').click()

    const input = page.getByTestId('field-input')
    await expect(input).toHaveValue('Red bold heading')
    expect(await look(input)).toMatchObject({ fontWeight: '700', fontStyle: 'normal', color: 'rgb(200, 0, 0)' })
    const cover = pages().getByTestId('text-cover')
    expect(await cover.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 240, 150)')
  })

  test('a slanted blue line stays so, and a plain one stays plain and black', async () => {
    await openDocument(await writeStyled())
    await page.getByTestId('tool-edit').click()

    await line('Blue slanted line').click()
    await expect(page.getByTestId('field-input')).toHaveValue('Blue slanted line')
    expect(await look(page.getByTestId('field-input'))).toMatchObject({
      fontWeight: '400',
      fontStyle: 'italic',
      color: 'rgb(0, 0, 200)'
    })

    // On a small screen the panels of the focused field can lie over the next line.
    await page.getByTestId('tool-edit').click()
    await line('Plain line').click()
    const plain = page.getByTestId('field-input').nth(1)
    await expect(plain).toHaveValue('Plain line')
    expect(await look(plain)).toMatchObject({ fontWeight: '400', fontStyle: 'normal', color: 'rgb(0, 0, 0)' })
  })

  test('the screen and the saved file agree for a bold line', async () => {
    await openDocument(await writeStyled())
    await page.getByTestId('tool-edit').click()
    await line('Black bold line').click()
    await page.getByTestId('field-input').fill('Жирный заголовок')
    await expectSavedMatchesScreen(app, page, join(directory, 'bold-match.pdf'), { x: 40, y: 262, width: 400, height: 30 })
  })

  test('a quick second click does not make two fields', async () => {
    await openDocument(await writeStyled())
    await page.getByTestId('tool-edit').click()
    const box = (await line('Plain line').boundingBox())!
    await page.mouse.dblclick(box.x + 5, box.y + box.height / 2)
    await expect(page.getByTestId('field-input')).toHaveValue('Plain line')
    await page.waitForTimeout(300)
    await expect(fields()).toHaveCount(1)
  })
})

test('on a real document', async () => {
  test.skip(!existsSync(SAMPLE), 'the personal sample is not here')
  await openDocument(SAMPLE)
  await page.getByTestId('tool-edit').click()
  await expect(lines().first()).toBeVisible()
  await page.screenshot({ path: join(OUT, 'edit-lines.png') })

  const target = lines().nth(1)
  const label = (await target.getAttribute('aria-label'))!
  await target.click()
  await expect(page.getByTestId('field-input')).toHaveValue(label)
  await page.screenshot({ path: join(OUT, 'edit-untouched.png') })

  await page.getByTestId('field-input').fill(`${label} (исправлено)`)

  // A bold heading of the letter stays bold.
  await page.getByRole('button', { name: /^Bewerbung/ }).click()
  const heading = page.getByTestId('field-input').nth(1)
  await expect(heading).toHaveValue(/^Bewerbung/)
  expect(await heading.evaluate((element) => getComputedStyle(element).fontWeight)).toBe('700')
  await page.keyboard.type(' (исправлено)')

  await page.getByTestId('tool-cursor').click()
  await page.screenshot({ path: join(OUT, 'edit-changed.png') })
  await expectRealDocumentSaved()
})
