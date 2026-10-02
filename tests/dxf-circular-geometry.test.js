import { describe, expect, test } from 'vitest'
import { circularPathVertices } from '../src/js/utils/DXFcircularGeometry.js'

describe('circular SVG path to DXF bulges', () => {
  test.each([
    ['positive quarter', 0, 1, -Math.tan(Math.PI / 8)],
    ['negative quarter', 0, 0, Math.tan(Math.PI / 8)],
    ['positive major', 1, 1, -Math.tan(3 * Math.PI / 8)],
    ['negative major', 1, 0, Math.tan(3 * Math.PI / 8)],
  ])('preserves the %s arc and reverses orientation for DXF Y-up', (_label, large, sweep, bulge) => {
    const result = circularPathVertices(`M 1 0 A 1 1 40 ${large} ${sweep} 0 1`)
    expect(result).toMatchObject({ closed: false, hasArcs: true })
    expect(result.vertices).toHaveLength(2)
    expect(result.vertices[0].bulge).toBeCloseTo(bulge, 12)
    expect(result.vertices[1]).toEqual({ x: 0, y: 1, bulge: 0 })
  })

  test('retains the closing arc on its starting vertex without a duplicate seam', () => {
    const result = circularPathVertices('M 1 0 A 1 1 0 0 1 0 1 A 1 1 0 1 1 1 0 Z')
    expect(result.closed).toBe(true)
    expect(result.vertices).toHaveLength(2)
    expect(result.vertices[0].bulge).toBeCloseTo(-Math.tan(Math.PI / 8), 12)
    expect(result.vertices[1].bulge).toBeCloseTo(-Math.tan(3 * Math.PI / 8), 12)
  })

  test('keeps the terminal endpoint of an open path that returns to its start', () => {
    const result = circularPathVertices('M 1 0 A 1 1 0 0 1 0 1 A 1 1 0 1 1 1 0')
    expect(result.closed).toBe(false)
    expect(result.vertices).toHaveLength(3)
    expect(result.vertices.at(-1)).toEqual({ x: 1, y: 0, bulge: 0 })
  })

  test('handles relative moves, repeated arcs, line commands, and scientific notation', () => {
    const result = circularPathVertices('m1e1,20 h4 v2 a2 2 0 0 1 -2 2 2 2 0 0 1 -2 -2 l0 -2z')
    expect(result).toMatchObject({ closed: true, hasArcs: true })
    expect(result.vertices.map(({ x, y }) => [x, y])).toEqual([[10, 20], [14, 20], [14, 22], [12, 24], [10, 22]])
    expect(result.vertices.filter(vertex => vertex.bulge)).toHaveLength(2)
    expect(result.path).toEqual([['M', 10, 20], ['L', 14, 20], ['L', 14, 22],
      ['A', 2, 2, 0, 0, 1, 12, 24], ['A', 2, 2, 0, 0, 1, 10, 22], ['L', 10, 20], ['Z']])
  })

  test('applies SVG radius correction for an undersized circle arc', () => {
    const result = circularPathVertices('M 0 0 A 1 1 0 0 1 4 0')
    expect(result.vertices[0].bulge).toBeCloseTo(-1, 12)
  })

  test('treats zero-radius arcs as lines and coincident-endpoint arcs as empty', () => {
    const result = circularPathVertices('M0 0 A0 2 0 0 1 2 0 A2 2 0 0 1 2 0 L4 0')
    expect(result).toEqual({ closed: false, hasArcs: false,
      vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 2, y: 0, bulge: 0 }, { x: 4, y: 0, bulge: 0 }],
      path: [['M', 0, 0], ['L', 2, 0], ['L', 4, 0]] })
  })

  test.each([
    '', 'M0 0', 'L0 0A1 1 0 0 1 1 1', 'M0 0M1 1A1 1 0 0 1 2 2',
    'M0 0L1 1ZL2 2', 'M0 0A2 1 0 0 1 2 2', 'M0 0C1 2 3 4 5 6',
    'M0 0A-2 -2 0 0 1 2 2', 'M0 0A2 2 0 2 1 2 2', 'M0 0A2 2 0 0 .5 2 2',
    'M0 0A2 2 0 0 1 2', 'M0 0 A2 2 0 0 1 Infinity 2',
    'M0 0A2 2 0 0 1 1e308 2', 'M999999999 0A4 4 0 1 0 999999998 0',
  ])('rejects unsupported, malformed, or unbounded geometry %s', path => {
    expect(circularPathVertices(path)).toBeNull()
  })

  test('bounds curved path parsing before allocating an unbounded vertex list', () => {
    expect(circularPathVertices(`M0 0${'L1 1'.repeat(10001)}`)).toBeNull()
    expect(circularPathVertices(' '.repeat(1000001))).toBeNull()
  })
})
