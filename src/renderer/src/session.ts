import { hasUnsavedChanges } from '../../core/history'
import { blobsOf, fromSnapshot, parseSnapshot, toSnapshot, type RecoverySnapshot } from '../../core/recovery'
import type { OpenedFile, StoredRecovery } from '../../preload'
import { t } from './i18n'
import { addNotice, requestNewFile, restoreDocument, saveDocument, useEditor } from './store'

/** How long after the last change the document is stored for recovery. */
const AUTOSAVE_DELAY_MS = 1500

let timer: ReturnType<typeof setTimeout> | undefined
// Writes run one at a time, so that a clear cannot overtake the write before it.
let writes: Promise<void> = Promise.resolve()
let recoveryStored = false
const storedBlobs = new Set<string>()

// What was found on disk until it is restored or dropped, and the files waiting for that.
let found: { snapshot: RecoverySnapshot; stored: StoredRecovery } | null = null
let waitingFiles: OpenedFile[] = []

function storeRecovery(): void {
  const { document, history, savedPoint, holdsProtectedContent } = useEditor.getState()
  const keep = document !== null && hasUnsavedChanges(history, savedPoint) && !holdsProtectedContent
  if (!keep && !recoveryStored) return

  writes = writes
    .then(async () => {
      if (!keep) {
        recoveryStored = false
        storedBlobs.clear()
        await window.localpdf.clearRecovery()
        return
      }
      const blobs = blobsOf(document)
      const newBlobs = Object.fromEntries(Object.entries(blobs).filter(([name]) => !storedBlobs.has(name)))
      recoveryStored = true
      await window.localpdf.writeRecovery(
        JSON.stringify(toSnapshot(document, new Date().toISOString())),
        newBlobs,
        Object.keys(blobs)
      )
      for (const name of Object.keys(newBlobs)) storedBlobs.add(name)
    })
    .catch((error: unknown) => console.error(error))
}

function watchDocument(): void {
  let unsaved = false
  useEditor.subscribe((state, previous) => {
    const nowUnsaved = hasUnsavedChanges(state.history, state.savedPoint)
    if (nowUnsaved !== unsaved) {
      unsaved = nowUnsaved
      window.localpdf.setUnsavedChanges(unsaved)
    }
    const sameDocument = state.document === previous.document && state.savedPoint === previous.savedPoint
    if (sameDocument && state.holdsProtectedContent === previous.holdsProtectedContent) return
    clearTimeout(timer)
    timer = setTimeout(storeRecovery, AUTOSAVE_DELAY_MS)
  })
}

/** Files handed over from outside the window: a double-click, or the command line. */
async function receiveFiles(files: OpenedFile[]): Promise<void> {
  if (files.length === 0) return
  if (found) {
    waitingFiles.push(...files)
    return
  }
  const { document, openFiles } = useEditor.getState()
  if (!document) return openFiles(files)
  const answer = await window.localpdf.askIncomingFiles(files.map((file) => file.name))
  if (answer === 'add') return useEditor.getState().openFiles(files)
  if (answer === 'replace' && (await requestNewFile())) return useEditor.getState().openFiles(files)
}

function answerRecoveryOffer(): void {
  found = null
  useEditor.setState({ recoveryOffer: null })
  const files = waitingFiles
  waitingFiles = []
  void receiveFiles(files)
}

export async function acceptRecovery(): Promise<void> {
  if (!found) return
  const document = fromSnapshot(found.snapshot, found.stored.blobs)
  try {
    if (!document) throw new Error('The recovery folder is incomplete')
    await restoreDocument(document)
    await window.localpdf.recoveryAccepted()
  } catch (error) {
    console.error(error)
    addNotice(t.recovery.failed)
    await window.localpdf.clearRecovery()
  }
  answerRecoveryOffer()
}

export async function declineRecovery(): Promise<void> {
  await window.localpdf.clearRecovery()
  answerRecoveryOffer()
}

/** Connects the window to the app around it. Runs once, when the window starts. */
export async function startSession(): Promise<void> {
  watchDocument()
  window.localpdf.onIncomingFiles((files) => void receiveFiles(files))
  window.localpdf.onSaveAndClose(() => {
    void saveDocument().then((saved) => {
      if (saved) void window.localpdf.closeWindow()
    })
  })

  const stored = await window.localpdf.readRecovery()
  if (stored) {
    const snapshot = parseSnapshot(stored.state)
    if (snapshot) {
      found = { snapshot, stored }
      const names = Object.values(snapshot.sources).map((source) => source.name)
      useEditor.setState({ recoveryOffer: { savedAt: snapshot.savedAt, names } })
    } else {
      await window.localpdf.clearRecovery()
    }
  }
  await receiveFiles(await window.localpdf.takeStartupFiles())
}
