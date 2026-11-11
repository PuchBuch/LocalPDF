import { describe, expect, it } from 'vitest'
import {
  addField,
  clampToPage,
  combCellCount,
  exportFileName,
  findField,
  fitCombField,
  fitPictureField,
  fitTextField,
  LINE_HEIGHT,
  newCheckboxField,
  newCombField,
  newPictureField,
  newSignatureField,
  newTextField,
  nextCheckboxValue,
  numberFields,
  placeField,
  removeField,
  resizeBox,
  scaleCombFont,
  updateField
} from '../src/core/fields'
import type { FormWidget } from '../src/core/forms'
import { EMPTY_HISTORY, edit, undo } from '../src/core/history'
import type { CombField, EditorDocument, ImageField, TextField } from '../src/core/model'

const PAGE = { width: 595, height: 842 }
/** Every character is 5 points wide at font size 10. */
const measure = (text: string, fontSize: number) => (text.length * fontSize) / 2

function documentWithPage(): EditorDocument {
  return {
    sources: {},
    formValues: {},
    assets: {},
    pages: [{ id: 'p', sourceId: 's', pageIndex: 0, rotation: 0, fields: [] }]
  }
}

describe('placing a field', () => {
  it('starts text at the clicked point', () => {
    const field = fitTextField(newTextField('t'), measure, PAGE)
    expect(placeField(field, { x: 100, y: 200 }, PAGE)).toMatchObject({ x: 100, y: 200 })
  })

  it('centres a checkbox on the clicked point', () => {
    expect(placeField(newCheckboxField('c'), { x: 100, y: 200 }, PAGE)).toMatchObject({ x: 94, y: 194, width: 12, height: 12 })
  })

  it('keeps a field on the page at every edge', () => {
    const checkbox = newCheckboxField('c')
    expect(placeField(checkbox, { x: 0, y: 0 }, PAGE)).toMatchObject({ x: 0, y: 0 })
    expect(placeField(checkbox, { x: 595, y: 842 }, PAGE)).toMatchObject({ x: 583, y: 830 })
  })

  it('pins a field larger than the page to its top-left corner', () => {
    expect(clampToPage({ x: 50, y: 50, width: 700, height: 900 }, PAGE)).toEqual({ x: 0, y: 0 })
  })
})

describe('new fields', () => {
  it('match the defaults of the spec', () => {
    expect(newTextField('t')).toMatchObject({ type: 'TEXT', fontSize: 10, background: 'transparent', value: '' })
    expect(newCheckboxField('c')).toMatchObject({ type: 'CHECKBOX', value: 'tick', width: 12, height: 12 })
  })

  it('cycle a checkbox through tick, cross and empty', () => {
    expect(nextCheckboxValue('tick')).toBe('cross')
    expect(nextCheckboxValue('cross')).toBe('dot')
    expect(nextCheckboxValue('dot')).toBeNull()
    expect(nextCheckboxValue(null)).toBe('tick')
  })
})

describe('fitTextField', () => {
  const textField = (change: Partial<TextField>): TextField => ({ ...newTextField('t'), ...change })

  it('is as wide as the longest line and as tall as the lines', () => {
    const fitted = fitTextField(textField({ value: 'ab\nabcdef\nabc' }), measure, PAGE)
    expect(fitted.width).toBeCloseTo(30 + 2)
    expect(fitted.height).toBeCloseTo(3 * 10 * LINE_HEIGHT)
  })

  it('makes room for the placeholder when empty', () => {
    expect(fitTextField(textField({}), measure, PAGE).width).toBeCloseTo(10 + 2)
  })

  it('grows with the font size', () => {
    const fitted = fitTextField(textField({ value: 'abcd', fontSize: 20 }), measure, PAGE)
    expect(fitted.width).toBeCloseTo(40 + 2)
    expect(fitted.height).toBeCloseTo(20 * LINE_HEIGHT)
  })

  it('moves back to stay on the page when text reaches the edge', () => {
    const fitted = fitTextField(textField({ value: 'abcdefghij', x: 570, y: 835 }), measure, PAGE)
    expect(fitted.x + fitted.width).toBeCloseTo(595)
    expect(fitted.y + fitted.height).toBeCloseTo(842)
  })
})

describe('fitTextField with more text than fits', () => {
  it('stops at the size of the page', () => {
    const fitted = fitTextField({ ...newTextField('t'), value: `${'x'.repeat(500)}\n`.repeat(100), x: 50, y: 50 }, measure, PAGE)
    expect(fitted).toMatchObject({ x: 0, y: 0, width: 595, height: 842 })
  })
})

