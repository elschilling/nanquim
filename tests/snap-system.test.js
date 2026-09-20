// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { checkSnap } from '../src/js/utils/snapSystem.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

class TestPoint {
  constructor(point) {
    this.x = point.x
    this.y = point.y
  }

  transform(matrix) {
    return new TestPoint({
      x: matrix.a * this.x + matrix.c * this.y + matrix.e,
      y: matrix.b * this.x + matrix.d * this.y + matrix.f,
    })
  }
}

function makeElement({
  array = [],
  attributes = {},
  bbox,
  data = {},
  matrix = IDENTITY,
  pathPoint = length => ({ x: length, y: 0 }),
  totalLength = 10,
  type,
}) {
  const node = document.createElementNS(SVG_NS, type === 'use' ? 'use' : type)
  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value))
  node.getBBox = vi.fn(() => bbox || { x: 0, y: 0, width: 10, height: 10 })
  node.getTotalLength = vi.fn(() => totalLength)
  node.getPointAtLength = vi.fn(pathPoint)
  const geometryAttributes = {
    circle: ['cx', 'cy', 'r'],
    ellipse: ['cx', 'cy', 'rx', 'ry'],
    image: ['x', 'y', 'width', 'height'],
    rect: ['x', 'y', 'width', 'height'],
  }[type] || []
  if (geometryAttributes.length > 0) {
    for (const name of geometryAttributes) {
      node[name] = { baseVal: { value: Number(attributes[name] ?? 0) } }
    }
  }

  return {
    type,
    node,
    array: vi.fn(() => array),
    attr: vi.fn(name => node.hasAttribute(name) ? node.getAttribute(name) : undefined),
    data: vi.fn(name => data[name]),
    screenCTM: vi.fn(() => matrix),
    x: vi.fn(() => Number(attributes.x)),
    y: vi.fn(() => Number(attributes.y)),
  }
}

function makeIndex(elements) {
  return {
    ensureFresh: vi.fn(),
    search: vi.fn(() => elements.map(element => ({ element }))),
  }
}

function makeFixture(elements, snapTypes, options = {}) {
  const spatialIndex = makeIndex(elements)
  const fullSpatialIndex = makeIndex(elements)
  const activeSvg = {
    node: {
      clientWidth: 100,
      getBoundingClientRect: () => ({ width: 100 }),
    },
    point: (x, y) => ({ x, y }),
    screenCTM: () => IDENTITY,
    viewbox: () => ({ height: 100, width: 100, x: 0, y: 0 }),
  }
  const editor = {
    editingVertices: [],
    fullSpatialIndex,
    ghostNodes: options.ghostNodes || null,
    isDrawing: false,
    isEditingVertex: false,
    isInteracting: options.isInteracting === true,
    snapExcludeNonSelectable: options.snapExcludeNonSelectable !== false,
    snapTypes,
    spatialIndex,
  }
  return { activeSvg, editor, fullSpatialIndex, spatialIndex }
}

function expectSnap(fixture, cursor, expected, tolerance = 1) {
  const result = checkSnap(cursor, fixture.editor, fixture.activeSvg, tolerance)
  expect(result).toEqual({ worldPoint: expected.point, snapType: expected.type })
}

