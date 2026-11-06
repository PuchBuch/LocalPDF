import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import SignaturePad from 'signature_pad'
import type { ImageAsset } from '../../../core/model'
import { t } from '../i18n'
import { trimmedPng } from '../render/imageFile'
import { useEditor } from '../store'

type Stroke = ReturnType<SignaturePad['toData']>[number]

/** The drawing is kept sharper than the screen, it is also printed. */
const DRAW_RESOLUTION = 3
const TYPED_FONT_FAMILY = 'Caveat'
const TYPED_FONT_SIZE = 200
const TYPED_PADDING = 40

export function SignatureDialog({ fieldId }: { fieldId: string }) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw')
  const { closeSignature, setSignature } = useEditor.getState()

  const finish = (asset: ImageAsset) => {
    setSignature(fieldId, asset)
    closeSignature()
  }

  return (
    <div className="dialog-backdrop" data-testid="signature-dialog">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t.signature.title}>
        <div className="dialog-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'draw'}
            data-testid="signature-tab-draw"
            onClick={() => setMode('draw')}
          >
            {t.signature.tabDraw}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'type'}
            data-testid="signature-tab-type"
            onClick={() => setMode('type')}
          >
            {t.signature.tabType}
          </button>
          <button
            type="button"
            className="dialog-close"
            data-testid="signature-close"
            aria-label={t.close}
            title={t.close}
            onClick={closeSignature}
          >
            ✕
          </button>
        </div>
        {/* Switching tabs remounts the panel, which drops what was not finished. */}
        {mode === 'draw' ? <DrawPanel onFinish={finish} /> : <TypePanel onFinish={finish} />}
      </div>
    </div>
  )
}

function DrawPanel({ onFinish }: { onFinish: (asset: ImageAsset) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pad = useRef<SignaturePad | null>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [undone, setUndone] = useState<Stroke[]>([])

  useLayoutEffect(() => {
    const element = canvas.current!
    element.width = element.clientWidth * DRAW_RESOLUTION
    element.height = element.clientHeight * DRAW_RESOLUTION
    element.getContext('2d')!.scale(DRAW_RESOLUTION, DRAW_RESOLUTION)

    const signaturePad = new SignaturePad(element, { penColor: '#000', minWidth: 0.8, maxWidth: 2.6 })
    signaturePad.addEventListener('endStroke', () => {
      setStrokes([...signaturePad.toData()])
      setUndone([])
    })
    pad.current = signaturePad
    return () => signaturePad.off()
  }, [])

  const show = (next: Stroke[], nextUndone: Stroke[]) => {
    pad.current?.fromData(next)
    setStrokes(next)
    setUndone(nextUndone)
  }

  return (
    <div className="dialog-panel">
      <canvas className="signature-canvas" data-testid="signature-canvas" ref={canvas} />
      <div className="dialog-actions">
        <button
          type="button"
          className="danger"
          data-testid="signature-clear"
          disabled={strokes.length === 0}
          onClick={() => {
            pad.current?.clear()
            setStrokes([])
            setUndone([])
          }}
        >
          {t.signature.clear}
        </button>
        <button
          type="button"
          data-testid="signature-undo"
          disabled={strokes.length === 0}
          onClick={() => show(strokes.slice(0, -1), [strokes.at(-1)!, ...undone])}
        >
          {t.undo}
        </button>
        <button
          type="button"
          data-testid="signature-redo"
          disabled={undone.length === 0}
          onClick={() => show([...strokes, undone[0]!], undone.slice(1))}
        >
          {t.redo}
        </button>
        <button
          type="button"
          className="primary"
          data-testid="signature-finish"
          disabled={strokes.length === 0}
          onClick={() => void trimmedPng(canvas.current!).then(onFinish)}
        >
          {t.signature.finish}
        </button>
      </div>
    </div>
  )
}

async function renderTypedSignature(name: string): Promise<ImageAsset> {
  const font = `${TYPED_FONT_SIZE}px "${TYPED_FONT_FAMILY}"`
  await document.fonts.load(font, name)

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  context.font = font
  canvas.width = Math.ceil(context.measureText(name).width) + TYPED_PADDING * 2
  canvas.height = TYPED_FONT_SIZE * 2
  // Resizing the canvas resets its drawing state.
  context.font = font
  context.fillStyle = '#000'
  context.textBaseline = 'middle'
  context.fillText(name, TYPED_PADDING, canvas.height / 2)
  return trimmedPng(canvas)
}

function TypePanel({ onFinish }: { onFinish: (asset: ImageAsset) => void }) {
  const [name, setName] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  return (
    <div className="dialog-panel">
      <input
        ref={input}
        className="signature-name"
        data-testid="signature-name"
        placeholder={t.signature.namePlaceholder}
        spellCheck={false}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="dialog-actions">
        <button
          type="button"
          className="danger"
          data-testid="signature-clear"
          disabled={name === ''}
          onClick={() => setName('')}
        >
          {t.signature.clear}
        </button>
        <button
          type="button"
          className="primary"
          data-testid="signature-finish"
          disabled={name.trim() === ''}
          onClick={() => void renderTypedSignature(name.trim()).then(onFinish)}
        >
          {t.signature.finish}
        </button>
      </div>
    </div>
  )
}
