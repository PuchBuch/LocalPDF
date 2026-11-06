import { memo, useEffect, useRef, useState, type PointerEvent } from 'react'
import {
  combCellCount,
  CROSS_PATH,
  DOT_PATH,
  MARK_BASE_SIZE,
  MARK_STROKE_WIDTH,
  resizeBox,
  TEXT_PLACEHOLDER,
  TICK_PATH
} from '../../../core/fields'
import { DEFAULT_FAMILY, familyInfo, FONT_FAMILIES, type FontFamily } from '../../../core/fonts'
import type { Point, Rect, Size } from '../../../core/geometry'
import type { CheckboxField, CombField, Field, ImageField, RgbColor, TextField } from '../../../core/model'
import { SNAP_DISTANCE_PX, snapToNeighbours, type SnapGuides } from '../../../core/snap'
import { coversOf } from '../../../core/textLines'
import { t } from '../i18n'
import { addPictureFromFile, useEditor } from '../store'
import { useAssetUrl } from './useAssetUrl'

/** Room the buttons beside and below a focused field need, in screen pixels. */
const SIDE_PANEL_WIDTH = 62
const BOTTOM_PANEL_WIDTH = 180
const COMB_BOTTOM_PANEL_WIDTH = 240
const BOTTOM_PANEL_HEIGHT = 36

const PICTURE_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif'

const CHECKBOX_MARKS = [
  { value: 'tick', icon: '✓' },
  { value: 'cross', icon: '✕' },
  { value: 'dot', icon: '●' }
] as const

function CheckboxMark({ value }: { value: CheckboxField['value'] }) {
  if (value === null) return null
  return (
    <svg viewBox={`0 0 ${MARK_BASE_SIZE} ${MARK_BASE_SIZE}`} aria-hidden="true">
      {value === 'dot' ? (
        <path d={DOT_PATH} fill="#000" />
      ) : (
        <path d={value === 'tick' ? TICK_PATH : CROSS_PATH} fill="none" stroke="#000" strokeWidth={MARK_STROKE_WIDTH} />
      )}
    </svg>
  )
}

function FieldImage({ field }: { field: ImageField }) {
  const url = useAssetUrl(field.assetId)
  if (!url) return null
  // A picture fills its field, a signature fits inside it. The export does the same.
  return <img className={field.type === 'PICTURE' ? 'field-image fill' : 'field-image'} src={url} alt="" draggable={false} />
}

function combCellStyle(field: CombField, scale: number) {
  return { width: field.spacing * scale, fontSize: field.fontSize * scale }
}

function combCells(field: CombField): string[] {
  const characters = Array.from(field.value)
  return Array.from({ length: combCellCount(field) }, (_, index) => characters[index] ?? '')
}

interface FieldLayerProps {
  fields: Field[]
  scale: number
  page: Size
}

const cssColor = ({ r, g, b }: RgbColor) => `rgb(${r} ${g} ${b})`

/** Must match what the export draws for the same field. */
function textFieldStyle(field: TextField, scale: number) {
  return {
    fontSize: field.fontSize * scale,
    fontFamily: field.style?.family ? `'${familyInfo(field.style.family).css}', sans-serif` : undefined,
    fontWeight: field.style?.bold ? 'bold' : undefined,
    fontStyle: field.style?.italic ? 'italic' : undefined,
    color: field.style ? cssColor(field.style.color) : undefined
  }
}

/** The lines painted out by fields that replace them, under all fields as in the PDF. */
function TextCovers({ fields, scale }: Pick<FieldLayerProps, 'fields' | 'scale'>) {
  return (
    <>
      {coversOf(fields).map((cover, index) => (
        <div
          key={index}
          className="text-cover"
          data-testid="text-cover"
          style={{
            left: cover.x * scale,
            top: cover.y * scale,
            width: cover.width * scale,
            height: cover.height * scale,
            background: cover.color ? cssColor(cover.color) : undefined
          }}
        />
      ))}
    </>
  )
}

