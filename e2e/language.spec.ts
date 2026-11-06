import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { answerFileDialog, launchApp, ROOT, writePdf } from './harness'

let directory: string
let app: ElectronApplication
let page: Page
let userData: string

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'localpdf-e2e-language-'))
})

test.afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

test.afterEach(async () => {
  await app.close()
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
})

const start = async (options: Parameters<typeof launchApp>[0]) => {
  ;({ app, page, userData } = await launchApp(options))
  await page.getByTestId('select-file').waitFor()
}

for (const [locale, text] of [
  ['en-US', 'Choose a file'],
  ['de-AT', 'Datei auswählen'],
  ['fr-FR', 'Choisir un fichier'],
  ['es-MX', 'Elegir un archivo'],
  ['it-IT', 'Scegli un file'],
  ['pl-PL', 'Wybierz plik'],
  ['uk-UA', 'Вибрати файл'],
  ['ru-RU', 'Выбрать файл']
] as const) {
  test(`starts in the language of a ${locale} system`, async () => {
    await start({ locale })
    await expect(page.getByTestId('select-file')).toHaveText(text)
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(locale.slice(0, 2))
  })
}

test('falls back to English on a system in another language', async () => {
  await start({ locale: 'ja-JP' })
  await expect(page.getByTestId('select-file')).toHaveText('Choose a file')
})

test('remembers the language chosen, over the one of the system', async () => {
  await start({ locale: 'en-US' })
  await page.getByTestId('language').selectOption('de')
  await expect(page.getByTestId('select-file')).toHaveText('Datei auswählen')
  // Writing settings to disk takes a moment after the choice.
  await page.waitForTimeout(500)
  await app.close()

  await start({ userData, locale: 'en-US' })
  await expect(page.getByTestId('select-file')).toHaveText('Datei auswählen')
  await expect(page.getByTestId('language')).toHaveValue('de')
})

test('changes language with a document open, and keeps the document and its edits', async () => {
  await start({ locale: 'en-US' })
  await answerFileDialog(app, [await writePdf(directory, 'lang.pdf', [{ text: 'One' }, { text: 'Two' }])])
  await page.getByTestId('select-file').click()
  await expect(page.getByTestId('pdf-page')).toHaveCount(2)
  await page.getByTestId('delete-page').first().click()
  await expect(page.getByTestId('page-counter')).toHaveText('Page 1 of 1')
  await page.screenshot({ path: join(ROOT, 'samples', 'private', 'out', 'language-en.png') })

  await page.getByTestId('language').selectOption('fr')
  await expect(page.getByTestId('page-counter')).toHaveText('Page 1 sur 1')
  await expect(page.getByTestId('download')).toHaveText('Télécharger')
  await expect(page.getByTestId('pdf-page')).toHaveCount(1)
  await expect(page.locator('.page-canvas canvas').first()).toBeVisible()
  await expect(page.getByTestId('undo')).toBeEnabled()
  await page.getByTestId('undo').click()
  await expect(page.getByTestId('pdf-page')).toHaveCount(2)
})

test('the dialogs of the system speak the chosen language too', async () => {
  await start({ locale: 'en-US' })
  await page.getByTestId('language').selectOption('de')
  await answerFileDialog(app, [await writePdf(directory, 'dialog.pdf', [{ text: 'One' }, { text: 'Two' }])])
  await page.getByTestId('select-file').click()
  await expect(page.getByTestId('pdf-page')).toHaveCount(2)
  await page.getByTestId('delete-page').first().click()

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async (...args: unknown[]) => {
      ;(globalThis as unknown as { lastBox: unknown }).lastBox = args.at(-1)
      return { response: 2, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  })
  await page.getByTestId('new-file').click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { lastBox?: { buttons: string[] } }).lastBox?.buttons))
    .toEqual(['Speichern', 'Nicht speichern', 'Abbrechen'])
})

test('the language to recognize can differ from the app, and follows it until chosen', async () => {
  await start({ locale: 'en-US' })
  await answerFileDialog(app, [await writePdf(directory, 'ocr.pdf', [{ text: 'One' }])])
  await page.getByTestId('select-file').click()
  await expect(page.getByTestId('ocr-language')).toHaveValue('en')

  await page.getByTestId('language').selectOption('fr')
  await expect(page.getByTestId('ocr-language')).toHaveValue('fr')

  await page.getByTestId('ocr-language').selectOption('de')
  await page.getByTestId('language').selectOption('it')
  await expect(page.getByTestId('ocr-language')).toHaveValue('de')
})

test('every language fits the side panel without pushing anything off', async () => {
  await start({ locale: 'en-US' })
  await answerFileDialog(app, [await writePdf(directory, 'fit.pdf', [{ text: 'One' }])])
  await page.getByTestId('select-file').click()
  await expect(page.getByTestId('pdf-page')).toHaveCount(1)

  for (const locale of ['en', 'de', 'fr', 'es', 'it', 'pl', 'uk', 'ru']) {
    await page.getByTestId('language').selectOption(locale)
    const panel = (await page.locator('.tools').boundingBox())!
    const bottom = (await page.getByTestId('ocr-language').boundingBox())!
    expect(bottom.x + bottom.width, locale).toBeLessThanOrEqual(panel.x + panel.width)
    const height = await page.evaluate(() => innerHeight)
    expect(bottom.y + bottom.height, locale).toBeLessThanOrEqual(height)
    await page.screenshot({ path: join(ROOT, 'samples', 'private', 'out', `language-${locale}.png`) })
  }
})
