import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import {
  answerFileDialog,
  answerSaveDialog,
  expectSavedMatchesScreen,
  launchApp,
  ROOT,
  writePdf
} from './harness'

let directory: string
let app: ElectronApplication
let page: Page

const fields = () => page.getByTestId('field')
const pages = () => page.getByTestId('pdf-page')
const dialog = () => page.getByTestId('signature-dialog')

function expectNear(actual: number, expected: number, tolerance = 1): void {
  expect(Math.abs(actual - expected), `${actual} is not near ${expected}`).toBeLessThanOrEqual(tolerance)
}

async function openPages(...labels: string[]): Promise<void> {
  const path = await writePdf(directory, 'doc.pdf', labels.map((text) => ({ text })))
  await answerFileDialog(app, [path])
  await page.getByTestId('select-file').click()
  await expect(pages()).toHaveCount(labels.length)
}

async function clickPage(index: number, x: number, y: number): Promise<void> {
  const box = (await pages().nth(index).boundingBox())!
  const scale = box.width / 595
  await page.mouse.click(box.x + x * scale, box.y + y * scale)
}

async function fieldRect(index = 0, pageIndex = 0) {
  const pageBox = (await pages().nth(pageIndex).boundingBox())!
  const box = (await fields().nth(index).boundingBox())!
  const scale = pageBox.width / 595
  return {
    x: (box.x - pageBox.x) / scale,
    y: (box.y - pageBox.y) / scale,
    width: box.width / scale,
    height: box.height / scale
  }
}

/** Draws a zigzag on the signature canvas, moved like a hand. */
async function drawStroke(offset = 0): Promise<void> {
  const box = (await page.getByTestId('signature-canvas').boundingBox())!
  const y = box.y + box.height / 2 + offset
  await page.mouse.move(box.x + 60, y)
  await page.mouse.down()
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(box.x + 60 + step * 35, y + (step % 2 === 0 ? -40 : 40))
    await page.waitForTimeout(8)
  }
  await page.mouse.up()
}

async function addSignatureField(x = 200, y = 300): Promise<void> {
  await page.getByTestId('tool-signature').click()
  await clickPage(0, x, y)
  await expect(dialog()).toBeVisible()
}

async function drawAndFinish(): Promise<void> {
  await drawStroke()
  await page.getByTestId('signature-finish').click()
  await expect(dialog()).toHaveCount(0)
  await expect(page.getByTestId('field-signature')).toHaveAttribute('data-signed', 'true')
}

async function makePng(name: string, width: number, height: number, color = '#000000'): Promise<string> {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = color
  context.fillRect(0, 0, width, height)
  const path = join(directory, name)
  await writeFile(path, canvas.toBuffer('image/png'))
  return path
}

async function addPicture(path: string, x = 200, y = 300): Promise<void> {
  await page.getByTestId('tool-picture').click()
  await clickPage(0, x, y)
  await page.getByTestId('picture-input').setInputFiles(path)
  await expect(page.locator('[data-testid="pdf-page"] .field-image')).toHaveCount(1)
}

/** Drags the resize handle by a distance in screen pixels. */
async function dragResize(dx: number, dy: number, withShift = false): Promise<void> {
  const handle = (await page.getByTestId('field-resize-indicator').boundingBox())!
  const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  await page.mouse.move(from.x, from.y)
  if (withShift) await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 })
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 3 })
  await page.mouse.up()
  if (withShift) await page.keyboard.up('Shift')
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'localpdf-e2e-media-'))
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

