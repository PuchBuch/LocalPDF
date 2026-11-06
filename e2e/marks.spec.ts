import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { answerFileDialog, expectSavedMatchesScreen, launchApp, ROOT, writePdf } from './harness'

const OUT = join(ROOT, 'samples', 'private', 'out')

let directory: string
let app: ElectronApplication
let page: Page
let userData: string

const pages = () => page.getByTestId('pdf-page')
const box = () => page.getByTestId('field-checkbox')
const fields = () => page.getByTestId('field')

async function addMark(x = 200, y = 300): Promise<void> {
  await page.getByTestId('tool-checkbox').click()
  const pageBox = (await pages().first().boundingBox())!
  const scale = pageBox.width / 595
  await page.mouse.click(pageBox.x + x * scale, pageBox.y + y * scale)
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'localpdf-e2e-marks-'))
})

test.afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

test.beforeEach(async () => {
  ;({ app, page, userData } = await launchApp())
  await page.getByTestId('select-file').waitFor()
  await answerFileDialog(app, [await writePdf(directory, 'marks.pdf', [{ text: 'Marks' }])])
  await page.getByTestId('select-file').click()
  await expect(pages()).toHaveCount(1)
})

test.afterEach(async () => {
  await app.close()
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
})

test('the buttons of the field choose the mark directly', async () => {
  await addMark()
  await expect(box()).toHaveAttribute('data-value', 'tick')
  await expect(page.getByTestId('mark-tick')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('mark-dot').click()
  await expect(box()).toHaveAttribute('data-value', 'dot')
  await expect(page.getByTestId('mark-dot')).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: join(OUT, 'mark-dot.png') })

  await page.getByTestId('mark-cross').click()
  await expect(box()).toHaveAttribute('data-value', 'cross')
  await expect(page.getByTestId('mark-dot')).toHaveAttribute('aria-pressed', 'false')
})

test('pressing the chosen mark again empties the field', async () => {
  await addMark()
  await page.getByTestId('mark-tick').click()
  await expect(box()).toHaveAttribute('data-value', 'empty')
  await page.getByTestId('mark-dot').click()
  await expect(box()).toHaveAttribute('data-value', 'dot')
})

test('a click on the field still goes through all the marks', async () => {
  await addMark()
  for (const value of ['cross', 'dot', 'empty', 'tick']) {
    await box().click()
    await expect(box()).toHaveAttribute('data-value', value)
  }
})

test('undo takes back a chosen mark', async () => {
  await addMark()
  await page.getByTestId('mark-dot').click()
  await page.getByTestId('undo').click()
  await expect(box()).toHaveAttribute('data-value', 'tick')
})

test('text fields do not get these buttons', async () => {
  await page.getByTestId('tool-text').click()
  const pageBox = (await pages().first().boundingBox())!
  await page.mouse.click(pageBox.x + 300, pageBox.y + 500)
  await expect(fields()).toHaveCount(1)
  await expect(page.getByTestId('field-grab-handle')).toBeVisible()
  await expect(page.getByTestId('mark-dot')).toHaveCount(0)
})

for (const mark of ['tick', 'cross', 'dot'] as const) {
  test(`the screen and the saved file agree for a ${mark}`, async () => {
    await addMark()
    if (mark !== 'tick') await page.getByTestId(`mark-${mark}`).click()
    await expectSavedMatchesScreen(app, page, join(directory, `${mark}.pdf`), { x: 180, y: 280, width: 40, height: 40 })
  })
}
