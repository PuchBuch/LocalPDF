import { describe, expect, it } from 'vitest'
import { edit, EMPTY_HISTORY, hasUnsavedChanges, NEVER_SAVED, savePointOf, undo, redo } from '../src/core/history'
import { openableArguments } from '../src/core/launchArguments'
import type { EditorDocument } from '../src/core/model'
import { blobsOf, fromSnapshot, parseSnapshot, toSnapshot } from '../src/core/recovery'

describe('unsaved changes', () => {
  const change = (state: { n: number }, history = EMPTY_HISTORY, mergeWithLast = false) =>
    edit(
      state,
      history,
      (draft) => {
        draft.n++
      },
      { mergeWithLast }
    )

  it('a document just opened has none', () => {
    expect(hasUnsavedChanges(EMPTY_HISTORY, null)).toBe(false)
  })

  it('an edit makes some and saving clears them', () => {
    const edited = change({ n: 0 })
    expect(hasUnsavedChanges(edited.history, null)).toBe(true)
    expect(hasUnsavedChanges(edited.history, savePointOf(edited.history))).toBe(false)
  })

  it('undoing back to what was saved leaves none, going further or redoing does', () => {
    const first = change({ n: 0 })
    const saved = savePointOf(first.history)
    const second = change(first.state, first.history)
    expect(hasUnsavedChanges(second.history, saved)).toBe(true)

    const back = undo(second.state, second.history)
    expect(hasUnsavedChanges(back.history, saved)).toBe(false)

    const forward = redo(back.state, back.history)
    expect(hasUnsavedChanges(forward.history, saved)).toBe(true)

    const start = undo(back.state, back.history)
    expect(hasUnsavedChanges(start.history, saved)).toBe(true)
  })

  it('typing merged into the saved step still counts as a change', () => {
    const typed = change({ n: 0 })
    const saved = savePointOf(typed.history)
    const more = change(typed.state, typed.history, true)
    expect(more.history.past).toHaveLength(1)
    expect(hasUnsavedChanges(more.history, saved)).toBe(true)
  })

  it('a restored document has changes even with nothing to undo', () => {
    expect(hasUnsavedChanges(EMPTY_HISTORY, NEVER_SAVED)).toBe(true)
  })
})

describe('recovery snapshot', () => {
  const document: EditorDocument = {
    sources: { s1: { name: 'Отчёт.pdf', bytes: new Uint8Array([1, 2, 3]) } },
    formValues: { s1: { name: 'Анна', agree: true, langs: ['Deutsch'] } },
    assets: { a1: { mime: 'image/png', bytes: new Uint8Array([4, 5]) } },
    pages: [
      {
        id: 'p1',
        sourceId: 's1',
        pageIndex: 0,
        rotation: 90,
        fields: [{ id: 'f1', type: 'SIGNATURE', x: 1, y: 2, width: 3, height: 4, background: 'white', assetId: 'a1' }]
      }
    ]
  }
  const text = JSON.stringify(toSnapshot(document, '2026-11-06T10:00:00.000Z'))

  it('keeps no document bytes in the state', () => {
    expect(text.length).toBeLessThan(600)
    expect(text).not.toContain('"bytes"')
  })

  it('brings the whole document back', () => {
    const snapshot = parseSnapshot(text)!
    expect(snapshot.savedAt).toBe('2026-11-06T10:00:00.000Z')
    expect(fromSnapshot(snapshot, blobsOf(document))).toEqual(document)
  })

  it('names blobs so that they can be file names', () => {
    expect(Object.keys(blobsOf(document)).sort()).toEqual(['asset-a1', 'source-s1'])
  })

  it('gives up when bytes are missing', () => {
    const snapshot = parseSnapshot(text)!
    expect(fromSnapshot(snapshot, {})).toBeNull()
    expect(fromSnapshot(snapshot, { 'source-s1': new Uint8Array([1]) })).toBeNull()
  })

  it.each(['', 'not json', 'null', '{"version":2,"pages":[],"sources":{},"assets":{}}', '{"version":1}'])(
    'refuses a damaged state: %s',
    (damaged) => {
      expect(parseSnapshot(damaged)).toBeNull()
    }
  )
})

describe('openableArguments', () => {
  it('takes what Explorer passes on a double-click', () => {
    expect(openableArguments(['C:\\Папка с пробелом\\Файл.PDF'])).toEqual(['C:\\Папка с пробелом\\Файл.PDF'])
  })

  it('keeps images, so a wrong kind can be reported by the usual rules', () => {
    expect(openableArguments(['a.jpg', 'b.png', 'c.heic'])).toEqual(['a.jpg', 'b.png', 'c.heic'])
  })

  it('skips switches and everything that is not a document', () => {
    expect(
      openableArguments(['.', '--allow-file-access-from-files', '--inspect=x.pdf', 'C:\\app\\LocalPDF.exe', 'readme.txt'])
    ).toEqual([])
  })
})