describe('comb fields', () => {
  const comb = (change: Partial<CombField> = {}): CombField => ({ ...newCombField('c'), ...change })

  it('start with eight cells', () => {
    expect(fitCombField(comb(), PAGE)).toMatchObject({ width: 56, height: 12, spacing: 7, fontSize: 10 })
  })

  it('stay at eight cells up to eight characters, then add one per character', () => {
    expect(fitCombField(comb({ value: '12345678' }), PAGE).width).toBeCloseTo(56)
    expect(fitCombField(comb({ value: '1234567890' }), PAGE).width).toBeCloseTo(70)
  })

  it('count a character outside the basic plane as one cell', () => {
    expect(combCellCount({ value: '𝟏'.repeat(9) })).toBe(9)
  })

  it('drop characters that would not fit on the page', () => {
    const fitted = fitCombField(comb({ value: 'x'.repeat(200), x: 300 }), PAGE)
    expect(Array.from(fitted.value)).toHaveLength(85)
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(595)
  })

  it('keep wide cells on the page', () => {
    const fitted = fitCombField(comb({ spacing: 200 }), PAGE)
    expect(fitted.width).toBeLessThanOrEqual(595)
  })

  it('scale the cell with the font', () => {
    expect(scaleCombFont(comb(), 20)).toMatchObject({ fontSize: 20, spacing: 14 })
  })
})

describe('fitPictureField', () => {
  const picture = (change: Partial<ImageField> = {}): ImageField => ({ ...newPictureField('p'), ...change })

  it('keeps the width and takes the height from the image', () => {
    expect(fitPictureField(picture(), { width: 200, height: 100 }, PAGE)).toMatchObject({ width: 60, height: 30 })
    expect(fitPictureField(picture(), { width: 100, height: 200 }, PAGE)).toMatchObject({ width: 60, height: 120 })
  })

  it('scales down a tall image that would pass the page, and stays on it', () => {
    const fitted = fitPictureField(picture({ width: 300, y: 700 }), { width: 100, height: 400 }, PAGE)
    expect(fitted.height).toBeCloseTo(842)
    expect(fitted.width).toBeCloseTo(210.5)
    expect(fitted.y).toBeCloseTo(0)
  })
})

describe('resizeBox', () => {
  const start = { x: 100, y: 100, width: 60, height: 30 }

  it('follows the corner freely when not locked', () => {
    expect(resizeBox(start, { x: 40, y: 5 }, PAGE, false)).toEqual({ x: 100, y: 100, width: 100, height: 35 })
  })

  it('keeps the proportions when locked', () => {
    const box = resizeBox(start, { x: 60, y: 0 }, PAGE, true)
    expect(box).toEqual({ x: 100, y: 100, width: 120, height: 60 })
  })

  it('follows the larger of the two movements when locked', () => {
    expect(resizeBox(start, { x: 6, y: 30 }, PAGE, true)).toMatchObject({ width: 120, height: 60 })
  })

  it('stops at the page edge, still in proportion', () => {
    const box = resizeBox(start, { x: 5000, y: 5000 }, PAGE, true)
    expect(box.x + box.width).toBeCloseTo(595)
    expect(box.width / box.height).toBeCloseTo(2)
    const free = resizeBox(start, { x: 5000, y: 5000 }, PAGE, false)
    expect(free).toMatchObject({ width: 495, height: 742 })
  })

  it('never gets smaller than the minimum', () => {
    expect(resizeBox(start, { x: -500, y: -500 }, PAGE, false)).toMatchObject({ width: 8, height: 8 })
    const locked = resizeBox(start, { x: -500, y: -500 }, PAGE, true)
    expect(locked.height).toBeCloseTo(8)
    expect(locked.width).toBeCloseTo(16)
  })
})

describe('new signature and picture fields', () => {
  it('match the sizes of the spec', () => {
    expect(newSignatureField('s')).toMatchObject({ type: 'SIGNATURE', width: 180, height: 60, assetId: null })
    expect(newPictureField('p')).toMatchObject({ type: 'PICTURE', width: 60, height: 60, assetId: null })
  })
})

describe('field operations', () => {
  it('adds, finds, changes and removes a field', () => {
    const document = documentWithPage()
    addField(document, 'p', newCheckboxField('c'))
    expect(findField(document, 'c')?.pageId).toBe('p')

    updateField(document, 'c', { x: 50 })
    expect(findField(document, 'c')?.field.x).toBe(50)

    removeField(document, 'c')
    expect(findField(document, 'c')).toBeNull()
  })
})

describe('typing as one undo step', () => {
  const start = documentWithPage()
  start.pages[0]!.fields.push(newTextField('t'))
  const type = (value: string) => (draft: EditorDocument) => updateField(draft, 't', { value } as Partial<TextField>)
  const value = (document: EditorDocument) => (findField(document, 't')?.field as TextField).value

  it('undoes merged typing all at once', () => {
    let current = edit(start, EMPTY_HISTORY, type('a'))
    current = edit(current.state, current.history, type('ab'), { mergeWithLast: true })
    current = edit(current.state, current.history, type('abc'), { mergeWithLast: true })
    expect(current.history.past).toHaveLength(1)

    const undone = undo(current.state, current.history)
    expect(value(undone.state)).toBe('')
  })

  it('keeps earlier steps apart from merged ones', () => {
    let current = edit(start, EMPTY_HISTORY, type('a'))
    current = edit(current.state, current.history, type('b'))
    current = edit(current.state, current.history, type('bc'), { mergeWithLast: true })
    expect(current.history.past).toHaveLength(2)
    expect(value(undo(current.state, current.history).state)).toBe('a')
  })
})

