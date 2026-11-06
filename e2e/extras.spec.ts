import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { decryptPdf, encryptPdf } from '../src/export/qpdf'
import { answerFileDialog, answerSaveDialog, launchApp, ROOT, writePdf } from './harness'

const WASM = createRequire(__filename).resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm')
const OUT = join(ROOT, 'samples', 'private', 'out')

let directory: string
let app: ElectronApplication
let page: Page
let userData: string

const pages = () => page.getByTestId('pdf-page')
const fields = () => page.getByTestId('field')

async function open(...paths: string[]): Promise<void> {
  await answerFileDialog(app, paths)
  await page.getByTestId(paths.length > 0 && (await page.getByTestId('select-file').count()) > 0 ? 'select-file' : 'add-pages').click()
}

async function openPages(...labels: string[]): Promise<void> {
  await open(await writePdf(directory, 'doc.pdf', labels.map((text) => ({ text }))))
  await expect(pages()).toHaveCount(labels.length)
}

/** Writes a PDF with this password. */
async function writeLocked(name: string, password: string, ...labels: string[]): Promise<string> {
  const plain = await writePdf(directory, `plain-${name}`, labels.map((text) => ({ text })))
  const path = join(directory, name)
  await writeFile(path, await encryptPdf(WASM, new Uint8Array(await readFile(plain)), password))
  return path
}

async function clickPage(x: number, y: number, index = 0): Promise<void> {
  const box = (await pages().nth(index).boundingBox())!
  const scale = box.width / 595
  await page.mouse.click(box.x + x * scale, box.y + y * scale)
}

async function addText(x: number, y: number, text: string, index = 0): Promise<void> {
  await page.getByTestId('tool-text').click()
  await clickPage(x, y, index)
  await page.keyboard.type(text)
}

/** A field's position on its page, in points. */
async function fieldPlace(index: number) {
  const pageBox = (await pages().first().boundingBox())!
  const box = (await fields().nth(index).boundingBox())!
  const scale = pageBox.width / 595
  return { x: (box.x - pageBox.x) / scale, y: (box.y - pageBox.y) / scale }
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'localpdf-e2e-extras-'))
})

test.afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

test.beforeEach(async () => {
  ;({ app, page, userData } = await launchApp())
  await page.getByTestId('select-file').waitFor()
})

test.afterEach(async () => {
  await app.close()
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
})

