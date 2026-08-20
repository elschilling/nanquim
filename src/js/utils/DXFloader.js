import { SVG } from '@svgdotjs/svg.js'
import { rebuildCollectionsFromDOM } from '../Collection'
import { bakeTransforms } from './transformGeometry'
import {
  discardBlockEdit,
  rebuildBlockDefinitionsFromDOM,
} from '../BlockManager'
import { DimensionManager } from '../DimensionManager'
import { TextStyleManager } from '../TextStyleManager'
import {
  GeometryNodeManager,
  assertSerializedGeometryNodes,
} from '../geometry-nodes/GeometryNodeManager'
import {
  DOCUMENT_METADATA_LIMITS,
  DocumentOpenError,
  prepareDocumentFile,
  prepareDocumentSource,
} from '../document/DocumentParser'
import {
  ELEMENT_DATA_METADATA_LIMITS,
  GEOMETRY_NODES_METADATA_LIMITS,
  NATIVE_STYLE_METADATA_LIMITS,
  validateDimensionStyleMetadata,
  validateBlockDisplayName,
  validatePaperConfigMetadata,
  validateTextStyleMetadata,
} from '../document/DocumentMetadata'
import {
  markupFitsSvgElementBudget,
  parseSafeJson,
  remapSvgIds,
  scopeSvgStyleElements,
} from './sanitizeSvg'

const MAX_SVG_IMPORT_BYTES = 64 * 1024 * 1024
const MAX_SVG_IMPORT_ELEMENTS = 100000
const MAX_EDITOR_ELEMENT_ID = 1000000000
const SAFE_BLOCK_NAME = /^[^\s"'()<>[\]{}\\#]{1,256}$/
const DISCARDED_TOP_LEVEL_IMPORT_ELEMENTS = new Set(['defs', 'metadata', 'title', 'desc', 'script'])
const GEOMETRY_NODES_METADATA_ID = 'nanquim-geometry-nodes'
const ROOT_SEMANTICS_ATTRIBUTE = 'data-nanquim-root-semantics'
const ROOT_SEMANTIC_ELEMENTS = new Set(['title', 'desc', 'metadata'])

function markupFitsSvgImportElementBudget(source, maxElements = MAX_SVG_IMPORT_ELEMENTS) {
  return markupFitsSvgElementBudget(source, maxElements)
}

function _finiteNumber(value, { min = -Infinity, max = Infinity } = {}) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null
}

function _boundedText(value, maxLength) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) return null
  return text
}

