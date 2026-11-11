import { describe, expect, it } from 'vitest'
import { buildPrompt, nearestLabel, parseAnswer, type FieldForAi } from '../src/core/aiBridge'
import type { NumberedField } from '../src/core/fields'

const box = { x: 200, y: 100, width: 150, height: 16 }
const field = (number: number, type: NumberedField['type'], extra: Partial<FieldForAi> = {}): FieldForAi => ({
  number,
  pageId: 'p',
  target: { kind: 'form', sourceId: 's', fieldName: `f${number}`, widgetId: `w${number}` },
  type,
  name: `f${number}`,
  value: '',
  box,
  label: '',
  ...extra
})
const fields: FieldForAi[] = [
  field(1, 'text', { name: 'Name', label: 'Vorname, Name' }),
  field(2, 'checkbox', { name: 'Agree' }),
  field(3, 'radio', { options: ['Yes', 'No'] }),
  field(4, 'choice', { options: ['Berlin', 'Köln'], multiple: false }),
  field(5, 'signature', { target: { kind: 'added', fieldId: 'sig' } }),
  field(6, 'cells', { target: { kind: 'added', fieldId: 'cells' } })
]

describe('finding the label of a field', () => {
  const line = (text: string, x: number, baseline: number, width = 80) => ({ text, x, baseline, width, height: 10 })

  it('takes the nearest text to the left on the same level', () => {
    expect(nearestLabel(box, [line('Far away', 10, 112), line('Vorname:', 110, 112), line('Other row', 110, 160)])).toBe('Vorname:')
  })

  it('takes text just above when nothing is to the left', () => {
    expect(nearestLabel(box, [line('Straße, Hausnummer', 200, 96, 120), line('Title', 200, 30)])).toBe('Straße, Hausnummer')
  })

  it('is empty when text is too far, or on the other side', () => {
    expect(nearestLabel(box, [line('Right side', 400, 112), line('Much higher', 200, 40)])).toBe('')
  })
})

describe('the text for the AI', () => {
  it('lists each field it can fill by number, with type, name, label and choices', () => {
    const prompt = buildPrompt(fields, 'Fill in the form. Answer with JSON only.')
    const lines = prompt.split('\n')
    expect(lines[0]).toBe('Fill in the form. Answer with JSON only.')
    expect(lines).toContain('1 | text | "Name" | label "Vorname, Name"')
    expect(lines).toContain('2 | checkbox | "Agree" | true/false')
    expect(lines).toContain('3 | radio | "f3" | one of: "Yes", "No"')
    // A signature is signed by hand.
    expect(prompt).not.toContain('signature')
  })
})

describe('reading the answer', () => {
  it('fills from plain JSON, and from JSON in a code block among other words', () => {
    const plain = parseAnswer('{"1": "Anna Muster", "2": true, "4": "köln"}', fields)
    expect(plain.errors).toEqual([])
    expect(plain.applied.map(({ number, value }) => [number, value])).toEqual([
      [1, 'Anna Muster'],
      [2, true],
      [4, ['Köln']]
    ])
    const chatty = parseAnswer('Here you go:\n```json\n{"3": "No", "6": 12345}\n```\nAnything else?', fields)
    expect(chatty.applied.map(({ number, value }) => [number, value])).toEqual([
      [3, 'No'],
      [6, '12345']
    ])
  })

  it('reports each wrong field and still fills the rest', () => {
    const answer = parseAnswer('{"1": "Anna", "2": "yes", "3": "Maybe", "5": "Anna", "9": "x", "4": null}', fields)
    expect(answer.applied.map(({ number }) => number)).toEqual([1])
    expect(answer.answered).toBe(5)
    expect(answer.errors).toEqual([
      { problem: 'expectedBoolean', number: '2', got: 'yes' },
      { problem: 'notAnOption', number: '3', got: 'Maybe' },
      { problem: 'manualOnly', number: '5', got: 'Anna' },
      { problem: 'unknownField', number: '9' }
    ])
  })

  it('takes text in text fields whatever it says, and refuses true there', () => {
    const answer = parseAnswer('{"1": "notAnOption", "6": true}', fields)
    expect(answer.applied.map(({ value }) => value)).toEqual(['notAnOption'])
    expect(answer.errors).toEqual([{ problem: 'expectedText', number: '6', got: 'true' }])
  })

  it('never throws, whatever is pasted', () => {
    expect(parseAnswer('   ', fields).errors).toEqual([{ problem: 'empty' }])
    expect(parseAnswer('Sorry, I cannot help with that.', fields).errors).toEqual([{ problem: 'notJson' }])
    expect(parseAnswer('{"1": "unfinished', fields).errors).toEqual([{ problem: 'notJson' }])
    expect(parseAnswer('["Anna", true]', fields).errors).toEqual([{ problem: 'notObject' }])
    expect(parseAnswer('null', fields).errors).toEqual([{ problem: 'notObject' }])
  })
})
