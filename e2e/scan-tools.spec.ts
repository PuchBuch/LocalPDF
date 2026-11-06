import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { answerFileDialog, answerSaveDialog, launchApp, ROOT } from './harness'

const OUT = join(ROOT, 'samples', 'private', 'out')
/** Recognition takes seconds, with the engine and four languages to start. */
const OCR_TIMEOUT = 90_000

let directory: string
let app: ElectronApplication
let page: Page
let userData: string
let requests: string[]

const pages = () => page.getByTestId('pdf-page')
const fields = () => page.getByTestId('field')
const status = () => page.getByTestId('saved-note')

/** A PDF that is only a picture of a page with these lines of text, as a scan is. */
async function writeScan(name: string, lines: string[]): Promise<string> {
  GlobalFonts.registerFromPath(join(ROOT, 'src/renderer/public/fonts/LiberationSans-Regular.ttf'), 'Scan Sans')
  const canvas = createCanvas(1240, 1754)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, 1240, 1754)
  context.fillStyle = '#000000'
  context.font = '44px "Scan Sans"'
  lines.forEach((line, index) => context.fillText(line, 120, 200 + index * 90))

  const document = await PDFDocument.create()
  const pdfPage = document.addPage([595, 842])
  pdfPage.drawImage(await document.embedPng(canvas.toBuffer('image/png')), { x: 0, y: 0, width: 595, height: 842 })
  const path = join(directory, name)
  await writeFile(path, await document.save())
  return path
}

async function open(path: string): Promise<void> {
  await answerFileDialog(app, [path])
  await page.getByTestId('select-file').click()
  await expect(pages().first()).toBeVisible()
}

async function chooseInMenu(item: string, scope: 'this' | 'all' = 'this', thumbnail = 0): Promise<void> {
  await page.getByTestId('page-thumbnail').nth(thumbnail).click({ button: 'right' })
  await page.getByTestId(item).click()
  await page.getByTestId(`${item}-${scope}`).click()
}

async function save(name: string): Promise<string> {
  const path = join(directory, name)
  await answerSaveDialog(app, path)
  await page.getByTestId('download').click()
  await expect(page.getByTestId('saved-note')).toContainText('Сохранено')
  return path
}

async function textIn(path: string, pageNumber = 1): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)), verbosity: 0 }).promise
  const { items } = await (await pdf.getPage(pageNumber)).getTextContent()
  return items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' ')
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'localpdf-e2e-scan-'))
})

test.afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

test.beforeEach(async () => {
  ;({ app, page, userData } = await launchApp())
  requests = []
  // The whole point of a local app: nothing may leave the computer.
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!['app:', 'blob:', 'data:'].includes(url.protocol) && url.hostname !== 'localhost') requests.push(request.url())
  })
  page.on('requestfailed', (request) => {
    if (!request.url().startsWith('app:')) return
    requests.push(`failed: ${request.url()}`)
  })
  await page.getByTestId('select-file').waitFor()
})

test.afterEach(async () => {
  await app.close()
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
})

