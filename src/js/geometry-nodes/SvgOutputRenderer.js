import { GeometrySet2D } from './core/GeometrySet2D.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const CONTAINER_TAGS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'clipPath',
  'mask',
  'marker',
  'pattern',
])

function domNode(value) {
  if (!value) return null
  return value.node || value
}

function kebabCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase()
}

function normalizeMatrix(value) {
  if (!value) return [1, 0, 0, 1, 0, 0]
  const matrix = Array.isArray(value)
    ? value
    : [value.a, value.b, value.c, value.d, value.e, value.f]
  if (matrix.length !== 6 || matrix.some((component) => !Number.isFinite(Number(component)))) {
    throw new TypeError('Geometry item has an invalid transform matrix.')
  }
  return matrix.map(Number)
}

function isIdentity(matrix) {
  return matrix.every((value, index) => value === [1, 0, 0, 1, 0, 0][index])
}

function createShapeNode(shape, documentRef) {
  if (!shape || typeof shape !== 'object' || !shape.tag) {
    throw new TypeError('Geometry item has no renderable SVG payload.')
  }

  const node = documentRef.createElementNS(SVG_NS, shape.tag)
  Object.entries(shape.attrs || {}).forEach(([name, value]) => {
    if (value !== undefined && value !== null) node.setAttribute(kebabCase(name), String(value))
  })
  ;(shape.children || []).forEach((child) => node.appendChild(createShapeNode(child, documentRef)))
  if (shape.text !== undefined) node.textContent = String(shape.text)
  return node
}

function parsePayload(payload, documentRef) {
  if (payload && payload.nodeType === 1) return [documentRef.importNode(payload, true)]
  if (payload && typeof payload === 'object') return [createShapeNode(payload, documentRef)]
  if (typeof payload !== 'string' || payload.trim() === '') {
    throw new TypeError('Geometry item has no renderable SVG payload.')
  }

  const parser = new DOMParser()
  const parsed = parser.parseFromString(`<svg xmlns="${SVG_NS}">${payload}</svg>`, 'image/svg+xml')
  if (parsed.querySelector('parsererror')) {
    throw new SyntaxError(parsed.querySelector('parsererror').textContent || 'Invalid SVG geometry.')
  }

  return Array.from(parsed.documentElement.children).map((node) => documentRef.importNode(node, true))
}

function applyStyleToLeaves(root, style) {
  if (!style || Object.keys(style).length === 0) return

  const visit = (element) => {
    const isContainer = CONTAINER_TAGS.has(element.localName) && element.children.length > 0
    if (isContainer) {
      Array.from(element.children).forEach(visit)
      return
    }

    Object.entries(style).forEach(([rawName, value]) => {
      const name = kebabCase(rawName)
      if (value === undefined) return
      if (value === null || value === '') element.removeAttribute(name)
      else element.setAttribute(name, String(value))
    })
  }

  visit(root)
}

function applyMetadata(root, metadata) {
  if (!metadata || typeof metadata !== 'object') return
  Object.entries(metadata).forEach(([name, value]) => {
    if (!name.startsWith('data-') || value === undefined || value === null) return
    root.setAttribute(name, String(value))
  })
}

