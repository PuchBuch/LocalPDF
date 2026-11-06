import { PDFDocument } from 'pdf-lib'
import type { Size } from '../core/geometry'
import type { ImageAsset } from '../core/model'

const A4_LONG_SIDE = 842
const A4_SHORT_SIDE = 595

/** A page with the image's proportions, as large as fits on A4 in the same orientation. */
export function imagePageSize(image: Size): Size {
  const longSide = Math.max(image.width, image.height)
  const shortSide = Math.min(image.width, image.height)
  const scale = Math.min(A4_LONG_SIDE / longSide, A4_SHORT_SIDE / shortSide)
  return { width: image.width * scale, height: image.height * scale }
}

/** A one-page PDF holding the image, so an image page behaves like any other page. */
export async function imageToPdf(image: ImageAsset): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const embedded =
    image.mime === 'image/png' ? await document.embedPng(image.bytes) : await document.embedJpg(image.bytes)
  const { width, height } = imagePageSize(embedded)
  document.addPage([width, height]).drawImage(embedded, { x: 0, y: 0, width, height })
  return document.save()
}
