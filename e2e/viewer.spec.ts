import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { answerFileDialog, canvasHasInk, launchApp, ROOT, writePdf } from './harness'

const PRIVATE_SAMPLE = join(ROOT, 'samples/private/sample-letter.pdf')

let directory: string
let app: ElectronApplication
let page: Page
let problems: string[]

const makePdf = (name: string, pages: { text: string; rotate?: number }[]) => writePdf(directory, name, pages)

async function openWithDialog(...paths: string[]): Promise<void> {
  await answerFileDialog(app, paths)
  await page.getByTestId('select-file').click()
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'localpdf-e2e-'))
})

test.afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
  problems = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    const isProblem = message.type() === 'error' || /fake worker|Unable to load|failed to fetch/i.test(message.text())
    if (isProblem) problems.push(`${message.type()}: ${message.text()}`)
  })
  await page.getByTestId('select-file').waitFor()
})

test.afterEach(async () => {
  await app.close()
})

test('runs isolated from Node and the network', async () => {
  const report = await page.evaluate(async () => {
    let externalBlocked = false
    try {
      await fetch('https://example.com/')
    } catch {
      externalBlocked = true
    }
    let fileBlocked = false
    try {
      await fetch('file:///C:/Windows/win.ini')
    } catch {
      fileBlocked = true
    }
    return {
      externalBlocked,
      fileBlocked,
      nodeExposed: 'require' in window || 'process' in window,
      origin: window.location.origin
    }
  })
  expect(report).toEqual({ externalBlocked: true, fileBlocked: true, nodeExposed: false, origin: 'app://local' })
})

test('serves everything pdf.js fetches at runtime, and nothing outside the app', async () => {
  const statuses = await page.evaluate(async () => {
    const status = async (path: string) => (await fetch(path)).status
    return {
      cmap: await status('pdfjs/cmaps/UniGB-UTF16-H.bcmap'),
      font: await status('pdfjs/standard_fonts/LiberationSans-Regular.ttf'),
      wasm: await status('pdfjs/wasm/openjpeg.wasm'),
      traversal: await status('app://local/..%2f..%2fpackage.json')
    }
  })
  expect(statuses).toEqual({ cmap: 200, font: 200, wasm: 200, traversal: 404 })
})

test('shows pages, text and thumbnails of an opened file', async () => {
  await openWithDialog(await makePdf('two.pdf', [{ text: 'Alpha page' }, { text: 'Beta page' }]))

  const pages = page.getByTestId('pdf-page')
  await expect(pages).toHaveCount(2)
  await expect(page.getByTestId('page-thumbnail')).toHaveCount(2)
  await expect(page.getByTestId('page-counter')).toHaveText('Страница 1 из 2')
  await expect(pages.nth(0).locator('.textLayer')).toContainText('Alpha page')
  await expect.poll(() => canvasHasInk(page, 0)).toBe(true)
  await expect(page.locator('.thumbnail canvas').first()).toBeVisible()

  expect(problems).toEqual([])
})

test('lets the mouse select the text of a page', async () => {
  await openWithDialog(await makePdf('select.pdf', [{ text: 'Selectable words' }]))
  const span = page.locator('.textLayer span', { hasText: 'Selectable words' })
  await span.waitFor()

  // A drag started within about 50 ms of the text appearing sometimes stopped short,
  // for a reason not yet known. After this pause it held in 100 runs out of 100.
  await page.locator('.thumbnail canvas').first().waitFor()
  await page.waitForTimeout(300)

  const box = (await span.boundingBox())!
  await page.mouse.move(box.x + 1, box.y + box.height / 2)
  await page.mouse.down()
  // Paced like a hand: Chromium can merge moves sent all at once and stop the selection short.
  for (let step = 1; step <= 5; step++) {
    await page.mouse.move(box.x + 1 + ((box.width - 2) * step) / 5, box.y + box.height / 2)
    await page.waitForTimeout(30)
  }
  await page.mouse.up()

  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('Selectable')
})

