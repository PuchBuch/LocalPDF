import type { Point, Size } from './geometry'

/** An RGBA picture, as a canvas gives it. */
export interface Pixels {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** The corners of a sheet: top left, top right, bottom right, bottom left. */
export type Quad = [Point, Point, Point, Point]

/** The paper must cover at least this share of the picture to count as found. */
const MIN_PAPER_SHARE = 0.15
/** Paper is at least this light, on a scale to 255, and this much lighter than the rest. */
const MIN_PAPER_LIGHT = 120
const MIN_PAPER_CONTRAST = 40
/** Share of the way to the middle that found corners are moved in by. */
const EDGE_INSET = 0.012
/** A sheet whose sides come this close to A4's are taken as A4. */
const A4_TOLERANCE = 0.1
/** A4 in whole points, as pages are made, so that the picture fills the page exactly. */
const A4_RATIO = 842 / 595
/** 200 dots per inch on A4: sharp enough for a signature, small enough for an upload. */
export const SCAN_LONG_SIDE = 2339
/** Blocks per short side when measuring how light the paper is. */
const LIGHT_BLOCKS = 48
/** After evening out the light, these levels become black and white. */
const INK_LEVEL = 25
const PAPER_LEVEL = 215

export function wholePicture({ width, height }: Size): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height }
  ]
}

function grayOf({ width, height, data }: Pixels): Float32Array {
  const gray = new Float32Array(width * height)
  for (let index = 0; index < gray.length; index++) {
    const offset = index * 4
    gray[index] = 0.299 * data[offset]! + 0.587 * data[offset + 1]! + 0.114 * data[offset + 2]!
  }
  return gray
}

function boxBlur(values: Float32Array, width: number, height: number, radius: number): Float32Array {
  const across = new Float32Array(values.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let count = 0
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx
        if (nx < 0 || nx >= width) continue
        sum += values[y * width + nx]!
        count++
      }
      across[y * width + x] = sum / count
    }
  }
  const result = new Float32Array(values.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let count = 0
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        sum += across[ny * width + x]!
        count++
      }
      result[y * width + x] = sum / count
    }
  }
  return result
}

/** The level that best splits the values into a dark and a light group. */
function otsuLevel(values: Float32Array): number {
  const histogram = new Float64Array(256)
  for (const value of values) histogram[Math.min(255, Math.max(0, Math.round(value)))]!++
  const total = values.length
  let sumAll = 0
  for (let level = 0; level < 256; level++) sumAll += level * histogram[level]!
  let darkCount = 0
  let darkSum = 0
  let best = 0
  let bestLevel = 128
  for (let level = 0; level < 256; level++) {
    darkCount += histogram[level]!
    if (darkCount === 0) continue
    const lightCount = total - darkCount
    if (lightCount === 0) break
    darkSum += level * histogram[level]!
    const between = darkCount * lightCount * (darkSum / darkCount - (sumAll - darkSum) / lightCount) ** 2
    if (between > best) {
      best = between
      bestLevel = level
    }
  }
  return bestLevel
}

/** The light region holding the middle of the picture, or else the largest one. */
function paperRegion(light: Uint8Array, width: number, height: number): { pixels: Int32Array; count: number } | null {
  const labels = new Int32Array(width * height)
  const stack = new Int32Array(width * height)
  let best: { label: number; count: number; middle: boolean } | null = null
  const middle = Math.floor(height / 2) * width + Math.floor(width / 2)
  let label = 0
  for (let start = 0; start < light.length; start++) {
    if (!light[start] || labels[start]) continue
    label++
    let top = 0
    let count = 0
    let holdsMiddle = false
    stack[top++] = start
    labels[start] = label
    while (top > 0) {
      const index = stack[--top]!
      count++
      if (index === middle) holdsMiddle = true
      const x = index % width
      const neighbours = [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index - width, index + width]
      for (const next of neighbours) {
        if (next < 0 || next >= light.length || !light[next] || labels[next]) continue
        labels[next] = label
        stack[top++] = next
      }
    }
    const better = !best || (holdsMiddle && !best.middle) || (holdsMiddle === best.middle && count > best.count)
    if (better) best = { label, count, middle: holdsMiddle }
  }
  if (!best) return null
  const pixels = new Int32Array(best.count)
  let next = 0
  for (let index = 0; index < labels.length; index++) if (labels[index] === best.label) pixels[next++] = index
  return { pixels, count: best.count }
}

function quadArea(quad: Quad): number {
  let twice = 0
  for (let index = 0; index < 4; index++) {
    const a = quad[index]!
    const b = quad[(index + 1) % 4]!
    twice += a.x * b.y - b.x * a.y
  }
  return Math.abs(twice) / 2
}

