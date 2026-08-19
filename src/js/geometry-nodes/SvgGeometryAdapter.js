import { GeometrySet2D } from './core/GeometrySet2D.js'
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
    if (attribute.name.startsWith('data-')) result[attribute.name] = attribute.value
  })
  return result
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

  fromSource(source) {
    const sourceNode = domNode(source)
    if (!sourceNode) return GeometrySet2D.empty()

    const serializer = new XMLSerializer()
    const items = Array.from(sourceNode.children || []).map((child, index) => {
      const clone = child.cloneNode(true)
      const sourceId = child.getAttribute('id') || null
      stripEditorState(clone)

      return {
        id: createDeterministicId('source', sourceId || 'anonymous', index),
        sourceId,
        type: clone.localName || 'svg',
        svg: serializer.serializeToString(clone),
        matrix: [1, 0, 0, 1, 0, 0],
        style: {},
        metadata: collectDataAttributes(clone),
      }
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

export { SVG_NS, SvgGeometryAdapter, stripEditorState }
export default SvgGeometryAdapter
