// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'

import toSVG from '../src/js/libs/dxf/src/toSVG.js'

function parsedWith(entities, { insUnits = 5 } = {}) {
  return {
    header: { insUnits },
    blocks: [],
    diagnostics: { unsupportedEntityTypes: Object.create(null) },
    entities,
    tables: {
      layers: {
        Bounds: { colorNumber: 7, flags: 0 },
      },
    },
  }
}

function parseSvg(source) {
  const documentRef = new DOMParser().parseFromString(source, 'image/svg+xml')
  expect(documentRef.querySelector('parsererror')).toBeNull()
  return documentRef.documentElement
}

const overboundEntities = [
  ['LINE', {
    type: 'LINE', layer: 'Bounds', start: { x: 1e308, y: 0 }, end: { x: 1, y: 1 },
  }],
  ['CIRCLE', {
    type: 'CIRCLE', layer: 'Bounds', x: 1e308, y: 0, r: 1,
  }],
  ['ARC', {
    type: 'ARC', layer: 'Bounds', x: 1e308, y: 0, r: 1, startAngle: 0, endAngle: Math.PI,
  }],
  ['ELLIPSE', {
    type: 'ELLIPSE', layer: 'Bounds', x: 1e308, y: 0,
    majorX: 2, majorY: 0, axisRatio: 0.5, startAngle: 0, endAngle: Math.PI * 2,
  }],
  ['LWPOLYLINE', {
    type: 'LWPOLYLINE', layer: 'Bounds', vertices: [{ x: 0, y: 0 }, { x: 1e308, y: 1 }],
  }],
  ['POLYLINE', {
    type: 'POLYLINE', layer: 'Bounds', vertices: [{ x: 0, y: 0 }, { x: 1e308, y: 1 }],
  }],
  ['SPLINE', {
    type: 'SPLINE', layer: 'Bounds', degree: 2,
    controlPoints: [{ x: 0, y: 0 }, { x: 1e308, y: 1 }, { x: 2, y: 0 }],
    knots: [0, 0, 0, 1, 1, 1],
  }],
]

describe('DXF SVG numeric boundary', () => {
  test.each(overboundEntities)('skips over-bound %s geometry before SVG emission', (type, entity) => {
    const report = {}
    const root = parseSvg(toSVG(parsedWith([entity]), { report }))

    expect(root.querySelectorAll('line, circle, ellipse, path')).toHaveLength(0)
    expect(root.getAttribute('viewBox')).toBe('-5 -5 10 10')
    expect(report.skippedEntityTypes).toMatchObject({ [type]: 1 })
    expect(root.outerHTML).not.toMatch(/1e\+?308|Infinity|(?:^|[^a-z])NaN(?=$|[^a-z])/i)
  })

  test('applies document unit scaling before accepting native coordinate bounds', () => {
    const report = {}
    const root = parseSvg(toSVG(parsedWith([{
      type: 'LINE',
      layer: 'Bounds',
      start: { x: 10000001, y: 0 },
      end: { x: 10000002, y: 1 },
    }], { insUnits: 6 }), { report }))

    expect(root.querySelector('line')).toBeNull()
    expect(root.getAttribute('viewBox')).toBe('-5 -5 10 10')
    expect(report.skippedEntityTypes).toMatchObject({ LINE: 1 })
  })

  test.each([
    ['CIRCLE', { type: 'CIRCLE', layer: 'Bounds', x: 0, y: 0, r: -5 }],
    ['ARC', {
      type: 'ARC', layer: 'Bounds', x: 0, y: 0, r: 0,
      startAngle: 0, endAngle: Math.PI,
    }],
    ['ELLIPSE', {
      type: 'ELLIPSE', layer: 'Bounds', x: 0, y: 0,
      majorX: 2, majorY: 0, axisRatio: -0.5,
      startAngle: 0, endAngle: Math.PI * 2,
    }],
  ])('skips invalid %s radial dimensions with a bounded diagnostic', (type, entity) => {
    const report = {}
    const root = parseSvg(toSVG(parsedWith([entity]), { report }))

    expect(root.querySelectorAll('circle, ellipse, path')).toHaveLength(0)
    expect(root.getAttribute('viewBox')).toBe('-5 -5 10 10')
    expect(report.skippedEntityTypes).toMatchObject({ [type]: 1 })
  })

  test('rejects a malformed INSERT transform before SVG conversion can relocate its block', () => {
    const source = parsedWith([{
      type: 'INSERT',
      layer: 'Bounds',
      block: 'Unsafe',
      x: Infinity,
      y: 0,
    }])
    source.blocks = [{
      name: 'Unsafe',
      x: 0,
      y: 0,
      entities: [{
        type: 'LINE',
        layer: 'Bounds',
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
      }],
    }]

    expect(() => toSVG(source, { report: {} })).toThrow(expect.objectContaining({
      code: 'invalid-insert-transform',
      name: 'DxfExpansionError',
    }))
  })

  test('skips an entity that would make the combined viewBox exceed serializer limits', () => {
    const report = {}
    const root = parseSvg(toSVG(parsedWith([
      {
        type: 'LINE', layer: 'Bounds',
        start: { x: -1000000000, y: 0 }, end: { x: -1000000000, y: 1 },
      },
      {
        type: 'LINE', layer: 'Bounds',
        start: { x: 1000000000, y: 0 }, end: { x: 1000000000, y: 1 },
      },
    ]), { report }))

    expect(root.querySelectorAll('line')).toHaveLength(1)
    expect(root.getAttribute('viewBox')).toBe('-1000000000 -1 1 1')
    expect(report.skippedEntityTypes).toMatchObject({ LINE: 1 })
  })
})
