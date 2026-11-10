import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import type { Point } from '../src/core/geometry'
import {
  findPaperCorners,
  rectangleToQuad,
  SCAN_LONG_SIDE,
  straighten,
  straightenedSize,
  cleanPaper,
  type Pixels,
  type Quad
} from '../src/core/scan'

/** A photo of a table top: dark, uneven wood with some grain. */
function photo(width: number, height: number, draw: (context: SKRSContext2D) => void): Pixels {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  const wood = context.createLinearGradient(0, 0, width, height)
  wood.addColorStop(0, '#5b4632')
  wood.addColorStop(1, '#3e2f22')
  context.fillStyle = wood
  context.fillRect(0, 0, width, height)
  context.strokeStyle = 'rgba(30, 20, 10, 0.4)'
  for (let y = 7; y < height; y += 13) {
    context.beginPath()
    context.moveTo(0, y)
    context.bezierCurveTo(width / 3, y + 6, (2 * width) / 3, y - 6, width, y + 3)
    context.stroke()
  }
  draw(context)
  const { data } = context.getImageData(0, 0, width, height)
  return { width, height, data: new Uint8ClampedArray(data) }
}

function fillQuad(context: SKRSContext2D, quad: Quad, style: string | CanvasGradient): void {
  context.beginPath()
  context.moveTo(quad[0].x, quad[0].y)
  for (const corner of quad.slice(1)) context.lineTo(corner.x, corner.y)
  context.closePath()
  context.fillStyle = style as string
  context.fill()
}

const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

function expectCornersNear(found: Quad | null, expected: Quad, tolerance: number): void {
  expect(found).not.toBeNull()
  found!.forEach((corner, index) => expect(gap(corner, expected[index]!)).toBeLessThan(tolerance))
}

function grayAt(picture: Pixels, x: number, y: number): number {
  const offset = (Math.round(y) * picture.width + Math.round(x)) * 4
  return (picture.data[offset]! + picture.data[offset + 1]! + picture.data[offset + 2]!) / 3
}

describe('finding the sheet in a photo', () => {
  it('finds the corners of a sheet seen at an angle, with a shadow across it', () => {
    const sheet: Quad = [
      { x: 230, y: 70 },
      { x: 590, y: 110 },
      { x: 640, y: 560 },
      { x: 170, y: 540 }
    ]
    const picture = photo(800, 640, (context) => {
      const shade = context.createLinearGradient(170, 0, 640, 0)
      shade.addColorStop(0, '#9c9a94')
      shade.addColorStop(1, '#f2f0ea')
      fillQuad(context, sheet, shade)
      context.fillStyle = '#202020'
      context.font = '22px sans-serif'
      context.fillText('Date: 9 November 2026', 260, 470)
    })
    expectCornersNear(findPaperCorners(picture), sheet, 8)
  })

  it('finds a sheet turned on the table', () => {
    const turn = (14 * Math.PI) / 180
    const centre = { x: 400, y: 320 }
    const corners = [
      [-150, -212],
      [150, -212],
      [150, 212],
      [-150, 212]
    ].map(([x, y]) => ({
      x: centre.x + x! * Math.cos(turn) - y! * Math.sin(turn),
      y: centre.y + x! * Math.sin(turn) + y! * Math.cos(turn)
    })) as Quad
    const picture = photo(800, 640, (context) => fillQuad(context, corners, '#eceae4'))
    expectCornersNear(findPaperCorners(picture), corners, 8)
  })

  it('leaves alone a scan, where the paper fills the picture', () => {
    const picture = photo(600, 848, (context) => {
      context.fillStyle = '#fbfbfb'
      context.fillRect(0, 0, 600, 848)
      context.fillStyle = '#111'
      context.font = '20px sans-serif'
      context.fillText('Signature', 60, 700)
    })
    expect(findPaperCorners(picture)).toBeNull()
  })

  it('finds nothing where there is no sheet', () => {
    expect(findPaperCorners(photo(400, 300, () => undefined))).toBeNull()
  })
})

