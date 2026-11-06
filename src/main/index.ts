import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { openableArguments } from '../core/launchArguments'
import type { DialogTexts } from '../preload'
import { clearRecovery, clearRecoveryOnClose, readRecovery, recoveryAccepted, writeRecovery } from './recovery'

const DEV_URL = process.env['ELECTRON_RENDERER_URL']
const APP_HOST = 'local'
const RENDERER_ROOT = resolve(__dirname, '../renderer')

const LOCAL_PROTOCOLS = new Set(['app:', 'data:', 'blob:', 'devtools:'])

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf'
}

const SAVE_FILTERS: Record<string, Electron.FileFilter> = {
  '.pdf': { name: 'PDF', extensions: ['pdf'] },
  '.md': { name: 'Markdown', extensions: ['md'] }
}

// Tests give every run its own folder. It also decides which instance is the first one.
const userDataOverride = process.env['LOCALPDF_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

// A standard secure scheme gives the page a real origin. Module workers and
// fetch, which pdf.js needs, do not work from file://.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

/** Until the window has told its language, should a dialog be needed that early. */
let dialogTexts: DialogTexts = {
  unsavedMessage: 'Save changes before closing?',
  unsavedDetail: 'If you do not save, they will be lost.',
  save: 'Save',
  dontSave: 'Don’t save',
  cancel: 'Cancel',
  incomingMessage: 'Open {names}?',
  incomingDetail: 'Another document is open.',
  add: 'Add to the document',
  replace: 'Open instead',
  filesFilter: 'PDF and images'
}

let mainWindow: BrowserWindow | null = null
let unsavedChanges = false
let rendererReady = false
let startupPaths = openableArguments(process.argv.slice(1))
/** Where the save dialog starts: the folder last opened from or saved to. */
let lastDirectory: string | null = null

async function serveRendererFile(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = resolve(RENDERER_ROOT, `.${decodeURIComponent(url.pathname)}`)
  // URL.origin is the string "null" for a custom scheme, so the host is compared instead.
  if (url.host !== APP_HOST || !path.startsWith(RENDERER_ROOT + sep)) {
    return new Response(null, { status: 404 })
  }
  try {
    const contentType = CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
    return new Response(await readFile(path), { headers: { 'content-type': contentType } })
  } catch {
    return new Response(null, { status: 404 })
  }
}

function isLocalRequest(rawUrl: string): boolean {
  const url = new URL(rawUrl)
  if (LOCAL_PROTOCOLS.has(url.protocol)) return true
  if (DEV_URL === undefined) return false
  // Hot reload talks to the dev server over http and ws on the same host and port.
  return url.host === new URL(DEV_URL).host
}

function lockDownSession(): void {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isLocalRequest(details.url) })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

function showMessage(win: BrowserWindow | null, options: Electron.MessageBoxOptions) {
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
}