describe('snapSystem transformed geometry qualification', () => {
  beforeEach(() => {
    globalThis.SVG = { Point: TestPoint }
  })

  afterEach(() => {
    delete globalThis.SVG
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  test('snaps a line endpoint through its complete nested-group CTM', () => {
    // screenCTM represents both transformed ancestor groups and the leaf.
    const line = makeElement({
      array: [[1, 2], [5, 2]],
      matrix: { a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 },
      type: 'line',
    })
    const fixture = makeFixture([line], { endpoint: true })

    expectSnap(fixture, { x: 12, y: 26 }, {
      point: { x: 12, y: 26 },
      type: 'endpoint',
    })
  })

  test('snaps to an imported image corner while a command is interacting', () => {
    const image = makeElement({
      attributes: { x: 10, y: 20, width: 80, height: 40 },
      type: 'image',
    })
    const fixture = makeFixture([image], { endpoint: true }, { isInteracting: true })

    expectSnap(fixture, { x: 10.5, y: 20.25 }, {
      point: { x: 10, y: 20 },
      type: 'endpoint',
    })
  })

  test.each([
    ['endpoint', { x: 210, y: 90 }],
    ['endpoint', { x: 210, y: 190 }],
    ['endpoint', { x: 150, y: 190 }],
    ['endpoint', { x: 150, y: 90 }],
    ['midpoint', { x: 210, y: 140 }],
    ['midpoint', { x: 180, y: 190 }],
    ['midpoint', { x: 150, y: 140 }],
    ['midpoint', { x: 180, y: 90 }],
    ['center', { x: 180, y: 140 }],
  ])('snaps an image %s to its visible cropped bounds under a nested transform (%j)', (type, point) => {
    const image = makeElement({
      attributes: {
        x: 10, y: 20, width: 80, height: 40,
        'clip-path': 'inset(25% 25% 25% 12.5%) fill-box',
      },
      matrix: { a: 0, b: 2, c: -3, d: 0, e: 300, f: 50 },
      type: 'image',
    })
    const fixture = makeFixture([image], { [type]: true })

    expectSnap(fixture, { x: point.x + 0.5, y: point.y + 0.25 }, { point, type })
    expect(checkSnap({ x: 240, y: 70 }, fixture.editor, fixture.activeSvg, 1)).toBeNull()
    fixture.editor.snapTypes[type] = false
    expect(checkSnap(point, fixture.editor, fixture.activeSvg, 1)).toBeNull()
  })

  test.each([0, -10, Infinity, NaN])('does not snap to an image with invalid width %s', width => {
    const image = makeElement({
      attributes: { x: 10, y: 20, width, height: 40 },
      type: 'image',
    })
    const fixture = makeFixture([image], { endpoint: true, midpoint: true, center: true })

    expect(checkSnap({ x: 10, y: 20 }, fixture.editor, fixture.activeSvg, 100)).toBeNull()
  })

  test.each([
    ['command ghost', image => ({ ghostNodes: new Set([image.node]) })],
    ['transient image', image => {
      image.node.setAttribute('data-nanquim-transient', 'true')
      return {}
    }],
    ['image inside a transient group', image => {
      const group = document.createElementNS(SVG_NS, 'g')
      group.setAttribute('data-nanquim-transient', 'true')
      group.append(image.node)
      return {}
    }],
  ])('excludes a %s from image snap targets', (_label, configure) => {
    const image = makeElement({
      attributes: { x: 10, y: 20, width: 80, height: 40 },
      type: 'image',
    })
    const fixture = makeFixture([image], { endpoint: true, midpoint: true, center: true }, configure(image))

    expect(checkSnap({ x: 10, y: 20 }, fixture.editor, fixture.activeSvg, 100)).toBeNull()
  })

  test('does not infer nearest or intersection geometry from bitmap content or image edges', () => {
    const image = makeElement({
      attributes: { x: 10, y: 20, width: 80, height: 40 },
      type: 'image',
    })
    const line = makeElement({ array: [[30, 0], [30, 100]], type: 'line' })
    const fixture = makeFixture([image], { nearest: true })
    expect(checkSnap({ x: 30, y: 20 }, fixture.editor, fixture.activeSvg, 1)).toBeNull()

    const intersectionFixture = makeFixture([image, line], { intersection: true })
    expect(checkSnap({ x: 30, y: 20 }, intersectionFixture.editor, intersectionFixture.activeSvg, 1)).toBeNull()
  })

  test.each([
    {
      cursor: { x: 25, y: 17 },
      expected: { x: 25, y: 20 },
      label: 'untransformed',
      matrix: IDENTITY,
      tolerance: 4,
    },
    {
      cursor: { x: 44, y: 90 },
      expected: { x: 40, y: 90 },
      label: 'rotated and non-uniformly scaled',
      matrix: { a: 0, b: 2, c: -3, d: 0, e: 100, f: 50 },
      tolerance: 5,
    },
  ])('snaps to the nearest $label rectangle edge', ({ cursor, expected, matrix, tolerance }) => {
    const rectangle = makeElement({
      attributes: { x: 10, y: 20, width: 30, height: 20 },
      matrix,
      type: 'rect',
    })
    const fixture = makeFixture([rectangle], { nearest: true })

    expectSnap(fixture, cursor, { point: expected, type: 'nearest' }, tolerance)
  })

  test.each([
    ['endpoint', { endpoint: true }, { x: 120, y: 50 }],
    ['midpoint', { midpoint: true }, { x: 110, y: 60 }],
    ['center', { center: true }, { x: 110, y: 50 }],
  ])('snaps an arc %s in root coordinates under a nested transform', (type, snapTypes, cursor) => {
    const arc = makeElement({
      data: {
        arcData: {
          p1: { x: 0, y: 0 },
          p2: { x: 5, y: 5 },
          p3: { x: 10, y: 0 },
        },
      },
      matrix: { a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 },
      type: 'path',
    })
    const fixture = makeFixture([arc], snapTypes)

    expectSnap(fixture, cursor, {
      point: cursor,
      type,
    })
  })

  test.each([
    ['endpoint', { endpoint: true }, { x: 20, y: 40 }],
    ['center', { center: true }, { x: 20, y: 30 }],
    ['quadrant', { quadrant: true }, { x: 40, y: 30 }],
  ])('snaps an ellipse-arc %s after converting metadata from local space', (type, snapTypes, cursor) => {
    const ellipseArc = makeElement({
      data: {
        ellipseArcData: {
          ccw: true,
          cx: 0,
          cy: 0,
          endPt: { x: 0, y: 5 },
          rotation: 0,
          rx: 10,
          ry: 5,
          startPt: { x: 10, y: 0 },
          theta1: 0,
          theta2: Math.PI / 2,
        },
      },
      matrix: { a: 2, b: 0, c: 0, d: 2, e: 20, f: 30 },
      type: 'path',
    })
    const fixture = makeFixture([ellipseArc], snapTypes)

    expectSnap(fixture, cursor, {
      point: cursor,
      type,
    })
  })

  test.each([
    ['endpoint', { endpoint: true }, { x: 50, y: 54 }],
    ['midpoint', { midpoint: true }, { x: 50, y: 58 }],
    ['nearest', { nearest: true }, { x: 50, y: 54 }],
  ])('snaps a spline %s through a rotated ancestor transform', (type, snapTypes, cursor) => {
    const spline = makeElement({
      data: {
        splineData: {
          points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 7, y: 3 }],
        },
      },
      matrix: { a: 0, b: 1, c: -1, d: 0, e: 50, f: 50 },
      totalLength: 16,
      type: 'path',
    })
    const fixture = makeFixture([spline], snapTypes)

    expectSnap(fixture, cursor, {
      point: cursor,
      type,
    })
  })

  test('computes intersections from transformed world segments', () => {
    const horizontal = makeElement({
      array: [[0, 0], [10, 0]],
      matrix: { ...IDENTITY, e: 100, f: 50 },
      type: 'line',
    })
    const vertical = makeElement({
      array: [[0, 0], [0, 10]],
      matrix: { ...IDENTITY, e: 105, f: 45 },
      type: 'line',
    })
    const fixture = makeFixture([horizontal, vertical], { intersection: true })

    expectSnap(fixture, { x: 105, y: 50 }, {
      point: { x: 105, y: 50 },
      type: 'intersection',
    })
  })

  test.each([
    ['insertion point', { x: 105, y: 56 }],
    ['measurable bbox corner', { x: 102, y: 53 }],
  ])('qualifies a block instance %s as an endpoint without traversing its shadow tree', (_label, cursor) => {
    const block = makeElement({
      attributes: {
        'data-block-instance': 'true',
        x: 5,
        y: 6,
      },
      bbox: { x: 2, y: 3, width: 10, height: 20 },
      matrix: { a: 1, b: 0, c: 0, d: 1, e: 100, f: 50 },
      type: 'use',
    })
    const fixture = makeFixture([block], { endpoint: true })

    expectSnap(fixture, cursor, { point: cursor, type: 'endpoint' })
  })

  test('chooses the selectable index by default and the full index only when requested', () => {
    const line = makeElement({ array: [[2, 3], [8, 3]], type: 'line' })
    const fixture = makeFixture([line], { endpoint: true })

    expectSnap(fixture, { x: 2, y: 3 }, {
      point: { x: 2, y: 3 },
      type: 'endpoint',
    })
    expect(fixture.spatialIndex.ensureFresh).toHaveBeenCalledWith(fixture.editor, undefined)
    expect(fixture.spatialIndex.search).toHaveBeenCalledOnce()
    expect(fixture.fullSpatialIndex.ensureFresh).not.toHaveBeenCalled()

    fixture.editor.snapExcludeNonSelectable = false
    fixture.spatialIndex.ensureFresh.mockClear()
    fixture.spatialIndex.search.mockClear()
    checkSnap({ x: 2, y: 3 }, fixture.editor, fixture.activeSvg, 1)

    expect(fixture.fullSpatialIndex.ensureFresh).toHaveBeenCalledWith(
      fixture.editor,
      expect.any(Function),
    )
    expect(fixture.fullSpatialIndex.search).toHaveBeenCalledOnce()
    expect(fixture.spatialIndex.ensureFresh).not.toHaveBeenCalled()
  })

  test.each([
    ['a command-owned ghost node', element => ({ ghostNodes: new Set([element.node]) })],
    ['a transient-marked preview', element => {
      element.node.setAttribute('data-nanquim-transient', 'true')
      return {}
    }],
  ])('never snaps to %s, even outside an interacting flag window', (_label, configure) => {
    const ghost = makeElement({ array: [[2, 3], [8, 3]], type: 'line' })
    const fixture = makeFixture([ghost], { endpoint: true }, configure(ghost))

    expect(checkSnap({ x: 2, y: 3 }, fixture.editor, fixture.activeSvg, 1)).toBeNull()
  })
})
