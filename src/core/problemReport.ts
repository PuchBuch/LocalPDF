/**
 * A problem report the user sends on GitHub themselves. It says which LocalPDF, where it
 * runs and what went wrong lately, and never what a document holds or what a file is called.
 */

/** The page for a new issue. The Windows app opens no other address in the browser. */
export const ISSUE_PAGE = 'https://github.com/PuchBuch/LocalPDF/issues/new?'

/** Longer addresses get cut off by some browsers on the way. */
export const MAX_ISSUE_URL = 6000

export interface ReportFacts {
  version: string
  variant: 'windows-app' | 'extension'
  /** Such as "Windows 11, Edge 157". */
  system: string
  language: string
  /** What went wrong lately, as codes such as "fileUnreadable (InvalidPDFException)". */
  problems: string[]
}

export function reportText(facts: ReportFacts): string {
  return [
    `**LocalPDF version:** ${facts.version}`,
    `**Variant:** ${facts.variant === 'windows-app' ? 'Windows app' : 'Browser extension'}`,
    `**System and browser:** ${facts.system}`,
    `**Interface language:** ${facts.language}`,
    `**Recent errors:** ${facts.problems.length ? facts.problems.join('; ') : 'none'}`,
    '',
    '**What did you do?**',
    '',
    '',
    '**What did you expect?**',
    '',
    '',
    '**What happened instead?**',
    '',
    '',
    '**Could you attach a document without personal data that shows the problem?**',
    ''
  ].join('\n')
}

/** The address of a new issue with the report filled in, shortened to fit if it must be. */
export function issueUrl(title: string, body: string): string {
  const build = (text: string) =>
    `${ISSUE_PAGE}template=bug_report.md&title=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`
  // Cut whole characters: half of a pair cannot be encoded. One takes at most 12 encoded.
  let characters = Array.from(body)
  let url = build(body)
  while (url.length > MAX_ISSUE_URL && characters.length > 0) {
    characters = characters.slice(0, -Math.ceil((url.length - MAX_ISSUE_URL) / 12))
    url = build(characters.join(''))
  }
  return url
}

/** Whether an address is the issue page and nothing else, as the Windows app checks before opening it. */
export function isIssueUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > MAX_ISSUE_URL || !url.startsWith(ISSUE_PAGE)) return false
  try {
    const parsed = new URL(url)
    return parsed.origin === 'https://github.com' && parsed.pathname === '/PuchBuch/LocalPDF/issues/new' && !parsed.hash
  } catch {
    return false
  }
}

/** The name of an error's kind, never its message: a message can carry a file name. */
export function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name
  return typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name) ? name : 'Error'
}

/** Windows and the browser, from the browser's own description of itself. */
export function systemOf(userAgent: string, windowsMajor?: number): string {
  const windows = /Windows NT 10\.0/.test(userAgent)
    ? windowsMajor === undefined
      ? 'Windows 10 or 11'
      : windowsMajor >= 13
        ? 'Windows 11'
        : 'Windows 10'
    : /Windows NT ([\d.]+)/.exec(userAgent)?.[0] ?? (/Mac OS X/.test(userAgent) ? 'macOS' : /Linux/.test(userAgent) ? 'Linux' : 'unknown system')
  const version = (pattern: RegExp) => pattern.exec(userAgent)?.[1]
  const electron = version(/Electron\/(\d+)/)
  const edge = version(/Edg\/(\d+)/)
  const chrome = version(/Chrome\/(\d+)/)
  const browser = electron
    ? `Electron ${electron} (Chromium ${chrome ?? '?'})`
    : edge
      ? `Edge ${edge}`
      : chrome
        ? `Chrome ${chrome}`
        : 'unknown browser'
  return `${windows}, ${browser}`
}
