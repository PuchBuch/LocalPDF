import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error A plain script without types.
import { parseMessages, readCsv, replaceMessages, reviewRows, writeCsv } from '../scripts/i18n-lib.mjs'

const I18N = resolve(__dirname, '../src/renderer/src/i18n')
const LANGUAGES = ['ru', 'en', 'de', 'fr', 'es', 'it', 'pl', 'uk']
const read = (language: string) => readFileSync(join(I18N, `${language}.ts`), 'utf8')

interface Entry {
  key: string
  kind: 'text' | 'template' | 'code'
  text: string
}

describe('review files of the translations', () => {
  it.each(LANGUAGES)('read every text of %s, and writing them back changes nothing', (language) => {
    const source = read(language)
    const entries: Entry[] = parseMessages(source)
    expect(entries.length).toBeGreaterThan(150)
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length)
    expect(replaceMessages(source, new Map(entries.map((entry) => [entry.key, entry.text])))).toBe(source)
  })

  it('show texts plainly and placeholders by name', () => {
    const entries = new Map((parseMessages(read('de')) as Entry[]).map((entry) => [entry.key, entry]))
    expect(entries.get('dialogs.save')).toMatchObject({ kind: 'text', text: 'Speichern' })
    expect(entries.get('pageOf')).toMatchObject({ kind: 'template', text: 'Seite {page} von {total}' })
    expect(entries.get('thumbnailMenu.clearFields')?.kind).toBe('code')
  })

  it('change only the corrected line', () => {
    const source = read('de')
    const changed = replaceMessages(
      source,
      new Map([
        ['dialogs.save', 'Sichern'],
        ['pageOf', 'Seite {page} von insgesamt {total}']
      ])
    )
    const before = source.split('\n')
    const after = changed.split('\n')
    expect(after).toHaveLength(before.length)
    const different = before.flatMap((line, index) => (line === after[index] ? [] : [after[index]!.trim()]))
    expect(different).toEqual(["save: 'Sichern',", 'pageOf: (page, total) => `Seite ${page} von insgesamt ${total}`,'])
  })

  it('escape quotes and keep a placeholder the template does not have from being one', () => {
    const source = "export const x: Messages = {\n  a: 'A',\n  b: (n) => `B ${n}`\n}\n"
    const changed = replaceMessages(source, new Map([['a', "it's \\ fine"]]))
    expect(changed).toContain("a: 'it\\'s \\\\ fine',")
    expect(parseMessages(changed)[0].text).toBe("it's \\ fine")
    expect(() => replaceMessages(source, new Map([['b', 'B {m}']]))).toThrow(/\{m\}/)
    expect(() => replaceMessages(source, new Map([['c', 'C']]))).toThrow(/no entry c/)
  })

  it('read and write CSV with semicolons, quotes and line breaks in a text', () => {
    const rows = [
      ['key', 'kind', 'English', 'Deutsch', 'correction', 'status'],
      ['a', 'text', 'One; two', 'Ein "Zitat"', 'Zeile 1\nZeile 2', 'machine']
    ]
    const csv = writeCsv(rows)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(readCsv(csv)).toEqual(rows)
  })

  it('keep a reviewer’s mark while the translation stays the same', () => {
    const english = [{ key: 'a', kind: 'text', text: 'Save' }, { key: 'b', kind: 'text', text: 'Open' }]
    const before = [
      ['key', 'kind', 'English', 'Deutsch', 'correction', 'status'],
      ['a', 'text', 'Save', 'Speichern', '', 'ok'],
      ['b', 'text', 'Open', 'Offnen', '', 'ok']
    ]
    const rows = reviewRows(english, [{ key: 'a', kind: 'text', text: 'Speichern' }, { key: 'b', kind: 'text', text: 'Öffnen' }], 'de', before)
    expect(rows.map((row: string[]) => row[5])).toEqual(['status', 'ok', 'machine'])
  })
})