test('lays the text layer over the ink on a page with its own rotation', async () => {
  await openWithDialog(await makePdf('rotated.pdf', [{ text: 'Sideways line', rotate: 90 }]))
  const pdfPage = page.getByTestId('pdf-page').first()
  const span = pdfPage.locator('.textLayer span', { hasText: 'Sideways line' })
  await span.waitFor()

  const pageBox = (await pdfPage.boundingBox())!
  // A4 turned on its side, fitted to the area width.
  expect(pageBox.width / pageBox.height).toBeCloseTo(842 / 595, 2)

  // The text starts 60 pt from the left and 760 pt up the unrotated page. Turned
  // clockwise, that is 760 pt from the left and 60 pt from the top, reading downwards.
  const scale = pageBox.width / 842
  const box = (await span.boundingBox())!
  expect(box.height).toBeGreaterThan(box.width)
  expect(Math.abs(box.x - pageBox.x - 760 * scale)).toBeLessThan(30 * scale)
  expect(Math.abs(box.y - pageBox.y - 60 * scale)).toBeLessThan(10 * scale)
})

test('zooms by the spec steps and keeps the view on the same page', async () => {
  await openWithDialog(await makePdf('zoom.pdf', Array.from({ length: 8 }, (_, i) => ({ text: `Page ${i + 1}` }))))
  const pages = page.getByTestId('pdf-page')
  await expect(pages).toHaveCount(8)

  const fitted = (await pages.first().boundingBox())!.width
  const area = (await page.getByTestId('document-scroll').evaluate((element) => element.clientWidth))
  expect(fitted).toBeCloseTo(area - 16, 1)

  await page.getByTestId('page-thumbnail').nth(4).click()
  await expect(page.getByTestId('page-counter')).toHaveText('Страница 5 из 8')

  const zoomIn = page.getByTestId('increase-zoom-level')
  const zoomOut = page.getByTestId('decrease-zoom-level')
  await zoomIn.click()
  await expect(page.getByTestId('zoom-level')).toHaveText('150 %')
  expect((await pages.first().boundingBox())!.width).toBeCloseTo(Math.round((area - 16) * 1.5), 1)
  await expect(page.getByTestId('page-counter')).toHaveText('Страница 5 из 8')
  expect(
    await page.getByTestId('document-scroll').evaluate((element) => element.scrollWidth > element.clientWidth)
  ).toBe(true)

  await zoomOut.click()
  await zoomOut.click()
  await zoomOut.click()
  await expect(page.getByTestId('zoom-level')).toHaveText('50 %')
  await expect(page.getByTestId('page-counter')).toHaveText('Страница 5 из 8')
  await zoomOut.click()
  await expect(page.getByTestId('zoom-level')).toHaveText('25 %')
  await expect(zoomOut).toBeDisabled()
})

test('draws a sharp page at high zoom without exceeding the canvas limit', async () => {
  await openWithDialog(await makePdf('big-zoom.pdf', [{ text: 'Zoomed' }]))
  const zoomIn = page.getByTestId('increase-zoom-level')
  for (let click = 0; click < 12; click++) await zoomIn.click()
  await expect(page.getByTestId('zoom-level')).toHaveText('700 %')

  // The canvas of the previous zoom stays on screen until the new one is ready.
  const canvasPixels = () =>
    page.locator('.page-canvas canvas').first().evaluate((canvas: HTMLCanvasElement) => canvas.width * canvas.height)
  await expect.poll(canvasPixels, { timeout: 20_000 }).toBeGreaterThan(8_000_000)
  expect(await canvasPixels()).toBeLessThanOrEqual(16_000_000)
  expect(await canvasHasInk(page, 0)).toBe(true)
})

