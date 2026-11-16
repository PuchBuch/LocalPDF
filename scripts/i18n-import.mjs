// Takes the corrections from a review file back into the language's texts. Only the rows
// with something in the "correction" column change; each then has the corrected text as its
// translation and the status "fixed". Run the i18n test afterwards: npx vitest run i18n
//
//   node scripts/i18n-import.mjs docs/i18n-review/de.csv [--dry-run]
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { HEADER, parseMessages, placeholders, readCsv, replaceMessages, writeCsv } from './i18n-lib.mjs'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const file = args.find((arg) => !arg.startsWith('--'))
if (!file) {
  console.error('Give a review file, such as docs/i18n-review/de.csv.')
  process.exit(1)
}

const language = basename(file, '.csv')
const target = join('src/renderer/src/i18n', `${language}.ts`)
const rows = readCsv(await readFile(file, 'utf8'))
if (rows[0]?.join(';') !== HEADER(language).join(';')) {
  console.error(`${file} does not start with the row ${HEADER(language).join(';')}.`)
  process.exit(1)
}

const source = await readFile(target, 'utf8')
const entries = new Map(parseMessages(source).map((entry) => [entry.key, entry]))
const changes = new Map()
const problems = []
for (const [key, kind, , translation, correction] of rows.slice(1)) {
  if (!correction?.trim()) continue
  const entry = entries.get(key)
  if (!entry) problems.push(`${key}: no such text in ${target}.`)
  else if (entry.kind !== kind) problems.push(`${key}: the file says ${kind}, the texts now say ${entry.kind}. Export again.`)
  else if (entry.text !== translation) problems.push(`${key}: the translation changed since the export. Export again.`)
  else if (kind === 'template' && placeholders(correction).join() !== placeholders(entry.text).join()) {
    problems.push(`${key}: the correction must keep {${placeholders(entry.text).join('}, {')}}, no more and no fewer.`)
  } else changes.set(key, correction.trim())
}
if (problems.length) {
  console.error(`Nothing was changed:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
if (changes.size === 0) {
  console.log(`No corrections in ${file}.`)
  process.exit(0)
}

for (const [key, text] of changes) console.log(`${key}:\n  - ${entries.get(key).text}\n  + ${text}`)
if (dryRun) {
  console.log(`\nDry run: ${changes.size} corrections would go into ${target}; nothing was written.`)
  process.exit(0)
}

await writeFile(target, replaceMessages(source, changes))
const updated = rows.map((row, index) => {
  if (index === 0 || !changes.has(row[0])) return row
  return [row[0], row[1], row[2], changes.get(row[0]), '', 'fixed']
})
await writeFile(file, writeCsv(updated))
console.log(`\n${changes.size} corrections went into ${target}. Now run: npx vitest run i18n`)
