// Draws build/icon.png and build/icon.ico from build/icon.svg. Run it after changing the drawing.
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

// Each size is drawn from the vector itself, so small ones stay sharp instead of being shrunk from a large picture.
export async function renderIcon(size) {
  const svg = (await readFile('build/icon.svg', 'utf8')).replace('<svg ', `<svg width="${size}" height="${size}" `)
  const canvas = createCanvas(size, size)
  canvas.getContext('2d').drawImage(await loadImage(Buffer.from(svg)), 0, 0, size, size)
  return canvas.toBuffer('image/png')
}

// An .ico file of PNG images, which Windows reads since Vista.
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map(({ png }) => png)])
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile('build/icon.png', await renderIcon(512))
  const images = []
  for (const size of ICO_SIZES) images.push({ size, png: await renderIcon(size) })
  await writeFile('build/icon.ico', ico(images))
  console.log('Wrote build/icon.png and build/icon.ico')
}
