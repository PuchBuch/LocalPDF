import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { makeRichForm, makeUnsignedSignatureForm } from '../tests/formFixture'
import { answerFileDialog, answerSaveDialog, launchApp, ROOT, writePdf } from './harness'

let directory: string
let app: ElectronApplication
let page: Page
let problems: string[]

const pages = () => page.getByTestId('pdf-page')
const widget = (name: string): Locator => pages().first().locator(`[data-field-name="${name}"]`)

async function openForm(): Promise<void> {
  const path = join(directory, 'form.pdf')
  await writeFile(path, await makeRichForm())
  await answerFileDialog(app, [path])
  await page.getByTestId('select-file').click()
  await expect(pages()).toHaveCount(2)
  // At 25% the whole form is on screen.
  for (let click = 0; click < 2; click++) await page.getByTestId('decrease-zoom-level').click()
}

async function saveAndReopen(name: string): Promise<void> {
  const path = join(directory, name)
  await answerSaveDialog(app, path)
  await page.getByTestId('download').click()
  await expect(page.getByTestId('saved-note')).toBeVisible()
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
  await page.getByTestId('new-file').click()
  await page.getByTestId('select-file').waitFor()
  await answerFileDialog(app, [path])
  await page.getByTestId('select-file').click()
  await expect(pages().first()).toBeVisible()
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'localpdf-e2e-forms-'))
})

test.afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
  problems = []
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  await page.getByTestId('select-file').waitFor()
})

test.afterEach(async () => {
  await app.close()
})

test('shows every kind of editable field as a control at its place', async () => {
  await openForm()
  await expect(widget('name').getByTestId('form-text')).toBeVisible()
  await expect(widget('notes').getByTestId('form-text')).toBeVisible()
  await expect(widget('agree').getByTestId('form-checkbox')).toBeVisible()
  await expect(page.getByTestId('form-radio')).toHaveCount(2)
  await expect(widget('city').getByTestId('form-dropdown')).toBeVisible()
  await expect(widget('langs').getByTestId('form-list')).toBeVisible()

  // `name` sits at (50, 700) and is 300 by 24 in PDF space on an 842 point page.
  const pageBox = (await pages().first().boundingBox())!
  const scale = pageBox.width / 595
  const box = (await widget('name').boundingBox())!
  expect(Math.abs(box.x - pageBox.x - 50 * scale)).toBeLessThan(1)
  expect(Math.abs(box.y - pageBox.y - (842 - 724) * scale)).toBeLessThan(1)
  expect(Math.abs(box.width - 300 * scale)).toBeLessThan(1)
  expect(Math.abs(box.height - 24 * scale)).toBeLessThan(1)

  expect(problems).toEqual([])
})

test('starts from the values in the file', async () => {
  await openForm()
  await expect(widget('preset').getByTestId('form-text')).toHaveValue('Preset value')
  await expect(widget('on').getByTestId('form-checkbox')).toBeChecked()
  await expect(widget('agree').getByTestId('form-checkbox')).not.toBeChecked()
})

test('a read-only field gets no control', async () => {
  await openForm()
  await expect(widget('fixed')).toHaveCount(0)
})

test('a field on two pages shows the same value on both', async () => {
  await openForm()
  await widget('name').getByTestId('form-text').fill('Анна')
  await expect(pages().nth(1).locator('[data-field-name="name"]').getByTestId('form-text')).toHaveValue('Анна')
})

test('respects the maximum length of a field', async () => {
  await openForm()
  const input = widget('short').getByTestId('form-text')
  await input.click()
  await page.keyboard.type('123456')
  await expect(input).toHaveValue('123')
})

test('radio buttons of a group exclude each other', async () => {
  await openForm()
  const [first, second] = [page.getByTestId('form-radio').nth(0), page.getByTestId('form-radio').nth(1)]
  await first.check()
  await expect(first).toBeChecked()
  await second.check()
  await expect(second).toBeChecked()
  await expect(first).not.toBeChecked()
})

