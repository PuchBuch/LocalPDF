import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  automaticFontSize,
  currentFormValue,
  toFormWidget,
  turnRect,
  type FormChoiceWidget,
  type FormRadioWidget,
  type FormTextWidget,
  type FormWidget,
  type WidgetAnnotation
} from '../src/core/forms'
import type { EditorDocument, Rotation } from '../src/core/model'
import { buildPdf, type ExportFonts } from '../src/export/buildPdf'
import { makeRichForm, makeUnsignedSignatureForm, setWidgetFontSize } from './formFixture'
import { loadFonts, openPdf, readDisplayedText, renderPage, singlePageDocument } from './helpers'

const PLACE = { x: 0, y: 0, width: 10, height: 10 }

async function widgetsOf(bytes: Uint8Array, pageNumber = 1): Promise<FormWidget[]> {
  const pdf = await openPdf(bytes)
  const page = await pdf.getPage(pageNumber)
  const annotations = (await page.getAnnotations()) as WidgetAnnotation[]
  return annotations.flatMap((annotation) => toFormWidget(annotation, PLACE) ?? [])
}

const byName = (widgets: FormWidget[], name: string) => widgets.filter((widget) => widget.fieldName === name)

describe('reading the fields of a real PDF', () => {
  let widgets: FormWidget[]

  beforeAll(async () => {
    widgets = await widgetsOf(await makeRichForm())
  })

  it('finds text fields with their settings', () => {
    expect(byName(widgets, 'name')[0]).toMatchObject({ kind: 'text', initial: '', multiline: false })
    expect(byName(widgets, 'notes')[0]).toMatchObject({ kind: 'text', multiline: true })
    expect(byName(widgets, 'preset')[0]).toMatchObject({ kind: 'text', initial: 'Preset value' })
    expect((byName(widgets, 'short')[0] as FormTextWidget).maxLength).toBe(3)
  })

  it('leaves a read-only field as part of the page', () => {
    expect(byName(widgets, 'fixed')).toEqual([])
  })

  it('reads the state of checkboxes', () => {
    expect(byName(widgets, 'agree')[0]).toMatchObject({ kind: 'checkbox', initial: false })
    expect(byName(widgets, 'on')[0]).toMatchObject({ kind: 'checkbox', initial: true })
  })

  it('finds each radio button with its own value', () => {
    const buttons = byName(widgets, 'color') as FormRadioWidget[]
    expect(buttons).toHaveLength(2)
    expect(new Set(buttons.map((button) => button.buttonValue)).size).toBe(2)
  })

  it('finds dropdowns and lists with their options', () => {
    expect(byName(widgets, 'city')[0]).toMatchObject({ kind: 'dropdown', options: ['Berlin', 'München', 'Киев'] })
    expect(byName(widgets, 'langs')[0]).toMatchObject({ kind: 'list', options: ['Deutsch', 'Русский', 'English'] })
  })
})

describe('toFormWidget', () => {
  it('ignores what is not an editable field', () => {
    expect(toFormWidget({ id: '1', subtype: 'Link' }, PLACE)).toBeNull()
    expect(toFormWidget({ id: '1', subtype: 'Widget', fieldName: 'b', fieldType: 'Btn', pushButton: true }, PLACE)).toBeNull()
    expect(toFormWidget({ id: '1', subtype: 'Widget', fieldName: 's', fieldType: 'Sig' }, PLACE)).toBeNull()
  })

  it('shows the label of an option whose stored value differs', () => {
    const widget = toFormWidget(
      {
        id: '1',
        subtype: 'Widget',
        fieldName: 'c',
        fieldType: 'Ch',
        combo: true,
        fieldValue: ['de'],
        options: [
          { exportValue: 'de', displayValue: 'Deutsch' },
          { exportValue: 'ru', displayValue: 'Русский' }
        ]
      },
      PLACE
    ) as FormChoiceWidget
    expect(widget.initial).toEqual(['Deutsch'])
    expect(widget.options).toEqual(['Deutsch', 'Русский'])
  })
})