describe('exportFileName', () => {
  it.each([
    ['test.pdf', 'test-document.pdf'],
    ['Отчёт.v2.PDF', 'Отчёт.v2-document.pdf'],
    ['photo.jpg', 'photo-document.pdf'],
    ['noextension', 'noextension-document.pdf']
  ])('%s becomes %s', (name, expected) => {
    expect(exportFileName(name)).toBe(expected)
  })
})

describe('numbering the fields', () => {
  const text = (id: string, x: number, y: number, value = ''): TextField => ({
    ...newTextField(id),
    x,
    y,
    width: 100,
    height: 14,
    value
  })
  const formText = (id: string, fieldName: string, x: number, y: number): FormWidget => ({
    id,
    fieldName,
    rect: { x, y, width: 120, height: 16 },
    kind: 'text',
    initial: '',
    multiline: false,
    maxLength: null,
    fontSize: 0,
    align: 'left'
  })
  const radio = (id: string, x: number, y: number, buttonValue: string): FormWidget => ({
    id,
    fieldName: 'choice',
    rect: { x, y, width: 12, height: 12 },
    kind: 'radio',
    initial: 'Off',
    buttonValue
  })
  const sizes = { p1: PAGE, p2: PAGE }
  const twoPages = (first: TextField[], second: TextField[] = []): EditorDocument => ({
    sources: {},
    formValues: {},
    assets: {},
    pages: [
      { id: 'p1', sourceId: 's', pageIndex: 0, rotation: 0, fields: first },
      { id: 'p2', sourceId: 's', pageIndex: 1, rotation: 0, fields: second }
    ]
  })
  const order = (document: EditorDocument, widgets: Record<string, FormWidget[]> = {}) =>
    numberFields(document, widgets, sizes).map((entry) =>
      entry.target.kind === 'added' ? entry.target.fieldId : entry.target.fieldName
    )

  it('goes from the top down, and from left to right along a row', () => {
    const document = twoPages([text('low', 50, 400), text('right', 300, 100), text('left', 50, 104), text('top', 200, 40)])
    expect(order(document)).toEqual(['top', 'left', 'right', 'low'])
    expect(numberFields(document, {}, sizes).map((entry) => entry.number)).toEqual([1, 2, 3, 4])
  })

  it('numbers page by page, in the order of the pages', () => {
    const document = twoPages([text('a2', 50, 300)], [text('b1', 50, 50)])
    expect(order(document)).toEqual(['a2', 'b1'])
    document.pages.reverse()
    expect(order(document)).toEqual(['b1', 'a2'])
  })

  it('gives the same numbers whatever order the fields were added in', () => {
    const fields = [text('c', 50, 500), text('a', 50, 100), text('b', 300, 100)]
    expect(order(twoPages(fields))).toEqual(order(twoPages([...fields].reverse())))
  })

  it('puts the form of the file and added fields in one order, with names and values', () => {
    const document = twoPages([text('added', 50, 200, 'Berlin')])
    document.formValues = { s: { Name: 'Anna' } }
    const entries = numberFields(document, { p1: [formText('w1', 'Name', 50, 100), formText('w2', 'Street', 50, 300)] }, sizes)
    expect(entries.map((entry) => [entry.number, entry.type, entry.name, entry.value])).toEqual([
      [1, 'text', 'Name', 'Anna'],
      [2, 'text', '', 'Berlin'],
      [3, 'text', 'Street', '']
    ])
  })

  it('gives a radio group one number, at its first button', () => {
    const entries = numberFields(
      twoPages([text('after', 50, 300)]),
      { p1: [radio('r2', 200, 100, 'No'), radio('r1', 50, 100, 'Yes')] },
      sizes
    )
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ number: 1, type: 'radio', name: 'choice', value: '' })
    expect(entries[0]!.target).toMatchObject({ widgetId: 'r1' })
  })

  it('reads a turned page as it is shown', () => {
    const document = twoPages([])
    document.pages[0]!.rotation = 90
    // Turned clockwise, what was at the bottom of the page comes to the left, and is read first.
    const entries = numberFields(document, { p1: [formText('top', 'Top', 50, 50), formText('bottom', 'Bottom', 50, 700)] }, sizes)
    expect(entries.map((entry) => entry.name)).toEqual(['Bottom', 'Top'])
    expect(entries[0]!.box).toEqual({ x: 126, y: 50, width: 16, height: 120 })
  })
})