/**
 * Finds the corners of a sheet of paper lying on a darker surface, as in a photo.
 * Null when there is no such sheet, as in a scan where the paper fills the picture.
 */
export function findPaperCorners(picture: Pixels): Quad | null {
  const { width, height } = picture
  const gray = boxBlur(grayOf(picture), width, height, 2)
  const level = otsuLevel(gray)
  const light = new Uint8Array(gray.length)
  for (let index = 0; index < gray.length; index++) light[index] = gray[index]! > level ? 1 : 0
  const region = paperRegion(light, width, height)
  if (!region || region.count < MIN_PAPER_SHARE * width * height) return null

  // Paper is light, and clearly lighter than what it lies on: not just the lighter half of a table.
  let regionSum = 0
  for (const index of region.pixels) regionSum += gray[index]!
  let totalSum = 0
  for (const value of gray) totalSum += value
  const paperLight = regionSum / region.count
  const restLight = region.count < gray.length ? (totalSum - regionSum) / (gray.length - region.count) : 0
  if (paperLight < MIN_PAPER_LIGHT || paperLight - restLight < MIN_PAPER_CONTRAST) return null

  // The paper reaching three edges of the picture fills it: there is nothing to cut away.
  let left = 0
  let right = 0
  let top = 0
  let bottom = 0
  for (const index of region.pixels) {
    const x = index % width
    const y = (index - x) / width
    if (x === 0) left++
    if (x === width - 1) right++
    if (y === 0) top++
    if (y === height - 1) bottom++
  }
  const edgesReached = [left / height, right / height, top / width, bottom / width].filter((share) => share > 0.5).length
  if (edgesReached >= 3) return null

  // The corners stand out as the farthest points in the four diagonal directions.
  let topLeft = { x: 0, y: 0, score: Infinity }
  let bottomRight = { x: 0, y: 0, score: -Infinity }
  let topRight = { x: 0, y: 0, score: -Infinity }
  let bottomLeft = { x: 0, y: 0, score: Infinity }
  for (const index of region.pixels) {
    const x = index % width
    const y = (index - x) / width
    if (x + y < topLeft.score) topLeft = { x, y, score: x + y }
    if (x + y > bottomRight.score) bottomRight = { x: x + 1, y: y + 1, score: x + y }
    if (x - y > topRight.score) topRight = { x: x + 1, y, score: x - y }
    if (x - y < bottomLeft.score) bottomLeft = { x, y: y + 1, score: x - y }
  }
  const quad: Quad = [topLeft, topRight, bottomRight, bottomLeft].map(({ x, y }) => ({ x, y })) as Quad
  // Corners that cut away much of the region were not corners of a sheet.
  if (quadArea(quad) < 0.8 * region.count) return null
  // A blurred edge would leave a sliver of the table along the page: the cut goes just inside.
  const centre = { x: quad.reduce((sum, { x }) => sum + x, 0) / 4, y: quad.reduce((sum, { y }) => sum + y, 0) / 4 }
  return quad.map(({ x, y }) => ({ x: x + (centre.x - x) * EDGE_INSET, y: y + (centre.y - y) * EDGE_INSET })) as Quad
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** The size of the straightened sheet in pixels: A4 when it is close to A4, never larger than needed. */
export function straightenedSize(quad: Quad): Size {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad
  const width = (distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2
  const height = (distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2
  const portrait = height >= width
  const long = portrait ? height : width
  const short = portrait ? width : height
  let ratio = long / Math.max(short, 1)
  if (Math.abs(ratio - A4_RATIO) / A4_RATIO < A4_TOLERANCE) ratio = A4_RATIO
  const longSide = Math.round(Math.min(SCAN_LONG_SIDE, Math.max(long, short * ratio)))
  const shortSide = Math.round(longSide / ratio)
  return portrait ? { width: shortSide, height: longSide } : { width: longSide, height: shortSide }
}

/** Solves a small linear system by elimination. */
function solve(matrix: number[][], values: number[]): number[] {
  const size = values.length
  const rows = matrix.map((row, index) => [...row, values[index]!])
  for (let column = 0; column < size; column++) {
    let pivot = column
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row
    }
    ;[rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!]
    const lead = rows[column]![column]!
    if (Math.abs(lead) < 1e-12) throw new Error('The corners do not make a sheet')
    for (let row = 0; row < size; row++) {
      if (row === column) continue
      const factor = rows[row]![column]! / lead
      for (let index = column; index <= size; index++) rows[row]![index]! -= factor * rows[column]![index]!
    }
  }
  return rows.map((row, index) => row[size]! / row[index]!)
}

/** The projective map taking the corners of a width × height rectangle to the quad. */
export function rectangleToQuad(size: Size, quad: Quad): (x: number, y: number) => Point {
  const corners = wholePicture(size)
  const matrix: number[][] = []
  const values: number[] = []
  corners.forEach((from, index) => {
    const to = quad[index]!
    matrix.push([from.x, from.y, 1, 0, 0, 0, -from.x * to.x, -from.y * to.x])
    values.push(to.x)
    matrix.push([0, 0, 0, from.x, from.y, 1, -from.x * to.y, -from.y * to.y])
    values.push(to.y)
  })
  const [a, b, c, d, e, f, g, h] = solve(matrix, values) as [number, number, number, number, number, number, number, number]
  return (x, y) => {
    const w = g * x + h * y + 1
    return { x: (a * x + b * y + c) / w, y: (d * x + e * y + f) / w }
  }
}

/** Cuts the sheet out of the picture and makes it a straight rectangle. */
export function straighten(picture: Pixels, quad: Quad, size: Size): Pixels {
  const { width, height } = size
  const map = rectangleToQuad(size, quad)
  const data = new Uint8ClampedArray(width * height * 4)
  const source = picture.data
  const maxX = picture.width - 1
  const maxY = picture.height - 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const point = map(x + 0.5, y + 0.5)
      const px = Math.min(maxX, Math.max(0, point.x - 0.5))
      const py = Math.min(maxY, Math.max(0, point.y - 0.5))
      const x0 = Math.floor(px)
      const y0 = Math.floor(py)
      const x1 = Math.min(maxX, x0 + 1)
      const y1 = Math.min(maxY, y0 + 1)
      const fx = px - x0
      const fy = py - y0
      const out = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        const topRow = source[(y0 * picture.width + x0) * 4 + channel]! * (1 - fx) + source[(y0 * picture.width + x1) * 4 + channel]! * fx
        const bottomRow = source[(y1 * picture.width + x0) * 4 + channel]! * (1 - fx) + source[(y1 * picture.width + x1) * 4 + channel]! * fx
        data[out + channel] = topRow * (1 - fy) + bottomRow * fy
      }
      data[out + 3] = 255
    }
  }
  return { width, height, data }
}