describe('turnRect', () => {
  const page = { width: 100, height: 200 }
  const rect = { x: 10, y: 20, width: 30, height: 40 }

  it.each<[Rotation, { x: number; y: number; width: number; height: number }]>([
    [0, { x: 10, y: 20, width: 30, height: 40 }],
    [90, { x: 140, y: 10, width: 40, height: 30 }],
    [180, { x: 60, y: 140, width: 30, height: 40 }],
    [270, { x: 20, y: 60, width: 40, height: 30 }]
  ])('moves a rectangle for a turn of %i degrees', (rotation, expected) => {
    expect(turnRect(rect, page, rotation)).toEqual(expected)
  })

  it('comes back after two half turns', () => {
    const turned = turnRect(rect, page, 180)
    expect(turnRect(turned, page, 180)).toEqual(rect)
  })
})

describe('form values', () => {
  const widget: FormTextWidget = {
    id: '1',
    fieldName: 'name',
    rect: PLACE,
    kind: 'text',
    initial: 'start',
    multiline: false,
    maxLength: null,
    fontSize: 0,
    align: 'left'
  }

  it('use the value from the file until one is entered', () => {
    expect(currentFormValue(widget, undefined)).toBe('start')
    expect(currentFormValue(widget, { other: 'x' })).toBe('start')
    expect(currentFormValue(widget, { name: 'entered' })).toBe('entered')
    expect(currentFormValue(widget, { name: '' })).toBe('')
  })

  it('choose a readable automatic font size', () => {
    expect(automaticFontSize(24, false)).toBeCloseTo(16.8)
    expect(automaticFontSize(200, false)).toBe(24)
    expect(automaticFontSize(200, true)).toBe(12)
  })
})

