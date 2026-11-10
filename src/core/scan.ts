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
/** Looking for the edges of the sheet: weakest change of brightness that counts, on a 0–255 scale. */
const MIN_EDGE_STRENGTH = 40
/** Degrees either side of its own direction that an edge pixel votes for. */
const ANGLE_SPREAD = 3
/** A side is at least this share of the photo's short side long. */
const MIN_LINE_SHARE = 0.15
const MAX_LINE_CANDIDATES = 60
/** A side may lean this far from upright or level, as the cosine of its normal. */
const MAX_SIDE_TILT = 0.5
/** A side lies at least this share of the way from the middle out. */
const MIN_SIDE_OFFSET = 0.2
/** Along a side, paper is looked at this far in on one side and out on the other. */
const EDGE_PROBE = 5
const EDGE_STEP = 8
const EDGE_SAMPLE_STEP = 3
const MIN_EDGE_SAMPLES = 20
/** At least this share of a side must show paper on its inner side. */
const MIN_EDGE_LIKENESS = 0.45
/** A sheet whose sides come this close to A4's are taken as A4. */
const A4_TOLERANCE = 0.1
/** A4 in whole points, as pages are made, so that the picture fills the page exactly. */
const A4_RATIO = 842 / 595
/** 200 dots per inch on A4: sharp enough for a signature, small enough for an upload. */
export const SCAN_LONG_SIDE = 2339
/** Blocks per short side when measuring how light the paper is. */
const LIGHT_BLOCKS = 48
/** The paper's colour in a block is taken from its pixels between these brightness ranks. */
const PAPER_RANK_FROM = 0.8
const PAPER_RANK_TO = 0.97
/** Against white paper as 1: below the first is black, above the second white. */
const INK_LEVEL = 0.1
const PAPER_LEVEL = 0.92
/** Above 1, strokes that came out grey are made darker, so thin print does not fade. */
const INK_DEPTH = 2
/** How much the edges of strokes are sharpened. */
const SHARPEN = 1
/** Ink with less colour than this is taken as black or grey, without a tint. */
const NEUTRAL_CHROMA = 0.06

/** How a sheet is cleaned: in colour, as for a coloured signature, or in shades of grey. */
export type PaperLook = 'color' | 'gray'

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
 * Finds the corners of a sheet of paper in a photo. A side the photo cut off lies on
 * the photo's edge. Null when there is no sheet to cut out, as in a scan.
 */
export function findPaperCorners(picture: Pixels): Quad | null {
  const gray = boxBlur(grayOf(picture), picture.width, picture.height, 2)
  const quad = sheetByEdges(gray, picture.width, picture.height) ?? sheetByBrightness(gray, picture.width, picture.height)
  if (!quad) return null
  // A blurred edge would leave a sliver of the table along the page: the cut goes just inside.
  const centre = { x: quad.reduce((sum, { x }) => sum + x, 0) / 4, y: quad.reduce((sum, { y }) => sum + y, 0) / 4 }
  return quad.map(({ x, y }) => ({ x: x + (centre.x - x) * EDGE_INSET, y: y + (centre.y - y) * EDGE_INSET })) as Quad
}

/** A straight line as its normal angle and its distance from the top-left corner. */
interface Line {
  angle: number
  distance: number
}

/** Where two lines cross, or null for parallel lines. */
function crossing(a: Line, b: Line): Point | null {
  const [ca, sa, cb, sb] = [Math.cos(a.angle), Math.sin(a.angle), Math.cos(b.angle), Math.sin(b.angle)]
  const determinant = ca * sb - sa * cb
  if (Math.abs(determinant) < 1e-6) return null
  return { x: (a.distance * sb - b.distance * sa) / determinant, y: (ca * b.distance - cb * a.distance) / determinant }
}

