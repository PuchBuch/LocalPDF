import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFInvalidObject,
  PDFName,
  PDFObjectCopier,
  PDFOptionList,
  PDFPage,
  PDFRadioGroup,
  PDFRef,
  PDFTextField,
  degrees,
  rgb,
  type PDFField,
  type PDFFont,
  type PDFImage
} from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { CROSS_PATH, DOT_PATH, LINE_HEIGHT, MARK_BASE_SIZE, MARK_STROKE_WIDTH, TICK_PATH } from '../core/fields'
import { DEFAULT_FAMILY, faceOf, familyInfo, type FontFace, type FontFamily } from '../core/fonts'
import { automaticFontSize, turnRect } from '../core/forms'
import { displayedSize, displayToPdf, normalizeRotation, visibleBox, type Rect, type Size } from '../core/geometry'
import { dropUnreachableObjects, removeTextInAreas } from './removeText'
import { safeFontkit } from './safeFontkit'
import { coversOf, isCovered } from '../core/textLines'
import type {
  CheckboxField,
  CombField,
  EditorDocument,
  Field,
  FormValue,
  ImageField,
  PageRef,
  RgbColor,
  Rotation,
  TextCover,
  TextField,
  TextStyle
} from '../core/model'

export interface ExportFonts {
  /** The faces of every family that text fields can use. */
  text: Record<FontFamily, Record<FontFace, Uint8Array>>
  /** For comb fields. */
  mono: Uint8Array
}

export interface MissingCharacter {
  fieldId: string
  character: string
}

export interface ExportResult {
  bytes: Uint8Array
  missingCharacters: MissingCharacter[]
  /** Numbers of the pages where an image under replaced text stays in the file. */
  imagesUnderCovers: number[]
  /** A form could not be printed into its pages, so values entered in it are not in the file. */
  formsNotPrinted: boolean
}

export interface BuildOptions {
  /** Without the added fields, to check what is left of the page itself. */
  withoutFields?: boolean
  /** Writes a PDF anew in plain form, for files the library cannot read properly. */
  repair?: (bytes: Uint8Array) => Promise<Uint8Array | null>
}

export { LINE_HEIGHT }

const FONT_SIZE_OPERATOR = /(\/\S+)\s+(\d*\.?\d+)\s+Tf/
const BLACK = rgb(0, 0, 0)
const WHITE = rgb(1, 1, 1)

interface LoadedFont {
  pdfFont: PDFFont
  ascent: number
  descent: number
  hasGlyph: (codePoint: number) => boolean
}

interface PageTarget {
  page: PDFPage
  box: Rect
  rotation: Rotation
}

class ExportContext {
  readonly missingCharacters: MissingCharacter[] = []
  private readonly fontCache = new Map<Uint8Array, Promise<LoadedFont>>()
  private readonly imageCache = new Map<string, Promise<PDFImage>>()

  constructor(
    readonly output: PDFDocument,
    private readonly document: EditorDocument,
    readonly fonts: ExportFonts
  ) {}

  font(bytes: Uint8Array, subset = true): Promise<LoadedFont> {
    let font = this.fontCache.get(bytes)
    if (!font) {
      font = this.loadFont(bytes, subset)
      this.fontCache.set(bytes, font)
    }
    return font
  }

  image(assetId: string): Promise<PDFImage> {
    let image = this.imageCache.get(assetId)
    if (!image) {
      const asset = this.document.assets[assetId]
      if (!asset) throw new Error(`Unknown image asset: ${assetId}`)
      image =
        asset.mime === 'image/png' ? this.output.embedPng(asset.bytes) : this.output.embedJpg(asset.bytes)
      this.imageCache.set(assetId, image)
    }
    return image
  }

  private async loadFont(bytes: Uint8Array, subset: boolean): Promise<LoadedFont> {
    const metrics = safeFontkit.create(bytes)
    const characters = new Set(metrics.characterSet)
    return {
      pdfFont: await this.output.embedFont(bytes, { subset }),
      ascent: metrics.ascent / metrics.unitsPerEm,
      descent: Math.abs(metrics.descent) / metrics.unitsPerEm,
      hasGlyph: (codePoint) => characters.has(codePoint)
    }
  }
}

