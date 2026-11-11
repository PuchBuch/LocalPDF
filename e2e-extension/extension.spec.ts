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

test.describe('a page signed by hand', () => {
  /** A phone photo of a printed sheet lying turned on a dark table, with a shadow across it. */
  async function photoOfSheet(name: string): Promise<string> {
    const canvas = createCanvas(1600, 1200)
    const drawing = canvas.getContext('2d')
    drawing.fillStyle = '#4a3a2b'
    drawing.fillRect(0, 0, 1600, 1200)
    drawing.save()
    drawing.translate(800, 600)
    drawing.rotate((8 * Math.PI) / 180)
    drawing.translate(-370, -523)
    const shade = drawing.createLinearGradient(0, 0, 740, 0)
    shade.addColorStop(0, '#a9a7a1')
    shade.addColorStop(1, '#f0eee8')
    drawing.fillStyle = shade
    drawing.fillRect(0, 0, 740, 1046)
    drawing.fillStyle = '#151515'
    drawing.font = '34px sans-serif'
    drawing.fillText('Date: 9.11.2026', 70, 800)
    drawing.strokeStyle = '#1d3fa8'
    drawing.lineWidth = 6
    drawing.beginPath()
    drawing.moveTo(380, 820)
    drawing.bezierCurveTo(440, 740, 520, 880, 640, 790)
    drawing.stroke()
    drawing.restore()
    const path = join(directory, name)
    await writeFile(path, canvas.toBuffer('image/jpeg', 92))
    return path
  }

  async function replaceThirdPage(path: string): Promise<void> {
    await page.getByTestId('page-thumbnail').nth(2).click({ button: 'right' })
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('replace-page').click()
    const fileChooser = await chooser
    expect(fileChooser.isMultiple()).toBe(false)
    await fileChooser.setFiles(path)
  }

  async function pagesOf(bytes: Uint8Array): Promise<{ width: number; height: number; text: string }[]> {
    const pdf = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise
    const result = []
    for (let number = 1; number <= pdf.numPages; number++) {
      const pdfPage = await pdf.getPage(number)
      const { width, height } = pdfPage.getViewport({ scale: 1 })
      const { items } = await pdfPage.getTextContent()
      result.push({ width, height, text: items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' ') })
    }
    return result
  }

  test('puts the straightened photo of the signed sheet in place of the last page', async () => {
    test.setTimeout(90_000)
    await launch()
    await open(await writePdf('form.pdf', 'One', 'Two', 'Sign here'))
    await replaceThirdPage(await photoOfSheet('signed.jpg'))

    await expect(page.getByTestId('scan-dialog')).toBeVisible()
    await expect(page.getByTestId('scan-hint')).toHaveText('Sheet found. Adjust the corners if needed.')
    await expect(page.getByTestId('scan-look-color')).toBeChecked()
    await page.screenshot({ path: join(OUT, 'scan-dialog.png') })
    await page.getByTestId('scan-use').click()
    await expect(page.getByTestId('saved-note')).toHaveText('Page replaced', { timeout: 30_000 })
    await expect(pages()).toHaveCount(3)
    await page.screenshot({ path: join(OUT, 'scan-replaced.png') })

    await answerSavePicker('signed.pdf')
    await page.getByTestId('download').click()
    await expect(page.getByTestId('saved-note')).toHaveText('Saved: signed.pdf')
    const bytes = await savedBytes()
    expect(bytes.length).toBeLessThan(1_000_000)
    const saved = await pagesOf(bytes)
    expect(saved.map((each) => each.text)).toEqual(['One', 'Two', ''])
    // A sheet close to A4 becomes an A4 page.
    expect(saved[2]!.width).toBeCloseTo(595, 0)
    expect(saved[2]!.height).toBeCloseTo(842, 0)
    expect(outsideRequests).toEqual([])
  })

  test('takes a scan whole, where the paper fills the picture', async () => {
    await launch()
    await open(await writePdf('form.pdf', 'One', 'Two', 'Sign here'))
    const canvas = createCanvas(1240, 1754)
    const drawing = canvas.getContext('2d')
    drawing.fillStyle = '#fdfdfd'
    drawing.fillRect(0, 0, 1240, 1754)
    drawing.fillStyle = '#111'
    drawing.font = '40px sans-serif'
    drawing.fillText('Signed', 120, 1400)
    const scan = join(directory, 'scan.png')
    await writeFile(scan, canvas.toBuffer('image/png'))

    await replaceThirdPage(scan)
    await expect(page.getByTestId('scan-hint')).toHaveText('No sheet found: drag the corners to the edges of the sheet.')
    await page.getByTestId('scan-use').click()
    await expect(page.getByTestId('saved-note')).toHaveText('Page replaced', { timeout: 30_000 })
    await expect(pages()).toHaveCount(3)
  })

  test('changes nothing when the dialog is cancelled, and the replacement can be undone', async () => {
    await launch()
    await open(await writePdf('form.pdf', 'One', 'Two', 'Sign here'))
    const photo = await photoOfSheet('cancel.jpg')
    await replaceThirdPage(photo)
    await page.getByTestId('scan-cancel').click()
    await expect(page.getByTestId('scan-dialog')).toHaveCount(0)
    await page.getByTestId('page-thumbnail').nth(2).click()
    await expect(pages().nth(2).locator('.textLayer')).toContainText('Sign here')

    await replaceThirdPage(photo)
    await page.getByTestId('scan-use').click()
    await expect(page.getByTestId('saved-note')).toHaveText('Page replaced', { timeout: 30_000 })
    await page.getByTestId('page-thumbnail').nth(2).click()
    await expect(pages().nth(2).locator('.textLayer')).not.toContainText('Sign here')
    await page.keyboard.press('Control+z')
    await expect(pages()).toHaveCount(3)
    await page.getByTestId('page-thumbnail').nth(2).click()
    await expect(pages().nth(2).locator('.textLayer')).toContainText('Sign here')
  })

  test('puts a scanned PDF in place of a page without asking', async () => {
    await launch()
    await open(await writePdf('form.pdf', 'One', 'Two', 'Sign here'))
    await replaceThirdPage(await writePdf('scanned.pdf', 'Scanned and signed'))
    await page.getByTestId('page-thumbnail').nth(2).click()
    await expect(pages().nth(2).locator('.textLayer')).toContainText('Scanned and signed')
    await expect(pages()).toHaveCount(3)
    await expect(page.getByTestId('scan-dialog')).toHaveCount(0)
  })

  test('prints just the page to sign', async () => {
    await launch()
    await open(await writePdf('form.pdf', 'One', 'Two', 'Sign here'))
    await page.evaluate(() => {
      const record = window as unknown as { printedPages?: number; print: () => void }
      record.print = () => {
        record.printedPages = document.querySelectorAll('.print-root .print-page img').length
      }
    })
    await page.getByTestId('page-thumbnail').nth(2).click({ button: 'right' })
    await page.getByTestId('print-page').click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { printedPages?: number }).printedPages))
      .toBe(1)
  })
})

