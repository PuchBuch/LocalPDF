import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import electronPath from 'electron'
import { PDFDocument } from 'pdf-lib'
import {
  answerFileDialog,
  answerSaveDialog,
  appEnvironment,
  launchApp,
  offeredSaveName,
  offeredSavePath,
  ROOT,
  writePdf
} from './harness'

const SAVE = 0
const DISCARD = 1
const CANCEL = 2

const ADD = 0
const REPLACE = 1

let directory: string
let app: ElectronApplication
let page: Page
let userData: string

const pages = () => page.getByTestId('pdf-page')
const statePath = () => join(userData, 'recovery', 'state.json')

async function start(options: Parameters<typeof launchApp>[0] = {}): Promise<void> {
  ;({ app, page, userData } = await launchApp(options))
}

/** Makes message boxes answer with this button, counting them and keeping their text. */
async function answerMessages(response: number): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    const record = globalThis as unknown as { messages?: string[] }
    record.messages ??= []
    dialog.showMessageBox = (async (...args: unknown[]) => {
      record.messages!.push((args.at(-1) as { message: string }).message)
      return { response: answer, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, response)
}

const messages = () => app.evaluate(() => (globalThis as unknown as { messages?: string[] }).messages ?? [])

async function openDocument(name = 'doc.pdf', ...labels: string[]): Promise<string> {
  const path = await writePdf(directory, name, (labels.length > 0 ? labels : ['Hello']).map((text) => ({ text })))
  await answerFileDialog(app, [path])
  await page.getByTestId('select-file').click()
  await expect(pages()).toHaveCount(labels.length || 1)
  return path
}

async function addText(text: string, x = 200, y = 300): Promise<void> {
  await page.getByTestId('tool-text').click()
  const box = (await pages().first().boundingBox())!
  await page.mouse.click(box.x + (x * box.width) / 595, box.y + (y * box.width) / 595)
  await page.keyboard.type(text)
  await page.getByTestId('tool-cursor').click()
}

/** Asks the window to close, as its close button does. */
const closeWindow = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())

const windowClosed = () => app.waitForEvent('close')

/** Waits until the document, with this text in it, is stored for recovery. */
async function storedWith(text: string): Promise<void> {
  await expect
    .poll(async () => (existsSync(statePath()) ? await readFile(statePath(), 'utf8') : ''), { timeout: 10_000 })
    .toContain(text)
}

async function crash(): Promise<void> {
  const process = app.process()
  const exited = new Promise((done) => process.once('exit', done))
  spawn('taskkill', ['/pid', String(process.pid), '/t', '/f'])
  await exited
  // The lock on the data folder is freed a moment after the processes have gone.
  await expect
    .poll(() => rm(join(userData, 'lockfile'), { force: true }).then(() => true, () => false), { timeout: 15_000 })
    .toBe(true)
}

/** Makes printing write what would reach the paper to a PDF, instead of showing the dialog. */
async function captureNextPrint(): Promise<void> {
  await app.evaluate(({ webContents }) => {
    const record = globalThis as unknown as { printed?: string }
    const contents = webContents.getAllWebContents()[0]!
    contents.print = ((_options: unknown, callback: (success: boolean, reason: string) => void) => {
      void contents.printToPDF({ preferCSSPageSize: true, printBackground: true }).then((data) => {
        record.printed = data.toString('base64')
        callback(true, '')
      })
    }) as typeof contents.print
  })
}

const printedPdf = async () =>
  Buffer.from(await app.evaluate(() => (globalThis as unknown as { printed: string }).printed), 'base64')

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'localpdf-e2e-session-'))
})

test.afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

test.afterEach(async () => {
  await app.close()
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
})

