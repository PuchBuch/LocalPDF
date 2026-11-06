import { existsSync } from 'node:fs'
import { mkdtemp, open, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import {
  answerFileDialog,
  answerSaveDialog,
  expectSavedMatchesScreen,
  launchApp,
  offeredSaveName,
  ROOT,
  writePdf
} from './harness'

let directory: string
let app: ElectronApplication
let page: Page

const fields = () => page.getByTestId('field')
const pages = () => page.getByTestId('pdf-page')

/** Mouse positions are whole pixels, so a click lands within about a point of its target. */
function expectNear(actual: number, expected: number): void {
  expect(Math.abs(actual - expected), `${actual} is not near ${expected}`).toBeLessThanOrEqual(1)
}

async function openPages(...labels: string[]): Promise<void> {
  const path = await writePdf(directory, 'doc.pdf', labels.map((text) => ({ text })))
  await answerFileDialog(app, [path])
  await page.getByTestId('select-file').click()
  await expect(pages()).toHaveCount(labels.length)
}

/** Clicks a page at a point given in PDF points. */
async function clickPage(index: number, x: number, y: number): Promise<void> {
  const box = (await pages().nth(index).boundingBox())!
  const scale = box.width / 595
  await page.mouse.click(box.x + x * scale, box.y + y * scale)
}

async function pageScale(index = 0): Promise<number> {
  return (await pages().nth(index).boundingBox())!.width / 595
}

/** A field's position and size on its page, in points. */
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

async function addText(pageIndex: number, x: number, y: number, text = ''): Promise<void> {
  await page.getByTestId('tool-text').click()
  await clickPage(pageIndex, x, y)
  if (text) await page.keyboard.type(text)
}

/** Takes the focus off every field, so only their content is on screen. */
async function unfocus(): Promise<void> {
  await page.getByTestId('tool-cursor').click()
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'localpdf-e2e-fields-'))
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