/** The fields of a page as they will print, for places that only show them. */
export const StaticFieldLayer = memo(function StaticFieldLayer({ fields, scale }: Omit<FieldLayerProps, 'page'>) {
  return (
    <div className="field-layer static">
      <TextCovers fields={fields} scale={scale} />
      {fields.map((field) => (
        <div key={field.id} className="field" style={fieldBoxStyle(field, field, scale)}>
          {field.type === 'TEXT' && (
            <div className="field-text" style={textFieldStyle(field, scale)}>
              {field.value}
            </div>
          )}
          {field.type === 'CHECKBOX' && <CheckboxMark value={field.value} />}
          {(field.type === 'SIGNATURE' || field.type === 'PICTURE') && <FieldImage field={field} />}
          {field.type === 'COMB_TEXT' && (
            <div className="comb-cells">
              {combCells(field).map((character, index) => (
                <span key={index} className="comb-cell" style={combCellStyle(field, scale)}>
                  {character}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
})

export const FieldLayer = memo(function FieldLayer({ fields, scale, page }: FieldLayerProps) {
  const [guides, setGuides] = useState<SnapGuides | null>(null)
  return (
    <div className="field-layer">
      <TextCovers fields={fields} scale={scale} />
      {fields.map((field) => (
        <FieldView key={field.id} field={field} scale={scale} page={page} fields={fields} onGuides={setGuides} />
      ))}
      {guides?.x.map((x) => (
        <div key={`x${x}`} className="snap-guide vertical" data-testid="snap-guide" style={{ left: x * scale }} />
      ))}
      {guides?.y.map((y) => (
        <div key={`y${y}`} className="snap-guide horizontal" data-testid="snap-guide" style={{ top: y * scale }} />
      ))}
    </div>
  )
})

function fieldBoxStyle(field: Field, box: Rect, scale: number) {
  return {
    left: box.x * scale,
    top: box.y * scale,
    width: box.width * scale,
    height: box.height * scale,
    background: field.background === 'white' ? '#fff' : undefined
  }
}

interface FieldViewProps {
  field: Field
  scale: number
  page: Size
  /** All fields of the page, to line up with while dragging. */
  fields: Field[]
  onGuides: (guides: SnapGuides | null) => void
}

function FieldView({ field, scale, page, fields, onGuides }: FieldViewProps) {
  const focused = useEditor((state) => state.focusedFieldId === field.id)
  const copying = useEditor((state) => state.clipboard?.id === field.id)
  const pasting = useEditor((state) => state.clipboard !== null)
  // The box while being dragged or resized. It is committed as one step when released.
  const [draft, setDraft] = useState<Rect | null>(null)
  const box = draft ?? field

  const pageWidthPx = page.width * scale
  const pageHeightPx = page.height * scale
  const leftPx = box.x * scale
  const rightPx = (box.x + box.width) * scale
  const bottomPx = (box.y + box.height) * scale
  const noRoomOnRight = rightPx + SIDE_PANEL_WIDTH > pageWidthPx
  const noRoomOnLeft = leftPx < SIDE_PANEL_WIDTH
  const bottomPanelWidth = field.type === 'COMB_TEXT' ? COMB_BOTTOM_PANEL_WIDTH : BOTTOM_PANEL_WIDTH
  const className = [
    'field',
    noRoomOnRight ? (noRoomOnLeft ? 'side-panel-inline' : 'side-panel-left') : '',
    leftPx + bottomPanelWidth > pageWidthPx ? 'bottom-panel-right' : '',
    bottomPx + BOTTOM_PANEL_HEIGHT > pageHeightPx ? 'bottom-panel-above' : ''
  ].join(' ')

  return (
    <div
      className={className}
      data-testid="field"
      data-field-type={field.type}
      data-field-focused={focused}
      style={fieldBoxStyle(field, box, scale)}
      onClick={(event) => {
        // A click on a field while pasting still means "paste here", so it reaches the page.
        if (!pasting) event.stopPropagation()
      }}
    >
      {field.type === 'TEXT' && <TextInput field={field} scale={scale} focused={focused} />}
      {field.type === 'COMB_TEXT' && <CombInput field={field} scale={scale} focused={focused} />}
      {field.type === 'CHECKBOX' && <CheckboxInput field={field} />}
      {field.type === 'SIGNATURE' && <SignatureInput field={field} />}
      {field.type === 'PICTURE' && <PictureInput field={field} />}
      {focused && (
        <>
          <FieldPanels
            field={field}
            scale={scale}
            page={page}
            copying={copying}
            draft={draft}
            onDraft={setDraft}
            neighbours={fields.filter((other) => other.id !== field.id)}
            onGuides={onGuides}
          />
          {field.type !== 'TEXT' && field.type !== 'COMB_TEXT' && (
            <ResizeHandle field={field} scale={scale} page={page} draft={draft} onDraft={setDraft} />
          )}
        </>
      )}
    </div>
  )
}

function TextInput({ field, scale, focused }: { field: TextField; scale: number; focused: boolean }) {
  const input = useRef<HTMLTextAreaElement>(null)
  const { typeText, focusField } = useEditor.getState()

  useEffect(() => {
    const element = input.current
    if (!focused || !element || document.activeElement === element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [focused])

  return (
    <textarea
      ref={input}
      className="field-text"
      data-testid="field-input"
      spellCheck={false}
      wrap="off"
      placeholder={TEXT_PLACEHOLDER}
      value={field.value}
      style={textFieldStyle(field, scale)}
      onFocus={() => focusField(field.id)}
      onChange={(event) => typeText(field.id, event.target.value)}
    />
  )
}

function CombInput({ field, scale, focused }: { field: CombField; scale: number; focused: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [caret, setCaret] = useState(0)
  const { typeText, focusField } = useEditor.getState()
  const cells = combCells(field)
  const readCaret = () => setCaret(input.current?.selectionStart ?? 0)

  useEffect(() => {
    const element = input.current
    if (!focused || !element || document.activeElement === element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
    readCaret()
  }, [focused])

  useEffect(readCaret, [field.value])

  return (
    <>
      <input
        ref={input}
        className="comb-input"
        data-testid="comb-input"
        spellCheck={false}
        value={field.value}
        onFocus={() => focusField(field.id)}
        onSelect={readCaret}
        onChange={(event) => typeText(field.id, event.target.value)}
      />
      <div className="comb-cells">
        {cells.map((character, index) => (
          <span
            key={index}
            className={focused && index === Math.min(caret, cells.length - 1) ? 'comb-cell current' : 'comb-cell'}
            data-testid="comb-cell"
            style={combCellStyle(field, scale)}
            onClick={() => {
              const position = Math.min(index, Array.from(field.value).length)
              input.current?.focus()
              input.current?.setSelectionRange(position, position)
              setCaret(position)
            }}
          >
            {character}
          </span>
        ))}
      </div>
    </>
  )
}

function CheckboxInput({ field }: { field: CheckboxField }) {
  const { cycleCheckbox, focusField } = useEditor.getState()
  return (
    <button
      type="button"
      className="field-checkbox"
      data-testid="field-checkbox"
      data-value={field.value ?? 'empty'}
      aria-label={t.checkbox}
      onClick={() => {
        focusField(field.id)
        cycleCheckbox(field.id)
      }}
    >
      <CheckboxMark value={field.value} />
    </button>
  )
}

function SignatureInput({ field }: { field: ImageField }) {
  const { focusField, openSignature } = useEditor.getState()
  return (
    <button
      type="button"
      className="field-signature"
      data-testid="field-signature"
      data-signed={field.assetId !== null}
      aria-label={t.signature.title}
      title={t.signature.title}
      onClick={() => {
        focusField(field.id)
        openSignature(field.id)
      }}
    >
      {field.assetId ? <FieldImage field={field} /> : <span className="field-placeholder">✍</span>}
    </button>
  )
}

function PictureInput({ field }: { field: ImageField }) {
  const { focusField } = useEditor.getState()
  if (field.assetId) {
    return (
      <div className="field-picture" data-testid="field-picture" onClick={() => focusField(field.id)}>
        <FieldImage field={field} />
      </div>
    )
  }
  return (
    <label className="field-picture" data-testid="field-picture" title={t.choosePicture} onClick={() => focusField(field.id)}>
      <span className="field-placeholder">🖼</span>
      <input
        type="file"
        data-testid="picture-input"
        accept={PICTURE_ACCEPT}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void addPictureFromFile(field.id, file)
        }}
      />
    </label>
  )
}

interface DraftProps {
  field: Field
  scale: number
  page: Size
  draft: Rect | null
  onDraft: (box: Rect | null) => void
}

/** Follows a pointer from a pressed handle, and commits the box when it is released. */
function usePointerDrag(
  scale: number,
  { draft, onDraft }: Pick<DraftProps, 'draft' | 'onDraft'>,
  boxFor: (delta: Point, shiftKey: boolean) => Rect,
  onCommit: (box: Rect) => void,
  onActive?: (active: boolean) => void
) {
  const start = useRef<Point | null>(null)

  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      start.current = { x: event.clientX, y: event.clientY }
      onActive?.(true)
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (!start.current) return
      const delta = { x: (event.clientX - start.current.x) / scale, y: (event.clientY - start.current.y) / scale }
      onDraft(boxFor(delta, event.shiftKey))
    },
    onPointerUp: () => {
      start.current = null
      if (draft) onCommit(draft)
      onDraft(null)
      onActive?.(false)
    },
    onPointerCancel: () => {
      start.current = null
      onDraft(null)
      onActive?.(false)
    }
  }
}

function ResizeHandle({ field, scale, page, draft, onDraft }: DraftProps) {
  const { moveField, setResizing } = useEditor.getState()
  const handlers = usePointerDrag(
    scale,
    { draft, onDraft },
    // A checkbox is always square. Shift frees the others.
    (delta, shiftKey) => resizeBox(field, delta, page, field.type === 'CHECKBOX' || !shiftKey),
    (box) => moveField(field.id, box),
    field.type === 'CHECKBOX' ? undefined : setResizing
  )
  return <div className="field-resize" data-testid="field-resize-indicator" {...handlers} />
}

const toHex = ({ r, g, b }: RgbColor) => `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`

const fromHex = (hex: string): RgbColor => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16)
})

/** The font of a text field: its family, bold, italic and colour. */
function FontTool({ field }: { field: TextField }) {
  const [open, setOpen] = useState(false)
  const { setTextStyle } = useEditor.getState()
  const style = field.style
  // The panel keeps the caret in the text. These controls need the focus themselves to work.
  const letFocus = (event: { stopPropagation: () => void }) => event.stopPropagation()

  return (
    <div className="font-tool">
      <button
        type="button"
        className={open ? 'active' : undefined}
        data-testid="font-tool"
        aria-label={t.font.title}
        aria-expanded={open}
        title={t.font.title}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="font-tool-icon">A</span>
      </button>
      {open && (
        <div className="font-tool-panel" data-testid="font-tool-panel" onMouseDown={letFocus}>
          <select
            data-testid="font-family"
            aria-label={t.font.family}
            title={t.font.family}
            value={style?.family ?? DEFAULT_FAMILY}
            onChange={(event) => setTextStyle(field.id, { family: event.target.value as FontFamily })}
          >
            {FONT_FAMILIES.map(({ id }) => (
              <option key={id} value={id}>
                {t.font.families[id]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={style?.bold ? 'active' : undefined}
            data-testid="font-bold"
            aria-label={t.font.bold}
            aria-pressed={style?.bold === true}
            title={t.font.bold}
            onClick={() => setTextStyle(field.id, { bold: !style?.bold })}
          >
            <b>{t.font.boldIcon}</b>
          </button>
          <button
            type="button"
            className={style?.italic ? 'active' : undefined}
            data-testid="font-italic"
            aria-label={t.font.italic}
            aria-pressed={style?.italic === true}
            title={t.font.italic}
            onClick={() => setTextStyle(field.id, { italic: !style?.italic })}
          >
            <i>{t.font.italicIcon}</i>
          </button>
          <input
            type="color"
            data-testid="font-color"
            aria-label={t.font.color}
            title={t.font.color}
            value={toHex(style?.color ?? { r: 0, g: 0, b: 0 })}
            onChange={(event) => setTextStyle(field.id, { color: fromHex(event.target.value) })}
          />
        </div>
      )}
    </div>
  )
}

interface FieldPanelsProps extends DraftProps {
  copying: boolean
  neighbours: Field[]
  onGuides: (guides: SnapGuides | null) => void
}

function FieldPanels({ field, scale, page, copying, draft, onDraft, neighbours, onGuides }: FieldPanelsProps) {
  const { copyField, deleteField, moveField, toggleBackground, changeFontSize, changeSpacing, setDragging, setCheckboxValue } =
    useEditor.getState()
  const handlers = usePointerDrag(
    scale,
    { draft, onDraft },
    (delta, shiftKey) => {
      const moved = { x: field.x + delta.x, y: field.y + delta.y, width: field.width, height: field.height }
      // Shift turns lining up off, for placing a field just beside a neighbour.
      const { x, y, guides } = snapToNeighbours(moved, shiftKey ? [] : neighbours, page, SNAP_DISTANCE_PX / scale)
      onGuides(guides)
      return { ...moved, x, y }
    },
    (box) => moveField(field.id, { x: box.x, y: box.y }),
    (active) => {
      setDragging(active)
      if (!active) onGuides(null)
    }
  )

  // Pressing a button must not take the caret out of the text being edited.
  const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault()

  return (
    <>
      <div className="field-panel side" onMouseDown={keepFocus}>
        <button
          type="button"
          className={copying ? 'active' : undefined}
          data-testid="field-copy"
          aria-label={t.fieldCopy}
          title={t.fieldCopy}
          onClick={() => copyField(field.id)}
        >
          ⧉
        </button>
        <button
          type="button"
          className="danger"
          data-testid="field-delete"
          aria-label={t.fieldDelete}
          title={t.fieldDelete}
          onClick={() => deleteField(field.id)}
        >
          🗑
        </button>
      </div>
      <div className="field-panel bottom" onMouseDown={keepFocus}>
        <button
          type="button"
          className="grab"
          data-testid="field-grab-handle"
          aria-label={t.fieldMove}
          title={t.fieldMove}
          {...handlers}
        >
          ✥
        </button>
        <button
          type="button"
          data-testid="field-background-color"
          data-background={field.background}
          aria-label={t.fieldBackground}
          title={t.fieldBackground}
          onClick={() => toggleBackground(field.id)}
        >
          <span className={`background-swatch ${field.background}`} />
        </button>
        {(field.type === 'TEXT' || field.type === 'COMB_TEXT') && (
          <>
            <button
              type="button"
              data-testid="decrease-font-size"
              aria-label={t.fontSmaller}
              title={t.fontSmaller}
              onClick={() => changeFontSize(field.id, -1)}
            >
              −
            </button>
            <span className="field-panel-label" data-testid="font-size">
              {field.fontSize}
            </span>
            <button
              type="button"
              data-testid="increase-font-size"
              aria-label={t.fontLarger}
              title={t.fontLarger}
              onClick={() => changeFontSize(field.id, 1)}
            >
              +
            </button>
          </>
        )}
        {field.type === 'TEXT' && <FontTool field={field} />}
        {field.type === 'CHECKBOX' &&
          CHECKBOX_MARKS.map(({ value, icon }) => (
            <button
              key={value}
              type="button"
              className={field.value === value ? 'active' : undefined}
              data-testid={`mark-${value}`}
              aria-label={t.checkboxMarks[value]}
              aria-pressed={field.value === value}
              title={t.checkboxMarks[value]}
              onClick={() => setCheckboxValue(field.id, field.value === value ? null : value)}
            >
              {icon}
            </button>
          ))}
        {field.type === 'COMB_TEXT' && (
          <>
            <button
              type="button"
              data-testid="decrease-spacing"
              aria-label={t.spacingSmaller}
              title={t.spacingSmaller}
              onClick={() => changeSpacing(field.id, -1)}
            >
              ⇤
            </button>
            <button
              type="button"
              data-testid="increase-spacing"
              aria-label={t.spacingLarger}
              title={t.spacingLarger}
              onClick={() => changeSpacing(field.id, 1)}
            >
              ⇥
            </button>
          </>
        )}
      </div>
    </>
  )
}