test('a list with single choice keeps one option', async () => {
  await openForm()
  const list = widget('langs').getByTestId('form-list')
  await list.selectOption('Русский')
  await expect(list).toHaveValues(['Русский'])
  await list.selectOption('English')
  await expect(list).toHaveValues(['English'])
})

test('undo covers form values, a burst of typing as one step', async () => {
  await openForm()
  const input = widget('name').getByTestId('form-text')
  await input.click()
  await page.keyboard.type('Значение')
  await page.keyboard.press('Control+KeyZ')
  await expect(input).toHaveValue('')
  await page.keyboard.press('Control+Shift+KeyZ')
  await expect(input).toHaveValue('Значение')

  const box = widget('agree').getByTestId('form-checkbox')
  await box.check()
  await page.getByTestId('undo').click()
  await expect(box).not.toBeChecked()

  const dropdown = widget('city').getByTestId('form-dropdown')
  await dropdown.selectOption('Киев')
  await page.getByTestId('undo').click()
  await expect(dropdown).toHaveValue('')
})

test('thumbnails show entered values', async () => {
  await openForm()
  await widget('name').getByTestId('form-text').fill('На миниатюре')
  await expect(page.getByTestId('page-thumbnail').first().locator('[data-field-name="name"]')).toContainText('На миниатюре')
})

test('fields added by a tool do not edit the form', async () => {
  await openForm()
  await page.getByTestId('tool-text').click()
  const box = (await widget('agree').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByTestId('field')).toHaveCount(1)
  await expect(widget('agree').getByTestId('form-checkbox')).not.toBeChecked()
})

test('the form turns with its page and its value stays', async () => {
  await openForm()
  await widget('name').getByTestId('form-text').fill('Повёрнуто')
  await page.getByTestId('rotate-page').first().click()

  const pageBox = (await pages().first().boundingBox())!
  expect(pageBox.width).toBeGreaterThan(pageBox.height)
  // (50, 118) from the top left, turned clockwise, is at (842 - 118 - 24, 50).
  const scale = pageBox.width / 842
  const box = (await widget('name').boundingBox())!
  expect(box.height).toBeGreaterThan(box.width)
  expect(Math.abs(box.x - pageBox.x - 700 * scale)).toBeLessThan(2)
  expect(Math.abs(box.y - pageBox.y - 50 * scale)).toBeLessThan(2)
  await expect(widget('name').getByTestId('form-text')).toHaveValue('Повёрнуто')
})

test('saved values are printed into the page and the form is gone', async () => {
  await openForm()
  await widget('name').getByTestId('form-text').fill('Анна Müller')
  await widget('notes').getByTestId('form-text').fill('Строка один\nСтрока два')
  await widget('agree').getByTestId('form-checkbox').check()
  await widget('city').getByTestId('form-dropdown').selectOption('Киев')
  await page.getByTestId('form-radio').nth(1).check()

  await saveAndReopen('filled.pdf')

  await expect(pages()).toHaveCount(2)
  await expect(page.getByTestId('form-widget')).toHaveCount(0)
  const text = pages().first().locator('.textLayer')
  await expect(text).toContainText('Анна Müller')
  await expect(text).toContainText('Строка один')
  await expect(text).toContainText('Строка два')
  await expect(text).toContainText('Киев')
  await expect(text).toContainText('Preset value')
  await expect(text).toContainText('Locked value')

  // The value is printed where the field was: (50, 118) from the top left.
  const pageBox = (await pages().first().boundingBox())!
  const scale = pageBox.width / 595
  const span = (await pages().first().locator('.textLayer span[role="presentation"]', { hasText: 'Анна Müller' }).boundingBox())!
  expect(span.x - pageBox.x).toBeGreaterThanOrEqual(49 * scale)
  expect(span.x - pageBox.x).toBeLessThan(60 * scale)
  expect(span.y - pageBox.y).toBeGreaterThanOrEqual(117 * scale)
  expect(span.y + span.height - pageBox.y).toBeLessThanOrEqual(143 * scale)

  await page.getByTestId('page-thumbnail').nth(1).click()
  await expect(pages().nth(1).locator('.textLayer')).toContainText('Анна Müller')
  expect(problems).toEqual([])
})

