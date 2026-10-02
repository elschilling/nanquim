// @vitest-environment jsdom

import { Matrix, SVG, registerWindow } from '@svgdotjs/svg.js'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { prepareDocumentSource } from '../src/js/document/DocumentParser.js'
import DxfHelper from '../src/js/libs/dxf/src/Helper.js'
import { buildDXFDocument } from '../src/js/utils/DXFexporter.js'

function fixture() {
  const root = SVG().addTo(document.body).size(800, 600)
  const drawing = root.group()
  const collection = drawing.group().attr({ id: 'rounded', name: 'Rounded', 'data-collection': 'true', stroke: '#ffffff', fill: 'none' })
  const editor = {
    drawing,
    collections: new Map([['rounded', { group: collection, visible: true, locked: false, style: { stroke: '#ffffff', fill: 'none' } }]]),
  }
  return { collection, editor, root }
}

function exportedPolyline(editor, approximated = 1, closed = true) {
  const result = buildDXFDocument(editor)
  const parsed = new DxfHelper(result.source).parsed
  expect(parsed.entities).toHaveLength(1)
  expect(parsed.entities[0]).toMatchObject({ type: 'LWPOLYLINE', closed, layer: 'Rounded' })
  expect(result.counts).toMatchObject({ input: 1, skipped: 0, approximated })
  return { entity: parsed.entities[0], result }
}

function expectVertices(entity, matrix, expectedSign = -1, radius = 2) {
  const points = [[1 + radius, 3], [21 - radius, 3], [21, 3 + radius], [21, 15 - radius],
    [21 - radius, 15], [1 + radius, 15], [1, 15 - radius], [1, 3 + radius]]
  expect(entity.vertices).toHaveLength(points.length)
  entity.vertices.forEach((vertex, index) => {
    const [x, y] = points[index]
    expect(vertex.x).toBeCloseTo(matrix.a * x + matrix.c * y + matrix.e, 8)
    expect(vertex.y).toBeCloseTo(-(matrix.b * x + matrix.d * y + matrix.f), 8)
    expect(vertex.bulge || 0).toBeCloseTo(index % 2 ? expectedSign * Math.tan(Math.PI / 8) : 0, 10)
  })
}

beforeEach(() => {
  document.body.replaceChildren()
  registerWindow(window, document)
})

afterEach(() => document.body.replaceChildren())

