// Draws the app icon: a page with a folded corner and a pencil mark, in the blue of the app.
import { mkdir, writeFile } from 'node:fs/promises'
import { createCanvas } from '@napi-rs/canvas'

const SIZE = 512
const canvas = createCanvas(SIZE, SIZE)
const context = canvas.getContext('2d')

const BLUE = '#2460c8'
const DARK = '#173f87'

// The round square behind the page.
context.fillStyle = BLUE
context.beginPath()
context.roundRect(16, 16, SIZE - 32, SIZE - 32, 96)
context.fill()

// The page, with its top right corner cut off for the fold.
const left = 136
const top = 80
const right = 376
const bottom = 432
const fold = 88
context.fillStyle = '#ffffff'
context.beginPath()
context.moveTo(left, top + 16)
context.quadraticCurveTo(left, top, left + 16, top)
context.lineTo(right - fold, top)
context.lineTo(right, top + fold)
context.lineTo(right, bottom - 16)
context.quadraticCurveTo(right, bottom, right - 16, bottom)
context.lineTo(left + 16, bottom)
context.quadraticCurveTo(left, bottom, left, bottom - 16)
context.closePath()
context.fill()

context.fillStyle = '#b9cdf0'
context.beginPath()
context.moveTo(right - fold, top)
context.lineTo(right, top + fold)
context.lineTo(right - fold, top + fold)
context.closePath()
context.fill()

// Lines of text, one of them being written.
context.fillStyle = DARK
for (const [y, width] of [
  [212, 176],
  [260, 176],
  [308, 112]
]) {
  context.beginPath()
  context.roundRect(left + 32, y, width, 20, 10)
  context.fill()
}

await mkdir('build', { recursive: true })
await writeFile('build/icon.png', canvas.toBuffer('image/png'))
