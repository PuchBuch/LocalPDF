import type {
  DialogTexts,
  IncomingAnswer,
  LocalPdfApi,
  OpenedFile,
  PrintResult,
  SaveResult,
  StoredRecovery,
  UnsavedAnswer
} from '../preload'

/**
 * What the Electron process does for the desktop app, done with what a browser tab
 * offers. Everything stays in the tab and the browser's own storage: the extension asks
 * for no permissions and has no way to reach a network.
 */

const DATABASE = 'localpdf'
const STATE_STORE = 'state'
const BLOB_STORE = 'blobs'
const STATE_KEY = 'state'

const PICKER_TYPES: Record<string, { description: string; accept: Record<string, string[]> }> = {
  pdf: { description: 'PDF', accept: { 'application/pdf': ['.pdf'] } },
  md: { description: 'Markdown', accept: { 'text/markdown': ['.md'] } }
}

let dialogTexts: DialogTexts | null = null
let unsavedChanges = false

window.addEventListener('beforeunload', (event) => {
  if (unsavedChanges) event.preventDefault()
})

/** A question with several answers, drawn as the app's other dialogs are. Resolves with the index pressed. */
function askChoice(message: string, detail: string, buttons: string[]): Promise<number> {
  return new Promise((done) => {
    const backdrop = document.createElement('div')
    backdrop.className = 'dialog-backdrop'
    backdrop.dataset['testid'] = 'choice-dialog'
    const dialog = document.createElement('div')
    dialog.className = 'dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const title = document.createElement('h2')
    title.className = 'dialog-title'
    title.textContent = message
    const text = document.createElement('p')
    text.className = 'dialog-text'
    text.textContent = detail
    const actions = document.createElement('div')
    actions.className = 'dialog-actions'

    const answer = (index: number) => {
      window.removeEventListener('keydown', onKeyDown, true)
      backdrop.remove()
      done(index)
    }
    // Esc is the last answer, which is always the one that changes nothing.
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      answer(buttons.length - 1)
    }
    window.addEventListener('keydown', onKeyDown, true)

    buttons.forEach((label, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.dataset['testid'] = `choice-${index}`
      if (index === 0) button.className = 'primary'
      button.addEventListener('click', () => answer(index))
      actions.append(button)
    })

    dialog.append(title, text, actions)
    backdrop.append(dialog)
    document.body.append(backdrop)
    actions.querySelector('button')?.focus()
  })
}

function chooseFiles(): Promise<OpenedFile[]> {
  return new Promise((done) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = '.pdf,.jpg,.jpeg,.png,.webp,.gif'
    input.addEventListener('cancel', () => done([]))
    input.addEventListener('change', () => {
      void Promise.all(
        Array.from(input.files ?? [], async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))
      ).then(done)
    })
    input.click()
  })
}

function downloadFile(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

interface FilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<{ name: string; createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>
}

async function saveFile(suggestedName: string, bytes: Uint8Array): Promise<SaveResult> {
  const type = PICKER_TYPES[suggestedName.split('.').pop()?.toLowerCase() ?? '']
  const blob = new Blob([bytes as BlobPart], { type: Object.keys(type?.accept ?? {})[0] ?? 'application/octet-stream' })
  const picker = (window as unknown as FilePickerWindow).showSaveFilePicker
  if (picker) {
    try {
      const handle = await picker.call(window, { suggestedName, types: type ? [type] : [] })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return { status: 'saved', name: handle.name }
    } catch (error) {
      const name = (error as DOMException).name
      if (name === 'AbortError') return { status: 'canceled' }
      // Building a large PDF can outlast the click that asked for it, and the browser then
      // refuses the picker. A plain download needs no such click.
      if (name !== 'SecurityError' && name !== 'NotAllowedError') {
        console.error(error)
        return { status: 'failed' }
      }
    }
  }
  downloadFile(suggestedName, blob)
  return { status: 'saved', name: suggestedName }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.append(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    if (!copied) throw new Error('The text could not be copied')
  }
}

/* Recovery after a crash, kept in the browser's own storage. */

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STATE_STORE)
      request.result.createObjectStore(BLOB_STORE)
    }
    request.onsuccess = () => done(request.result)
    request.onerror = () => fail(request.error)
  })
}