test.describe('recognizing a scan', () => {
  test('reads German and Russian offline, and the saved file can be searched', async () => {
    test.setTimeout(OCR_TIMEOUT * 2)
    await open(await writeScan('scan.pdf', ['Rechnung Nummer 12345', 'Größe und Maß', 'Привет большой мир']))
    await expect(page.locator('.textLayer').first()).toHaveText('')

    await chooseInMenu('recognize')
    await expect(status()).toContainText('Распознано слов', { timeout: OCR_TIMEOUT })
    expect(requests).toEqual([])

    const saved = await save('scan-searchable.pdf')
    const text = await textIn(saved)
    for (const word of ['Rechnung', '12345', 'Größe', 'Привет', 'мир']) expect(text).toContain(word)
  })

  test('its words can be edited and extracted, and the picture left underneath is reported', async () => {
    test.setTimeout(OCR_TIMEOUT * 2)
    await open(await writeScan('edit-scan.pdf', ['Datum 15.10.2026 Berlin']))
    await chooseInMenu('recognize')
    await expect(status()).toContainText('Распознано слов', { timeout: OCR_TIMEOUT })

    await page.getByTestId('tool-edit').click()
    await page.getByTestId('edit-scope-word').click()
    const word = page.getByRole('button', { name: '15.10.2026', exact: true })
    await expect(word).toBeVisible()
    await word.click()
    await expect(page.getByTestId('field-input')).toHaveValue('15.10.2026')
    // The scan has 44 pixels of a 1240 wide picture on a page of 595 points: size 21.
    const size = Number(await page.getByTestId('field-input').evaluate((element) => {
      const page = document.querySelector('[data-testid="pdf-page"]')!.getBoundingClientRect()
      return parseFloat(getComputedStyle(element).fontSize) / (page.width / 595)
    }))
    expect(Math.abs(size - 21.1), `size ${size}`).toBeLessThan(1.5)
    await page.getByTestId('field-input').fill('16.11.2027')
    await page.getByTestId('tool-cursor').click()
    await page.screenshot({ path: join(OUT, 'scan-edited.png') })

    const saved = await save('scan-edited.pdf')
    const text = await textIn(saved)
    expect(text).toContain('16.11.2027')
    expect(text).not.toContain('15.10.2026')
    expect(text).toContain('Berlin')
    await expect(page.getByTestId('notice')).toContainText('картинка')
  })

  test('undo forgets what was read', async () => {
    test.setTimeout(OCR_TIMEOUT * 2)
    await open(await writeScan('undo-scan.pdf', ['Rechnung Nummer']))
    await chooseInMenu('recognize')
    await expect(status()).toContainText('Распознано слов', { timeout: OCR_TIMEOUT })
    await page.getByTestId('undo').click()
    expect(await textIn(await save('undo-scan-saved.pdf'))).not.toContain('Rechnung')
  })

  test('leaves pages that have text of their own', async () => {
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.Helvetica)
    document.addPage([595, 842]).drawText('Real text', { x: 60, y: 700, font, size: 14 })
    const path = join(directory, 'text.pdf')
    await writeFile(path, await document.save())
    await open(path)
    await chooseInMenu('recognize')
    await expect(status()).toHaveText('На этих страницах уже есть текст, распознавать нечего')
    await expect(page.getByTestId('undo')).toBeDisabled()
  })

  test('says so when a page holds no text at all', async () => {
    test.setTimeout(OCR_TIMEOUT * 2)
    await open(await writeScan('blank.pdf', []))
    await chooseInMenu('recognize')
    await expect(page.getByTestId('notice')).toContainText('Текст не найден', { timeout: OCR_TIMEOUT })
  })
})

