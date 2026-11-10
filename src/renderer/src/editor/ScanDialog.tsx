import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Point } from '../../../core/geometry'
import { wholePicture, type Quad } from '../../../core/scan'
import { t } from '../i18n'
import type { ScanLook } from '../render/scanImage'
import { answerScan, type ScanRequest } from '../store'

/** Share of the picture an arrow key moves a corner by. */
const KEY_STEP = 0.005
const LOOKS: ScanLook[] = ['color', 'gray', 'original']

/** Shows a photo or scan with the corners of its sheet, which can be dragged into place. */
export function ScanDialog({ request }: { request: ScanRequest }) {
  const { size } = request
  const [corners, setCorners] = useState<Quad>(request.corners)
  const [look, setLook] = useState<ScanLook>('color')
  const frame = useRef<HTMLDivElement>(null)
  const dragged = useRef<number | null>(null)

  const clamp = (point: Point): Point => ({
    x: Math.min(size.width, Math.max(0, point.x)),
    y: Math.min(size.height, Math.max(0, point.y))
  })
  const moveCorner = (index: number, point: Point) =>
    setCorners((current) => current.map((corner, position) => (position === index ? clamp(point) : corner)) as Quad)

  const onPointerMove = (event: PointerEvent) => {
    const box = frame.current?.getBoundingClientRect()
    if (dragged.current === null || !box) return
    moveCorner(dragged.current, {
      x: ((event.clientX - box.left) / box.width) * size.width,
      y: ((event.clientY - box.top) / box.height) * size.height
    })
  }

  const onCornerKey = (index: number, event: KeyboardEvent) => {
    const step = { x: size.width * KEY_STEP, y: size.height * KEY_STEP }
    const moves: Record<string, Point> = {
      ArrowLeft: { x: -step.x, y: 0 },
      ArrowRight: { x: step.x, y: 0 },
      ArrowUp: { x: 0, y: -step.y },
      ArrowDown: { x: 0, y: step.y }
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    const corner = corners[index]!
    moveCorner(index, { x: corner.x + move.x, y: corner.y + move.y })
  }

  const percent = (point: Point) => ({ left: `${(point.x / size.width) * 100}%`, top: `${(point.y / size.height) * 100}%` })

  return (
    <div className="dialog-backdrop" data-testid="scan-dialog">
      <div
        className="dialog scan-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t.scan.title}
        onKeyDown={(event) => {
          if (event.key === 'Escape') answerScan(null)
        }}
      >
        <h2 className="dialog-title">{t.scan.title}</h2>
        <p className="dialog-text" data-testid="scan-hint">
          {request.found ? t.scan.found : t.scan.notFound}
        </p>
        <div
          ref={frame}
          className="scan-frame"
          style={{
            aspectRatio: `${size.width} / ${size.height}`,
            width: `min(100%, calc(62vh * ${size.width / size.height}))`
          }}
          onPointerMove={onPointerMove}
          onPointerUp={() => (dragged.current = null)}
          onPointerCancel={() => (dragged.current = null)}
        >
          <img src={request.previewUrl} alt={request.name} draggable={false} />
          <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true">
            <polygon
              points={corners.map(({ x, y }) => `${x},${y}`).join(' ')}
              vectorEffect="non-scaling-stroke"
              data-testid="scan-outline"
            />
          </svg>
          {corners.map((corner, index) => (
            <button
              key={index}
              type="button"
              className="scan-corner"
              data-testid={`scan-corner-${index}`}
              aria-label={t.scan.corner}
              style={percent(corner)}
              onPointerDown={(event) => {
                dragged.current = index
                frame.current?.setPointerCapture(event.pointerId)
              }}
              onKeyDown={(event) => onCornerKey(index, event)}
            />
          ))}
        </div>
        <fieldset className="scan-look">
          <legend>{t.scan.lookLabel}</legend>
          {LOOKS.map((choice) => (
            <label key={choice}>
              <input
                type="radio"
                name="scan-look"
                data-testid={`scan-look-${choice}`}
                checked={look === choice}
                onChange={() => setLook(choice)}
              />
              {t.scan.looks[choice]}
            </label>
          ))}
        </fieldset>
        <div className="dialog-actions">
          <button type="button" className="secondary-left" data-testid="scan-whole" onClick={() => setCorners(wholePicture(size))}>
            {t.scan.wholePicture}
          </button>
          <button type="button" data-testid="scan-cancel" onClick={() => answerScan(null)}>
            {t.scan.cancel}
          </button>
          <button type="button" className="primary" data-testid="scan-use" onClick={() => answerScan({ corners, look })}>
            {t.scan.use}
          </button>
        </div>
      </div>
    </div>
  )
}
