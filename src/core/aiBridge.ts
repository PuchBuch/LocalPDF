import type { NumberedField, NumberedFieldType } from './fields'
import type { Rect } from './geometry'
import type { FormValue } from './model'
import type { PageTextRun } from './textLines'

/**
 * Filling a form through any AI chat, without the network: the fields go out as numbered
 * text on the clipboard, and the answer comes back as JSON pasted in. Nothing here throws.
 */

/** A field as the AI is told about it, with the text printed next to it on the page. */
export interface FieldForAi extends NumberedField {
  label: string
}

/** A value to put in a field, already checked against what the field takes. */
export interface AppliedValue {
  number: number
  target: NumberedField['target']
  /** For a field the editor added: text, or whether its box is ticked. For a form field: its form value. */
  value: FormValue
}

export type AnswerProblem =
  | 'empty'
  | 'notJson'
  | 'notObject'
  | 'unknownField'
  | 'manualOnly'
  | 'expectedText'
  | 'expectedBoolean'
  | 'notAnOption'

export interface AnswerError {
  problem: AnswerProblem
  /** The field number as the answer gave it, when the problem is with one field. */
  number?: string
  /** What the answer gave, shortened, when it was the wrong kind of value. */
  got?: string
}

export interface ParsedAnswer {
  applied: AppliedValue[]
  errors: AnswerError[]
  /** How many fields the answer tried to fill. */
  answered: number
}

/** Fields filled only by hand: the AI is not asked about them. */
const MANUAL_ONLY: NumberedFieldType[] = ['signature', 'picture']
/** A label further than this from its field, in points, belongs to something else. */
const MAX_LABEL_GAP_LEFT = 220
const MAX_LABEL_GAP_ABOVE = 30
const MAX_LABEL_LENGTH = 80
const MAX_GOT_LENGTH = 40

/**
 * The text that names a field on the page: the nearest line ending to its left on the same
 * level, or the nearest line just above it. Empty when there is none close by.
 */
export function nearestLabel(box: Rect, lines: PageTextRun[]): string {
  let best: { text: string; gap: number } | null = null
  for (const line of lines) {
    const text = line.text.trim()
    if (!text) continue
    const top = line.baseline - line.height
    const right = line.x + line.width
    const level = top < box.y + box.height && line.baseline > box.y
    const leftGap = box.x - right
    if (level && leftGap >= -2 && leftGap <= MAX_LABEL_GAP_LEFT && (!best || leftGap < best.gap)) {
      best = { text, gap: leftGap }
      continue
    }
    const aboveGap = box.y - line.baseline
    const overlapsAcross = line.x < box.x + box.width && right > box.x
    // A line above counts a little further than one to the left, so that the left one wins a tie.
    if (overlapsAcross && aboveGap >= -2 && aboveGap <= MAX_LABEL_GAP_ABOVE && (!best || aboveGap * 2 < best.gap)) {
      best = { text, gap: aboveGap * 2 }
    }
  }
  return best ? best.text.slice(0, MAX_LABEL_LENGTH) : ''
}

const quote = (text: string) => JSON.stringify(text)

function describe(field: FieldForAi): string {
  const parts = [String(field.number), field.type, quote(field.name)]
  if (field.label) parts.push(`label ${quote(field.label)}`)
  if (field.type === 'checkbox') parts.push('true/false')
  if (field.options) {
    parts.push(`${field.multiple ? 'list of' : 'one of'}: ${field.options.map(quote).join(', ')}`)
  }
  if (field.value) parts.push(`now ${quote(field.value)}`)
  return parts.join(' | ')
}

/** The text to paste into an AI chat: what to do, then one numbered line per field it can fill. */
export function buildPrompt(fields: FieldForAi[], instructions: string): string {
  const fillable = fields.filter((field) => !MANUAL_ONLY.includes(field.type))
  return [instructions, '', ...fillable.map(describe)].join('\n')
}

/** The JSON in an answer: the whole of it, a ```json block in it, or the outermost braces in it. */
function jsonIn(text: string): string {
  const block = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (block) return block[1]!.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text.trim()
}

const shorten = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > MAX_GOT_LENGTH ? `${text.slice(0, MAX_GOT_LENGTH - 1)}…` : text
}

/** An option as written, or as written in other letter case. */
function matchOption(options: string[], wanted: string): string | undefined {
  return options.find((option) => option === wanted) ?? options.find((option) => option.toLowerCase() === wanted.trim().toLowerCase())
}

type Checked = { value: FormValue } | { problem: AnswerProblem }

function checkValue(field: NumberedField, value: unknown): Checked {
  switch (field.type) {
    case 'signature':
    case 'picture':
      return { problem: 'manualOnly' }
    case 'text':
    case 'cells':
      if (typeof value === 'string') return { value }
      return typeof value === 'number' ? { value: String(value) } : { problem: 'expectedText' }
    case 'checkbox':
      return typeof value === 'boolean' ? { value } : { problem: 'expectedBoolean' }
    case 'radio': {
      const chosen = typeof value === 'string' && field.options ? matchOption(field.options, value) : undefined
      return chosen === undefined ? { problem: 'notAnOption' } : { value: chosen }
    }
    case 'choice': {
      const wanted = Array.isArray(value) ? value : [value]
      if (!field.multiple && wanted.length !== 1) return { problem: 'notAnOption' }
      const chosen = wanted.map((item) => (typeof item === 'string' && field.options ? matchOption(field.options, item) : undefined))
      return chosen.every((item) => item !== undefined) ? { value: chosen as string[] } : { problem: 'notAnOption' }
    }
  }
}

/**
 * Reads an answer pasted back from the AI. Every field it names is checked: what fits is
 * returned to apply, and everything else becomes an error for that field. A missing value
 * (null) leaves the field as it is.
 */
export function parseAnswer(text: string, fields: NumberedField[]): ParsedAnswer {
  const none = (problem: AnswerProblem): ParsedAnswer => ({ applied: [], errors: [{ problem }], answered: 0 })
  if (!text.trim()) return none('empty')
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonIn(text))
  } catch {
    return none('notJson')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return none('notObject')

  const byNumber = new Map(fields.map((field) => [field.number, field]))
  const applied: AppliedValue[] = []
  const errors: AnswerError[] = []
  let answered = 0
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined) continue
    answered++
    const number = /^\s*#?(\d+)\s*$/.exec(key)?.[1]
    const field = number ? byNumber.get(Number(number)) : undefined
    if (!field) {
      errors.push({ problem: 'unknownField', number: key.trim() })
      continue
    }
    const checked = checkValue(field, value)
    if ('problem' in checked) errors.push({ problem: checked.problem, number: String(field.number), got: shorten(value) })
    else applied.push({ number: field.number, target: field.target, value: checked.value })
  }
  return { applied, errors, answered }
}