test.describe('finding fields', () => {
  async function writeForm(): Promise<string> {
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.Helvetica)
    const pdfPage = document.addPage([595, 842])
    const black = rgb(0, 0, 0)
    pdfPage.drawText('Antrag', { x: 60, y: 780, font, size: 20 })

    // A line to write on, with its label beside it.
    pdfPage.drawText('Name:', { x: 60, y: 702, font, size: 12 })
    pdfPage.drawLine({ start: { x: 110, y: 700 }, end: { x: 400, y: 700 }, thickness: 0.8, color: black })

    // Boxes to tick.
    pdfPage.drawRectangle({ x: 60, y: 650, width: 12, height: 12, borderColor: black, borderWidth: 0.8 })
    pdfPage.drawText('Ja', { x: 80, y: 652, font, size: 12 })
    pdfPage.drawRectangle({ x: 120, y: 650, width: 12, height: 12, borderColor: black, borderWidth: 0.8 })
    pdfPage.drawText('Nein', { x: 140, y: 652, font, size: 12 })

    // A wide box for text.
    pdfPage.drawRectangle({ x: 60, y: 560, width: 400, height: 50, borderColor: black, borderWidth: 0.8 })

    // Things that are not to be filled in: an underlined heading, and a box with text in it.
    pdfPage.drawText('Hinweis', { x: 60, y: 500, font, size: 14 })
    pdfPage.drawLine({ start: { x: 60, y: 497 }, end: { x: 118, y: 497 }, thickness: 0.8, color: black })
    pdfPage.drawRectangle({ x: 60, y: 440, width: 300, height: 30, borderColor: black, borderWidth: 0.8 })
    pdfPage.drawText('Schon ausgefuellt', { x: 70, y: 450, font, size: 12 })
    const path = join(directory, 'form.pdf')
    await writeFile(path, await document.save())
    return path
  }

  const onPage = async (index: number) => {
    const pageBox = (await pages().first().boundingBox())!
    const box = (await fields().nth(index).boundingBox())!
    const scale = pageBox.width / 595
    return { x: (box.x - pageBox.x) / scale, y: (box.y - pageBox.y) / scale, type: await fields().nth(index).getAttribute('data-field-type') }
  }

  test('adds empty fields where the page asks for them, and only there', async () => {
    await open(await writeForm())
    await chooseInMenu('find-fields')
    await expect(status()).toContainText('Найдено полей')
    await page.screenshot({ path: join(OUT, 'found-fields.png') })
    await expect(status()).toHaveText('Найдено полей: 4')
    await expect(fields()).toHaveCount(4)

    const found = await Promise.all([0, 1, 2, 3].map(onPage))
    const marks = found.filter((field) => field.type === 'CHECKBOX')
    const texts = found.filter((field) => field.type === 'TEXT')
    expect(marks).toHaveLength(2)
    expect(texts).toHaveLength(2)
    // On the line: the field ends where the line is, 842 - 700 = 142 from the top.
    expect(texts.some((field) => field.x > 105 && field.x < 115 && field.y > 125 && field.y < 142)).toBe(true)
    // In the box, whose top is 842 - 610 = 232 from the top.
    expect(texts.some((field) => field.x > 60 && field.x < 66 && field.y > 232 && field.y < 280)).toBe(true)
    expect(await page.getByTestId('field-checkbox').first().getAttribute('data-value')).toBe('empty')
  })

  test('is one step to undo, and does not add the same fields twice', async () => {
    await open(await writeForm())
    await chooseInMenu('find-fields')
    await expect(fields()).toHaveCount(4)

    await chooseInMenu('find-fields')
    await expect(status()).toHaveText('Полей для заполнения не найдено')
    await expect(fields()).toHaveCount(4)

    await page.getByTestId('undo').click()
    await expect(fields()).toHaveCount(0)
  })

  test('found fields can be filled in, and the empty ones print nothing', async () => {
    await open(await writeForm())
    await chooseInMenu('find-fields')
    await expect(fields()).toHaveCount(4)
    const input = page.getByTestId('field-input')
    await input.first().fill('Анна Мюллер')
    const text = await textIn(await save('filled.pdf'))
    expect(text).toContain('Анна Мюллер')
    expect(text).not.toContain('Aa')
  })

  test('says so on a page with nothing to fill in', async () => {
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.Helvetica)
    document.addPage([595, 842]).drawText('Just a letter', { x: 60, y: 700, font, size: 14 })
    const path = join(directory, 'letter.pdf')
    await writeFile(path, await document.save())
    await open(path)
    await chooseInMenu('find-fields')
    await expect(status()).toHaveText('Полей для заполнения не найдено')
    await expect(fields()).toHaveCount(0)
  })

  test('all pages are searched when asked', async () => {
    const document = await PDFDocument.create()
    for (let index = 0; index < 2; index++) {
      document.addPage([595, 842]).drawLine({
        start: { x: 110, y: 700 },
        end: { x: 400, y: 700 },
        thickness: 0.8,
        color: rgb(0, 0, 0)
      })
    }
    const path = join(directory, 'two.pdf')
    await writeFile(path, await document.save())
    await open(path)
    await chooseInMenu('find-fields', 'all')
    await expect(status()).toHaveText('Найдено полей: 2')
  })
})

test.describe('removing text for real', () => {
  test('a replaced word is gone from the saved file, the rest of the line stays text', async () => {
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.Helvetica)
    document.addPage([595, 842]).drawText('Konto 1234567 ist geheim', { x: 60, y: 700, font, size: 16 })
    const path = join(directory, 'secret.pdf')
    await writeFile(path, await document.save())
    await open(path)

    await page.getByTestId('tool-edit').click()
    await page.getByTestId('edit-scope-word').click()
    await page.getByRole('button', { name: '1234567', exact: true }).click()
    await page.getByTestId('field-input').fill('')
    await page.getByTestId('tool-cursor').click()

    const saved = await save('secret-removed.pdf')
    const text = await textIn(saved)
    expect(text).not.toContain('1234567')
    expect(text).toContain('Konto')
    expect(text).toContain('geheim')
    await expect(page.getByTestId('notice')).toHaveCount(0)
  })
})
