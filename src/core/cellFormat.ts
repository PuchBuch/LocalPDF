/** The formats of Excel that a file names only by number. The two dates follow the language. */
const BUILT_IN: Record<number, string> = {
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  37: '#,##0',
  38: '#,##0',
  39: '#,##0.00',
  40: '#,##0.00',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mm:ss'
}
const LOCAL_DATE = 14
const LOCAL_DATE_TIME = 22

const DAY_MS = 86_400_000
/** Day 0 of the calendar serial numbers count from, and the days a 1904 calendar starts later. */
const FIRST_DAY = Date.UTC(1899, 11, 30)
const DAYS_TO_1904 = 1462
/** As many digits as a spreadsheet keeps, which hides that 0.1 and 0.2 make a little more than 0.3. */
const DIGITS = 15

const TOKEN = /"[^"]*"|\\.|\[[^\]]*\]|[_*].|AM\/PM|A\/P|y+|m+|d+|h+|s+|./gi

export interface CellFormat {
  id: number
  /** For a format of the file's own, such as dd.mm.yyyy. */
  code?: string
}

export interface FormatSettings {
  locale: string
  /** The file counts its days from 1904, as older Mac files do. */
  from1904: boolean
}

/** The part of a format for ordinary numbers, up to the first semicolon that is not quoted. */
function firstSection(code: string): string {
  return /^(?:"[^"]*"|\\.|[^;"\\])*/.exec(code)![0]
}

const tokensOf = (code: string) => firstSection(code).match(TOKEN) ?? []
const isDatePart = (token: string) => /^(?:y+|m+|d+|h+|s+|\[(?:h+|m+|s+)\])$/i.test(token)

/** What a token of a format shows as it is, such as a quoted unit. Null for a placeholder. */
function literalOf(token: string): string | null {
  if (token.startsWith('"')) return token.slice(1, -1)
  if (token.startsWith('\\') && token.length > 1) return token.slice(1)
  if (token.startsWith('[') && token.length > 1) return /^\[\$([^\]-]*)/.exec(token)?.[1] ?? ''
  if (/^[_*]./.test(token)) return ''
  return null
}

function formatDate(serial: number, tokens: string[], locale: string): string {
  const seconds = Math.round(serial * 86_400)
  const date = new Date(FIRST_DAY + seconds * 1000)
  const pad = (value: number, length: number) => String(value).padStart(length, '0')
  const named = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date)
  const parts = tokens.map((token) => (isDatePart(token) ? token.toLowerCase() : ''))
  const twelveHours = tokens.some((token) => /^(?:AM\/PM|A\/P)$/i.test(token))
  const kindBefore = (index: number) => parts.slice(0, index).filter((part) => part !== '').at(-1)?.replace('[', '')[0]
  const kindAfter = (index: number) => parts.slice(index + 1).find((part) => part !== '')?.[0]

  return tokens
    .map((token, index) => {
      const part = parts[index]!
      const length = part.length
      switch (part[0]) {
        case 'y':
          return length > 2 ? String(date.getUTCFullYear()) : pad(date.getUTCFullYear() % 100, 2)
        case 'd':
          if (length > 2) return named({ weekday: length > 3 ? 'long' : 'short' })
          return pad(date.getUTCDate(), length)
        case 'h':
          return pad(twelveHours ? date.getUTCHours() % 12 || 12 : date.getUTCHours(), Math.min(length, 2))
        case 's':
          return pad(date.getUTCSeconds(), Math.min(length, 2))
        case 'm':
          // The same letter is a month, or minutes beside hours or seconds.
          if (length <= 2 && (kindBefore(index) === 'h' || kindAfter(index) === 's')) return pad(date.getUTCMinutes(), length)
          if (length > 2) return named({ month: length > 3 ? 'long' : 'short' })
          return pad(date.getUTCMonth() + 1, length)
        case '[': {
          const unit = { h: 3600, m: 60, s: 1 }[part[1] as 'h' | 'm' | 's']
          return pad(Math.floor(seconds / unit), length - 2)
        }
      }
      if (/^AM\/PM$/i.test(token)) return date.getUTCHours() < 12 ? 'AM' : 'PM'
      if (/^A\/P$/i.test(token)) return date.getUTCHours() < 12 ? 'A' : 'P'
      return literalOf(token) ?? token
    })
    .join('')
    .trim()
}

function localDate(serial: number, locale: string, time: boolean): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'UTC'
  }).format(new Date(FIRST_DAY + Math.round(serial * 86_400) * 1000))
}

function plainNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: DIGITS }).format(Number(value.toPrecision(DIGITS)))
}

/** A number as its format shows it, or null for a format that is not understood. */
function formatNumber(value: number, tokens: string[], locale: string): string | null {
  let prefix = ''
  let pattern = ''
  let suffix = ''
  let percent = false
  for (const token of tokens) {
    if (/^[0#?.,]$/.test(token)) {
      // Digits with text between them, as in telephone numbers, are left alone.
      if (suffix !== '') return null
      pattern += token
      continue
    }
    if (token === '%') percent = true
    const literal = literalOf(token) ?? token
    // Fractions and powers of ten.
    if (pattern !== '' && /^[/E@]$/i.test(token)) return null
    if (pattern === '') prefix += literal
    else suffix += literal
  }
  const match = /^([0#?,]*)(?:\.([0#?]*))?$/.exec(pattern)
  if (!match || !/[0#?]/.test(pattern) || match[1]!.endsWith(',')) return null
  const [, whole = '', fraction = ''] = match
  const size = Number((Math.abs(value) * (percent ? 100 : 1)).toPrecision(DIGITS))
  const shown = new Intl.NumberFormat(locale, {
    useGrouping: whole.includes(','),
    minimumIntegerDigits: Math.min(21, Math.max(1, whole.replace(/[^0]/g, '').length)),
    minimumFractionDigits: Math.min(DIGITS, fraction.replace(/[^0]/g, '').length),
    maximumFractionDigits: Math.min(DIGITS, fraction.length)
  }).format(size)
  return `${value < 0 ? '-' : ''}${prefix}${shown}${suffix}`.trim()
}

/** A number of a spreadsheet as the spreadsheet shows it: a date, an amount, or plainly. */
export function formatCell(value: number, format: CellFormat, { locale, from1904 }: FormatSettings): string {
  const serial = from1904 ? value + DAYS_TO_1904 : value
  const isDay = Number.isFinite(serial) && serial >= 0 && serial * DAY_MS < Date.UTC(9999, 11, 31) - FIRST_DAY
  if (!format.code && (format.id === LOCAL_DATE || format.id === LOCAL_DATE_TIME) && isDay) {
    return localDate(serial, locale, format.id === LOCAL_DATE_TIME)
  }
  const code = format.code ?? BUILT_IN[format.id]
  if (!code || /^general$/i.test(code)) return plainNumber(value, locale)
  const tokens = tokensOf(code)
  if (tokens.some(isDatePart)) return isDay ? formatDate(serial, tokens, locale) : plainNumber(value, locale)
  return formatNumber(value, tokens, locale) ?? plainNumber(value, locale)
}
