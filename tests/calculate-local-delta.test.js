import { describe, expect, test } from 'vitest'
import { Matrix } from '@svgdotjs/svg.js'
import { calculateLocalDelta } from '../src/js/utils/calculateDistance.js'

describe('calculateLocalDelta', () => {
  test.each([
    { label: 'identity viewport', root: new Matrix() },
    { label: 'pan and zoom', root: new Matrix({ a: 1.5, d: 1.5, e: 40, f: 30 }) },
    { label: 'inverted canvas', root: new Matrix({ a: 1.5, d: -1.5, e: 40, f: 30 }) },
    { label: 'non-uniform viewport', root: new Matrix({ a: 2, d: 3, e: 40, f: 30 }) },
  ])('maps drawing offsets into parent coordinates with $label', ({ root }) => {
    const parentToRoot = new Matrix({ a: 2, b: 0.5, c: 0.25, d: 0.75, e: 20, f: -10 })
    const parent = { screenCTM: () => root.multiply(parentToRoot) }
    const element = { parent: () => parent, root: () => ({ screenCTM: () => root }) }

    const delta = calculateLocalDelta(element, 12, -7)

    expect(parentToRoot.a * delta.dx + parentToRoot.c * delta.dy).toBeCloseTo(12, 8)
    expect(parentToRoot.b * delta.dx + parentToRoot.d * delta.dy).toBeCloseTo(-7, 8)
  })
})
