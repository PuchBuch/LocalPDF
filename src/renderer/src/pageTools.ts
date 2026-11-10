import { detectSpots, fieldsForSpots } from '../../core/detectFields'
import { turnRect } from '../../core/forms'
import { displayedSize, normalizeRotation, type Rect } from '../../core/geometry'
import { fileKind } from '../../core/loadError'
import type { Field, OcrWord, PageRef } from '../../core/model'
import { findPaperCorners, wholePicture } from '../../core/scan'
import { pageHasText, type ContentPage } from '../../export/extractContent'
import { t } from './i18n'
import { whileBusy } from './output'
import { getPdfPage } from './render/pdfjs'
import { recognizePage, startOcr } from './render/recognize'
import { preparedScan, readScanPicture, type ScanPicture } from './render/scanImage'
import { measureText } from './render/textMetrics'
import { addNotice, askScan, replacePageWithFile, useEditor } from './store'

/** Pixels per point of the picture fields are looked for in. */
const DETECT_SCALE = 2
/** Pixels darker than this count as ink. */
const DARK = 140

function chosenPages(pageId?: string): PageRef[] {
  const pages = useEditor.getState().document?.pages ?? []
  return pageId ? pages.filter((page) => page.id === pageId) : pages
}

/** Reads the text of scanned pages. Pages that have text of their own are left alone. */
export function recognizeText(pageId?: string): Promise<void> {
  return whileBusy(t.ocr.failed, async () => {
    const results: Record<string, OcrWord[]> = {}
    const toRead: PageRef[] = []
    for (const page of chosenPages(pageId)) {
      const pdfPage = await getPdfPage(page.sourceId, page.pageIndex)
      if (!(await pageHasText(pdfPage as unknown as ContentPage))) toRead.push(page)
    }
    if (toRead.length === 0) {
      useEditor.setState({ statusNote: t.ocr.nothingToRead })
      return
    }

    useEditor.setState({ statusNote: t.ocr.starting })
    const worker = await startOcr(useEditor.getState().ocrLocale)
    try {
      for (const [index, page] of toRead.entries()) {
        useEditor.setState({ statusNote: t.ocr.progress(index + 1, toRead.length) })
        const pdfPage = await getPdfPage(page.sourceId, page.pageIndex)
        results[page.id] = await recognizePage(worker, pdfPage)
      }
    } finally {
      void worker.terminate()
    }
    useEditor.getState().setPageOcr(results)
    const words = Object.values(results).reduce((total, list) => total + list.length, 0)
    useEditor.setState({ statusNote: t.ocr.done(words) })
    if (words === 0) addNotice(t.ocr.noWords)
  })
}

async function pageMask(page: PageRef): Promise<{ mask: Uint8Array; width: number; height: number }> {
  const pdfPage = await getPdfPage(page.sourceId, page.pageIndex)
  const viewport = pdfPage.getViewport({ scale: DETECT_SCALE, rotation: normalizeRotation(pdfPage.rotate + page.rotation) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  // Form fields are found by reading the file, here they would only be mistaken for blanks.
  await pdfPage.render({ canvas, viewport, annotationMode: 0 }).promise
  const { width, height } = canvas
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height)
  canvas.width = 0
  canvas.height = 0
  const mask = new Uint8Array(width * height)
  for (let index = 0; index < mask.length; index++) {
    const offset = index * 4
    if ((data[offset]! + data[offset + 1]! + data[offset + 2]!) / 3 < DARK) mask[index] = 1
  }
  return { mask, width, height }
}

/**
 * Puts a chosen file where a page was, such as the scan of a page signed by hand.
 * A photo or a scanned picture first gets its sheet cut out, straightened and cleaned.
 */
export function replacePageWithChosenFile(pageId: string): Promise<void> {
  return whileBusy(t.scan.failed, async () => {
    const [file] = await window.localpdf.chooseFiles(true)
    if (!file) return
    const kind = fileKind(file.name)
    if (kind === 'pdf' || kind === 'heic' || kind === 'other') {
      await replacePageWithFile(pageId, file)
      return
    }

    let picture: ScanPicture
    try {
      picture = await readScanPicture(kind, file.bytes)
    } catch (error) {
      console.error(error)
      addNotice(t.fileUnreadable(file.name))
      return
    }
    try {
      const found = findPaperCorners(picture.preview)
      const answer = await askScan({
        name: file.name,
        previewUrl: picture.previewUrl,
        size: { width: picture.preview.width, height: picture.preview.height },
        corners: found ?? wholePicture(picture.preview),
        found: found !== null
      })
      if (!answer) return
      useEditor.setState({ statusNote: t.scan.preparing })
      const scan = await preparedScan(picture, answer.corners, answer.look)
      const replaced = await replacePageWithFile(pageId, { name: file.name.replace(/\.[^.]*$/, '.jpg'), bytes: scan.bytes })
      useEditor.setState({ statusNote: replaced ? t.scan.done : null })
    } finally {
      URL.revokeObjectURL(picture.previewUrl)
    }
  })
}

/** Adds blank fields where a page seems to ask for them, as one step to undo. */
export function findFields(pageId?: string): Promise<void> {
  return whileBusy(t.detect.failed, async () => {
    const { pageSizes, formWidgets } = useEditor.getState()
    const found: Record<string, Field[]> = {}
    for (const page of chosenPages(pageId)) {
      const size = pageSizes[page.id]
      if (!size) continue
      const { mask, width, height } = await pageMask(page)
      const spots = detectSpots(mask, width, height, DETECT_SCALE)
      const taken: Rect[] = [
        ...page.fields,
        ...(formWidgets[page.id] ?? []).map((widget) => turnRect(widget.rect, size, page.rotation))
      ]
      const fields = fieldsForSpots(spots, taken, displayedSize(size, page.rotation), measureText, () => crypto.randomUUID())
      if (fields.length > 0) found[page.id] = fields
    }
    useEditor.getState().addFoundFields(found)
    const count = Object.values(found).reduce((total, fields) => total + fields.length, 0)
    useEditor.setState({ statusNote: count > 0 ? t.detect.found(count) : t.detect.none })
  })
}