async function transaction<T>(
  mode: IDBTransactionMode,
  work: (state: IDBObjectStore, blobs: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  const database = await openDatabase()
  try {
    return await new Promise((done, fail) => {
      const run = database.transaction([STATE_STORE, BLOB_STORE], mode)
      const request = work(run.objectStore(STATE_STORE), run.objectStore(BLOB_STORE))
      run.oncomplete = () => done(request ? request.result : undefined)
      run.onerror = () => fail(run.error)
      run.onabort = () => fail(run.error)
    })
  } finally {
    database.close()
  }
}

async function readRecovery(): Promise<StoredRecovery | null> {
  const state = await transaction<string>('readonly', (stateStore) => stateStore.get(STATE_KEY))
  if (typeof state !== 'string') return null
  const keys = (await transaction<IDBValidKey[]>('readonly', (_, blobs) => blobs.getAllKeys())) ?? []
  const values = (await transaction<Uint8Array[]>('readonly', (_, blobs) => blobs.getAll())) ?? []
  return { state, blobs: Object.fromEntries(keys.map((key, index) => [String(key), values[index]!])) }
}

async function writeRecovery(state: string, newBlobs: Record<string, Uint8Array>, keptBlobs: string[]): Promise<void> {
  const kept = new Set(keptBlobs)
  const existing = (await transaction<IDBValidKey[]>('readonly', (_, blobs) => blobs.getAllKeys())) ?? []
  await transaction('readwrite', (stateStore, blobs) => {
    for (const [name, bytes] of Object.entries(newBlobs)) blobs.put(bytes, name)
    for (const key of existing) if (!kept.has(String(key))) blobs.delete(key)
    stateStore.put(state, STATE_KEY)
  })
}

async function clearRecovery(): Promise<void> {
  await transaction('readwrite', (stateStore, blobs) => {
    stateStore.clear()
    blobs.clear()
  })
}

const bridge: LocalPdfApi = {
  systemLocale: () => Promise.resolve(navigator.language),
  setDialogTexts: (texts) => {
    dialogTexts = texts
  },
  chooseFiles,
  // A tab has no command line to be given files on.
  takeStartupFiles: () => Promise.resolve([]),
  onIncomingFiles: () => undefined,
  askUnsavedChanges: async (): Promise<UnsavedAnswer> => {
    const { unsavedMessage, unsavedDetail, save, dontSave, cancel } = dialogTexts!
    const answer = await askChoice(unsavedMessage, unsavedDetail, [save, dontSave, cancel])
    return (['save', 'discard', 'cancel'] as const)[answer] ?? 'cancel'
  },
  askIncomingFiles: async (names): Promise<IncomingAnswer> => {
    const { incomingMessage, incomingDetail, add, replace, cancel } = dialogTexts!
    const answer = await askChoice(incomingMessage.replace('{names}', names.join(', ')), incomingDetail, [add, replace, cancel])
    return (['add', 'replace', 'cancel'] as const)[answer] ?? 'cancel'
  },
  setUnsavedChanges: (unsaved) => {
    unsavedChanges = unsaved
  },
  // Closing a tab asks through the browser's own question, so nothing starts from outside.
  onSaveAndClose: () => undefined,
  closeWindow: () => {
    unsavedChanges = false
    window.close()
    return Promise.resolve()
  },
  saveFile,
  print: (): Promise<PrintResult> => {
    // The browser does not say whether the dialog ended in printing or in Cancel.
    window.print()
    return Promise.resolve('printed')
  },
  copyText,
  readRecovery,
  writeRecovery,
  clearRecovery,
  recoveryAccepted: () => Promise.resolve()
}

window.localpdf = bridge