test.describe('closing the window', () => {
  test('goes straight away without changes', async () => {
    await start()
    await openDocument()
    await answerMessages(CANCEL)
    const closed = windowClosed()
    await closeWindow()
    await closed
  })

  test('Cancel keeps the window and the document', async () => {
    await start()
    await openDocument()
    await addText('Важное')
    await answerMessages(CANCEL)
    await closeWindow()
    await expect.poll(messages).toHaveLength(1)
    await expect(page.getByTestId('field')).toHaveCount(1)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  })

  test('Do not save closes and leaves nothing to restore', async () => {
    await start()
    await openDocument()
    await addText('Черновик')
    await storedWith('Черновик')
    await answerMessages(DISCARD)
    const closed = windowClosed()
    await closeWindow()
    await closed
    expect(existsSync(statePath())).toBe(false)
  })

  test('Save writes the file and then closes', async () => {
    await start()
    await openDocument()
    await addText('Сохрани меня')
    const path = join(directory, 'closed-with-save.pdf')
    await answerSaveDialog(app, path)
    await answerMessages(SAVE)
    const closed = windowClosed()
    await closeWindow()
    await closed
    expect((await PDFDocument.load(await readFile(path))).getPageCount()).toBe(1)
  })

  test('Save that is cancelled in its dialog keeps the window', async () => {
    await start()
    await openDocument()
    await addText('Не закрывать')
    await answerSaveDialog(app, null)
    await answerMessages(SAVE)
    await closeWindow()
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { offeredName?: string }).offeredName)).toBeTruthy()
    await page.waitForTimeout(300)
    await expect(page.getByTestId('field')).toHaveCount(1)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  })
})

test.describe('New file', () => {
  test('does not ask after a save, asks after a change made since', async () => {
    await start()
    await openDocument()
    await addText('Раз')
    await answerSaveDialog(app, join(directory, 'new-file.pdf'))
    await page.getByTestId('download').click()
    await expect(page.getByTestId('saved-note')).toBeVisible()
    await answerMessages(CANCEL)

    // Undoing past what was saved is a change too.
    await page.getByTestId('undo').click()
    await page.getByTestId('new-file').click()
    await expect.poll(messages).toHaveLength(1)

    await page.getByTestId('redo').click()
    await page.getByTestId('new-file').click()
    await expect(page.getByTestId('select-file')).toBeVisible()
    expect(await messages()).toHaveLength(1)
  })

  test('Save in its question saves, then closes the document', async () => {
    await start()
    await openDocument()
    await addText('Раз')
    const path = join(directory, 'new-file-saved.pdf')
    await answerSaveDialog(app, path)
    await answerMessages(SAVE)
    await page.getByTestId('new-file').click()
    await expect(page.getByTestId('select-file')).toBeVisible()
    expect(existsSync(path)).toBe(true)
  })
})