test.describe('PDF with a password', () => {
  const dialog = () => page.getByTestId('password-dialog')
  const input = () => page.getByTestId('password-input')

  async function save(name: string): Promise<Uint8Array> {
    const path = join(directory, name)
    await answerSaveDialog(app, path)
    await page.getByTestId('download').click()
    await expect(page.getByTestId('saved-note')).toBeVisible()
    return new Uint8Array(await readFile(path))
  }

  test('asks, refuses a wrong password, then opens with the right one', async () => {
    await open(await writeLocked('locked.pdf', 'верный', 'Secret page', 'Second'))
    await expect(dialog()).toContainText('locked.pdf')
    await expect(page.getByTestId('password-unlock')).toBeDisabled()
    await expect(input()).toBeFocused()

    await input().fill('неверный')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('password-error')).toHaveText('Неверный пароль. Попробуйте ещё раз.')
    await expect(input()).toHaveValue('')
    await expect(pages()).toHaveCount(0)
    await page.screenshot({ path: join(OUT, 'password-dialog.png') })

    await input().fill('верный')
    await page.getByTestId('password-unlock').click()
    await expect(pages()).toHaveCount(2)
    await expect(dialog()).toHaveCount(0)
    await expect(page.locator('.textLayer').first()).toContainText('Secret page')
  })

  test('Keep password: the saved file needs the same password, with what was added', async () => {
    await open(await writeLocked('keep.pdf', 'секрет', 'Kept'))
    await expect(page.getByTestId('password-keep')).toBeChecked()
    await expect(page.getByTestId('password-keep-hint')).toContainText('останется')
    await input().fill('секрет')
    await page.keyboard.press('Enter')
    await expect(pages()).toHaveCount(1)
    await addText(100, 300, 'Added')

    const saved = await save('kept-saved.pdf')
    expect(await decryptPdf(WASM, saved, '')).toBeNull()
    expect(await decryptPdf(WASM, saved, 'чужой')).toBeNull()
    const plain = await decryptPdf(WASM, saved, 'секрет')
    expect((await PDFDocument.load(plain!)).getPageCount()).toBe(1)

    // The app opens what it has saved.
    await page.getByTestId('new-file').click()
    await open(join(directory, 'kept-saved.pdf'))
    await input().fill('секрет')
    await page.keyboard.press('Enter')
    await expect(pages()).toHaveCount(1)
    await expect(page.locator('.textLayer').first()).toContainText('Added')
  })

  test('without Keep password the saved file opens freely', async () => {
    await open(await writeLocked('free.pdf', 'секрет', 'Freed'))
    await page.getByTestId('password-keep').uncheck()
    await expect(page.getByTestId('password-keep-hint')).toContainText('не будет')
    await input().fill('секрет')
    await page.keyboard.press('Enter')
    await expect(pages()).toHaveCount(1)
    await addText(100, 300, 'Added')

    const saved = await save('freed-saved.pdf')
    expect((await PDFDocument.load(saved)).getPageCount()).toBe(1)
  })

  test('Cancel opens nothing and shows no error', async () => {
    await open(await writeLocked('cancel.pdf', 'секрет', 'Nope'))
    await page.getByTestId('password-cancel').click()
    await expect(dialog()).toHaveCount(0)
    await expect(pages()).toHaveCount(0)
    await expect(page.getByTestId('select-file')).toBeEnabled()
    await expect(page.getByTestId('notice')).toHaveCount(0)
  })

  test('Esc cancels too', async () => {
    await open(await writeLocked('escape.pdf', 'секрет', 'Nope'))
    await input().focus()
    await page.keyboard.press('Escape')
    await expect(dialog()).toHaveCount(0)
    await expect(pages()).toHaveCount(0)
  })

  test('adding a protected file to an open document, and the output stays protected', async () => {
    await openPages('Open one')
    await open(await writeLocked('added.pdf', 'секрет', 'Protected'))
    await input().fill('секрет')
    await page.keyboard.press('Enter')
    await expect(pages()).toHaveCount(2)

    const saved = await save('merged.pdf')
    expect(await decryptPdf(WASM, saved, '')).toBeNull()
    expect((await PDFDocument.load((await decryptPdf(WASM, saved, 'секрет'))!)).getPageCount()).toBe(2)
  })

  test('a file that only restricts editing opens and saves without asking', async () => {
    await open(await writeLocked('restricted.pdf', '', 'Restricted'))
    await expect(pages()).toHaveCount(1)
    await expect(dialog()).toHaveCount(0)
    const saved = await save('restricted-saved.pdf')
    expect((await PDFDocument.load(saved)).getPageCount()).toBe(1)
  })

  test('what came from a protected file is not left on disk for recovery', async () => {
    const state = join(userData, 'recovery', 'state.json')
    await openPages('Plain')
    await addText(100, 300, 'Stored')
    await expect.poll(() => existsSync(state), { timeout: 10_000 }).toBe(true)

    await open(await writeLocked('private.pdf', 'секрет', 'Private'))
    await input().fill('секрет')
    await page.keyboard.press('Enter')
    await expect(pages()).toHaveCount(2)
    await expect.poll(() => existsSync(state), { timeout: 10_000 }).toBe(false)

    await addText(100, 400, 'More', 0)
    await page.waitForTimeout(2500)
    expect(existsSync(join(userData, 'recovery'))).toBe(false)
  })
})

