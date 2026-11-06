import { createCanvas } from '@napi-rs/canvas'
import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { EMPTY_HISTORY, edit, redo, undo } from '../src/core/history'
import { jpegOrientation } from '../src/core/jpeg'
import { fileKind } from '../src/core/loadError'
import type { EditorDocument, Field, PageRef } from '../src/core/model'
import { deletePage, movePage, rotatePageClockwise } from '../src/core/pageOperations'
import { buildPdf, type ExportFonts } from '../src/export/buildPdf'
import { imagePageSize, imageToPdf } from '../src/export/imageToPdf'
import { loadFonts, makeTwoColorPng, renderPage } from './helpers'

const page = (id: string, fields: Field[] = []): PageRef => ({ id, sourceId: 's', pageIndex: 0, rotation: 0, fields })

const textField: Field = {
  id: 'f',
  type: 'TEXT',
  x: 100,
  y: 100,
  width: 100,
  height: 40,
  background: 'transparent',
  value: 'x',
  fontSize: 10
}

function documentOf(...pages: PageRef[]): EditorDocument {
  return {
    sources: { s: { name: 's.pdf', bytes: new Uint8Array([1, 2, 3]) } },
    formValues: {},
    assets: {},
    pages
  }
}

const ids = (document: EditorDocument) => document.pages.map((candidate) => candidate.id)

describe('history', () => {
  const start = documentOf(page('a'), page('b'), page('c'))

  it('undoes and redoes a change', () => {
    const changed = edit(start, EMPTY_HISTORY, (draft) => deletePage(draft, 'b'))
    expect(ids(changed.state)).toEqual(['a', 'c'])

    const undone = undo(changed.state, changed.history)
    expect(ids(undone.state)).toEqual(['a', 'b', 'c'])
    expect(undone.history.past).toHaveLength(0)
    expect(undone.history.future).toHaveLength(1)

    const redone = redo(undone.state, undone.history)
    expect(ids(redone.state)).toEqual(['a', 'c'])
  })

  it('walks back through several changes in order', () => {
    let current = { state: start, history: EMPTY_HISTORY }
    current = edit(current.state, current.history, (draft) => movePage(draft, 'c', -1))
    current = edit(current.state, current.history, (draft) => deletePage(draft, 'a'))
    current = edit(current.state, current.history, (draft) => rotatePageClockwise(draft, 'b', { width: 100, height: 200 }))

    current = undo(current.state, current.history)
    expect(current.state.pages.find((candidate) => candidate.id === 'b')?.rotation).toBe(0)
    current = undo(current.state, current.history)
    expect(ids(current.state)).toEqual(['a', 'c', 'b'])
    current = undo(current.state, current.history)
    expect(ids(current.state)).toEqual(['a', 'b', 'c'])
  })

  it('forgets the redo steps after a new change', () => {
    const changed = edit(start, EMPTY_HISTORY, (draft) => deletePage(draft, 'a'))
    const undone = undo(changed.state, changed.history)
    const next = edit(undone.state, undone.history, (draft) => deletePage(draft, 'c'))
    expect(next.history.future).toHaveLength(0)
    expect(next.history.past).toHaveLength(1)
  })

  it('records nothing for a change that alters nothing', () => {
    const unchanged = edit(start, EMPTY_HISTORY, (draft) => movePage(draft, 'a', -1))
    expect(unchanged.history.past).toHaveLength(0)
    expect(unchanged.state).toBe(start)
  })

  it('does nothing when there is nothing to undo or redo', () => {
    expect(undo(start, EMPTY_HISTORY).state).toBe(start)
    expect(redo(start, EMPTY_HISTORY).state).toBe(start)
  })

  it('keeps file bytes intact through undo and redo of an added source', () => {
    const bytes = new Uint8Array([9, 8, 7])
    const added = edit(start, EMPTY_HISTORY, (draft) => {
      draft.sources['new'] = { name: 'n.pdf', bytes }
      draft.pages.push(page('n'))
    })
    const undone = undo(added.state, added.history)
    expect(undone.state.sources['new']).toBeUndefined()
    const redone = redo(undone.state, undone.history)
    expect(redone.state.sources['new']?.bytes).toEqual(new Uint8Array([9, 8, 7]))
    expect(redone.state.sources['new']?.bytes).toBeInstanceOf(Uint8Array)
  })
})

describe('page operations', () => {
  const editOn = (document: EditorDocument, recipe: (draft: EditorDocument) => void) =>
    edit(document, EMPTY_HISTORY, recipe).state

  it('never deletes the last page', () => {
    expect(ids(editOn(documentOf(page('a')), (draft) => deletePage(draft, 'a')))).toEqual(['a'])
  })

  it('brings a deleted page back with its fields', () => {
    const start = documentOf(page('a', [textField]), page('b'))
    const changed = edit(start, EMPTY_HISTORY, (draft) => deletePage(draft, 'a'))
    expect(undo(changed.state, changed.history).state.pages[0]?.fields).toEqual([textField])
  })

  it('moves a page with its fields and stops at the ends', () => {
    const start = documentOf(page('a', [textField]), page('b'))
    const moved = editOn(start, (draft) => movePage(draft, 'a', 1))
    expect(ids(moved)).toEqual(['b', 'a'])
    expect(moved.pages[1]?.fields).toEqual([textField])
    expect(ids(editOn(moved, (draft) => movePage(draft, 'a', 1)))).toEqual(['b', 'a'])
    expect(ids(editOn(moved, (draft) => movePage(draft, 'b', -1)))).toEqual(['b', 'a'])
  })

  it('turns a page and carries its fields, returning to the start after four turns', () => {
    let current = documentOf(page('a', [textField]))
    let size = { width: 595, height: 842 }
    for (const expected of [90, 180, 270, 0]) {
      const before = size
      current = editOn(current, (draft) => rotatePageClockwise(draft, 'a', before))
      size = { width: size.height, height: size.width }
      expect(current.pages[0]?.rotation).toBe(expected)
    }
    expect(current.pages[0]?.fields[0]).toMatchObject({ x: 100, y: 100, width: 100, height: 40 })
  })

  it('moves a field to where the page content went', () => {
    const turned = editOn(documentOf(page('a', [textField])), (draft) =>
      rotatePageClockwise(draft, 'a', { width: 595, height: 842 })
    )
    // The centre (150, 120) goes to (842 - 120, 150).
    expect(turned.pages[0]?.fields[0]).toMatchObject({ x: 672, y: 130 })
  })
})

