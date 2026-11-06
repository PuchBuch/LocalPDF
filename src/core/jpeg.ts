const ORIENTATION_TAG = 0x0112
const START_OF_SCAN = 0xda

/** The EXIF orientation of a JPEG, from 1 to 8. 1 means the pixels are stored upright. */
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  try {
    if (view.getUint16(0) !== 0xffd8) return 1
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (view.getUint8(offset) !== 0xff) return 1
      const marker = view.getUint8(offset + 1)
      if (marker === START_OF_SCAN) return 1
      const length = view.getUint16(offset + 2)
      if (marker === 0xe1 && isExifHeader(view, offset + 4)) return readOrientation(view, offset + 10)
      offset += 2 + length
    }
  } catch {
    // A truncated header is treated like a photo without orientation data.
  }
  return 1
}

function isExifHeader(view: DataView, offset: number): boolean {
  return view.getUint32(offset) === 0x45786966 && view.getUint16(offset + 4) === 0
}

function readOrientation(view: DataView, tiffStart: number): number {
  const littleEndian = view.getUint16(tiffStart) === 0x4949
  const firstDirectory = tiffStart + view.getUint32(tiffStart + 4, littleEndian)
  const entries = view.getUint16(firstDirectory, littleEndian)
  for (let entry = 0; entry < entries; entry++) {
    const offset = firstDirectory + 2 + entry * 12
    if (view.getUint16(offset, littleEndian) === ORIENTATION_TAG) {
      const value = view.getUint16(offset + 8, littleEndian)
      return value >= 1 && value <= 8 ? value : 1
    }
  }
  return 1
}