test.describe('thumbnail menu', () => {
  const thumbnail = (index: number) => page.getByTestId('page-thumbnail').nth(index)
  const openMenu = (index: number) => thumbnail(index).click({ button: 'right' })
  const menu = () => page.getByTestId('thumbnail-menu')

  test('counts the added fields of that page, and not the others', async () => {
    await openPages('One', 'Two')
    await addText(100, 200, 'a')
    await addText(100, 300, 'b')
    await page.getByTestId('tool-cursor').click()

    await openMenu(0)
    await expect(page.getByTestId('clear-fields')).toHaveText('Очистить поля (2)')
    await expect(page.getByTestId('delete-fields')).toHaveText('Удалить поля (2)')
    await page.screenshot({ path: join(OUT, 'thumbnail-menu.png') })

    await page.keyboard.press('Escape')
    await expect(menu()).toHaveCount(0)

    await openMenu(1)
    await expect(page.getByTestId('clear-fields')).toBeDisabled()
    await expect(page.getByTestId('delete-fields')).toBeDisabled()
  })

  test('uses the singular for one field', async () => {
    await openPages('One')
    await addText(100, 200, 'a')
    await page.getByTestId('tool-cursor').click()
    await openMenu(0)
    await expect(page.getByTestId('clear-fields')).toHaveText('Очистить поле (1)')
    await expect(page.getByTestId('delete-fields')).toHaveText('Удалить поле (1)')
  })

  test('Clear empties fields and leaves them, as one step to undo', async () => {
    await openPages('One', 'Two')
    await addText(100, 200, 'Текст')
    await page.getByTestId('tool-checkbox').click()
    await clickPage(100, 300)
    await page.getByTestId('tool-cursor').click()

    await openMenu(0)
    await page.getByTestId('clear-fields').click()
    await expect(menu()).toHaveCount(0)
    await expect(fields()).toHaveCount(2)
    await expect(page.getByTestId('field-input')).toHaveValue('')
    await expect(page.getByTestId('field-checkbox')).toHaveAttribute('data-value', 'empty')

    await page.getByTestId('undo').click()
    await expect(page.getByTestId('field-input')).toHaveValue('Текст')
    await expect(page.getByTestId('field-checkbox')).toHaveAttribute('data-value', 'tick')
  })

  test('Delete removes fields of that page only, as one step to undo', async () => {
    await openPages('One', 'Two')
    await addText(100, 200, 'a')
    await addText(100, 300, 'b')
    await page.getByTestId('tool-cursor').click()
    await pages().nth(1).scrollIntoViewIfNeeded()
    await addText(100, 200, 'c', 1)
    await page.getByTestId('tool-cursor').click()
    await expect(fields()).toHaveCount(3)

    await openMenu(0)
    await page.getByTestId('delete-fields').click()
    await expect(fields()).toHaveCount(1)
    await expect(page.getByTestId('field-input')).toHaveValue('c')

    await page.getByTestId('undo').click()
    await expect(fields()).toHaveCount(3)
  })

  test('copies the content of one page or of all, leaving the real clipboard alone', async () => {
    await openPages('Alpha', 'Beta')
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText = async (text: string) => {
        ;(globalThis as unknown as { copied: string }).copied = text
      }
    })
    const copied = () => app.evaluate(() => (globalThis as unknown as { copied?: string }).copied)

    await openMenu(1)
    await page.getByTestId('copy-content').hover()
    await page.getByTestId('copy-content-this').click()
    await expect.poll(copied).toContain('Beta')
    expect(await copied()).not.toContain('Alpha')
    await expect(page.getByTestId('saved-note')).toBeVisible()

    await openMenu(0)
    await page.getByTestId('copy-content').click()
    await page.getByTestId('copy-content-all').click()
    await expect.poll(copied).toContain('Alpha')
    expect(await copied()).toContain('Beta')
  })

  test('does not touch the values of a form in the file', async () => {
    const form = await PDFDocument.create()
    const formPage = form.addPage([595, 842])
    const field = form.getForm().createTextField('name')
    field.setText('From the file')
    field.addToPage(formPage, { x: 50, y: 700, width: 300, height: 24 })
    const path = join(directory, 'form.pdf')
    await writeFile(path, await form.save())
    await open(path)
    await expect(pages()).toHaveCount(1)
    await page.getByTestId('form-text').fill('Entered')

    await openMenu(0)
    await expect(page.getByTestId('clear-fields')).toBeDisabled()
    await expect(page.getByTestId('delete-fields')).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('form-text')).toHaveValue('Entered')
  })

  test('stays fully on screen near the bottom of the window', async () => {
    await openPages('One')
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await page.evaluate(
      ({ height }) =>
        document
          .querySelector('[data-testid="page-thumbnail"]')!
          .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: height - 5 })),
      size
    )
    const box = (await menu().boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(size.height)
  })
})

