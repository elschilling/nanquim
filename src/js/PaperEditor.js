/**
 * PaperEditor.js
 *
 * Manages the Paper Space editor mode.
 *
 * Coordinate system:
 *   - Paper dimensions are stored in mm.
 *   - SVG user units: 1 unit = 1cm by default (editor.paperConfig.unitsPerCm = 1).
 *   - So a paper of 210x297mm (A4) = 21x29.7 SVG units.
 *   - A viewport at 1:100 scale means 1m of draw space = 1cm on paper = 1 SVG unit.
 *
 * Viewport rendering strategy: LIVE <use> references.
 *   - Each PaperViewport creates an SVG <use> pointing to editor.drawing's DOM id.
 *   - The <use> element gets a transform that maps (modelOriginX, modelOriginY) at the
 *     given scale to the viewport's top-left corner.
 *   - A <clipPath> confines the visible area to the viewport rectangle.
 *   - Changes to the model are automatically visible — no re-render needed.
 */

import { PaperViewport } from './PaperViewport'
import { exportPaperSVG, exportPaperPDF } from './utils/ExportPaper'

// Standard ISO paper sizes in mm
const PAPER_SIZES = {
  A0: { width: 841, height: 1189 },
  A1: { width: 594, height: 841 },
  A2: { width: 420, height: 594 },
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  custom: { width: 210, height: 297 },
}

