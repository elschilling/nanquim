import { GeometrySet2D } from './core/GeometrySet2D.js'
import { isReservedGeometryNodeMetadataName } from './SvgGeometryAdapter.js'
import {
  markupFitsSvgElementBudget,
  rewriteStyleReferences,
  sanitizeCssValue,
  sanitizeSvgDocument,
} from '../utils/sanitizeSvg.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const SAFE_ITEM_STYLE_ATTRIBUTES = new Set(['fill', 'opacity', 'stroke', 'stroke-width'])
const DEFAULT_RENDER_LIMITS = Object.freeze({
  maxItems: 10000,
  maxElements: 100000,
  maxTextLength: 4 * 1024 * 1024,
  maxAttributeLength: 16 * 1024 * 1024,
  maxPayloadLength: 16 * 1024 * 1024,
  maxTotalPayloadLength: 32 * 1024 * 1024,
  maxIdentifierLength: 1024,
  maxMetadataValueLength: 64 * 1024,
})
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

function createShapeNode(shape, documentRef, limits, state, depth = 0) {
  if (!shape || typeof shape !== 'object' || !shape.tag) {
    throw new TypeError('Geometry item has no renderable SVG payload.')
  }
  if (depth > 128) throw new RangeError('Geometry descriptor is too deeply nested to render safely.')
  state.elements += 1
  if (state.elements > limits.maxElements) {
    throw new RangeError('Geometry descriptor exceeds the safe SVG element limit.')
  }

  const node = documentRef.createElementNS(SVG_NS, shape.tag)
  Object.entries(shape.attrs || {}).forEach(([name, value]) => {
    if (value === undefined || value === null) return
    const text = String(value)
    state.attributeLength += String(name).length + text.length
    if (state.attributeLength > limits.maxAttributeLength) {
      throw new RangeError('Geometry descriptor exceeds the safe SVG attribute limit.')
    }
    node.setAttribute(kebabCase(name), text)
  })
  const children = shape.children === undefined ? [] : shape.children
  if (!Array.isArray(children)) throw new TypeError('Geometry descriptor children must be an array.')
  children.forEach((child) => node.appendChild(createShapeNode(child, documentRef, limits, state, depth + 1)))
  if (shape.text !== undefined) {
    const text = String(shape.text)
    state.textLength += text.length
    if (state.textLength > limits.maxTextLength) {
      throw new RangeError('Geometry descriptor exceeds the safe text limit.')
    }
    node.textContent = text
  }
  return node
}

function assertMarkupElementBudget(source, maxElements) {
  if (/<!DOCTYPE\b/i.test(source)) throw new SyntaxError('SVG geometry must not contain a DOCTYPE.')
  if (!markupFitsSvgElementBudget(source, maxElements)) {
    throw new RangeError('Geometry item SVG payload exceeds the safe element limit.')
  }
}

function measureDomPayload(root, limits) {
  const pending = [{ node: root, depth: 0 }]
  let elements = 0
  let textLength = 0
  let attributeLength = 0

  while (pending.length > 0) {
    const { node, depth } = pending.pop()
    if (depth > 128) throw new RangeError('Geometry item SVG payload is too deeply nested.')
    if (node.nodeType === 1) {
      elements += 1
      if (elements > limits.maxElements) {
        throw new RangeError('Geometry item SVG payload exceeds the safe element limit.')
      }
      Array.from(node.attributes || []).forEach((attribute) => {
        attributeLength += attribute.name.length + attribute.value.length
      })
      if (attributeLength > limits.maxAttributeLength) {
        throw new RangeError('Geometry item SVG payload exceeds the safe attribute limit.')
      }
    } else if (node.nodeType === 3 || node.nodeType === 4) {
      textLength += node.nodeValue ? node.nodeValue.length : 0
      if (textLength > limits.maxTextLength) {
        throw new RangeError('Geometry item SVG payload exceeds the safe text limit.')
      }
    }
    const children = Array.from(node.childNodes || [])
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: children[index], depth: depth + 1 })
    }
  }
}

