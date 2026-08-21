// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { SVG, registerWindow } from '@svgdotjs/svg.js'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import DxfHelper from '../src/js/libs/dxf/src/Helper.js'
import {
  DXFExporter,
  buildDXFDocument,
  straightPathPoints,
} from '../src/js/utils/DXFexporter.js'

function createEditor() {
  const root = SVG().addTo(document.body).size(800, 600)
  const drawing = root.group().attr('id', 'Collection')
  const collections = new Map()
  const terminalLogged = { dispatch: vi.fn() }
  const editor = {
    collections,
    drawing,
    signals: { terminalLogged },
  }
  const addCollection = (id, options = {}) => {
    const group = drawing.group().attr({
      id,
      name: options.name || id,
      'data-collection': 'true',
      'data-hidden': options.visible === false ? 'true' : null,
      'data-locked': options.locked ? 'true' : 'false',
    })
    if (options.visible === false) group.hide()
    collections.set(id, {
      group,
      locked: options.locked === true,
      visible: options.visible !== false,
      style: {
        stroke: options.stroke || '#ffffff',
        'stroke-width': 0.1,
        fill: 'transparent',
      },
    })
    return group
  }
  return { addCollection, editor, root }
}

beforeEach(() => {
  document.body.replaceChildren()
  registerWindow(window, document)
})

