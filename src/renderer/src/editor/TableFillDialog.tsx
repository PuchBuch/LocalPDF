import { useEffect, useMemo, useRef, useState } from 'react'
import { fieldsForTable, parseTableText } from '../../../core/tableFill'
import type { TableGrid } from '../../../core/tableGrid'
import { t } from '../i18n'
import { measureText } from '../render/textMetrics'
import { answerTable, type TableRequest } from '../store'

const columnsOf = (table: TableGrid) => table.columns.length - 1
const emptyRowsOf = (table: TableGrid) => table.emptyRows.filter(Boolean).length

/** Takes rows copied from a spreadsheet and shows how they fit into a table of the page. */
export function TableFillDialog({ request }: { request: TableRequest }) {
  const { tables } = request
  const [index, setIndex] = useState(() => {
    const counts = tables.map(emptyRowsOf)
    return counts.indexOf(Math.max(...counts))
  })
  const [text, setText] = useState('')
  const [skipHeading, setSkipHeading] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const table = tables[index]!

  useEffect(() => input.current?.focus(), [])

  const rows = useMemo(() => parseTableText(text), [text])
  const fill = useMemo(() => fieldsForTable(table, rows, measureText, () => '', { skipHeading }), [table, rows, skipHeading])
  const rowCount = Math.max(0, rows.length - (skipHeading ? 1 : 0))
  const columnCount = Math.max(0, ...rows.map((cells) => cells.length))

  const warnings = [
    ...(emptyRowsOf(table) === 0 ? [t.table.noEmptyRows] : []),
    ...(fill.leftOutRows > 0 ? [t.table.leftOutRows(fill.leftOutRows)] : []),
    ...(fill.leftOutColumns > 0 ? [t.table.leftOutColumns(fill.leftOutColumns)] : []),
    ...(fill.tooLong > 0 ? [t.table.tooLong(fill.tooLong)] : [])
  ]

  return (
    <div className="dialog-backdrop" data-testid="table-dialog">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t.table.title}
        onKeyDown={(event) => {
          if (event.key === 'Escape') answerTable(null)
        }}
      >
        <h2 className="dialog-title">{t.table.title}</h2>
        <p className="dialog-text" data-testid="table-found">
          {t.table.found(columnsOf(table), emptyRowsOf(table))}
        </p>
        {tables.length > 1 && (
          <label className="table-choice">
            {t.table.choose}
            <select data-testid="table-choice" value={index} onChange={(event) => setIndex(Number(event.target.value))}>
              {tables.map((choice, position) => (
                <option key={position} value={position}>
                  {t.table.option(position + 1, columnsOf(choice), emptyRowsOf(choice))}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="dialog-text">{t.table.hint}</p>
        <textarea
          ref={input}
          className="ai-answer"
          data-testid="table-text"
          aria-label={t.table.hint}
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <label className="table-skip">
          <input
            type="checkbox"
            data-testid="table-skip-heading"
            checked={skipHeading}
            onChange={(event) => setSkipHeading(event.target.checked)}
          />
          {t.table.skipHeading}
        </label>
        <div role="status">
          <p className="table-preview" data-testid="table-preview">
            {rows.length > 0 && t.table.preview(rowCount, columnCount)}
          </p>
          {warnings.length > 0 && (
            <ul className="table-warnings">
              {warnings.map((warning) => (
                <li key={warning} data-testid="table-warning">
                  {warning}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" data-testid="table-cancel" onClick={() => answerTable(null)}>
            {t.table.cancel}
          </button>
          <button
            type="button"
            className="primary"
            data-testid="table-fill"
            disabled={fill.fields.length === 0}
            onClick={() => answerTable({ table, rows, skipHeading })}
          >
            {t.table.fill}
          </button>
        </div>
      </div>
    </div>
  )
}
