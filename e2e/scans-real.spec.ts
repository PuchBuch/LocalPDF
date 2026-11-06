import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { answerFileDialog, launchApp, ROOT } from './harness'

// Real scans with the text they hold, from Tesseract's own tests, kept outside git.
const FOLDER = join(ROOT, 'samples', 'private', 'corpus', 'scans')
const OUT = join(ROOT, 'samples', 'private', 'out')

/** Edit distance over the expected length: 0 is perfect. */
function errorRate(expected: string, actual: string): number {
  const a = expected.replace(/\s+/g, ' ').trim()
  const b = actual.replace(/\s+/g, ' ').trim()
  let row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    row = next
  }
  return row[b.length]! / a.length
}

for (const [image, truth, language, limit] of [
  ['phototest.png', 'phototest.txt', 'en', 0.05],
  ['eurotext.png', 'eurotext.txt', 'en', 0.15],
  ['eurotext.png', 'eurotext.txt', 'de', 0.1]
] as const) {
  test(`reads ${image} in ${language}`, async () => {
    test.skip(!existsSync(join(FOLDER, image)), 'the scans are not here')
    test.setTimeout(180_000)
    const { app, page } = await launchApp({ locale: 'ru' })
    try {
      await page.getByTestId('select-file').waitFor()
      await answerFileDialog(app, [join(FOLDER, image)])
      await page.getByTestId('select-file').click()
      await expect(page.getByTestId('pdf-page')).toHaveCount(1)
      await page.getByTestId('ocr-language').selectOption(language)

      await page.getByTestId('page-thumbnail').first().click({ button: 'right' })
      await page.getByTestId('recognize').click()
      await page.getByTestId('recognize-this').click()
      await expect(page.getByTestId('saved-note')).toContainText('Распознано слов', { timeout: 150_000 })

      await app.evaluate(({ clipboard }) => {
        clipboard.writeText = async (text: string) => {
          ;(globalThis as unknown as { copied: string }).copied = text
        }
      })
      await page.getByTestId('more-download').click()
      await page.getByTestId('copy-markdown').click()
      await expect(page.getByTestId('saved-note')).toContainText('скопирован')
      const read = await app.evaluate(() => (globalThis as unknown as { copied: string }).copied)

      const expected = await readFile(join(FOLDER, truth), 'utf8')
      const rate = errorRate(expected, read)
      await mkdir(OUT, { recursive: true })
      await writeFile(join(OUT, `ocr-${image}-${language}.txt`), `error rate ${rate.toFixed(3)}\n\n${read}\n`)
      console.log(`${image} ${language}: error rate ${(rate * 100).toFixed(1)}%`)
      expect(rate).toBeLessThan(limit)
    } finally {
      await app.close()
    }
  })
}