test.describe('recovery after a crash', () => {
  test('brings back the document with its fields and pages, marked as unsaved', async () => {
    await start()
    await openDocument('Отчёт.pdf', 'One', 'Two', 'Three')
    await addText('Восстанови меня')
    await page.getByTestId('delete-page').nth(2).click()
    await storedWith('Восстанови меня')
    await expect(pages()).toHaveCount(2)
    await page.waitForTimeout(2000)
    await crash()

    await start({ userData })
    await expect(page.getByTestId('recovery-dialog')).toContainText('Отчёт.pdf')
    await page.screenshot({ path: join(ROOT, 'samples', 'private', 'out', 'recovery-dialog.png') })
    await page.getByTestId('recovery-restore').click()
    await expect(page.getByTestId('recovery-dialog')).toHaveCount(0)
    await expect(pages()).toHaveCount(2)
    await expect(page.getByTestId('field')).toHaveCount(1)
    await expect(page.locator('[data-testid="field"] textarea, [data-testid="field"]').first()).toBeVisible()
    await expect.poll(() => page.title()).toBe('• Отчёт.pdf — LocalPDF')

    // It can be saved, with the restored field in the file.
    const path = join(directory, 'restored.pdf')
    await answerSaveDialog(app, path)
    await page.getByTestId('download').click()
    await expect(page.getByTestId('saved-note')).toBeVisible()
    expect(await offeredSaveName(app)).toBe('Отчёт-document.pdf')
    const saved = await PDFDocument.load(await readFile(path))
    expect(saved.getPageCount()).toBe(2)
    await expect.poll(() => page.title()).toBe('Отчёт.pdf — LocalPDF')

    // Once saved, there is nothing to restore next time.
    const closed = windowClosed()
    await closeWindow()
    await closed
    expect(existsSync(statePath())).toBe(false)
  })

  test('Delete starts empty and offers nothing the next time', async () => {
    await start()
    await openDocument()
    await addText('Лишнее')
    await storedWith('Лишнее')
    await crash()

    await start({ userData })
    await page.getByTestId('recovery-discard').click()
    await expect(page.getByTestId('recovery-dialog')).toHaveCount(0)
    await expect(page.getByTestId('select-file')).toBeVisible()
    await expect.poll(() => existsSync(statePath())).toBe(false)
  })

  test('closing the window without answering keeps the offer', async () => {
    await start()
    await openDocument()
    await addText('Не потеряй')
    await storedWith('Не потеряй')
    await crash()

    await start({ userData })
    await expect(page.getByTestId('recovery-dialog')).toBeVisible()
    const closed = windowClosed()
    await closeWindow()
    await closed

    await start({ userData })
    await expect(page.getByTestId('recovery-dialog')).toBeVisible()
  })

  test('survives a damaged folder', async () => {
    await start()
    await openDocument()
    await addText('Сломанный')
    await storedWith('Сломанный')
    await crash()
    await rm(join(userData, 'recovery', 'blobs'), { recursive: true })

    await start({ userData })
    await page.getByTestId('recovery-restore').click()
    await expect(page.getByTestId('notice')).toBeVisible()
    await expect(page.getByTestId('select-file')).toBeVisible()
    await expect.poll(() => existsSync(statePath())).toBe(false)
  })

  test('a document without changes is not stored at all', async () => {
    await start()
    await openDocument()
    await page.waitForTimeout(2500)
    expect(existsSync(statePath())).toBe(false)
  })

  test('undoing everything removes what was stored', async () => {
    await start()
    await openDocument()
    await addText('Передумал')
    await storedWith('Передумал')
    // Adding the field and typing into it are separate steps.
    while (await page.getByTestId('undo').isEnabled()) await page.getByTestId('undo').click()
    await expect.poll(() => existsSync(statePath()), { timeout: 10_000 }).toBe(false)
  })
})