describe('DXF export interoperability profile', () => {
  test('parses straight absolute and relative SVG paths without accepting curves', () => {
    expect(straightPathPoints('M 1,2 h 4 v 3 l -4,0 z')).toEqual({
      closed: true,
      points: [
        { x: 1, y: 2 },
        { x: 5, y: 2 },
        { x: 5, y: 5 },
        { x: 1, y: 5 },
      ],
    })
    expect(straightPathPoints('M0 0 C 1 2 3 4 5 6')).toBeNull()
    expect(straightPathPoints('M0 0H5V5Z M10 10H15V15Z')).toBeNull()
    expect(straightPathPoints('M0 0')).toBeNull()
  })

  test('exports only direct Model collections with centimeter units and durable layer state', () => {
    const { addCollection, editor, root } = createEditor()
    const visible = addCollection('walls', { name: 'Walls', stroke: '#ff0000' })
    const hidden = addCollection('guides', {
      name: 'Guides',
      stroke: '#00ff00',
      visible: false,
      locked: true,
    })
    visible.line(1, 2, 11, 2).stroke('#ff0000')
    hidden.circle(5, 6, 2).stroke('#00ff00')

    const edit = editor.drawing.group().attr({
      id: 'block-edit-group',
      'data-block-edit': 'true',
      'data-collection': 'true',
    })
    edit.line(100, 100, 200, 200)
    editor.collections.set('block-edit-group', { group: edit, visible: true, locked: false, style: {} })

    const paper = root.group().attr({
      id: 'paper-annotations',
      name: 'Annotations',
      'data-collection': 'true',
      'data-nanquim-paper-annotations': 'true',
    })
    paper.line(300, 300, 400, 400)
    editor.collections.set('paper-annotations', { group: paper, visible: true, locked: false, style: {} })

    const result = buildDXFDocument(editor)
    const parsed = new DxfHelper(result.source).parsed

    expect(parsed.header.insUnits).toBe(5)
    expect(Object.keys(parsed.tables.layers).sort()).toEqual(['0', 'Guides', 'Walls'])
    expect(parsed.tables.layers.Walls).toMatchObject({ colorNumber: 1, flags: 0 })
    expect(parsed.tables.layers.Guides.colorNumber).toBeLessThan(0)
    expect(parsed.tables.layers.Guides.flags & 1).toBe(1)
    expect(parsed.tables.layers.Guides.flags & 4).toBe(4)
    expect(parsed.entities.map(entity => [entity.type, entity.layer])).toEqual([
      ['LINE', 'Walls'],
      ['CIRCLE', 'Guides'],
    ])
    expect(result.counts).toMatchObject({ input: 2, layers: 2, skipped: 0 })
  })

  test('re-exports the baseline imported closed polyline instead of dropping its path', async () => {
    const fixture = await readFile(
      join(process.cwd(), 'tests', 'fixtures', 'basic-entities-r2000.dxf'),
      'utf8',
    )
    const imported = new DOMParser().parseFromString(new DxfHelper(fixture).toSVG(), 'image/svg+xml')
    const importedPath = Array.from(imported.querySelectorAll('path')).find(path => (
      path.getAttribute('d').startsWith('M20,25L40,25')
    ))
    expect(importedPath).not.toBeUndefined()

    const { addCollection, editor } = createEditor()
    addCollection('walls', { name: 'Walls' }).path(importedPath.getAttribute('d'))

    const result = buildDXFDocument(editor)
    const parsed = new DxfHelper(result.source).parsed
    const polyline = parsed.entities.find(entity => entity.type === 'LWPOLYLINE')

    expect(polyline).toMatchObject({
      closed: true,
      layer: 'Walls',
      vertices: [
        { x: 20, y: -25 },
        { x: 40, y: -25 },
        { x: 40, y: -55 },
        { x: 20, y: -55 },
      ],
    })
    expect(result.counts.skipped).toBe(0)
  })

  test('preserves representable per-element inline color overrides', () => {
    const { addCollection, editor } = createEditor()
    const collection = addCollection('colors', { name: 'Colors', stroke: '#ffffff' })
    collection.line(0, 0, 10, 0).css({ stroke: '#0000ff' }).attr('data-style-overrides', 'true')

    const parsed = new DxfHelper(buildDXFDocument(editor).source).parsed

    expect(parsed.entities).toHaveLength(1)
    expect(parsed.entities[0]).toMatchObject({ type: 'LINE', colorNumber: 5 })
  })

  test('maps the qualified semantic geometry profile and reports deliberate approximations', () => {
    const { addCollection, editor } = createEditor()
    const collection = addCollection('profile', { name: 'Profile' })
    const transformed = collection.group().attr('transform', 'matrix(1,0,0,1,20,30)')
    transformed.line(0, 0, 5, 0)
    collection.circle(4).center(10, 10)
    collection.ellipse(12, 6).center(25, 10)
    collection.rect(8, 5).move(35, 5)
    collection.polyline([[0, 20], [5, 24], [10, 20]])
    collection.polygon([[15, 20], [20, 25], [25, 20]])
    collection.path('M30 20H40V25H30Z').data('hatchData', {
      pattern: 'cross',
      angle: 45,
      spacing: 2,
    })
    collection.path('M0 40 A 5 5 0 0 1 10 40').data('arcData', {
      p1: { x: 0, y: 40 },
      p2: { x: 5, y: 35 },
      p3: { x: 10, y: 40 },
    })
    collection.path('M15 40 C20 35 25 45 30 40').data('splineData', {
      points: [
        { x: 15, y: 40 },
        { x: 20, y: 35 },
        { x: 25, y: 45 },
        { x: 30, y: 40 },
      ],
      degree: 3,
      closed: false,
    })
    const appendText = (parent, value, x, y) => {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      text.setAttribute('x', x)
      text.setAttribute('y', y)
      text.textContent = value
      parent.node.appendChild(text)
    }
    appendText(collection, 'Profile text', 35, 40)
    const dimension = collection.group().attr('data-dimension', 'true')
    dimension.line(0, 50, 20, 50)
    appendText(dimension, '20 cm', 8, 49)

    const before = editor.drawing.node.outerHTML
    const result = buildDXFDocument(editor)
    const parsed = new DxfHelper(result.source).parsed
    const typeCounts = parsed.entities.reduce((counts, entity) => {
      counts[entity.type] = (counts[entity.type] || 0) + 1
      return counts
    }, {})

    expect(typeCounts).toEqual({
      ARC: 1,
      CIRCLE: 1,
      ELLIPSE: 1,
      LINE: 2,
      LWPOLYLINE: 5,
      TEXT: 2,
    })
    expect(parsed.entities.find(entity => entity.type === 'LINE')).toMatchObject({
      start: { x: 20, y: -30 },
      end: { x: 25, y: -30 },
    })
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(expect.arrayContaining([
      'dimension-exploded',
      'hatch-outline-only',
      'rectangle-as-polyline',
      'spline-sampled',
    ]))
    expect(result.counts).toMatchObject({ approximated: 4, input: 12, skipped: 0 })
    expect(editor.drawing.node.outerHTML).toBe(before)
  })

  test('rejects affine circle, arc, and ellipse transforms that DXF cannot preserve', () => {
    const { addCollection, editor } = createEditor()
    const collection = addCollection('transforms', { name: 'Transforms' })

    collection.circle(8).center(10, 10).attr('transform', 'matrix(2,0,0,1,0,0)')
    collection.ellipse(12, 6).center(25, 10).attr('transform', 'rotate(30 25 10)')
    collection.path('M0 30 A5 5 0 0 1 10 30')
      .data('arcData', {
        p1: { x: 0, y: 30 },
        p2: { x: 5, y: 25 },
        p3: { x: 10, y: 30 },
      })
      .attr('transform', 'matrix(1,0.25,0,1,0,0)')

    // Axis-aligned non-uniform scaling remains exact for a true ellipse.
    collection.ellipse(10, 4).center(45, 10).attr('transform', 'matrix(2,0,0,3,4,5)')
    // A circular primitive remains a circle under a similarity transform.
    collection.circle(6).center(60, 10).attr('transform', 'rotate(45 60 10) scale(2)')

    const before = editor.drawing.node.outerHTML
    const result = buildDXFDocument(editor)
    const parsed = new DxfHelper(result.source).parsed

    expect(parsed.entities.map(entity => entity.type).sort()).toEqual(['CIRCLE', 'ELLIPSE'])
    expect(result.counts).toMatchObject({ input: 5, skipped: 3 })
    expect(result.diagnostics).toContainEqual({
      code: 'unsupported-affine-transform',
      count: 3,
      message: 'Non-uniform or sheared circles/arcs and rotated or sheared ellipses were skipped during DXF export.',
    })
    expect(editor.drawing.node.outerHTML).toBe(before)
  })

  test('skips every supported entity with invalid or out-of-range geometry before emitting DXF', () => {
    const { addCollection, editor } = createEditor()
    const collection = addCollection('numeric', { name: 'Numeric bounds' })

    const defaultedLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    defaultedLine.setAttribute('x2', '1')
    defaultedLine.setAttribute('y2', '1')
    collection.node.appendChild(defaultedLine)
    collection.line(999999999, 0, 1000000000, 0).attr('transform', 'translate(2 0)')
    collection.circle(2).center(10, 10).attr('r', '-5')
    collection.ellipse(4, 2).center(20, 10).attr('ry', '0')
    collection.rect(4, 2).move(30, 10).attr('width', '-4')
    collection.polyline([[0, 20], [1e308, 20]])
    collection.path('M0 30L1e308 30')
    collection.path('M0 40A5 5 0 0 1 10 40').data('arcData', {
      p1: { x: 0, y: 40 },
      p2: { x: 1e308, y: 35 },
      p3: { x: 10, y: 40 },
    })
    collection.path('M0 50C5 45 10 55 15 50').data('splineData', {
      points: [
        { x: 0, y: 50 },
        { x: 1e308, y: 45 },
        { x: 15, y: 50 },
      ],
      degree: 3,
      closed: false,
    })
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', '1e308')
    text.setAttribute('y', '60')
    text.textContent = 'Out of range'
    collection.node.appendChild(text)

    const result = buildDXFDocument(editor)
    const parsed = new DxfHelper(result.source).parsed

    expect(parsed.entities).toHaveLength(1)
    expect(parsed.entities[0]).toMatchObject({
      type: 'LINE',
      start: { x: 0, y: 0 },
      end: { x: 1, y: -1 },
    })
    expect(result.counts).toMatchObject({ input: 10, skipped: 9, approximated: 0 })
    expect(result.counts.emitted).toEqual({ LINE: 1 })
    expect(result.diagnostics).toContainEqual({
      code: 'invalid-numeric-geometry',
      count: 9,
      message: 'Geometry with invalid or out-of-range numeric values was skipped during DXF export.',
    })
    expect(result.source).not.toMatch(/NaN|Infinity|1e\+?308|3\.4e\+38/i)
  })

  test('returns a bounded understandable degradation summary and keeps download thin', () => {
    const { addCollection, editor } = createEditor()
    const collection = addCollection('geometry', { name: 'Unsafe\nLayer' })
    collection.rect(10, 5).move(1, 2)
    collection.path('M0 0 C 1 2 3 4 5 6')
    collection.image('data:image/png;base64,AA==', 2, 2)

    const result = buildDXFDocument(editor)

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(expect.arrayContaining([
      'layer-name-normalized',
      'rectangle-as-polyline',
      'unsupported-path',
      'unsupported-entity',
    ]))
    expect(result.diagnostics.length).toBeLessThanOrEqual(16)
    expect(result.counts).toMatchObject({ approximated: 1, input: 3, skipped: 2 })

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:dxf')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const downloaded = new DXFExporter(editor).saveFile('qualified.dxf')

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:dxf')
    expect(downloaded.message).toContain('2 skipped')
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      type: 'span',
      msg: downloaded.message,
    })
  })
})
