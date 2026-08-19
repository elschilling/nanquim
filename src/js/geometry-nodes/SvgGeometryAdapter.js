import { GeometrySet2D, MAX_GEOMETRY_ITEMS } from './core/GeometrySet2D.js'
import { createDeterministicId } from './core/ids.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const INTERACTION_CLASSES = new Set([
  'elementHover',
  'elementSelected',
  'selected',
  'selectable',
  'hover',
  'hovered',
])
const DEFAULT_SOURCE_LIMITS = Object.freeze({
  maxItems: MAX_GEOMETRY_ITEMS,
  maxElements: 100000,
  maxTextLength: 4 * 1024 * 1024,
  maxAttributeLength: 16 * 1024 * 1024,
  maxSerializedLength: 32 * 1024 * 1024,
  maxDepth: 128,
})
const RESERVED_GEOMETRY_NODE_METADATA_NAMES = new Set([
  'data-geometry-nodes',
  'data-nanquim-preserve-id',
  'data-nanquim-style-scope',
])

function isReservedGeometryNodeMetadataName(value) {
  const name = String(value).toLowerCase()
  return RESERVED_GEOMETRY_NODE_METADATA_NAMES.has(name) || name.startsWith('data-gn-')
}

function domNode(value) {
  if (!value) return null
  return value.node || value
}

function stripEditorState(root) {
  const elements = [root, ...root.querySelectorAll('*')]
  elements.forEach((element) => {
    const className = element.getAttribute('class')
    if (!className) return

    const retained = className
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => !INTERACTION_CLASSES.has(token))

    if (retained.length > 0) element.setAttribute('class', retained.join(' '))
    else element.removeAttribute('class')
  })
}

function collectDataAttributes(element) {
  const result = {}
  Array.from(element.attributes || []).forEach((attribute) => {
    if (
      attribute.name.toLowerCase().startsWith('data-')
      && !isReservedGeometryNodeMetadataName(attribute.name)
    ) {
      result[attribute.name] = attribute.value
    }
  })
  return result
}

function reserveSharedSourceWork(budget, key, amount, message) {
  if (!budget || !Number.isFinite(budget[key])) return
  const remaining = Math.max(0, budget[key])
  if (amount > remaining) {
    budget[key] = 0
    throw new RangeError(message)
  }
  budget[key] = remaining - amount
}

function measureSourceTree(children, limits, budget) {
  const pending = Array.from(children, (node) => ({ node, depth: 0 })).reverse()
  let elements = 0
  let textLength = 0
  let attributeLength = 0

  while (pending.length > 0) {
    const { node, depth } = pending.pop()
    if (depth > limits.maxDepth) {
      throw new RangeError('Geometry Nodes source is too deeply nested to evaluate safely.')
    }
    if (node.nodeType === 1) {
      elements += 1
      reserveSharedSourceWork(
        budget,
        'remainingSourceElements',
        1,
        'Geometry Nodes batch exceeded the safe source-element limit.',
      )
      if (elements > limits.maxElements) {
        throw new RangeError('Geometry Nodes source exceeds the safe element limit.')
      }
      const nodeAttributeLength = Array.from(node.attributes || []).reduce(
        (total, attribute) => total + attribute.name.length + attribute.value.length,
        0,
      )
      attributeLength += nodeAttributeLength
      reserveSharedSourceWork(
        budget,
        'remainingSourceAttributeLength',
        nodeAttributeLength,
        'Geometry Nodes batch exceeded the safe source-attribute limit.',
      )
      if (attributeLength > limits.maxAttributeLength) {
        throw new RangeError('Geometry Nodes source exceeds the safe attribute limit.')
      }
    } else if (node.nodeType === 3 || node.nodeType === 4) {
      const length = node.nodeValue ? node.nodeValue.length : 0
      textLength += length
      reserveSharedSourceWork(
        budget,
        'remainingSourceTextLength',
        length,
        'Geometry Nodes batch exceeded the safe source-text limit.',
      )
      if (textLength > limits.maxTextLength) {
        throw new RangeError('Geometry Nodes source exceeds the safe text limit.')
      }
    }
    const descendants = Array.from(node.childNodes || [])
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      pending.push({ node: descendants[index], depth: depth + 1 })
    }
  }
  return { elements, textLength, attributeLength }
}

/**
 * Converts the hidden source side of a Geometry Nodes object into the pure,
 * serializable representation consumed by the evaluator. No SVG.js or live
 * DOM references escape this adapter.
 */
class SvgGeometryAdapter {
  constructor(editor = null) {
    this.editor = editor
  }

  fromSource(source, options = {}) {
    const sourceNode = domNode(source)
    if (!sourceNode) return GeometrySet2D.empty()

    options = options && typeof options === 'object' ? options : {}
    const limits = { ...DEFAULT_SOURCE_LIMITS, ...(options.limits || {}) }
    const budget = options.budget && typeof options.budget === 'object' ? options.budget : null
    const children = Array.from(sourceNode.children || [])
    reserveSharedSourceWork(
      budget,
      'remainingSourceItems',
      children.length,
      'Geometry Nodes batch exceeded the safe source-item limit.',
    )
    if (children.length > limits.maxItems) {
      throw new RangeError('Geometry Nodes source exceeds the safe item limit.')
    }
    measureSourceTree(children, limits, budget)
    if (
      children.length > 0
      && budget
      && Number.isFinite(budget.remainingSourceSerializedLength)
      && budget.remainingSourceSerializedLength <= 0
    ) {
      throw new RangeError('Geometry Nodes batch exceeded the safe source-serialization limit.')
    }

    const serializer = new XMLSerializer()
    const items = []
    let serializedLength = 0
    children.forEach((child, index) => {
      const clone = child.cloneNode(true)
      const sourceId = child.getAttribute('id') || null
      stripEditorState(clone)
      const svg = serializer.serializeToString(clone)
      serializedLength += svg.length
      reserveSharedSourceWork(
        budget,
        'remainingSourceSerializedLength',
        svg.length,
        'Geometry Nodes batch exceeded the safe source-serialization limit.',
      )
      if (serializedLength > limits.maxSerializedLength) {
        throw new RangeError('Geometry Nodes source exceeds the safe serialization limit.')
      }

      items.push({
        id: createDeterministicId('source', sourceId || 'anonymous', index),
        sourceId,
        type: clone.localName || 'svg',
        svg,
        matrix: [1, 0, 0, 1, 0, 0],
        style: {},
        metadata: collectDataAttributes(clone),
      })
    })

    return new GeometrySet2D(items)
  }

  // Friendly aliases for callers and tests that describe this operation as
  // extraction/serialization rather than adaptation.
  extract(source) {
    return this.fromSource(source)
  }

  serialize(source) {
    return this.fromSource(source)
  }

  static stripEditorState(node) {
    const clone = domNode(node).cloneNode(true)
    stripEditorState(clone)
    return clone
  }
}

export {
  DEFAULT_SOURCE_LIMITS,
  SVG_NS,
  SvgGeometryAdapter,
  isReservedGeometryNodeMetadataName,
  measureSourceTree,
  stripEditorState,
}
export default SvgGeometryAdapter
