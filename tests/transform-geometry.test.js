import { describe, expect, test, vi } from 'vitest'

import {
  applyMatrixToElement,
  applyMatrixToPoint,
  bakeTransforms,
} from '../src/js/utils/transformGeometry.js'

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

function dataStore(initial = {}) {
  const values = new Map(Object.entries(initial))
  const data = vi.fn((key, value) => {
    if (value === undefined) return values.get(key)
    values.set(key, value)
    return value
  })
  return { data, values }
}

describe('transformGeometry', () => {
  test('applies every component of an affine matrix to a point', () => {
    const matrix = { a: 0, b: 2, c: -3, d: 0, e: 5, f: -4 }

    expect(applyMatrixToPoint(matrix, 2, -1)).toEqual({ x: 8, y: 0 })
  })

  test('bakes line and polyline coordinates', () => {
    const matrix = { a: 2, b: 0, c: 0, d: 3, e: 5, f: -1 }
    const lineAttributes = { x1: 1, y1: 2, x2: 3, y2: 4 }
    const line = {
      type: 'line',
      attr: vi.fn((name) => lineAttributes[name]),
      plot: vi.fn(),
      data: vi.fn(),
    }
    const polyline = {
      type: 'polyline',
      array: vi.fn(() => [[0, 0], [1, 2]]),
      plot: vi.fn(),
      data: vi.fn(),
    }

    expect(applyMatrixToElement(line, matrix)).toBe(line)
    expect(line.plot).toHaveBeenCalledWith(7, 5, 11, 11)

    expect(applyMatrixToElement(polyline, matrix)).toBe(polyline)
    expect(polyline.plot).toHaveBeenCalledWith([[5, -1], [7, 5]])
  })

  test('moves and scales circles and ellipses using the matrix axes', () => {
    const matrix = { a: 0, b: 2, c: -3, d: 0, e: 10, f: 20 }
    let circleRadius = 4
    const circle = {
      type: 'circle',
      cx: vi.fn(() => 1),
      cy: vi.fn(() => 2),
      center: vi.fn(),
      radius: vi.fn((value) => {
        if (value === undefined) return circleRadius
        circleRadius = value
      }),
      data: vi.fn(),
    }
    const ellipse = {
      type: 'ellipse',
      cx: vi.fn(() => 1),
      cy: vi.fn(() => 2),
      rx: vi.fn(() => 4),
      ry: vi.fn(() => 5),
      center: vi.fn(),
      radius: vi.fn(),
      data: vi.fn(),
    }

    applyMatrixToElement(circle, matrix)
    expect(circle.center).toHaveBeenCalledWith(4, 22)
    expect(circle.radius).toHaveBeenLastCalledWith(8)

    applyMatrixToElement(ellipse, matrix)
    expect(ellipse.center).toHaveBeenCalledWith(4, 22)
    expect(ellipse.radius).toHaveBeenCalledWith(8, 15)
  })

  test('turns a transformed rectangle into a polygon and preserves its attributes', () => {
    const polygon = { attr: vi.fn() }
    const parent = { polygon: vi.fn(() => polygon) }
    const attributes = { id: 'rect-1', fill: '#123456' }
    const rect = {
      type: 'rect',
      x: vi.fn(() => 1),
      y: vi.fn(() => 2),
      width: vi.fn(() => 3),
      height: vi.fn(() => 4),
      parent: vi.fn(() => parent),
      attr: vi.fn(() => attributes),
      remove: vi.fn(),
    }
    const matrix = { a: 1, b: 0, c: 1, d: 1, e: 10, f: 20 }

    expect(applyMatrixToElement(rect, matrix)).toBe(polygon)
    expect(parent.polygon).toHaveBeenCalledWith([
      [13, 22],
      [16, 22],
      [20, 26],
      [17, 26],
    ])
    expect(polygon.attr).toHaveBeenCalledWith(attributes)
    expect(rect.remove).toHaveBeenCalledOnce()
  })

  test('transforms path control points and reverses arc sweep on reflection', () => {
    const pathArray = [
      ['M', 1, 2],
      ['L', 3, 4],
      ['T', 5, 6],
      ['C', 1, 2, 3, 4, 5, 6],
      ['S', 1, 2, 3, 4],
      ['Q', 2, 3, 4, 5],
      ['A', 2, 3, 10, 0, 1, 4, 5],
      ['Z'],
    ]
    const path = {
      type: 'path',
      array: vi.fn(() => pathArray),
      plot: vi.fn(),
      data: vi.fn(),
    }
    const reflection = { a: -2, b: 0, c: 0, d: 3, e: 10, f: -5 }

    applyMatrixToElement(path, reflection)

    expect(path.plot).toHaveBeenCalledWith([
      ['M', 8, 1],
      ['L', 4, 7],
      ['T', 0, 13],
      ['C', 8, 1, 4, 7, 0, 13],
      ['S', 8, 1, 4, 7],
      ['Q', 6, 4, 2, 10],
      ['A', 4, 9, 190, 0, 0, 2, 10],
      ['Z'],
    ])
  })

  test('expands horizontal and vertical path commands into line commands', () => {
    const path = {
      type: 'path',
      array: vi.fn(() => [['M', 1, 2], ['H', 5], ['V', 6]]),
      plot: vi.fn(),
      data: vi.fn(),
    }

    applyMatrixToElement(path, identity)

    expect(path.plot).toHaveBeenCalledWith([
      ['M', 1, 2],
      ['L', 5, 2],
      ['L', 5, 6],
    ])
  })

  test('updates arc and trimmed-circle metadata with the baked coordinates', () => {
    const { data, values } = dataStore({
      arcData: {
        p1: { x: 0, y: 0 },
        p2: { x: 1, y: 1 },
        p3: { x: 2, y: 0 },
      },
      circleTrimData: {
        cx: 1,
        cy: 2,
        startPt: { x: 2, y: 2 },
        endPt: { x: 1, y: 3 },
        ccw: true,
      },
    })
    const element = { type: 'custom', data }
    const matrix = { a: 2, b: 0, c: 0, d: 3, e: 5, f: -1 }

    applyMatrixToElement(element, matrix)

    expect(values.get('arcData')).toEqual({
      p1: { x: 5, y: -1 },
      p2: { x: 7, y: 2 },
      p3: { x: 9, y: -1 },
    })
    expect(values.get('circleTrimData')).toEqual({
      cx: 7,
      cy: 5,
      startPt: { x: 9, y: 5 },
      endPt: { x: 7, y: 8 },
      ccw: true,
    })
  })

  test('composes nested matrices and clears baked transforms from groups and leaves', () => {
    const lineAttributes = { x1: 0, y1: 0, x2: 1, y2: 1 }
    const leaf = {
      type: 'line',
      matrix: vi.fn(() => ({ ...identity, e: 3, f: 4 })),
      attr: vi.fn((name) => lineAttributes[name]),
      plot: vi.fn(),
      data: vi.fn(),
      transform: vi.fn(),
      node: { removeAttribute: vi.fn() },
    }
    const group = {
      type: 'g',
      matrix: vi.fn(() => ({ a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 })),
      children: vi.fn(() => [leaf]),
      transform: vi.fn(),
      node: { removeAttribute: vi.fn() },
    }

    expect(bakeTransforms(group)).toBe(group)
    expect(leaf.plot).toHaveBeenCalledWith(16, 28, 18, 30)
    expect(leaf.transform).toHaveBeenCalledWith(identity)
    expect(leaf.node.removeAttribute).toHaveBeenCalledWith('transform')
    expect(group.transform).toHaveBeenCalledWith(identity)
    expect(group.node.removeAttribute).toHaveBeenCalledWith('transform')
  })

  test.each(['text', 'image'])('keeps the accumulated matrix on %s elements', (type) => {
    const matrix = { a: 2, b: 0, c: 0, d: 2, e: 3, f: 4 }
    const element = {
      type,
      matrix: vi.fn(() => matrix),
      transform: vi.fn(),
      node: { removeAttribute: vi.fn() },
    }

    expect(bakeTransforms(element)).toBe(element)
    expect(element.transform).toHaveBeenCalledWith(matrix)
    expect(element.node.removeAttribute).not.toHaveBeenCalled()
  })
})