/**
 * Evens out the light on a photographed sheet: shadows and a grey cast go, the paper
 * turns white, and ink stays dark and keeps its colour.
 */
export function whitenPaper(picture: Pixels): Pixels {
  const { width, height, data } = picture
  const block = Math.max(4, Math.round(Math.min(width, height) / LIGHT_BLOCKS))
  const columns = Math.ceil(width / block)
  const rows = Math.ceil(height / block)

  // The paper's brightness in each block: the light end of it, so that ink does not count.
  const brightest = new Float32Array(columns * rows)
  const gray = grayOf(picture)
  const samples: number[] = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      samples.length = 0
      for (let y = row * block; y < Math.min(height, (row + 1) * block); y++) {
        for (let x = column * block; x < Math.min(width, (column + 1) * block); x++) samples.push(gray[y * width + x]!)
      }
      samples.sort((a, b) => a - b)
      brightest[row * columns + column] = samples[Math.floor(samples.length * 0.9)] ?? 255
    }
  }
  // A block full of ink takes the light of its neighbours, then the light is smoothed.
  const spread = new Float32Array(brightest.length)
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let most = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const r = row + dy
          const c = column + dx
          if (r >= 0 && r < rows && c >= 0 && c < columns) most = Math.max(most, brightest[r * columns + c]!)
        }
      }
      spread[row * columns + column] = most
    }
  }
  const paper = boxBlur(spread, columns, rows, 1)

  const result = new Uint8ClampedArray(data.length)
  for (let y = 0; y < height; y++) {
    const fy = Math.min(rows - 1, Math.max(0, (y + 0.5) / block - 0.5))
    const r0 = Math.floor(fy)
    const r1 = Math.min(rows - 1, r0 + 1)
    const wy = fy - r0
    for (let x = 0; x < width; x++) {
      const fx = Math.min(columns - 1, Math.max(0, (x + 0.5) / block - 0.5))
      const c0 = Math.floor(fx)
      const c1 = Math.min(columns - 1, c0 + 1)
      const wx = fx - c0
      const light =
        (paper[r0 * columns + c0]! * (1 - wx) + paper[r0 * columns + c1]! * wx) * (1 - wy) +
        (paper[r1 * columns + c0]! * (1 - wx) + paper[r1 * columns + c1]! * wx) * wy
      const gain = 255 / Math.max(light, 16)
      const offset = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        const even = data[offset + channel]! * gain
        result[offset + channel] = ((even - INK_LEVEL) * 255) / (PAPER_LEVEL - INK_LEVEL)
      }
      result[offset + 3] = 255
    }
  }
  return { width, height, data: result }
}
