import { errorName } from '../../core/problemReport'
import { t } from './i18n'

/**
 * What went wrong lately, for a problem report. Only in memory, and only as the key of
 * the message shown and the kind of error: never a message's text, which can name a file.
 */
const recent: string[] = []
const KEPT = 5

export function noteProblem(notice: string, error?: unknown): void {
  const key = messageKey(t, notice)
  if (key) noteProblemKey(key, error)
}

/** For a notice made with a file name in it, which no fixed text matches. */
export function noteProblemKey(key: string, error?: unknown): void {
  recent.push(error === undefined ? key : `${key} (${errorName(error)})`)
  if (recent.length > KEPT) recent.shift()
}

export function recentProblems(): string[] {
  return [...recent]
}

/** Where a fixed text is found among the texts of the interface, such as "ocr.failed". */
function messageKey(texts: object, text: string, path = ''): string | undefined {
  for (const [key, value] of Object.entries(texts)) {
    if (value === text) return path + key
    if (value && typeof value === 'object') {
      const found = messageKey(value, text, `${path}${key}.`)
      if (found) return found
    }
  }
  return undefined
}