test('a page rotated in the editor saves its form values too', async () => {
  await openForm()
  await widget('name').getByTestId('form-text').fill('Боком')
  await page.getByTestId('rotate-page').first().click()

  await saveAndReopen('rotated-form.pdf')

  const pageBox = (await pages().first().boundingBox())!
  expect(pageBox.width).toBeGreaterThan(pageBox.height)
  const span = pages().first().locator('.textLayer span[role="presentation"]', { hasText: 'Боком' })
  await expect(span).toBeVisible()
  const box = (await span.boundingBox())!
  expect(box.height).toBeGreaterThan(box.width)
})

test('forms of two merged files keep their values apart', async () => {
  const first = join(directory, 'first.pdf')
  const second = join(directory, 'second.pdf')
  await writeFile(first, await makeRichForm())
  await writeFile(second, await makeRichForm())
  await answerFileDialog(app, [first, second])
  await page.getByTestId('select-file').click()
  await expect(pages()).toHaveCount(4)
  for (let click = 0; click < 3; click++) await page.getByTestId('decrease-zoom-level').click()

  await pages().nth(0).locator('[data-field-name="name"]').getByTestId('form-text').fill('Из первого')
  await pages().nth(2).locator('[data-field-name="name"]').getByTestId('form-text').fill('Из второго')
  await expect(pages().nth(0).locator('[data-field-name="name"]').getByTestId('form-text')).toHaveValue('Из первого')

  await saveAndReopen('merged-forms.pdf')

  await expect(pages()).toHaveCount(4)
  await expect(pages().nth(0).locator('.textLayer')).toContainText('Из первого')
  await page.getByTestId('page-thumbnail').nth(2).click()
  await expect(pages().nth(2).locator('.textLayer')).toContainText('Из второго')
})

test('a form with an unsigned digital signature field opens and saves', async () => {
  const path = join(directory, 'signature-form.pdf')
  await writeFile(path, await makeUnsignedSignatureForm())
  await answerFileDialog(app, [path])
  await page.getByTestId('select-file').click()
  await expect(pages()).toHaveCount(1)
  await expect(page.getByTestId('form-widget')).toHaveCount(1)

  await widget('name').getByTestId('form-text').fill('Подписант')
  await saveAndReopen('signature-form-saved.pdf')

  await expect(pages().first().locator('.textLayer')).toContainText('Подписант')
  await expect(page.getByTestId('notice')).toHaveCount(0)
})

test('a PDF without a form shows no controls', async () => {
  const path = await writePdf(directory, 'plain.pdf', [{ text: 'Plain' }])
  await answerFileDialog(app, [path])
  await page.getByTestId('select-file').click()
  await expect(pages()).toHaveCount(1)
  await expect(page.getByTestId('form-widget')).toHaveCount(0)
})

test('screenshot of a filled form', async () => {
  await openForm()
  await widget('name').getByTestId('form-text').fill('Анна Müller')
  await widget('notes').getByTestId('form-text').fill('Строка один\nСтрока два')
  await widget('agree').getByTestId('form-checkbox').check()
  await widget('city').getByTestId('form-dropdown').selectOption('Киев')
  await widget('langs').getByTestId('form-list').selectOption('Русский')
  await page.getByTestId('form-radio').nth(0).check()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(ROOT, 'samples/private/out/form-editor.png') })

  await saveAndReopen('shot.pdf')
  for (let click = 0; click < 2; click++) await page.getByTestId('decrease-zoom-level').click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(ROOT, 'samples/private/out/form-saved.png') })
})