/** Builds the final PDF from the editor's document. The sources are left untouched. */
export async function buildPdf(
  document: EditorDocument,
  fonts: ExportFonts,
  options: BuildOptions = {}
): Promise<ExportResult> {
  const output = await PDFDocument.create()
  output.registerFontkit(safeFontkit)
  output.setProducer('LocalPDF')
  output.setCreator('LocalPDF')

  const context = new ExportContext(output, document, fonts)
  const copiedSources = await copySourcePages(document, output, fonts, options.repair)
  const { pages: copiedPages, formsNotPrinted } = copiedSources

  const imagesUnderCovers: number[] = []
  for (const [index, pageRef] of document.pages.entries()) {
    const pageNumber = index + 1
    const key = `${pageRef.sourceId}:${pageRef.pageIndex}`
    const page = copiedPages.get(key)?.shift()
    if (!page) throw new Error(`Page not found in source: ${key}`)

    const rotation = normalizeRotation(page.getRotation().angle + pageRef.rotation)
    page.setRotation(degrees(rotation))
    output.addPage(page)

    const target: PageTarget = { page, box: visibleBox(page.getCropBox(), page.getMediaBox()), rotation }
    const covers = coversOf(pageRef.fields)
    // First the old text leaves the file, while the page is still only its source content.
    try {
      const removal = removeTextInAreas(output, page, covers.map((cover) => toUserSpace(target, cover)))
      if (removal.imageUnderArea) imagesUnderCovers.push(pageNumber)
    } catch (error) {
      // Content that cannot be read cannot be cut. The check of the finished file reports it.
      console.error(error)
    }
    if (options.withoutFields) continue

    if (pageRef.ocr) await drawRecognizedText(context, target, pageRef, sizeBeforeEditing(target, pageRef.rotation))

    // All painting out comes next, so that it cannot hide another field.
    for (const cover of covers) drawBackground(target, cover)
    for (const field of pageRef.fields) await drawField(context, target, field)
  }

  if (document.pages.some((page) => coversOf(page.fields).length > 0)) dropUnreachableObjects(output)

  return {
    bytes: await output.save(),
    missingCharacters: context.missingCharacters,
    imagesUnderCovers,
    formsNotPrinted
  }
}

/** The page's displayed size before the rotation added in the editor. */
function sizeBeforeEditing({ box, rotation }: PageTarget, added: Rotation): Size {
  return displayedSize(box, normalizeRotation(rotation - added))
}

/**
 * The words read from a scan, as invisible text over its picture, so that the saved
 * file can be searched and copied from. Words under replaced text stay out.
 */
async function drawRecognizedText(context: ExportContext, target: PageTarget, ref: PageRef, size: Size): Promise<void> {
  const font = await context.font(context.fonts.text[DEFAULT_FAMILY].Regular)
  const { page, box, rotation } = target
  const covers = coversOf(ref.fields)
  for (const word of ref.ocr ?? []) {
    const text = keepDrawableCharacters(context, font, 'ocr', word.text)
    if (text === '') continue
    const place = turnRect(word, size, ref.rotation)
    if (isCovered({ x: place.x + place.width / 2, y: place.y + place.height / 2 }, covers)) continue
    const start = turnRect({ x: word.x, y: word.baseline, width: 0, height: 0 }, size, ref.rotation)
    page.drawText(text, {
      ...displayToPdf(box, rotation, start),
      font: font.pdfFont,
      size: word.fontSize,
      opacity: 0,
      rotate: degrees(normalizeRotation(rotation - ref.rotation))
    })
  }
}

/** An area of the displayed page in the page's own coordinates. */
function toUserSpace({ box, rotation }: PageTarget, area: Rect): Rect {
  const first = displayToPdf(box, rotation, { x: area.x, y: area.y })
  const second = displayToPdf(box, rotation, { x: area.x + area.width, y: area.y + area.height })
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y)
  }
}

