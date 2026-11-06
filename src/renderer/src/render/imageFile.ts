import type { Size } from '../../../core/geometry'
import { jpegOrientation } from '../../../core/jpeg'
import type { FileKind } from '../../../core/loadError'
import type { ImageAsset } from '../../../core/model'

const JPEG_QUALITY = 0.95
/** Below this, a pixel of a signature counts as empty. */
const INK_ALPHA = 8
const TRIM_PADDING = 4

function blobOf(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes.slice()], { type })
}

/**
 * Makes an image file embeddable in a PDF, which takes only upright JPEG and PNG.
 * Those are kept byte for byte, anything else is redrawn by the browser.
 */
export async function prepareImage(kind: FileKind, bytes: Uint8Array): Promise<ImageAsset> {
  if (kind === 'png') return { mime: 'image/png', bytes }
  if (kind === 'jpeg' && jpegOrientation(bytes) === 1) return { mime: 'image/jpeg', bytes }

  // createImageBitmap applies the EXIF orientation.
  const bitmap = await createImageBitmap(blobOf(bytes, `image/${kind}`))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()

  const mime = kind === 'jpeg' ? 'image/jpeg' : 'image/png'
  return { mime, bytes: await canvasBytes(canvas, mime) }
}

async function canvasBytes(canvas: HTMLCanvasElement, mime: ImageAsset['mime']): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, JPEG_QUALITY))
  if (!blob) throw new Error('The image could not be converted')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Also fails on a file that is damaged, which the PDF library may not notice. */
export async function imageSize(image: ImageAsset): Promise<Size> {
  const bitmap = await createImageBitmap(blobOf(image.bytes, image.mime))
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

/** A transparent PNG of what is drawn on a canvas, cut down to the drawing itself. */
export async function trimmedPng(canvas: HTMLCanvasElement): Promise<ImageAsset> {
  const { width, height } = canvas
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height)
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! < INK_ALPHA) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < 0) throw new Error('The canvas is empty')

  left = Math.max(0, left - TRIM_PADDING)
  top = Math.max(0, top - TRIM_PADDING)
  const trimmed = document.createElement('canvas')
  trimmed.width = Math.min(width, right + TRIM_PADDING + 1) - left
  trimmed.height = Math.min(height, bottom + TRIM_PADDING + 1) - top
  trimmed.getContext('2d')!.drawImage(canvas, -left, -top)
  return { mime: 'image/png', bytes: await canvasBytes(trimmed, 'image/png') }
}