test.describe('lining up while dragging', () => {
  /** Drags the focused field's handle by this much, in points, without letting go yet. */
  async function startDrag(deltaX: number, deltaY: number, modifiers: { shift?: boolean } = {}) {
    const handle = (await page.getByTestId('field-grab-handle').boundingBox())!
    const pageBox = (await pages().first().boundingBox())!
    const scale = pageBox.width / 595
    const startX = handle.x + handle.width / 2
    const startY = handle.y + handle.height / 2
    if (modifiers.shift) await page.keyboard.down('Shift')
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + deltaX * scale, startY + deltaY * scale, { steps: 4 })
  }

  async function finishDrag() {
    await page.mouse.up()
    await page.keyboard.up('Shift')
  }

  test('lines up with a neighbour, shows the line and the hint, and commits there', async () => {
    await openPages('One')
    await addText(100, 200, 'Первое поле')
    await addText(300, 400, 'Второе')
    const first = await fieldPlace(0)
    const second = await fieldPlace(1)

    // 3 points short of the first field's left edge.
    await startDrag(first.x - second.x + 3, 0)
    await expect(page.getByTestId('move-banner')).toContainText('Shift')
    await expect(page.getByTestId('snap-guide').first()).toBeVisible()
    await page.screenshot({ path: join(OUT, 'snap-guide.png') })
    await finishDrag()

    await expect(page.getByTestId('move-banner')).toHaveCount(0)
    await expect(page.getByTestId('snap-guide')).toHaveCount(0)
    expect(Math.abs((await fieldPlace(1)).x - first.x)).toBeLessThan(0.01)
  })

  test('Shift turns it off', async () => {
    await openPages('One')
    await addText(100, 200, 'Первое поле')
    await addText(300, 400, 'Второе')
    const first = await fieldPlace(0)
    const second = await fieldPlace(1)

    await startDrag(first.x - second.x + 3, 0, { shift: true })
    await expect(page.getByTestId('snap-guide')).toHaveCount(0)
    await finishDrag()
    expect((await fieldPlace(1)).x - first.x).toBeGreaterThan(1.5)
  })

  test('a drag far from any neighbour lands where the pointer does', async () => {
    await openPages('One')
    await addText(100, 200, 'Первое поле')
    await addText(300, 400, 'Второе')
    const second = await fieldPlace(1)
    await startDrag(50, 80)
    await expect(page.getByTestId('snap-guide')).toHaveCount(0)
    await finishDrag()
    const moved = await fieldPlace(1)
    expect(Math.abs(moved.x - (second.x + 50))).toBeLessThanOrEqual(1)
    expect(Math.abs(moved.y - (second.y + 80))).toBeLessThanOrEqual(1)
  })

  test('the move is one undo step', async () => {
    await openPages('One')
    await addText(100, 200, 'Первое поле')
    await addText(300, 400, 'Второе')
    const second = await fieldPlace(1)
    await startDrag(0, -190)
    await finishDrag()
    await page.getByTestId('undo').click()
    const back = await fieldPlace(1)
    expect(Math.abs(back.y - second.y)).toBeLessThan(0.5)
  })
})
