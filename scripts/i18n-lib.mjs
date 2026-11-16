// Reads the texts of a language from its file in src/renderer/src/i18n and writes changed
// ones back, touching nothing else in the file. Used by i18n-export.mjs and i18n-import.mjs.
//
// A text is one of three kinds:
//   text      'Speichern'                          -> Speichern
//   template  (page, total) => `Seite ${page} …`   -> Seite {page} …
//   code      anything else, such as a choice of word forms, shown as written

/** Every entry of the messages object, with where its value lies in the source. */
export function parseMessages(source) {
  const start = source.search(/export const \w+(: Messages)? = \{/)
  if (start < 0) throw new Error('No "export const … = {" in the file.')
  const entries = []
  const path = []
  let i = source.indexOf('{', start) + 1

  while (i < source.length) {
    i = skipSpace(source, i)
    const char = source[i]
    if (char === '}') {
      if (path.length === 0) return entries
      path.pop()
      i = skipSpace(source, i + 1)
      if (source[i] === ',') i++
      continue
    }
    const key = /^(?:(\w+)|'([^']*)'|"([^"]*)")\s*:/.exec(source.slice(i, i + 200))
    if (!key) throw new Error(`Cannot read the entry at line ${lineOf(source, i)}.`)
    const name = key[1] ?? key[2] ?? key[3]
    i = skipSpace(source, i + key[0].length)
    if (source[i] === '{') {
      path.push(name)
      i++
      continue
    }
    const end = skipExpression(source, i)
    entries.push({ key: [...path, name].join('.'), start: i, end, ...classify(source.slice(i, end)) })
    i = skipSpace(source, end)
    if (source[i] === ',') i++
  }
  throw new Error('The messages object never ends.')
}

/** The source with the value of each key replaced: a text or template as text, code as written. */
export function replaceMessages(source, changes) {
  const entries = new Map(parseMessages(source).map((entry) => [entry.key, entry]))
  const edits = []
  for (const [key, text] of changes) {
    const entry = entries.get(key)
    if (!entry) throw new Error(`There is no entry ${key}.`)
    edits.push({ start: entry.start, end: entry.end, value: valueSource(entry, text) })
  }
  edits.sort((a, b) => b.start - a.start)
  let result = source
  for (const edit of edits) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end)
  return result
}

/** The placeholders a template uses, such as ["page", "total"], sorted. */
export function placeholders(text) {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort()
}

function classify(raw) {
  const literal = readLiteral(raw, 0)
  if (literal && literal.end === raw.length && literal.quote !== '`') return { kind: 'text', text: literal.text, raw }

  const arrow = /^\(([^()]*)\)\s*=>\s*/.exec(raw) ?? /^(\w+)\s*=>\s*/.exec(raw)
  if (arrow) {
    const params = arrow[1].split(',').map((param) => param.split(':')[0].trim()).filter(Boolean)
    const body = readLiteral(raw, arrow[0].length)
    const simple = body && body.end === raw.length && body.expressions.every((expression) => params.includes(expression))
    if (simple && !/\{\w+\}/.test(body.quote === '`' ? body.text.replace(/\$\{\w+\}/g, '') : body.text)) {
      return { kind: 'template', text: body.text.replace(/\$\{(\w+)\}/g, '{$1}'), raw, params, bodyStart: arrow[0].length, quote: body.quote }
    }
  }
  return { kind: 'code', text: raw, raw }
}

function valueSource(entry, text) {
  if (entry.kind === 'code') return text
  if (entry.kind === 'text') return quote(text, entry.raw[0])
  const unknown = placeholders(text).filter((name) => !entry.params.includes(name))
  if (unknown.length) throw new Error(`${entry.key}: {${unknown.join('}, {')}} is not one of {${entry.params.join('}, {')}}.`)
  const usesPlaceholders = placeholders(text).length > 0
  const body = usesPlaceholders || entry.quote === '`' ? templateLiteral(text, entry.params) : quote(text, entry.quote)
  return entry.raw.slice(0, entry.bodyStart) + body
}