function PaperEditor(editor) {
  const signals = editor.signals

  // Paper SVG instance (separate from draw SVG)
  let paperSvg = null
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

  // ── Activation / Deactivation ───────────────────────────────────────────────

  function activate() {
    // Hide the draw SVG (preserving the terminal inside editor.canvas)
    editor.svg.node.style.display = 'none'

    // Create the paper SVG container if needed
    if (!paperSvg) {
      _buildPaperSVG()
    } else {
      document.getElementById('paper-canvas').style.display = 'flex'
    }

    _renderPaperSheet()
    _refreshAllViewports()
    _applyLiveColorMapping()

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
    const paperCanvasEl = document.getElementById('paper-canvas')
    if (paperCanvasEl) {
      paperCanvasEl.style.display = 'none'
    }

    // Restore draw handlers
    editor.handlers = editor.modelHandlers
    _clearLiveColorMapping()

    // Restore active collection
    if (savedActiveCollection) {
      editor.activeCollection = savedActiveCollection
    }
    
    signals.updatedOutliner.dispatch()
    signals.updatedProperties.dispatch()
  }

  // ── Internal build helpers ──────────────────────────────────────────────────

  function _buildPaperSVG() {
    const canvasContainer = editor.canvas // #canvas (holds SVG and terminal)

    // Create a new container div for the paper canvas
    const paperCanvasEl = document.createElement('div')
    paperCanvasEl.id = 'paper-canvas'
    paperCanvasEl.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:#6b6b6b;overflow:hidden;display:flex;align-items:center;justify-content:center;'
    
    // Insert before terminal to keep terminal at the bottom
    const terminalEl = canvasContainer.querySelector('.terminal')
    if (terminalEl) {
      canvasContainer.insertBefore(paperCanvasEl, terminalEl)
    } else {
      canvasContainer.appendChild(paperCanvasEl)
    }

    // Create SVG.js instance
    paperSvg = SVG().addTo('#paper-canvas')
      .size('100%', '100%')
    paperSvg.addClass('paper-canvas-svg')
    paperSvg.node.style.cssText = 'width:100%;height:100%;'

    // Groups in stacking order
    const bgGroup = paperSvg.group().attr('id', 'paper-background')
    paperSheet = bgGroup

    viewportsGroup = paperSvg.group().attr('id', 'paper-viewports')
    annotationsGroup = paperSvg.group().attr('id', 'paper-annotations')
    annotationsGroup.attr('data-collection', 'true')
    annotationsGroup.attr('name', 'Annotations')

    // Register annotationsGroup in editor.collections for styling and outliner
    if (editor.collections) {
      editor.collections.set('paper-annotations', {
        group: annotationsGroup,
        visible: true,
        locked: false,
        style: {
          stroke: 'black',
          'stroke-width': 0.1,
          'stroke-linecap': 'round',
          fill: 'transparent',
        },
      })
    }

    paperHandlers = paperSvg.group().attr('id', 'paper-handlers')

    // Store reference so commands can add to annotations
    editor.paperAnnotations = annotationsGroup
    editor.paperViewportsGroup = viewportsGroup
    editor.paperSvg = paperSvg
    editor.paperViewports = viewports

    // Set initial viewbox to paper sheet dimensions
    _updatePaperViewbox()
  }

  function _renderPaperSheet() {
    if (!paperSvg) return
    paperSheet.clear()

    const { wSVG, hSVG } = _getPaperDimsSVG()

    // Shadow
    paperSheet.rect(wSVG, hSVG)
      .move(0.2, 0.2)
      .fill('#00000033')
      .stroke('none')

    // White paper surface
    paperSheet.rect(wSVG, hSVG)
      .move(0, 0)
      .fill('white')
      .stroke('#cccccc')
      .attr('stroke-width', 0.02)
  }

  function _updatePaperViewbox() {
    const { wSVG, hSVG } = _getPaperDimsSVG()
    // Show paper with some margin around it
    const margin = Math.max(wSVG, hSVG) * 0.15
    paperSvg.viewbox(-margin, -margin, wSVG + margin * 2, hSVG + margin * 2)
  }

  function _getPaperDimsSVG() {
    const cfg = editor.paperConfig
    // Convert mm → SVG units: unitsPerCm means 1cm = unitsPerCm SVG units
    // paperWidth mm / 10 = cm, then × unitsPerCm = SVG units
    const scale = cfg.unitsPerCm / 10 // SVG units per mm
    const wSVG = cfg.width * scale
    const hSVG = cfg.height * scale
    return { wSVG, hSVG }
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
  function createViewport(x, y, w, h, scale = 100) {
    viewportCounter++
    const vp = new PaperViewport(editor, viewportsGroup, {
      id: 'vp-' + viewportCounter,
      x, y, w, h,
      scale,
      modelOriginX: 0,
      modelOriginY: 0,
    })
    viewports.push(vp)
    editor.paperViewports = viewports
    signals.paperViewportsChanged.dispatch()
    signals.updatedOutliner.dispatch()
    return vp
  }

  /**
   * Remove a viewport by id.
   */
  function removeViewport(vpId) {
    const idx = viewports.findIndex(v => v.id === vpId)
    if (idx === -1) return
    viewports[idx].destroy()
    viewports.splice(idx, 1)
    editor.paperViewports = viewports
    signals.paperViewportsChanged.dispatch()
    signals.updatedOutliner.dispatch()
  }

  /**
   * Get all unique stroke + fill colors currently used in model drawing.
   * Returns an array of hex color strings.
   */
  function getUsedColors() {
    const colors = new Set()
    const scan = (el) => {
      if (!el || !el.node) return
      const addColor = (c) => {
        if (!c || c === 'none' || c === 'transparent') return
        colors.add(normalizeColor(c))
      }
      addColor(el.css('stroke') || el.attr('stroke'))
      addColor(el.css('fill') || el.attr('fill'))
      
      if (el.children) {
        el.children().each(child => scan(child))
      }
    }
    editor.drawing.children().each(collGroup => scan(collGroup))
    return Array.from(colors).filter(Boolean)
  }

  /**
   * Update the paper size (preset or custom).
   */
  function setPaperSize(sizeKey, customW, customH) {
    const cfg = editor.paperConfig
    if (sizeKey === 'custom') {
      cfg.size = 'custom'
      cfg.width = customW || cfg.width
      cfg.height = customH || cfg.height
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
    }
    _renderPaperSheet()
    _updatePaperViewbox()
  }

  /**
   * Toggle orientation between portrait and landscape.
   */
  function setOrientation(orientation) {
    const cfg = editor.paperConfig
    if (cfg.orientation === orientation) return
    cfg.orientation = orientation
    // Swap dimensions
    const tmp = cfg.width
    cfg.width = cfg.height
    cfg.height = tmp
    _renderPaperSheet()
    _updatePaperViewbox()
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
    const colorMap = cfg.colorMap

    const scan = (el) => {
      if (!el || !el.node) return
      
      const node = el.node
      // Only process geometry elements that might have stroke/fill
      if (['g', 'path', 'line', 'circle', 'ellipse', 'rect', 'text', 'polyline', 'polygon'].includes(node.nodeName)) {
        ['stroke', 'fill'].forEach(attr => {
          const dataKey = 'nanquimOrig' + attr.charAt(0).toUpperCase() + attr.slice(1)
          
          // Get the TRUE source value. If already mapped, it's in dataset.
          // Note: we check for existence of the key, as the value might be an empty string.
          const isAlreadyMapped = dataKey in node.dataset
          const sourceVal = isAlreadyMapped ? (node.dataset[dataKey] || node.getAttribute(attr)) : (node.style[attr] || node.getAttribute(attr))

          if (!sourceVal || sourceVal === 'none' || sourceVal === 'transparent' || sourceVal === 'inherit') {
            // If it was previously mapped but the source is now gone/none, clear tracking
            if (isAlreadyMapped) {
              node.style[attr] = node.dataset[dataKey]
              delete node.dataset[dataKey]
            }
            return
          }

          let norm = normalizeColor(sourceVal)
          if (norm && colorMap[norm] && colorMap[norm].enabled && colorMap[norm].printColor !== norm) {
            // Store original inline style if not already stored
            if (!isAlreadyMapped) {
              node.dataset[dataKey] = node.style[attr] || ''
            }
            // Apply theme color
            node.style[attr] = colorMap[norm].printColor
          } else {
            // Restore if previously mapped but no longer needed (e.g. disabled in map or maps to itself)
            if (isAlreadyMapped) {
              node.style[attr] = node.dataset[dataKey]
              delete node.dataset[dataKey]
            }
          }
        })
      }

      if (el.children && typeof el.children === 'function') {
        el.children().each(child => scan(child))
      }
    }
    scan(editor.drawing)
  }

  function _clearLiveColorMapping() {
    const scan = (el) => {
      if (!el || !el.node) return
      const node = el.node
      
      // Restore original colors
      ;['Stroke', 'Fill'].forEach(suffix => {
        const dataKey = 'nanquimOrig' + suffix
        if (dataKey in node.dataset) {
          node.style[suffix.toLowerCase()] = node.dataset[dataKey]
          delete node.dataset[dataKey]
        }
      })

      if (el.children && typeof el.children === 'function') {
        el.children().each(child => scan(child))
      }
    }
    scan(editor.drawing)
  }

  // ── Signals: keep viewports in sync with model changes ────────────────────
  signals.modelContentChanged.add(() => {
    if (editor.mode === 'paper') {
      _refreshAllViewports()
      _applyLiveColorMapping()
    }
  })

  signals.colorMapUpdated.add(() => {
    if (editor.mode === 'paper') {
      _applyLiveColorMapping()
    }
  })

  signals.updatedCollections.add(() => {
    if (editor.mode === 'paper') {
      _applyLiveColorMapping()
    }
  })

  signals.updatedOutliner.add(() => {
    if (editor.mode === 'paper') {
      _applyLiveColorMapping()
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
  this.createViewport = createViewport
  this.removeViewport = removeViewport
  this.getUsedColors = getUsedColors
  this.setPaperSize = setPaperSize
  this.setOrientation = setOrientation
  this.exportSVG = doExportSVG
  this.exportPDF = doExportPDF
  this.getPaperDimsSVG = _getPaperDimsSVG
  this.PAPER_SIZES = PAPER_SIZES
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeColor(color) {
  if (!color || typeof color !== 'string') return null
  const c = color.trim().toLowerCase()
  if (c === 'none' || c === 'transparent' || c === 'inherit' || c.startsWith('url(')) return null

  // Use a shared canvas context if possible for performance, but for now this is safe
  const ctx = document.createElement('canvas').getContext('2d')
  
  // To detect invalid colors, we set a known color first and see if it changes
  ctx.fillStyle = '#123456'
  ctx.fillStyle = color
  const result = ctx.fillStyle
  
  // If result is still #123456, it means setting 'color' failed OR 'color' was actually #123456
  if (result === '#123456' && c !== '#123456') {
    return null
  }
  
  return result // returns '#rrggbb'
}

export { PaperEditor }