test.describe('opening from outside', () => {
  test('opens a file given on the command line', async () => {
    const path = await writePdf(directory, 'Двойной щелчок.pdf', [{ text: 'One' }, { text: 'Two' }])
    await start({ files: [path] })
    await expect(pages()).toHaveCount(2)
    await expect.poll(() => page.title()).toBe('Двойной щелчок.pdf — LocalPDF')
  })

  test('reports a file on the command line that does not exist', async () => {
    await start({ files: [join(directory, 'нет такого.pdf')] })
    await expect(page.getByTestId('notice')).toContainText('нет такого.pdf')
    await expect(page.getByTestId('select-file')).toBeVisible()
  })

  test('the offer to restore comes before a file from the command line', async () => {
    await start()
    await openDocument()
    await addText('Старое')
    await storedWith('Старое')
    await crash()

    const path = await writePdf(directory, 'waiting.pdf', [{ text: 'Waiting' }])
    await start({ userData, files: [path] })
    await expect(page.getByTestId('recovery-dialog')).toBeVisible()
    await expect(pages()).toHaveCount(0)
    await page.getByTestId('recovery-discard').click()
    await expect(pages()).toHaveCount(1)
    await expect.poll(() => page.title()).toBe('waiting.pdf — LocalPDF')
  })

  /** Starts the app again, as a double-click does while it is open. It hands over and quits. */
  async function startSecondInstance(path: string): Promise<void> {
    const executable = process.env['LOCALPDF_E2E_EXE']
    const command = executable ?? (electronPath as unknown as string)
    const second = spawn(command, executable ? [path] : ['.', path], { cwd: ROOT, env: appEnvironment(userData) })
    await new Promise((done) => second.once('exit', done))
  }

  test('a second start hands its file to the empty window', async () => {
    await start()
    await page.getByTestId('select-file').waitFor()
    await startSecondInstance(await writePdf(directory, 'second.pdf', [{ text: 'Second' }]))
    await expect(pages()).toHaveCount(1)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  })

  test('a second start asks when a document is open: add, replace or keep', async () => {
    await start()
    await openDocument('first.pdf', 'One')

    await answerMessages(CANCEL)
    await startSecondInstance(await writePdf(directory, 'cancelled.pdf', [{ text: 'A' }, { text: 'B' }]))
    await expect.poll(messages).toHaveLength(1)
    expect((await messages())[0]).toContain('cancelled.pdf')
    await page.waitForTimeout(300)
    await expect(pages()).toHaveCount(1)

    await answerMessages(ADD)
    await startSecondInstance(await writePdf(directory, 'added.pdf', [{ text: 'C' }]))
    await expect(pages()).toHaveCount(2)

    // The add is a change, so replacing also asks about it. Button 1 is both Replace and Do not save.
    await answerMessages(REPLACE)
    await startSecondInstance(await writePdf(directory, 'replacing.pdf', [{ text: 'D' }, { text: 'E' }, { text: 'F' }]))
    await expect(pages()).toHaveCount(3)
    await expect.poll(() => page.title()).toBe('replacing.pdf — LocalPDF')
  })
})

test.describe('saving', () => {
  test('Ctrl+S saves, on any keyboard layout', async () => {
    await start()
    await openDocument()
    const path = join(directory, 'shortcut.pdf')
    await answerSaveDialog(app, path)
    await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 'ы', ctrlKey: true, cancelable: true }))
    )
    await expect(page.getByTestId('saved-note')).toBeVisible()
    expect(existsSync(path)).toBe(true)
  })

  test('the save dialog starts in the folder of the file, then in the last used one', async () => {
    await start()
    const path = await openDocument('folder.pdf')
    await answerSaveDialog(app, join(tmpdir(), 'localpdf-folder-test.pdf'))
    await page.getByTestId('download').click()
    await expect(page.getByTestId('saved-note')).toBeVisible()
    expect(await offeredSavePath(app)).toBe(join(directory, 'folder-document.pdf'))
    expect(path.startsWith(directory)).toBe(true)

    await page.getByTestId('download').click()
    await expect.poll(() => offeredSavePath(app)).toBe(join(tmpdir(), 'folder-document.pdf'))
    await rm(join(tmpdir(), 'localpdf-folder-test.pdf'), { force: true })
  })
})