function stripReservedGeometryNodeAttributes(root) {
  const elements = [root, ...root.querySelectorAll('*')]
  elements.forEach((element) => {
    Array.from(element.attributes || []).forEach((attribute) => {
      if (isReservedGeometryNodeMetadataName(attribute.name)) {
        element.removeAttributeNode(attribute)
      }
    })
  })
}

function parsePayload(payload, documentRef, limits = DEFAULT_RENDER_LIMITS, scopeToken = '') {
  let parsed
  if (typeof payload === 'string') {
    if (payload.trim() === '') throw new TypeError('Geometry item has no renderable SVG payload.')
    if (payload.length > limits.maxPayloadLength) {
      throw new RangeError('Geometry item SVG payload exceeds the safe render limit.')
    }
    assertMarkupElementBudget(payload, limits.maxElements)
    const parser = new DOMParser()
    parsed = parser.parseFromString(`<svg xmlns="${SVG_NS}">${payload}</svg>`, 'image/svg+xml')
    if (parsed.querySelector('parsererror')) {
      throw new SyntaxError(parsed.querySelector('parsererror').textContent || 'Invalid SVG geometry.')
    }
    measureDomPayload(parsed.documentElement, {
      ...limits,
      maxElements: limits.maxElements + 1,
    })
  } else {
    const implementation = documentRef.implementation || document.implementation
    parsed = implementation.createDocument(SVG_NS, 'svg', null)
    if (payload && payload.nodeType === 1) {
      measureDomPayload(payload, limits)
      parsed.documentElement.appendChild(parsed.importNode(payload, true))
    } else if (payload && typeof payload === 'object') {
      const state = { elements: 0, attributeLength: 0, textLength: 0 }
      parsed.documentElement.appendChild(createShapeNode(payload, parsed, limits, state))
    } else {
      throw new TypeError('Geometry item has no renderable SVG payload.')
    }
  }

  // Payload documents remain inert until the complete allowlist pass has
  // removed executable elements, event attributes and external resources.
  sanitizeSvgDocument(parsed, {
    scopeSelector: scopeToken ? `[data-nanquim-style-scope="${scopeToken}"]` : '#Collection',
    maxElements: limits.maxElements + 1,
    maxDepth: 128,
    maxMetadataLength: Math.min(limits.maxTextLength, 1024 * 1024),
  })
  const roots = Array.from(parsed.documentElement.children).map((node) => {
    const imported = documentRef.importNode(node, true)
    stripReservedGeometryNodeAttributes(imported)
    return imported
  })
  if (!scopeToken || !parsed.querySelector('style')) return roots

  // One wrapper makes the scope selector match both top-level payload roots
  // and their descendants. Keeping the scope attribute after Apply preserves
  // the generated stylesheet without allowing it to affect sibling objects.
  const scopeRoot = documentRef.createElementNS(SVG_NS, 'g')
  scopeRoot.setAttribute('data-nanquim-style-scope', scopeToken)
  roots.forEach((root) => scopeRoot.appendChild(root))
  return [scopeRoot]
}

