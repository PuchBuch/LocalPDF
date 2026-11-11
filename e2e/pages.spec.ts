import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { answerFileDialog, canvasColorAt, dropFile, launchApp, writePdf } from './harness'

let directory: string
let app: ElectronApplication
let page: Page

const isRed = (color: number[] | null) => color !== null && color[0]! > 200 && color[1]! < 60 && color[2]! < 60
const isBlue = (color: number[] | null) => color !== null && color[0]! < 60 && color[1]! < 60 && color[2]! > 200

async function openPages(...labels: string[]): Promise<void> {
  const path = await writePdf(directory, 'pages.pdf', labels.map((text) => ({ text })))
  await answerFileDialog(app, [path])
  await page.getByTestId('select-file').click()
  await expect(page.getByTestId('pdf-page')).toHaveCount(labels.length)
  // At 25% every test page is near the view, so all their text layers exist.
  for (let click = 0; click < 3; click++) await page.getByTestId('decrease-zoom-level').click()
}

/** The labels of all pages, in the order they are displayed. */
function pageOrder(): Promise<string[]> {
  return page.locator('.textLayer').evaluateAll((layers) => layers.map((layer) => layer.textContent?.trim() ?? ''))
}

const action = (name: string, index: number) => page.getByTestId(name).nth(index)
const undoButton = () => page.getByTestId('undo')
const redoButton = () => page.getByTestId('redo')

/** A PNG with the left half red and the right half blue. */
function twoColorCanvas(width: number, height: number) {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ff0000'
  context.fillRect(0, 0, width / 2, height)
  context.fillStyle = '#0000ff'
  context.fillRect(width / 2, 0, width / 2, height)
  return canvas
}

function pageRatio(index: number): Promise<number> {
  return page
    .getByTestId('pdf-page')
    .nth(index)
    .evaluate((element) => element.clientWidth / element.clientHeight)
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'localpdf-e2e-pages-'))
})

test.afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
  await page.getByTestId('select-file').waitFor()
})

test.afterEach(async () => {
  await app.close()
})

test('deletes a page at once and brings it back with undo', async () => {
  await openPages('One', 'Two', 'Three')
  await expect.poll(pageOrder).toEqual(['One', 'Two', 'Three'])

  await action('delete-page', 1).click()

  await expect(page.getByTestId('pdf-page')).toHaveCount(2)
  await expect.poll(pageOrder).toEqual(['One', 'Three'])
  await expect(page.getByTestId('page-counter')).toHaveText('Страница 1 из 2')
  await expect(page.getByTestId('page-number')).toHaveText(['1', '2'])

  await undoButton().click()
  await expect.poll(pageOrder).toEqual(['One', 'Two', 'Three'])
  await expect(page.getByTestId('page-number')).toHaveText(['1', '2', '3'])
})

test('does not allow deleting the only page', async () => {
  await openPages('Alone')
  await expect(action('delete-page', 0)).toBeDisabled()
})

test('keeps a valid current page when the current page is deleted', async () => {
  await openPages('One', 'Two', 'Three')
  await page.getByTestId('page-thumbnail').nth(2).click()
  await expect(page.getByTestId('page-counter')).toHaveText('Страница 3 из 3')

  await action('delete-page', 2).click()
  await expect(page.getByTestId('page-counter')).toHaveText('Страница 2 из 2')
  await expect(page.getByTestId('page-thumbnail').nth(1)).toHaveAttribute('aria-current', 'page')
})

test('a thumbnail click near the end of the document stays on that page', async () => {
  // At 25% the view holds several pages, so the scroll stops with another page in the middle.
  await openPages('One', 'Two', 'Three', 'Four', 'Five', 'Six')
  await page.getByTestId('page-thumbnail').nth(5).click()
  await expect(page.getByTestId('page-counter')).toHaveText('Страница 6 из 6')
  await page.waitForTimeout(300)
  await expect(page.getByTestId('page-counter')).toHaveText('Страница 6 из 6')
  await expect(page.getByTestId('page-thumbnail').nth(5)).toHaveAttribute('aria-current', 'page')

  // The reader's own scrolling still moves the current page.
  await page.getByTestId('document-scroll').evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(page.getByTestId('page-counter')).not.toHaveText('Страница 6 из 6')
})