/**
 * How long a stretch of a line looks like the edge of the sheet, in pixels: along it, the
 * side towards the middle of the photo is clearly lighter than the other, with few gaps.
 * The lines of a form, rows of text and folds have paper on both sides, and give 0.
 */
function edgeLength(gray: Float32Array, width: number, height: number, line: Line): number {
  const normal = { x: Math.cos(line.angle), y: Math.sin(line.angle) }
  const along = { x: -normal.y, y: normal.x }
  const middleSide = Math.sign((width / 2) * normal.x + (height / 2) * normal.y - line.distance) || 1
  const at = (x: number, y: number) => gray[Math.round(y) * width + Math.round(x)]!
  const inside = (point: Point) => point.x >= 0 && point.y >= 0 && point.x <= width - 1 && point.y <= height - 1
  const marks: boolean[] = []
  const reach = Math.hypot(width, height)
  for (let t = -reach; t <= reach; t += EDGE_SAMPLE_STEP) {
    const x = line.distance * normal.x + t * along.x
    const y = line.distance * normal.y + t * along.y
    const inner = { x: x + middleSide * EDGE_PROBE * normal.x, y: y + middleSide * EDGE_PROBE * normal.y }
    const outer = { x: x - middleSide * EDGE_PROBE * normal.x, y: y - middleSide * EDGE_PROBE * normal.y }
    if (!inside(inner) || !inside(outer)) continue
    marks.push(at(inner.x, inner.y) - at(outer.x, outer.y) >= EDGE_STEP)
  }
  // The edge of a sheet is one stretch: from its first sample to its last, nearly all of it is edge.
  const first = marks.indexOf(true)
  const last = marks.lastIndexOf(true)
  if (first < 0) return 0
  const edge = marks.slice(first, last + 1).filter(Boolean).length
  if (edge < MIN_EDGE_SAMPLES || edge / (last - first + 1) < MIN_EDGE_LIKENESS) return 0
  return edge * EDGE_SAMPLE_STEP
}

/**
 * Finds the sheet by its four edges: straight lines with paper on one side, which works on
 * a light table too. A side the photo cut off is the photo's own edge. Null when no edge is seen.
 */