describe('straightening the sheet', () => {
  it('takes a sheet close to A4 as A4, at 200 dots per inch, never larger', () => {
    const size = straightenedSize([
      { x: 0, y: 0 },
      { x: 2000, y: 40 },
      { x: 2050, y: 2900 },
      { x: 20, y: 2850 }
    ])
    expect(size.height).toBe(SCAN_LONG_SIDE)
    expect(size.height / size.width).toBeCloseTo(Math.SQRT2, 2)

    const small = straightenedSize([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 424 },
      { x: 0, y: 424 }
    ])
    expect(small.height).toBeLessThan(430)
  })

  it('keeps a sheet of another shape as it is', () => {
    const size = straightenedSize([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 500 },
      { x: 0, y: 500 }
    ])
    expect(size).toEqual({ width: 1000, height: 500 })
  })

  it('maps the corners of the rectangle onto the corners of the sheet', () => {
    const quad: Quad = [
      { x: 30, y: 20 },
      { x: 410, y: 50 },
      { x: 450, y: 600 },
      { x: 10, y: 570 }
    ]
    const map = rectangleToQuad({ width: 420, height: 594 }, quad)
    expect(gap(map(0, 0), quad[0])).toBeLessThan(1e-6)
    expect(gap(map(420, 0), quad[1])).toBeLessThan(1e-6)
    expect(gap(map(420, 594), quad[2])).toBeLessThan(1e-6)
    expect(gap(map(0, 594), quad[3])).toBeLessThan(1e-6)
  })

  it('puts what was written on the sheet in the same place on the straight page', () => {
    // A sheet of 420 × 594 with a black square at (100, 120), turned by 12 degrees.
    const turn = (12 * Math.PI) / 180
    const picture = photo(900, 900, (context) => {
      context.save()
      context.translate(450, 450)
      context.rotate(turn)
      context.translate(-210, -297)
      context.fillStyle = '#efede7'
      context.fillRect(0, 0, 420, 594)
      context.fillStyle = '#000'
      context.fillRect(100, 120, 40, 40)
      context.restore()
    })
    const quad = findPaperCorners(picture)!
    expect(quad).not.toBeNull()
    const size = straightenedSize(quad)
    expect(size.height / size.width).toBeCloseTo(Math.SQRT2, 2)
    const page = straighten(picture, quad, size)
    const scale = size.width / 420
    expect(grayAt(page, 120 * scale, 140 * scale)).toBeLessThan(60)
    expect(grayAt(page, 60 * scale, 140 * scale)).toBeGreaterThan(200)
    expect(grayAt(page, 120 * scale, 220 * scale)).toBeGreaterThan(200)
    // No table top is left at the edges.
    expect(grayAt(page, 3, 3)).toBeGreaterThan(180)
    expect(grayAt(page, size.width - 4, size.height - 4)).toBeGreaterThan(180)
  })
})


/** Paper under warm lamp light with a shadow: black print, a thin grey line and a blue signature. */
function warmPhotoOfPage(): Pixels {
  const canvas = createCanvas(600, 800)
  const context = canvas.getContext('2d')
  const shade = context.createLinearGradient(0, 0, 600, 800)
  shade.addColorStop(0, '#8a7a62')
  shade.addColorStop(1, '#f0e2c8')
  context.fillStyle = shade
  context.fillRect(0, 0, 600, 800)
  // Black print, as the warm light shows it: brownish.
  context.fillStyle = '#3b3024'
  context.fillRect(60, 100, 300, 6)
  context.fillRect(300, 650, 240, 6)
  // Thin print that came out pale.
  context.fillStyle = '#9a8c76'
  context.fillRect(60, 400, 300, 2)
  context.strokeStyle = '#2a3f9a'
  context.lineWidth = 5
  context.beginPath()
  context.moveTo(40, 200)
  context.bezierCurveTo(90, 140, 140, 260, 200, 190)
  context.stroke()
  const { data } = context.getImageData(0, 0, 600, 800)
  return { width: 600, height: 800, data: new Uint8ClampedArray(data) }
}