async function copySourcePages(
  document: EditorDocument,
  output: PDFDocument,
  fonts: ExportFonts,
  repair: BuildOptions['repair']
): Promise<{ pages: Map<string, PDFPage[]>; formsNotPrinted: boolean }> {
  const copied = new Map<string, PDFPage[]>()
  const usedSourceIds = new Set(document.pages.map((page) => page.sourceId))
  let formsNotPrinted = false

  for (const sourceId of usedSourceIds) {
    const source = document.sources[sourceId]
    if (!source) throw new Error(`Unknown source: ${sourceId}`)
    const values = document.formValues[sourceId] ?? {}

    // Forms are flattened source by source, so fields with the same name in
    // different files cannot collide when their pages meet in one document.
    let flattened: PDFDocument
    try {
      flattened = await flattenSource(await loadSource(source.bytes, repair), values, fonts)
    } catch (error) {
      // A form that cannot be printed into its pages must not stop the document being saved.
      console.error(error)
      flattened = await loadSource(source.bytes, repair)
      if (Object.keys(values).length > 0) formsNotPrinted = true
    }

    // One copier for all of a source: what the layers refer to must be what the pages use.
    const copier = PDFObjectCopier.for(flattened.context, output.context)
    const sourcePages = flattened.getPages()
    for (const ref of document.pages.filter((page) => page.sourceId === sourceId)) {
      const sourcePage = sourcePages[ref.pageIndex]
      if (!sourcePage) throw new Error(`Page not found in source: ${sourceId}:${ref.pageIndex}`)
      const node = copier.copy(sourcePage.node)
      const page = PDFPage.of(node, output.context.register(node), output)
      const key = `${sourceId}:${ref.pageIndex}`
      copied.set(key, [...(copied.get(key) ?? []), page])
    }
    copyLayers(flattened, output, copier)
  }
  return { pages: copied, formsNotPrinted }
}

const OC_PROPERTIES = PDFName.of('OCProperties')

/**
 * Layers switched off must stay off. The settings live in the document's catalog, not
 * on its pages, so without them all that was hidden would appear in the saved file.
 */
function copyLayers(source: PDFDocument, output: PDFDocument, copier: PDFObjectCopier): void {
  const settings = source.catalog.lookup(OC_PROPERTIES)
  if (!(settings instanceof PDFDict)) return
  const copy = copier.copy(settings)
  const existing = output.catalog.lookup(OC_PROPERTIES)
  if (!(existing instanceof PDFDict)) {
    output.catalog.set(OC_PROPERTIES, copy)
    return
  }
  // Merged documents: the layers of the next one join those of the first, as they were set.
  appendTo(existing, copy, PDFName.of('OCGs'))
  const defaults = existing.lookup(PDFName.of('D'))
  const newDefaults = copy.lookup(PDFName.of('D'))
  if (defaults instanceof PDFDict && newDefaults instanceof PDFDict) appendTo(defaults, newDefaults, PDFName.of('OFF'))
}

function appendTo(target: PDFDict, source: PDFDict, key: PDFName): void {
  const items = source.lookup(key)
  if (!(items instanceof PDFArray)) return
  const existing = target.lookup(key)
  if (existing instanceof PDFArray) for (const item of items.asArray()) existing.push(item)
  else target.set(key, items)
}

/**
 * Opens a source for copying. Some files use forms of PDF that the library reads wrongly
 * or not at all, which would lose text silently. Those go through qpdf, which writes them
 * anew in plain form, and are read again.
 */
async function loadSource(bytes: Uint8Array, repair: BuildOptions['repair']): Promise<PDFDocument> {
  let failure: unknown
  try {
    const document = await PDFDocument.load(bytes)
    document.getPages()
    const unreadable = document.context
      .enumerateIndirectObjects()
      .some(([, object]) => object instanceof PDFInvalidObject)
    if (!unreadable || !repair) return document
  } catch (error) {
    failure = error
  }
  const repaired = await repair?.(bytes)
  if (!repaired) {
    if (failure) throw failure
    return PDFDocument.load(bytes)
  }
  return PDFDocument.load(repaired)
}

async function flattenSource(
  document: PDFDocument,
  values: Record<string, FormValue>,
  fonts: ExportFonts
): Promise<PDFDocument> {
  const form = document.getForm()
  const fields = form.getFields()
  if (fields.length === 0) return document

  document.registerFontkit(fontkit)
  for (const field of fields) {
    const value = values[field.getName()]
    if (value === undefined) continue

    if (field instanceof PDFTextField) field.setText(String(value))
    else if (field instanceof PDFCheckBox) value === true ? field.check() : field.uncheck()
    else if (field instanceof PDFRadioGroup) selectRadio(field, String(value))
    else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const chosen = Array.isArray(value) ? value : [String(value)]
      if (chosen.length > 0) field.select(chosen)
      else field.clear()
    }
  }

  for (const field of fields) {
    const multipleLines = (field instanceof PDFTextField && field.isMultiline()) || field instanceof PDFOptionList
    if (multipleLines && field.needsAppearancesUpdate()) replaceAutomaticFontSize(field)
  }

  // The default Helvetica cannot draw Cyrillic values in regenerated appearances.
  form.updateFieldAppearances(await document.embedFont(fonts.text[DEFAULT_FAMILY].Regular, { subset: true }))
  giveEmptyAppearances(document, fields)
  form.flatten({ updateFieldAppearances: false })
  removeDanglingAnnotations(document)

  // Saving completes the embedded font subset, which copyPages would otherwise miss.
  return PDFDocument.load(await document.save())
}

