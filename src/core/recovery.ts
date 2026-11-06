import type { EditorDocument, FormValue, ImageAsset, PageRef } from './model'

/** What is kept on disk to bring a document back after a crash. Bytes are stored separately. */
export interface RecoverySnapshot {
  version: 1
  savedAt: string
  pages: PageRef[]
  formValues: Record<string, Record<string, FormValue>>
  sources: Record<string, { name: string }>
  assets: Record<string, { mime: ImageAsset['mime'] }>
}

const sourceBlob = (id: string) => `source-${id}`
const assetBlob = (id: string) => `asset-${id}`

export function toSnapshot(document: EditorDocument, savedAt: string): RecoverySnapshot {
  const names = Object.entries(document.sources).map(([id, source]) => [id, { name: source.name }])
  const mimes = Object.entries(document.assets).map(([id, asset]) => [id, { mime: asset.mime }])
  return {
    version: 1,
    savedAt,
    pages: document.pages,
    formValues: document.formValues,
    sources: Object.fromEntries(names),
    assets: Object.fromEntries(mimes)
  }
}

/** The bytes of a document, by the name they are stored under. They never change once created. */
export function blobsOf(document: EditorDocument): Record<string, Uint8Array> {
  const blobs: Record<string, Uint8Array> = {}
  for (const [id, source] of Object.entries(document.sources)) blobs[sourceBlob(id)] = source.bytes
  for (const [id, asset] of Object.entries(document.assets)) blobs[assetBlob(id)] = asset.bytes
  return blobs
}

export function parseSnapshot(text: string): RecoverySnapshot | null {
  try {
    const snapshot = JSON.parse(text) as Partial<RecoverySnapshot> | null
    const complete = snapshot?.version === 1 && Array.isArray(snapshot.pages) && snapshot.sources && snapshot.assets
    return complete ? (snapshot as RecoverySnapshot) : null
  } catch {
    return null
  }
}

/** The document again, or null if any of its bytes are gone. */
export function fromSnapshot(snapshot: RecoverySnapshot, blobs: Record<string, Uint8Array>): EditorDocument | null {
  const document: EditorDocument = { sources: {}, formValues: snapshot.formValues, assets: {}, pages: snapshot.pages }
  for (const [id, { name }] of Object.entries(snapshot.sources)) {
    const bytes = blobs[sourceBlob(id)]
    if (!bytes) return null
    document.sources[id] = { name, bytes }
  }
  for (const [id, { mime }] of Object.entries(snapshot.assets)) {
    const bytes = blobs[assetBlob(id)]
    if (!bytes) return null
    document.assets[id] = { mime, bytes }
  }
  return document
}