function quote(text, mark) {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').split(mark).join(`\\${mark}`)
  return mark + escaped + mark
}

function templateLiteral(text, params) {
  const escaped = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
  return '`' + escaped.replace(/\{(\w+)\}/g, (whole, name) => (params.includes(name) ? `\${${name}}` : whole)) + '`'
}

/** A string or template literal at this place: its text, its quote and the names it puts in. */
function readLiteral(source, start) {
  const mark = source[start]
  if (mark !== "'" && mark !== '"' && mark !== '`') return null
  let text = ''
  const expressions = []
  let i = start + 1
  while (i < source.length) {
    const char = source[i]
    if (char === mark) return { text, quote: mark, expressions, end: i + 1 }
    if (char === '\\') {
      const escape = /^\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/.exec(source.slice(i, i + 12))
      text += unescape(escape[1])
      i += escape[0].length
      continue
    }
    if (mark === '`' && source.startsWith('${', i)) {
      const end = skipExpression(source, i + 2, '}')
      const expression = source.slice(i + 2, end).trim()
      expressions.push(expression)
      text += `\${${expression}}`
      i = end + 1
      continue
    }
    text += char
    i++
  }
  return null
}

function unescape(code) {
  if (code.startsWith('u{')) return String.fromCodePoint(parseInt(code.slice(2, -1), 16))
  if (code.length > 1 && (code[0] === 'u' || code[0] === 'x')) return String.fromCharCode(parseInt(code.slice(1), 16))
  return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[code] ?? code
}

/** Where an expression ends: at a comma or closing brace outside any brackets, strings and comments. */
function skipExpression(source, start, closer) {
  let depth = 0
  let i = start
  while (i < source.length) {
    const char = source[i]
    if (char === "'" || char === '"' || char === '`') {
      i = readLiteral(source, i).end
      continue
    }
    if (source.startsWith('//', i)) {
      i = source.indexOf('\n', i)
      continue
    }
    if (source.startsWith('/*', i)) {
      i = source.indexOf('*/', i) + 2
      continue
    }
    if (depth === 0 && (closer ? char === closer : char === ',' || char === '}')) {
      let end = i
      while (end > start && /\s/.test(source[end - 1])) end--
      return closer ? i : end
    }
    if ('([{'.includes(char)) depth++
    if (')]}'.includes(char)) depth--
    i++
  }
  throw new Error('An expression never ends.')
}

function skipSpace(source, start) {
  let i = start
  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i++
    if (source.startsWith('//', i)) i = source.indexOf('\n', i)
    else if (source.startsWith('/*', i)) i = source.indexOf('*/', i) + 2
    else return i
  }
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

/* CSV with semicolons, as German Excel opens it, and a byte order mark so it reads UTF-8. */

export function readCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const input = text.replace(/^﻿/, '')
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ';') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((cell) => cell !== ''))
}

export function writeCsv(rows) {
  const cell = (value) => (/[;"\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value)
  return '﻿' + rows.map((row) => row.map(cell).join(';')).join('\r\n') + '\r\n'
}

export const LANGUAGE_NAMES = {
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  pl: 'Polski',
  uk: 'Українська',
  ru: 'Русский'
}

export const HEADER = (language) => ['key', 'kind', 'English', LANGUAGE_NAMES[language], 'correction', 'status']

/** The rows of a review file, keeping what a reviewer marked where the text is still the same. */
export function reviewRows(english, translated, language, previous = []) {
  const before = new Map(previous.slice(1).map((row) => [row[0], row]))
  const englishByKey = new Map(english.map((entry) => [entry.key, entry]))
  const rows = [HEADER(language)]
  for (const entry of translated) {
    const old = before.get(entry.key)
    const kept = old && old[3] === entry.text && (old[5] === 'ok' || old[5] === 'fixed') ? old[5] : 'machine'
    rows.push([entry.key, entry.kind, englishByKey.get(entry.key)?.text ?? '', entry.text, '', kept])
  }
  return rows
}