test.describe('signature', () => {
  test('a new field is 180 by 60, centred on the click, and asks for a signature', async () => {
    await openPages('One')
    await addSignatureField(200, 300)
    const rect = await fieldRect()
    expectNear(rect.width, 180)
    expectNear(rect.height, 60)
    expectNear(rect.x + rect.width / 2, 200)
    expectNear(rect.y + rect.height / 2, 300)
    await expect(page.getByTestId('signature-finish')).toBeDisabled()
    await expect(page.getByTestId('signature-clear')).toBeDisabled()
    await expect(page.getByTestId('signature-undo')).toBeDisabled()
    await expect(page.getByTestId('signature-redo')).toBeDisabled()
  })

  test('undo, redo and clear work on the strokes being drawn', async () => {
    await openPages('One')
    await addSignatureField()
    await drawStroke(-40)
    await drawStroke(40)

    await page.getByTestId('signature-undo').click()
    await expect(page.getByTestId('signature-redo')).toBeEnabled()
    await page.getByTestId('signature-undo').click()
    await expect(page.getByTestId('signature-undo')).toBeDisabled()
    await expect(page.getByTestId('signature-finish')).toBeDisabled()

    await page.getByTestId('signature-redo').click()
    await expect(page.getByTestId('signature-finish')).toBeEnabled()

    await page.getByTestId('signature-clear').click()
    await expect(page.getByTestId('signature-finish')).toBeDisabled()
    await expect(page.getByTestId('signature-redo')).toBeDisabled()
  })

  test('a drawn signature lands in the field and on the thumbnail, one undo takes it back', async () => {
    await openPages('One')
    await addSignatureField()
    await drawAndFinish()

    const image = pages().first().locator('.field-image')
    await expect(image).toHaveCount(1)
    expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(100)
    await expect(page.getByTestId('page-thumbnail').locator('.field-image')).toHaveCount(1)

    await page.keyboard.press('Control+KeyZ')
    await expect(page.getByTestId('field-signature')).toHaveAttribute('data-signed', 'false')
    await expect(fields()).toHaveCount(1)
  })

  test('the drawing is cut down to the strokes, without empty canvas around them', async () => {
    await openPages('One')
    await addSignatureField()
    await drawAndFinish()
    const { width, height } = await pages()
      .first()
      .locator('.field-image')
      .evaluate((element: HTMLImageElement) => ({ width: element.naturalWidth, height: element.naturalHeight }))
    const canvasWidth = 608 * 3
    expect(width).toBeLessThan(canvasWidth * 0.8)
    expect(height).toBeLessThan(220 * 3 * 0.6)
  })

  test('a typed signature works with Cyrillic and needs a name first', async () => {
    await openPages('One')
    await addSignatureField()
    await page.getByTestId('signature-tab-type').click()
    await expect(page.getByTestId('signature-finish')).toBeDisabled()

    const name = page.getByTestId('signature-name')
    await expect(name).toBeFocused()
    await name.fill('Анна Суворов')
    expect(await name.evaluate((element) => getComputedStyle(element).fontFamily)).toContain('Caveat')
    await page.getByTestId('signature-finish').click()

    await expect(page.getByTestId('field-signature')).toHaveAttribute('data-signed', 'true')
    expect(
      await pages().first().locator('.field-image').evaluate((element: HTMLImageElement) => element.naturalWidth)
    ).toBeGreaterThan(300)
    expect(await page.evaluate(() => document.fonts.check('200px "Caveat"', 'Анна'))).toBe(true)
  })

  test('switching tabs drops an unfinished drawing', async () => {
    await openPages('One')
    await addSignatureField()
    await drawStroke()
    await expect(page.getByTestId('signature-finish')).toBeEnabled()
    await page.getByTestId('signature-tab-type').click()
    await page.getByTestId('signature-tab-draw').click()
    await expect(page.getByTestId('signature-finish')).toBeDisabled()
  })

  test('Esc closes the dialog and keeps the empty field, a click reopens it', async () => {
    await openPages('One')
    await addSignatureField()
    await page.keyboard.press('Escape')
    await expect(dialog()).toHaveCount(0)
    await expect(fields()).toHaveCount(1)

    await page.getByTestId('field-signature').click()
    await expect(dialog()).toBeVisible()
    await page.getByTestId('signature-close').click()
    await expect(dialog()).toHaveCount(0)
  })

  test('signing again replaces the signature', async () => {
    await openPages('One')
    await addSignatureField()
    await drawAndFinish()
    const first = await pages().first().locator('.field-image').getAttribute('src')

    await page.getByTestId('field-signature').click()
    await drawAndFinish()
    await expect(pages().first().locator('.field-image')).not.toHaveAttribute('src', first!)
  })

  test('Ctrl+Z in the dialog does not touch the document', async () => {
    await openPages('One')
    await addSignatureField()
    await page.keyboard.press('Control+KeyZ')
    await expect(dialog()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(fields()).toHaveCount(1)
  })

  test('a copy carries the signature to another page', async () => {
    await openPages('One', 'Two')
    for (let click = 0; click < 3; click++) await page.getByTestId('decrease-zoom-level').click()
    await addSignatureField(200, 300)
    await drawAndFinish()
    await page.getByTestId('tool-cursor').click()
    await pages().first().getByTestId('field-signature').click()
    await page.keyboard.press('Escape')

    await page.getByTestId('field-copy').click()
    await clickPage(1, 200, 300)
    await expect(pages().nth(1).locator('.field-image')).toHaveCount(1)
    await expect(dialog()).toHaveCount(0)
  })
})

test.describe('picture', () => {
  test('a new field is a 60 point square, centred on the click, waiting for an image', async () => {
    await openPages('One')
    await page.getByTestId('tool-picture').click()
    await clickPage(0, 200, 300)
    const rect = await fieldRect()
    expectNear(rect.width, 60)
    expectNear(rect.height, 60)
    expectNear(rect.x + rect.width / 2, 200)
    await expect(page.getByTestId('picture-input')).toHaveCount(1)
  })

  test('the field takes its height from the image and keeps its width', async () => {
    await openPages('One')
    await addPicture(await makePng('wide.png', 200, 100))
    const wide = await fieldRect()
    expectNear(wide.width, 60)
    expectNear(wide.height, 30)
    await expect(page.getByTestId('page-thumbnail').locator('.field-image')).toHaveCount(1)

    await page.getByTestId('undo').click()
    await expect(page.getByTestId('picture-input')).toHaveCount(1)
    expectNear((await fieldRect()).height, 60)
  })

  test('a corner drag keeps the proportions, and Shift frees them', async () => {
    await openPages('One')
    await addPicture(await makePng('resize.png', 200, 100))
    const scale = (await pages().first().boundingBox())!.width / 595

    await dragResize(60 * scale, 0)
    const locked = await fieldRect()
    expectNear(locked.width, 120, 2)
    expectNear(locked.height, 60, 2)

    await dragResize(0, 40 * scale, true)
    const free = await fieldRect()
    expectNear(free.width, locked.width, 2)
    expectNear(free.height, locked.height + 40, 2)

    // A resize is one undo step.
    await page.getByTestId('undo').click()
    expectNear((await fieldRect()).height, locked.height, 2)
  })

  test('a banner mentions Shift during the resize only', async () => {
    await openPages('One')
    await addPicture(await makePng('banner.png', 200, 100))
    const handle = (await page.getByTestId('field-resize-indicator').boundingBox())!
    await page.mouse.move(handle.x + 5, handle.y + 5)
    await page.mouse.down()
    await expect(page.getByTestId('resize-banner')).toContainText('Shift')
    await page.mouse.move(handle.x + 30, handle.y + 30, { steps: 2 })
    await page.mouse.up()
    await expect(page.getByTestId('resize-banner')).toHaveCount(0)
  })

  test('resizing stops at the edge of the page', async () => {
    await openPages('One')
    await addPicture(await makePng('edge.png', 200, 100), 500, 300)
    await dragResize(3000, 3000)
    const rect = await fieldRect()
    expect(rect.x + rect.width).toBeLessThanOrEqual(595.5)
    expectNear(rect.width / rect.height, 2, 0.05)
  })

  test('rejects damaged and unsupported files with a message, the field stays empty', async () => {
    await openPages('One')
    await page.getByTestId('tool-picture').click()
    await clickPage(0, 200, 300)

    const broken = join(directory, 'broken.png')
    await writeFile(broken, 'not an image')
    await page.getByTestId('picture-input').setInputFiles(broken)
    await expect(page.getByTestId('notice')).toContainText('«broken.png»')

    const heic = join(directory, 'photo.heic')
    await writeFile(heic, 'x')
    await page.getByTestId('picture-input').setInputFiles(heic)
    await expect(page.getByTestId('notice').nth(1)).toContainText('HEIC')
    await expect(page.getByTestId('picture-input')).toHaveCount(1)
  })
})

test('a checkbox resizes as a square, even with Shift', async () => {
  await openPages('One')
  await page.getByTestId('tool-checkbox').click()
  await clickPage(0, 200, 300)
  const scale = (await pages().first().boundingBox())!.width / 595

  await dragResize(30 * scale, 0)
  const bigger = await fieldRect()
  expectNear(bigger.width, 42, 2)
  expectNear(bigger.height, bigger.width)
  await expect(page.getByTestId('resize-banner')).toHaveCount(0)

  await dragResize(0, 20 * scale, true)
  const again = await fieldRect()
  expectNear(again.height, again.width)
  expect(again.width).toBeGreaterThan(bigger.width + 10)
})

test.describe('comb text', () => {
  async function addComb(x = 100, y = 300): Promise<void> {
    await page.getByTestId('tool-comb').click()
    await clickPage(0, x, y)
    await expect(page.getByTestId('comb-input')).toBeFocused()
  }
  const cells = () => page.getByTestId('comb-cell')

  test('starts at the click with eight cells', async () => {
    await openPages('One')
    await addComb(100, 300)
    await expect(cells()).toHaveCount(8)
    const rect = await fieldRect()
    expectNear(rect.x, 100)
    expectNear(rect.y, 300)
    expectNear(rect.width, 56)
    expect(await cells().first().evaluate((element) => getComputedStyle(element).fontFamily)).toContain('Roboto Mono')
  })

  test('puts each character in its own cell and adds cells past eight', async () => {
    await openPages('One')
    await addComb()
    await page.keyboard.type('АБВ123')
    await expect(cells().nth(0)).toHaveText('А')
    await expect(cells().nth(5)).toHaveText('3')
    await expect(cells()).toHaveCount(8)

    await page.keyboard.type('45678')
    await expect(cells()).toHaveCount(11)
    expectNear((await fieldRect()).width, 77)
  })

  test('marks the cell being typed into, and a click on a cell moves there', async () => {
    await openPages('One')
    await addComb()
    await page.keyboard.type('12345')
    await expect(cells().nth(5)).toHaveClass(/current/)

    await cells().nth(2).click()
    await expect(cells().nth(2)).toHaveClass(/current/)
    await page.keyboard.type('X')
    await expect(page.getByTestId('comb-input')).toHaveValue('12X345')
  })

  test('the font size scales the cells, spacing changes them by a point', async () => {
    await openPages('One')
    await addComb()
    await page.getByTestId('increase-spacing').click()
    expectNear((await fieldRect()).width, 64)
    await page.getByTestId('decrease-spacing').click()
    await page.getByTestId('decrease-spacing').click()
    expectNear((await fieldRect()).width, 48)
    await page.getByTestId('increase-spacing').click()

    for (let click = 0; click < 10; click++) await page.getByTestId('increase-font-size').click()
    await expect(page.getByTestId('font-size')).toHaveText('20')
    const rect = await fieldRect()
    expectNear(rect.width, 112, 2)
    expectNear(rect.height, 24)
    await expect(page.getByTestId('comb-input')).toBeFocused()
  })

  test('typing is undone at once', async () => {
    await openPages('One')
    await addComb()
    await page.keyboard.type('123')
    await page.keyboard.press('Control+KeyZ')
    await expect(page.getByTestId('comb-input')).toHaveValue('')
  })

  test('all its buttons can be reached at the right edge of the page', async () => {
    await openPages('One')
    await addComb(590, 200)
    const scroll = (await page.getByTestId('document-scroll').boundingBox())!
    for (const id of ['field-copy', 'field-delete', 'field-grab-handle', 'decrease-font-size', 'increase-spacing']) {
      const box = (await page.getByTestId(id).boundingBox())!
      expect(box.x, id).toBeGreaterThanOrEqual(scroll.x)
      expect(box.x + box.width, id).toBeLessThanOrEqual(scroll.x + scroll.width)
      const hit = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'),
        { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      )
      expect(hit, id).toBe(id)
    }
  })
})

test.describe('the saved file matches the screen', () => {
  test('comb text', async () => {
    await openPages('Title')
    await page.getByTestId('tool-comb').click()
    await clickPage(0, 100, 300)
    await page.keyboard.type('ИНН4207')
    for (let click = 0; click < 6; click++) await page.getByTestId('increase-font-size').click()
    await expectSavedMatchesScreen(app, page, join(directory, 'comb-match.pdf'), { x: 80, y: 280, width: 300, height: 60 })
  })

  test('a picture', async () => {
    await openPages('Title')
    await addPicture(await makePng('match.png', 200, 100), 200, 300)
    await expectSavedMatchesScreen(app, page, join(directory, 'picture-match.pdf'), { x: 140, y: 260, width: 120, height: 80 })
  })

  test('a picture stretched with Shift', async () => {
    await openPages('Title')
    await addPicture(await makePng('stretch.png', 200, 100), 200, 300)
    const scale = (await pages().first().boundingBox())!.width / 595
    await dragResize(0, 60 * scale, true)
    await expectSavedMatchesScreen(app, page, join(directory, 'stretch-match.pdf'), { x: 140, y: 260, width: 120, height: 130 })
  })

  test('a drawn signature', async () => {
    await openPages('Title')
    await addSignatureField(200, 300)
    await drawAndFinish()
    await expectSavedMatchesScreen(app, page, join(directory, 'sign-match.pdf'), { x: 90, y: 250, width: 220, height: 100 })
  })

  test('a typed signature on a resized field', async () => {
    await openPages('Title')
    await addSignatureField(200, 300)
    await page.getByTestId('signature-tab-type').click()
    await page.getByTestId('signature-name').fill('Проба')
    await page.getByTestId('signature-finish').click()
    await expect(page.getByTestId('field-signature')).toHaveAttribute('data-signed', 'true')
    const scale = (await pages().first().boundingBox())!.width / 595
    await page.keyboard.press('Escape')
    await dragResize(0, 30 * scale, true)
    await expectSavedMatchesScreen(app, page, join(directory, 'typed-match.pdf'), { x: 90, y: 250, width: 220, height: 130 })
  })

  test('a white background hides what is under the field', async () => {
    await openPages('Covered text')
    await page.getByTestId('tool-picture').click()
    await clickPage(0, 100, 90)
    await page.getByTestId('field-background-color').click()
    await page.getByTestId('field-delete').hover()
    await page.getByTestId('picture-input').setInputFiles(await makePng('white.png', 100, 100, '#ffffff'))
    await expect(pages().first().locator('.field-image')).toHaveCount(1)
    await expectSavedMatchesScreen(app, page, join(directory, 'white-match.pdf'), { x: 40, y: 50, width: 300, height: 80 })
  })
})

test('signs a real document, and the saved file shows it', async () => {
  const sample = join(ROOT, 'samples/private/sample-letter.pdf')
  test.skip(!existsSync(sample), 'private sample is not present')
  await answerFileDialog(app, [sample])
  await page.getByTestId('select-file').click()
  await expect(pages()).toHaveCount(2)
  await page.getByTestId('page-thumbnail').nth(1).click()
  await page.waitForTimeout(200)

  // Page two holds only a name, the signature goes above it.
  await page.getByTestId('tool-signature').click()
  await clickPage(1, 150, 55)
  await expect(dialog()).toBeVisible()
  await page.getByTestId('signature-tab-type').click()
  await page.getByTestId('signature-name').fill('Тест подписи')
  await page.getByTestId('signature-finish').click()
  await expect(page.getByTestId('field-signature')).toHaveAttribute('data-signed', 'true')
  await page.getByTestId('tool-cursor').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(ROOT, 'samples/private/out/signature.png') })

  const output = join(ROOT, 'samples/private/out/signature-saved.pdf')
  await answerSaveDialog(app, output)
  await page.getByTestId('download').click()
  await expect(page.getByTestId('saved-note')).toBeVisible()

  await app.evaluate(({ dialog: electronDialog }) => {
    electronDialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof electronDialog.showMessageBox
  })
  await page.getByTestId('new-file').click()
  await page.getByTestId('select-file').waitFor()
  await answerFileDialog(app, [output])
  await page.getByTestId('select-file').click()
  await expect(pages()).toHaveCount(2)
  await expect(fields()).toHaveCount(0)
  await page.getByTestId('page-thumbnail').nth(1).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(ROOT, 'samples/private/out/signature-reopened.png') })
})
