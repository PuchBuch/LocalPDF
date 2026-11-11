import { useEffect, useRef, useState } from 'react'
import type { AnswerError } from '../../../core/aiBridge'
import { fillFromAnswer, type FillReport } from '../aiFill'
import { t } from '../i18n'

function errorText({ problem, number = '', got = '' }: AnswerError): string {
  return t.ai.problems[problem](number, got)
}

/** Takes the answer pasted from an AI chat, fills the fields, and reports field by field. */
export function AiAnswerDialog({ onClose }: { onClose: () => void }) {
  const [answer, setAnswer] = useState('')
  const [report, setReport] = useState<FillReport | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => input.current?.focus(), [])

  return (
    <div className="dialog-backdrop" data-testid="ai-dialog">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t.ai.dialogTitle}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <h2 className="dialog-title">{t.ai.dialogTitle}</h2>
        {report ? (
          <div className="ai-report" data-testid="ai-report" role="status">
            <p className="dialog-text" data-testid="ai-summary">
              {t.ai.summary(report.filled, report.answered)}
            </p>
            {report.errors.length > 0 && (
              <ul className="ai-errors">
                {report.errors.map((error, index) => (
                  <li key={index} data-testid="ai-error">
                    {errorText(error)}
                  </li>
                ))}
              </ul>
            )}
            {report.filled > 0 && <p className="ai-undo-hint">{t.ai.undoHint}</p>}
          </div>
        ) : (
          <>
            <p className="dialog-text">{t.ai.dialogHint}</p>
            <textarea
              ref={input}
              className="ai-answer"
              data-testid="ai-answer"
              spellCheck={false}
              placeholder={t.ai.placeholder}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </>
        )}
        <div className="dialog-actions">
          {report ? (
            <button type="button" className="primary" data-testid="ai-close" onClick={onClose}>
              {t.ai.close}
            </button>
          ) : (
            <>
              <button type="button" data-testid="ai-cancel" onClick={onClose}>
                {t.ai.cancel}
              </button>
              <button type="button" className="primary" data-testid="ai-fill" onClick={() => setReport(fillFromAnswer(answer))}>
                {t.ai.fill}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
