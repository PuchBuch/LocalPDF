import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer'

enablePatches()

interface HistoryEntry {
  redo: Patch[]
  undo: Patch[]
}

export interface History {
  past: HistoryEntry[]
  future: HistoryEntry[]
}

export const EMPTY_HISTORY: History = { past: [], future: [] }

/** The step the document was at when saved. Null is the state it was opened in. */
export type SavePoint = HistoryEntry | null

/** For a document with changes no file holds, as one restored after a crash. */
export const NEVER_SAVED: SavePoint = { redo: [], undo: [] }

export function savePointOf(history: History): SavePoint {
  return history.past.at(-1) ?? null
}

/** Undoing back to the saved step counts as saved, and a merged typing step is a new one. */
export function hasUnsavedChanges(history: History, saved: SavePoint): boolean {
  return savePointOf(history) !== saved
}

export interface Versioned<T> {
  state: T
  history: History
}

/**
 * Applies a change as one undoable step. A change that alters nothing leaves the
 * history alone. With mergeWithLast it joins the previous step, as typing does.
 */
export function edit<T>(
  state: T,
  history: History,
  recipe: (draft: T) => void,
  { mergeWithLast = false }: { mergeWithLast?: boolean } = {}
): Versioned<T> {
  const [next, redo, undo] = produceWithPatches(state, recipe as never) as unknown as [T, Patch[], Patch[]]
  if (redo.length === 0) return { state, history }

  const last = mergeWithLast ? history.past.at(-1) : undefined
  const entry = last ? { redo: [...last.redo, ...redo], undo: [...undo, ...last.undo] } : { redo, undo }
  const past = last ? history.past.slice(0, -1) : history.past
  return { state: next, history: { past: [...past, entry], future: [] } }
}

export function undo<T>(state: T, history: History): Versioned<T> {
  const entry = history.past.at(-1)
  if (!entry) return { state, history }
  return {
    state: applyPatches(state as object, entry.undo) as T,
    history: { past: history.past.slice(0, -1), future: [entry, ...history.future] }
  }
}

export function redo<T>(state: T, history: History): Versioned<T> {
  const entry = history.future[0]
  if (!entry) return { state, history }
  return {
    state: applyPatches(state as object, entry.redo) as T,
    history: { past: [...history.past, entry], future: history.future.slice(1) }
  }
}