test('moves pages up and down, and stops at the ends', async () => {
  await openPages('One', 'Two', 'Three')
  await expect(action('move-page-up', 0)).toBeDisabled()
  await expect(action('move-page-down', 2)).toBeDisabled()

  await action('move-page-down', 0).click()
  await expect.poll(pageOrder).toEqual(['Two', 'One', 'Three'])
  await expect(action('move-page-up', 0)).toBeDisabled()

  await action('move-page-up', 2).click()
  await expect.poll(pageOrder).toEqual(['Two', 'Three', 'One'])
  await expect(action('move-page-down', 2)).toBeDisabled()
})

test('rotates a page clockwise, with each click adding 90 degrees', async () => {
  await openPages('Turn me', 'Stay')
  await expect(page.locator('.textLayer').first()).toContainText('Turn me')
  const portrait = await pageRatio(0)
  expect(portrait).toBeCloseTo(595 / 842, 2)

  const textBox = () => page.locator('.textLayer span', { hasText: 'Turn me' }).boundingBox()
  const pageBox = () => page.getByTestId('pdf-page').first().boundingBox()

  await action('rotate-page', 0).click()
  await expect.poll(() => pageRatio(0)).toBeCloseTo(842 / 595, 2)
  expect(await pageRatio(1)).toBeCloseTo(595 / 842, 2)
  // Turned clockwise, the line that ran across the top now runs down the right side.
  await expect
    .poll(async () => {
      const [text, box] = [await textBox(), await pageBox()]
      return text !== null && box !== null && text.height > text.width && text.x > box.x + box.width / 2
    })
    .toBe(true)

  await action('rotate-page', 0).click()
  await expect.poll(() => pageRatio(0)).toBeCloseTo(595 / 842, 2)
  // Upside down, the line sits near the bottom of the page.
  await expect
    .poll(async () => {
      const [text, box] = [await textBox(), await pageBox()]
      return text !== null && box !== null && text.y > box.y + box.height / 2
    })
    .toBe(true)

  await action('rotate-page', 0).click()
  await action('rotate-page', 0).click()
  await expect.poll(() => pageRatio(0)).toBeCloseTo(595 / 842, 2)
  await expect
    .poll(async () => {
      const [text, box] = [await textBox(), await pageBox()]
      return text !== null && box !== null && text.width > text.height && text.y < box.y + box.height / 2
    })
    .toBe(true)
})

test('undoes and redoes with buttons and with the keyboard', async () => {
  await openPages('One', 'Two', 'Three')
  await expect(undoButton()).toBeDisabled()
  await expect(redoButton()).toBeDisabled()

  await action('delete-page', 0).click()
  await action('move-page-down', 0).click()
  await expect.poll(pageOrder).toEqual(['Three', 'Two'])
  await expect(undoButton()).toBeEnabled()

  await page.keyboard.press('Control+KeyZ')
  await expect.poll(pageOrder).toEqual(['Two', 'Three'])
  await expect(redoButton()).toBeEnabled()

  await page.keyboard.press('Control+KeyZ')
  await expect.poll(pageOrder).toEqual(['One', 'Two', 'Three'])
  await expect(undoButton()).toBeDisabled()

  await page.keyboard.press('Control+Shift+KeyZ')
  await expect.poll(pageOrder).toEqual(['Two', 'Three'])

  await redoButton().click()
  await expect.poll(pageOrder).toEqual(['Three', 'Two'])
  await expect(redoButton()).toBeDisabled()
})

test('a new action after undo clears redo', async () => {
  await openPages('One', 'Two', 'Three')
  await action('delete-page', 0).click()
  await undoButton().click()
  await expect(redoButton()).toBeEnabled()
  await action('rotate-page', 0).click()
  await expect(redoButton()).toBeDisabled()
})

