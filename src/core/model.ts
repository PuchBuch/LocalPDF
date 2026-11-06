import type { FontFamily } from './fonts'
import type { Rect } from './geometry'

export type Rotation = 0 | 90 | 180 | 270

/**
 * Field coordinates are in PDF points, measured from the top-left corner of the
 * page as it is displayed, after every rotation has been applied.
 */
export interface FieldBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  background: 'transparent' | 'white'
}

/** Each part from 0 to 255. */
export interface RgbColor {
  r: number
  g: number
  b: number
}

/** The look of text. Fields without one are black and regular. */
export interface TextStyle {
  bold: boolean
  italic: boolean
  color: RgbColor
  /** Arial-like when not set. */
  family?: FontFamily
}

/** An area of the page painted over, in the given colour or else white. */
export interface TextCover extends Rect {
  color?: RgbColor
}

export interface TextField extends FieldBase {
  type: 'TEXT'
  value: string
  fontSize: number
  style?: TextStyle
  /**
   * For a field that replaces a line of the page: the area of that line, painted over.
   * It stays there when the field is moved, and goes when the field is deleted.
   */
  cover?: TextCover
}

export interface CheckboxField extends FieldBase {
  type: 'CHECKBOX'
  value: 'tick' | 'cross' | 'dot' | null
}

export interface ImageField extends FieldBase {
  type: 'SIGNATURE' | 'PICTURE'
  assetId: string | null
}

export interface CombField extends FieldBase {
  type: 'COMB_TEXT'
  value: string
  fontSize: number
  /** Cell width in points. */
  spacing: number
}

export type Field = TextField | CheckboxField | ImageField | CombField

/** A word read from a picture of a page, in points, before rotations added in the editor. */
export interface OcrWord extends Rect {
  text: string
  baseline: number
  fontSize: number
}

/** A page in the editor. It only points at a source page, the source itself never changes. */
export interface PageRef {
  id: string
  sourceId: string
  pageIndex: number
  /** Rotation added in the editor, on top of the source page's own /Rotate. */
  rotation: Rotation
  fields: Field[]
  /** The text of a scanned page, once recognized. */
  ocr?: OcrWord[]
}

export interface PdfSource {
  name: string
  bytes: Uint8Array
}

export interface ImageAsset {
  mime: 'image/png' | 'image/jpeg'
  bytes: Uint8Array
}

export type FormValue = string | boolean | string[]

export interface EditorDocument {
  sources: Record<string, PdfSource>
  /** Values of the source's own AcroForm fields, by source id and field name. */
  formValues: Record<string, Record<string, FormValue>>
  assets: Record<string, ImageAsset>
  pages: PageRef[]
}
