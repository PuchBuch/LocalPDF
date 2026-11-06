import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'

export const ROOT = resolve(__dirname, '..')

/** The environment of a run. Its own data folder keeps it off the data of an installed app. */
export function appEnvironment(userData: string, locale = 'ru'): Record<string, string> {
  const env = { ...process.env, LOCALPDF_USER_DATA: userData, LOCALPDF_LOCALE: locale } as Record<string, string>
  delete env['ELECTRON_RUN_AS_NODE']
  return env
}

export interface LaunchOptions {
  /** Reuse this data folder, as starting the app again does. */
  userData?: string
  /** Files on the command line, as a double-click passes them. */
  files?: string[]
  /** The system's language as the app sees it. Most tests read Russian texts. */
  locale?: string
}

export async function launchApp({ userData, files = [], locale }: LaunchOptions = {}): Promise<{
  app: ElectronApplication
  page: Page
  userData: string
}> {
  const dataFolder = userData ?? (await mkdtemp(join(tmpdir(), 'localpdf-e2e-')))
  const env = appEnvironment(dataFolder, locale)
  // LOCALPDF_E2E_EXE runs the same checks against a packaged build.
  const executablePath = process.env['LOCALPDF_E2E_EXE']
  const app = await electron.launch(
    executablePath ? { executablePath, args: files, env } : { args: ['.', ...files], cwd: ROOT, env }
  )

  // Tests end with changes left unsaved, and closing must not stop to ask about them.
  const close = app.close.bind(app)
  app.close = async () => {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
      })
      .catch(() => undefined)
    await close().catch(() => undefined)
  }
  return { app, page: await app.firstWindow(), userData: dataFolder }
}

export async function writePdf(
  directory: string,
  name: string,
  pages: { text: string; rotate?: number }[]
): Promise<string> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  for (const { text, rotate } of pages) {
    const pdfPage = document.addPage([595, 842])
    pdfPage.drawText(text, { x: 60, y: 760, font, size: 24 })
    if (rotate) pdfPage.setRotation(degrees(rotate))
  }
  const path = join(directory, name)
  await writeFile(path, await document.save())
  return path
}

/** Makes the next file dialog answer with these paths, without showing it. */
export async function answerFileDialog(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as typeof dialog.showOpenDialog
  }, paths)
}

/** Makes the next save dialog answer with this path, without showing it. Records the name it was offered. */
export async function answerSaveDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      const options = args.at(-1) as { defaultPath?: string }
      const offered = globalThis as unknown as { offeredName?: string; offeredPath?: string }
      offered.offeredPath = options.defaultPath
      offered.offeredName = options.defaultPath?.split(/[\\/]/).at(-1)
      return target === null ? { canceled: true, filePath: '' } : { canceled: false, filePath: target }
    }) as typeof dialog.showSaveDialog
  }, filePath)
}

export function offeredSaveName(app: ElectronApplication): Promise<string | undefined> {
  return app.evaluate(() => (globalThis as unknown as { offeredName?: string }).offeredName)
}

export function offeredSavePath(app: ElectronApplication): Promise<string | undefined> {
  return app.evaluate(() => (globalThis as unknown as { offeredPath?: string }).offeredPath)
}

export async function dropFile(page: Page, name: string, mime: string, bytes: Uint8Array): Promise<void> {
  await page.evaluate(
    ({ name, mime, content }) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(content)], name, { type: mime }))
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    },
    { name, mime, content: Array.from(bytes) }
  )
}

/** The box around the dark pixels of a PNG. */
export async function inkBox(png: Buffer) {
  const image = await loadImage(png)
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const { data } = context.getImageData(0, 0, image.width, image.height)
  let left = Infinity
  let top = Infinity
  let right = -1
  let bottom = -1
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (data[(y * image.width + x) * 4]! < 110) {
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
      }
    }
  }
  return { left, top, right, bottom }
}

/**
 * The promise of the editor: what is on screen is what lands in the file. The same
 * spot of the first page, given in points, is photographed in the editor and after
 * opening the saved PDF in the app.
 */
export async function expectSavedMatchesScreen(
  app: ElectronApplication,
  page: Page,
  path: string,
  area: { x: number; y: number; width: number; height: number }
): Promise<void> {
  const pages = page.getByTestId('pdf-page')
  const shoot = async () => {
    const box = (await pages.first().boundingBox())!
    const scale = box.width / 595
    return inkBox(
      await page.screenshot({
        clip: {
          x: box.x + area.x * scale,
          y: box.y + area.y * scale,
          width: area.width * scale,
          height: area.height * scale
        }
      })
    )
  }

  await page.getByTestId('tool-cursor').click()
  const onScreen = await shoot()
  expect(onScreen.right).toBeGreaterThan(0)

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
  await expect(pages).toHaveCount(1)
  await expect(page.locator('.page-canvas canvas')).toHaveCount(1)
  await page.waitForTimeout(300)

  const inFile = await shoot()
  const tolerance = 2
  expect(Math.abs(inFile.left - onScreen.left), `left ${inFile.left} vs ${onScreen.left}`).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(inFile.top - onScreen.top), `top ${inFile.top} vs ${onScreen.top}`).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(inFile.right - onScreen.right), `right ${inFile.right} vs ${onScreen.right}`).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(inFile.bottom - onScreen.bottom), `bottom ${inFile.bottom} vs ${onScreen.bottom}`).toBeLessThanOrEqual(tolerance)
}

/** True when the canvas of a page has dark ink on it. */
export function canvasHasInk(host: Page, index: number): Promise<boolean> {
  return host.evaluate((position) => {
    const canvas = document.querySelectorAll<HTMLElement>('[data-testid="pdf-page"]')[position]?.querySelector('canvas')
    if (!canvas || canvas.width === 0) return false
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset]! < 80) return true
    }
    return false
  }, index)
}

/** RGB at a spot of a page's canvas, given as fractions of its width and height. */
export function canvasColorAt(host: Page, index: number, x: number, y: number): Promise<number[] | null> {
  return host.evaluate(
    ({ index, x, y }) => {
      const canvas = document.querySelectorAll<HTMLElement>('[data-testid="pdf-page"]')[index]?.querySelector('canvas')
      if (!canvas || canvas.width === 0) return null
      const pixel = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1)
      return Array.from(pixel.data).slice(0, 3)
    },
    { index, x, y }
  )
}
