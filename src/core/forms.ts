import type { Rect, Size } from './geometry'
import type { FormValue, Rotation } from './model'

export interface FormOption {
  value: string
  label: string
}

interface FormWidgetBase {
  id: string
  fieldName: string
  /** Position on the page in points, before rotations added in the editor. */
  rect: Rect
}

export interface FormTextWidget extends FormWidgetBase {
  kind: 'text'
  initial: string
  multiline: boolean
  maxLength: number | null
  /** 0 means the size is chosen to fit the box. */
  fontSize: number
  align: 'left' | 'center' | 'right'
}

export interface FormCheckboxWidget extends FormWidgetBase {
  kind: 'checkbox'
  initial: boolean
}

export interface FormRadioWidget extends FormWidgetBase {
  kind: 'radio'
  initial: string
  /** The value the field takes when this button is chosen. */
  buttonValue: string
}

export interface FormChoiceWidget extends FormWidgetBase {
  kind: 'dropdown' | 'list'
  /** Chosen labels. A field holds the label, which is also what gets printed. */
  initial: string[]
  options: string[]
  multiple: boolean
  /** 0 means the size is chosen to fit the box. */
  fontSize: number
}

export type FormWidget = FormTextWidget | FormCheckboxWidget | FormRadioWidget | FormChoiceWidget

/** The parts of a pdf.js widget annotation that matter here. */
export interface WidgetAnnotation {
  id: string
  subtype?: string
  fieldName?: string
  fieldType?: string
  fieldValue?: unknown
  readOnly?: boolean
  checkBox?: boolean
  radioButton?: boolean
  pushButton?: boolean
  multiLine?: boolean
  combo?: boolean
  multiSelect?: boolean
  maxLen?: number
  textAlignment?: number
  exportValue?: string
  buttonValue?: string
  options?: { exportValue?: string; displayValue?: string }[]
  defaultAppearanceData?: { fontSize?: number }
}

const ALIGNMENTS = ['left', 'center', 'right'] as const

function asStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  return value === undefined || value === null || value === '' ? [] : [String(value)]
}

/**
 * The editable control for a widget, or null for what stays part of the page:
 * read-only fields, push buttons and digital signatures.
 */
export function toFormWidget(annotation: WidgetAnnotation, rect: Rect): FormWidget | null {
  const { id, fieldName, fieldType, fieldValue } = annotation
  if (annotation.subtype !== 'Widget' || !fieldName || annotation.readOnly) return null
  const base = { id, fieldName, rect }

  if (fieldType === 'Tx') {
    return {
      ...base,
      kind: 'text',
      initial: asStrings(fieldValue)[0] ?? '',
      multiline: annotation.multiLine === true,
      maxLength: annotation.maxLen ? annotation.maxLen : null,
      fontSize: annotation.defaultAppearanceData?.fontSize ?? 0,
      align: ALIGNMENTS[annotation.textAlignment ?? 0] ?? 'left'
    }
  }
  if (fieldType === 'Btn') {
    if (annotation.checkBox) {
      return { ...base, kind: 'checkbox', initial: fieldValue !== undefined && fieldValue === annotation.exportValue }
    }
    if (annotation.radioButton && annotation.buttonValue !== undefined) {
      return { ...base, kind: 'radio', initial: asStrings(fieldValue)[0] ?? '', buttonValue: annotation.buttonValue }
    }
    return null
  }
  if (fieldType === 'Ch') {
    const options: FormOption[] = (annotation.options ?? []).map((option) => {
      const value = option.exportValue ?? option.displayValue ?? ''
      return { value, label: option.displayValue ?? value }
    })
    const initial = asStrings(fieldValue).map(
      (value) => options.find((option) => option.value === value)?.label ?? value
    )
    return {
      ...base,
      kind: annotation.combo ? 'dropdown' : 'list',
      initial,
      options: options.map((option) => option.label),
      multiple: annotation.multiSelect === true,
      fontSize: annotation.defaultAppearanceData?.fontSize ?? 0
    }
  }
  return null
}

/** Where a rectangle goes on a page turned clockwise. Unlike a field, it turns with the page. */
export function turnRect(rect: Rect, page: Size, rotation: Rotation): Rect {
  switch (rotation) {
    case 0:
      return rect
    case 90:
      return { x: page.height - rect.y - rect.height, y: rect.x, width: rect.height, height: rect.width }
    case 180:
      return { x: page.width - rect.x - rect.width, y: page.height - rect.y - rect.height, width: rect.width, height: rect.height }
    case 270:
      return { x: rect.y, y: page.width - rect.x - rect.width, width: rect.height, height: rect.width }
  }
}

export function currentFormValue(widget: FormWidget, values: Record<string, FormValue> | undefined): FormValue {
  return values?.[widget.fieldName] ?? widget.initial
}

/** The size printed when a field leaves it to fit the box. */
export function automaticFontSize(height: number, multiline: boolean): number {
  return multiline ? 12 : Math.min(Math.max(height * 0.7, 4), 24)
}