test('undoes a rotation of the page', async () => {
  await openPages('One', 'Two')
  await action('rotate-page', 1).click()
  await expect.poll(() => pageRatio(1)).toBeCloseTo(842 / 595, 2)
  await page.keyboard.press('Control+KeyZ')
  await expect.poll(() => pageRatio(1)).toBeCloseTo(595 / 842, 2)
})

test('deleting a page above keeps the view on the same content', async () => {
  const labels = Array.from({ length: 8 }, (_, index) => `Page ${index + 1}`)
  await openPages(...labels)
  for (let click = 0; click < 3; click++) await page.getByTestId('increase-zoom-level').click()

  await page.getByTestId('page-thumbnail').nth(5).click()
  await expect(page.getByTestId('page-counter')).toHaveText('Страница 6 из 8')
  const label = page.locator('.textLayer', { hasText: 'Page 6' })
  await expect(label).toBeInViewport()

  await action('delete-page', 0).click()

  await expect(page.getByTestId('pdf-page')).toHaveCount(7)
  await expect(label).toBeInViewport()
  await expect(page.getByTestId('page-counter')).toHaveText('Страница 5 из 7')
})

test('adds pages to the end with the plus tile, as one undo step', async () => {
  await openPages('One')
  const first = await writePdf(directory, 'more.pdf', [{ text: 'Two' }, { text: 'Three' }])
  const second = await writePdf(directory, 'even-more.pdf', [{ text: 'Four' }])
  await answerFileDialog(app, [first, second])

  await page.getByTestId('add-pages').click()

  await expect(page.getByTestId('pdf-page')).toHaveCount(4)
  await expect.poll(pageOrder).toEqual(['One', 'Two', 'Three', 'Four'])

  await undoButton().click()
  await expect(page.getByTestId('pdf-page')).toHaveCount(1)
  await redoButton().click()
  await expect.poll(pageOrder).toEqual(['One', 'Two', 'Three', 'Four'])
})

test('opening the first file cannot be undone into an empty document', async () => {
  await openPages('One')
  await expect(undoButton()).toBeDisabled()
  await page.keyboard.press('Control+KeyZ')
  await expect(page.getByTestId('pdf-page')).toHaveCount(1)
})

test('opens a PNG as a page with its proportions', async () => {
  const path = join(directory, 'wide.png')
  await writeFile(path, twoColorCanvas(400, 200).toBuffer('image/png'))
  await answerFileDialog(app, [path])
  await page.getByTestId('select-file').click()
  await page.getByTestId('scan-as-is').click()

  await expect(page.getByTestId('pdf-page')).toHaveCount(1)
  expect(await pageRatio(0)).toBeCloseTo(2, 1)
  await expect.poll(async () => isRed(await canvasColorAt(page, 0, 0.25, 0.5))).toBe(true)
  await expect.poll(async () => isBlue(await canvasColorAt(page, 0, 0.75, 0.5))).toBe(true)
})

test('adds a JPEG, a WebP and a GIF after a PDF', async () => {
  await openPages('Document')
  const jpeg = join(directory, 'photo.jpg')
  await writeFile(jpeg, twoColorCanvas(300, 400).toBuffer('image/jpeg'))
  const webp = join(directory, 'web.webp')
  await writeFile(webp, twoColorCanvas(400, 100).toBuffer('image/webp'))
  const gif = join(directory, 'small.gif')
  await writeFile(gif, Buffer.from('R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=', 'base64'))
  await answerFileDialog(app, [jpeg, webp, gif])

  await page.getByTestId('add-pages').click()
  // Each picture is offered for preparing, one after the other.
  for (let picture = 0; picture < 3; picture++) await page.getByTestId('scan-as-is').click()

  await expect(page.getByTestId('pdf-page')).toHaveCount(4)
  expect(await pageRatio(1)).toBeCloseTo(3 / 4, 1)
  expect(await pageRatio(2)).toBeCloseTo(4, 0)
  expect(await pageRatio(3)).toBeCloseTo(1, 1)
  await expect.poll(async () => isRed(await canvasColorAt(page, 2, 0.25, 0.5))).toBe(true)
  await expect(page.getByTestId('notice')).toHaveCount(0)
})