describe('file kinds', () => {
  it.each([
    ['a.PDF', 'pdf'],
    ['фото.JPG', 'jpeg'],
    ['a.jpeg', 'jpeg'],
    ['a.png', 'png'],
    ['a.webp', 'webp'],
    ['a.gif', 'gif'],
    ['a.heic', 'heic'],
    ['a.HEIF', 'heic'],
    ['a.docx', 'other'],
    ['noextension', 'other']
  ])('%s is %s', (name, kind) => {
    expect(fileKind(name)).toBe(kind)
  })
})

function makeJpeg(): Uint8Array {
  const canvas = createCanvas(40, 20)
  canvas.getContext('2d').fillRect(0, 0, 40, 20)
  return new Uint8Array(canvas.toBuffer('image/jpeg'))
}

/** Puts an EXIF block with the given orientation right after the JPEG's start marker. */
function withOrientation(jpeg: Uint8Array, orientation: number, littleEndian = false): Uint8Array {
  const tiff = new DataView(new ArrayBuffer(26))
  tiff.setUint16(0, littleEndian ? 0x4949 : 0x4d4d)
  tiff.setUint16(2, 42, littleEndian)
  tiff.setUint32(4, 8, littleEndian)
  tiff.setUint16(8, 1, littleEndian)
  tiff.setUint16(10, 0x0112, littleEndian)
  tiff.setUint16(12, 3, littleEndian)
  tiff.setUint32(14, 1, littleEndian)
  tiff.setUint16(18, orientation, littleEndian)
  const exif = [0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, ...new Uint8Array(tiff.buffer)]
  return new Uint8Array([...jpeg.subarray(0, 2), ...exif, ...jpeg.subarray(2)])
}

describe('jpegOrientation', () => {
  it('reads the orientation in both byte orders', () => {
    expect(jpegOrientation(withOrientation(makeJpeg(), 6))).toBe(6)
    expect(jpegOrientation(withOrientation(makeJpeg(), 8, true))).toBe(8)
  })

  it('treats a photo without EXIF as upright', () => {
    expect(jpegOrientation(makeJpeg())).toBe(1)
  })

  it('does not fail on damaged or foreign data', () => {
    expect(jpegOrientation(new Uint8Array([1, 2, 3]))).toBe(1)
    expect(jpegOrientation(withOrientation(makeJpeg(), 6).subarray(0, 18))).toBe(1)
    expect(jpegOrientation(withOrientation(makeJpeg(), 99))).toBe(1)
  })
})

describe('image pages', () => {
  let fonts: ExportFonts

  beforeAll(async () => {
    fonts = await loadFonts()
  })

  it('fit A4 in the orientation of the image', () => {
    expect(imagePageSize({ width: 400, height: 300 }).width).toBeCloseTo(793.3, 0)
    expect(imagePageSize({ width: 400, height: 300 }).height).toBeCloseTo(595)
    expect(imagePageSize({ width: 300, height: 400 }).width).toBeCloseTo(595)
    expect(imagePageSize({ width: 300, height: 400 }).height).toBeCloseTo(793.3, 0)
    expect(imagePageSize({ width: 4000, height: 1000 }).width).toBeCloseTo(842)
  })

  it('fill the page and survive the final export like any other page', async () => {
    const bytes = await imageToPdf({ mime: 'image/png', bytes: makeTwoColorPng() })
    const document: EditorDocument = {
      sources: { image: { name: 'a.png', bytes } },
      formValues: {},
      assets: {},
      pages: [{ id: 'p', sourceId: 'image', pageIndex: 0, rotation: 0, fields: [] }]
    }

    const output = (await buildPdf(document, fonts)).bytes

    const { width, height } = (await PDFDocument.load(output)).getPage(0).getSize()
    expect(width / height).toBeCloseTo(2)
    const rendered = await renderPage(output)
    expect(rendered.colorAt(width * 0.25, height / 2)[0]).toBeGreaterThan(200)
    expect(rendered.colorAt(width * 0.75, height / 2)[2]).toBeGreaterThan(200)
    expect(rendered.colorAt(width * 0.75, height / 2)[0]).toBeLessThan(60)
  })

  it('accept JPEG without changing its bytes', async () => {
    const jpeg = makeJpeg()
    const pdf = await imageToPdf({ mime: 'image/jpeg', bytes: jpeg })
    const text = Buffer.from(pdf).toString('latin1')
    expect(text).toContain('/DCTDecode')
    expect(Buffer.from(pdf).includes(Buffer.from(jpeg))).toBe(true)
  })

  it('reject a damaged image', async () => {
    await expect(imageToPdf({ mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow()
  })
})
