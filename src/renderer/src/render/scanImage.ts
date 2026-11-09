import type { Size } from '../../../core/geometry'
import type { FileKind } from '../../../core/loadError'
import type { ImageAsset } from '../../../core/model'
import { straighten, straightenedSize, whitenPaper, type Pixels, type Quad } from '../../../core/scan'

/** A larger photo is shrunk first: more detail than this does not reach a 200 dpi page. */
const MAX_PICTURE_SIDE = 4000
/** The sheet is looked for, and shown in the dialog, at this size. */
const PREVIEW_SIDE = 900
/** Small enough for an upload portal, with no visible loss on text and signatures. */
const SCAN_JPEG_QUALITY = 0.8

/** A photo or scan read for preparing as a page. */
export interface ScanPicture {
  /** The picture itself, upright. */
  full: Pixels
  /** The same, smaller, to show and to look for the sheet in. */
  preview: Pixels
  previewUrl: string
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function pixelsOf(canvas: HTMLCanvasElement): Pixels {
  const { width, height } = canvas
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height)
  return { width, height, data }
}

function scaledToFit(size: Size, longSide: number): Size {
  const scale = Math.min(1, longSide / Math.max(size.width, size.height))
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
}

export async function readScanPicture(kind: FileKind, bytes: Uint8Array): Promise<ScanPicture> {
  // createImageBitmap turns the photo upright, as the camera recorded it.
  const bitmap = await createImageBitmap(new Blob([bytes.slice()], { type: `image/${kind}` }))
  try {
    const fullSize = scaledToFit(bitmap, MAX_PICTURE_SIDE)
    const fullCanvas = canvasOf(fullSize.width, fullSize.height)
    fullCanvas.getContext('2d')!.drawImage(bitmap, 0, 0, fullSize.width, fullSize.height)
    const previewSize = scaledToFit(fullSize, PREVIEW_SIDE)
    const previewCanvas = canvasOf(previewSize.width, previewSize.height)
    previewCanvas.getContext('2d')!.drawImage(fullCanvas, 0, 0, previewSize.width, previewSize.height)
    const blob = await new Promise<Blob | null>((done) => previewCanvas.toBlob(done, 'image/jpeg', 0.85))
    if (!blob) throw new Error('The picture could not be shown')
    const picture = { full: pixelsOf(fullCanvas), preview: pixelsOf(previewCanvas), previewUrl: URL.createObjectURL(blob) }
    fullCanvas.width = 0
    previewCanvas.width = 0
    return picture
  } finally {
    bitmap.close()
  }
}

/** The sheet cut out along the corners chosen on the preview, straightened, and made a JPEG. */
export async function preparedScan(picture: ScanPicture, previewCorners: Quad, whiten: boolean): Promise<ImageAsset> {
  const scale = picture.full.width / picture.preview.width
  const corners = previewCorners.map(({ x, y }) => ({ x: x * scale, y: y * scale })) as Quad
  // Even a picture taken whole is brought down to the page's resolution.
  let page = straighten(picture.full, corners, straightenedSize(corners))
  if (whiten) page = whitenPaper(page)

  const canvas = canvasOf(page.width, page.height)
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(page.data), page.width, page.height), 0, 0)
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', SCAN_JPEG_QUALITY))
  canvas.width = 0
  if (!blob) throw new Error('The scan could not be converted')
  return { mime: 'image/jpeg', bytes: new Uint8Array(await blob.arrayBuffer()) }
}