/**
 * Left to choose the font size of a field with several lines, pdf-lib fills the box
 * with the first word and cuts off the rest. A file that states a size keeps it.
 * The size can be on the widget, which then wins over the one on the field.
 */
function replaceAutomaticFontSize(field: PDFField): void {
  const fieldAppearance = field.acroField.getDefaultAppearance() ?? ''
  const sized = (appearance: string) => {
    const size = automaticFontSize(0, true)
    return FONT_SIZE_OPERATOR.test(appearance)
      ? appearance.replace(FONT_SIZE_OPERATOR, `$1 ${size} Tf`)
      : `/Helv ${size} Tf 0 g ${appearance}`
  }
  const isAutomatic = (appearance: string) => {
    const size = FONT_SIZE_OPERATOR.exec(appearance)?.[2]
    return size === undefined || Number(size) === 0
  }

  for (const widget of field.acroField.getWidgets()) {
    const appearance = widget.getDefaultAppearance()
    if (appearance !== undefined && isAutomatic(appearance)) widget.setDefaultAppearance(sized(appearance))
  }
  if (isAutomatic(fieldAppearance)) field.acroField.setDefaultAppearance(sized(fieldAppearance))
}

/**
 * A radio value here is the state name of its button, as pdf.js reports it. A file
 * can give the buttons other export values, and pdf-lib selects by those.
 */
function selectRadio(field: PDFRadioGroup, stateName: string): void {
  const stateNames = field.acroField.getOnValues().map((name) => name.decodeText())
  const options = field.getOptions()
  const option = options[stateNames.indexOf(stateName)] ?? stateName
  if (options.includes(option)) field.select(option)
}

/**
 * pdf-lib's flatten fails on a widget with nothing to draw, such as an unsigned
 * digital signature field. An empty drawing lets it go quietly.
 */
function giveEmptyAppearances(document: PDFDocument, fields: PDFField[]): void {
  for (const field of fields) {
    for (const widget of field.acroField.getWidgets()) {
      if (widget.getAppearances()) continue
      const { width, height } = widget.getRectangle()
      const empty = document.context.formXObject([], { BBox: [0, 0, width, height], Matrix: [1, 0, 0, 1, 0, 0] })
      widget.setNormalAppearance(document.context.register(empty))
    }
  }
}

/**
 * pdf-lib's flatten deletes widgets that are separate from their field but leaves
 * references to them in /Annots. Other annotations, such as links, must stay.
 */
function removeDanglingAnnotations(document: PDFDocument): void {
  for (const page of document.getPages()) {
    const annotations = page.node.Annots()
    if (!annotations) continue
    for (let index = annotations.size() - 1; index >= 0; index--) {
      const annotation = annotations.get(index)
      if (annotation instanceof PDFRef && !document.context.lookup(annotation)) annotations.remove(index)
    }
  }
}

async function drawField(context: ExportContext, target: PageTarget, field: Field): Promise<void> {
  if (field.background === 'white') drawBackground(target, field)

  switch (field.type) {
    case 'TEXT':
      return drawText(context, target, field)
    case 'COMB_TEXT':
      return drawComb(context, target, field)
    case 'CHECKBOX':
      return drawCheckbox(target, field)
    case 'SIGNATURE':
    case 'PICTURE':
      return drawImage(context, target, field)
  }
}

function toPdfColor(color: RgbColor | undefined, fallback: ReturnType<typeof rgb>): ReturnType<typeof rgb> {
  return color ? rgb(color.r / 255, color.g / 255, color.b / 255) : fallback
}

function textFont({ fonts }: ExportContext, style: TextStyle | undefined): Uint8Array {
  return fonts.text[style?.family ?? DEFAULT_FAMILY][faceOf(style)]
}

