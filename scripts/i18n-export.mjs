// Writes the texts of the interface as review files, for a native speaker to read through:
// docs/i18n-review/<language>.csv, one row per text: key; kind; English; translation;
// correction; status. Statuses already set there are kept while the text stays the same.
//
//   node scripts/i18n-export.mjs [de ru uk]
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LANGUAGE_NAMES, parseMessages, readCsv, reviewRows, writeCsv } from './i18n-lib.mjs'

const I18N = 'src/renderer/src/i18n'
const OUT = 'docs/i18n-review'
const languages = process.argv.slice(2).length ? process.argv.slice(2) : ['de', 'ru', 'uk']

const english = parseMessages(await readFile(join(I18N, 'en.ts'), 'utf8'))
await mkdir(OUT, { recursive: true })
for (const language of languages) {
  if (!LANGUAGE_NAMES[language]) throw new Error(`${language} is not one of ${Object.keys(LANGUAGE_NAMES).join(', ')}.`)
  const file = join(OUT, `${language}.csv`)
  const previous = existsSync(file) ? readCsv(await readFile(file, 'utf8')) : []
  const translated = parseMessages(await readFile(join(I18N, `${language}.ts`), 'utf8'))
  const rows = reviewRows(english, translated, language, previous)
  await writeFile(file, writeCsv(rows))
  const unchecked = rows.filter((row) => row[5] === 'machine').length
  console.log(`${file}: ${rows.length - 1} texts, ${unchecked} not yet checked by a native speaker.`)
}
