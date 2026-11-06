import { useEffect, type RefObject } from 'react'
import { TextLayer, type RenderTask } from 'pdfjs-dist'
import { normalizeRotation } from '../../../core/geometry'
import { canvasScale } from '../../../core/zoom'
import type { PageRef } from '../../../core/model'
import { getPdfPage } from './pdfjs'

/** Lets a burst of zoom clicks or a fast scroll finish before any drawing starts. */
const RENDER_DELAY_MS = 80

interface RenderOptions {
  canvasHost: RefObject<HTMLDivElement | null>
  textHost?: RefObject<HTMLDivElement | null>
  page: PageRef
  width: number
  active: boolean
}

function releaseCanvases(host: HTMLElement): void {
  for (const canvas of host.querySelectorAll('canvas')) {
    // Browsers hold canvas memory until it is shrunk or collected.
    canvas.width = 0
    canvas.height = 0
  }
  host.replaceChildren()
}

/** Draws a page into the host while it is active and frees the canvas afterwards. */
export function usePageRender({ canvasHost, textHost, page, width, active }: RenderOptions): void {
  const { sourceId, pageIndex, rotation } = page

  useEffect(() => {
    const host = canvasHost.current
    if (!active || !host) return

    let cancelled = false
    let renderTask: RenderTask | undefined
    let textLayer: TextLayer | undefined

    const timer = setTimeout(() => {
      void (async () => {
        const pdfPage = await getPdfPage(sourceId, pageIndex)
        if (cancelled) return

        const pageRotation = normalizeRotation(pdfPage.rotate + rotation)
        const unscaled = pdfPage.getViewport({ scale: 1, rotation: pageRotation })
        const displayScale = width / unscaled.width
        const viewport = pdfPage.getViewport({
          scale: canvasScale(unscaled, displayScale, window.devicePixelRatio),
          rotation: pageRotation
        })

        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        renderTask = pdfPage.render({ canvas, viewport })
        await renderTask.promise
        if (cancelled) return

        // The previous canvas stays visible until the new one is ready, so zooming does not flash.
        releaseCanvases(host)
        host.append(canvas)

        const textContainer = textHost?.current
        if (!textContainer) return
        textContainer.replaceChildren()
        textContainer.style.setProperty('--total-scale-factor', String(displayScale * unscaled.userUnit))
        textLayer = new TextLayer({
          textContentSource: pdfPage.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
          container: textContainer,
          viewport: pdfPage.getViewport({ scale: displayScale, rotation: pageRotation })
        })
        await textLayer.render()
      })().catch((error: unknown) => {
        // Cancelling is the normal end of a render that is no longer needed.
        if (!cancelled) console.error(error)
      })
    }, RENDER_DELAY_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
      renderTask?.cancel()
      textLayer?.cancel()
    }
  }, [canvasHost, textHost, sourceId, pageIndex, rotation, width, active])

  useEffect(() => {
    if (active) return
    if (canvasHost.current) releaseCanvases(canvasHost.current)
    textHost?.current?.replaceChildren()
  }, [canvasHost, textHost, active])
}