function colorAt(picture: Pixels, x: number, y: number): [number, number, number] {
  const offset = (Math.round(y) * picture.width + Math.round(x)) * 4
  return [picture.data[offset]!, picture.data[offset + 1]!, picture.data[offset + 2]!]
}

/** The darkest pixel of a small area, as a stroke there is at most this light. */
function darkestIn(picture: Pixels, x: number, y: number, size = 4): [number, number, number] {
  let darkest: [number, number, number] = [255, 255, 255]
  for (let dy = -size; dy <= size; dy++) {
    for (let dx = -size; dx <= size; dx++) {
      const color = colorAt(picture, x + dx, y + dy)
      if (color[0] + color[1] + color[2] < darkest[0] + darkest[1] + darkest[2]) darkest = color
    }
  }
  return darkest
}

describe('cleaning the page', () => {
  it('turns shaded, tinted paper white and print black, without a brown tint', () => {
    const page = cleanPaper(warmPhotoOfPage(), 'color')
    for (const [x, y] of [[30, 30], [560, 760], [300, 500]] as const) {
      expect(Math.min(...colorAt(page, x, y))).toBeGreaterThan(240)
    }
    for (const [x, y] of [[200, 103], [400, 653]] as const) {
      const [red, green, blue] = darkestIn(page, x, y)
      expect(Math.max(red, green, blue)).toBeLessThan(60)
      expect(Math.max(red, green, blue) - Math.min(red, green, blue)).toBeLessThan(12)
    }
    // Thin, pale print is made darker than it was against its paper.
    expect(Math.max(...darkestIn(page, 200, 401, 2))).toBeLessThan(190)
  })

  it('keeps a blue signature blue in colour', () => {
    const [red, green, blue] = darkestIn(cleanPaper(warmPhotoOfPage(), 'color'), 120, 205, 6)
    expect(blue).toBeGreaterThan(red + 40)
    expect(blue).toBeGreaterThan(green + 30)
  })

  it('makes everything grey in black and white', () => {
    const page = cleanPaper(warmPhotoOfPage(), 'gray')
    for (let offset = 0; offset < page.data.length; offset += 4 * 97) {
      expect(page.data[offset]).toBe(page.data[offset + 1])
      expect(page.data[offset + 1]).toBe(page.data[offset + 2])
    }
    expect(Math.max(...darkestIn(page, 120, 205, 6))).toBeLessThan(110)
  })
})

describe('finding the sheet on a light table', () => {
  it('finds the edges of white paper on a beige table, and takes a cut-off side from the photo', () => {
    // The sheet runs off the top of the photo: its top side is the photo's edge.
    const sheet: Quad = [
      { x: 140, y: -40 },
      { x: 620, y: -10 },
      { x: 600, y: 590 },
      { x: 110, y: 570 }
    ]
    const picture = photo(800, 640, (context) => {
      context.fillStyle = '#d8d0bf'
      context.fillRect(0, 0, 800, 640)
      fillQuad(context, sheet, '#f6f6f3')
      context.fillStyle = '#222'
      context.font = '18px sans-serif'
      for (let line = 0; line < 8; line++) context.fillText('Ich bestätige, dass die Angaben richtig sind.', 170, 80 + line * 34)
      context.strokeStyle = '#333'
      context.strokeRect(180, 380, 300, 60)
    })
    const found = findPaperCorners(picture)
    expect(found).not.toBeNull()
    const [topLeft, topRight, bottomRight, bottomLeft] = found!
    expect(topLeft.y).toBeLessThan(6)
    expect(topRight.y).toBeLessThan(6)
    expect(gap(bottomRight, sheet[2])).toBeLessThan(10)
    expect(gap(bottomLeft, sheet[3])).toBeLessThan(10)
    // The left and right sides lean as the sheet does, and meet the top of the photo.
    expect(Math.abs(topLeft.x - 137)).toBeLessThan(10)
    expect(Math.abs(topRight.x - 617)).toBeLessThan(10)
  })
})