import { useEffect, useRef, useState, type FormEvent } from 'react'
import { t } from '../i18n'
import { answerPassword } from '../store'

interface PasswordDialogProps {
  name: string
  wrong: boolean
}

export function PasswordDialog({ name, wrong }: PasswordDialogProps) {
  const [password, setPassword] = useState('')
  const [keep, setKeep] = useState(true)
  const input = useRef<HTMLInputElement>(null)

  // Each attempt comes back here: an empty field is ready for the next one.
  useEffect(() => {
    setPassword('')
    input.current?.focus()
  }, [wrong, name])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (password !== '') answerPassword({ password, keep })
  }

  return (
    <div className="dialog-backdrop" data-testid="password-dialog">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t.password.title}
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') answerPassword(null)
        }}
      >
        <h2 className="dialog-title">{t.password.title}</h2>
        <p className="dialog-text">{name}</p>
        <input
          ref={input}
          type="password"
          className="password-input"
          data-testid="password-input"
          autoComplete="off"
          placeholder={t.password.placeholder}
          aria-label={t.password.placeholder}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {wrong && (
          <p className="password-error" data-testid="password-error" role="alert">
            {t.password.wrong}
          </p>
        )}
        <label className="password-keep">
          <input
            type="checkbox"
            data-testid="password-keep"
            checked={keep}
            onChange={(event) => setKeep(event.target.checked)}
          />
          <span>
            {t.password.keep}
            <small data-testid="password-keep-hint">{keep ? t.password.keepOn : t.password.keepOff}</small>
          </span>
        </label>
        <div className="dialog-actions">
          <button type="button" data-testid="password-cancel" onClick={() => answerPassword(null)}>
            {t.password.cancel}
          </button>
          <button type="submit" className="primary" data-testid="password-unlock" disabled={password === ''}>
            {t.password.unlock}
          </button>
        </div>
      </form>
    </div>
  )
}
