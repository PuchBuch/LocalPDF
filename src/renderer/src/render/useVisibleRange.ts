import { useEffect, useState, type RefObject } from 'react'
import { visibleRange, type PageLayout, type PageRange } from '../../../core/pageLayout'

/** The pages near the visible part of a scrolling strip. Changes only when that set changes. */
export function useVisibleRange(
  container: RefObject<HTMLElement | null>,
  layout: PageLayout,
  overscan: number
): PageRange {
  const [range, setRange] = useState<PageRange>({ first: 0, last: 0 })

  useEffect(() => {
    const element = container.current
    if (!element) return

    let frame = 0
    const measure = () => {
      frame = 0
      const next = visibleRange(layout, element.scrollTop, element.clientHeight, overscan)
      setRange((current) => (current.first === next.first && current.last === next.last ? current : next))
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }

    measure()
    element.addEventListener('scroll', schedule, { passive: true })
    const resizes = new ResizeObserver(schedule)
    resizes.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener('scroll', schedule)
      resizes.disconnect()
    }
  }, [container, layout, overscan])

  return range
}