test.describe('printing', () => {
  test('sends every page, with what was added, at its own size and turned', async () => {
    await start()
    await openDocument('print.pdf', 'One', 'Two', 'Three')
    await addText('Напечатай')
    await page.getByTestId('rotate-page').nth(1).click()
    await page.getByTestId('delete-page').nth(2).click()
    await expect(pages()).toHaveCount(2)

    await captureNextPrint()
    await page.getByTestId('more-download').click()
    await page.getByTestId('print-document').click()
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as unknown as { printed?: string }).printed))).toBe(true)

    const printed = await PDFDocument.load(await printedPdf())
    expect(printed.getPageCount()).toBe(2)
    const [first, second] = printed.getPages()
    expect(Math.round(first!.getWidth())).toBe(595)
    expect(Math.round(first!.getHeight())).toBe(842)
    expect(Math.round(second!.getWidth())).toBe(842)
    expect(Math.round(second!.getHeight())).toBe(595)

    // What was prepared for the paper is gone again, and the window still shows the document.
    await expect(page.getByTestId('print-root')).toHaveCount(0)
    await expect(pages()).toHaveCount(2)
    await expect(page.getByTestId('download')).toBeEnabled()

    // Keep a copy to look at.
    const outputFolder = join(ROOT, 'samples', 'private', 'out')
    await mkdir(outputFolder, { recursive: true })
    await writeFile(join(outputFolder, 'printed.pdf'), await printedPdf())
  })

  test('Ctrl+P starts printing, and a cancelled dialog is not a failure', async () => {
    await start()
    await openDocument()
    await app.evaluate(({ webContents }) => {
      const contents = webContents.getAllWebContents()[0]!
      contents.print = ((_options: unknown, callback: (success: boolean, reason: string) => void) => {
        ;(globalThis as unknown as { printCalled: boolean }).printCalled = true
        callback(false, 'Print job canceled')
      }) as typeof contents.print
    })
    await page.keyboard.press('Control+KeyP')
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { printCalled?: boolean }).printCalled)).toBe(true)
    await expect(page.getByTestId('download')).toBeEnabled()
    await expect(page.getByTestId('notice')).toHaveCount(0)
  })

  test('reports a printing failure', async () => {
    await start()
    await openDocument()
    await app.evaluate(({ webContents }) => {
      const contents = webContents.getAllWebContents()[0]!
      contents.print = ((_options: unknown, callback: (success: boolean, reason: string) => void) => {
        callback(false, 'Print job failed')
      }) as typeof contents.print
    })
    await page.getByTestId('more-download').click()
    await page.getByTestId('print-document').click()
    await expect(page.getByTestId('notice')).toContainText('печать')
  })
})

test.describe('extracting text as Markdown', () => {
  test('copies the text with the fields, leaving the real clipboard alone', async () => {
    await start()
    await openDocument('md.pdf', 'Source words')
    await addText('Вписанный текст')
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText = async (text: string) => {
        ;(globalThis as unknown as { copied: string }).copied = text
      }
    })
    await page.getByTestId('more-download').click()
    await page.getByTestId('copy-markdown').click()
    await expect(page.getByTestId('saved-note')).toHaveText('Текст скопирован в буфер обмена')
    const copied = await app.evaluate(() => (globalThis as unknown as { copied: string }).copied)
    expect(copied).toContain('Source words')
    expect(copied).toContain('Вписанный текст')
  })

  test('saves it as a .md file named after the document', async () => {
    await start()
    await openDocument('Заметки.pdf', 'Source words')
    const path = join(directory, 'notes.md')
    await answerSaveDialog(app, path)
    await page.getByTestId('more-download').click()
    await page.getByTestId('save-markdown').click()
    await expect(page.getByTestId('saved-note')).toHaveText('Сохранено: notes.md')
    expect(await offeredSaveName(app)).toBe('Заметки-document.md')
    expect(await readFile(path, 'utf8')).toContain('Source words')
  })

  test('extracting does not count as saving the document', async () => {
    await start()
    await openDocument()
    await addText('Ещё не сохранено')
    await answerSaveDialog(app, join(directory, 'not-a-save.md'))
    await page.getByTestId('more-download').click()
    await page.getByTestId('save-markdown').click()
    await expect(page.getByTestId('saved-note')).toBeVisible()
    await expect.poll(() => page.title()).toBe('• doc.pdf — LocalPDF')
  })

  test('the menu closes on a click elsewhere', async () => {
    await start()
    await openDocument()
    await page.getByTestId('more-download').click()
    await expect(page.getByTestId('print-document')).toBeVisible()
    await page.screenshot({ path: join(ROOT, 'samples', 'private', 'out', 'output-menu.png') })
    await page.getByTestId('page-counter').click()
    await expect(page.getByTestId('print-document')).toHaveCount(0)
  })
})
