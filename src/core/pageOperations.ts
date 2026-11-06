import { turnRect } from './forms'
import { normalizeRotation, rotateRectClockwise, type Size } from './geometry'
import type { EditorDocument } from './model'

/** Removes a page and its fields. A document always keeps at least one page. */
export function deletePage(document: EditorDocument, pageId: string): void {
  if (document.pages.length <= 1) return
  const index = document.pages.findIndex((page) => page.id === pageId)
  if (index >= 0) document.pages.splice(index, 1)
}

/** Swaps a page with its neighbour. Moving past either end does nothing. */
export function movePage(document: EditorDocument, pageId: string, delta: -1 | 1): void {
  const { pages } = document
  const index = pages.findIndex((page) => page.id === pageId)
  const page = pages[index]
  const neighbour = pages[index + delta]
  if (!page || !neighbour) return
  pages[index] = neighbour
  pages[index + delta] = page
}

/** Turns a page 90 degrees clockwise. Its fields stay over the same content. */
export function rotatePageClockwise(document: EditorDocument, pageId: string, sizeBeforeRotation: Size): void {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) return
  page.rotation = normalizeRotation(page.rotation + 90)
  for (const field of page.fields) {
    Object.assign(field, rotateRectClockwise(field, sizeBeforeRotation))
    // Unlike the upright field, a painted-out area belongs to the page and turns with it.
    if (field.type === 'TEXT' && field.cover) {
      field.cover = { ...field.cover, ...turnRect(field.cover, sizeBeforeRotation, 90) }
    }
  }
}
