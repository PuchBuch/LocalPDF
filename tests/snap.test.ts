import { describe, expect, it } from 'vitest'
import { clearFieldValue, newCheckboxField, newCombField, newSignatureField, newTextField } from '../src/core/fields'
import { snapToNeighbours } from '../src/core/snap'

const PAGE = { width: 595, height: 842 }
const NEIGHBOUR = { x: 100, y: 200, width: 120, height: 40 }
const box = (x: number, y: number) => ({ x, y, width: 50, height: 20 })

describe('snapToNeighbours', () => {
  it('lines up left edges within the tolerance', () => {
    const snapped = snapToNeighbours(box(103, 500), [NEIGHBOUR], PAGE, 5)
    expect(snapped.x).toBe(100)
    expect(snapped.y).toBe(500)
    expect(snapped.guides).toEqual({ x: [100], y: [] })
  })

  it('lines up right edges and middles', () => {
    expect(snapToNeighbours(box(167, 500), [NEIGHBOUR], PAGE, 5).x).toBe(170)
    expect(snapToNeighbours(box(132, 500), [NEIGHBOUR], PAGE, 5).x).toBe(135)
  })

  it('lines up along both axes at once', () => {
    const snapped = snapToNeighbours(box(98, 203), [NEIGHBOUR], PAGE, 5)
    expect(snapped).toMatchObject({ x: 100, y: 200 })
    expect(snapped.guides.x).toContain(100)
    expect(snapped.guides.y).toContain(200)
  })

  it('leaves a box alone when nothing is near', () => {
    const snapped = snapToNeighbours(box(300, 500), [NEIGHBOUR], PAGE, 5)
    expect(snapped).toEqual({ x: 300, y: 500, guides: { x: [], y: [] } })
  })

  it('does not jump at just beyond the tolerance', () => {
    expect(snapToNeighbours(box(94, 500), [NEIGHBOUR], PAGE, 5).x).toBe(94)
  })

  it('picks the nearest line of several neighbours', () => {
    const other = { x: 104, y: 600, width: 10, height: 10 }
    expect(snapToNeighbours(box(103, 500), [NEIGHBOUR, other], PAGE, 5).x).toBe(104)
  })

  it('works with no neighbours, and keeps the box on the page', () => {
    expect(snapToNeighbours(box(-30, 900), [], PAGE, 5)).toEqual({ x: 0, y: 822, guides: { x: [], y: [] } })
  })

  it('stays on the page even when a neighbour line would take it off', () => {
    const atEdge = { x: 590, y: 200, width: 5, height: 5 }
    const snapped = snapToNeighbours({ x: 543, y: 500, width: 50, height: 20 }, [atEdge], PAGE, 5)
    expect(snapped.x + 50).toBeLessThanOrEqual(595)
  })

  it('shows no line it did not end up on', () => {
    const atEdge = { x: 597, y: 200, width: 5, height: 5 }
    const snapped = snapToNeighbours({ x: 544, y: 500, width: 50, height: 20 }, [atEdge], PAGE, 5)
    expect(snapped.x).toBe(545)
    expect(snapped.guides.x).toEqual([])
  })

  it('marks every neighbour line it touches, once', () => {
    const twin = { ...NEIGHBOUR, y: 700 }
    expect(snapToNeighbours(box(102, 500), [NEIGHBOUR, twin], PAGE, 5).guides.x).toEqual([100])
  })
})

describe('clearFieldValue', () => {
  it('empties every kind of field and keeps where it is', () => {
    const place = { x: 10, y: 20, background: 'white' as const }
    expect(clearFieldValue({ ...newTextField('t'), ...place, value: 'abc' })).toMatchObject({ ...place, value: '' })
    expect(clearFieldValue({ ...newCombField('c'), ...place, value: '123' })).toMatchObject({ ...place, value: '' })
    expect(clearFieldValue({ ...newCheckboxField('b'), ...place })).toMatchObject({ ...place, value: null })
    expect(clearFieldValue({ ...newSignatureField('s'), ...place, assetId: 'a' })).toMatchObject({ ...place, assetId: null })
  })
})
