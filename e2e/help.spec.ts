import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { answerFileDialog, launchApp, writePdf } from './harness'

let directory: string
let app: ElectronApplication
let page: Page
let userData: string
let requests: string[]

const help = () => page.getByTestId('help-dialog')
const content = () => page.getByTestId('help-content')

async function start(locale = 'ru'): Promise<void> {
  ;({ app, page, userData } = await launchApp({ locale }))
  requests = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!['app:', 'blob:', 'data:'].includes(url.protocol) && url.hostname !== 'localhost') requests.push(request.url())
  })
  await page.getByTestId('select-file').waitFor()
}

async function openDocument(): Promise<void> {
  await answerFileDialog(app, [await writePdf(directory, 'help.pdf', [{ text: 'One' }])])
  await page.getByTestId('select-file').click()
  await expect(page.getByTestId('pdf-page')).toHaveCount(1)
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'localpdf-e2e-help-'))
})

test.afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

test.afterEach(async () => {
  await app.close()
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
})

test('the start screen shows the first steps, the guide and the questions', async () => {
  await start()
  await expect(page.getByTestId('first-steps').locator('li')).toHaveCount(3)
  await page.screenshot({ path: test.info().outputPath('start.png') })

  await page.getByTestId('open-help').click()
  await expect(content()).toContainText('С чего начать')
  await page.getByTestId('help-section-table').click()
  await expect(content()).toContainText('Заполнить таблицу на скане')
  await page.screenshot({ path: test.info().outputPath('guide.png') })

  await page.getByTestId('help-search').fill('пароль')
  await expect(page.getByTestId('help-section-password')).toBeVisible()
  await expect(page.getByTestId('help-section-pages')).toHaveCount(0)
  await page.getByTestId('help-search').fill('абракадабра')
  await expect(page.getByTestId('help-nothing')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(help()).toHaveCount(0)

  await page.getByTestId('open-faq').click()
  const question = page.getByTestId('help-question').first()
  await question.locator('summary').click()
  await question.getByRole('button').click()
  await expect(content()).toContainText('Заполнить таблицу на скане')
  expect(requests).toEqual([])
})

test('F1 and the question mark open the chapter about what is being done', async () => {
  await start()
  await openDocument()
  await page.getByTestId('tool-edit').click()
  await page.keyboard.press('F1')
  await expect(content()).toContainText('Исправить текст в документе')
  await page.getByTestId('help-close').click()
  await expect(help()).toHaveCount(0)

  await page.getByTestId('tool-signature').click()
  await page.getByTestId('help-link-sign').click()
  await expect(content()).toContainText('Подпись и картинка')
})

test('Escape closes the help and leaves the dialog under it open', async () => {
  await start()
  await openDocument()
  await page.getByTestId('tool-signature').click()
  await page.getByTestId('pdf-page').click({ position: { x: 120, y: 160 } })
  const signature = page.locator('.signature-canvas')
  await expect(signature).toBeVisible()
  await page.keyboard.press('F1')
  await expect(content()).toContainText('Подпись и картинка')
  await page.keyboard.press('Escape')
  await expect(help()).toHaveCount(0)
  await expect(signature).toBeVisible()
})

test('a button beside the thumbnail opens the menu of the page, whose items say what they do', async () => {
  await start()
  await openDocument()
  await page.getByTestId('page-menu').click()
  await expect(page.getByTestId('thumbnail-menu')).toBeVisible()
  for (const item of ['copy-content', 'recognize', 'find-fields', 'fill-table', 'print-page', 'replace-page']) {
    expect(await page.getByTestId(item).getAttribute('title'), item).toBeTruthy()
  }
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('thumbnail-menu')).toHaveCount(0)
})

test('feedback keeps the text of each kind, and a question can be asked from the help', async () => {
  await start()
  await openDocument()
  await page.getByTestId('open-feedback').click()
  const text = page.getByTestId('report-text')
  await expect(text).toHaveValue(/What would you like to do/)
  await text.fill('My idea')
  await page.getByTestId('feedback-problem').check()
  await expect(text).toHaveValue(/Recent errors/)
  await page.getByTestId('feedback-idea').check()
  await expect(text).toHaveValue('My idea')
  expect(await page.getByTestId('report-github').getAttribute('href')).toContain('template=idea.md')
  await page.keyboard.press('Escape')

  await page.getByTestId('open-help').click()
  await page.getByTestId('help-ask').click()
  await expect(help()).toHaveCount(0)
  await expect(page.getByTestId('feedback-question')).toBeChecked()
  await expect(text).toHaveValue(/Your question/)
  expect(requests).toEqual([])
})

test('a language without a guide of its own says so and shows the English one', async () => {
  await start('pl')
  await page.getByTestId('open-help').click()
  await expect(page.getByTestId('help-other-language')).toBeVisible()
  await expect(content()).toContainText('Getting started')
})
