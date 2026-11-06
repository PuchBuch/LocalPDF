import { describe, expect, it } from 'vitest'
import { displayToPdf, displayedSize, normalizeRotation, rotateRectClockwise } from '../src/core/geometry'
import type { Rotation } from '../src/core/model'

const box = { x: 10, y: 20, width: 100, height: 200 }

describe('displayToPdf', () => {
  // The top-left corner of the screen for each rotation, in PDF user space.
  const topLeftCorners: Record<Rotation, { x: number; y: number }> = {
    0: { x: 10, y: 220 },
    90: { x: 10, y: 20 },
    180: { x: 110, y: 20 },
    270: { x: 110, y: 220 }
  }

  it.each([0, 90, 180, 270] as Rotation[])('maps the top-left corner at %i degrees', (rotation) => {
    expect(displayToPdf(box, rotation, { x: 0, y: 0 })).toEqual(topLeftCorners[rotation])
  })

  it.each([0, 90, 180, 270] as Rotation[])('maps the bottom-right corner to the opposite corner at %i', (rotation) => {
    const size = displayedSize(box, rotation)
    const corner = displayToPdf(box, rotation, { x: size.width, y: size.height })
    const opposite = displayToPdf(box, normalizeRotation(rotation + 180), { x: 0, y: 0 })
    expect(corner).toEqual(opposite)
  })
})

describe('normalizeRotation', () => {
  it('wraps negative and large angles', () => {
    expect(normalizeRotation(-90)).toBe(270)
    expect(normalizeRotation(450)).toBe(90)
  })

  it('rejects angles that are not multiples of 90', () => {
    expect(() => normalizeRotation(45)).toThrow()
  })
})

describe('rotateRectClockwise', () => {
  const page = { width: 595, height: 842 }

  it('keeps the field over the same content', () => {
    // The centre (150, 120) moves to (842 - 120, 150).
    const rotated = rotateRectClockwise({ x: 100, y: 100, width: 100, height: 40 }, page)
    expect(rotated.x).toBeCloseTo(672)
    expect(rotated.y).toBeCloseTo(130)
  })

  it('keeps a field at the edge inside the page', () => {
    const rotated = rotateRectClockwise({ x: 0, y: 0, width: 100, height: 40 }, page)
    expect(rotated.x).toBeCloseTo(742)
    expect(rotated.y).toBeCloseTo(30)
  })

  it('returns to the start after four turns', () => {
    const start = { x: 120, y: 300, width: 80, height: 40 }
    let rect = start
    let size = page
    for (let turn = 0; turn < 4; turn++) {
      rect = rotateRectClockwise(rect, size)
      size = { width: size.height, height: size.width }
    }
    expect(rect.x).toBeCloseTo(start.x)
    expect(rect.y).toBeCloseTo(start.y)
  })

  it('keeps a wide field inside a narrow page', () => {
    const wide = { x: 0, y: 400, width: 700, height: 20 }
    const rotated = rotateRectClockwise(wide, { width: 842, height: 595 })
    expect(rotated.x).toBeGreaterThanOrEqual(0)
    expect(rotated.y).toBeGreaterThanOrEqual(0)
  })
})
