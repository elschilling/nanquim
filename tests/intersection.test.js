import { describe, expect, test } from 'vitest'

import {
  getCircleCircleIntersections,
  getEllipseAngle,
  getLineCircleIntersections,
  getLineEllipseIntersections,
  getLineEquation,
  getLineIntersection,
  getLineRectIntersections,
  getPathIntersections,
  getPathSegments,
  getPolylineSegments,
  isCircleIntersectingRect,
  isLineIntersectingRect,
  isPointOnSegment,
  isPolygonIntersectingRect,
} from '../src/js/utils/intersection.js'

function expectPoint(point, expected, precision = 10) {
  expect(point.x).toBeCloseTo(expected.x, precision)
  expect(point.y).toBeCloseTo(expected.y, precision)
}

function expectPointSet(points, expected, precision = 10) {
  const byCoordinates = (a, b) => a.x - b.x || a.y - b.y
  const actualSorted = [...points].sort(byCoordinates)
  const expectedSorted = [...expected].sort(byCoordinates)

  expect(actualSorted).toHaveLength(expectedSorted.length)
  actualSorted.forEach((point, index) => {
    expectPoint(point, expectedSorted[index], precision)
  })
}

describe('selection-shape intersections', () => {
  const rect = { x: 0, y: 0, width: 10, height: 10 }

  test.each([
    ['inside', { x1: 2, y1: 3, x2: 8, y2: 7 }, true],
    ['crossing', { x1: -5, y1: 5, x2: 15, y2: 5 }, true],
    ['touching an edge', { x1: -5, y1: 0, x2: 5, y2: 0 }, true],
    ['disjoint', { x1: -5, y1: -3, x2: 15, y2: -3 }, false],
  ])('detects a line %s the rectangle', (_label, line, expected) => {
    expect(isLineIntersectingRect(line, rect)).toBe(expected)
  })

  test.each([
    ['inside', { cx: 5, cy: 5, r: 1 }, true],
    ['tangent to a side', { cx: 12, cy: 5, r: 2 }, true],
    ['tangent to a corner', { cx: 12, cy: 12, r: Math.sqrt(8) }, true],
    ['past a corner', { cx: 12, cy: 12, r: 2.8 }, false],
    ['horizontally disjoint', { cx: 20, cy: 5, r: 2 }, false],
    ['vertically disjoint', { cx: 5, cy: 20, r: 2 }, false],
  ])('detects a circle %s', (_label, circle, expected) => {
    expect(isCircleIntersectingRect(circle, rect)).toBe(expected)
  })

  test.each([
    ['with a vertex inside', [{ x: 2, y: 2 }, { x: 14, y: 2 }, { x: 14, y: 14 }], true],
    ['with only an edge crossing', [{ x: -2, y: 5 }, { x: 12, y: 5 }, { x: 5, y: 14 }], true],
    ['enclosing the rectangle', [{ x: -2, y: -2 }, { x: 12, y: -2 }, { x: 12, y: 12 }, { x: -2, y: 12 }], true],
    ['disjoint from the rectangle', [{ x: 20, y: 20 }, { x: 24, y: 20 }, { x: 22, y: 24 }], false],
  ])('detects a polygon %s', (_label, polygon, expected) => {
    expect(isPolygonIntersectingRect(polygon, rect)).toBe(expected)
  })
})

