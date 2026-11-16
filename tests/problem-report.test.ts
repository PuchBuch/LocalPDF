import { describe, expect, it } from 'vitest'
import { errorName, isIssueUrl, ISSUE_PAGE, issueUrl, MAX_ISSUE_URL, reportText, systemOf } from '../src/core/problemReport'

const FACTS = {
  version: '0.9.0-beta.11',
  variant: 'extension' as const,
  system: 'Windows 11, Edge 157',
  language: 'de',
  problems: ['fileUnreadable (InvalidPDFException)']
}

describe('a problem report', () => {
  it('says the version, the variant, the system, the language and the recent errors', () => {
    const text = reportText(FACTS)
    for (const part of ['0.9.0-beta.11', 'Browser extension', 'Windows 11, Edge 157', 'de', 'fileUnreadable (InvalidPDFException)']) {
      expect(text).toContain(part)
    }
    expect(text).toContain('**What did you do?**')
    expect(reportText({ ...FACTS, variant: 'windows-app', problems: [] })).toMatch(/Windows app[\s\S]*Recent errors:\*\* none/)
  })

  it('takes only the kind of an error, which carries no file name', () => {
    const error = Object.assign(new Error('Could not read “Mietvertrag Müller.pdf”'), { name: 'InvalidPDFException' })
    expect(errorName(error)).toBe('InvalidPDFException')
    expect(errorName({ name: 'Mietvertrag Müller.pdf' })).toBe('Error')
    expect(errorName('a text')).toBe('Error')
  })

  it('links to the new issue page, within the length a browser takes', () => {
    const url = issueUrl('Problem report', reportText(FACTS))
    expect(url.startsWith(`${ISSUE_PAGE}template=bug_report.md&title=Problem%20report&body=`)).toBe(true)
    expect(decodeURIComponent(new URL(url).searchParams.get('body')!)).toContain('Browser extension')

    const long = issueUrl('Problem report', 'Ж😀'.repeat(5000))
    expect(long.length).toBeLessThanOrEqual(MAX_ISSUE_URL)
    expect(isIssueUrl(long)).toBe(true)
  })

  it('lets the Windows app open the issue page and nothing else', () => {
    expect(isIssueUrl(issueUrl('x', 'y'))).toBe(true)
    for (const url of [
      'https://github.com/PuchBuch/LocalPDF/issues',
      'https://github.com/someone/else/issues/new?',
      'https://github.com.evil.example/PuchBuch/LocalPDF/issues/new?',
      'http://github.com/PuchBuch/LocalPDF/issues/new?',
      'file:///C:/Windows/System32/calc.exe',
      `${ISSUE_PAGE}${'a'.repeat(MAX_ISSUE_URL)}`,
      42
    ]) {
      expect(isIssueUrl(url)).toBe(false)
    }
  })

  it('names Windows and the browser it runs in', () => {
    const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.4341.60'
    expect(systemOf(edge, 15)).toBe('Windows 11, Edge 157')
    expect(systemOf(edge, 0)).toBe('Windows 10, Edge 157')
    expect(systemOf(edge)).toBe('Windows 10 or 11, Edge 157')
    const app = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) LocalPDF/0.9.0 Chrome/140.0.0.0 Electron/39.0.0 Safari/537.36'
    expect(systemOf(app, 15)).toBe('Windows 11, Electron 39 (Chromium 140)')
  })
})
