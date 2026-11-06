import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const ROOT = resolve(__dirname, '..')
const EXTENSION = join(ROOT, 'out-extension')
const OUT = join(ROOT, 'samples', 'private', 'out')

let directory: string
let profile: string
let context: BrowserContext
let page: Page
let extensionId: string
let outsideRequests: string[]

const pages = () => page.getByTestId('pdf-page')

async function launch(existingProfile?: string): Promise<void> {
  profile = existingProfile ?? (await mkdtemp(join(tmpdir(), 'localpdf-ext-')))
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    locale: 'en-US',
    acceptDownloads: true,
    // Playwright's defaults turn extensions off altogether. Chromium no longer takes an
    // extension on its command line, so it is loaded over the debugging connection.
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging']
  })
  const session = await context.browser()!.newBrowserCDPSession()
  const send = session.send.bind(session) as unknown as (method: string, params: object) => Promise<unknown>
  await send('Extensions.loadUnpacked', { path: EXTENSION })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  extensionId = new URL(worker.url()).host
  outsideRequests = []
  context.on('request', (request) => {
    const url = new URL(request.url())
    if (!['chrome-extension:', 'blob:', 'data:'].includes(url.protocol)) outsideRequests.push(request.url())
  })
  page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/index.html`)
  await page.getByTestId('select-file').waitFor()
}

async function writePdf(name: string, ...labels: string[]): Promise<string> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  for (const label of labels) document.addPage([595, 842]).drawText(label, { x: 60, y: 700, font, size: 18 })
  const path = join(directory, name)
  await writeFile(path, await document.save())
  return path
}

async function open(path: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('select-file').click()
  await (await chooser).setFiles(path)
  await expect(pages().first()).toBeVisible()
}

async function addText(text: string, x = 200, y = 400): Promise<void> {
  await page.getByTestId('tool-text').click()
  const box = (await pages().first().boundingBox())!
  const scale = box.width / 595
  await page.mouse.click(box.x + x * scale, box.y + y * scale)
  await page.keyboard.type(text)
  await page.getByTestId('tool-cursor').click()
}

/** Makes the save dialog answer without being shown, keeping what is written. */
async function answerSavePicker(name: string | null): Promise<void> {
  await page.evaluate((answer) => {
    const saved = window as unknown as { savedBytes?: number[]; showSaveFilePicker: unknown }
    saved.showSaveFilePicker = async () => {
      if (answer === null) throw new DOMException('Cancelled', 'AbortError')
      return {
        name: answer,
        createWritable: async () => ({
          write: async (blob: Blob) => {
            saved.savedBytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
          },
          close: async () => undefined
        })
      }
    }
  }, name)
}

const savedBytes = async () =>
  new Uint8Array(await page.evaluate(() => (window as unknown as { savedBytes: number[] }).savedBytes))

async function textOf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise
  const { items } = await (await pdf.getPage(1)).getTextContent()
  return items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' ')
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'localpdf-ext-files-'))
})

test.afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

test.afterEach(async () => {
  await context.close()
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
})

test('asks for no permissions and allows no outside connections', async () => {
  const manifest = JSON.parse(await readFile(join(EXTENSION, 'manifest.json'), 'utf8'))
  expect(manifest.manifest_version).toBe(3)
  expect(manifest.permissions).toBeUndefined()
  expect(manifest.host_permissions).toBeUndefined()
  expect(manifest.optional_permissions).toBeUndefined()
  expect(manifest.content_scripts).toBeUndefined()
  expect(manifest.version).toMatch(/^\d+(\.\d+){0,3}$/)
  const policy: string = manifest.content_security_policy.extension_pages
  expect(policy).toContain("connect-src 'self' blob: data:")
  expect(policy).toContain("default-src 'self'")
  expect(policy).not.toMatch(/https?:/)

  await launch()
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/')
      return false
    } catch {
      return true
    }
  })
  expect(blocked).toBe(true)
})

test('opens a PDF, edits it and saves it through the file dialog', async () => {
  await launch()
  await open(await writePdf('edit.pdf', 'Hello from a PDF'))
  await expect(page.locator('.textLayer').first()).toContainText('Hello from a PDF')
  await addText('Added text')
  await page.screenshot({ path: join(OUT, 'extension.png') })

  await answerSavePicker('saved.pdf')
  await page.getByTestId('download').click()
  await expect(page.getByTestId('saved-note')).toHaveText('Saved: saved.pdf')
  const text = await textOf(await savedBytes())
  expect(text).toContain('Hello from a PDF')
  expect(text).toContain('Added text')
  expect(outsideRequests).toEqual([])
})

test('a cancelled save dialog is not a failure', async () => {
  await launch()
  await open(await writePdf('cancel.pdf', 'One'))
  await answerSavePicker(null)
  await page.getByTestId('download').click()
  await expect(page.getByTestId('download')).toBeEnabled()
  await expect(page.getByTestId('notice')).toHaveCount(0)
  await expect(page.getByTestId('saved-note')).toHaveCount(0)
})

test('falls back on a download where the file dialog is refused', async () => {
  await launch()
  await open(await writePdf('download.pdf', 'One'))
  await page.evaluate(() => {
    ;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      throw new DOMException('Must be handling a user gesture', 'SecurityError')
    }
  })
  const downloaded = page.waitForEvent('download')
  await page.getByTestId('download').click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('download-document.pdf')
  await expect(page.getByTestId('saved-note')).toBeVisible()
  const bytes = new Uint8Array(await readFile(await download.path()))
  expect(await textOf(bytes)).toContain('One')
})

test('reads text in a scan offline, in the browser', async () => {
  test.setTimeout(150_000)
  await launch()
  GlobalFonts.registerFromPath(join(ROOT, 'src/renderer/public/fonts/LiberationSans-Regular.ttf'), 'Scan Sans')
  const canvas = createCanvas(1240, 1754)
  const drawing = canvas.getContext('2d')
  drawing.fillStyle = '#ffffff'
  drawing.fillRect(0, 0, 1240, 1754)
  drawing.fillStyle = '#000000'
  drawing.font = '44px "Scan Sans"'
  drawing.fillText('Invoice number 12345', 120, 200)
  const image = join(directory, 'scan.png')
  await writeFile(image, canvas.toBuffer('image/png'))

  await open(image)
  await page.getByTestId('page-thumbnail').first().click({ button: 'right' })
  await page.getByTestId('recognize').click()
  await page.getByTestId('recognize-this').click()
  await expect(page.getByTestId('saved-note')).toContainText('Words recognized', { timeout: 120_000 })
  expect(outsideRequests).toEqual([])

  await answerSavePicker('searchable.pdf')
  await page.getByTestId('download').click()
  await expect(page.getByTestId('saved-note')).toContainText('Saved')
  const text = await textOf(await savedBytes())
  expect(text).toContain('Invoice')
  expect(text).toContain('12345')
})

test('cuts replaced text out of the saved file', async () => {
  await launch()
  await open(await writePdf('secret.pdf', 'Account 1234567 is secret'))
  await page.getByTestId('tool-edit').click()
  await page.getByTestId('edit-scope-word').click()
  await page.getByRole('button', { name: '1234567', exact: true }).click()
  await page.getByTestId('field-input').fill('')
  await page.getByTestId('tool-cursor').click()
  await answerSavePicker('removed.pdf')
  await page.getByTestId('download').click()
  await expect(page.getByTestId('saved-note')).toContainText('Saved')
  const text = await textOf(await savedBytes())
  expect(text).not.toContain('1234567')
  expect(text).toContain('Account')
  await expect(page.getByTestId('notice')).toHaveCount(0)
})

test('asks about unsaved changes in its own dialog, and in the chosen language', async () => {
  await launch()
  await page.getByTestId('language').selectOption('de')
  await open(await writePdf('ask.pdf', 'One'))
  await addText('Change')

  await page.getByTestId('new-file').click()
  const dialog = page.getByTestId('choice-dialog')
  await expect(dialog).toContainText('Änderungen')
  await expect(page.getByTestId('choice-0')).toHaveText('Speichern')
  await page.screenshot({ path: join(OUT, 'extension-dialog.png') })

  await page.getByTestId('choice-2').click()
  await expect(dialog).toHaveCount(0)
  await expect(pages()).toHaveCount(1)

  await page.getByTestId('new-file').click()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(pages()).toHaveCount(1)

  await page.getByTestId('new-file').click()
  await page.getByTestId('choice-1').click()
  await expect(page.getByTestId('select-file')).toBeVisible()
})

test('warns before a tab with unsaved changes closes, and not otherwise', async () => {
  await launch()
  await open(await writePdf('close.pdf', 'One'))
  const wouldWarn = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
  expect(await wouldWarn()).toBe(false)
  await addText('Change')
  await expect.poll(wouldWarn).toBe(true)
})

test('brings back a document after the browser went away', async () => {
  await launch()
  await open(await writePdf('recover.pdf', 'Original', 'Second'))
  await addText('Do not lose me')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((done) => {
            const request = indexedDB.open('localpdf', 1)
            request.onsuccess = () => {
              const database = request.result
              const read = database.transaction('state').objectStore('state').get('state')
              read.onsuccess = () => {
                database.close()
                done(typeof read.result === 'string' && read.result.includes('Do not lose me'))
              }
            }
          })
      )
    , { timeout: 15_000 })
    .toBe(true)

  const kept = profile
  await context.close()
  await launch(kept)
  await expect(page.getByTestId('recovery-dialog')).toContainText('recover.pdf')
  await page.getByTestId('recovery-restore').click()
  await expect(pages()).toHaveCount(2)
  await expect(page.getByTestId('field-input')).toHaveValue('Do not lose me')
})

test('prints only the pages prepared for it', async () => {
  await launch()
  await open(await writePdf('print.pdf', 'One', 'Two'))
  await page.evaluate(() => {
    const record = window as unknown as { printedPages?: number; print: () => void }
    record.print = () => {
      record.printedPages = document.querySelectorAll('.print-root .print-page img').length
    }
  })
  await page.getByTestId('more-download').click()
  await page.getByTestId('print-document').click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { printedPages?: number }).printedPages))
    .toBe(2)
  await expect(page.locator('.print-root')).toHaveCount(0)
  await expect(page.getByTestId('download')).toBeEnabled()
})

test('copies text as Markdown', async () => {
  await launch()
  await page.evaluate(() => {
    const record = window as unknown as { copied?: string }
    navigator.clipboard.writeText = async (value: string) => {
      record.copied = value
    }
  })
  await open(await writePdf('copy.pdf', 'Copy this line'))
  await page.getByTestId('more-download').click()
  await page.getByTestId('copy-markdown').click()
  await expect(page.getByTestId('saved-note')).toHaveText('Text copied to the clipboard')
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toContain('Copy this line')
})

test('still copies where the clipboard interface is refused', async () => {
  await launch()
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new DOMException('Refused', 'NotAllowedError')
    }
    document.execCommand = () => true
  })
  await open(await writePdf('copy2.pdf', 'Copy this line'))
  await page.getByTestId('more-download').click()
  await page.getByTestId('copy-markdown').click()
  await expect(page.getByTestId('saved-note')).toHaveText('Text copied to the clipboard')
})

test('the toolbar button opens the editor, and then brings back its tab instead of a second one', async () => {
  await launch()
  await page.close()
  const worker = context.serviceWorkers()[0]!
  const editorTabs = () => context.pages().filter((tab) => tab.url().startsWith(`chrome-extension://${extensionId}/`))
  const pressButton = () =>
    worker.evaluate(() => {
      ;(chrome.action.onClicked as unknown as { dispatch: (tab: object) => void }).dispatch({})
    })

  await pressButton()
  await expect.poll(() => editorTabs().length).toBe(1)
  const tab = editorTabs()[0]!
  await tab.getByTestId('select-file').waitFor()

  await pressButton()
  await tab.waitForTimeout(800)
  expect(editorTabs()).toHaveLength(1)
})