function applyStyleToLeaves(root, style, options = {}) {
  if (!style || Object.keys(style).length === 0) return 0

  const entries = Object.entries(style).flatMap(([rawName, value]) => {
    const name = kebabCase(rawName)
    if (!SAFE_ITEM_STYLE_ATTRIBUTES.has(name) || value === undefined) return []
    if (value === null || value === '') return [{ name, value: null }]
    const safeValue = sanitizeCssValue(String(value))
    return safeValue === null ? [] : [{ name, value: safeValue }]
  })
  if (entries.length === 0) return 0

  const leaves = []
  const pending = [root]
  while (pending.length > 0) {
    const element = pending.pop()
    const isContainer = CONTAINER_TAGS.has(element.localName) && element.children.length > 0
    if (!isContainer) {
      leaves.push(element)
      continue
    }
    const children = Array.from(element.children)
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index])
  }

  let addedLength = 0
  leaves.forEach((element) => {
    entries.forEach(({ name, value }) => {
      if (value === null) return
      const existing = element.getAttribute(name)
      addedLength += name.length + value.length
      if (existing !== null) addedLength -= name.length + existing.length
    })
  })
  if (Number.isFinite(options.maxAddedAttributeLength) && addedLength > options.maxAddedAttributeLength) {
    throw new RangeError('Geometry item style exceeds the safe SVG attribute limit.')
  }

  leaves.forEach((element) => {
    entries.forEach(({ name, value }) => {
      if (value === null) element.removeAttribute(name)
      else element.setAttribute(name, value)
    })
  })
  return addedLength
}

