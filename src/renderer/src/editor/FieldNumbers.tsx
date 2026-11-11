import { memo, useMemo, useState } from 'react'
import { numberFields, type NumberedField } from '../../../core/fields'
import { copyFormForAi } from '../aiFill'
import { t } from '../i18n'
import { AiAnswerDialog } from './AiAnswerDialog'
import { changeShowFieldNumbers } from '../settings'
import { useEditor } from '../store'

/** The fields of the document, numbered in reading order. */
export function useNumberedFields(): NumberedField[] {
  const document = useEditor((state) => state.document)
  const formWidgets = useEditor((state) => state.formWidgets)
  const pageSizes = useEditor((state) => state.pageSizes)
  return useMemo(() => (document ? numberFields(document, formWidgets, pageSizes) : []), [document, formWidgets, pageSizes])
}

/** Small numbered badges at the corner of each field of a page. Only on screen, never in the file. */
export const FieldNumberBadges = memo(function FieldNumberBadges({ pageId, scale }: { pageId: string; scale: number }) {
  const fields = useNumberedFields()
  return (
    <div className="field-numbers" aria-hidden="true">
      {fields
        .filter((field) => field.pageId === pageId)
        .map((field) => (
          <span
            key={field.number}
            className="field-number"
            data-testid="field-number"
            style={{ left: field.box.x * scale, top: field.box.y * scale }}
          >
            {field.number}
          </span>
        ))}
    </div>
  )
})

const FOCUS_TRIES = 40

/** Scrolls to a field and puts the cursor in it. A page far off is drawn first, so its control is waited for. */
function goToField(field: NumberedField): void {
  const { goToPage, focusField } = useEditor.getState()
  goToPage(field.pageId)
  const { target } = field
  if (target.kind === 'added') {
    focusField(target.fieldId)
    return
  }
  focusField(null)
  let tries = 0
  const focusControl = () => {
    const control = document.querySelector<HTMLElement>(
      `[data-widget-id="${CSS.escape(target.widgetId)}"] input, [data-widget-id="${CSS.escape(target.widgetId)}"] select, [data-widget-id="${CSS.escape(target.widgetId)}"] textarea`
    )
    if (control) {
      control.focus()
      control.scrollIntoView({ block: 'nearest' })
    } else if (++tries < FOCUS_TRIES) {
      requestAnimationFrame(focusControl)
    }
  }
  requestAnimationFrame(focusControl)
}

/** The list of all fields by number, and the switch for the badges. */
export function FieldsPanel() {
  const fields = useNumberedFields()
  const showNumbers = useEditor((state) => state.showFieldNumbers)
  const [answering, setAnswering] = useState(false)

  return (
    <section className="fields-panel" data-testid="fields-panel">
      <label className="show-numbers">
        <input
          type="checkbox"
          data-testid="show-field-numbers"
          checked={showNumbers}
          onChange={(event) => changeShowFieldNumbers(event.target.checked)}
        />
        {t.fieldsPanel.showNumbers}
      </label>
      <div className="ai-buttons">
        <button type="button" data-testid="ai-copy" disabled={fields.length === 0} onClick={() => void copyFormForAi()}>
          {t.ai.copy}
        </button>
        <button type="button" data-testid="ai-paste" disabled={fields.length === 0} onClick={() => setAnswering(true)}>
          {t.ai.paste}
        </button>
      </div>
      {answering && <AiAnswerDialog onClose={() => setAnswering(false)} />}
      <details>
        <summary data-testid="fields-panel-toggle">{t.fieldsPanel.title(fields.length)}</summary>
        {fields.length === 0 ? (
          <p className="fields-empty">{t.fieldsPanel.empty}</p>
        ) : (
          <ol className="fields-list">
            {fields.map((field) => (
              <li key={field.number}>
                <button
                  type="button"
                  data-testid="field-row"
                  title={t.fieldsPanel.goTo(field.number)}
                  onClick={() => goToField(field)}
                >
                  <span className="field-row-number">{field.number}</span>
                  <span className="field-row-text">
                    <span className="field-row-type">{t.fieldsPanel.types[field.type]}</span>
                    {field.name && <span className="field-row-name">{field.name}</span>}
                    {field.value && <span className="field-row-value">{field.value}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  )
}
