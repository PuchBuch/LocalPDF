import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { answerFileDialog, launchApp, writePdf } from './harness'

/** On a machine set up by the CI workflow, whose test printer writes to a file. */
const PRINTER = process.env['LOCALPDF_E2E_PRINTER']
const PRINTED = process.env['LOCALPDF_E2E_PRINTED']

test('prints through a real Windows printer driver', async () => {
  test.skip(!PRINTER || !PRINTED, 'needs the printer the CI workflow adds')
  const directory = await mkdtemp(join(tmpdir(), 'localpdf-e2e-print-'))
  const { app, page, userData } = await launchApp()
  try {
    await page.getByTestId('select-file').waitFor()
    await answerFileDialog(app, [await writePdf(directory, 'print.pdf', [{ text: 'One' }, { text: 'Two' }])])
    await page.getByTestId('select-file').click()
    await expect(page.getByTestId('pdf-page')).toHaveCount(2)

    // As the dialog would, only without a person to press its button.
    await app.evaluate(({ webContents }, deviceName) => {
      const contents = webContents.getAllWebContents()[0]!
      const original = contents.print.bind(contents)
      contents.print = ((options: object, callback: (success: boolean, reason: string) => void) =>
        original({ ...options, silent: true, deviceName }, callback)) as typeof contents.print
    }, PRINTER!)
    await page.getByTestId('more-download').click()
    await page.getByTestId('print-document').click()

    await expect.poll(() => existsSync(PRINTED!), { timeout: 60_000 }).toBe(true)
    await expect(page.getByTestId('download')).toBeEnabled({ timeout: 60_000 })
    await expect(page.getByTestId('notice')).toHaveCount(0)
    await expect
      .poll(async () => (await PDFDocument.load(await readFile(PRINTED!))).getPageCount(), { timeout: 60_000 })
      .toBe(2)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true }).catch(() => undefined)
  }
})