function _paperViewportsMetadata(value) {
  if (!Array.isArray(value) || value.length > 256) return null
  const viewports = []
  const ids = new Set()
  for (const viewport of value) {
    if (!viewport || typeof viewport !== 'object' || Array.isArray(viewport)) return null
    const x = _finiteNumber(viewport.x, { min: -1000000, max: 1000000 })
    const y = _finiteNumber(viewport.y, { min: -1000000, max: 1000000 })
    const w = _finiteNumber(viewport.w, { min: 0.000001, max: 1000000 })
    const h = _finiteNumber(viewport.h, { min: 0.000001, max: 1000000 })
    const scale = _finiteNumber(viewport.scale, { min: 0.000001, max: 1000000000 })
    const modelOriginX = _finiteNumber(viewport.modelOriginX, { min: -1000000000, max: 1000000000 })
    const modelOriginY = _finiteNumber(viewport.modelOriginY, { min: -1000000000, max: 1000000000 })
    if ([x, y, w, h, scale, modelOriginX, modelOriginY].some((entry) => entry === null)) return null
    const requestedId = viewport.id === undefined || viewport.id === null || viewport.id === ''
      ? `vp-${viewports.length + 1}`
      : typeof viewport.id === 'string'
        && viewport.id.length <= 256
        && !/[\s\u0000-\u001f\u007f#()"']/.test(viewport.id)
          ? viewport.id
          : null
    if (!requestedId || ids.has(requestedId)) return null
    ids.add(requestedId)
    viewports.push({
      id: requestedId,
      x,
      y,
      w,
      h,
      scale,
      modelOriginX,
      modelOriginY,
      visible: viewport.visible !== false,
      locked: viewport.locked === true,
    })
  }
  return viewports
}

function _rejectImport(editor, reason) {
  if (editor.signals && editor.signals.terminalLogged) {
    editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Failed to open SVG: ${reason}` })
  }
}

function _importDefinitionChildren(sourceDefs, destination) {
  Array.from(sourceDefs.children).forEach((child) => {
    destination.appendChild(document.importNode(child, true))
  })
}

function _retainedLiveIds(editor, { excludeDefinitions = false } = {}) {
  const svgNode = editor.svg && editor.svg.node
  const drawingNode = editor.drawing && editor.drawing.node
  const defsNode = editor.svg && editor.svg.defs && editor.svg.defs().node
  const ids = new Set()
  if (!svgNode) return ids

  ;[svgNode, ...svgNode.querySelectorAll('[id]')].forEach((node) => {
    if (!node.id) return
    if (drawingNode && node !== drawingNode && drawingNode.contains(node)) return
    if (excludeDefinitions && defsNode && (node === defsNode || defsNode.contains(node))) return
    if (node.closest && node.closest('[data-nanquim-import-assets="true"]')) return
    if (node.closest && node.closest('[data-block-def="true"]')) return
    if (node.closest && node.closest('[data-nanquim-document-def="true"]')) return
    ids.add(node.id)
  })
  return ids
}

/**
 * Give every imported SVG target a collision-free identity while the document
 * is still inert. Ordinary geometry and definition children receive numeric
 * editor IDs, so the later hydration pass becomes a no-op. Block definition
 * IDs remain in BlockManager's `block-*` namespace and their instances are
 * updated together. Missing local references are redirected to a guaranteed
 * dangling ID instead of resolving into the host SVG (notably #Collection).
 */
function prepareSanitizedSvgForImport(svgRoot, editor, {
  reserveForeignCollection = false,
  preserveIds = false,
  freshDocument = false,
  initialElementIndex,
} = {}) {
  if (!svgRoot || svgRoot.nodeType !== 1) throw new TypeError('A sanitized SVG root is required.')

  const elements = [svgRoot, ...svgRoot.querySelectorAll('*')]
  const retainedRootSemantics = new Set()
  if (preserveIds) {
    Array.from(svgRoot.children).forEach((element) => {
      const name = element.localName.toLowerCase()
      if (!ROOT_SEMANTIC_ELEMENTS.has(name)) return
      if (name === 'metadata' && element.getAttribute('id') === GEOMETRY_NODES_METADATA_ID) return
      retainedRootSemantics.add(element)
      element.querySelectorAll('*').forEach(child => retainedRootSemantics.add(child))
    })
  }
  const idlessRootSemantics = new Set(
    Array.from(retainedRootSemantics).filter(element => !element.hasAttribute('id')),
  )
  const reservedIds = _retainedLiveIds(editor, { excludeDefinitions: freshDocument })
  const originalIds = new Set(
    elements.map(element => element.getAttribute('id')).filter(Boolean),
  )
  const plannedIds = new Set()
  const blockPlans = new Map()
  const blockNames = new Map()
  let recoveredBlockNames = false
  let blockIndex = 0

  elements.filter((element) => element.getAttribute('data-block-def') === 'true').forEach((element) => {
    const originalId = element.getAttribute('id') || ''
    const hasExplicitName = element.hasAttribute('data-block-name')
    const explicitName = element.getAttribute('data-block-name')
    const originalName = explicitName || (originalId.startsWith('block-')
      ? originalId.slice('block-'.length)
      : originalId)
    if (originalName && blockNames.has(originalName)) {
      throw new TypeError(`Duplicate imported block definition: ${originalName}`)
    }

    blockIndex += 1
    const preserveDisplayName = preserveIds && validateBlockDisplayName(explicitName)
    if (preserveIds && hasExplicitName && !preserveDisplayName) recoveredBlockNames = true
    const baseName = preserveDisplayName || (SAFE_BLOCK_NAME.test(originalName)
      ? originalName
      : `imported-${blockIndex}`)
    let name = baseName
    let id = preserveIds && SAFE_BLOCK_NAME.test(originalId)
      ? originalId
      : `block-${name}`
    let collisionIndex = 1
    while (reservedIds.has(id) || plannedIds.has(id)) {
      if (!preserveDisplayName) name = `${baseName}-imported-${collisionIndex}`
      id = preserveIds
        ? `block-def-imported-${blockIndex}-${collisionIndex}`
        : `block-${name}`
      collisionIndex += 1
    }
    plannedIds.add(id)
    blockPlans.set(element, { id, name, originalName })
    if (originalName) blockNames.set(originalName, { id, name })
  })

  let nextElementIndex = Number.isSafeInteger(initialElementIndex) && initialElementIndex >= 0
    ? initialElementIndex
    : Number.isSafeInteger(editor.elementIndex) && editor.elementIndex >= 0
      ? editor.elementIndex
      : 0
  const allocateNumericId = () => {
    let id
    do {
      if (nextElementIndex > MAX_EDITOR_ELEMENT_ID) {
        throw new RangeError('The imported SVG exhausts the safe editor ID range.')
      }
      id = String(nextElementIndex++)
    } while (
      reservedIds.has(id)
      || plannedIds.has(id)
      || (preserveIds && originalIds.has(id))
    )
    plannedIds.add(id)
    return id
  }

  let structuralIndex = 0
  const allocateStructuralId = () => {
    let id
    do {
      id = `nanquim-import-structure-${structuralIndex++}`
    } while (reservedIds.has(id) || plannedIds.has(id) || originalIds.has(id))
    plannedIds.add(id)
    return id
  }

  const isDiscardedImportStructure = (element) => (
    element === svgRoot
    || (
      element.parentElement === svgRoot
      && DISCARDED_TOP_LEVEL_IMPORT_ELEMENTS.has(element.localName.toLowerCase())
      && !retainedRootSemantics.has(element)
    )
  )

  let danglingIndex = 0
  let danglingId
  do {
    danglingId = `nanquim-unresolved-import-${nextElementIndex}-${danglingIndex++}`
  } while (reservedIds.has(danglingId) || plannedIds.has(danglingId) || originalIds.has(danglingId))

  const allocateImportedId = (element, originalId) => {
    if (idlessRootSemantics.has(element)) return allocateStructuralId()
    if (isDiscardedImportStructure(element)) return allocateStructuralId()
    const blockId = blockPlans.get(element)?.id
    if (blockId) return blockId
    if (
      preserveIds
      && SAFE_BLOCK_NAME.test(originalId || '')
      && !reservedIds.has(originalId)
      && !plannedIds.has(originalId)
    ) {
      plannedIds.add(originalId)
      return originalId
    }
    return allocateNumericId()
  }

  const idMap = remapSvgIds(
    [svgRoot],
    allocateImportedId,
    { danglingId, rewriteMetadataUrls: true },
  )
  idlessRootSemantics.forEach(element => element.removeAttribute('id'))

  elements.forEach((element) => {
    element.removeAttribute('data-nanquim-preserve-id')
    const originalBlockName = element.getAttribute('data-block-name')
    const blockPlan = originalBlockName && blockNames.get(originalBlockName)
    if (!blockPlan) return
    element.setAttribute('data-block-name', blockPlan.name)
    if (element.localName.toLowerCase() === 'use' || element.getAttribute('data-block-instance') === 'true') {
      element.setAttribute('href', `#${blockPlan.id}`)
    }
  })

  const foreignCollectionId = reserveForeignCollection ? allocateNumericId() : null
  blockPlans.forEach((plan, element) => {
    element.setAttribute('data-block-name', plan.name)
  })
  return {
    danglingId,
    foreignCollectionId,
    idMap,
    nextElementIndex,
    recoveredBlockNames,
  }
}