describe('line geometry', () => {
  test('normalizes raw and SVG-like line attributes', () => {
    expect(getLineEquation({ x1: 1, y1: 2, x2: 3, y2: 4 })).toEqual({
      x1: 1,
      y1: 2,
      x2: 3,
      y2: 4,
    })

    const values = { x1: '1.5', y1: '-2', x2: null, y2: null }
    const svgLine = {
      x2: 7,
      attr(name) {
        return values[name]
      },
    }
    expect(getLineEquation(svgLine)).toEqual({ x1: 1.5, y1: -2, x2: 7, y2: 0 })
  })

  test('finds the infinite-line crossing and rejects parallel or coincident lines', () => {
    expectPoint(
      getLineIntersection(
        { x1: 0, y1: 0, x2: 4, y2: 4 },
        { x1: 0, y1: 4, x2: 4, y2: 0 },
      ),
      { x: 2, y: 2 },
    )
    expect(getLineIntersection(
      { x1: 0, y1: 0, x2: 4, y2: 0 },
      { x1: 0, y1: 2, x2: 4, y2: 2 },
    )).toBeNull()
    expect(getLineIntersection(
      { x1: 0, y1: 0, x2: 4, y2: 0 },
      { x1: 2, y1: 0, x2: 6, y2: 0 },
    )).toBeNull()
  })

  test('handles degenerate, disjoint, tangent, and secant line-circle cases', () => {
    const circle = { cx: 0, cy: 0, r: 5 }

    expect(getLineCircleIntersections(
      { x1: 1, y1: 1, x2: 1, y2: 1 },
      circle,
    )).toEqual([])
    expect(getLineCircleIntersections(
      { x1: -10, y1: 6, x2: 10, y2: 6 },
      circle,
    )).toEqual([])
    expectPointSet(
      getLineCircleIntersections({ x1: -10, y1: 5, x2: 10, y2: 5 }, circle),
      [{ x: 0, y: 5 }],
    )
    expectPointSet(
      getLineCircleIntersections({ x1: -10, y1: 0, x2: 10, y2: 0 }, circle),
      [{ x: -5, y: 0 }, { x: 5, y: 0 }],
    )
  })

  test('returns only intersections that land on rectangle edges', () => {
    const rect = { x: 0, y: 0, width: 4, height: 3 }

    expectPointSet(
      getLineRectIntersections({ x1: -2, y1: 1, x2: 6, y2: 1 }, rect),
      [{ x: 0, y: 1 }, { x: 4, y: 1 }],
    )
    expect(getLineRectIntersections(
      { x1: -2, y1: 5, x2: 6, y2: 5 },
      rect,
    )).toEqual([])
  })

  test('uses a tolerant bounding check for finite segment membership', () => {
    const segment = { x1: 0, y1: 0, x2: 4, y2: 4 }

    expect(isPointOnSegment({ x: 0, y: 0 }, segment)).toBe(true)
    expect(isPointOnSegment({ x: 4.0005, y: 4.0005 }, segment)).toBe(true)
    expect(isPointOnSegment({ x: 4.002, y: 4 }, segment)).toBe(false)
  })
})

describe('circle and ellipse geometry', () => {
  test('handles disjoint, contained, coincident, tangent, and crossing circles', () => {
    const circle = { cx: 0, cy: 0, r: 5 }

    expect(getCircleCircleIntersections(circle, { cx: 12, cy: 0, r: 5 })).toEqual([])
    expect(getCircleCircleIntersections(circle, { cx: 1, cy: 0, r: 2 })).toEqual([])
    expect(getCircleCircleIntersections(circle, { ...circle })).toEqual([])
    expectPointSet(
      getCircleCircleIntersections(circle, { cx: 10, cy: 0, r: 5 }),
      [{ x: 5, y: 0 }],
    )
    expectPointSet(
      getCircleCircleIntersections(circle, { cx: 3, cy: 0, r: 2 }),
      [{ x: 5, y: 0 }],
    )
    expectPointSet(
      getCircleCircleIntersections(circle, { cx: 6, cy: 0, r: 5 }),
      [{ x: 3, y: -4 }, { x: 3, y: 4 }],
    )
  })

  test('handles degenerate, disjoint, tangent, and secant line-ellipse cases', () => {
    const ellipse = { cx: 0, cy: 0, rx: 5, ry: 3 }

    expect(getLineEllipseIntersections(
      { x1: 1, y1: 1, x2: 1, y2: 1 },
      ellipse,
    )).toEqual([])
    expect(getLineEllipseIntersections(
      { x1: -10, y1: 4, x2: 10, y2: 4 },
      ellipse,
    )).toEqual([])
    expectPointSet(
      getLineEllipseIntersections({ x1: -10, y1: 3, x2: 10, y2: 3 }, ellipse),
      [{ x: 0, y: 3 }],
    )
    expectPointSet(
      getLineEllipseIntersections({ x1: -10, y1: 0, x2: 10, y2: 0 }, ellipse),
      [{ x: -5, y: 0 }, { x: 5, y: 0 }],
    )
  })

  test.each([
    [{ x: 5, y: 0 }, 0],
    [{ x: 0, y: 3 }, Math.PI / 2],
    [{ x: -5, y: 0 }, Math.PI],
    [{ x: 0, y: -3 }, 3 * Math.PI / 2],
  ])('normalizes ellipse angle %# into [0, 2π)', (point, expected) => {
    expect(getEllipseAngle(point, { cx: 0, cy: 0, rx: 5, ry: 3 })).toBeCloseTo(expected)
  })
})

