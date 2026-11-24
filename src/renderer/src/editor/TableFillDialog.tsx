import { useEffect, useMemo, useRef, useState } from 'react'
import { readTableFile, type TableSheet } from '../../../core/tableFile'
import { fieldsForTable, parseTableText } from '../../../core/tableFill'
import type { TableGrid } from '../../../core/tableGrid'
import { currentLocale, t } from '../i18n'
import { measureText } from '../render/textMetrics'
import { answerTable, type TableRequest } from '../store'

const FILE_ACCEPT = '.xlsx,.xlsm,.csv,.tsv,.txt'

const columnsOf = (table: TableGrid) => table.columns.length - 1
const emptyRowsOf = (table: TableGrid) => table.emptyRows.filter(Boolean).length

/** Takes rows copied from a spreadsheet or read from a file, and shows how they fit into a table of the page. */
export function TableFillDialog({ request }: { request: TableRequest }) {
  const { tables } = request
  const [index, setIndex] = useState(() => {
    const counts = tables.map(emptyRowsOf)
    return counts.indexOf(Math.max(...counts))
  })
  const [text, setText] = useState('')
  const [skipHeading, setSkipHeading] = useState(false)
  const [sheets, setSheets] = useState<TableSheet[]>([])
  const [sheetIndex, setSheetIndex] = useState(0)
  const [fileProblem, setFileProblem] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const table = tables[index]!

  useEffect(() => input.current?.focus(), [])

  const openFile = async (file: File) => {
    // Without the error itself, which could quote the file.
    const found = await file
      .arrayBuffer()
      .then((buffer) => readTableFile(new Uint8Array(buffer), currentLocale()))
      .catch(() => null)
    setFileProblem(found === null ? t.table.fileFailed : found.length === 0 ? t.table.fileEmpty : null)
    if (!found?.[0]) return
    setSheets(found)
    setSheetIndex(0)
    setText(found[0].text)
  }

  const chooseSheet = (position: number) => {
    setSheetIndex(position)
    setText(sheets[position]!.text)
  }

  const rows = useMemo(() => parseTableText(text), [text])
  const fill = useMemo(() => fieldsForTable(table, rows, measureText, () => '', { skipHeading }), [table, rows, skipHeading])
  const rowCount = Math.max(0, rows.length - (skipHeading ? 1 : 0))
  const columnCount = rows.reduce((most, cells) => Math.max(most, cells.length), 0)

  const warnings = [
    ...(fileProblem ? [fileProblem] : []),
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
        <div className="table-choice">
          <button type="button" className="table-open" data-testid="table-open-file" onClick={() => fileInput.current?.click()}>
            {t.table.openFile}
          </button>
          <input
            ref={fileInput}
            type="file"
            hidden
            data-testid="table-file"
            accept={FILE_ACCEPT}
            onChange={(event) => {
              const file = event.target.files?.[0]
              // So that choosing the same file again, once it has changed, reads it again.
              event.target.value = ''
              if (file) void openFile(file)
            }}
          />
          {sheets.length > 1 && (
            <label className="table-choice">
              {t.table.sheet}
              <select data-testid="table-sheet" value={sheetIndex} onChange={(event) => chooseSheet(Number(event.target.value))}>
                {sheets.map(({ name }, position) => (
                  <option key={position} value={position}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
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