function stableToken(value) {
  let hash = 2166136261
  const string = String(value ?? '')
  for (let index = 0; index < string.length; index += 1) {
    hash ^= string.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rewriteLocalReference(value, idMap) {
  let next = String(value)
  idMap.forEach((mappedId, originalId) => {
    const escaped = escapeRegExp(originalId)
    if (next === `#${originalId}`) next = `#${mappedId}`
    next = next.replace(
      new RegExp(`url\\(\\s*(["']?)#${escaped}\\1\\s*\\)`, 'g'),
      (_match, quote) => `url(${quote}#${mappedId}${quote})`,
    )
  })
  return next
}

/**
 * Give every rendered copy its own internal SVG id namespace. This preserves
 * clip paths, masks, gradients, markers and <use href="#…"> references while
 * preventing array instances from resolving references into a sibling copy.
 */
function remapLocalIds(root, namespace) {
  const elements = [root, ...root.querySelectorAll('*')]
  const idMap = new Map()
  let idIndex = 0

  elements.forEach((element) => {
    const originalId = element.getAttribute('id')
    if (!originalId) return
    const mappedId = `gnr-${stableToken(namespace)}-${idIndex++}`
    if (!idMap.has(originalId)) idMap.set(originalId, mappedId)
    element.setAttribute('id', mappedId)
    element.setAttribute('data-nanquim-preserve-id', 'true')
  })

  if (idMap.size === 0) return root

  elements.forEach((element) => {
    Array.from(element.attributes || []).forEach((attribute) => {
      if (attribute.name === 'id') return
      let value = rewriteLocalReference(attribute.value, idMap)
      if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
        value = value.split(/\s+/).map((token) => idMap.get(token) || token).join(' ')
      } else if (attribute.name === 'begin' || attribute.name === 'end') {
        idMap.forEach((mappedId, originalId) => {
          value = value.replace(new RegExp(`(^|;)\\s*${escapeRegExp(originalId)}\\.`, 'g'), `$1${mappedId}.`)
        })
      }
      if (value !== attribute.value) element.setAttribute(attribute.name, value)
    })
    if (element.localName === 'style' && element.textContent) {
      element.textContent = rewriteLocalReference(element.textContent, idMap)
    }
  })

  return root
}

function markDerived(root, editor, objectId) {
  const elements = [root, ...root.querySelectorAll('*')]
  elements.forEach((element) => {
    if (!element.hasAttribute('id')) element.setAttribute('id', String(editor.elementIndex++))
    element.setAttribute('data-gn-derived', 'true')
    if (objectId) element.setAttribute('data-gn-object-id', objectId)
  })
}

function geometryItems(value) {
  if (value instanceof GeometrySet2D) return value.items
  if (Array.isArray(value)) return value
  if (value && Array.isArray(value.items)) return value.items
  return GeometrySet2D.from(value).items
}

/**
 * Renders evaluated pure geometry back into an existing output <g>. Rendering
 * happens in a detached fragment first, so an invalid item never destroys the
 * last known-good output.
 */
class SvgOutputRenderer {
  constructor(editor) {
    this.editor = editor
  }

  render(geometry, output, options = {}) {
    const outputNode = domNode(output)
    if (!outputNode) throw new TypeError('A Geometry Nodes output group is required.')

    const documentRef = outputNode.ownerDocument || document
    const fragment = documentRef.createDocumentFragment()
    const initialElementIndex = this.editor.elementIndex

    try {
      geometryItems(geometry).forEach((item, itemIndex) => {
        const roots = parsePayload(item.svg, documentRef)
        const matrix = normalizeMatrix(item.matrix || item.transform)

        roots.forEach((root, rootIndex) => {
          remapLocalIds(root, `${options.objectId || 'object'}:${item.id || itemIndex}:${rootIndex}`)
          applyMetadata(root, item.metadata)
          if (item.sourceId) root.setAttribute('data-gn-source-id', String(item.sourceId))
          applyStyleToLeaves(root, item.style || {})

          let renderedRoot = root
          if (!isIdentity(matrix)) {
            const matrixGroup = documentRef.createElementNS(SVG_NS, 'g')
            matrixGroup.setAttribute('transform', `matrix(${matrix.join(' ')})`)
            matrixGroup.appendChild(root)
            renderedRoot = matrixGroup
          }

          markDerived(renderedRoot, this.editor, options.objectId)
          fragment.appendChild(renderedRoot)
        })
      })
    } catch (error) {
      // Staging is synchronous and detached, so it is safe to return the id
      // counter to its pre-render value on failure.
      this.editor.elementIndex = initialElementIndex
      throw error
    }

    outputNode.replaceChildren(fragment)
    return output
  }

  replace(output, geometry, options = {}) {
    return this.render(geometry, output, options)
  }
}

export { SvgOutputRenderer, applyStyleToLeaves, normalizeMatrix, remapLocalIds }
export default SvgOutputRenderer
