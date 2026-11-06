import { memo, useMemo, useRef, type MouseEvent } from 'react'
import type { PageRef } from '../../../core/model'
import { usePageRender } from '../render/usePageRender'
import { useEditor } from '../store'
import { EditableLines } from './EditableLines'
import { FieldLayer } from './FieldView'
import { FormLayer } from './FormLayer'

interface PageViewProps {
  page: PageRef
  width: number
  height: number
  /** Width and height of the displayed page in points. */
  pageWidth: number
  pageHeight: number
  active: boolean
}

export const PageView = memo(function PageView({ page, width, height, pageWidth, pageHeight, active }: PageViewProps) {
  const canvasHost = useRef<HTMLDivElement>(null)
  const textHost = useRef<HTMLDivElement>(null)
  usePageRender({ canvasHost, textHost, page, width, active })

  const placing = useEditor((state) => state.activeTool !== 'cursor' || state.clipboard !== null)
  const editingText = useEditor((state) => state.activeTool === 'edit' && state.clipboard === null)
  const scale = width / pageWidth
  const pageSize = useMemo(() => ({ width: pageWidth, height: pageHeight }), [pageWidth, pageHeight])

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    useEditor.getState().clickPage(page.id, {
      x: (event.clientX - box.left) / scale,
      y: (event.clientY - box.top) / scale
    })
  }

  return (
    <div
      className={placing ? 'page placing' : 'page'}
      data-testid="pdf-page"
      style={{ width, height }}
      onClick={onClick}
    >
      <div className="page-canvas" ref={canvasHost} />
      <div className="page-text">
        <div className="textLayer" ref={textHost} />
      </div>
      <FormLayer page={page} scale={scale} />
      {editingText && active && <EditableLines page={page} scale={scale} fields={page.fields} />}
      <FieldLayer fields={page.fields} scale={scale} page={pageSize} />
    </div>
  )
})
