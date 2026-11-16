import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { issueUrl, reportText, systemOf, type ReportFacts } from '../../../core/problemReport'
import { currentLocale, t } from '../i18n'
import { recentProblems } from '../problemLog'

export const useReportDialog = create<{ open: boolean }>(() => ({ open: false }))

export const openReportDialog = (): void => useReportDialog.setState({ open: true })
// Escape closes it from anywhere in the window, in App's useEscape.
const closeReportDialog = (): void => useReportDialog.setState({ open: false })

async function gatherFacts(): Promise<ReportFacts> {
  const bridge = window.localpdf
  let windowsMajor: number | undefined
  try {
    // Asks the browser itself; nothing goes over the network.
    const data = (navigator as { userAgentData?: { getHighEntropyValues(hints: string[]): Promise<{ platformVersion?: string }> } })
      .userAgentData
    const version = (await data?.getHighEntropyValues(['platformVersion']))?.platformVersion
    if (version) windowsMajor = Number(version.split('.')[0])
  } catch {
    windowsMajor = undefined
  }
  return {
    version: await bridge.appVersion().catch(() => 'unknown'),
    variant: bridge.variant,
    system: systemOf(navigator.userAgent, windowsMajor),
    language: currentLocale(),
    problems: recentProblems()
  }
}

export function ReportDialog() {
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void gatherFacts().then((facts) => setText(reportText(facts)))
  }, [])

  const url = issueUrl('Problem report', text)
  const inApp = window.localpdf.variant === 'windows-app'

  const copy = async () => {
    await window.localpdf.copyText(text)
    setCopied(true)
  }

  return (
    <div className="dialog-backdrop" data-testid="report-dialog">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t.report.title}>
        <h2 className="dialog-title">{t.report.title}</h2>
        <p className="dialog-text">{t.report.intro}</p>
        <textarea
          className="report-text"
          data-testid="report-text"
          aria-label={t.report.title}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setCopied(false)
          }}
        />
        <div className="dialog-actions">
          <button type="button" className="secondary-left" data-testid="report-close" onClick={closeReportDialog}>
            {t.report.close}
          </button>
          <button type="button" data-testid="report-copy" onClick={() => void copy()}>
            {copied ? t.report.copied : t.report.copy}
          </button>
          {/* The extension follows the link in a new tab; the Windows app hands it to the browser. */}
          <a
            className="button primary"
            data-testid="report-github"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              if (!inApp) return
              event.preventDefault()
              void window.localpdf.openIssuePage(url)
            }}
          >
            {t.report.openGithub}
          </a>
        </div>
      </div>
    </div>
  )
}
