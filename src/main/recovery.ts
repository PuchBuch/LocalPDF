import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const STATE_FILE = 'state.json'
/** Names come from the interface, they must not lead out of the folder. */
const SAFE_BLOB_NAME = /^[\w-]+$/

const folder = () => join(app.getPath('userData'), 'recovery')
const blobFolder = () => join(folder(), 'blobs')

// After the window has closed, a write still on its way must not bring the folder back.
let closed = false
// Closing the window before answering the offer to restore must not lose what is offered.
let awaitingAnswer = false

export interface StoredRecovery {
  state: string
  blobs: Record<string, Uint8Array>
}

export async function readRecovery(): Promise<StoredRecovery | null> {
  try {
    const state = await readFile(join(folder(), STATE_FILE), 'utf8')
    const blobs: Record<string, Uint8Array> = {}
    for (const name of await readdir(blobFolder()).catch(() => [])) {
      blobs[name] = await readFile(join(blobFolder(), name))
    }
    awaitingAnswer = true
    return { state, blobs }
  } catch {
    return null
  }
}

/** Stores the bytes not stored yet, then the state, which is what makes them count. */
export async function writeRecovery(
  state: string,
  newBlobs: Record<string, Uint8Array>,
  keptBlobs: string[]
): Promise<void> {
  if (closed) return
  awaitingAnswer = false
  await mkdir(blobFolder(), { recursive: true })
  for (const [name, bytes] of Object.entries(newBlobs)) {
    if (SAFE_BLOB_NAME.test(name)) await writeFile(join(blobFolder(), name), bytes)
  }
  const temporaryPath = join(folder(), `${randomUUID()}.tmp`)
  await writeFile(temporaryPath, state)
  await rename(temporaryPath, join(folder(), STATE_FILE))

  const kept = new Set(keptBlobs)
  for (const name of await readdir(blobFolder())) {
    if (!kept.has(name)) await rm(join(blobFolder(), name), { force: true })
  }
}

/** The offer was accepted: from here on the document decides what is kept. */
export function recoveryAccepted(): void {
  awaitingAnswer = false
}

export async function clearRecovery(): Promise<void> {
  awaitingAnswer = false
  await rm(folder(), { recursive: true, force: true })
}

/** For the window closing, when there is no time left to wait. */
export function clearRecoveryOnClose(): void {
  closed = true
  if (!awaitingAnswer) rmSync(folder(), { recursive: true, force: true })
}
