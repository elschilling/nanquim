// @vitest-environment jsdom

import { Matrix, Point, SVG, registerWindow } from '@svgdotjs/svg.js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import DxfHelper from '../src/js/libs/dxf/src/Helper.js'
import { checkSnap } from '../src/js/utils/snapSystem.js'

const IDENTITY = new Matrix()
const OPEN_VERTICES = [[100, 100], [300, 100], [300, 300]]
const CLOSED_VERTICES = [[100, 100], [400, 100], [400, 200], [100, 200]]

function dxfSource(type, vertices, { closed = false, bulge = 0 } = {}) {
  const coordinates = vertices.map(([x, y], index) => [10, x, 20, y,
    ...(index === 0 && bulge ? [42, bulge] : [])])
  const entity = type === 'LWPOLYLINE'
    ? [0, type, 8, 'Snap regression', 90, vertices.length, 70, closed ? 1 : 0, ...coordinates.flat()]
    : [0, type, 8, 'Snap regression', 70, closed ? 1 : 0,
      ...coordinates.flatMap(vertex => [0, 'VERTEX', ...vertex]), 0, 'SEQEND']
  return [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4,
    0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES', ...entity,
    0, 'ENDSEC', 0, 'EOF'].join('\n')
}

// jsdom does not implement SVG path metrics. These authored line/semicircle
// fixtures give the old generic-path branch the values a browser would return.
function mockPathMetrics(node, vertices, { closed = false, bulge = 0 } = {}) {
  const points = closed ? [...vertices, vertices[0]] : vertices
  const lengths = points.slice(1).map((point, index) => (
    index === 0 && bulge === 1
      ? Math.PI * 100
      : Math.hypot(point[0] - points[index][0], point[1] - points[index][1])
  ))
  const totalLength = lengths.reduce((sum, length) => sum + length, 0)
  node.getTotalLength = vi.fn(() => totalLength)
  node.getPointAtLength = vi.fn(length => {
    let remaining = Math.max(0, Math.min(totalLength, length))
    for (let index = 0; index < lengths.length; index += 1) {
      if (remaining <= lengths[index] || index === lengths.length - 1) {
        if (index === 0 && bulge === 1) {
          const angle = Math.PI + remaining / 100
          return { x: 200 + Math.cos(angle) * 100, y: 100 + Math.sin(angle) * 100 }
        }
        const ratio = lengths[index] ? remaining / lengths[index] : 0
        return {
          x: points[index][0] + (points[index + 1][0] - points[index][0]) * ratio,
          y: points[index][1] + (points[index + 1][1] - points[index][1]) * ratio,
        }
      }
      remaining -= lengths[index]
    }
    return { x: points[0][0], y: points[0][1] }
  })
}

function importFixture(type, vertices, options = {}) {
  const helper = new DxfHelper(dxfSource(type, vertices, options))
  expect(helper.parsed.entities[0]).toMatchObject({ type, closed: options.closed === true })
  const root = new DOMParser().parseFromString(helper.toSVG(), 'image/svg+xml').documentElement
  expect(root.querySelector('parsererror')).toBeNull()
  const path = SVG(root.querySelector('path'))
  const collection = SVG(path.node.closest('[data-collection="true"]'))
  const matrix = collection.matrixify()
  // Imported millimetres become centimetres and DXF's Y-up becomes SVG Y-down.
  expect(matrix.a).toBe(0.1)
  expect(matrix.d).toBe(-0.1)
  path.screenCTM = vi.fn(() => matrix)
  mockPathMetrics(path.node, vertices, options)
  const index = {
    ensureFresh: vi.fn(),
    search: vi.fn(() => [{ element: path }]),
  }
  const activeSvg = {
    node: { clientWidth: 100 },
    point: (x, y) => ({ x, y }),
    screenCTM: () => IDENTITY,
    viewbox: () => ({ x: 0, y: -100, width: 100, height: 100 }),
  }
  const editor = {
    editingVertices: [],
    fullSpatialIndex: index,
    isDrawing: false,
    isEditingVertex: false,
    snapExcludeNonSelectable: true,
    snapTypes: {},
    spatialIndex: index,
  }
  return { activeSvg, editor, path }
}

function snap(fixture, point, snapType) {
  fixture.editor.snapTypes = { [snapType]: true }
  return checkSnap(point, fixture.editor, fixture.activeSvg, 0.01)
}

function expectSnap(fixture, point, snapType) {
  const result = snap(fixture, point, snapType)
  expect(result?.snapType).toBe(snapType)
  expect(result.worldPoint.x).toBeCloseTo(point.x, 8)
  expect(result.worldPoint.y).toBeCloseTo(point.y, 8)
}

beforeEach(() => {
  registerWindow(window, document)
  globalThis.SVG = { Point }
})

afterEach(() => {
  delete globalThis.SVG
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe.each(['LWPOLYLINE', 'POLYLINE'])('imported %s snapping', type => {
  test.each([false, true])('snaps every vertex of a closed=%s polyline', closed => {
    const vertices = closed ? CLOSED_VERTICES : OPEN_VERTICES
    const fixture = importFixture(type, vertices, { closed })

    for (const [x, y] of vertices) {
      expectSnap(fixture, { x: x / 10, y: -y / 10 }, 'endpoint')
    }
  })

  test.each([false, true])('snaps every segment midpoint of a closed=%s polyline', closed => {
    const vertices = closed ? CLOSED_VERTICES : OPEN_VERTICES
    const fixture = importFixture(type, vertices, { closed })
    const points = closed ? [...vertices, vertices[0]] : vertices

    for (let index = 1; index < points.length; index += 1) {
      expectSnap(fixture, {
        x: (points[index - 1][0] + points[index][0]) / 20,
        y: -(points[index - 1][1] + points[index][1]) / 20,
      }, 'midpoint')
    }
  })

  test.each([false, true])('does not label the whole-path halfway vertex as a midpoint for closed=%s', closed => {
    const vertices = closed ? CLOSED_VERTICES : OPEN_VERTICES
    const fixture = importFixture(type, vertices, { closed })
    const halfwayVertex = closed ? { x: 40, y: -20 } : { x: 30, y: -10 }

    expect(snap(fixture, halfwayVertex, 'midpoint')).toBeNull()
  })

  test('snaps both ends and the join of a polyline with a circular bulge', () => {
    const fixture = importFixture(type, OPEN_VERTICES, { bulge: 1 })
    expect(fixture.path.array().map(segment => segment[0])).toEqual(['M', 'A', 'L'])

    for (const [x, y] of OPEN_VERTICES) {
      expectSnap(fixture, { x: x / 10, y: -y / 10 }, 'endpoint')
    }
  })

  test('snaps the curved and straight midpoints of a polyline with a circular bulge', () => {
    const fixture = importFixture(type, OPEN_VERTICES, { bulge: 1 })

    expectSnap(fixture, { x: 20, y: 0 }, 'midpoint')
    expectSnap(fixture, { x: 30, y: -20 }, 'midpoint')
    expect(snap(fixture, { x: 20, y: -10 }, 'midpoint')).toBeNull()
  })
})
