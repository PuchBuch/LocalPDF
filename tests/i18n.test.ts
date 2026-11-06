import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { de } from '../src/renderer/src/i18n/de'
import { en } from '../src/renderer/src/i18n/en'
import { es } from '../src/renderer/src/i18n/es'
import { fr } from '../src/renderer/src/i18n/fr'
import { it as italian } from '../src/renderer/src/i18n/it'
import { pl } from '../src/renderer/src/i18n/pl'
import { ru } from '../src/renderer/src/i18n/ru'
import { uk } from '../src/renderer/src/i18n/uk'

const LOCALES = { en, de, fr, es, it: italian, pl, uk, ru }
const CYRILLIC = /[А-Яа-яЁёІіЇїЄєҐґ]/

/** Every text of a language, by its path, with functions called on sample arguments. */
function flatten(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  if (typeof value === 'function') {
    const fn = value as (...args: unknown[]) => unknown
    return [[path, String(fn(3, 7))]]
  }
  return Object.entries(value as object).flatMap(([key, item]) => flatten(item, path ? `${path}.${key}` : key))
}

const paths = (messages: unknown) => flatten(messages).map(([path]) => path).sort()

describe.each(Object.entries(LOCALES))('the %s texts', (name, messages) => {
  it('have every entry the Russian ones have, and no other', () => {
    expect(paths(messages)).toEqual(paths(ru))
  })

  it('have no empty entry', () => {
    for (const [path, text] of flatten(messages)) expect(text.trim(), path).not.toBe('')
  })

  it('are written in the right alphabet', () => {
    const cyrillicLanguage = name === 'ru' || name === 'uk'
    for (const [path, text] of flatten(messages)) {
      if (!cyrillicLanguage) expect(CYRILLIC.test(text), `${path}: ${text}`).toBe(false)
    }
    expect(CYRILLIC.test(messages.selectFile)).toBe(cyrillicLanguage)
  })

  it('say what numbers and names they are given', () => {
    expect(messages.pageOf(3, 7)).toContain('3')
    expect(messages.pageOf(3, 7)).toContain('7')
    expect(messages.savedAs('x.pdf')).toContain('x.pdf')
    expect(messages.fileUnreadable('x.pdf')).toContain('x.pdf')
    expect(messages.thumbnailMenu.deleteFields(4)).toContain('(4)')
    expect(messages.dialogs.incomingMessage).toContain('{names}')
  })
})

it('no text in the main process or the components is left outside the language files', () => {
  const root = resolve(__dirname, '../src')
  for (const file of ['main/index.ts', 'renderer/src/App.tsx', 'renderer/src/editor/FieldView.tsx', 'renderer/src/pageTools.ts']) {
    expect(CYRILLIC.test(readFileSync(join(root, file), 'utf8')), file).toBe(false)
  }
})