function sheetByEdges(gray: Float32Array, width: number, height: number): Quad | null {
  // Strong changes of brightness, and which way they face.
  const strength = new Float32Array(gray.length)
  const facing = new Float32Array(gray.length)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = (dx: number, dy: number) => gray[(y + dy) * width + x + dx]!
      const gx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1)
      const gy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1)
      strength[y * width + x] = Math.hypot(gx, gy)
      facing[y * width + x] = Math.atan2(gy, gx)
    }
  }
  // A fixed level: a page full of print must not raise it above the sheet's own faint edges.
  const threshold = MIN_EDGE_STRENGTH

  // Every strong pixel votes for the lines through it that run along its edge.
  const angles = 180
  const reach = Math.ceil(Math.hypot(width, height))
  const votes = new Float32Array(angles * (2 * reach + 1))
  for (let index = 0; index < strength.length; index++) {
    if (strength[index]! < threshold) continue
    const x = index % width
    const y = (index - x) / width
    const own = Math.round((facing[index]! * 180) / Math.PI)
    for (let delta = -ANGLE_SPREAD; delta <= ANGLE_SPREAD; delta++) {
      const degree = (((own + delta) % 180) + 180) % 180
      const angle = (degree * Math.PI) / 180
      const distance = Math.round(x * Math.cos(angle) + y * Math.sin(angle))
      votes[degree * (2 * reach + 1) + distance + reach]!++
    }
  }

  // The strongest lines, each a local peak, as candidates for the four sides.
  const peaks: (Line & { votes: number })[] = []
  const minVotes = MIN_LINE_SHARE * Math.min(width, height)
  for (let degree = 0; degree < angles; degree++) {
    for (let offset = 2; offset < 2 * reach - 1; offset++) {
      const count = votes[degree * (2 * reach + 1) + offset]!
      if (count < minVotes) continue
      let peak = true
      for (let dd = -2; dd <= 2 && peak; dd++) {
        for (let dr = -3; dr <= 3; dr++) {
          const neighbour = votes[(((degree + dd) % angles) + angles) % angles * (2 * reach + 1) + offset + dr]!
          if (neighbour > count || (neighbour === count && (dd < 0 || (dd === 0 && dr < 0)))) {
            peak = false
            break
          }
        }
      }
      if (peak) peaks.push({ angle: (degree * Math.PI) / 180, distance: offset - reach, votes: count })
    }
  }
  peaks.sort((a, b) => b.votes - a.votes)

  // For each side, the most edge-like line on that side of the middle.
  const middle = { x: width / 2, y: height / 2 }
  const sides: { horizontal: boolean; before: boolean }[] = [
    { horizontal: true, before: true },
    { horizontal: false, before: false },
    { horizontal: true, before: false },
    { horizontal: false, before: true }
  ]
  const chosen = sides.map(({ horizontal, before }) => {
    let best: { line: Line; score: number } | null = null
    for (const peak of peaks.slice(0, MAX_LINE_CANDIDATES)) {
      const tilt = Math.abs(Math.cos(peak.angle))
      if (horizontal ? tilt > MAX_SIDE_TILT : tilt < 1 - MAX_SIDE_TILT) continue
      const position = horizontal
        ? (peak.distance - middle.x * Math.cos(peak.angle)) / Math.sin(peak.angle)
        : (peak.distance - middle.y * Math.sin(peak.angle)) / Math.cos(peak.angle)
      const centre = horizontal ? middle.y : middle.x
      if (before ? position > centre * (1 - MIN_SIDE_OFFSET) : position < centre * (1 + MIN_SIDE_OFFSET)) continue
      const score = edgeLength(gray, width, height, peak)
      if (score >= minVotes && (!best || score > best.score)) best = { line: peak, score }
    }
    return best?.line ?? null
  })
  if (chosen.every((line) => line === null)) return null

  // A side not seen is the photo's own edge.
  const frame: Line[] = [
    { angle: Math.PI / 2, distance: 0 },
    { angle: 0, distance: width },
    { angle: Math.PI / 2, distance: height },
    { angle: 0, distance: 0 }
  ]
  const [top, right, bottom, left] = chosen.map((line, index) => line ?? frame[index]!) as [Line, Line, Line, Line]
  const corners = [crossing(top, left), crossing(top, right), crossing(bottom, right), crossing(bottom, left)]
  if (corners.some((corner) => corner === null)) return null
  const quad = corners.map((corner) => ({
    x: Math.min(width, Math.max(0, corner!.x)),
    y: Math.min(height, Math.max(0, corner!.y))
  })) as Quad
  return quadArea(quad) < MIN_PAPER_SHARE * 2 * width * height ? null : quad
}

