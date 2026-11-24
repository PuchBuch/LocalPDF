import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { answerFileDialog, answerSaveDialog, launchApp, ROOT } from './harness'

const PAGE = { width: 1000, height: 700 }
const COLUMNS = [40, 131, 338, 456, 627, 711, 885, 957]
const ROWS = [180, 232, ...Array.from({ length: 12 }, (_, row) => 232 + 33 * (row + 1))]
const HEADINGS = ['Datum', 'Firma', 'Stelle', 'Kontakt', 'Art', 'Ergebnis', 'Notiz']
/** Invented, as everything in these tests. */
const DATA = Array.from({ length: 8 }, (_, row) => [
  `0${row + 1}.11.2026`,
  `Beispiel ${row + 1} GmbH, Musterstraße ${row + 1}, 12345 Musterstadt`,
  'Monteur',
  `bewerbung${row + 1}@example.org`,
  '5',
  'offen',
  ''
])

let directory: string
let app: ElectronApplication
let page: Page
let userData: string
let requests: string[]

const pages = () => page.getByTestId('pdf-page')
const fields = () => page.getByTestId('field')
const status = () => page.getByTestId('saved-note')
const dialog = () => page.getByTestId('table-dialog')
const asTabs = (rows: string[][]) => rows.map((cells) => cells.join('\t')).join('\n')

/** A PDF that is only a picture of a form, laid slightly askew, as a scan is. */
async function writeScan(name: string, withTable = true): Promise<string> {
  GlobalFonts.registerFromPath(join(ROOT, 'src/renderer/public/fonts/LiberationSans-Regular.ttf'), 'Scan Sans')
  const scale = 2.87
  const canvas = createCanvas(Math.round(PAGE.width * scale), Math.round(PAGE.height * scale))
  const context = canvas.getContext('2d')
  context.fillStyle = '#fbfaf7'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.scale(scale, scale)
  context.translate(PAGE.width / 2, PAGE.height / 2)
  context.rotate((0.12 * Math.PI) / 180)
  context.translate(-PAGE.width / 2, -PAGE.height / 2)
  context.fillStyle = '#202020'
  context.strokeStyle = '#303030'
  context.font = '16px "Scan Sans"'
  context.fillText('Nachweis (Muster)', 40, 60)
  context.lineWidth = 1
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    context.beginPath()
    context.moveTo(x1, y1)
    context.lineTo(x2, y2)
    context.stroke()
  }
  if (withTable) {
    line(40, 150, 957, 150)
    context.font = '11px "Scan Sans"'
    HEADINGS.forEach((heading, column) => context.fillText(heading, COLUMNS[column]! + 6, 210))
    context.lineWidth = 0.6
    for (const y of ROWS) line(40, y, 957, y)
    for (const x of COLUMNS) line(x, ROWS[0]!, x, ROWS.at(-1)!)
    context.lineWidth = 2.5
    context.strokeRect(40, ROWS[0]!, 917, ROWS.at(-1)! - ROWS[0]!)
  }

  const document = await PDFDocument.create()
  const pdfPage = document.addPage([PAGE.width, PAGE.height])
  pdfPage.drawImage(await document.embedJpg(canvas.toBuffer('image/jpeg', 85)), { x: 0, y: 0, ...PAGE })
  const path = join(directory, name)
  await writeFile(path, await document.save())
  return path
}

async function open(path: string): Promise<void> {
  await answerFileDialog(app, [path])
  await page.getByTestId('select-file').click()
  await expect(pages().first()).toBeVisible()
}

async function chooseFillTable(): Promise<void> {
  await page.getByTestId('page-thumbnail').first().click({ button: 'right' })
  await page.getByTestId('fill-table').click()
}

/** The row and column of the table a field lies in, the heading being row 0. */
async function cellOf(index: number): Promise<{ row: number; column: number; right: number }> {
  const pageBox = (await pages().first().boundingBox())!
  const box = (await fields().nth(index).boundingBox())!
  const scale = pageBox.width / PAGE.width
  const x = (box.x - pageBox.x) / scale
  const middle = (box.y + box.height / 2 - pageBox.y) / scale
  return {
    row: ROWS.filter((top) => top < middle).length - 1,
    column: COLUMNS.filter((left) => left < x).length - 1,
    right: x + box.width / scale
  }
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'localpdf-e2e-table-'))
})

test.afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

test.beforeEach(async () => {
  ;({ app, page, userData } = await launchApp())
  requests = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!['app:', 'blob:', 'data:'].includes(url.protocol) && url.hostname !== 'localhost') requests.push(request.url())
  })
  await page.getByTestId('select-file').waitFor()
})

test.afterEach(async () => {
  await app.close()
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
})

