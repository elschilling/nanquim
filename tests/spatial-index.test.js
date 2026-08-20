import { describe, expect, test, vi } from 'vitest'

import { SpatialIndex, getElementBBox } from '../src/js/SpatialIndex.js'

function matrix(values, inverse) {
  return {
    a: values[0],
    b: values[1],
    c: values[2],
    d: values[3],
    e: values[4],
    f: values[5],
    inverse: inverse ? () => matrix(inverse) : undefined,
  }
}

function elementWithBBox(bbox, ctm = null) {
  return {
    node: { getBBox: vi.fn(() => bbox) },
    screenCTM: vi.fn(() => ctm),
  }
}

describe('SpatialIndex bounding boxes', () => {
  test('transforms every local corner into SVG root coordinates', () => {
    const element = elementWithBBox(
      { x: 0, y: 0, width: 2, height: 4 },
      matrix([0, 2, -3, 0, 10, 20]),
    )
    const svg = {
      screenCTM: () => matrix(
        [2, 0, 0, 2, 10, 20],
        [0.5, 0, 0, 0.5, -5, -10],
      ),
    }

    expect(getElementBBox(element, svg)).toEqual({
      minX: -6,
      minY: 0,
      maxX: 0,
      maxY: 2,
      element,
    })
  })

  test('uses the local box when transform information is unavailable', () => {
    const element = elementWithBBox({ x: -4, y: 3, width: 10, height: 7 })
    const svg = { screenCTM: () => null }

    expect(getElementBBox(element, svg)).toMatchObject({
      minX: -4,
      minY: 3,
      maxX: 6,
      maxY: 10,
    })
  })

  test('skips empty or unreadable elements', () => {
    const empty = elementWithBBox({ x: 0, y: 0, width: 0, height: 0 })
    const detached = {
      node: { getBBox: () => { throw new Error('not rendered') } },
    }

    expect(getElementBBox(empty, {})).toBeNull()
    expect(getElementBBox(detached, {})).toBeNull()
  })
})

describe('SpatialIndex lifecycle', () => {
  test('rebuilds lazily, searches overlaps, and stays cached until marked dirty', () => {
    const first = elementWithBBox({ x: 0, y: 0, width: 10, height: 10 })
    const second = elementWithBBox({ x: 30, y: 30, width: 5, height: 5 })
    const getElements = vi.fn(() => [first, second])
    const editor = {
      mode: 'model',
      svg: { node: { id: 'model-svg' }, screenCTM: () => null },
    }
    const index = new SpatialIndex()

    index.ensureFresh(editor, getElements)

    expect(getElements).toHaveBeenCalledTimes(1)
    expect(index.search({ minX: 8, minY: 8, maxX: 12, maxY: 12 }))
      .toEqual([expect.objectContaining({ element: first })])
    expect(index.search({ minX: 15, minY: 15, maxX: 20, maxY: 20 })).toEqual([])

    index.ensureFresh(editor, getElements)
    expect(getElements).toHaveBeenCalledTimes(1)

    index.markDirty()
    index.ensureFresh(editor, getElements)
    expect(getElements).toHaveBeenCalledTimes(2)
  })

  test('indexes the active paper SVG and tolerates a missing canvas', () => {
    const paperSvg = { node: { id: 'paper-svg' }, screenCTM: () => null }
    const element = elementWithBBox({ x: 1, y: 2, width: 3, height: 4 })
    const index = new SpatialIndex()

    index.rebuild({ mode: 'paper', paperSvg }, () => [element])
    expect(index._svgNode).toBe(paperSvg.node)
    expect(index._dirty).toBe(false)

    index.markDirty()
    expect(() => index.rebuild({ mode: 'model', svg: null }, () => [element])).not.toThrow()
    expect(index.search({ minX: -10, minY: -10, maxX: 10, maxY: 10 })).toEqual([])
    expect(index._dirty).toBe(true)
  })
})