function applyMetadata(root, metadata, limits = DEFAULT_RENDER_LIMITS, maxAddedAttributeLength = Infinity) {
  if (!metadata || typeof metadata !== 'object') return
  const entries = Object.entries(metadata).flatMap(([name, value]) => {
    if (
      !/^data-[a-z0-9_.:-]{1,128}$/i.test(name)
      || isReservedGeometryNodeMetadataName(name)
      || value === undefined
      || value === null
    ) return []
    const text = String(value)
    if (text.length > limits.maxMetadataValueLength) {
      throw new RangeError('Geometry item metadata exceeds the safe value limit.')
    }
    return [{ name, value: text }]
  })
  const addedLength = entries.reduce((total, { name, value }) => {
    const existing = root.getAttribute(name)
    return total + name.length + value.length - (existing === null ? 0 : name.length + existing.length)
  }, 0)
  if (Number.isFinite(maxAddedAttributeLength) && addedLength > maxAddedAttributeLength) {
    throw new RangeError('Geometry item metadata exceeds the safe SVG attribute limit.')
  }
  entries.forEach(({ name, value }) => root.setAttribute(name, value))
  return addedLength
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

function rewriteLocalReference(value, idMap) {
  const source = String(value)
  if (source.startsWith('#') && idMap.has(source.slice(1))) {
    return `#${idMap.get(source.slice(1))}`
  }
  return source.replace(
    /url\(\s*(["']?)#([^\s"'()<>[\]{}\\]+)\1\s*\)/gi,
    (match, quote, id) => idMap.has(id) ? `url(${quote}#${idMap.get(id)}${quote})` : match,
  )
}

/**
 * Give every rendered copy its own internal SVG id namespace. This preserves
 * clip paths, masks, gradients, markers and <use href="#…"> references while
 * preventing array instances from resolving references into a sibling copy.
 */
function remapLocalIds(
  root,
  namespace,
  maxIdentifierLength = DEFAULT_RENDER_LIMITS.maxIdentifierLength,
  maxNamespaceLength = maxIdentifierLength * 3 + 32,
  namespaceDiscriminator = '',
) {
  const elements = [root, ...root.querySelectorAll('*')]
  const idMap = new Map()
  const namespaceText = String(namespace)
  if (namespaceText.length > maxNamespaceLength) {
    throw new RangeError('Geometry item identifier exceeds the safe length limit.')
  }
  const namespaceToken = stableToken(namespaceText)
  const discriminator = String(namespaceDiscriminator)
  if (discriminator && !/^[a-z0-9-]{1,64}$/i.test(discriminator)) {
    throw new TypeError('Geometry item namespace discriminator is invalid.')
  }
  let idIndex = 0

  elements.forEach((element) => {
    const originalId = element.getAttribute('id')
    if (!originalId) return
    if (originalId.length > maxIdentifierLength) {
      throw new RangeError('SVG identifier exceeds the safe length limit.')
    }
    const mappedId = `gnr-${discriminator ? `${discriminator}-` : ''}${namespaceToken}-${idIndex++}`
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
      }
      if (value !== attribute.value) element.setAttribute(attribute.name, value)
    })
    if (element.localName === 'style' && element.textContent) {
      element.textContent = rewriteStyleReferences(element.textContent, idMap)
    }
  })

  return root
}

function markDerived(root, editor, objectId, maxIdentifierLength = DEFAULT_RENDER_LIMITS.maxIdentifierLength) {
  const objectIdText = objectId === undefined || objectId === null ? '' : String(objectId)
  if (objectIdText.length > maxIdentifierLength) {
    throw new RangeError('Geometry object identifier exceeds the safe length limit.')
  }
  const elements = [root, ...root.querySelectorAll('*')]
  elements.forEach((element) => {
    if (!element.hasAttribute('id')) element.setAttribute('id', String(editor.elementIndex++))
    element.setAttribute('data-gn-derived', 'true')
    if (objectIdText) element.setAttribute('data-gn-object-id', objectIdText)
  })
}

function attributeLength(root) {
  return [root, ...root.querySelectorAll('*')].reduce((total, element) => (
    total + Array.from(element.attributes || []).reduce((sum, attribute) => (
      sum + attribute.name.length + attribute.value.length
    ), 0)
  ), 0)
}

function projectedDerivedAttributeLength(root, editor, objectId) {
  const objectIdText = objectId === undefined || objectId === null ? '' : String(objectId)
  const elements = [root, ...root.querySelectorAll('*')]
  let nextId = Number(editor.elementIndex) || 0
  return elements.reduce((total, element) => {
    let added = 'data-gn-derived'.length + 'true'.length
    if (!element.hasAttribute('id')) {
      added += 'id'.length + String(nextId).length
      nextId += 1
    }
    if (objectIdText) added += 'data-gn-object-id'.length + objectIdText.length
    return total + added
  }, 0)
}

function geometryItems(value, maxItems = DEFAULT_RENDER_LIMITS.maxItems) {
  if (value instanceof GeometrySet2D) return value.items
  if (Array.isArray(value)) {
    if (value.length > maxItems) throw new RangeError('Geometry Nodes output exceeds the safe item limit.')
    return value
  }
  if (value && Array.isArray(value.items)) {
    if (value.items.length > maxItems) throw new RangeError('Geometry Nodes output exceeds the safe item limit.')
    return value.items
  }
  return GeometrySet2D.from(value).items
}

/**
 * Renders evaluated pure geometry back into an existing output <g>. Rendering
 * happens in a detached fragment first, so an invalid item never destroys the
 * last known-good output.
 */
class SvgOutputRenderer {
  constructor(editor, options = {}) {
    this.editor = editor
    this.scopeIndex = 0
    this.limits = {
      ...DEFAULT_RENDER_LIMITS,
      ...(options.limits || options),
    }
  }

  render(geometry, output, options = {}) {
    const outputNode = domNode(output)
    if (!outputNode) throw new TypeError('A Geometry Nodes output group is required.')

    const budget = options.budget && typeof options.budget === 'object' ? options.budget : null
    const chargeBudget = (key, amount, message) => {
      if (!budget || !Number.isFinite(budget[key]) || amount <= 0) return
      const remaining = Math.max(0, budget[key])
      if (amount > remaining) {
        budget[key] = 0
        throw new RangeError(message)
      }
      budget[key] = remaining - amount
    }
    const limitFromBudget = (limit, key) => {
      const remaining = budget && Number.isFinite(budget[key]) ? Math.max(0, budget[key]) : limit
      return Math.min(limit, remaining)
    }
    const limits = {
      ...this.limits,
      maxItems: limitFromBudget(this.limits.maxItems, 'remainingItems'),
      maxElements: limitFromBudget(this.limits.maxElements, 'remainingElements'),
      maxTextLength: limitFromBudget(this.limits.maxTextLength, 'remainingTextLength'),
      maxAttributeLength: limitFromBudget(this.limits.maxAttributeLength, 'remainingAttributeLength'),
      maxTotalPayloadLength: limitFromBudget(
        this.limits.maxTotalPayloadLength,
        'remainingPayloadLength',
      ),
    }
    limits.maxPayloadLength = Math.min(limits.maxPayloadLength, limits.maxTotalPayloadLength)
    const documentRef = outputNode.ownerDocument || document
    const fragment = documentRef.createDocumentFragment()
    const initialElementIndex = this.editor.elementIndex
    const items = geometryItems(geometry, this.limits.maxItems)
    const objectId = options.objectId === undefined || options.objectId === null
      ? ''
      : String(options.objectId)
    if (objectId.length > limits.maxIdentifierLength) {
      throw new RangeError('Geometry object identifier exceeds the safe length limit.')
    }
    chargeBudget(
      'remainingItems',
      items.length,
      'Geometry Nodes batch exceeded the safe render-item limit.',
    )
    const attemptedPayloadLength = items.reduce((total, item) => (
      total + (typeof item.svg === 'string' ? item.svg.length : 0)
    ), 0)
    chargeBudget(
      'remainingPayloadLength',
      attemptedPayloadLength,
      'Geometry Nodes batch exceeded the safe SVG payload limit.',
    )
    if (items.length > 0 && budget && Number.isFinite(budget.remainingElements) && budget.remainingElements <= 0) {
      throw new RangeError('Geometry Nodes batch exhausted the safe SVG element budget.')
    }
    if (
      items.length > 0
      && budget
      && Number.isFinite(budget.remainingAttributeLength)
      && budget.remainingAttributeLength <= 0
    ) {
      throw new RangeError('Geometry Nodes batch exhausted the safe SVG attribute budget.')
    }
    let renderedElements = 0
    let renderedTextLength = 0
    let renderedPayloadLength = 0
    let renderedAttributeLength = 0

    try {
      if (items.length > limits.maxItems) {
        throw new RangeError('Geometry Nodes output exceeds the safe item limit.')
      }

      items.forEach((item, itemIndex) => {
        const itemId = item.id === undefined || item.id === null ? itemIndex : String(item.id)
        const sourceId = item.sourceId === undefined || item.sourceId === null ? '' : String(item.sourceId)
        if (String(itemId).length > limits.maxIdentifierLength || sourceId.length > limits.maxIdentifierLength) {
          throw new RangeError('Geometry item identifier exceeds the safe length limit.')
        }
        this.scopeIndex += 1
        const renderScopeToken = `gns-${this.scopeIndex}-${itemIndex}-${stableToken(`${objectId}:${itemId}`)}`
        if (typeof item.svg === 'string') renderedPayloadLength += item.svg.length
        if (renderedPayloadLength > limits.maxTotalPayloadLength) {
          throw new RangeError('Geometry Nodes output exceeds the safe total SVG payload limit.')
        }
        const remainingElements = limits.maxElements - renderedElements
        if (remainingElements < 1) {
          throw new RangeError('Geometry Nodes output exceeds the safe SVG element limit.')
        }
        const matrix = normalizeMatrix(item.matrix || item.transform)
        const roots = parsePayload(item.svg, documentRef, {
          ...limits,
          maxElements: remainingElements,
          maxTextLength: limits.maxTextLength - renderedTextLength,
          maxAttributeLength: limits.maxAttributeLength - renderedAttributeLength,
        }, renderScopeToken)

        roots.forEach((root, rootIndex) => {
          const rootElementCount = 1 + root.querySelectorAll('*').length
          const transformElementCount = isIdentity(matrix) ? 0 : 1
          if (renderedElements + rootElementCount + transformElementCount > limits.maxElements) {
            throw new RangeError('Geometry Nodes output exceeds the safe SVG element limit.')
          }
          const rootTextLength = root.textContent ? root.textContent.length : 0
          if (renderedTextLength + rootTextLength > limits.maxTextLength) {
            throw new RangeError('Geometry Nodes output exceeds the safe text limit.')
          }
          const baseAttributeLength = attributeLength(root)
          chargeBudget(
            'remainingElements',
            rootElementCount + transformElementCount,
            'Geometry Nodes batch exceeded the safe SVG element limit.',
          )
          chargeBudget(
            'remainingTextLength',
            rootTextLength,
            'Geometry Nodes batch exceeded the safe SVG text limit.',
          )
          chargeBudget(
            'remainingAttributeLength',
            baseAttributeLength,
            'Geometry Nodes batch exceeded the safe SVG attribute limit.',
          )

          remapLocalIds(
            root,
            `${objectId || 'object'}:${itemId}:${rootIndex}`,
            limits.maxIdentifierLength,
            limits.maxIdentifierLength * 3 + 32,
            this.scopeIndex.toString(36),
          )
          let currentAttributeLength = attributeLength(root)
          applyMetadata(
            root,
            item.metadata,
            limits,
            limits.maxAttributeLength - renderedAttributeLength - currentAttributeLength,
          )
          if (sourceId) root.setAttribute('data-gn-source-id', sourceId)
          currentAttributeLength = attributeLength(root)
          applyStyleToLeaves(root, item.style || {}, {
            maxAddedAttributeLength: limits.maxAttributeLength
              - renderedAttributeLength
              - currentAttributeLength,
          })

          let renderedRoot = root
          if (!isIdentity(matrix)) {
            const matrixGroup = documentRef.createElementNS(SVG_NS, 'g')
            matrixGroup.setAttribute('transform', `matrix(${matrix.join(' ')})`)
            matrixGroup.appendChild(root)
            renderedRoot = matrixGroup
          }

          const attributeLengthBeforeDerived = attributeLength(renderedRoot)
          const projectedDerivedLength = projectedDerivedAttributeLength(renderedRoot, this.editor, objectId)
          if (
            renderedAttributeLength
            + attributeLengthBeforeDerived
            + projectedDerivedLength
            > limits.maxAttributeLength
          ) {
            throw new RangeError('Geometry Nodes output exceeds the safe SVG attribute limit.')
          }
          markDerived(renderedRoot, this.editor, objectId, limits.maxIdentifierLength)
          const rootAttributeLength = attributeLength(renderedRoot)
          if (renderedAttributeLength + rootAttributeLength > limits.maxAttributeLength) {
            throw new RangeError('Geometry Nodes output exceeds the safe SVG attribute limit.')
          }
          chargeBudget(
            'remainingAttributeLength',
            Math.max(0, rootAttributeLength - baseAttributeLength),
            'Geometry Nodes batch exceeded the safe SVG attribute limit.',
          )
          renderedElements += rootElementCount + transformElementCount
          renderedTextLength += rootTextLength
          renderedAttributeLength += rootAttributeLength
          fragment.appendChild(renderedRoot)
        })
      })
    } catch (error) {
      // Staging is synchronous and detached, so it is safe to return the id
      // counter to its pre-render value on failure.
      this.editor.elementIndex = initialElementIndex
      if (budget) {
        const message = error && error.message ? error.message : ''
        if (/element (?:limit|budget)|too many elements/i.test(message)) budget.remainingElements = 0
        if (/text (?:limit|budget)/i.test(message)) budget.remainingTextLength = 0
        if (/(?:attribute|metadata|style).*(?:limit|budget)/i.test(message)) {
          budget.remainingAttributeLength = 0
        }
      }
      throw error
    }

    outputNode.replaceChildren(fragment)
    return output
  }

  replace(output, geometry, options = {}) {
    return this.render(geometry, output, options)
  }
}

export {
  DEFAULT_RENDER_LIMITS,
  SAFE_ITEM_STYLE_ATTRIBUTES,
  SvgOutputRenderer,
  applyStyleToLeaves,
  normalizeMatrix,
  remapLocalIds,
}
export default SvgOutputRenderer