/** Finds a sheet lying on a clearly darker surface by its lightness. */
function sheetByBrightness(gray: Float32Array, width: number, height: number): Quad | null {
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
  return quadArea(quad) < 0.8 * region.count ? null : quad
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


/** Sorts pixel indices by brightness inside a block, and averages the colour of the paper ranks. */
function blockPaperColor(picture: Pixels, gray: Float32Array, indices: number[]): [number, number, number] {
  indices.sort((a, b) => gray[a]! - gray[b]!)
  const from = Math.floor(indices.length * PAPER_RANK_FROM)
  const to = Math.max(from + 1, Math.floor(indices.length * PAPER_RANK_TO))
  let red = 0
  let green = 0
  let blue = 0
  for (let rank = from; rank < to; rank++) {
    const offset = indices[rank]! * 4
    red += picture.data[offset]!
    green += picture.data[offset + 1]!
    blue += picture.data[offset + 2]!
  }
  const count = to - from
  return [red / count, green / count, blue / count]
}

/** The colour of the paper all over the sheet, smooth, as if nothing were printed on it. */
function paperColors(picture: Pixels, gray: Float32Array, block: number): { columns: number; rows: number; planes: Float32Array[] } {
  const { width, height } = picture
  const columns = Math.ceil(width / block)
  const rows = Math.ceil(height / block)
  const planes = [new Float32Array(columns * rows), new Float32Array(columns * rows), new Float32Array(columns * rows)]
  const light = new Float32Array(columns * rows)
  const indices: number[] = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      indices.length = 0
      for (let y = row * block; y < Math.min(height, (row + 1) * block); y++) {
        for (let x = column * block; x < Math.min(width, (column + 1) * block); x++) indices.push(y * width + x)
      }
      const color = blockPaperColor(picture, gray, indices)
      const cell = row * columns + column
      color.forEach((value, channel) => (planes[channel]![cell] = value))
      light[cell] = 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]
    }
  }
  // A block full of ink takes the colour of its lightest neighbour, then it is all smoothed.
  const spread = planes.map(() => new Float32Array(columns * rows))
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let best = row * columns + column
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const r = row + dy
          const c = column + dx
          if (r >= 0 && r < rows && c >= 0 && c < columns && light[r * columns + c]! > light[best]!) best = r * columns + c
        }
      }
      for (let channel = 0; channel < 3; channel++) spread[channel]![row * columns + column] = planes[channel]![best]!
    }
  }
  return { columns, rows, planes: spread.map((plane) => boxBlur(plane, columns, rows, 1)) }
}

/**
 * Cleans a photographed sheet as a scanner would: shadows and the tint of the light go,
 * the paper turns white, and print turns black. In colour, coloured ink such as a blue
 * signature keeps its colour.
 */
export function cleanPaper(picture: Pixels, look: PaperLook): Pixels {
  const { width, height, data } = picture
  const gray = grayOf(picture)
  const block = Math.max(4, Math.round(Math.min(width, height) / LIGHT_BLOCKS))
  const { columns, rows, planes } = paperColors(picture, gray, block)

  // Each colour against the paper's own: white paper is 1, in any light.
  const even = new Float32Array(width * height * 3)
  const evenLight = new Float32Array(width * height)
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
      const index = y * width + x
      for (let channel = 0; channel < 3; channel++) {
        const plane = planes[channel]!
        const paper =
          (plane[r0 * columns + c0]! * (1 - wx) + plane[r0 * columns + c1]! * wx) * (1 - wy) +
          (plane[r1 * columns + c0]! * (1 - wx) + plane[r1 * columns + c1]! * wx) * wy
        even[index * 3 + channel] = data[index * 4 + channel]! / Math.max(paper, 16)
      }
      evenLight[index] = 0.299 * even[index * 3]! + 0.587 * even[index * 3 + 1]! + 0.114 * even[index * 3 + 2]!
    }
  }
  const softLight = boxBlur(evenLight, width, height, 1)

  const tone = (value: number) => Math.min(1, Math.max(0, (value - INK_LEVEL) / (PAPER_LEVEL - INK_LEVEL))) ** INK_DEPTH * 255
  const result = new Uint8ClampedArray(data.length)
  for (let index = 0; index < width * height; index++) {
    const sharpen = SHARPEN * (evenLight[index]! - softLight[index]!)
    let red = even[index * 3]! + sharpen
    let green = even[index * 3 + 1]! + sharpen
    let blue = even[index * 3 + 2]! + sharpen
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
    if (look === 'gray' || chroma < NEUTRAL_CHROMA) {
      const lightness = 0.299 * red + 0.587 * green + 0.114 * blue
      red = lightness
      green = lightness
      blue = lightness
    }
    result[index * 4] = tone(red)
    result[index * 4 + 1] = tone(green)
    result[index * 4 + 2] = tone(blue)
    result[index * 4 + 3] = 255
  }
  return { width, height, data: result }
}