async function askUnsavedChanges(win: BrowserWindow | null): Promise<'save' | 'discard' | 'cancel'> {
  const { response } = await showMessage(win, {
    type: 'warning',
    title: 'LocalPDF',
    message: dialogTexts.unsavedMessage,
    detail: dialogTexts.unsavedDetail,
    buttons: [dialogTexts.save, dialogTexts.dontSave, dialogTexts.cancel],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  return (['save', 'discard', 'cancel'] as const)[response] ?? 'cancel'
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    title: 'LocalPDF',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  // A crashed interface cannot answer. What it last stored stays for the next start.
  let rendererGone = false
  win.webContents.on('render-process-gone', () => {
    rendererGone = true
  })

  let asking = false
  win.on('close', (event) => {
    if (rendererGone) return
    if (!unsavedChanges) {
      clearRecoveryOnClose()
      return
    }
    event.preventDefault()
    if (asking) return
    asking = true
    void askUnsavedChanges(win).then((answer) => {
      asking = false
      if (answer === 'save') win.webContents.send('window:save-and-close')
      if (answer === 'discard') {
        unsavedChanges = false
        win.close()
      }
    })
  })
  win.on('closed', () => {
    mainWindow = null
  })

  void win.loadURL(DEV_URL ?? `app://${APP_HOST}/index.html`)

  return win
}

/** A file that cannot be read still comes through empty, for the interface to report it. */
function readOpenedFiles(paths: string[]) {
  return Promise.all(
    paths.map(async (path) => {
      lastDirectory = dirname(path)
      const bytes = await readFile(path).catch(() => new Uint8Array())
      return { name: basename(path), bytes }
    })
  )
}

// LOCALPDF_LOCALE lets a test run in a language whatever the computer it runs on.
ipcMain.handle('app:system-locale', () => process.env['LOCALPDF_LOCALE'] ?? app.getLocale())

ipcMain.on('app:set-dialog-texts', (_event, texts: DialogTexts) => {
  dialogTexts = texts
})

ipcMain.handle('files:choose', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: dialogTexts.filesFilter, extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif'] }]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled) return []
  return readOpenedFiles(result.filePaths)
})

ipcMain.handle('files:take-startup', () => {
  rendererReady = true
  const paths = startupPaths
  startupPaths = []
  return readOpenedFiles(paths)
})

ipcMain.handle('document:ask-unsaved', (event) => askUnsavedChanges(BrowserWindow.fromWebContents(event.sender)))

ipcMain.handle('document:ask-incoming', async (event, names: string[]) => {
  const { response } = await showMessage(BrowserWindow.fromWebContents(event.sender), {
    type: 'question',
    title: 'LocalPDF',
    message: dialogTexts.incomingMessage.replace('{names}', names.join(', ')),
    detail: dialogTexts.incomingDetail,
    buttons: [dialogTexts.add, dialogTexts.replace, dialogTexts.cancel],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  return (['add', 'replace', 'cancel'] as const)[response] ?? 'cancel'
})

ipcMain.on('document:set-unsaved', (_event, unsaved: boolean) => {
  unsavedChanges = unsaved
})

ipcMain.handle('window:close', (event) => {
  unsavedChanges = false
  BrowserWindow.fromWebContents(event.sender)?.close()
})

ipcMain.handle('file:save', async (event, suggestedName: string, bytes: Uint8Array) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const filter = SAVE_FILTERS[extname(suggestedName).toLowerCase()]
  const options: Electron.SaveDialogOptions = {
    defaultPath: lastDirectory ? join(lastDirectory, suggestedName) : suggestedName,
    filters: filter ? [filter] : []
  }
  const { canceled, filePath } = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return { status: 'canceled' }

  // Writing beside the target and renaming means a failure cannot damage an existing file.
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, bytes)
    await rename(temporaryPath, filePath)
    lastDirectory = dirname(filePath)
    return { status: 'saved', name: basename(filePath) }
  } catch (error) {
    console.error(error)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    return { status: 'failed' }
  }
})

ipcMain.handle(
  'document:print',
  (event) =>
    new Promise((done) => {
      event.sender.print({ silent: false, printBackground: true }, (success, reason) => {
        if (success) done('printed')
        else done(/cancel/i.test(reason) ? 'canceled' : 'failed')
      })
    })
)

ipcMain.handle('clipboard:write-text', (_event, text: string) => clipboard.writeText(text))

ipcMain.handle('recovery:read', () => readRecovery())
ipcMain.handle('recovery:write', (_event, state: string, newBlobs: Record<string, Uint8Array>, keptBlobs: string[]) =>
  writeRecovery(state, newBlobs, keptBlobs)
)
ipcMain.handle('recovery:clear', () => clearRecovery())
ipcMain.handle('recovery:accepted', () => recoveryAccepted())

/** A second start of the app only hands its files over to the window already open. */
async function receiveFromSecondInstance(argv: string[], workingDirectory: string): Promise<void> {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
  const paths = openableArguments(argv.slice(1)).map((path) => resolve(workingDirectory, path))
  if (paths.length === 0) return
  if (!rendererReady || !mainWindow) {
    startupPaths.push(...paths)
    return
  }
  mainWindow.webContents.send('files:incoming', await readOpenedFiles(paths))
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', (_event, argv, workingDirectory) => void receiveFromSecondInstance(argv, workingDirectory))

  void app.whenReady().then(() => {
    // The default menu has Reload, which would throw away the open document.
    if (app.isPackaged) Menu.setApplicationMenu(null)
    protocol.handle('app', serveRendererFile)
    lockDownSession()
    mainWindow = createWindow()
  })

  app.on('window-all-closed', () => app.quit())
} else {
  app.quit()
}
