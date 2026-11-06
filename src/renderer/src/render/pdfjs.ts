import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

const assetUrl = (directory: string) => new URL(`pdfjs/${directory}/`, window.location.href).href

const openDocuments = new Map<string, PDFDocumentProxy>()

/** Opens bytes that are not part of the document. Destroy its loading task when done. */
export function openPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  return getDocument({
    // pdf.js moves the buffer it gets to its worker. The source must stay usable for export.
    data: bytes.slice(),
    password,
    cMapUrl: assetUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts'),
    wasmUrl: assetUrl('wasm'),
    iccUrl: assetUrl('iccs')
  }).promise
}

export async function loadPdf(sourceId: string, bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const pdf = await openPdf(bytes)
  openDocuments.set(sourceId, pdf)
  return pdf
}

export function getPdfPage(sourceId: string, pageIndex: number): Promise<PDFPageProxy> {
  const pdf = openDocuments.get(sourceId)
  if (!pdf) throw new Error(`Source is not loaded: ${sourceId}`)
  return pdf.getPage(pageIndex + 1)
}

export function closeAllPdfs(): void {
  for (const pdf of openDocuments.values()) void pdf.loadingTask.destroy()
  openDocuments.clear()
}