test('keeps only the pages near the view on canvas in a long document', async () => {
  const pagesInFile = Array.from({ length: 300 }, (_, i) => ({ text: `Long page ${i + 1}` }))
  await openWithDialog(await makePdf('long.pdf', pagesInFile))
  await expect(page.getByTestId('pdf-page')).toHaveCount(300)
  await expect.poll(() => canvasHasInk(page, 0)).toBe(true)

  await page.getByTestId('document-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2
  })
  await expect(page.getByTestId('page-counter')).toHaveText(/Страница 15\d из 300/)
  await expect(page.locator('.textLayer', { hasText: /Long page 15\d/ }).first()).toBeVisible()

  await expect.poll(() => page.locator('.page-canvas canvas').count()).toBeLessThan(10)
  await expect.poll(() => page.locator('.thumbnail canvas').count()).toBeLessThan(20)
  await expect(page.getByTestId('pdf-page').first().locator('canvas')).toHaveCount(0)
})

test('goes to a page from its thumbnail and marks it as current', async () => {
  await openWithDialog(await makePdf('nav.pdf', Array.from({ length: 6 }, (_, i) => ({ text: `Nav ${i + 1}` }))))
  const thumbnails = page.getByTestId('page-thumbnail')
  await thumbnails.nth(3).click()

  await expect(page.getByTestId('page-counter')).toHaveText('Страница 4 из 6')
  await expect(thumbnails.nth(3)).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.textLayer', { hasText: 'Nav 4' })).toBeInViewport()
})

test('opens several files as one document and adds a dropped file to the end', async () => {
  const first = await makePdf('first.pdf', [{ text: 'From first' }])
  const second = await makePdf('second.pdf', [{ text: 'From second' }, { text: 'Second again' }])
  await openWithDialog(first, second)
  await expect(page.getByTestId('pdf-page')).toHaveCount(3)

  const third = await PDFDocument.create()
  third.addPage([595, 842])
  const bytes = Array.from(await third.save())
  await page.evaluate((content) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(content)], 'dropped.pdf', { type: 'application/pdf' }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }, bytes)

  await expect(page.getByTestId('pdf-page')).toHaveCount(4)
  await expect(page.getByTestId('page-counter')).toHaveText('Страница 1 из 4')
})

test('explains why a file did not open and stays usable', async () => {
  const broken = join(directory, 'broken.pdf')
  await writeFile(broken, 'this is not a pdf')
  const good = await makePdf('good.pdf', [{ text: 'Still fine' }])
  await openWithDialog(broken, good)

  await expect(page.getByTestId('notice')).toContainText('«broken.pdf»')
  await expect(page.getByTestId('pdf-page')).toHaveCount(1)
  await page.getByTestId('notice').getByRole('button').click()
  await expect(page.getByTestId('notice')).toHaveCount(0)
})

test('rejects a dropped file that is not a PDF', async () => {
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['x'], 'photo.png', { type: 'image/png' }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  })
  await expect(page.getByTestId('notice')).toContainText('«photo.png»')
  await expect(page.getByTestId('select-file')).toBeVisible()
})

test('New file returns to the empty screen', async () => {
  await openWithDialog(await makePdf('reset.pdf', [{ text: 'Reset me' }]))
  await expect(page.getByTestId('pdf-page')).toHaveCount(1)
  await page.getByTestId('new-file').click()
  await expect(page.getByTestId('select-file')).toBeVisible()
  await expect(page.getByTestId('pdf-page')).toHaveCount(0)
  expect(problems).toEqual([])
})

test('shows a real document', async () => {
  test.skip(!existsSync(PRIVATE_SAMPLE), 'private sample is not present')
  await openWithDialog(PRIVATE_SAMPLE)
  await expect(page.getByTestId('pdf-page')).toHaveCount(2)
  await expect(page.locator('.textLayer').first()).toContainText('Bewerbung')
  await expect.poll(() => canvasHasInk(page, 0)).toBe(true)
  await expect(page.locator('.thumbnail canvas')).toHaveCount(2)

  await page.waitForTimeout(400)
  await page.screenshot({ path: join(ROOT, 'samples/private/out/viewer.png') })
  expect(problems).toEqual([])
})