function drawBackground({ page, box, rotation }: PageTarget, area: TextCover | Field): void {
  page.drawRectangle({
    ...displayToPdf(box, rotation, { x: area.x, y: area.y + area.height }),
    width: area.width,
    height: area.height,
    color: toPdfColor('color' in area ? area.color : undefined, WHITE),
    rotate: degrees(rotation)
  })
}

/** Distance from the top of a CSS line box to its baseline. */
function baselineOffset(font: LoadedFont, fontSize: number): number {
  const halfLeading = (LINE_HEIGHT - font.ascent - font.descent) / 2
  return (halfLeading + font.ascent) * fontSize
}

function keepDrawableCharacters(context: ExportContext, font: LoadedFont, fieldId: string, text: string): string {
  let kept = ''
  for (const character of text) {
    if (font.hasGlyph(character.codePointAt(0)!)) kept += character
    else context.missingCharacters.push({ fieldId, character })
  }
  return kept
}

async function drawText(context: ExportContext, target: PageTarget, field: TextField): Promise<void> {
  if (field.value === '') return
  const font = await context.font(textFont(context, field.style), familyInfo(field.style?.family).subset)
  const { page, box, rotation } = target
  const offset = baselineOffset(font, field.fontSize)
  const color = toPdfColor(field.style?.color, BLACK)

  field.value.split(/\r?\n/).forEach((rawLine, index) => {
    // Some fonts cannot be read for a no-break space, which looks the same as a plain one.
    const line = keepDrawableCharacters(context, font, field.id, rawLine.replaceAll(' ', ' '))
    if (line === '') return
    page.drawText(line, {
      ...displayToPdf(box, rotation, {
        x: field.x,
        y: field.y + index * field.fontSize * LINE_HEIGHT + offset
      }),
      font: font.pdfFont,
      size: field.fontSize,
      color,
      rotate: degrees(rotation)
    })
  })
}

async function drawComb(context: ExportContext, target: PageTarget, field: CombField): Promise<void> {
  if (field.value === '') return
  const font = await context.font(context.fonts.mono)
  const { page, box, rotation } = target
  const baseline = field.y + (field.height - field.fontSize * LINE_HEIGHT) / 2 + baselineOffset(font, field.fontSize)

  Array.from(keepDrawableCharacters(context, font, field.id, field.value)).forEach((character, index) => {
    const width = font.pdfFont.widthOfTextAtSize(character, field.fontSize)
    page.drawText(character, {
      ...displayToPdf(box, rotation, {
        x: field.x + index * field.spacing + (field.spacing - width) / 2,
        y: baseline
      }),
      font: font.pdfFont,
      size: field.fontSize,
      color: BLACK,
      rotate: degrees(rotation)
    })
  })
}

function drawCheckbox({ page, box, rotation }: PageTarget, field: CheckboxField): void {
  if (field.value === null) return
  if (field.value === 'dot') {
    page.drawSvgPath(DOT_PATH, {
      ...displayToPdf(box, rotation, { x: field.x, y: field.y }),
      scale: field.width / MARK_BASE_SIZE,
      color: BLACK,
      rotate: degrees(rotation)
    })
    return
  }
  page.drawSvgPath(field.value === 'tick' ? TICK_PATH : CROSS_PATH, {
    ...displayToPdf(box, rotation, { x: field.x, y: field.y }),
    scale: field.width / MARK_BASE_SIZE,
    borderColor: BLACK,
    borderWidth: MARK_STROKE_WIDTH,
    rotate: degrees(rotation)
  })
}

async function drawImage(context: ExportContext, target: PageTarget, field: ImageField): Promise<void> {
  if (field.assetId === null) return
  const image = await context.image(field.assetId)
  const { page, box, rotation } = target

  // A picture fills its field. A signature keeps its proportions and sits centred.
  const scale = Math.min(field.width / image.width, field.height / image.height)
  const width = field.type === 'PICTURE' ? field.width : image.width * scale
  const height = field.type === 'PICTURE' ? field.height : image.height * scale
  const left = field.x + (field.width - width) / 2
  const top = field.y + (field.height - height) / 2

  page.drawImage(image, {
    ...displayToPdf(box, rotation, { x: left, y: top + height }),
    width,
    height,
    rotate: degrees(rotation)
  })
}