const DEFAULT_GEOMETRY_NODES = Object.freeze({ version: 1, graphs: [], instances: [] })
const NON_GEOMETRY = new Set(['defs', 'style', 'metadata', 'title', 'desc', 'script'])

function _noopSignal() {
  return { add() {}, addOnce() {}, dispatch() {}, remove() {} }
}

function _createStagingEditor() {
  const svg = SVG()
  const stage = {
    svg,
    drawing: svg.group().attr('id', 'Collection'),
    signals: new Proxy({}, { get: () => _noopSignal() }),
    elementIndex: 0,
    collectionIndex: 0,
    collections: new Map(),
    blockDefinitions: new Map(),
    selected: [],
    mode: 'model',
    spatialIndex: { markDirty() {}, rebuild() {} },
    fullSpatialIndex: { markDirty() {}, rebuild() {} },
    paperConfig: {
      size: 'A4',
      width: 210,
      height: 297,
      orientation: 'portrait',
      unitsPerCm: 1,
      colorMap: {},
    },
    documentState: {
      markChanged() {},
      runWithoutTracking(callback) { return callback() },
    },
  }
  stage.dimensionManager = new DimensionManager(stage)
  stage.textStyleManager = new TextStyleManager(stage)
  stage.geometryNodes = new GeometryNodeManager(stage)
  stage.execute = (command) => command.execute()
  return stage
}

function _documentDiagnostic(code, message) {
  return Object.freeze({ level: 'warning', code, message })
}

