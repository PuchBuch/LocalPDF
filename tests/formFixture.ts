import { PDFDocument, PDFString, StandardFonts } from 'pdf-lib'

/** States a field's font size the way a file does. 0 asks for the size to fit the box. */
export function setWidgetFontSize(document: PDFDocument, fieldName: string, size: number): void {
  for (const widget of document.getForm().getField(fieldName).acroField.getWidgets()) {
    widget.setDefaultAppearance(`0 g /Helv ${size} Tf`)
  }
}

/**
 * A two-page PDF with every kind of form field. Text sits at known spots:
 * `name` is on both pages, at (50, 700) in PDF space, 300 by 24.
 */
export async function makeRichForm(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const first = document.addPage([595, 842])
  const second = document.addPage([595, 842])
  first.drawText('Form page one', { x: 50, y: 800, font, size: 12 })
  second.drawText('Form page two', { x: 50, y: 800, font, size: 12 })

  const form = document.getForm()
  const name = form.createTextField('name')
  name.addToPage(first, { x: 50, y: 700, width: 300, height: 24 })
  name.addToPage(second, { x: 50, y: 700, width: 300, height: 24 })

  const notes = form.createTextField('notes')
  notes.enableMultiline()
  notes.addToPage(first, { x: 50, y: 600, width: 300, height: 80 })
  // pdf-lib writes the giant size it computed for an empty box. Forms state a normal one.
  setWidgetFontSize(document, 'notes', 12)

  const preset = form.createTextField('preset')
  preset.setText('Preset value')
  preset.addToPage(first, { x: 50, y: 560, width: 300, height: 24 })

  const short = form.createTextField('short')
  short.setMaxLength(3)
  short.addToPage(first, { x: 50, y: 520, width: 100, height: 24 })

  const fixed = form.createTextField('fixed')
  fixed.setText('Locked value')
  fixed.enableReadOnly()
  fixed.addToPage(first, { x: 50, y: 480, width: 300, height: 24 })

  const agree = form.createCheckBox('agree')
  agree.addToPage(first, { x: 50, y: 440, width: 20, height: 20 })

  const on = form.createCheckBox('on')
  on.addToPage(first, { x: 100, y: 440, width: 20, height: 20 })
  on.check()

  const color = form.createRadioGroup('color')
  color.addOptionToPage('red', first, { x: 50, y: 400, width: 20, height: 20 })
  color.addOptionToPage('blue', first, { x: 100, y: 400, width: 20, height: 20 })

  const city = form.createDropdown('city')
  city.setOptions(['Berlin', 'München'])
  city.addToPage(first, { x: 50, y: 360, width: 200, height: 24 })

  const langs = form.createOptionList('langs')
  langs.setOptions(['Deutsch', 'English'])
  langs.addToPage(first, { x: 50, y: 280, width: 200, height: 60 })
  setWidgetFontSize(document, 'langs', 12)

  // Cyrillic options come last: the standard font that pdf-lib draws appearances
  // with here cannot encode them, and the app must cope with such options anyway.
  city.setOptions(['Berlin', 'München', 'Киев'])
  langs.setOptions(['Deutsch', 'Русский', 'English'])
  return document.save({ updateFieldAppearances: false })
}

/** A form holding one digital signature field that has nothing to draw. */
export async function makeUnsignedSignatureForm(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const page = document.addPage([595, 842])
  const form = document.getForm()
  form.createTextField('name').addToPage(page, { x: 50, y: 700, width: 300, height: 24 })

  const signature = document.context.register(
    document.context.obj({
      FT: 'Sig',
      T: PDFString.of('sign'),
      Type: 'Annot',
      Subtype: 'Widget',
      Rect: [50, 600, 250, 660],
      P: page.ref
    })
  )
  page.node.addAnnot(signature)
  form.acroForm.addField(signature)
  return document.save()
}
