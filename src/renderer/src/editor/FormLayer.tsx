import { memo, type CSSProperties } from 'react'
import { automaticFontSize, currentFormValue, turnRect, type FormWidget } from '../../../core/forms'
import type { FormValue, PageRef } from '../../../core/model'
import { useEditor } from '../store'

interface FormLayerProps {
  page: PageRef
  scale: number
  /** Thumbnails only show the values. */
  readOnly?: boolean
}

const NO_WIDGETS: FormWidget[] = []

/** The fields of the source PDF's own form, as controls laid over the page. */
export const FormLayer = memo(function FormLayer({ page, scale, readOnly = false }: FormLayerProps) {
  const widgets = useEditor((state) => state.formWidgets[page.id] ?? NO_WIDGETS)
  const values = useEditor((state) => state.document?.formValues[page.sourceId])
  const pageSize = useEditor((state) => state.pageSizes[page.id])
  if (widgets.length === 0 || !pageSize) return null

  return (
    <div className={readOnly ? 'form-layer static' : 'form-layer'}>
      {widgets.map((widget) => {
        const box = turnRect(widget.rect, pageSize, page.rotation)
        return (
          <div
            key={widget.id}
            className="form-widget"
            data-testid={readOnly ? undefined : 'form-widget'}
            data-field-name={widget.fieldName}
            data-widget-id={widget.id}
            style={{ left: box.x * scale, top: box.y * scale, width: box.width * scale, height: box.height * scale }}
          >
            {/* The control turns with the page, as its value will once printed. */}
            <div
              className="form-control-box"
              style={{
                width: widget.rect.width * scale,
                height: widget.rect.height * scale,
                transform: `translate(-50%, -50%) rotate(${page.rotation}deg)`
              }}
            >
              {readOnly ? (
                <FormValueView widget={widget} value={currentFormValue(widget, values)} scale={scale} />
              ) : (
                <FormControl sourceId={page.sourceId} widget={widget} value={currentFormValue(widget, values)} scale={scale} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
})

function textStyle(widget: FormWidget, scale: number): CSSProperties {
  if (widget.kind === 'checkbox' || widget.kind === 'radio') return {}
  const severalLines = widget.kind === 'list' || (widget.kind === 'text' && widget.multiline)
  const fontSize = widget.fontSize > 0 ? widget.fontSize : automaticFontSize(widget.rect.height, severalLines)
  return { fontSize: fontSize * scale, textAlign: widget.kind === 'text' ? widget.align : undefined }
}

interface ControlProps {
  sourceId: string
  widget: FormWidget
  value: FormValue
  scale: number
}

function FormControl({ sourceId, widget, value, scale }: ControlProps) {
  const { typeFormText, setFormValue } = useEditor.getState()

  switch (widget.kind) {
    case 'text':
      return widget.multiline ? (
        <textarea
          data-testid="form-text"
          spellCheck={false}
          style={textStyle(widget, scale)}
          maxLength={widget.maxLength ?? undefined}
          value={String(value)}
          onChange={(event) => typeFormText(sourceId, widget.fieldName, event.target.value)}
        />
      ) : (
        <input
          type="text"
          data-testid="form-text"
          spellCheck={false}
          style={textStyle(widget, scale)}
          maxLength={widget.maxLength ?? undefined}
          value={String(value)}
          onChange={(event) => typeFormText(sourceId, widget.fieldName, event.target.value)}
        />
      )
    case 'checkbox':
      return (
        <input
          type="checkbox"
          data-testid="form-checkbox"
          checked={value === true}
          onChange={(event) => setFormValue(sourceId, widget.fieldName, event.target.checked)}
        />
      )
    case 'radio':
      return (
        <input
          type="radio"
          data-testid="form-radio"
          name={`${sourceId}:${widget.fieldName}`}
          checked={value === widget.buttonValue}
          onChange={() => setFormValue(sourceId, widget.fieldName, widget.buttonValue)}
        />
      )
    case 'dropdown':
      return (
        <select
          data-testid="form-dropdown"
          style={textStyle(widget, scale)}
          value={(value as string[])[0] ?? ''}
          onChange={(event) => setFormValue(sourceId, widget.fieldName, [event.target.value])}
        >
          {/* Nothing chosen yet has to be shown as such, not as the first option. */}
          {(value as string[]).length === 0 && <option value="" />}
          {widget.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )
    case 'list':
      return (
        <select
          data-testid="form-list"
          multiple
          style={textStyle(widget, scale)}
          value={value as string[]}
          onChange={(event) => {
            const chosen = Array.from(event.target.selectedOptions, (option) => option.value)
            // Without multiple choice, a click replaces what was chosen.
            setFormValue(sourceId, widget.fieldName, widget.multiple ? chosen : chosen.slice(-1))
          }}
        >
          {widget.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )
  }
}

function FormValueView({ widget, value, scale }: { widget: FormWidget; value: FormValue; scale: number }) {
  const on = widget.kind === 'radio' ? value === widget.buttonValue : value === true
  if (widget.kind === 'checkbox' || widget.kind === 'radio') {
    return on ? <div className="form-value mark">✓</div> : null
  }
  return (
    <div className="form-value" style={textStyle(widget, scale)}>
      {Array.isArray(value) ? value.join('\n') : String(value)}
    </div>
  )
}
