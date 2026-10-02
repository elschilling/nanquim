// @vitest-environment jsdom

import { SVG, registerWindow } from '@svgdotjs/svg.js'
import { beforeEach, describe, expect, test } from 'vitest'

import toSVG from '../src/js/libs/dxf/src/toSVG.js'
import DxfHelper from '../src/js/libs/dxf/src/Helper.js'

const QUARTER_BULGE = Math.tan(Math.PI / 8)

function importEntities(entities, { insUnits = 5, blocks = [] } = {}) {
  const report = {}
  const parsed = {
    header: { insUnits },
    blocks,
    entities: entities.map((entity) => ({ layer: 'Curves', ...entity })),
    tables: { layers: { Curves: { colorNumber: 7, flags: 0 } } },
  }
  const source = toSVG(parsed, { report })
  const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
  expect(root.querySelector('parsererror')).toBeNull()
  return { root, report, source }
}

function pathSegments(root) {
  const path = root.querySelector('path')
  return path ? SVG().path(path.getAttribute('d')).array() : null
}

beforeEach(() => {
  document.body.replaceChildren()
  registerWindow(window, document)
})

describe.each(['LWPOLYLINE', 'POLYLINE'])('exact %s bulge import', (type) => {
  test('retains group-code 42 bulges through the runtime parser and SVG renderer', () => {
    const header = [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 5, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES']
    const vertices = [[10, 0, 20, 0, 42, QUARTER_BULGE], [10, 10, 20, 0]]
    const entity = type === 'LWPOLYLINE'
      ? [0, type, 8, 'Curves', 90, 2, ...vertices.flat()]
      : [0, type, 8, 'Curves', 70, 0, ...vertices.flatMap(vertex => [0, 'VERTEX', ...vertex]), 0, 'SEQEND']
    const helper = new DxfHelper([...header, ...entity, 0, 'ENDSEC', 0, 'EOF'].join('\n'))
    expect(helper.parsed.entities[0].vertices[0].bulge).toBeCloseTo(QUARTER_BULGE, 10)
    const root = new DOMParser().parseFromString(helper.toSVG(), 'image/svg+xml').documentElement
    expect(pathSegments(root).map(segment => segment[0])).toEqual(['M', 'A'])
  })

  test.each([
    { bulge: QUARTER_BULGE, radius: Math.SQRT2 * 5, large: 0, sweep: 1 },
    { bulge: -QUARTER_BULGE, radius: Math.SQRT2 * 5, large: 0, sweep: 0 },
    { bulge: 1, radius: 5, large: 0, sweep: 1 },
    { bulge: 2, radius: 6.25, large: 1, sweep: 1 },
    { bulge: -2, radius: 6.25, large: 1, sweep: 0 },
  ])('preserves the circular arc for bulge $bulge without chord sampling', ({ bulge, radius, large, sweep }) => {
    const { root, report } = importEntities([{ type, vertices: [{ x: 0, y: 0, bulge }, { x: 10, y: 0 }] }])
    const segments = pathSegments(root)
    expect(segments).toHaveLength(2)
    expect(segments[0]).toEqual(['M', 0, 0])
    expect(segments[1][0]).toBe('A')
    expect(segments[1][1]).toBeCloseTo(radius, 10)
    expect(segments[1][2]).toBeCloseTo(radius, 10)
    expect(segments[1].slice(3)).toEqual([0, large, sweep, 10, 0])
    expect(root.querySelector('path').getAttribute('data-arc-data')).toBeNull()
    expect(report.skippedEntityTypes).toBeUndefined()
  })

  test('uses the closing vertex bulge for a closed contour and preserves its straight sides', () => {
    const { root } = importEntities([{
      type,
      closed: true,
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10, bulge: -QUARTER_BULGE }],
    }])
    const segments = pathSegments(root)
    expect(segments.slice(0, 3)).toEqual([['M', 0, 0], ['L', 10, 0], ['L', 10, 10]])
    expect(segments[3][0]).toBe('A')
    expect(segments[3].slice(3)).toEqual([0, 0, 0, 0, 0])
    expect(segments[4]).toEqual(['Z'])
    expect(segments).toHaveLength(5)
  })

  test('ignores the final bulge of an open contour', () => {
    const { root } = importEntities([{
      type,
      vertices: [{ x: 0, y: 0, bulge: QUARTER_BULGE }, { x: 10, y: 0, bulge: 2 }],
    }])
    expect(pathSegments(root)).toHaveLength(2)
    expect(pathSegments(root)[1].slice(-2)).toEqual([10, 0])
    expect(root.querySelector('path').getAttribute('d')).not.toMatch(/[Zz]/)
  })

  test('keeps the established line-only SVG contour representation', () => {
    const { root } = importEntities([{
      type,
      closed: true,
      vertices: [{ x: 20, y: 25 }, { x: 40, y: 25 }, { x: 40, y: 55 }, { x: 20, y: 55 }],
    }])
    expect(root.querySelector('path').getAttribute('d')).toBe('M20,25L40,25L40,55L20,55L20,25')
  })

  test.each([
    [{ x: 1, y: 1, bulge: 1 }, { x: 1, y: 1 }],
    [{ x: 0, y: 0, bulge: 1e-20 }, { x: 10, y: 0 }],
    [{ x: 999999999, y: 0, bulge: 2 }, { x: 999999999, y: 10 }],
  ])('skips invalid or out-of-bound curved geometry with a diagnostic', (vertices) => {
    const { root, report, source } = importEntities([{ type, vertices }])
    expect(root.querySelector('path')).toBeNull()
    expect(root.getAttribute('viewBox')).toBe('-5 -5 10 10')
    expect(report.skippedEntityTypes).toMatchObject({ [type]: 1 })
    expect(source).not.toMatch(/(?:^|[^a-z])(?:NaN|Infinity)(?=$|[^a-z])/i)
  })

  test('includes arc extrema in viewBox bounds between the endpoint vertices', () => {
    const { root } = importEntities([{ type, vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0 }] }])
    const [x, y, width, height] = root.getAttribute('viewBox').split(' ').map(Number)
    expect(x).toBeCloseTo(0, 10)
    expect(y).toBeCloseTo(0, 10)
    expect(width).toBeCloseTo(10, 10)
    expect(height).toBeCloseTo(5, 10)
  })

  test.each([
    { bulge: 2, expected: [-1.25, 0, 12.5, 10] },
    { bulge: -2, expected: [-1.25, -10, 12.5, 10] },
  ])('uses the complete major-arc extents for signed bulge $bulge', ({ bulge, expected }) => {
    const { root } = importEntities([{ type, vertices: [{ x: 0, y: 0, bulge }, { x: 10, y: 0 }] }])
    const bounds = root.getAttribute('viewBox').split(' ').map(Number)
    bounds.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 10))
  })

  test('applies document units and reflected INSERT transforms to exact paths and their bounds', () => {
    const geometry = { type, vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0 }] }
    const scaled = importEntities([geometry], { insUnits: 4 })
    expect(scaled.root.getAttribute('viewBox').split(' ').map(Number)).toEqual([0, 0, 1, 0.5])
    const inserted = importEntities([{ type: 'INSERT', block: 'Arc block', x: 100, y: 200, scaleX: -2, scaleY: 2 }], {
      blocks: [{ name: 'Arc block', x: 0, y: 0, entities: [geometry] }],
    })
    expect(pathSegments(inserted.root).map(segment => segment[0])).toEqual(['M', 'A'])
    expect(inserted.root.querySelector('path').parentElement.getAttribute('transform')).toBe('matrix(-2 0 0 2 100 200)')
    expect(inserted.root.getAttribute('viewBox').split(' ').map(Number)).toEqual([80, -200, 20, 10])
  })

  test('preserves the existing entity extrusion convention', () => {
    const vertices = [{ x: 2, y: 3, bulge: QUARTER_BULGE }, { x: 12, y: 3 }]
    const regular = importEntities([{ type, vertices }])
    const flipped = importEntities([{ type, vertices, extrusionZ: -1 }])
    expect(pathSegments(flipped.root)).toEqual(pathSegments(regular.root))
  })
})