function _restoreConvertedStrokes(root) {
  ;[root, ...root.querySelectorAll('*')].forEach((node) => {
    for (const attributeName of ['stroke', 'fill']) {
      const value = node.getAttribute(attributeName) || ''
      if (/^(?:#000(?:000)?|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))$/i.test(value)) {
        node.setAttribute(attributeName, '#ffffff')
      }
    }
    const style = node.getAttribute('style')
    if (!style) return
    node.setAttribute('style', style.replace(
      /(stroke|fill)\s*:\s*(?:#000(?:000)?|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))/gi,
      '$1:#ffffff',
    ))
  })
}

function _hydrateStagedElement(stage, element) {
  const node = element.node
  Array.from(node.attributes).forEach((attribute) => {
    if (!attribute.name.startsWith('data-')) return
    const camelKey = attribute.name.slice(5).replace(/-([a-z])/g, (_, character) => character.toUpperCase())
    const value = parseSafeJson(attribute.value, ELEMENT_DATA_METADATA_LIMITS)
    if (value !== null) element.data(camelKey, value)
    else if (/^\s*[{[]/.test(attribute.value)) {
      node.removeAttribute(attribute.name)
      stage.recoveredElementMetadata = true
    }
    else element.data(camelKey, attribute.value)
  })

  if (element.attr('data-collection') === 'true') return
  if (element.attr('data-nanquim-preserve-id') === 'true') return

  const rawId = element.attr('id')
  let id = rawId === null || rawId === undefined || rawId === '' ? NaN : Number(rawId)
  if (!Number.isSafeInteger(id) || id < 0 || id > MAX_EDITOR_ELEMENT_ID) {
    id = stage.elementIndex++
    element.attr('id', id)
  } else if (id >= stage.elementIndex) {
    stage.elementIndex = id + 1
  }
  if (!element.attr('name')) {
    const nodeName = node.nodeName
    element.attr('name', nodeName.charAt(0).toUpperCase() + nodeName.slice(1) + ' ' + id)
  }
}

function _hydrateStagedTree(stage, element) {
  _hydrateStagedElement(stage, element)
  if (element.children) element.children().each((child) => _hydrateStagedTree(stage, child))
}

function _markForeignStyleOverrides(parent) {
  parent.children().each((child) => {
    const overrides = {}
    const style = child.node.getAttribute('style') || ''
    if (child.node.getAttribute('stroke') || /stroke\s*:/.test(style)) overrides.stroke = true
    if (child.node.getAttribute('fill') || /fill\s*:/.test(style)) overrides.fill = true
    if (Object.keys(overrides).length > 0) child.attr('data-style-overrides', JSON.stringify(overrides))
    if (child.type === 'g') _markForeignStyleOverrides(child)
  })
}

function _appendCandidateContent(stage, candidate, idPlan, excludedRootMetadata = new Set()) {
  const root = candidate.root
  const importedAssets = stage.svg.defs().group()
    .attr('data-nanquim-import-assets', 'true').node

  Array.from(root.children).forEach((child) => {
    const name = child.localName.toLowerCase()
    if (child.namespaceURI && child.namespaceURI !== 'http://www.w3.org/2000/svg') return
    if (name === 'defs') _importDefinitionChildren(child, importedAssets)
    else if (name === 'style') importedAssets.appendChild(document.importNode(child, true))
  })

  if (candidate.isNative) {
    const rootSemantics = stage.svg.defs().group().attr({
      [ROOT_SEMANTICS_ATTRIBUTE]: 'true',
      'data-nanquim-document-def': 'true',
    })
    Array.from(root.children).forEach((child) => {
      const name = child.localName.toLowerCase()
      if (
        ROOT_SEMANTIC_ELEMENTS.has(name)
        && !excludedRootMetadata.has(child)
        && !(name === 'metadata' && child.getAttribute('id') === GEOMETRY_NODES_METADATA_ID)
      ) {
        rootSemantics.node.appendChild(document.importNode(child, true))
        return
      }
      if (NON_GEOMETRY.has(name)) return
      if (child.getAttribute('data-nanquim-paper-annotations') === 'true') return
      stage.drawing.node.appendChild(document.importNode(child, true))
    })
    if (rootSemantics.node.children.length === 0) rootSemantics.remove()
    if (candidate.metadata.convertedStrokes) _restoreConvertedStrokes(stage.drawing.node)
    return
  }

  const collection = stage.drawing.group().attr({
    id: idPlan.foreignCollectionId,
    name: candidate.sourceName.replace(/\.(?:svg|dxf)$/i, '') || 'Imported drawing',
    'data-collection': 'true',
    'data-nanquim-import-root': 'true',
    style: 'stroke:inherit;fill:inherit;',
  })
  Array.from(root.children).forEach((child) => {
    const name = child.localName.toLowerCase()
    if (child.namespaceURI && child.namespaceURI !== 'http://www.w3.org/2000/svg') return
    if (NON_GEOMETRY.has(name)) return
    collection.node.appendChild(document.importNode(child, true))
  })
  _markForeignStyleOverrides(collection)
}

async function _stagePreparedDocument(editor, candidate) {
  const stage = _createStagingEditor()
  const diagnostics = [...candidate.diagnostics]
  const sourceGeometryNodesElements = Array.from(candidate.root.children).filter(
    (child) => child.localName.toLowerCase() === 'metadata'
      && child.getAttribute('id') === 'nanquim-geometry-nodes',
  )
  const sourceGeometryNodesElement = sourceGeometryNodesElements[0]
  const idPlan = prepareSanitizedSvgForImport(candidate.root, editor, {
    reserveForeignCollection: !candidate.isNative,
    preserveIds: candidate.isNative,
    freshDocument: false,
    initialElementIndex: 0,
  })
  scopeSvgStyleElements(
    candidate.root,
    '#Collection',
    candidate.isNative
      ? '#Collection'
      : '#Collection > [data-nanquim-import-root="true"]',
  )
  const readRemappedJson = (attribute, fallback) => {
    // `null` means the canonical parser already rejected this field (or it was
    // absent). Never reinterpret rejected input with a looser staging budget.
    if (fallback === null) return null
    const raw = candidate.root.getAttribute(attribute)
    if (raw === null) return fallback
    return parseSafeJson(raw, DOCUMENT_METADATA_LIMITS[attribute])
  }
  const metadata = {
    ...candidate.metadata,
    paperConfig: readRemappedJson('data-paper-config', candidate.metadata.paperConfig),
    paperViewports: readRemappedJson('data-paper-viewports', candidate.metadata.paperViewports),
    dimensionStyles: readRemappedJson('data-dim-styles', candidate.metadata.dimensionStyles),
    textStyles: readRemappedJson('data-text-styles', candidate.metadata.textStyles),
    geometryNodes: sourceGeometryNodesElement && candidate.metadata.geometryNodes !== null
      ? parseSafeJson(sourceGeometryNodesElement.textContent, GEOMETRY_NODES_METADATA_LIMITS)
      : candidate.metadata.geometryNodes,
  }
  if (idPlan.recoveredBlockNames) {
    diagnostics.push(_documentDiagnostic(
      'invalid-block-name',
      'Invalid block display names were replaced with safe imported names.',
    ))
  }
  _appendCandidateContent(stage, candidate, idPlan, new Set(sourceGeometryNodesElements))
  stage.elementIndex = Math.max(stage.elementIndex, idPlan.nextElementIndex)
  stage.drawing.node.querySelectorAll('.elementHover, .elementSelected').forEach((node) => {
    node.classList.remove('elementHover', 'elementSelected')
  })
  stage.drawing.children().each((child) => _hydrateStagedTree(stage, child))
  if (stage.recoveredElementMetadata) {
    diagnostics.push(_documentDiagnostic(
      'invalid-element-metadata',
      'Invalid or oversized element metadata was removed.',
    ))
  }

  if (candidate.kind === 'dxf') {
    flattenDXFStylingGroups(stage)
    stage.drawing.children().each((collection) => {
      if (collection.attr('data-collection') === 'true') bakeTransforms(collection)
    })
  }
  if (metadata.elementIndex !== null) {
    stage.elementIndex = Math.max(stage.elementIndex, metadata.elementIndex)
  }
  rebuildCollectionsFromDOM(stage)
  rebuildBlockDefinitionsFromDOM(stage)

  const paperConfigResult = metadata.paperConfig === null
    ? { value: null, recovered: false }
    : validatePaperConfigMetadata(metadata.paperConfig)
  if (metadata.paperConfig !== null && (!paperConfigResult.value || paperConfigResult.recovered)) {
    diagnostics.push(_documentDiagnostic('invalid-paper-config', 'Invalid Paper configuration metadata was reset.'))
  }
  if (paperConfigResult.value) Object.assign(stage.paperConfig, paperConfigResult.value)

  const paperViewports = metadata.paperViewports === null
    ? []
    : _paperViewportsMetadata(metadata.paperViewports)
  if (metadata.paperViewports !== null && !paperViewports) {
    diagnostics.push(_documentDiagnostic('invalid-paper-viewports', 'Invalid Paper viewport metadata was reset.'))
  }

  const dimensionStyleResult = metadata.dimensionStyles === null
    ? { value: stage.dimensionManager.toJSON(), recovered: false }
    : validateDimensionStyleMetadata(metadata.dimensionStyles)
  let dimensionStyles = dimensionStyleResult.value
  if (!dimensionStyles) {
    diagnostics.push(_documentDiagnostic('invalid-dimension-styles', 'Invalid dimension styles were reset.'))
    dimensionStyles = stage.dimensionManager.toJSON()
  } else {
    if (dimensionStyleResult.recovered) {
      diagnostics.push(_documentDiagnostic('invalid-dimension-styles', 'Invalid dimension styles were reset.'))
    }
    stage.dimensionManager.fromJSON(dimensionStyles)
  }

  const textStyleResult = metadata.textStyles === null
    ? { value: stage.textStyleManager.toJSON(), recovered: false }
    : validateTextStyleMetadata(metadata.textStyles)
  let textStyles = textStyleResult.value
  if (!textStyles) {
    diagnostics.push(_documentDiagnostic('invalid-text-styles', 'Invalid text styles were reset.'))
    textStyles = stage.textStyleManager.toJSON()
  } else {
    if (textStyleResult.recovered) {
      diagnostics.push(_documentDiagnostic('invalid-text-styles', 'Invalid text styles were reset.'))
    }
    stage.textStyleManager.fromJSON(textStyles)
  }

  let geometryNodes = metadata.geometryNodes || DEFAULT_GEOMETRY_NODES
  try {
    assertSerializedGeometryNodes(geometryNodes)
    await stage.geometryNodes.load(geometryNodes)
  } catch (_) {
    geometryNodes = DEFAULT_GEOMETRY_NODES
    stage.geometryNodes.reset({ preserveDom: true })
    diagnostics.push(_documentDiagnostic(
      'invalid-geometry-nodes',
      'Geometry Nodes metadata was reset; cached safe SVG output was retained.',
    ))
  }

  return {
    candidate,
    stage,
    diagnostics,
    geometryNodes,
    dimensionStyles,
    textStyles,
    activeCollectionId: candidate.metadata.activeCollectionId
      ? idPlan.idMap.get(candidate.metadata.activeCollectionId) || candidate.metadata.activeCollectionId
      : null,
    paper: {
      annotations: candidate.isNative && candidate.paperAnnotations
        ? document.importNode(candidate.paperAnnotations, true)
        : null,
      config: { ...stage.paperConfig, colorMap: { ...stage.paperConfig.colorMap } },
      viewports: paperViewports || [],
      ensureInfrastructure: candidate.isNative && candidate.diagnostics.some(
        diagnostic => diagnostic.code === 'duplicate-paper-annotations',
      ),
    },
    requiresSave: candidate.requiresSave || diagnostics.length > 0,
  }
}

function _detachChildren(parent) {
  const fragment = document.createDocumentFragment()
  while (parent.firstChild) fragment.appendChild(parent.firstChild)
  return fragment
}

function _detachDocumentDefinitions(parent) {
  const entries = []
  Array.from(parent.children).forEach((node, index) => {
    if (!node.matches([
      '[data-nanquim-import-assets="true"]',
      '[data-block-def="true"]',
      '[data-nanquim-document-def="true"]',
    ].join(','))) return
    entries.push({ index, node })
    node.remove()
  })
  return entries
}

function _restoreDocumentDefinitions(parent, entries) {
  entries.forEach(({ index, node }) => {
    parent.insertBefore(node, parent.children[index] || null)
  })
}

function _appendChildren(parent, source) {
  while (source.firstChild) parent.appendChild(source.firstChild)
}

function _snapshotPaper(editor) {
  return {
    infrastructure: Boolean(
      editor.paperSvg
      && editor.paperAnnotations
      && editor.paperViewportsGroup,
    ),
    annotations: editor.paperAnnotations ? editor.paperAnnotations.node.cloneNode(true) : null,
    config: {
      ...(editor.paperConfig || {}),
      colorMap: { ...(editor.paperConfig?.colorMap || {}) },
    },
    viewports: (editor.paperViewports || []).map((viewport) => ({
      id: viewport.id,
      x: viewport.x,
      y: viewport.y,
      w: viewport.w,
      h: viewport.h,
      scale: viewport.scale,
      modelOriginX: viewport.modelOriginX,
      modelOriginY: viewport.modelOriginY,
      visible: viewport.visible !== false,
      locked: viewport.locked === true,
    })),
  }
}

function _safeAction(label, callback) {
  try {
    return callback()
  } catch (error) {
    console.error(`[DXFLoader] ${label}:`, error)
    return undefined
  }
}

function _safeDispatch(signal, ...args) {
  if (!signal || typeof signal.dispatch !== 'function') return
  _safeAction('A document lifecycle listener failed', () => signal.dispatch(...args))
}

function _safeCleanupDispatch(signal, ...args) {
  if (!signal) return
  const bindings = Array.isArray(signal._bindings) ? signal._bindings.slice() : null
  if (!bindings || signal.active === false) {
    _safeDispatch(signal, ...args)
    return
  }

  // js-signals stops at the first exception. Document replacement cleanup is
  // different from an ordinary notification: every registered cleanup must
  // get its chance even when another command's listener is faulty.
  for (let index = bindings.length - 1; index >= 0; index -= 1) {
    const binding = bindings[index]
    try {
      binding.execute(args)
    } catch (error) {
      console.error('[DXFLoader] A document cleanup listener failed:', error)
      if (binding._isOnce) {
        _safeAction('Failed to detach a faulty one-shot cleanup listener', () => binding.detach())
      }
    }
  }
}

function _clearSvgChildren(container, label, preserve = () => false) {
  if (!container?.children) return
  _safeAction(label, () => {
    container.children().each((child) => {
      if (preserve(child)) return
      _safeAction(label, () => child.remove())
    })
  })
}

function _resetTransientSession(editor) {
  if (editor.editingBlock) {
    const blockEdit = editor.editingBlock
    _safeAction('Failed to close the previous block editing session', () => discardBlockEdit(editor))
    if (editor.editingBlock) {
      _safeAction('Failed to remove the previous block editing group', () => blockEdit.editGroup?.remove())
      _safeAction('Failed to reveal the previous block instance', () => blockEdit.useElement?.show())
      _safeAction('Failed to remove the block editing marker', () => {
        editor.svg?.node?.classList?.remove('block-edit-mode')
      })
      _safeAction('Failed to discard the block editing collection', () => {
        editor.collections?.delete?.('block-edit-group')
      })
      editor.editingBlock = null
    }
  }
  _safeCleanupDispatch(editor.signals?.commandCancelled)
  _safeCleanupDispatch(editor.signals?.documentSessionReset)
  _safeCleanupDispatch(editor.signals?.clearSelection)
  editor.selected = []
  editor.previousSelection = []
  _clearSvgChildren(editor.overlays, 'Failed to clear a document overlay', child => (
    child.hasClass('grid')
    || child.hasClass('axis-group')
    || child.hasClass('polar-guides')
  ))
  _clearSvgChildren(editor.snap, 'Failed to clear a snapping helper')
  _clearSvgChildren(editor.handlers, 'Failed to clear a selection handler')
  editor.handlers = editor.modelHandlers || editor.handlers
  editor.isDrawing = false
  editor.isInteracting = false
  editor.isSelecting = false
  editor.selectSingleElement = false
  editor.isEditingVertex = false
  editor.editingVertices = []
  editor.isTypingText = false
  editor.inputCoord = null
  editor.inputCoordMode = null
  editor.length = null
  editor.distance = null
  editor.offsetDX = null
  editor.offsetDY = null
  editor.snapPoint = null
  editor.extensionHovers = []
  editor.lastCommand = null
  editor.lastClick = null
  editor.activeEditor = 'canvas'
  if (editor.mode === 'paper' && editor.paperEditor) {
    _safeAction('Failed to leave Paper Space', () => editor.paperEditor.deactivate())
  }
  _safeAction('Failed to restore Model Space visibility', () => {
    if (editor.svg?.node) editor.svg.node.style.display = ''
    const paperCanvas = document.getElementById('paper-canvas')
    if (paperCanvas) paperCanvas.style.display = 'none'
  })
  editor.handlers = editor.modelHandlers || editor.handlers
  editor.mode = 'model'
}

function _hasPaperReplacement(editor, paper) {
  const hasInfrastructure = Boolean(
    editor.paperSvg
    && editor.paperAnnotations
    && editor.paperViewportsGroup,
  )
  const hasPaperContent = Boolean(
    paper.annotations
    || paper.viewports.length > 0
    || paper.ensureInfrastructure,
  )
  return hasInfrastructure || hasPaperContent
}

function _preparePaperState(editor, paper) {
  if (
    !editor.paperEditor
    || !_hasPaperReplacement(editor, paper)
    || typeof editor.paperEditor.prepareDocumentState !== 'function'
  ) return null
  return editor.paperEditor.prepareDocumentState({
    annotations: paper.annotations,
    config: paper.config,
    viewports: paper.viewports,
  })
}

function _replacePaperState(editor, paper, preparedPaperState = null) {
  if (
    preparedPaperState
    && typeof editor.paperEditor?.adoptPreparedDocumentState === 'function'
  ) {
    return editor.paperEditor.adoptPreparedDocumentState(
      preparedPaperState,
      { silent: true, notify: false },
    )
  }

  editor.paperConfig = {
    ...paper.config,
    colorMap: { ...(paper.config?.colorMap || {}) },
  }
  if (!editor.paperEditor || !_hasPaperReplacement(editor, paper)) return null
  if (typeof editor.paperEditor.replaceDocumentState === 'function') {
    editor.paperEditor.replaceDocumentState({
      annotations: paper.annotations,
      config: paper.config,
      viewports: paper.viewports,
    }, { silent: true, notify: false })
    return null
  }
  const existing = [...(editor.paperViewports || [])]
  existing.forEach((viewport) => editor.paperEditor.removeViewport(viewport.id, {
    silent: true,
    notify: false,
  }))
  paper.viewports.forEach((data) => {
    editor.paperEditor.createViewport(data.x, data.y, data.w, data.h, data.scale, {
      id: data.id,
      modelOriginX: data.modelOriginX,
      modelOriginY: data.modelOriginY,
      visible: data.visible,
      locked: data.locked,
      silent: true,
      notify: false,
    })
  })
  return null
}

function _invalidateIndex(index) {
  if (!index) return
  const marked = _safeAction('Failed to invalidate a spatial index', () => {
    index.markDirty?.()
    return true
  })
  if (!marked && '_dirty' in index) index._dirty = true
}

function _clearHistory(history) {
  if (!history) return
  history.undos = []
  history.redos = []
  history.idCounter = 0
}

function _replaceSession(editor, session) {
  if (!editor.documentState) {
    editor.currentFileName = session.name
    editor.currentFileHandle = session.handle
    return
  }
  const state = editor.documentState
  try {
    state.replaceSession(session)
  } catch (error) {
    // DocumentState installs the association before notifying listeners. A
    // faulty listener must not turn an already committed Open into a failure.
    if (
      state.name === session.name
      && state.handle === session.handle
      && state.isDirty === session.dirty
    ) {
      console.error('[DXFLoader] A document state listener failed:', error)
      return
    }
    console.error('[DXFLoader] Failed to replace the document session cleanly:', error)
    state.sessionId += 1
    state.revision = session.dirty ? 1 : 0
    state.savedRevision = 0
    state.name = session.name
    state.handle = session.handle
    editor.currentFileName = session.name
    editor.currentFileHandle = session.handle
    _safeAction('Failed to discard stale document mutations', () => state._discardObservedMutations?.())
  }
}

function _commitPreparedDocument(editor, prepared, association = {}) {
  const stage = prepared.stage
  const oldPaper = _snapshotPaper(editor)
  const old = {
    drawing: null,
    definitions: null,
    stagedDefinitions: [],
    collections: editor.collections,
    activeCollection: editor.activeCollection,
    blockDefinitions: editor.blockDefinitions,
    collectionIndex: editor.collectionIndex,
    elementIndex: editor.elementIndex,
    dimensionStyles: editor.dimensionManager?.styles,
    dimensionActiveStyleId: editor.dimensionManager?.activeStyleId,
    textStyles: editor.textStyleManager?.styles,
    textActiveStyleId: editor.textStyleManager?.activeStyleId,
    geometryNodeGraphs: editor.geometryNodes?.graphs,
    geometryNodeInstances: editor.geometryNodes?.instances,
    geometryNodeActiveObjectId: editor.geometryNodes?.activeObjectId,
    paperConfig: editor.paperConfig,
    paperCollection: editor.collections?.get('paper-annotations'),
    hadPaperCollection: editor.collections?.has('paper-annotations') === true,
    viewBox: editor.svg.viewbox(),
  }
  const preparedPaperState = _preparePaperState(editor, prepared.paper)
  let paperAttempted = false
  let paperTransaction = null
  let nextActiveCollection = stage.activeCollection

  const commit = () => {
    const liveDefs = editor.svg.defs().node
    try {
      old.drawing = _detachChildren(editor.drawing.node)
      old.definitions = _detachDocumentDefinitions(liveDefs)
      _appendChildren(editor.drawing.node, stage.drawing.node)
      old.stagedDefinitions = Array.from(stage.svg.defs().node.children)
      old.stagedDefinitions.forEach((node) => liveDefs.appendChild(node))

      editor.elementIndex = stage.elementIndex
      editor.collectionIndex = stage.collectionIndex
      editor.collections = stage.collections
      editor.blockDefinitions = stage.blockDefinitions
      const requestedActiveCollection = prepared.activeCollectionId
        ? editor.collections.get(prepared.activeCollectionId)?.group
        : null
      nextActiveCollection = requestedActiveCollection || stage.activeCollection
      editor.activeCollection = nextActiveCollection

      if (editor.dimensionManager instanceof DimensionManager && stage.dimensionManager) {
        editor.dimensionManager.styles = stage.dimensionManager.styles
        editor.dimensionManager.activeStyleId = stage.dimensionManager.activeStyleId
      } else {
        _safeAction(
          'A compatibility dimension-style manager rejected prepared state',
          () => editor.dimensionManager?.fromJSON?.(prepared.dimensionStyles),
        )
      }
      if (editor.textStyleManager instanceof TextStyleManager && stage.textStyleManager) {
        editor.textStyleManager.styles = stage.textStyleManager.styles
        editor.textStyleManager.activeStyleId = stage.textStyleManager.activeStyleId
      } else {
        _safeAction(
          'A compatibility text-style manager rejected prepared state',
          () => editor.textStyleManager?.fromJSON?.(prepared.textStyles),
        )
      }
      if (editor.geometryNodes instanceof GeometryNodeManager && stage.geometryNodes) {
        editor.geometryNodes.graphs = stage.geometryNodes.graphs
        editor.geometryNodes.instances = stage.geometryNodes.instances
        editor.geometryNodes.activeObjectId = stage.geometryNodes.activeObjectId
      } else {
        _safeAction('Failed to reset a compatibility Geometry Nodes manager', () => {
          editor.geometryNodes?.reset?.({ preserveDom: true })
        })
        _safeAction('A compatibility Geometry Nodes manager rejected prepared state', () => {
          editor.geometryNodes?.load?.(prepared.geometryNodes)
        })
      }

      const viewBox = prepared.candidate.metadata.viewBox
      if (viewBox) editor.svg.viewbox(viewBox.x, viewBox.y, viewBox.width, viewBox.height)
      paperAttempted = true
      paperTransaction = _replacePaperState(editor, prepared.paper, preparedPaperState)
    } catch (error) {
      const rollbackErrors = []
      const restore = (callback) => {
        try {
          callback()
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      restore(() => _detachChildren(editor.drawing.node))
      restore(() => old.stagedDefinitions.forEach((node) => node.remove()))
      if (old.drawing) restore(() => _appendChildren(editor.drawing.node, old.drawing))
      if (old.definitions) restore(() => _restoreDocumentDefinitions(liveDefs, old.definitions))

      editor.collections = old.collections
      editor.activeCollection = old.activeCollection
      editor.blockDefinitions = old.blockDefinitions
      editor.collectionIndex = old.collectionIndex
      editor.elementIndex = old.elementIndex
      if (editor.dimensionManager) {
        editor.dimensionManager.styles = old.dimensionStyles
        editor.dimensionManager.activeStyleId = old.dimensionActiveStyleId
      }
      if (editor.textStyleManager) {
        editor.textStyleManager.styles = old.textStyles
        editor.textStyleManager.activeStyleId = old.textActiveStyleId
      }
      if (editor.geometryNodes) {
        editor.geometryNodes.graphs = old.geometryNodeGraphs
        editor.geometryNodes.instances = old.geometryNodeInstances
        editor.geometryNodes.activeObjectId = old.geometryNodeActiveObjectId
      }
      restore(() => editor.svg.viewbox(old.viewBox))

      if (paperTransaction) {
        restore(() => paperTransaction.rollback())
      } else if (preparedPaperState) {
        restore(() => editor.paperEditor?.disposePreparedDocumentState?.(preparedPaperState))
      } else if (paperAttempted) {
        if (oldPaper.infrastructure) restore(() => _replacePaperState(editor, oldPaper))
        else restore(() => editor.paperEditor?.destroyDocumentInfrastructure?.({
          silent: true,
          notify: false,
        }))
      }
      editor.paperConfig = old.paperConfig
      if (paperAttempted) {
        if (old.hadPaperCollection) {
          editor.collections.set('paper-annotations', old.paperCollection)
        } else {
          editor.collections.delete('paper-annotations')
        }
      }
      editor.activeCollection = old.activeCollection
      if (rollbackErrors.length > 0) {
        console.error('[DXFLoader] Document rollback encountered errors:', rollbackErrors)
      }
      throw error
    }
  }

  try {
    if (editor.documentState) editor.documentState.runWithoutTracking(commit)
    else commit()
  } catch (error) {
    if (preparedPaperState) {
      _safeAction(
        'Failed to dispose an unused prepared Paper document',
        () => editor.paperEditor?.disposePreparedDocumentState?.(preparedPaperState),
      )
    }
    throw error
  }

  // No fallible work follows the structural transaction. Old async Geometry
  // Nodes jobs, command state, History and lazy indexes are finalized only
  // after the candidate document and Paper state have both committed.
  old.geometryNodeInstances?.forEach?.((instance) => {
    _safeAction('Failed to cancel an old Geometry Nodes evaluation', () => instance.abortController?.abort())
  })
  _resetTransientSession(editor)
  if (paperTransaction) {
    _safeAction('Failed to finalize the previous Paper document', () => paperTransaction.finalize())
  }
  editor.activeCollection = nextActiveCollection
  _clearHistory(editor.history)
  _invalidateIndex(editor.spatialIndex)
  _invalidateIndex(editor.fullSpatialIndex)
  _safeAction(
    'Failed to refresh persistent document roots',
    () => editor.documentState?.refreshPersistentRoots?.(),
  )

  const dirty = prepared.requiresSave || !prepared.candidate.isNative
  const requestedName = association.name !== undefined
    ? association.name
    : prepared.candidate.sourceName
  const name = requestedName || null
  const handle = prepared.candidate.isNative ? association.handle ?? null : null
  _replaceSession(editor, { name, handle, dirty })

  const dispatchCommitSignals = () => {
    _safeDispatch(editor.signals?.activeEditorChanged, 'canvas')
    _safeDispatch(editor.signals?.editorModeChanged, 'model')
    _safeDispatch(editor.signals?.updatedCollections)
    _safeDispatch(editor.signals?.updatedOutliner)
    _safeDispatch(editor.signals?.updatedProperties)
    _safeDispatch(editor.signals?.paperViewportsChanged)
    _safeDispatch(editor.signals?.geometryNodesChanged)
  }
  if (editor.documentState) {
    _safeAction(
      'Failed to dispatch document commit notifications',
      () => editor.documentState.runWithoutTracking(dispatchCommitSignals),
    )
  } else {
    dispatchCommitSignals()
  }

  return { ok: true, kind: prepared.candidate.kind, dirty, diagnostics: prepared.diagnostics }
}

function _logOpenFailure(editor, error) {
  const reason = error instanceof DocumentOpenError
    ? error.message
    : 'The selected file could not be opened safely.'
  _safeAction('Failed to report an Open error', () => _rejectImport(editor, reason))
}

function _logPreparedDiagnostics(editor, diagnostics) {
  diagnostics.slice(0, 16).forEach((diagnostic) => {
    _safeDispatch(editor.signals?.terminalLogged, { type: 'span', msg: diagnostic.message })
  })
}

function DXFLoader(editor) {
  this.loadPrepared = async function (candidate, association = {}) {
    try {
      const prepared = await _stagePreparedDocument(editor, candidate)
      if (
        typeof association.commitGuard === 'function'
        && association.commitGuard() !== true
      ) {
        return {
          ok: false,
          cancelled: true,
          stale: true,
          kind: candidate.kind,
        }
      }
      const result = _commitPreparedDocument(editor, prepared, association)
      _logPreparedDiagnostics(editor, result.diagnostics)
      _safeDispatch(editor.signals?.terminalLogged, {
        type: 'span',
        msg: 'Opened: ' + (association.name || candidate.sourceName || 'drawing'),
      })
      return result
    } catch (error) {
      if (!(error instanceof DocumentOpenError)) {
        console.error('[DXFLoader] Failed to open document:', error)
      }
      _logOpenFailure(editor, error)
      return { ok: false, error }
    }
  }

  this.loadSource = async function (source, options = {}) {
    try {
      const candidate = prepareDocumentSource(source, options)
      return await this.loadPrepared(candidate, {
        name: options.name || options.fileName || null,
        handle: options.handle || null,
        commitGuard: options.commitGuard,
      })
    } catch (error) {
      if (!(error instanceof DocumentOpenError)) {
        console.error('[DXFLoader] Failed to prepare document source:', error)
      }
      _logOpenFailure(editor, error)
      return { ok: false, error }
    }
  }

  this.loadFile = async function (file, { handle = null, commitGuard } = {}) {
    try {
      const candidate = await prepareDocumentFile(file)
      return await this.loadPrepared(candidate, { name: file.name, handle, commitGuard })
    } catch (error) {
      if (!(error instanceof DocumentOpenError)) {
        console.error('[DXFLoader] Failed to prepare document file:', error)
      }
      _logOpenFailure(editor, error)
      return { ok: false, error }
    }
  }
}

/**
 * Optimize DXF imports by flattening purely redundant structural groups.
 * Unlike older versions, we NO LONGER push stroke colors down to leaf elements,
 * because doing so creates hardcoded inline styles that block inheritance
 * from the Properties panel and Collection styles.
 * If a group has a stroke color, we leave it intact or promote the stroke up
 * to ensure styling is applied at the highest possible group level.
 */
function flattenDXFStylingGroups(editor) {
  const flattenInGroup = (parent) => {
    // We need to iterate carefully since we modify the DOM during iteration
    const children = [...parent.children()]
    children.forEach(child => {
      if (child.type !== 'g') return
      // Skip collection groups and explicit user/block groups
      if (child.attr('data-collection') === 'true') return
      if (child.attr('data-group') === 'true') return

      // Recurse first so inner structure is as flat as possible
      flattenInGroup(child)

      const hasStroke = child.attr('stroke')
      const hasTransform = child.attr('transform')

      // Case 1: Purely structural wrapper (no stroke, no transform)
      // We can safely hoist all children up.
      if (!hasStroke && !hasTransform) {
        const innerChildren = [...child.children()]
        innerChildren.forEach(innerChild => parent.add(innerChild))
        child.remove()
        return
      }

      // Case 2: Styling wrapper (has stroke, no transform)
      // We want to KEEP the group so its stroke can be inherited, BUT
      // if it only contains ONE child, we can apply the stroke directly
      // to that child (if it doesn't have one) and remove the wrapper
      // for a cleaner DOM.
      if (hasStroke && !hasTransform) {
        const innerChildren = [...child.children()]
        if (innerChildren.length === 1) {
          const innerChild = innerChildren[0]
          if (!innerChild.attr('stroke')) {
            innerChild.attr('stroke', hasStroke)
          }
          parent.add(innerChild)
          child.remove()
        }
      }
    })
  }

  editor.drawing.children().each(collectionGroup => {
    if (collectionGroup.type === 'g') {
      flattenInGroup(collectionGroup)
    }
  })
}

export {
  DXFLoader,
  MAX_SVG_IMPORT_BYTES,
  MAX_SVG_IMPORT_ELEMENTS,
  NATIVE_STYLE_METADATA_LIMITS,
  markupFitsSvgImportElementBudget,
  prepareSanitizedSvgForImport,
}