describe('path and polyline helpers', () => {
  test('samples raw lines with normalized segment parameters', () => {
    const segments = getPathSegments({ x1: 0, y1: 0, x2: 8, y2: 4 }, 4)

    expect(segments).toHaveLength(4)
    expect(segments[0]).toEqual({ x1: 0, y1: 0, x2: 2, y2: 1, t1: 0, t2: 0.25 })
    expect(segments[3]).toEqual({ x1: 6, y1: 3, x2: 8, y2: 4, t1: 0.75, t2: 1 })
    expect(getPathSegments({ x1: 1, y1: 1, x2: 1, y2: 1 }, 4)).toEqual([])
    expect(getPathSegments({}, 4)).toEqual([])
  })

  test('samples SVG-like paths through their length and pointAt API', () => {
    const path = {
      length: () => 10,
      pointAt: (distance) => ({ x: distance, y: distance * 2 }),
    }

    expect(getPathSegments(path, 2)).toEqual([
      { x1: 0, y1: 0, x2: 5, y2: 10, t1: 0, t2: 0.5 },
      { x1: 5, y1: 10, x2: 10, y2: 20, t1: 0.5, t2: 1 },
    ])
  })

  test('extracts open polyline segments and closes polygons', () => {
    const points = [[0, 0], [4, 0], [4, 3]]
    const polyline = getPolylineSegments({ type: 'polyline', array: () => points })
    const polygon = getPolylineSegments({ type: 'polygon', array: () => points })

    expect(polyline).toEqual([
      { x1: 0, y1: 0, x2: 4, y2: 0 },
      { x1: 4, y1: 0, x2: 4, y2: 3 },
    ])
    expect(polygon).toEqual([
      ...polyline,
      { x1: 4, y1: 3, x2: 0, y2: 0 },
    ])
  })

  test('intersects a sampled path with finite raw-line and circle boundaries', () => {
    const path = { x1: -10, y1: 0, x2: 10, y2: 0 }

    const lineHits = getPathIntersections(path, {
      x1: 0.05,
      y1: -1,
      x2: 0.05,
      y2: 1,
    })
    expect(lineHits).toHaveLength(1)
    expectPoint(lineHits[0], { x: 0.05, y: 0 })
    expect(lineHits[0].t).toBeCloseTo(0.5025)

    const circleHits = getPathIntersections(path, {
      type: 'circle',
      cx: () => 0,
      cy: () => 0,
      radius: () => 4.95,
    })
    expectPointSet(circleHits, [{ x: -4.95, y: 0 }, { x: 4.95, y: 0 }])
  })

  test('rejects unsupported and finite non-intersecting path boundaries', () => {
    const path = { x1: -10, y1: 0, x2: 10, y2: 0 }

    expect(getPathIntersections(path, { type: 'image' })).toEqual([])
    expect(getPathIntersections(path, {
      x1: 0.05,
      y1: 2,
      x2: 0.05,
      y2: 4,
    })).toEqual([])
  })
})
