/**
 * PaperEditor.js
 *
 * Manages the Paper Space editor mode.
 *
 * Coordinate system:
 *   - Paper dimensions are stored in mm.
 *   - One paper centimetre = editor.paperConfig.unitsPerCm SVG user units.
 *   - At the default density of 1, A4 is 21x29.7 SVG units.
 *   - A viewport at 1:100 maps 1m of Model space to one physical paper centimetre.
 *
 * Viewport rendering strategy: LIVE <use> references.
 *   - Each PaperViewport creates an SVG <use> pointing to editor.drawing's DOM id.
 *   - The <use> element gets a transform that maps (modelOriginX, modelOriginY) at the
 *     given scale to the viewport's top-left corner.
 *   - A <clipPath> confines the visible area to the viewport rectangle.
 *   - Changes to the model are automatically visible — no re-render needed.
 */

import { PaperViewport } from './PaperViewport'
import { invalidateSpatialIndexes } from './utils/invalidateSpatialIndexes'
import {
  exportPaperSVG,
  exportPaperPDF,
  getPaperModelDefinitionSources,
  normalizePaperPaint,
  normalizedPaperColorMap,
  resolvePaperPaint,
} from './utils/ExportPaper'

// Standard ISO paper sizes in mm
const PAPER_SIZES = {
  A0: { width: 841, height: 1189 },
  A1: { width: 594, height: 841 },
  A2: { width: 420, height: 594 },
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  custom: { width: 210, height: 297 },
}

const PAPER_ANNOTATIONS_ID = 'paper-annotations'
const MAX_PAPER_ORIGIN = 1000000000
const MAX_PAPER_SCALE = 1000000000
const MAX_PAPER_VIEWPORT_COORDINATE = 1000000
const MIN_PAPER_SCALE = 0.000001
const MIN_PAPER_VIEWPORT_DIMENSION = 0.000001
const MIN_PAPER_DIMENSION = 0.1
const MAX_PAPER_DIMENSION = 10000
const PAPER_ANNOTATION_STYLE = Object.freeze({
  stroke: 'black',
  'stroke-width': 0.1,
  'stroke-linecap': 'round',
  fill: 'transparent',
})

function domNode(value) {
  return value && (value.node || value)
}

function isElement(value) {
  return Boolean(value && value.nodeType === 1)
}