test('stands a phone photo upright according to its EXIF orientation', async () => {
  // Stored landscape with red on the left. Orientation 6 means "turn 90 degrees clockwise to view".
  const jpeg = twoColorCanvas(400, 200).toBuffer('image/jpeg')
  const exif = Buffer.from([
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0,
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00
  ])
  const path = join(directory, 'phone.jpg')
  await writeFile(path, Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]))
  await answerFileDialog(app, [path])

  await page.getByTestId('select-file').click()
  await page.getByTestId('scan-as-is').click()

  await expect(page.getByTestId('pdf-page')).toHaveCount(1)
  expect(await pageRatio(0)).toBeCloseTo(0.5, 1)
  // Turned clockwise, the red left half is now on top.
  await expect.poll(async () => isRed(await canvasColorAt(page, 0, 0.5, 0.25))).toBe(true)
  await expect.poll(async () => isBlue(await canvasColorAt(page, 0, 0.5, 0.75))).toBe(true)
})

test('explains that HEIC and other formats are not supported', async () => {
  await dropFile(page, 'photo.heic', 'image/heic', new Uint8Array([1, 2, 3]))
  await expect(page.getByTestId('notice')).toContainText('HEIC')
  await dropFile(page, 'report.docx', 'application/octet-stream', new Uint8Array([1, 2, 3]))
  await expect(page.getByTestId('notice').nth(1)).toContainText('«report.docx»')
  await expect(page.getByTestId('select-file')).toBeVisible()
})

test('explains that a damaged image did not open', async () => {
  await dropFile(page, 'broken.png', 'image/png', new Uint8Array([1, 2, 3]))
  await expect(page.getByTestId('notice')).toContainText('«broken.png»')
  await dropFile(page, 'broken.webp', 'image/webp', new Uint8Array([1, 2, 3]))
  await expect(page.getByTestId('notice').nth(1)).toContainText('«broken.webp»')
})

test('New file asks before losing changes, and only then', async () => {
  await app.evaluate(({ dialog }) => {
    const calls = { count: 0, response: 2 }
    ;(globalThis as unknown as { discardDialog: typeof calls }).discardDialog = calls
    dialog.showMessageBox = (async () => {
      calls.count++
      return { response: calls.response, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  })
  const dialogCalls = () =>
    app.evaluate(() => (globalThis as unknown as { discardDialog: { count: number } }).discardDialog.count)

  await openPages('One', 'Two')
  await action('delete-page', 0).click()

  // Cancel keeps the document.
  await page.getByTestId('new-file').click()
  await expect.poll(dialogCalls).toBe(1)
  await expect(page.getByTestId('pdf-page')).toHaveCount(1)

  // Everything undone means nothing to lose, so no question.
  await undoButton().click()
  await page.getByTestId('new-file').click()
  await expect(page.getByTestId('select-file')).toBeVisible()
  expect(await dialogCalls()).toBe(1)

  // Not saving closes the document.
  await openPages('Three', 'Four')
  await action('delete-page', 0).click()
  await app.evaluate(() => {
    ;(globalThis as unknown as { discardDialog: { response: number } }).discardDialog.response = 1
  })
  await page.getByTestId('new-file').click()
  await expect(page.getByTestId('select-file')).toBeVisible()
  expect(await dialogCalls()).toBe(2)
})

test('leaves the file on disk untouched', async () => {
  const path = await writePdf(directory, 'original.pdf', [{ text: 'One' }, { text: 'Two' }])
  const before = await readFile(path)
  await answerFileDialog(app, [path])
  await page.getByTestId('select-file').click()
  await expect(page.getByTestId('pdf-page')).toHaveCount(2)

  await action('rotate-page', 0).click()
  await action('delete-page', 1).click()
  await expect(page.getByTestId('pdf-page')).toHaveCount(1)

  expect((await readFile(path)).equals(before)).toBe(true)
})