test.describe('field numbers', () => {
  /** A form with three text fields, given out of reading order. */
  async function threeFieldForm(): Promise<string> {
    const document = await PDFDocument.create()
    const formPage = document.addPage([595, 842])
    const form = document.getForm()
    for (const [name, x, y] of [['Street', 60, 500], ['Name', 60, 700], ['City', 320, 700]] as const) {
      form.createTextField(name).addToPage(formPage, { x, y, width: 200, height: 22 })
    }
    const path = join(directory, 'numbered.pdf')
    await writeFile(path, await document.save())
    return path
  }

  test('shows numbers in reading order when switched on, and the list goes to a field', async () => {
    await launch()
    await open(await threeFieldForm())
    await expect(page.getByTestId('field-number')).toHaveCount(0)
    await expect(page.getByTestId('show-field-numbers')).not.toBeChecked()

    await page.getByTestId('show-field-numbers').check()
    await expect(page.getByTestId('field-number')).toHaveText(['1', '2', '3'])
    const badgeNear = async (number: number, fieldName: string) => {
      const badge = (await page.getByTestId('field-number').nth(number - 1).boundingBox())!
      const field = (await page.locator(`[data-field-name="${fieldName}"]`).boundingBox())!
      expect(Math.abs(badge.x + badge.width / 2 - field.x)).toBeLessThan(12)
      expect(Math.abs(badge.y + badge.height / 2 - field.y)).toBeLessThan(12)
    }
    await badgeNear(1, 'Name')
    await badgeNear(2, 'City')
    await badgeNear(3, 'Street')

    await page.getByTestId('fields-panel-toggle').click()
    await expect(page.getByTestId('field-row')).toHaveCount(3)
    await expect(page.getByTestId('field-row').nth(2)).toContainText('Street')
    await page.getByTestId('field-row').nth(2).click()
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.closest('[data-field-name]')?.getAttribute('data-field-name')))
      .toBe('Street')
    await page.keyboard.type('Hauptstraße 1')
    await expect(page.getByTestId('field-row').nth(2)).toContainText('Hauptstraße 1')

    await page.getByTestId('show-field-numbers').uncheck()
    await expect(page.getByTestId('field-number')).toHaveCount(0)
  })

  test('numbers added fields too, and a click in the list puts the cursor in them', async () => {
    await launch()
    await open(await writePdf('added.pdf', 'One'))
    await addText('Lower', 200, 500)
    await addText('Upper', 200, 300)
    await page.getByTestId('show-field-numbers').check()
    await expect(page.getByTestId('field-number')).toHaveText(['1', '2'])
    await page.getByTestId('fields-panel-toggle').click()
    await expect(page.getByTestId('field-row').nth(0)).toContainText('Upper')
    await page.getByTestId('field-row').nth(1).click()
    await expect(page.locator('[data-testid="field-input"]:focus')).toHaveValue('Lower')
  })
})
test('fills a form from an AI answer pasted in, reports what it skipped, and one undo takes it back', async () => {
  await launch()
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const formPage = document.addPage([595, 842])
  formPage.drawText('Vorname:', { x: 60, y: 706, font, size: 12 })
  const form = document.getForm()
  form.createTextField('Name').addToPage(formPage, { x: 150, y: 700, width: 150, height: 22 })
  form.createCheckBox('Agree').addToPage(formPage, { x: 360, y: 703, width: 14, height: 14 })
  form.createTextField('Street').addToPage(formPage, { x: 150, y: 500, width: 200, height: 22 })
  const path = join(directory, 'ai.pdf')
  await writeFile(path, await document.save())
  await page.evaluate(() => {
    const record = window as unknown as { copied?: string }
    navigator.clipboard.writeText = async (value: string) => {
      record.copied = value
    }
  })
  await open(path)

  await page.getByTestId('ai-copy').click()
  await expect(page.getByTestId('saved-note')).toHaveText('Form copied: paste it into an AI chat')
  const prompt = await page.evaluate(() => (window as unknown as { copied: string }).copied)
  expect(prompt).toContain('1 | text | "Name" | label "Vorname:"')
  expect(prompt).toContain('2 | checkbox | "Agree" | true/false')
  expect(prompt).toContain('3 | text | "Street"')

  await page.getByTestId('ai-paste').click()
  await page
    .getByTestId('ai-answer')
    .fill('Sure:\n```json\n{"1": "Anna", "2": "yes", "3": "Hauptstraße 1", "9": "x"}\n```')
  await page.getByTestId('ai-fill').click()
  await expect(page.getByTestId('ai-summary')).toHaveText('Filled 2 of 4')
  await expect(page.getByTestId('ai-error')).toHaveText([
    'Field 2: a tick was expected (true or false), got yes — skipped.',
    'There is no field 9 — skipped.'
  ])
  await page.getByTestId('ai-close').click()
  const value = (name: string) => page.locator(`[data-field-name="${name}"] input`)
  await expect(value('Name')).toHaveValue('Anna')
  await expect(value('Street')).toHaveValue('Hauptstraße 1')
  await expect(value('Agree')).not.toBeChecked()

  await page.getByTestId('undo').click()
  await expect(value('Name')).toHaveValue('')
  await expect(value('Street')).toHaveValue('')
  await expect(page.getByTestId('undo')).toBeDisabled()
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