function PaperEditor(editor) {
  const signals = editor.signals

  // Paper SVG instance (separate from draw SVG)
  let paperSvg = null
  // Owning container, retained separately so a partial SVG build can be
  // removed without targeting another editor's DOM by global id alone.
  let paperCanvasElement = null
  // SVG group for the white paper sheet rect
  let paperSheet = null
  // Annotation layer group (user draws here)
  let annotationsGroup = null
  // Viewports group (parent for all viewport <g> elements)
  let viewportsGroup = null
  // Array of PaperViewport instances
  let viewports = []
  // Viewport counter for unique IDs
  let viewportCounter = 0
  // Paper-specific handlers group
  let paperHandlers = null
  // Saved active collection to restore after deactivating paper mode
  let savedActiveCollection = null
  // Last known annotation collection state. Model collection hydration clears
  // editor.collections, but must not discard this separate Paper collection.
  let annotationCollectionState = null
  let livePaintSources = new WeakMap()
  let livePaintNodes = new Set()
  const preparedDocumentStates = new WeakSet()

  // ── Activation / Deactivation ───────────────────────────────────────────────

  function activate() {
    // Capture drawing bounding box before hiding the model SVG (getBBox returns zeros on hidden elements)
    try {
      const rawBBox = editor.drawing.node.getBBox()
      editor._drawingBBox = (rawBBox.width > 0 || rawBBox.height > 0) ? rawBBox : null
    } catch (_) {
      editor._drawingBBox = null
    }

    // Hide the draw SVG (preserving the terminal inside editor.canvas)
    editor.svg.node.style.display = 'none'

    // Create the paper document infrastructure if needed, then reveal it.
    // Infrastructure creation itself never changes editor mode or hides Model
    // Space, which lets the document loader restore Paper state atomically.
    ensureDocumentInfrastructure()
    const paperCanvasEl = paperCanvasElement
    if (paperCanvasEl) paperCanvasEl.style.display = 'flex'

    _renderPaperSheet()
    _refreshAllViewports()
    _withoutDocumentTracking(_applyLiveColorMapping)

    // Swap handlers to the paper canvas
    if (paperHandlers) {
      editor.handlers = paperHandlers
    }

    // Save current active collection and set to paper annotations
    savedActiveCollection = editor.activeCollection
    editor.activeCollection = annotationsGroup

    // Dispatch signals to update Outliner and Properties
    signals.updatedOutliner.dispatch()
    signals.updatedProperties.dispatch()
  }

  function deactivate() {
    // Show draw SVG
    editor.svg.node.style.display = ''

    // Hide paper SVG container
    const paperCanvasEl = paperCanvasElement
    if (paperCanvasEl) {
      paperCanvasEl.style.display = 'none'
    }

    // Restore draw handlers
    editor.handlers = editor.modelHandlers
    _withoutDocumentTracking(_clearLiveColorMapping)

    // Restore the model collection once. Keeping this pointer after leaving
    // Paper Space lets a later document-session notification revive a group
    // from the previous drawing.
    const collectionToRestore = savedActiveCollection
    savedActiveCollection = null
    if (collectionToRestore) editor.activeCollection = collectionToRestore
    
    signals.updatedOutliner.dispatch()
    signals.updatedProperties.dispatch()
  }

  function getActiveModelCollection() {
    const drawing = domNode(editor.drawing)
    const active = domNode(editor.activeCollection)
    if (drawing && active && drawing.contains(active)) return editor.activeCollection

    const saved = domNode(savedActiveCollection)
    return drawing && saved && drawing.contains(saved) ? savedActiveCollection : null
  }

  // ── Internal build helpers ──────────────────────────────────────────────────

  function _paperDimensions(config) {
    const scale = config.unitsPerCm / 10
    return {
      wSVG: config.width * scale,
      hSVG: config.height * scale,
    }
  }

  function _renderPaperSheetFor(sheet, config) {
    sheet.clear()
    const { wSVG, hSVG } = _paperDimensions(config)
    sheet.rect(wSVG, hSVG)
      .move(0.2, 0.2)
      .fill('#00000033')
      .stroke('none')
    sheet.rect(wSVG, hSVG)
      .move(0, 0)
      .fill('white')
      .stroke('#cccccc')
      .attr('stroke-width', 0.02)
  }

  function _updatePaperViewboxFor(svg, config) {
    const { wSVG, hSVG } = _paperDimensions(config)
    const margin = Math.max(wSVG, hSVG) * 0.15
    svg.viewbox(-margin, -margin, wSVG + margin * 2, hSVG + margin * 2)
  }

  function _populateAnnotations(group, source) {
    const node = group.node
    group.clear()
    Array.from(node.attributes).forEach(attribute => node.removeAttributeNode(attribute))

    if (source) {
      Array.from(source.attributes).forEach((attribute) => {
        if (
          attribute.name === 'id'
          || attribute.name === 'data-collection'
          || attribute.name === 'data-nanquim-paper-annotations'
        ) return
        if (attribute.namespaceURI) {
          node.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value)
        } else {
          node.setAttribute(attribute.name, attribute.value)
        }
      })
      Array.from(source.childNodes).forEach((child) => {
        node.appendChild(document.importNode(child, true))
      })
    }

    group.attr({
      id: PAPER_ANNOTATIONS_ID,
      name: group.attr('name') || 'Annotations',
      'data-collection': 'true',
      'data-locked': group.attr('data-locked') === 'true' ? 'true' : 'false',
      'data-nanquim-paper-annotations': 'true',
    })
    Object.entries(PAPER_ANNOTATION_STYLE).forEach(([property, fallback]) => {
      if (!node.style.getPropertyValue(property) && !node.hasAttribute(property)) {
        group.css(property, fallback)
      }
    })
  }

  function _createPaperInfrastructure({
    config = editor.paperConfig,
    annotations = null,
    viewportStates = [],
  } = {}) {
    const canvas = document.createElement('div')
    canvas.id = 'paper-canvas'
    canvas.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:#6b6b6b;overflow:hidden;display:none;align-items:center;justify-content:center;'

    const infrastructure = {
      annotationsGroup: null,
      canvas,
      config: {
        ...config,
        colorMap: { ...(config?.colorMap || {}) },
      },
      paperHandlers: null,
      paperSheet: null,
      paperSvg: null,
      viewportCounter: 0,
      viewports: [],
      viewportsGroup: null,
    }

    try {
      infrastructure.paperSvg = SVG().addTo(canvas).size('100%', '100%')
      infrastructure.paperSvg.addClass('paper-canvas-svg')
      infrastructure.paperSvg.node.style.cssText = 'width:100%;height:100%;'
      infrastructure.paperSheet = infrastructure.paperSvg.group().attr('id', 'paper-background')
      infrastructure.viewportsGroup = infrastructure.paperSvg.group().attr('id', 'paper-viewports')
      infrastructure.annotationsGroup = infrastructure.paperSvg.group()
      _populateAnnotations(infrastructure.annotationsGroup, annotations)
      infrastructure.paperHandlers = infrastructure.paperSvg.group().attr('id', 'paper-handlers')
      _renderPaperSheetFor(infrastructure.paperSheet, infrastructure.config)
      _updatePaperViewboxFor(infrastructure.paperSvg, infrastructure.config)

      const usedIds = new Set(viewportStates.map(state => state.id).filter(Boolean))
      usedIds.forEach((id) => {
        const match = /^vp-(\d+)$/.exec(id)
        if (match) {
          infrastructure.viewportCounter = Math.max(
            infrastructure.viewportCounter,
            Number(match[1]),
          )
        }
      })
      viewportStates.forEach((state) => {
        let id = state.id
        if (!id) {
          do {
            infrastructure.viewportCounter += 1
            id = `vp-${infrastructure.viewportCounter}`
          } while (usedIds.has(id))
        }
        usedIds.add(id)
        const viewport = new PaperViewport(editor, infrastructure.viewportsGroup, {
          ...state,
          id,
          svgRoot: infrastructure.paperSvg,
        })
        infrastructure.viewports.push(viewport)
      })
      return infrastructure
    } catch (error) {
      infrastructure.viewports.forEach((viewport) => {
        try { viewport.destroy() } catch (_) { /* detached best-effort cleanup */ }
      })
      canvas.remove()
      throw error
    }
  }

  function _insertPaperCanvas(canvas) {
    const terminal = editor.canvas.querySelector('.terminal')
    editor.canvas.insertBefore(canvas, terminal || null)
  }

  function _currentInfrastructure() {
    if (!paperSvg) return null
    return {
      annotationsGroup,
      canvas: paperCanvasElement,
      config: editor.paperConfig,
      paperHandlers,
      paperSheet,
      paperSvg,
      viewportCounter,
      viewports,
      viewportsGroup,
    }
  }

  function _installInfrastructure(infrastructure) {
    paperSvg = infrastructure?.paperSvg || null
    paperCanvasElement = infrastructure?.canvas || null
    paperSheet = infrastructure?.paperSheet || null
    annotationsGroup = infrastructure?.annotationsGroup || null
    viewportsGroup = infrastructure?.viewportsGroup || null
    viewports = infrastructure?.viewports || []
    viewportCounter = infrastructure?.viewportCounter || 0
    paperHandlers = infrastructure?.paperHandlers || null

    if (!infrastructure) {
      delete editor.paperAnnotations
      delete editor.paperViewportsGroup
      delete editor.paperSvg
      delete editor.paperViewports
      return
    }
    editor.paperAnnotations = annotationsGroup
    editor.paperViewportsGroup = viewportsGroup
    editor.paperSvg = paperSvg
    editor.paperViewports = viewports
  }

  function _buildPaperSVG() {
    const infrastructure = _createPaperInfrastructure()
    _insertPaperCanvas(infrastructure.canvas)
    _installInfrastructure(infrastructure)
  }

  function _annotationStyleFromGroup() {
    const style = {}
    const node = annotationsGroup.node
    for (let index = 0; index < node.style.length; index += 1) {
      const property = node.style.item(index)
      if (property === 'display') continue
      style[property] = node.style.getPropertyValue(property)
    }
    Object.entries(PAPER_ANNOTATION_STYLE).forEach(([property, fallback]) => {
      if (style[property] === undefined || style[property] === '') {
        style[property] = annotationsGroup.attr(property) || fallback
      }
    })
    return style
  }

  function _registerAnnotationsCollection() {
    if (!annotationsGroup || !editor.collections) return null

    const existing = editor.collections.get(PAPER_ANNOTATIONS_ID)
    if (existing && existing.group === annotationsGroup) {
      annotationCollectionState = {
        visible: existing.visible !== false,
        locked: existing.locked === true,
        style: { ...(existing.style || {}) },
        collapsed: existing.collapsed === true,
      }
      return existing
    }

    const saved = annotationCollectionState
    const data = {
      group: annotationsGroup,
      visible: saved ? saved.visible : annotationsGroup.css('display') !== 'none',
      locked: saved ? saved.locked : annotationsGroup.attr('data-locked') === 'true',
      style: saved ? { ...saved.style } : _annotationStyleFromGroup(),
      collapsed: saved ? saved.collapsed : existing?.collapsed === true,
    }
    annotationsGroup.attr('data-locked', data.locked ? 'true' : 'false')
    if (data.visible) annotationsGroup.show()
    else annotationsGroup.hide()
    editor.collections.set(PAPER_ANNOTATIONS_ID, data)
    annotationCollectionState = {
      visible: data.visible,
      locked: data.locked,
      style: { ...data.style },
      collapsed: data.collapsed,
    }
    return data
  }

  /**
   * Build and register the persistent Paper roots without switching mode,
   * replacing handlers, hiding Model Space, or changing the active collection.
   */
  function ensureDocumentInfrastructure() {
    if (!paperSvg) _buildPaperSVG()

    editor.paperAnnotations = annotationsGroup
    editor.paperViewportsGroup = viewportsGroup
    editor.paperSvg = paperSvg
    editor.paperViewports = viewports
    _registerAnnotationsCollection()
    editor.documentState?.refreshPersistentRoots()

    return {
      svg: paperSvg,
      annotations: annotationsGroup,
      viewportsGroup,
    }
  }

  /**
   * Remove all Paper DOM and state so a failed document transaction can
   * restore the exact pre-infrastructure state. Removing the owning canvas is
   * deliberate: it also cleans up SVG nodes left by a partially constructed
   * viewport that was never added to the viewports array.
   */
  function destroyDocumentInfrastructure(options = {}) {
    const paperCanvas = paperCanvasElement || domNode(paperSvg)?.closest?.('#paper-canvas')
    const hadInfrastructure = Boolean(
      paperSvg
      || paperSheet
      || annotationsGroup
      || viewportsGroup
      || paperHandlers
      || paperCanvas,
    )
    if (!hadInfrastructure) return false

    const previous = {
      annotationsGroup,
      paperHandlers,
      paperSvg,
      viewports,
      viewportsGroup,
    }
    editor.documentState?.unobservePersistentRoot(previous.annotationsGroup)

    let cleanupError = null
    previous.viewports.forEach((viewport) => {
      try {
        viewport.destroy()
      } catch (error) {
        cleanupError ||= error
      }
    })
    paperCanvas?.remove()

    if (editor.collections?.get(PAPER_ANNOTATIONS_ID)?.group === previous.annotationsGroup) {
      editor.collections.delete(PAPER_ANNOTATIONS_ID)
    }
    if (editor.activeCollection === previous.annotationsGroup) {
      editor.activeCollection = savedActiveCollection || null
    }
    if (editor.handlers === previous.paperHandlers) editor.handlers = editor.modelHandlers
    if (editor.paperSvg === previous.paperSvg) delete editor.paperSvg
    if (editor.paperAnnotations === previous.annotationsGroup) delete editor.paperAnnotations
    if (editor.paperViewportsGroup === previous.viewportsGroup) delete editor.paperViewportsGroup
    if (editor.paperViewports === previous.viewports) delete editor.paperViewports

    paperSvg = null
    paperCanvasElement = null
    paperSheet = null
    annotationsGroup = null
    viewportsGroup = null
    viewports = []
    viewportCounter = 0
    paperHandlers = null
    savedActiveCollection = null
    annotationCollectionState = null

    if (options.notify !== false) _notifyViewportChange()
    _markDocumentChanged('paper-infrastructure-destroyed', options)
    if (cleanupError) throw cleanupError
    return true
  }

  function _renderPaperSheet() {
    if (!paperSvg) return
    _renderPaperSheetFor(paperSheet, editor.paperConfig)
  }

  function _updatePaperViewbox() {
    _updatePaperViewboxFor(paperSvg, editor.paperConfig)
  }

  function _getPaperDimsSVG() {
    return _paperDimensions(editor.paperConfig)
  }

  function _refreshAllViewports() {
    // With live <use> references, viewports auto-update.
    // We only need to update transforms if model content changed orientation.
    // Trigger a visual refresh for all viewports.
    viewports.forEach(vp => vp.refreshTransform())
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Create a new viewport rectangle.
   * @param {number} x - SVG units from paper left
   * @param {number} y - SVG units from paper top
   * @param {number} w - width in SVG units
   * @param {number} h - height in SVG units
   * @param {number} scale - drawing scale denominator (e.g. 100 for 1:100)
   */
  function _finiteViewportNumber(value, label, {
    positive = false,
    min = -Infinity,
    max = Infinity,
  } = {}) {
    const number = Number(value)
    if (
      !Number.isFinite(number)
      || (positive && number <= 0)
      || number < min
      || number > max
    ) {
      throw new TypeError(`${label} must be ${positive ? 'positive and ' : ''}finite.`)
    }
    return Object.is(number, -0) ? 0 : number
  }

  function _normalizeViewportId(value, index) {
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string' || value.length > 256 || /[\s\u0000-\u001f\u007f#()"']/.test(value)) {
      throw new TypeError(`Paper viewport ${index + 1} has an invalid id.`)
    }
    return value
  }

  function _normalizeViewportState(value, index) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`Paper viewport ${index + 1} is invalid.`)
    }
    return {
      id: _normalizeViewportId(value.id, index),
      x: _finiteViewportNumber(value.x, `Paper viewport ${index + 1} x`, {
        min: -MAX_PAPER_VIEWPORT_COORDINATE,
        max: MAX_PAPER_VIEWPORT_COORDINATE,
      }),
      y: _finiteViewportNumber(value.y, `Paper viewport ${index + 1} y`, {
        min: -MAX_PAPER_VIEWPORT_COORDINATE,
        max: MAX_PAPER_VIEWPORT_COORDINATE,
      }),
      w: _finiteViewportNumber(value.w, `Paper viewport ${index + 1} width`, {
        min: MIN_PAPER_VIEWPORT_DIMENSION,
        max: MAX_PAPER_VIEWPORT_COORDINATE,
      }),
      h: _finiteViewportNumber(value.h, `Paper viewport ${index + 1} height`, {
        min: MIN_PAPER_VIEWPORT_DIMENSION,
        max: MAX_PAPER_VIEWPORT_COORDINATE,
      }),
      scale: _finiteViewportNumber(value.scale, `Paper viewport ${index + 1} scale`, {
        min: MIN_PAPER_SCALE,
        max: MAX_PAPER_SCALE,
      }),
      modelOriginX: _finiteViewportNumber(
        value.modelOriginX,
        `Paper viewport ${index + 1} model origin x`,
        { min: -MAX_PAPER_ORIGIN, max: MAX_PAPER_ORIGIN },
      ),
      modelOriginY: _finiteViewportNumber(
        value.modelOriginY,
        `Paper viewport ${index + 1} model origin y`,
        { min: -MAX_PAPER_ORIGIN, max: MAX_PAPER_ORIGIN },
      ),
      visible: value.visible !== false,
      locked: value.locked === true,
    }
  }

  function _rememberViewportId(id) {
    const match = /^vp-(\d+)$/.exec(id)
    if (!match) return
    const numericId = Number(match[1])
    if (Number.isSafeInteger(numericId)) viewportCounter = Math.max(viewportCounter, numericId)
  }

  function _nextViewportId() {
    let id
    do {
      viewportCounter += 1
      id = `vp-${viewportCounter}`
    } while (viewports.some(viewport => viewport.id === id))
    return id
  }

  function _appendViewport(state) {
    const previousCounter = viewportCounter
    const id = state.id || _nextViewportId()
    if (viewports.some(viewport => viewport.id === id)) {
      throw new TypeError(`Paper viewport id "${id}" is duplicated.`)
    }
    _rememberViewportId(id)
    const hadDefinitions = Array.from(paperSvg.node.children)
      .some(node => node.localName === 'defs')
    const definitions = paperSvg.defs()
    const snapshots = [viewportsGroup.node, definitions.node, paperSvg.node]
      .map((parent) => ({ parent, children: new Set(Array.from(parent.children)) }))

    let vp
    try {
      vp = new PaperViewport(editor, viewportsGroup, { ...state, id })
    } catch (error) {
      const cleanupErrors = []
      snapshots.forEach(({ children, parent }) => {
        Array.from(parent.children).forEach((node) => {
          if (children.has(node)) return
          try {
            node.remove()
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError)
          }
        })
      })
      if (!hadDefinitions && definitions.node.childElementCount === 0) {
        try {
          definitions.remove()
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      viewportCounter = previousCounter
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          `${error.message} Cleaning up the incomplete Paper viewport also failed.`,
        )
      }
      throw error
    }
    viewports.push(vp)
    editor.paperViewports = viewports
    return vp
  }

  function _markDocumentChanged(reason, options = {}) {
    if (options.silent === true || options.restoring === true) return false
    return editor.documentState?.markChanged(reason) || false
  }

  function _withoutDocumentTracking(callback) {
    return editor.documentState?.runWithoutTracking
      ? editor.documentState.runWithoutTracking(callback)
      : callback()
  }

  function _notifyViewportChange() {
    try {
      signals.paperViewportsChanged.dispatch()
    } catch (error) {
      try { console.error('[PaperEditor] A viewport listener failed:', error) } catch (_reportError) {}
    }
    try {
      signals.updatedOutliner.dispatch()
    } catch (error) {
      try { console.error('[PaperEditor] An outliner listener failed:', error) } catch (_reportError) {}
    }
  }

  function createViewport(x, y, w, h, scale = 100, options = {}) {
    ensureDocumentInfrastructure()

    // Compute model origin so that the drawing content is centered in the viewport
    let modelOriginX = options.modelOriginX
    let modelOriginY = options.modelOriginY
    const bbox = editor._drawingBBox
    if (modelOriginX === undefined && modelOriginY === undefined && bbox) {
      const cx = bbox.x + bbox.width / 2
      const cy = bbox.y + bbox.height / 2
      const modelUnitsPerPaperUnit = scale / editor.paperConfig.unitsPerCm
      modelOriginX = cx - (w / 2) * modelUnitsPerPaperUnit
      modelOriginY = cy - (h / 2) * modelUnitsPerPaperUnit
    }
    if (modelOriginX === undefined) modelOriginX = 0
    if (modelOriginY === undefined) modelOriginY = 0

    const state = _normalizeViewportState({
      id: options.id,
      x, y, w, h,
      scale,
      modelOriginX,
      modelOriginY,
      visible: options.visible,
      locked: options.locked,
    }, viewports.length)
    const vp = _appendViewport(state)
    if (options.notify !== false) _notifyViewportChange()
    _markDocumentChanged('paper-viewport-created', options)
    return vp
  }

  /**
   * Remove a viewport by id.
   */
  function removeViewport(vpId, options = {}) {
    const idx = viewports.findIndex(v => v.id === vpId)
    if (idx === -1) return false
    viewports[idx].destroy()
    viewports.splice(idx, 1)
    editor.paperViewports = viewports
    if (options.notify !== false) _notifyViewportChange()
    _markDocumentChanged('paper-viewport-removed', options)
    return true
  }

  function _replaceAnnotations(source) {
    _populateAnnotations(annotationsGroup, source)

    editor.collections?.delete(PAPER_ANNOTATIONS_ID)
    annotationCollectionState = null
    _registerAnnotationsCollection()
  }

  /**
   * Construct a complete Paper document off-DOM. No live editor references,
   * collections, selection, or existing viewport objects are touched here.
   */
  function prepareDocumentState(state = {}) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new TypeError('Paper document state must be an object.')
    }
    const annotationNode = domNode(state.annotations)
    if (annotationNode && !isElement(annotationNode)) {
      throw new TypeError('Paper annotations must be an SVG element.')
    }
    const annotationSnapshot = annotationNode ? annotationNode.cloneNode(true) : null
    const sourceViewports = state.viewports === undefined || state.viewports === null
      ? []
      : state.viewports
    if (!Array.isArray(sourceViewports) || sourceViewports.length > 256) {
      throw new TypeError('Paper viewports must be an array with at most 256 entries.')
    }
    const normalizedViewports = sourceViewports.map(_normalizeViewportState)
    const ids = new Set()
    normalizedViewports.forEach((viewport) => {
      if (!viewport.id) return
      if (ids.has(viewport.id)) throw new TypeError(`Paper viewport id "${viewport.id}" is duplicated.`)
      ids.add(viewport.id)
    })

    const sourceConfig = state.config === undefined ? editor.paperConfig : state.config
    if (!sourceConfig || typeof sourceConfig !== 'object' || Array.isArray(sourceConfig)) {
      throw new TypeError('Paper configuration must be an object.')
    }
    for (const property of ['width', 'height', 'unitsPerCm']) {
      const value = Number(sourceConfig[property])
      if (!Number.isFinite(value) || value <= 0) {
        throw new TypeError(`Paper configuration ${property} must be positive and finite.`)
      }
    }

    const prepared = {
      infrastructure: _createPaperInfrastructure({
        annotations: annotationSnapshot,
        config: sourceConfig,
        viewportStates: normalizedViewports,
      }),
      status: 'prepared',
      transaction: null,
    }
    preparedDocumentStates.add(prepared)
    return prepared
  }

  function _disposeInfrastructure(infrastructure) {
    if (!infrastructure) return
    infrastructure.viewports.forEach((viewport) => {
      try { viewport.destroy() } catch (_) { /* detached best-effort cleanup */ }
    })
    try { infrastructure.canvas?.remove() } catch (_) { /* detached best-effort cleanup */ }
  }

  function disposePreparedDocumentState(prepared) {
    if (!preparedDocumentStates.has(prepared) || prepared.status !== 'prepared') return false
    _disposeInfrastructure(prepared.infrastructure)
    prepared.status = 'disposed'
    return true
  }

  /**
   * Atomically adopt a prepared Paper document. The previous infrastructure is
   * detached but kept intact until finalize(), so rollback() restores the exact
   * viewport objects, SVG nodes, listeners, and collection entry.
   */
  function adoptPreparedDocumentState(prepared, options = {}) {
    if (!preparedDocumentStates.has(prepared) || prepared.status !== 'prepared') {
      throw new TypeError('A prepared Paper document is required.')
    }

    const candidate = prepared.infrastructure
    const previous = _currentInfrastructure()
    const previousConfig = editor.paperConfig
    const previousAnnotationCollectionState = annotationCollectionState
    const collections = editor.collections
    const hadCollection = collections?.has(PAPER_ANNOTATIONS_ID) === true
    const previousCollection = collections?.get(PAPER_ANNOTATIONS_ID)
    const previousParent = previous?.canvas?.parentNode || null
    const previousNextSibling = previous?.canvas?.nextSibling || null
    prepared.status = 'adopting'

    const rollback = () => {
      if (!['adopting', 'adopted'].includes(prepared.status)) return false
      try {
        editor.documentState?.unobservePersistentRoot(candidate.annotationsGroup)
      } catch (_) { /* continue exact structural restoration */ }

      try {
        if (candidate.canvas.parentNode) {
          if (previous?.canvas && !previous.canvas.parentNode) {
            candidate.canvas.parentNode.replaceChild(previous.canvas, candidate.canvas)
          } else {
            candidate.canvas.remove()
          }
        } else if (previous?.canvas && !previous.canvas.parentNode && previousParent) {
          const reference = previousNextSibling?.parentNode === previousParent
            ? previousNextSibling
            : null
          previousParent.insertBefore(previous.canvas, reference)
        }
      } catch (error) {
        console.error('[PaperEditor] Failed to restore the previous Paper canvas.', error)
      }

      _installInfrastructure(previous)
      editor.paperConfig = previousConfig
      annotationCollectionState = previousAnnotationCollectionState
      try {
        if (collections) {
          if (hadCollection) collections.set(PAPER_ANNOTATIONS_ID, previousCollection)
          else collections.delete(PAPER_ANNOTATIONS_ID)
        }
      } catch (error) {
        console.error('[PaperEditor] Failed to restore the Paper collection entry.', error)
      }
      try {
        editor.documentState?.observePersistentRoot(previous?.annotationsGroup)
      } catch (_) { /* the exact root remains installed even if observation fails */ }
      _disposeInfrastructure(candidate)
      prepared.status = 'rolled-back'
      return true
    }

    try {
      editor.documentState?.unobservePersistentRoot(previous?.annotationsGroup)
      if (previous?.canvas?.parentNode) {
        previous.canvas.parentNode.replaceChild(candidate.canvas, previous.canvas)
      } else {
        _insertPaperCanvas(candidate.canvas)
      }
      _installInfrastructure(candidate)
      editor.paperConfig = candidate.config
      annotationCollectionState = null
      _registerAnnotationsCollection()
      editor.documentState?.refreshPersistentRoots()
      prepared.status = 'adopted'
    } catch (error) {
      rollback()
      throw error
    }

    const transaction = {
      rollback,
      finalize() {
        if (prepared.status !== 'adopted') return false
        _disposeInfrastructure(previous)
        prepared.status = 'finalized'
        return true
      },
    }
    prepared.transaction = transaction
    return transaction
  }

  /**
   * Replace Paper annotations and viewports from a fully validated document
   * candidate. The source annotation tree is cloned and never attached.
   */
  function replaceDocumentState(state = {}, options = {}) {
    const prepared = prepareDocumentState(state)
    let transaction
    try {
      transaction = _withoutDocumentTracking(
        () => adoptPreparedDocumentState(prepared, { ...options, notify: false }),
      )
      transaction.finalize()
    } catch (error) {
      if (prepared.status === 'prepared') disposePreparedDocumentState(prepared)
      else transaction?.rollback()
      throw error
    }

    if (options.notify !== false) _notifyViewportChange()
    _markDocumentChanged(options.reason || 'paper-document-replaced', options)
    return { annotations: annotationsGroup, viewports }
  }

  function resetDocumentState(options = {}) {
    return replaceDocumentState({ annotations: null, viewports: [] }, {
      ...options,
      reason: 'paper-document-reset',
    })
  }

  /**
   * Get all unique stroke + fill colors currently used in model drawing.
   * Returns an array of hex color strings.
   */
  function getUsedColors() {
    const colors = new Set()
    const colorContext = document.createElement('canvas').getContext('2d')
    const scan = (node) => {
      if (!node || node.nodeType !== 1) return
      if (node.getAttribute('data-hidden') === 'true' || node.getAttribute('data-gn-source') === 'true') return
      const remembered = livePaintSources.get(node)
      let resolvedStyle = null
      try { resolvedStyle = window.getComputedStyle?.(node) || null } catch (_) {}
      ;['stroke', 'fill'].forEach((property) => {
        const color = remembered?.[property]?.source
          || resolvePaperPaint(node, property, colorContext, resolvedStyle)
        if (color) colors.add(color)
      })

      Array.from(node.children).forEach(scan)
    }
    Array.from(editor.drawing.node.children).forEach(scan)
    getPaperModelDefinitionSources(editor).forEach(scan)
    return Array.from(colors).filter(Boolean)
  }

  /**
   * Update the paper size (preset or custom).
   */
  function setPaperSize(sizeKey, customW, customH, options = {}) {
    const cfg = editor.paperConfig
    const previous = { size: cfg.size, width: cfg.width, height: cfg.height }
    if (sizeKey === 'custom') {
      const width = customW === undefined ? cfg.width : Number(customW)
      const height = customH === undefined ? cfg.height : Number(customH)
      if (
        !Number.isFinite(width)
        || !Number.isFinite(height)
        || width < MIN_PAPER_DIMENSION
        || height < MIN_PAPER_DIMENSION
        || width > MAX_PAPER_DIMENSION
        || height > MAX_PAPER_DIMENSION
      ) return false
      cfg.size = 'custom'
      cfg.width = width
      cfg.height = height
    } else if (PAPER_SIZES[sizeKey]) {
      cfg.size = sizeKey
      const dims = PAPER_SIZES[sizeKey]
      if (cfg.orientation === 'landscape') {
        cfg.width = dims.height
        cfg.height = dims.width
      } else {
        cfg.width = dims.width
        cfg.height = dims.height
      }
    } else {
      return false
    }
    const changed = previous.size !== cfg.size
      || previous.width !== cfg.width
      || previous.height !== cfg.height
    if (!changed) return false

    ensureDocumentInfrastructure()
    _renderPaperSheet()
    _updatePaperViewbox()
    _markDocumentChanged('paper-size', options)
    return true
  }

  /**
   * Toggle orientation between portrait and landscape.
   */
  function setOrientation(orientation, options = {}) {
    const cfg = editor.paperConfig
    if (!['portrait', 'landscape'].includes(orientation) || cfg.orientation === orientation) return false
    cfg.orientation = orientation
    // Swap dimensions
    const tmp = cfg.width
    cfg.width = cfg.height
    cfg.height = tmp
    ensureDocumentInfrastructure()
    _renderPaperSheet()
    _updatePaperViewbox()
    _markDocumentChanged('paper-orientation', options)
    return true
  }

  /**
   * Set the conversion between drawing units and one paper centimeter.
   */
  function setUnitsPerCm(value, options = {}) {
    const unitsPerCm = Number(value)
    if (!Number.isFinite(unitsPerCm) || unitsPerCm <= 0 || unitsPerCm > 1000000) {
      return false
    }
    if (editor.paperConfig.unitsPerCm === unitsPerCm) return false

    editor.paperConfig.unitsPerCm = unitsPerCm
    ensureDocumentInfrastructure()
    _renderPaperSheet()
    _updatePaperViewbox()
    _refreshAllViewports()
    invalidateSpatialIndexes(editor)
    _markDocumentChanged('paper-units-per-centimeter', options)
    return true
  }

  // Export wrappers
  function doExportSVG() {
    exportPaperSVG(editor, viewports)
  }
  function doExportPDF() {
    exportPaperPDF(editor, viewports)
  }

  // ── Live Color Mapping ─────────────────────────────────────────────────────

  function _applyLiveColorMapping() {
    const cfg = editor.paperConfig
    const colorContext = document.createElement('canvas').getContext('2d')
    const colorMap = normalizedPaperColorMap(cfg.colorMap, colorContext)

    // Always return to the authored cascade before resolving class and
    // inherited paints. Otherwise a previous print mapping becomes the source
    // of the next update and inherited descendants drift between colors.
    _clearLiveColorMapping()
    if (colorMap.size === 0) return

    const scan = (node) => {
      if (!node || node.nodeType !== 1) return
      if (node.getAttribute('data-hidden') === 'true' || node.getAttribute('data-gn-source') === 'true') return

      // Only process geometry elements that might have stroke/fill
      if (['g', 'path', 'line', 'circle', 'ellipse', 'rect', 'text', 'tspan', 'polyline', 'polygon', 'use'].includes(node.localName)) {
        let resolvedStyle = null
        try { resolvedStyle = window.getComputedStyle?.(node) || null } catch (_) {}
        ;['stroke', 'fill'].forEach(property => {
          const source = resolvePaperPaint(node, property, colorContext, resolvedStyle)
          const printColor = source ? colorMap.get(source) : null
          if (!printColor || printColor === source) return

          const dataKey = 'nanquimOrig' + property.charAt(0).toUpperCase() + property.slice(1)
          const remembered = livePaintSources.get(node) || {}
          remembered[property] = {
            source,
            inline: node.style.getPropertyValue(property),
            hadStyleAttribute: node.hasAttribute('style'),
          }
          livePaintSources.set(node, remembered)
          livePaintNodes.add(node)
          node.dataset[dataKey] = remembered[property].inline
          node.style.setProperty(property, printColor)
        })
      }

      Array.from(node.children).forEach(scan)
    }
    scan(editor.drawing.node)
    getPaperModelDefinitionSources(editor).forEach(scan)
  }

  function _clearLiveColorMapping() {
    const restore = (node) => {
      if (!node || node.nodeType !== 1) return
      const rememberedPaints = livePaintSources.get(node)
      const preserveEmptyStyle = Object.values(rememberedPaints || {})
        .some(entry => entry.hadStyleAttribute)
      // Restore original colors
      ;['stroke', 'fill'].forEach(property => {
        const dataKey = 'nanquimOrig' + property.charAt(0).toUpperCase() + property.slice(1)
        if (dataKey in node.dataset) {
          const remembered = livePaintSources.get(node)?.[property]
          const original = remembered?.inline ?? node.dataset[dataKey]
          if (original) node.style.setProperty(property, original)
          else node.style.removeProperty(property)
          delete node.dataset[dataKey]
        }
      })
      if (!preserveEmptyStyle && !node.getAttribute('style')?.trim()) {
        node.removeAttribute('style')
      }
    }
    livePaintNodes.forEach(restore)
    editor.svg?.node?.querySelectorAll(
      '[data-nanquim-orig-stroke], [data-nanquim-orig-fill]',
    ).forEach(restore)
    livePaintSources = new WeakMap()
    livePaintNodes = new Set()
  }

  // ── Signals: keep viewports in sync with model changes ────────────────────
  signals.modelContentChanged.add(() => {
    if (editor.mode === 'paper') {
      _refreshAllViewports()
      _withoutDocumentTracking(_applyLiveColorMapping)
    }
  })

  signals.colorMapUpdated.add(() => {
    if (editor.mode === 'paper') {
      _withoutDocumentTracking(_applyLiveColorMapping)
    }
    _markDocumentChanged('paper-color-map-updated')
  })

  signals.updatedCollections.add(() => {
    // Model collection hydration replaces the registry Map. Paper annotations
    // live in a separate persistent root, so restore their entry whenever the
    // model registry changes.
    if (annotationsGroup) _registerAnnotationsCollection()
    if (editor.mode === 'paper') {
      _withoutDocumentTracking(_applyLiveColorMapping)
    }
  })

  signals.updatedOutliner.add(() => {
    if (annotationsGroup) _registerAnnotationsCollection()
    if (editor.mode === 'paper') {
      _withoutDocumentTracking(_applyLiveColorMapping)
    }
  })

  signals.editorModeChanged.add((newMode) => {
    if (newMode === 'paper') {
      activate()
    } else {
      deactivate()
    }
  })

  // ── Public interface ────────────────────────────────────────────────────────
  this.activate = activate
  this.deactivate = deactivate
  this.getActiveModelCollection = getActiveModelCollection
  this.ensureDocumentInfrastructure = ensureDocumentInfrastructure
  this.destroyDocumentInfrastructure = destroyDocumentInfrastructure
  this.prepareDocumentState = prepareDocumentState
  this.adoptPreparedDocumentState = adoptPreparedDocumentState
  this.disposePreparedDocumentState = disposePreparedDocumentState
  this.replaceDocumentState = replaceDocumentState
  this.resetDocumentState = resetDocumentState
  this.createViewport = createViewport
  this.removeViewport = removeViewport
  this.getUsedColors = getUsedColors
  this.getLivePaintSource = (node, property) => livePaintSources.get(node)?.[property]?.source || null
  this.setPaperSize = setPaperSize
  this.setOrientation = setOrientation
  this.setUnitsPerCm = setUnitsPerCm
  this.exportSVG = doExportSVG
  this.exportPDF = doExportPDF
  this.getPaperDimsSVG = _getPaperDimsSVG
  this.PAPER_SIZES = PAPER_SIZES
}

export { PaperEditor }