describe('DXF rounded rectangle export', () => {
  test.each([
    ['untransformed', new Matrix()],
    ['rotated and translated', new Matrix().translate(30, -8).rotate(30, 0, 0)],
    ['uniformly scaled', new Matrix().translate(-8, 14).rotate(17, 0, 0).scale(2, 2, 0, 0)],
    ['reflected', new Matrix().translate(50, 6).rotate(25, 0, 0).scale(-1, 1, 0, 0)],
  ])('preserves four exact circular corners when %s', (_label, matrix) => {
    const { collection, editor } = fixture()
    collection.rect(20, 12).move(1, 3).attr({ rx: 2, ry: 2 }).transform(matrix)
    const before = editor.drawing.node.outerHTML
    const { entity, result } = exportedPolyline(editor)
    expectVertices(entity, matrix, matrix.a * matrix.d - matrix.b * matrix.c < 0 ? 1 : -1)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'rectangle-as-polyline', count: 1 }))
    expect(editor.drawing.node.outerHTML).toBe(before)
  })

  test('combines nested collection and element transforms before preserving fillets', () => {
    const { collection, editor } = fixture()
    const parentMatrix = new Matrix().translate(9, -2).rotate(18, 0, 0).scale(1.5, 1.5, 0, 0)
    const localMatrix = new Matrix().translate(-4, 7).rotate(-31, 0, 0)
    collection.transform(parentMatrix)
    collection.group().transform(localMatrix).rect(20, 12).move(1, 3).attr({ rx: 2, ry: 2 })
    expectVertices(exportedPolyline(editor).entity, parentMatrix.multiply(localMatrix))
  })

  test.each(['rx', 'ry'])('inherits the single authored %s radius', radius => {
    const { collection, editor } = fixture()
    collection.rect(20, 12).move(1, 3).attr(radius, 2)
    expectVertices(exportedPolyline(editor).entity, new Matrix())
  })

  test('keeps explicitly zero-radius rectangles square', () => {
    const { collection, editor } = fixture()
    collection.rect(20, 12).move(1, 3).attr({ rx: 2, ry: 0 })
    const { entity } = exportedPolyline(editor)
    expect(entity.vertices).toHaveLength(4)
    expect(entity.vertices.every(vertex => !vertex.bulge)).toBe(true)
  })

  test('clamps oversized circular radii without emitting zero-length segments', () => {
    const { collection, editor } = fixture()
    collection.rect(12, 12).move(1, 3).attr({ rx: 100, ry: 100 })
    const { entity } = exportedPolyline(editor)
    expect(entity.vertices).toHaveLength(4)
    expect(entity.vertices.every(vertex => Math.abs(vertex.bulge + Math.tan(Math.PI / 8)) < 1e-10)).toBe(true)
  })

  test.each([
    ['elliptical radii', { rx: 3, ry: 2 }, null],
    ['non-uniform scale', { rx: 2, ry: 2 }, 'scale(2 1)'],
    ['shear', { rx: 2, ry: 2 }, 'matrix(1 .25 0 1 0 0)'],
    ['unresolved radius units', { rx: '2em', ry: '2em' }, null],
  ])('reports %s instead of silently squaring rounded corners', (_label, radii, transform) => {
    const { collection, editor } = fixture()
    const rectangle = collection.rect(20, 12).move(1, 3).attr(radii)
    if (transform) rectangle.attr('transform', transform)
    const before = editor.drawing.node.outerHTML
    const result = buildDXFDocument(editor)
    expect(new DxfHelper(result.source).parsed.entities).toHaveLength(0)
    expect(result.counts).toMatchObject({ input: 1, skipped: 1, approximated: 0 })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unsupported-rounded-rectangle', count: 1 }))
    expect(editor.drawing.node.outerHTML).toBe(before)
  })

  test.each([-1, NaN, Infinity, 1e308])('rejects an invalid corner radius %s before emission', radius => {
    const { collection, editor } = fixture()
    const rectangle = collection.rect(20, 12).move(1, 3)
    rectangle.node.setAttribute('rx', String(radius))
    rectangle.node.setAttribute('ry', String(radius))
    const result = buildDXFDocument(editor)
    expect(new DxfHelper(result.source).parsed.entities).toHaveLength(0)
    expect(result.counts.skipped).toBe(1)
    expect(result.source).not.toMatch(/NaN|Infinity|1e\+?308/)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid-numeric-geometry' }))
  })

  test('retains exact fillets across sanitized DXF reopen and repeated export', () => {
    const { collection, editor } = fixture()
    const matrix = new Matrix().translate(30, -8).rotate(30, 0, 0)
    collection.rect(20, 12).move(1, 3).attr({ rx: 2, ry: 2 }).transform(matrix)
    const first = exportedPolyline(editor).entity
    const source = buildDXFDocument(editor).source
    const helper = new DxfHelper(source)
    const candidate = prepareDocumentSource(helper.toSVG(), { sourceType: 'svg' })
    const imported = candidate.root.querySelector('path')
    expect(imported.getAttribute('d').match(/A/g)).toHaveLength(4)
    const fresh = fixture()
    // The detached candidate has passed the canonical SVG sanitizer before
    // its cloned collection content is used for a second export.
    const safeCollection = candidate.root.querySelector('[data-collection="true"]')
    const wrapper = SVG(document.importNode(safeCollection, true))
    fresh.collection.add(wrapper)
    const second = exportedPolyline(fresh.editor, 0).entity
    expect(second.vertices).toHaveLength(first.vertices.length)
    second.vertices.forEach((vertex, index) => {
      expect(vertex.x).toBeCloseTo(first.vertices[index].x, 8)
      expect(vertex.y).toBeCloseTo(first.vertices[index].y, 8)
      expect(vertex.bulge || 0).toBeCloseTo(first.vertices[index].bulge || 0, 10)
    })
  })

  test('rejects an elliptical arc that the legacy bake would incorrectly make circular', () => {
    const { collection, editor } = fixture()
    collection.path('M0 0 A4 2 45 0 1 8 0').attr('transform', 'scale(.5 1)')
    const result = buildDXFDocument(editor)
    expect(new DxfHelper(result.source).parsed.entities).toHaveLength(0)
    expect(result.counts.skipped).toBe(1)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unsupported-path' }))
  })

  test('exports zero-radius SVG arc commands as their actual straight segments', () => {
    const { collection, editor } = fixture()
    collection.path('M0 0 A0 2 0 0 1 2 0 L4 0').attr('transform', 'scale(2 3)')
    const { entity } = exportedPolyline(editor, 0, false)
    expect(entity.closed).toBe(false)
    expect(entity.vertices).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 }])
  })

  test('preserves horizontal and vertical fillet path segments under rotation', () => {
    const { collection, editor } = fixture()
    const matrix = new Matrix().translate(30, -8).rotate(30, 0, 0)
    collection.path('m1 3 h18 a2 2 0 0 1 2 2 v8 a2 2 0 0 1 -2 2 h-18 z').transform(matrix)
    const { entity } = exportedPolyline(editor, 0)
    const points = [[1, 3], [19, 3], [21, 5], [21, 13], [19, 15], [1, 15]]
    expect(entity.vertices).toHaveLength(points.length)
    points.forEach(([x, y], index) => {
      expect(entity.vertices[index].x).toBeCloseTo(matrix.a * x + matrix.c * y + matrix.e, 8)
      expect(entity.vertices[index].y).toBeCloseTo(-(matrix.b * x + matrix.d * y + matrix.f), 8)
      expect(entity.vertices[index].bulge || 0).toBeCloseTo([1, 3].includes(index) ? -Math.tan(Math.PI / 8) : 0, 10)
    })
  })

  test('reports curved hatch fill loss while preserving the exact boundary arcs', () => {
    const { collection, editor } = fixture()
    collection.path('M0 0L8 0A2 2 0 0 1 10 2L10 6L0 6Z').data('hatchData', { pattern: 'ANSI31' })
    const { entity, result } = exportedPolyline(editor)
    expect(entity.vertices.filter(vertex => vertex.bulge)).toHaveLength(1)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'hatch-outline-only', count: 1 }))
  })

  test('does not reinterpret rectangle metadata as semantic spline geometry on export', () => {
    const { collection, editor } = fixture()
    collection.rect(20, 12).move(1, 3).attr({ rx: 2, ry: 2 }).data('splineData', {
      points: [{ x: 100, y: 100 }, { x: 200, y: 200 }],
    })
    expectVertices(exportedPolyline(editor).entity, new Matrix())
  })
})
