import { createId } from './ids.js'
import {
  identityMatrix,
  multiplyMatrices,
  normaliseMatrix,
} from './matrix.js'

const MAX_GEOMETRY_ITEMS = 10000
const MAX_GEOMETRY_DATA_LENGTH = 32 * 1024 * 1024
const MAX_GEOMETRY_VALUE_NODES = 200000
const MAX_GEOMETRY_VALUE_DEPTH = 128
const UNSAFE_GEOMETRY_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function assertGeometryItemCount(count) {
  if (count > MAX_GEOMETRY_ITEMS) {
    throw new RangeError(`Geometry output is limited to ${MAX_GEOMETRY_ITEMS.toLocaleString('en-US')} items`)
  }
}

function assertGeometryComplexity(items) {
  let dataLength = 0
  let valueNodes = 0

  items.forEach((item) => {
    const pending = [{ value: item, depth: 0 }]
    const visited = new WeakSet()

    while (pending.length > 0) {
      const { value, depth } = pending.pop()
      valueNodes += 1
      if (valueNodes > MAX_GEOMETRY_VALUE_NODES || depth > MAX_GEOMETRY_VALUE_DEPTH) {
        throw new RangeError('Geometry output exceeds the safe structural complexity limit')
      }
      if (typeof value === 'string') {
        dataLength += value.length
      } else if (value && typeof value === 'object') {
        if (visited.has(value)) continue
        visited.add(value)
        const keys = Object.keys(value)
        if (keys.some((key) => UNSAFE_GEOMETRY_KEYS.has(key))) {
          throw new TypeError('Geometry output contains an unsafe object key')
        }
        keys.forEach((key) => {
          dataLength += key.length
          pending.push({ value: value[key], depth: depth + 1 })
        })
      }
      if (dataLength > MAX_GEOMETRY_DATA_LENGTH) {
        throw new RangeError('Geometry output exceeds the safe data-size limit')
      }
    }
  })
  return { dataLength, valueNodes }
}

function cloneValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)

  if (Array.isArray(value)) {
    const clone = []
    seen.set(value, clone)
    value.forEach(item => clone.push(cloneValue(item, seen)))
    return clone
  }

  const clone = {}
  seen.set(value, clone)
  Object.keys(value).forEach(key => {
    if (UNSAFE_GEOMETRY_KEYS.has(key)) {
      throw new TypeError('Geometry output contains an unsafe object key')
    }
    clone[key] = cloneValue(value[key], seen)
  })
  return clone
}

function normaliseStyle(style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return {}
  return cloneValue(style)
}

function normaliseItem(item = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new TypeError('GeometrySet2D items must be objects')
  }

  const clone = cloneValue(item)
  clone.id = String(item.id || createId('geometry'))
  clone.svg = cloneValue(item.svg ?? null)
  clone.matrix = normaliseMatrix(item.matrix || identityMatrix())
  clone.style = normaliseStyle(item.style)
  return clone
}

/**
 * Immutable-by-convention collection passed between geometry nodes.
 *
 * The SVG payload is deliberately opaque to the core. Adapters may store a
 * serialisable descriptor, an SVG string, or another plain value in `svg`.
 */
class GeometrySet2D {
  constructor(items = []) {
    const source = items instanceof GeometrySet2D ? items.items : items
    if (!Array.isArray(source)) {
      throw new TypeError('GeometrySet2D expects an array of geometry items')
    }
    assertGeometryItemCount(source.length)
    assertGeometryComplexity(source)

    this.items = source.map(normaliseItem)
    this.complexity = Object.freeze(assertGeometryComplexity(this.items))
  }

  static empty() {
    return new GeometrySet2D()
  }

  static from(value) {
    if (value instanceof GeometrySet2D) return value
    if (value === null || value === undefined) return GeometrySet2D.empty()
    if (Array.isArray(value)) return new GeometrySet2D(value)
    if (value && Array.isArray(value.items)) return new GeometrySet2D(value.items)
    if (value && typeof value === 'object' && 'svg' in value) {
      return new GeometrySet2D([value])
    }

    throw new TypeError('Cannot convert value to GeometrySet2D')
  }

  static join(...values) {
    return GeometrySet2D.empty().concat(...values)
  }

  get size() {
    return this.items.length
  }

  get isEmpty() {
    return this.items.length === 0
  }

  clone() {
    return new GeometrySet2D(this.items)
  }

  concat(...values) {
    const items = [...this.items]

    values.flat().forEach(value => {
      const geometry = GeometrySet2D.from(value)
      assertGeometryItemCount(items.length + geometry.items.length)
      items.push(...geometry.items)
    })

    return new GeometrySet2D(items)
  }

  mapItems(callback) {
    const items = this.items.map((item, index) => callback(normaliseItem(item), index))
    return new GeometrySet2D(items.filter(item => item !== null && item !== undefined))
  }

  flatMapItems(callback) {
    const items = []

    this.items.forEach((item, index) => {
      const result = callback(normaliseItem(item), index)
      if (result === null || result === undefined) return
      if (result instanceof GeometrySet2D) {
        assertGeometryItemCount(items.length + result.items.length)
        items.push(...result.items)
      } else if (Array.isArray(result)) {
        assertGeometryItemCount(items.length + result.length)
        items.push(...result)
      } else {
        assertGeometryItemCount(items.length + 1)
        items.push(result)
      }
    })

    return new GeometrySet2D(items)
  }

  transformed(matrix, idMapper) {
    const transform = normaliseMatrix(matrix)

    return this.mapItems((item, index) => ({
      ...item,
      id: typeof idMapper === 'function' ? idMapper(item, index) : item.id,
      matrix: multiplyMatrices(transform, item.matrix),
    }))
  }

  withStyle(style, idMapper) {
    const additions = normaliseStyle(style)

    return this.mapItems((item, index) => {
      const nextStyle = { ...item.style }
      Object.entries(additions).forEach(([key, value]) => {
        if (value === undefined || value === null) {
          delete nextStyle[key]
        } else {
          nextStyle[key] = cloneValue(value)
        }
      })

      return {
        ...item,
        id: typeof idMapper === 'function' ? idMapper(item, index) : item.id,
        style: nextStyle,
      }
    })
  }

  toJSON() {
    return {
      items: this.items.map(normaliseItem),
    }
  }
}

export {
  GeometrySet2D,
  MAX_GEOMETRY_DATA_LENGTH,
  MAX_GEOMETRY_ITEMS,
  MAX_GEOMETRY_VALUE_DEPTH,
  MAX_GEOMETRY_VALUE_NODES,
  assertGeometryComplexity,
  assertGeometryItemCount,
  cloneValue,
  normaliseItem,
}

export default GeometrySet2D
