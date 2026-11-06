import { useMemo } from 'react'
import { displayedSize, type Size } from '../../../core/geometry'
import type { PageRef } from '../../../core/model'
import { useEditor } from '../store'

const NO_PAGES: PageRef[] = []

export function usePages(): PageRef[] {
  return useEditor((state) => state.document?.pages ?? NO_PAGES)
}

/** Page sizes in points, in document order, with editor rotations applied. */
export function useDisplayedSizes(pages: PageRef[]): Size[] {
  const pageSizes = useEditor((state) => state.pageSizes)
  return useMemo(
    () => pages.map((page) => displayedSize(pageSizes[page.id]!, page.rotation)),
    [pages, pageSizes]
  )
}
