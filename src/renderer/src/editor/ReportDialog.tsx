import { useEffect, useState } from 'react'
import { create } from 'zustand'
import {
  FEEDBACK_ISSUES,
  FEEDBACK_KINDS,
  feedbackText,
  issueUrl,
  systemOf,
  type FeedbackKind,
  type ReportFacts
} from '../../../core/problemReport'
import { currentLocale, t } from '../i18n'
import { recentProblems } from '../problemLog'

export const useReportDialog = create<{ open: boolean; kind: FeedbackKind }>(() => ({ open: false, kind: 'problem' }))

export const openFeedback = (kind: FeedbackKind): void => useReportDialog.setState({ open: true, kind })
export const openReportDialog = (): void => openFeedback('problem')
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

/** A problem, an idea or a question, which the person checks and sends on GitHub themselves. */
export function ReportDialog() {
  const kind = useReportDialog((state) => state.kind)
  // Each kind keeps its own text, so that looking at another loses nothing.
  const [texts, setTexts] = useState<Record<FeedbackKind, string>>({ problem: '', idea: '', question: '' })
  const [copied, setCopied] = useState(false)
  const text = texts[kind]

  useEffect(() => {
    void gatherFacts().then((facts) =>
      setTexts({
        problem: feedbackText('problem', facts),
        idea: feedbackText('idea', facts),
        question: feedbackText('question', facts)
      })
    )
  }, [])

  const url = issueUrl(FEEDBACK_ISSUES[kind].title, text, FEEDBACK_ISSUES[kind].template)
  const inApp = window.localpdf.variant === 'windows-app'
  const title = kind === 'problem' ? t.report.title : t.feedback.title

  const copy = async () => {
    await window.localpdf.copyText(text)
    setCopied(true)
  }

  return (
    <div className="dialog-backdrop" data-testid="report-dialog">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="dialog-title">{title}</h2>
        <fieldset className="scan-look">
          <legend>{t.feedback.kind}</legend>
          {FEEDBACK_KINDS.map((choice) => (
            <label key={choice}>
              <input
                type="radio"
                name="feedback-kind"
                data-testid={`feedback-${choice}`}
                checked={kind === choice}
                onChange={() => {
                  useReportDialog.setState({ kind: choice })
                  setCopied(false)
                }}
              />
              {t.feedback.kinds[choice]}
            </label>
          ))}
        </fieldset>
        <p className="dialog-text">{kind === 'problem' ? t.report.intro : t.feedback.intro}</p>
        <p className="dialog-text">{t.feedback.account}</p>
        <textarea
          className="report-text"
          data-testid="report-text"
          aria-label={title}
          value={text}
          onChange={(event) => {
            const changed = event.target.value
            setTexts((current) => ({ ...current, [kind]: changed }))
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
