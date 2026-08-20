import {
  DOCUMENT_METADATA_LIMITS,
  ELEMENT_DATA_METADATA_LIMITS,
  GEOMETRY_NODES_METADATA_LIMITS,
  assertDocumentSourceSize,
  assertXml10Characters,
  validateBlockDisplayName,
  validateDimensionStyleMetadata,
  validatePaperConfigMetadata,
  validateTextStyleMetadata,
} from './DocumentMetadata'
import { parseSafeJson, sanitizeSvgDocument } from '../utils/sanitizeSvg'
import { assertSerializedGeometryNodes } from '../geometry-nodes/GeometryNodeManager'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const SVGJS_NS = 'http://svgjs.com/svgjs'
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'

const DOCUMENT_SCHEMA_VERSION = 3
const MAX_EDITOR_ELEMENT_ID = 1000000000
const MAX_VIEWBOX_MAGNITUDE = 1000000000
const MAX_PAPER_VIEWPORTS = 256
const MAX_PAPER_COORDINATE = 1000000
const MAX_PAPER_ORIGIN = 1000000000
const MAX_PAPER_SCALE = 1000000000
const MIN_POSITIVE_PAPER_VALUE = 0.000001
const INVALID_VIEWPORT_ID = /[\s\u0000-\u001f\u007f#()"']/
const GEOMETRY_NODES_METADATA_ID = 'nanquim-geometry-nodes'
const ROOT_SEMANTICS_ATTRIBUTE = 'data-nanquim-root-semantics'

const SEMANTIC_DATA_ATTRIBUTES = Object.freeze([
  ['arcData', 'data-arc-data'],
  ['circleTrimData', 'data-circle-trim-data'],
  ['ellipseArcData', 'data-ellipse-arc-data'],
  ['hatchData', 'data-hatch-data'],
  ['splineData', 'data-spline-data'],
])

const TRANSIENT_NODE_SELECTOR = [
  '[data-nanquim-transient="true"]',
  '[data-block-edit="true"]',
  '[data-block-ghost="true"]',
  '[data-rectangle-preview="true"]',
  '.ghostLine',
  '.mirror-axis-helper',
  '.measure-ghost',
  '.measure-ghost-group',
  '.selectionRectangle',
  '.selection-handler',
  '.vertex-handler',
  '.vp-handle',
].join(',')

const TRANSIENT_CLASSES = Object.freeze([
  'elementHover',
  'elementSelected',
  'block-edit-active',
  'handlers-editing',
])

const PAPER_ANNOTATION_STYLE = Object.freeze({
  stroke: 'black',
  'stroke-width': 0.1,
  'stroke-linecap': 'round',
  fill: 'transparent',
})

function domNode(value) {
  return value && (value.node || value)
}

function requireElement(value, label) {
  const node = domNode(value)
  if (!node || node.nodeType !== 1) throw new TypeError(`${label} is required.`)
  return node
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`)
  }
  return Object.is(value, -0) ? 0 : value
}

function boundedNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  const number = finiteNumber(value, label)
  if (number < min || number > max) {
    throw new TypeError(`${label} is outside the supported range.`)
  }
  return number
}

function stringifyMetadata(value, label) {
  let output
  try {
    output = JSON.stringify(value, (_key, candidate) => {
      if (typeof candidate === 'number' && !Number.isFinite(candidate)) {
        throw new TypeError(`${label} contains a non-finite number.`)
      }
      if (typeof candidate === 'bigint') {
        throw new TypeError(`${label} contains an unsupported bigint.`)
      }
      return candidate
    })
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith(label)) throw error
    throw new TypeError(`${label} is not serializable.`, { cause: error })
  }
  if (output === undefined) throw new TypeError(`${label} is not serializable.`)
  return output
}

function stringifyBoundedMetadata(value, label, limitsOrAttribute) {
  const output = stringifyMetadata(value, label)
  const limits = typeof limitsOrAttribute === 'string'
    ? DOCUMENT_METADATA_LIMITS[limitsOrAttribute]
    : limitsOrAttribute
  if (!limits || parseSafeJson(output, limits) === null) {
    throw new TypeError(`${label} exceeds the supported metadata limits.`)
  }
  return output
}

function readViewBox(editor) {
  let viewBox
  if (editor.svg && typeof editor.svg.viewbox === 'function') {
    const source = editor.svg.viewbox()
    viewBox = {
      x: source.x,
      y: source.y,
      width: source.width,
      height: source.height,
    }
  } else {
    const svgNode = requireElement(editor.svg, 'Editor SVG')
    const parts = String(svgNode.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
      throw new TypeError('Editor SVG requires a finite viewBox.')
    }
    viewBox = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
  }

  return {
    x: boundedNumber(viewBox.x, 'ViewBox x', {
      min: -MAX_VIEWBOX_MAGNITUDE,
      max: MAX_VIEWBOX_MAGNITUDE,
    }),
    y: boundedNumber(viewBox.y, 'ViewBox y', {
      min: -MAX_VIEWBOX_MAGNITUDE,
      max: MAX_VIEWBOX_MAGNITUDE,
    }),
    width: boundedNumber(viewBox.width, 'ViewBox width', {
      min: 0,
      max: MAX_VIEWBOX_MAGNITUDE,
    }),
    height: boundedNumber(viewBox.height, 'ViewBox height', {
      min: 0,
      max: MAX_VIEWBOX_MAGNITUDE,
    }),
  }
}

function semanticAttributeIdentity(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function parseSemanticAttribute(value) {
  try {
    return JSON.parse(value)
  } catch (_error) {
    return value
  }
}

function readSemanticData(source, key) {
  const instance = source.instance
  if (instance && typeof instance.data === 'function') {
    try {
      const value = instance.data(key)
      if (value !== undefined && value !== null) return value
    } catch (_error) {
      // Fall through to the DOM attribute. Imported nodes need not have a
      // compatible SVG.js instance attached to them.
    }
  }

  const identity = `data${key.toLowerCase()}`
  const attribute = Array.from(source.attributes || []).find(
    (candidate) => semanticAttributeIdentity(candidate.name) === identity,
  )
  return attribute ? parseSemanticAttribute(attribute.value) : undefined
}

function canonicalizeSemanticData(source, clone) {
  SEMANTIC_DATA_ATTRIBUTES.forEach(([key, attributeName]) => {
    const identity = `data${key.toLowerCase()}`
    Array.from(clone.attributes || []).forEach((attribute) => {
      if (semanticAttributeIdentity(attribute.name) === identity) {
        clone.removeAttributeNode(attribute)
      }
    })

    const value = readSemanticData(source, key)
    if (value !== undefined && value !== null) {
      clone.setAttribute(
        attributeName,
        stringifyBoundedMetadata(value, key, ELEMENT_DATA_METADATA_LIMITS),
      )
    }
  })
}

function synchronizeSemanticData(sourceRoot, cloneRoot) {
  const sources = [sourceRoot, ...sourceRoot.querySelectorAll('*')]
  const clones = [cloneRoot, ...cloneRoot.querySelectorAll('*')]
  if (sources.length !== clones.length) {
    throw new TypeError('The cloned SVG tree does not match its source.')
  }
  sources.forEach((source, index) => canonicalizeSemanticData(source, clones[index]))
}

function removeEmptyClass(element) {
  if (!element.getAttribute('class')?.trim()) element.removeAttribute('class')
}

function restoreUnmappedColor(element, property) {
  const marker = `data-nanquim-orig-${property}`
  if (!element.hasAttribute(marker)) return

  const original = element.getAttribute(marker)
  if (original) element.style.setProperty(property, original)
  else element.style.removeProperty(property)
  element.removeAttribute(marker)
  if (!element.getAttribute('style')?.trim()) element.removeAttribute('style')
}

function cleanPersistentElement(element) {
  TRANSIENT_CLASSES.forEach((className) => element.classList.remove(className))
  removeEmptyClass(element)
  element.removeAttribute('aria-activedescendant')
  element.removeAttribute('aria-selected')
  element.removeAttribute('data-collapsed')
  element.removeAttribute('selected')
  element.removeAttributeNS(SVGJS_NS, 'data')
  restoreUnmappedColor(element, 'stroke')
  restoreUnmappedColor(element, 'fill')

  if (
    element.hasAttribute('data-block-name')
    && !validateBlockDisplayName(element.getAttribute('data-block-name'))
  ) {
    throw new TypeError('Block display names must be 1-256 printable characters.')
  }

  Array.from(element.attributes).forEach((attribute) => {
    if (!attribute.name.startsWith('data-') || !/^\s*[{[]/.test(attribute.value)) return
    if (parseSafeJson(attribute.value, ELEMENT_DATA_METADATA_LIMITS) === null) {
      throw new TypeError(`${attribute.name} exceeds the supported element metadata limits.`)
    }
  })
}

function rebaseStyleSheetForStandalone(source) {
  return String(source).replace(/([^{}]+)\{([^{}]*)\}/g, (_rule, selectorText, declarationText) => {
    const selectors = selectorText.replace(
      /(^|,)(\s*)#Collection(?=$|\s+|\s*>)/g,
      (_match, prefix, whitespace) => `${prefix}${whitespace}svg`,
    )
    return `${selectors}{${declarationText}}`
  })
}

function rebasePersistentStyles(root) {
  const styles = root.localName.toLowerCase() === 'style'
    ? [root]
    : Array.from(root.querySelectorAll('style'))
  styles.forEach((style) => {
    style.textContent = rebaseStyleSheetForStandalone(style.textContent)
  })
}

function isTransientNode(element) {
  return typeof element.matches === 'function' && element.matches(TRANSIENT_NODE_SELECTOR)
}

function cleanPersistentTree(root) {
  Array.from(root.querySelectorAll(TRANSIENT_NODE_SELECTOR)).forEach((node) => node.remove())
  ;[root, ...root.querySelectorAll('*')].forEach(cleanPersistentElement)
}

function clonePersistentSubtree(source, targetDocument) {
  if (isTransientNode(source)) return null
  const clone = targetDocument.importNode(source, true)
  synchronizeSemanticData(source, clone)
  cleanPersistentTree(clone)
  rebasePersistentStyles(clone)
  return clone
}

function applyCollectionState(editor, source, clone) {
  if (clone.getAttribute('data-collection') !== 'true') return
  const id = source.getAttribute('id')
  const collection = editor.collections instanceof Map ? editor.collections.get(id) : null
  if (!collection) return

  clone.setAttribute('data-locked', collection.locked ? 'true' : 'false')
  if (collection.visible === false) clone.style.setProperty('display', 'none')
  else clone.style.removeProperty('display')

  Object.entries(collection.style || {}).forEach(([property, value]) => {
    if (value === undefined || value === null || value === '') clone.style.removeProperty(property)
    else clone.style.setProperty(property, String(value))
  })
  if (!clone.getAttribute('style')?.trim()) clone.removeAttribute('style')
}

function appendDefinitionNode(source, outputDefs, targetDocument, inheritedOwnership = false) {
  if (source.getAttribute('data-nanquim-import-assets') === 'true') {
    Array.from(source.children).forEach((child) => {
      appendDefinitionNode(child, outputDefs, targetDocument, true)
    })
    return
  }

  if (
    !inheritedOwnership
    && source.getAttribute(ROOT_SEMANTICS_ATTRIBUTE) === 'true'
  ) return

  const documentOwned = inheritedOwnership
    || source.getAttribute('data-block-def') === 'true'
    || source.getAttribute('data-nanquim-document-def') === 'true'
  if (!documentOwned) return

  const clone = clonePersistentSubtree(source, targetDocument)
  if (clone) outputDefs.appendChild(clone)
}

function appendRootSemanticContent(editor, root, targetDocument) {
  const svgNode = requireElement(editor.svg, 'Editor SVG')
  const sourceDefs = Array.from(svgNode.children).filter(
    (child) => child.namespaceURI === SVG_NS && child.localName.toLowerCase() === 'defs',
  )

  sourceDefs.forEach((defs) => {
    Array.from(defs.children).forEach((container) => {
      if (container.getAttribute(ROOT_SEMANTICS_ATTRIBUTE) !== 'true') return
      Array.from(container.children).forEach((source) => {
        if (source.namespaceURI !== SVG_NS) return
        const name = source.localName.toLowerCase()
        if (!['title', 'desc', 'metadata'].includes(name)) return
        if (name === 'metadata' && source.getAttribute('id') === GEOMETRY_NODES_METADATA_ID) return
        const clone = clonePersistentSubtree(source, targetDocument)
        if (clone) root.appendChild(clone)
      })
    })
  })
}

function appendDefinitions(editor, root, targetDocument) {
  const svgNode = requireElement(editor.svg, 'Editor SVG')
  const sourceDefs = Array.from(svgNode.children).filter(
    (child) => child.namespaceURI === SVG_NS && child.localName.toLowerCase() === 'defs',
  )
  if (sourceDefs.length === 0) return

  const outputDefs = targetDocument.createElementNS(SVG_NS, 'defs')
  sourceDefs.forEach((defs) => {
    Array.from(defs.children).forEach((child) => {
      appendDefinitionNode(child, outputDefs, targetDocument)
    })
  })
  if (outputDefs.children.length > 0) root.appendChild(outputDefs)
}

function createPaperAnnotations(editor, targetDocument) {
  const source = domNode(editor.paperAnnotations)
  let annotations = source && source.nodeType === 1
    ? clonePersistentSubtree(source, targetDocument)
    : null

  if (!annotations) {
    annotations = targetDocument.createElementNS(SVG_NS, 'g')
    annotations.setAttribute('id', 'paper-annotations')
    annotations.setAttribute('name', 'Annotations')
    Object.entries(PAPER_ANNOTATION_STYLE).forEach(([property, value]) => {
      annotations.style.setProperty(property, String(value))
    })
  }

  annotations.setAttribute('data-nanquim-paper-annotations', 'true')
  annotations.setAttribute('data-collection', 'true')
  if (!annotations.getAttribute('id')) annotations.setAttribute('id', 'paper-annotations')
  if (!annotations.getAttribute('name')) annotations.setAttribute('name', 'Annotations')

  const collectionSource = source || annotations
  applyCollectionState(editor, collectionSource, annotations)
  if (!annotations.hasAttribute('data-locked')) annotations.setAttribute('data-locked', 'false')
  return annotations
}

function viewportSnapshot(viewport, index) {
  if (!viewport || typeof viewport !== 'object') {
    throw new TypeError(`Paper viewport ${index + 1} is invalid.`)
  }
  const id = viewport.id
  if (
    typeof id !== 'string'
    || !id
    || id.length > 256
    || INVALID_VIEWPORT_ID.test(id)
  ) {
    throw new TypeError(`Paper viewport ${index + 1} has an invalid id.`)
  }
  return {
    id,
    x: boundedNumber(viewport.x, `Paper viewport ${id} x`, {
      min: -MAX_PAPER_COORDINATE,
      max: MAX_PAPER_COORDINATE,
    }),
    y: boundedNumber(viewport.y, `Paper viewport ${id} y`, {
      min: -MAX_PAPER_COORDINATE,
      max: MAX_PAPER_COORDINATE,
    }),
    w: boundedNumber(viewport.w, `Paper viewport ${id} width`, {
      min: MIN_POSITIVE_PAPER_VALUE,
      max: MAX_PAPER_COORDINATE,
    }),
    h: boundedNumber(viewport.h, `Paper viewport ${id} height`, {
      min: MIN_POSITIVE_PAPER_VALUE,
      max: MAX_PAPER_COORDINATE,
    }),
    scale: boundedNumber(viewport.scale, `Paper viewport ${id} scale`, {
      min: MIN_POSITIVE_PAPER_VALUE,
      max: MAX_PAPER_SCALE,
    }),
    modelOriginX: boundedNumber(viewport.modelOriginX, `Paper viewport ${id} model origin x`, {
      min: -MAX_PAPER_ORIGIN,
      max: MAX_PAPER_ORIGIN,
    }),
    modelOriginY: boundedNumber(viewport.modelOriginY, `Paper viewport ${id} model origin y`, {
      min: -MAX_PAPER_ORIGIN,
      max: MAX_PAPER_ORIGIN,
    }),
    visible: viewport.visible !== false,
    locked: viewport.locked === true,
  }
}

function paperViewportSnapshots(value) {
  if (value !== undefined && value !== null && !Array.isArray(value)) {
    throw new TypeError('Paper viewports must be an array.')
  }
  const viewports = value || []
  if (viewports.length > MAX_PAPER_VIEWPORTS) {
    throw new TypeError(`Paper viewports cannot exceed ${MAX_PAPER_VIEWPORTS} entries.`)
  }
  const snapshots = viewports.map(viewportSnapshot)
  const ids = new Set()
  snapshots.forEach(({ id }) => {
    if (ids.has(id)) throw new TypeError(`Paper viewport id "${id}" is duplicated.`)
    ids.add(id)
  })
  return snapshots
}

function paperConfiguration(value) {
  const result = validatePaperConfigMetadata(value)
  if (!result.value || result.recovered) {
    throw new TypeError('Paper configuration contains invalid or non-canonical state.')
  }
  return result.value
}

function managerMetadata(manager, label, validate) {
  if (!manager || typeof manager.toJSON !== 'function') {
    throw new TypeError(`${label} is required.`)
  }
  const result = validate(manager.toJSON())
  if (!result.value || result.recovered) {
    throw new TypeError(`${label} contains invalid or non-canonical state.`)
  }
  return result.value
}

function appendGeometryNodesMetadata(editor, root, targetDocument) {
  if (!editor.geometryNodes || typeof editor.geometryNodes.serialize !== 'function') return
  const serialized = editor.geometryNodes.serialize()
  if (serialized === null || serialized === undefined) return
  const data = serialized && typeof serialized === 'object' && !Array.isArray(serialized)
    ? { ...serialized }
    : serialized
  if (data && typeof data === 'object' && !Array.isArray(data)) delete data.activeObjectId
  assertSerializedGeometryNodes(data)

  const metadata = targetDocument.createElementNS(SVG_NS, 'metadata')
  metadata.setAttribute('id', GEOMETRY_NODES_METADATA_ID)
  metadata.textContent = stringifyBoundedMetadata(
    data,
    'Geometry Nodes metadata',
    GEOMETRY_NODES_METADATA_LIMITS,
  )
  root.appendChild(metadata)
}

function appendModelContent(editor, root, targetDocument) {
  const drawing = requireElement(editor.drawing, 'Editor drawing')
  Array.from(drawing.children).forEach((source) => {
    const clone = clonePersistentSubtree(source, targetDocument)
    if (!clone) return
    applyCollectionState(editor, source, clone)
    root.appendChild(clone)
  })
}

function activeModelCollectionId(editor) {
  const drawing = domNode(editor.drawing)
  let active = domNode(editor.activeCollection)
  if (drawing && (!active || !drawing.contains(active))) {
    active = domNode(editor.paperEditor?.getActiveModelCollection?.())
  }
  if (!drawing || !active || !drawing.contains(active)) return null
  if (active.getAttribute('data-collection') !== 'true') return null
  return active.getAttribute('id') || null
}

function assertValidXmlTree(root) {
  const elements = [root, ...root.querySelectorAll('*')]
  elements.forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      assertXml10Characters(attribute.value, `SVG attribute ${attribute.name}`)
    })
    Array.from(element.childNodes).forEach((node) => {
      if (node.nodeType === 3 || node.nodeType === 4) {
        assertXml10Characters(node.nodeValue || '', 'SVG text')
      }
    })
  })
}

function buildNativeDocument(editor) {
  if (!editor || typeof editor !== 'object') throw new TypeError('Editor is required.')
  if (
    editor.isDrawing
    || editor.isInteracting
    || editor.isEditingVertex
    || editor.isTypingText
    || editor.editingBlock
  ) {
    throw new Error('Finish or cancel the active command before saving.')
  }

  const targetDocument = document.implementation.createDocument(SVG_NS, 'svg', null)
  const root = targetDocument.documentElement
  root.setAttributeNS(XMLNS_NS, 'xmlns:xlink', XLINK_NS)
  root.setAttributeNS(XMLNS_NS, 'xmlns:svgjs', SVGJS_NS)

  const viewBox = readViewBox(editor)
  root.setAttribute('viewBox', [viewBox.x, viewBox.y, viewBox.width, viewBox.height].join(' '))
  root.setAttribute('data-nanquim-version', String(DOCUMENT_SCHEMA_VERSION))

  if (
    !Number.isSafeInteger(editor.elementIndex)
    || editor.elementIndex < 0
    || editor.elementIndex > MAX_EDITOR_ELEMENT_ID
  ) {
    throw new TypeError(`Editor element index must be between 0 and ${MAX_EDITOR_ELEMENT_ID}.`)
  }
  root.setAttribute('data-element-index', String(editor.elementIndex))
  root.setAttribute(
    'data-paper-config',
    stringifyBoundedMetadata(
      paperConfiguration(editor.paperConfig),
      'Paper configuration',
      'data-paper-config',
    ),
  )
  root.setAttribute(
    'data-paper-viewports',
    stringifyBoundedMetadata(
      paperViewportSnapshots(editor.paperViewports),
      'Paper viewports',
      'data-paper-viewports',
    ),
  )
  root.setAttribute(
    'data-dim-styles',
    stringifyBoundedMetadata(
      managerMetadata(
        editor.dimensionManager,
        'Dimension style manager',
        validateDimensionStyleMetadata,
      ),
      'Dimension styles',
      'data-dim-styles',
    ),
  )
  root.setAttribute(
    'data-text-styles',
    stringifyBoundedMetadata(
      managerMetadata(
        editor.textStyleManager,
        'Text style manager',
        validateTextStyleMetadata,
      ),
      'Text styles',
      'data-text-styles',
    ),
  )
  const blockDefinitions = editor.blockDefinitions instanceof Map
    ? Array.from(editor.blockDefinitions.entries())
    : []
  blockDefinitions.forEach(([name]) => {
    if (!validateBlockDisplayName(name)) {
      throw new TypeError('Block display names must be 1-256 printable characters.')
    }
  })
  root.setAttribute(
    'data-block-definitions',
    stringifyBoundedMetadata(
      blockDefinitions,
      'Block definitions',
      'data-block-definitions',
    ),
  )
  root.setAttribute('data-nanquim-converted-strokes', 'false')

  const activeCollectionId = activeModelCollectionId(editor)
  if (activeCollectionId) root.setAttribute('data-active-collection-id', activeCollectionId)

  appendRootSemanticContent(editor, root, targetDocument)
  appendGeometryNodesMetadata(editor, root, targetDocument)
  appendDefinitions(editor, root, targetDocument)
  root.appendChild(createPaperAnnotations(editor, targetDocument))
  appendModelContent(editor, root, targetDocument)

  assertValidXmlTree(root)

  const sanitization = {}
  sanitizeSvgDocument(targetDocument, {
    deferStyleScoping: true,
    report: sanitization,
  })
  if (sanitization.changed) {
    throw new TypeError('The editable document contains unsafe or unsupported SVG content.')
  }
  return targetDocument
}

function serializeNativeDocument(editor) {
  const documentRef = buildNativeDocument(editor)
  const serialized = new XMLSerializer().serializeToString(documentRef.documentElement)
  return assertDocumentSourceSize(
    `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}\n`,
  )
}

export {
  DOCUMENT_SCHEMA_VERSION,
  buildNativeDocument,
  serializeNativeDocument,
}