test('a tool stays selected and each click adds a field, the cursor adds none', async () => {
  await openPages('One')
  await expect(page.getByTestId('tool-cursor')).toHaveAttribute('aria-pressed', 'true')

  await clickPage(0, 100, 300)
  await expect(fields()).toHaveCount(0)

  await page.getByTestId('tool-text').click()
  await expect(page.getByTestId('tool-hint')).toContainText('Текст')
  await clickPage(0, 100, 300)
  await clickPage(0, 100, 400)
  await expect(fields()).toHaveCount(2)
  await expect(page.getByTestId('tool-text')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('tool-checkbox').click()
  await clickPage(0, 300, 300)
  await expect(fields()).toHaveCount(3)
})

test('a text field starts at the click, focused, and grows with what is typed', async () => {
  await openPages('One')
  await addText(0, 120, 300)

  const input = page.getByTestId('field-input')
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute('placeholder', 'Aa')
  await expect(fields().first()).toHaveAttribute('data-field-focused', 'true')

  const empty = await fieldRect()
  expectNear(empty.x, 120)
  expectNear(empty.y, 300)
  expect(empty.height).toBeCloseTo(12, 0)

  await page.keyboard.type('Привет, Grüße')
  await expect(input).toHaveValue('Привет, Grüße')
  const oneLine = await fieldRect()
  expect(oneLine.width).toBeGreaterThan(empty.width * 3)
  expect(oneLine.x).toBeCloseTo(empty.x, 1)

  await page.keyboard.press('Enter')
  await page.keyboard.type('Вторая строка')
  const twoLines = await fieldRect()
  expect(twoLines.height).toBeCloseTo(24, 0)
  expect(await input.evaluate((element: HTMLTextAreaElement) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
})

test('text stays fully visible while typing at the right edge of the page', async () => {
  await openPages('One')
  await addText(0, 570, 300, 'Длинная строка у самого края')
  const rect = await fieldRect()
  expect(rect.x + rect.width).toBeLessThanOrEqual(595.5)
  expect(rect.x).toBeLessThan(570)
})

test('changes the font size in steps of one point and resizes the field', async () => {
  await openPages('One')
  await addText(0, 100, 300, 'Шрифт')
  const before = await fieldRect()
  await expect(page.getByTestId('font-size')).toHaveText('10')

  await page.getByTestId('increase-font-size').click()
  await page.getByTestId('increase-font-size').click()
  await expect(page.getByTestId('font-size')).toHaveText('12')
  const after = await fieldRect()
  expect(after.height).toBeCloseTo(14.4, 0)
  expect(after.width).toBeGreaterThan(before.width)

  await page.getByTestId('decrease-font-size').click()
  await expect(page.getByTestId('font-size')).toHaveText('11')

  // The caret stays in the field through all of this.
  await expect(page.getByTestId('field-input')).toBeFocused()
  await page.keyboard.type('!')
  await expect(page.getByTestId('field-input')).toHaveValue('Шрифт!')
})

test('toggles the background between transparent and white', async () => {
  await openPages('One')
  await addText(0, 100, 300, 'Фон')
  const toggle = page.getByTestId('field-background-color')
  await expect(toggle).toHaveAttribute('data-background', 'transparent')

  await toggle.click()
  await expect(toggle).toHaveAttribute('data-background', 'white')
  expect(await fields().first().evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)')

  await toggle.click()
  await expect(toggle).toHaveAttribute('data-background', 'transparent')
})

test('deletes a field at once, undo brings it back', async () => {
  await openPages('One')
  await addText(0, 100, 300, 'Удалить')
  await page.getByTestId('field-delete').click()
  await expect(fields()).toHaveCount(0)

  await page.keyboard.press('Control+KeyZ')
  await expect(fields()).toHaveCount(1)
  await expect(page.getByTestId('field-input')).toHaveValue('Удалить')
})

test('copies a field to another page with the next click', async () => {
  await openPages('One', 'Two')
  // At 25% both pages fit on screen.
  for (let click = 0; click < 3; click++) await page.getByTestId('decrease-zoom-level').click()
  await addText(0, 100, 300, 'Копия')
  await page.getByTestId('increase-font-size').click()
  await page.getByTestId('field-background-color').click()

  await page.getByTestId('field-copy').click()
  await expect(page.getByTestId('paste-banner')).toBeVisible()
  await expect(page.getByTestId('field-copy')).toHaveClass(/active/)

  await clickPage(1, 200, 400)

  await expect(page.getByTestId('paste-banner')).toHaveCount(0)
  await expect(fields()).toHaveCount(2)
  const copy = pages().nth(1).getByTestId('field-input')
  await expect(copy).toHaveValue('Копия')
  await expect(page.getByTestId('font-size')).toHaveText('11')
  await expect(page.getByTestId('field-background-color')).toHaveAttribute('data-background', 'white')
  // At 25% one screen pixel is about three points.
  const rect = await fieldRect(1, 1)
  expect(Math.abs(rect.x - 200)).toBeLessThanOrEqual(4)
  expect(Math.abs(rect.y - 400)).toBeLessThanOrEqual(4)

  await page.keyboard.press('Control+KeyZ')
  await expect(fields()).toHaveCount(1)
})

test('Esc cancels pasting', async () => {
  await openPages('One')
  await addText(0, 100, 300, 'Отмена')
  await unfocus()
  await page.getByTestId('field-input').click()
  await page.getByTestId('field-copy').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('paste-banner')).toHaveCount(0)

  await page.getByTestId('tool-cursor').click()
  await clickPage(0, 300, 500)
  await expect(fields()).toHaveCount(1)
})

test('drags a field by its handle, within the page, as one undo step', async () => {
  await openPages('One')
  await addText(0, 100, 300, 'Тянуть')
  const start = await fieldRect()
  const scale = await pageScale()

  const handle = (await page.getByTestId('field-grab-handle').boundingBox())!
  const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 50 * scale, from.y + 60 * scale, { steps: 4 })
  await page.mouse.move(from.x + 100 * scale, from.y + 120 * scale, { steps: 4 })
  await page.mouse.up()

  const moved = await fieldRect()
  expect(moved.x).toBeCloseTo(start.x + 100, 0)
  expect(moved.y).toBeCloseTo(start.y + 120, 0)
  await expect(page.getByTestId('field-input')).toHaveValue('Тянуть')

  // Far past the corner of the page, it stops at the edge.
  const again = (await page.getByTestId('field-grab-handle').boundingBox())!
  await page.mouse.move(again.x + 5, again.y + 5)
  await page.mouse.down()
  await page.mouse.move(again.x - 3000, again.y - 3000, { steps: 4 })
  await page.mouse.up()
  const corner = await fieldRect()
  expect(corner.x).toBeCloseTo(0, 0)
  expect(corner.y).toBeCloseTo(0, 0)

  await page.getByTestId('undo').click()
  const undone = await fieldRect()
  expect(undone.x).toBeCloseTo(moved.x, 0)
  expect(undone.y).toBeCloseTo(moved.y, 0)
})

test('a checkbox starts ticked at the click and cycles through its states', async () => {
  await openPages('One')
  await page.getByTestId('tool-checkbox').click()
  await clickPage(0, 200, 300)

  const box = page.getByTestId('field-checkbox')
  await expect(box).toHaveAttribute('data-value', 'tick')
  const rect = await fieldRect()
  expect(rect.width).toBeCloseTo(12, 0)
  expectNear(rect.x + rect.width / 2, 200)
  expectNear(rect.y + rect.height / 2, 300)

  await box.click()
  await expect(box).toHaveAttribute('data-value', 'cross')
  await box.click()
  await expect(box).toHaveAttribute('data-value', 'dot')
  await box.click()
  await expect(box).toHaveAttribute('data-value', 'empty')
  await box.click()
  await expect(box).toHaveAttribute('data-value', 'tick')

  await page.keyboard.press('Control+KeyZ')
  await expect(box).toHaveAttribute('data-value', 'empty')
})

test('undo takes back a burst of typing at once, and a pause starts a new step', async () => {
  await openPages('One')
  await addText(0, 100, 300)
  const input = page.getByTestId('field-input')

  await page.keyboard.type('Первая')
  await page.waitForTimeout(1200)
  await page.keyboard.type(' вторая')

  await page.keyboard.press('Control+KeyZ')
  await expect(input).toHaveValue('Первая')
  await page.keyboard.press('Control+KeyZ')
  await expect(input).toHaveValue('')
  await page.keyboard.press('Control+KeyZ')
  await expect(fields()).toHaveCount(0)

  await page.keyboard.press('Control+Shift+KeyZ')
  await page.keyboard.press('Control+Shift+KeyZ')
  await page.keyboard.press('Control+Shift+KeyZ')
  await expect(page.getByTestId('field-input')).toHaveValue('Первая вторая')
})

test('thumbnails show fields as they are typed', async () => {
  await openPages('One')
  await addText(0, 100, 300, 'На миниатюре')
  await expect(page.getByTestId('page-thumbnail').locator('.field-text')).toHaveText('На миниатюре')
  await page.getByTestId('tool-checkbox').click()
  await clickPage(0, 300, 500)
  await expect(page.getByTestId('page-thumbnail').locator('.field svg')).toHaveCount(1)
})

test('fields scale with the zoom and keep their place on the page', async () => {
  await openPages('One')
  await addText(0, 100, 300, 'Масштаб')
  const before = await fieldRect()

  await page.getByTestId('increase-zoom-level').click()
  await expect(page.getByTestId('zoom-level')).toHaveText('150 %')

  const after = await fieldRect()
  expect(after.x).toBeCloseTo(before.x, 0)
  expect(after.y).toBeCloseTo(before.y, 0)
  expect(after.width).toBeCloseTo(before.width, 0)
})

test('fields travel with their page and come back when it is restored', async () => {
  await openPages('One', 'Two')
  await page.getByTestId('decrease-zoom-level').click()
  await page.getByTestId('decrease-zoom-level').click()
  await addText(0, 100, 300, 'Едет')
  await unfocus()

  await page.getByTestId('move-page-down').first().click()
  await expect(pages().nth(1).getByTestId('field-input')).toHaveValue('Едет')

  await page.getByTestId('delete-page').nth(1).click()
  await expect(fields()).toHaveCount(0)
  await page.getByTestId('undo').click()
  await expect(pages().nth(1).getByTestId('field-input')).toHaveValue('Едет')
})

const PANEL_BUTTONS = [
  'field-copy',
  'field-delete',
  'field-grab-handle',
  'field-background-color',
  'decrease-font-size',
  'increase-font-size'
]

/** Every button of the focused field is on screen and is what a click there would hit. */
async function expectPanelsReachable(where: string): Promise<void> {
  const scroll = (await page.getByTestId('document-scroll').boundingBox())!
  for (const id of PANEL_BUTTONS) {
    const box = (await page.getByTestId(id).boundingBox())!
    const label = `${id} at ${where}`
    expect(box.x, label).toBeGreaterThanOrEqual(scroll.x)
    expect(box.y, label).toBeGreaterThanOrEqual(scroll.y)
    expect(box.x + box.width, label).toBeLessThanOrEqual(scroll.x + scroll.width)
    expect(box.y + box.height, label).toBeLessThanOrEqual(scroll.y + scroll.height)
    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'),
      { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    )
    expect(hit, label).toBe(id)
  }
}

test.describe('panels of a focused field stay reachable', () => {
  const spots: [string, number, number, boolean][] = [
    ['the middle', 200, 200, false],
    ['the top left corner', 2, 2, false],
    ['the top right corner', 590, 2, false],
    ['the bottom left corner', 2, 835, true],
    ['the bottom right corner', 590, 835, true]
  ]

  for (const [where, x, y, scrollDown] of spots) {
    test(`a tiny empty field at ${where}`, async () => {
      await openPages('One')
      if (scrollDown) {
        await page.getByTestId('document-scroll').evaluate((element) => {
          element.scrollTop = element.scrollHeight
        })
        await page.waitForTimeout(100)
      }
      await addText(0, x, y)
      await expectPanelsReachable(where)

      await page.getByTestId('field-delete').click()
      await expect(fields()).toHaveCount(0)
    })
  }

  test('a field as wide as the page', async () => {
    await openPages('One')
    await addText(0, 0, 300, 'Очень длинная строка текста '.repeat(5))
    const rect = await fieldRect()
    expect(rect.width).toBeCloseTo(595, 0)
    expect(rect.x).toBeCloseTo(0, 0)
    // The page does not get wider, and the view does not slide sideways.
    expect(
      await page.getByTestId('document-scroll').evaluate((element) => element.scrollWidth <= element.clientWidth)
    ).toBe(true)
    await expectPanelsReachable('full width')
  })

  test('the zoom buttons cover nothing on the page', async () => {
    await openPages('One')
    await page.getByTestId('tool-checkbox').click()
    await clickPage(0, 590, 5)
    await expect(fields()).toHaveCount(1)
    await expect(page.getByTestId('zoom-level')).toHaveText('100 %')
  })
})

test('the delete button of a short field deletes it, not something else', async () => {
  await openPages('One')
  await addText(0, 100, 300, 'Да')
  await page.getByTestId('field-delete').click()
  await expect(fields()).toHaveCount(0)
})

test('text in the saved file lands exactly where it was on screen', async () => {
  await openPages('Title')
  await addText(0, 100, 300, 'Съешь ещё этих мягких булок, Waffle fi')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Grüße ß — вторая строка')
  for (let click = 0; click < 8; click++) await page.getByTestId('increase-font-size').click()

  await expectSavedMatchesScreen(app, page, join(directory, 'text-match.pdf'), { x: 80, y: 280, width: 500, height: 80 })
})

test('small default-size text in the saved file also matches the screen', async () => {
  await openPages('Title')
  await addText(0, 100, 300, 'Обычный текст размером десять пунктов')
  await expectSavedMatchesScreen(app, page, join(directory, 'small-match.pdf'), { x: 80, y: 280, width: 400, height: 50 })
})

test('a checkbox in the saved file lands exactly where it was on screen', async () => {
  await openPages('Title')
  await page.getByTestId('tool-checkbox').click()
  await clickPage(0, 200, 300)
  await expectSavedMatchesScreen(app, page, join(directory, 'tick-match.pdf'), { x: 180, y: 280, width: 40, height: 40 })
})

test('saves under the suggested name and the file holds the text', async () => {
  await openPages('Title')
  await addText(0, 100, 300, 'Сохранённый текст')
  const path = join(directory, 'saved.pdf')
  await answerSaveDialog(app, path)

  await page.getByTestId('download').click()

  await expect(page.getByTestId('saved-note')).toContainText('saved.pdf')
  expect(await offeredSaveName(app)).toBe('doc-document.pdf')
  const saved = await PDFDocument.load(await readFile(path))
  expect(saved.getPageCount()).toBe(1)
  expect(saved.getForm().getFields()).toHaveLength(0)
  expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
})

test('cancelling the save dialog writes nothing and reports nothing', async () => {
  await openPages('Title')
  const path = join(directory, 'never.pdf')
  await answerSaveDialog(app, null)
  await page.getByTestId('download').click()
  await expect(page.getByTestId('download')).toBeEnabled()
  await expect(page.getByTestId('saved-note')).toHaveCount(0)
  await expect(page.getByTestId('notice')).toHaveCount(0)
  expect(existsSync(path)).toBe(false)
})

test('reports a save that failed', async () => {
  await openPages('Title')
  await answerSaveDialog(app, join(directory, 'no-such-folder', 'x.pdf'))
  await page.getByTestId('download').click()
  await expect(page.getByTestId('notice')).toContainText('Не удалось сохранить')
  await expect(page.getByTestId('download')).toBeEnabled()
})

test('saving over a file held open elsewhere never leaves it damaged', async () => {
  await openPages('Title')
  const taken = join(directory, 'taken.pdf')
  await writeFile(taken, 'original')
  await answerSaveDialog(app, taken)

  const handle = await open(taken, 'r')
  await page.getByTestId('download').click()
  await expect(page.getByTestId('saved-note').or(page.getByTestId('notice'))).toBeVisible()
  await handle.close()

  // Whether Windows allowed the replacement or not, the file is one whole version.
  const content = await readFile(taken)
  const whole = content.toString() === 'original' || (await PDFDocument.load(content)).getPageCount() === 1
  expect(whole).toBe(true)
  expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
})

test('adds fields to a real document and saves it', async () => {
  const sample = join(ROOT, 'samples/private/sample-letter.pdf')
  test.skip(!existsSync(sample), 'private sample is not present')
  await answerFileDialog(app, [sample])
  await page.getByTestId('select-file').click()
  await expect(pages()).toHaveCount(2)

  // The free space at the foot of the first page is below the fold at 100%.
  await page.getByTestId('document-scroll').evaluate((element) => {
    element.scrollTop = 500
  })
  await page.waitForTimeout(150)
  await addText(0, 66, 760, 'Тестовый текст, Grüße')
  await page.getByTestId('tool-checkbox').click()
  await clickPage(0, 300, 765)
  await expect(fields()).toHaveCount(2)
  await unfocus()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(ROOT, 'samples/private/out/fields.png') })

  const output = join(ROOT, 'samples/private/out/fields-saved.pdf')
  await answerSaveDialog(app, output)
  await page.getByTestId('download').click()
  await expect(page.getByTestId('saved-note')).toBeVisible()
  expect(await offeredSaveName(app)).toBe('sample-letter-document.pdf')

  // Opened again, the additions are part of the page and the original text is still real text.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
  await page.getByTestId('new-file').click()
  await page.getByTestId('select-file').waitFor()
  await answerFileDialog(app, [output])
  await page.getByTestId('select-file').click()
  await expect(pages()).toHaveCount(2)
  await expect(fields()).toHaveCount(0)
  const text = pages().first().locator('.textLayer')
  await expect(text).toContainText('Тестовый текст, Grüße')
  await expect(text).toContainText('Bewerbung')
  await page.getByTestId('document-scroll').evaluate((element) => {
    element.scrollTop = 500
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(ROOT, 'samples/private/out/fields-reopened.png') })
})
