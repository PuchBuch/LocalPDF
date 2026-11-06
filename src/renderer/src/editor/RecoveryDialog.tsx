import { useState } from 'react'
import { currentLocale, t } from '../i18n'
import { acceptRecovery, declineRecovery } from '../session'

interface RecoveryDialogProps {
  savedAt: string
  names: string[]
}

export function RecoveryDialog({ savedAt, names }: RecoveryDialogProps) {
  const [busy, setBusy] = useState(false)
  const answer = (action: () => Promise<void>) => {
    setBusy(true)
    void action()
  }

  return (
    <div className="dialog-backdrop" data-testid="recovery-dialog">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t.recovery.title}>
        <h2 className="dialog-title">{t.recovery.title}</h2>
        <p className="dialog-text">{t.recovery.details(names.join(', '), new Date(savedAt).toLocaleString(currentLocale()))}</p>
        <div className="dialog-actions">
          <button type="button" data-testid="recovery-discard" disabled={busy} onClick={() => answer(declineRecovery)}>
            {t.recovery.discard}
          </button>
          <button
            type="button"
            className="primary"
            data-testid="recovery-restore"
            disabled={busy}
            onClick={() => answer(acceptRecovery)}
          >
            {t.recovery.restore}
          </button>
        </div>
      </div>
    </div>
  )
}