test('writes pasted rows into the cells of a scanned table, as one step to undo', async () => {
  await open(await writeScan('table.pdf'))
  await chooseFillTable()
  await expect(page.getByTestId('table-found')).toHaveText('Найдена таблица: 7 колонок, 12 пустых строк')
  await expect(page.getByTestId('table-fill')).toBeDisabled()

  await page.getByTestId('table-text').fill(asTabs([HEADINGS, ...DATA]))
  await expect(page.getByTestId('table-preview')).toHaveText('Строк: 9, колонок: 7')
  await page.getByTestId('table-skip-heading').check()
  await expect(page.getByTestId('table-preview')).toHaveText('Строк: 8, колонок: 7')
  await expect(page.getByTestId('table-warning')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('table-dialog.png') })
  await page.getByTestId('table-fill').click()
  await expect(dialog()).toHaveCount(0)

  await expect(status()).toHaveText('Заполнено клеток: 48')
  await expect(fields()).toHaveCount(48)
  await page.screenshot({ path: test.info().outputPath('table-filled.png') })
  for (let index = 0; index < 48; index++) {
    const { row, column, right } = await cellOf(index)
    expect({ row, column }).toEqual({ row: 1 + Math.floor(index / 6), column: index % 6 })
    expect(right).toBeLessThanOrEqual(COLUMNS[column + 1]! + 1)
  }

  await page.getByTestId('undo').click()
  await expect(fields()).toHaveCount(0)
  await page.getByTestId('redo').click()
  await expect(fields()).toHaveCount(48)

  const path = join(directory, 'table-saved.pdf')
  await answerSaveDialog(app, path)
  await page.getByTestId('download').click()
  await expect(status()).toContainText('Сохранено')
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)), verbosity: 0 }).promise
  const { items } = await (await pdf.getPage(1)).getTextContent()
  const written = items.flatMap((item) => ('str' in item && item.str.trim() !== '' ? [item] : []))
  const text = written.map(({ str }) => str).join(' ')
  for (const cells of DATA) for (const cell of cells.slice(0, 3)) expect(text.replace(/\s+/g, ' ')).toContain(cell)
  expect(text).not.toContain('Ergebnis')
  // In the first row below the heading, and in the middle of its cell.
  const five = written.find(({ str }) => str === '5')!
  expect(five.transform[4]).toBeGreaterThan(660)
  expect(five.transform[4]).toBeLessThan(678)
  expect(PAGE.height - five.transform[5]).toBeGreaterThan(232)
  expect(PAGE.height - five.transform[5]).toBeLessThan(265)
  expect(requests).toEqual([])
})

test('a second fill goes on in the rows still empty, and says what has no room', async () => {
  await open(await writeScan('twice.pdf'))
  await chooseFillTable()
  await page.getByTestId('table-text').fill(asTabs(DATA))
  await page.getByTestId('table-fill').click()
  await expect(fields()).toHaveCount(48)

  await chooseFillTable()
  await expect(page.getByTestId('table-found')).toHaveText('Найдена таблица: 7 колонок, 4 пустые строки')
  await page.getByTestId('table-text').fill(DATA.map((cells) => [...cells, 'zu viel'].join(';')).join('\n'))
  await expect(page.getByTestId('table-warning')).toHaveText(['Лишние строки не войдут: 4', 'Лишние колонки не войдут: 1'])
  await page.getByTestId('table-fill').click()
  await expect(fields()).toHaveCount(48 + 24)
  expect((await cellOf(48)).row).toBe(9)
})

test('cancelling adds nothing, and Ctrl+Z in the dialog leaves the document alone', async () => {
  await open(await writeScan('cancel.pdf'))
  await page.getByTestId('tool-text').click()
  await pages().first().click({ position: { x: 60, y: 40 } })
  await page.getByTestId('tool-cursor').click()
  await expect(fields()).toHaveCount(1)

  await chooseFillTable()
  await page.getByTestId('table-text').pressSequentially('eins')
  await page.keyboard.press('Control+z')
  await page.getByTestId('table-skip-heading').focus()
  await page.keyboard.press('Control+z')
  await expect(dialog()).toBeVisible()
  await expect(fields()).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(dialog()).toHaveCount(0)
  await expect(fields()).toHaveCount(1)

  await chooseFillTable()
  await page.getByTestId('table-text').fill(asTabs(DATA))
  await page.getByTestId('table-cancel').click()
  await expect(fields()).toHaveCount(1)
})

test('says so on a page without a table', async () => {
  await open(await writeScan('no-table.pdf', false))
  await chooseFillTable()
  await expect(page.getByTestId('notice')).toContainText('Таблица на странице не найдена')
  await expect(dialog()).toHaveCount(0)
})