describe('printing form values into the page', () => {
  let fonts: ExportFonts

  beforeAll(async () => {
    fonts = await loadFonts()
  })

  async function exportForm(values: Record<string, string | boolean | string[]>, pages = [0]) {
    const bytes = await makeRichForm()
    const document: EditorDocument = {
      sources: { s1: { name: 'form.pdf', bytes } },
      formValues: { s1: values },
      assets: {},
      pages: pages.map((pageIndex) => ({ id: `p${pageIndex}`, sourceId: 's1', pageIndex, rotation: 0, fields: [] }))
    }
    return (await buildPdf(document, fonts)).bytes
  }

  const texts = async (bytes: Uint8Array, pageNumber = 1) =>
    (await readDisplayedText(bytes, pageNumber)).map((item) => item.text)

  it('prints text in every widget of a field, keeps untouched values and locked ones', async () => {
    const output = await exportForm({ name: 'Анна Müller', notes: 'Строка один\nСтрока два' }, [0, 1])
    const first = await texts(output, 1)
    expect(first).toContain('Анна Müller')
    expect(first).toContain('Preset value')
    expect(first).toContain('Locked value')
    expect(await texts(output, 2)).toContain('Анна Müller')
    expect((await PDFDocument.load(output)).getForm().getFields()).toHaveLength(0)
  })

  /** The form, with the font size of one field stated differently. */
  async function exportWithFontSize(fieldName: string, size: number, values: Record<string, string | string[]>) {
    const source = await PDFDocument.load(await makeRichForm())
    setWidgetFontSize(source, fieldName, size)
    const document = singlePageDocument(await source.save({ updateFieldAppearances: false }), [])
    document.formValues = { s1: values }
    return (await buildPdf(document, fonts)).bytes
  }

  it('prints a multi-line field that asks for an automatic size readably, inside its box', async () => {
    const output = await exportWithFontSize('notes', 0, { notes: 'Строка один\nСтрока два\nСтрока три' })
    const items = await readDisplayedText(output)
    // The box runs from 162 to 242 on the displayed page. A word per giant line would not fit.
    const lines = items.filter((item) => item.y > 162 && item.y < 242)
    expect(lines.map((line) => line.text.trim()).join(' ').split(/\s+/)).toEqual([
      'Строка',
      'один',
      'Строка',
      'два',
      'Строка',
      'три'
    ])
    const rows = [...new Set(lines.map((line) => Math.round(line.y)))].sort((a, b) => a - b)
    expect(rows).toHaveLength(3)
    expect(rows[1]! - rows[0]!).toBeLessThan(20)
    expect(rows[2]! - rows[1]!).toBeLessThan(20)
  })

  it('keeps a size the file states for a multi-line field', async () => {
    const items = await readDisplayedText(await exportWithFontSize('notes', 20, { notes: 'один\nдва' }))
    const rows = items.filter((item) => item.text === 'один' || item.text === 'два').map((item) => item.y)
    expect(rows[1]! - rows[0]!).toBeGreaterThan(20)
  })

  it('prints a list that asks for an automatic size with all its options inside the box', async () => {
    const items = await readDisplayedText(await exportWithFontSize('langs', 0, { langs: ['Русский'] }))
    // The box runs from 502 to 562 on the displayed page.
    const options = items.filter((item) => ['Deutsch', 'Русский', 'English'].includes(item.text))
    expect(options).toHaveLength(3)
    for (const option of options) {
      expect(option.y).toBeGreaterThan(502)
      expect(option.y).toBeLessThan(562)
    }
  })

  it('selects a radio button by the name pdf.js gives its state', async () => {
    const buttons = byName(await widgetsOf(await makeRichForm()), 'color') as FormRadioWidget[]
    const darkPixels = async (stateName: string) => {
      const page = await renderPage(await exportForm({ color: stateName }))
      const inBox = (left: number) => {
        let count = 0
        for (let y = 842 - 418; y < 842 - 402; y += 0.5) {
          for (let x = left + 2; x < left + 18; x += 0.5) {
            if (page.colorAt(x, y)[0] < 90) count++
          }
        }
        return count
      }
      return { first: inBox(50), second: inBox(100) }
    }

    const red = await darkPixels(buttons[0]!.buttonValue)
    expect(red.first).toBeGreaterThan(10)
    expect(red.second).toBeLessThan(red.first / 2)

    const blue = await darkPixels(buttons[1]!.buttonValue)
    expect(blue.second).toBeGreaterThan(10)
    expect(blue.first).toBeLessThan(blue.second / 2)
  })

  it('prints the choice of a dropdown, in Cyrillic too', async () => {
    expect(await texts(await exportForm({ city: 'Киев' }))).toContain('Киев')
  })

  it('prints the choices of a list', async () => {
    const output = await exportForm({ langs: ['Русский'] })
    expect(await texts(output)).toContain('Русский')
  })

  it('clears a choice', async () => {
    await expect(exportForm({ langs: [] })).resolves.toBeInstanceOf(Uint8Array)
  })

  it('unticks a checkbox that was ticked in the file', async () => {
    const darkPixels = async (values: Record<string, boolean>) => {
      const page = await renderPage(await exportForm(values))
      let count = 0
      for (let y = 842 - 457; y < 842 - 443; y += 0.5) {
        for (let x = 103; x < 117; x += 0.5) {
          if (page.colorAt(x, y)[0] < 90) count++
        }
      }
      return count
    }
    expect(await darkPixels({})).toBeGreaterThan(5)
    expect(await darkPixels({ on: false })).toBe(0)
  })

  it('does not fail on a digital signature field with nothing to draw', async () => {
    const document = singlePageDocument(await makeUnsignedSignatureForm(), [])
    document.formValues = { s1: { name: 'Подписант' } }
    const { bytes } = await buildPdf(document, fonts)
    expect(await texts(bytes)).toContain('Подписант')
    const reloaded = await PDFDocument.load(bytes)
    expect(reloaded.getForm().getFields()).toHaveLength(0)
    const annotations = reloaded.getPage(0).node.Annots()
    expect(annotations === undefined || annotations.size() === 0).toBe(true)
  })
})
