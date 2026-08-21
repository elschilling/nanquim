/**
 * PaperViewport.js
 *
 * A viewport region in the Paper editor that shows a live view of the draw
 * drawing using SVG <use> elements and a <clipPath> to confine the view.
 *
 * Architecture (live reference approach):
 *   <g id="vp-N-group">
 *     <defs>
 *       <clipPath id="vp-N-clip">
 *         <rect x=vpX y=vpY width=vpW height=vpH />
 *       </clipPath>
 *     </defs>
 *     <!-- Live draw reference -->
 *     <g clip-path="url(#vp-N-clip)">
 *       <use href="#Collection" transform="translate(...) scale(...)" />
 *     </g>
 *     <!-- Viewport border frame -->
 *     <rect class="vp-frame" x=vpX y=vpY width=vpW height=vpH />
 *     <!-- Scale label -->
 *     <text class="vp-label" ...>1:100</text>
 *     <!-- Resize handles -->
 *     <rect class="vp-handle" ... />  × 4 corners + 4 edges
 *   </g>
 *
 * The draw drawing group has id="Collection" (set in Editor.js).
 * Paper geometry is stored in SVG user units, with U = paperConfig.unitsPerCm
 * user units per centimetre. At scale 1:S, model content is scaled by U/S and
 * translated so that drawOrigin lands at (vpX, vpY).
 */

import { invalidateSpatialIndexes } from './utils/invalidateSpatialIndexes'

function PaperViewport(editor, parentGroup, opts) {
  const {
    id,
    x, y, w, h,
    scale = 100,
    modelOriginX = 0,
    modelOriginY = 0,
    visible = true,
    locked = false,
  } = opts

  this.id = id
  this.x = x
  this.y = y
  this.w = w
  this.h = h
  this.scale = scale
  this.modelOriginX = modelOriginX
  this.modelOriginY = modelOriginY
  this.visible = visible !== false
  this.locked = locked === true

  // Document loading can construct a complete Paper candidate off-DOM. Once
  // adopted, editor.paperSvg points to this same root; interactive methods can
  // continue to use the editor normally.
  const svgRoot = opts.svgRoot || editor.paperSvg

  // ── Build SVG structure ───────────────────────────────────────────────────

  // Wrapping group
  const group = parentGroup.group().attr('id', id + '-group')
  group.attr('data-paper-viewport', 'true')
  group.attr('data-vp-id', id)
  group.attr('data-hidden', this.visible ? null : 'true')
  group.attr('data-locked', this.locked ? 'true' : null)

  // Defs block for clip path (attach to paper SVG defs)
  const clipId = id + '-clip'
  const clipRect = svgRoot.defs().clip().attr('id', clipId)
  clipRect.rect(w, h).move(x, y)

  // Content group with clipping
  const contentGroup = group.group()
    .attr('clip-path', `url(#${clipId})`)

  // <use> pointing to the model drawing group (id="Collection")
  const useEl = svgRoot.use(editor.drawing)
  contentGroup.add(useEl)

  // Viewport border frame (fill transparent to capture events inside)
  const frame = group.rect(w, h)
    .move(x, y)
    .fill('transparent')
    .stroke('#333333')
    .attr('stroke-width', 0.02)
    .addClass('vp-frame')

  // Scale label (bottom-left of viewport)
  const labelFontSize = Math.min(w, h) * 0.04
  const label = group.text(`1:${scale}`)
    .move(x + 0.1, y + h - labelFontSize - 0.1)
    .font({ size: labelFontSize, family: 'sans-serif' })
    .fill('#333333')
    .addClass('vp-label')

  // Store element references for updating
  this._group = group
  this._contentGroup = contentGroup
  this._clipRect = clipRect
  this._useEl = useEl
  this._frame = frame
  this._label = label
  this._editor = editor
  // Selection discovered through the shared spatial-index/hover path resolves
  // viewport descendants to this group. Carry the same viewport wrapper
  // contract used by the frame handler so Move/Delete/Properties never treat
  // the window as ordinary SVG geometry.
  group._paperVp = this

  // Apply initial transform
  this.refreshTransform()
  if (!this.visible) group.hide()

  // ── Interactions: Selection & Panning ─────────────────────────────────────
  try {
    this._attachInteractions()
  } catch (error) {
    try { frame.node.removeEventListener('dblclick', this._onDblClick) } catch (_cleanupError) {}
    try { frame.node.removeEventListener('mousedown', this._onMouseDown) } catch (_cleanupError) {}
    try { group.remove() } catch (_cleanupError) {}
    try { clipRect.remove() } catch (_cleanupError) {}
    throw error
  }
}

const MAX_PAPER_ORIGIN = 1000000000
const MAX_PAPER_SCALE = 1000000000
const MAX_PAPER_VIEWPORT_COORDINATE = 1000000
const MIN_PAPER_SCALE = 0.000001
const MIN_PAPER_VIEWPORT_DIMENSION = 0.000001

function normalizedUnitsPerCm(editor) {
  const unitsPerCm = Number(editor?.paperConfig?.unitsPerCm)
  return Number.isFinite(unitsPerCm) && unitsPerCm > 0 ? unitsPerCm : 1
}

function normalizedScale(value) {
  const scale = Number(value)
  if (
    !Number.isFinite(scale)
    || scale < MIN_PAPER_SCALE
    || scale > MAX_PAPER_SCALE
  ) return null
  return scale
}

function normalizedOrigin(value) {
  const origin = Number(value)
  if (!Number.isFinite(origin) || Math.abs(origin) > MAX_PAPER_ORIGIN) return null
  return Object.is(origin, -0) ? 0 : origin
}

function normalizedModelBounds(value) {
  const bounds = {
    x: Number(value?.x),
    y: Number(value?.y),
    width: Number(value?.width),
    height: Number(value?.height),
  }
  if (
    !Object.values(bounds).every(Number.isFinite)
    || bounds.width < 0
    || bounds.height < 0
    || (bounds.width === 0 && bounds.height === 0)
  ) return null
  return bounds
}

function currentModelBounds(editor) {
  try {
    const liveBounds = normalizedModelBounds(editor?.drawing?.node?.getBBox?.())
    if (liveBounds) return liveBounds
  } catch (_) {
    // Paper mode hides the Model SVG in browsers where getBBox then throws.
  }
  return normalizedModelBounds(editor?._drawingBBox)
}

/**
 * Update the SVG transform on the <use> element based on current
 * scale, modelOrigin, and viewport position.
 *
 * Transform math:
 *   modelPoint → paperPoint:
 *   paperX = vpX + (modelX - modelOriginX) / scale × unitsPerCm
 *   paperY = vpY + (modelY - modelOriginY) / scale × unitsPerCm
 *
 *   As SVG transform, with U SVG units per paper centimetre:
 *   translate(vpX - modelOriginX*U/scale, vpY - modelOriginY*U/scale) scale(U/scale)
 */
PaperViewport.prototype.refreshTransform = function () {
  const { x, y, scale, modelOriginX, modelOriginY, _useEl, _editor } = this
  const s = normalizedUnitsPerCm(_editor) / scale
  const tx = x - modelOriginX * s
  const ty = y - modelOriginY * s
  // Use an explicit matrix so SVG.js does not apply its default center origin.
  // Scaling the referenced drawing around its bounding-box center adds a
  // center-preservation offset, which can move otherwise centered model
  // geometry outside the viewport clip and every serialized Paper export.
  _useEl.transform({ a: s, b: 0, c: 0, d: s, e: tx, f: ty })
}

/**
 * Update visible region (clip rect + frame) after x/y/w/h changes.
 */
PaperViewport.prototype.refreshGeometry = function () {
  const { x, y, w, h, scale, _frame, _label, _clipRect } = this

  // Update clip rect
  _clipRect.clear()
  _clipRect.rect(w, h).move(x, y)

  // Update frame
  _frame.move(x, y).size(w, h)

  // Update label
  const labelFontSize = Math.min(w, h) * 0.04
  _label
    .move(x + 0.1, y + h - labelFontSize - 0.1)
    .font({ size: labelFontSize })
    .text(`1:${scale}`)

  // Update transform
  this.refreshTransform()
}

/**
 * Replace persisted viewport bounds as one user-visible change. Interactive
 * command previews may still assign temporary values directly and let History
 * own the final dirty-state transition.
 */
PaperViewport.prototype.setGeometry = function (values = {}, options = {}) {
  const next = {
    x: values.x ?? this.x,
    y: values.y ?? this.y,
    w: values.w ?? values.width ?? this.w,
    h: values.h ?? values.height ?? this.h,
  }
  if (
    !Number.isFinite(next.x)
    || !Number.isFinite(next.y)
    || !Number.isFinite(next.w)
    || !Number.isFinite(next.h)
    || Math.abs(next.x) > MAX_PAPER_VIEWPORT_COORDINATE
    || Math.abs(next.y) > MAX_PAPER_VIEWPORT_COORDINATE
    || next.w < MIN_PAPER_VIEWPORT_DIMENSION
    || next.h < MIN_PAPER_VIEWPORT_DIMENSION
    || next.w > MAX_PAPER_VIEWPORT_COORDINATE
    || next.h > MAX_PAPER_VIEWPORT_COORDINATE
  ) return false
  if (next.x === this.x && next.y === this.y && next.w === this.w && next.h === this.h) {
    return false
  }

  Object.assign(this, next)
  this.refreshGeometry()
  invalidateSpatialIndexes(this._editor)
  this._persistChange('paper-viewport-geometry', options)
  return true
}

/**
 * Set the model origin (the model-space point that appears at the
 * top-left of the viewport). Usually set by panning inside the viewport.
 */
PaperViewport.prototype.setModelOrigin = function (mx, my, options = {}) {
  const nextX = normalizedOrigin(mx)
  const nextY = normalizedOrigin(my)
  if (nextX === null || nextY === null) return false
  if (this.modelOriginX === nextX && this.modelOriginY === nextY) return false
  this.modelOriginX = nextX
  this.modelOriginY = nextY
  this.refreshTransform()
  invalidateSpatialIndexes(this._editor)
  this._persistChange('paper-viewport-origin', options)
  return true
}

/**
 * Center the current model bounds inside this viewport. PaperEditor captures a
 * model-space bounding box before hiding Model Space; a live box is preferred
 * when the browser can still provide one.
 */
PaperViewport.prototype.centerOnModelBounds = function (options = {}) {
  const bounds = currentModelBounds(this._editor)
  const scale = normalizedScale(this.scale)
  if (
    !bounds
    || scale === null
    || !Number.isFinite(this.w)
    || !Number.isFinite(this.h)
    || this.w <= 0
    || this.h <= 0
  ) return false

  const modelUnitsPerPaperUnit = scale / normalizedUnitsPerCm(this._editor)
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  return this.setModelOrigin(
    centerX - (this.w / 2) * modelUnitsPerPaperUnit,
    centerY - (this.h / 2) * modelUnitsPerPaperUnit,
    options,
  )
}

/**
 * Set the drawing scale (e.g. 100 for 1:100).
 */
PaperViewport.prototype.setScale = function (scale, options = {}) {
  const nextScale = normalizedScale(scale)
  if (nextScale === null || this.scale === nextScale) return false
  this.scale = nextScale
  this.refreshGeometry()
  invalidateSpatialIndexes(this._editor)
  this._persistChange('paper-viewport-scale', options)
  return true
}

/**
 * Toggle viewport visibility.
 */
PaperViewport.prototype.setVisible = function (visible, options = {}) {
  const nextVisible = visible !== false
  if (this.visible === nextVisible) return false
  this.visible = nextVisible
  this._group.attr('data-hidden', nextVisible ? null : 'true')
  if (nextVisible) {
    this._group.show()
  } else {
    this._group.hide()
  }
  invalidateSpatialIndexes(this._editor)
  this._persistChange('paper-viewport-visibility', options)
  return true
}

/**
 * Toggle whether the viewport can be selected or panned.
 */
PaperViewport.prototype.setLocked = function (locked, options = {}) {
  const nextLocked = locked === true
  if (this.locked === nextLocked) return false
  this.locked = nextLocked
  this._group.attr('data-locked', nextLocked ? 'true' : null)
  if (nextLocked) this.deactivate()
  invalidateSpatialIndexes(this._editor)
  this._persistChange('paper-viewport-lock', options)
  return true
}

/**
 * Record one persisted viewport change. Restoring a document can pass
 * `{ silent: true }`; the surrounding document transaction then owns the
 * resulting dirty-state transition.
 */
PaperViewport.prototype._persistChange = function (reason, options = {}) {
  const silent = options === true || options.silent === true || options.restoring === true
  if (!silent && this._editor.documentState) {
    this._editor.documentState.markChanged(reason)
  }
  if (options.notify !== false) {
    try {
      this._editor.signals.paperViewportsChanged?.dispatch()
    } catch (error) {
      try { console.error('[PaperViewport] paperViewportsChanged listener failed:', error) } catch (_reportError) {}
    }
  }
}

/**
 * Bind mouse interactions (Select and Pan) to the viewport frame.
 */
PaperViewport.prototype._attachInteractions = function() {
  const { _frame, _editor } = this

  this.activeForPanning = false
  this._onDblClick = (e) => {
    if (_editor.mode !== 'paper' || _editor.isDrawing || this.locked) return
    if (e.button !== 0) return // Only left double click to activate
    e.stopPropagation()
    
    // Deactivate others
    if (_editor.paperViewports) {
      _editor.paperViewports.forEach(vp => {
        if (vp !== this) vp.deactivate()
      })
    }

    this.activate()
  }

  this._onMouseDown = (e) => {
    // Only intercept if we are in Paper mode (sanity check) and not actively drawing lines
    if (_editor.mode !== 'paper' || _editor.isDrawing || this.locked) return

    // Standard Select (Left Click)
    if (e.button === 0) {
      // Don't intercept if clicking on a selection handler that might overlap the viewport
      if (e.target.classList.contains('selection-handler')) return
      
      e.stopPropagation()
      _editor.selected = [this._group]
      _editor.signals.updatedSelection.dispatch()
    }

    // Panning (Middle Click)
    else if (e.button === 1) {
      if (!this.activeForPanning) return // Let the paper pan if we aren't active

      e.preventDefault()
      e.stopPropagation() // Prevent the main canvas from panning the paper sheet

      const startMouse = { x: e.clientX, y: e.clientY }
      const startOrigin = { x: this.modelOriginX, y: this.modelOriginY }
      const panState = { moved: false, onMove: null, onUp: null }

      const onMove = (ev) => {
        // Delta in screen pixels
        const dx = ev.clientX - startMouse.x
        const dy = ev.clientY - startMouse.y

        // To map screen pixels back to model units:
        // 1. Convert screen delta to paper SVG units
        const ctm = _editor.paperSvg.screenCTM()
        const svgDx = dx / ctm.a
        const svgDy = dy / ctm.d

        // 2. Convert paper SVG units delta to model units delta
        // If we move the mouse RIGHT, we are looking at things to the LEFT in the model, 
        // which means the modelOriginX decreases.
        const modelUnitsPerPaperUnit = this.scale / normalizedUnitsPerCm(_editor)
        const modelDx = -svgDx * modelUnitsPerPaperUnit
        const modelDy = -svgDy * modelUnitsPerPaperUnit

        panState.moved = this.setModelOrigin(
          startOrigin.x + modelDx,
          startOrigin.y + modelDy,
          { notify: false },
        ) || panState.moved
      }

      const onUp = () => {
        this._finishActivePan()
      }

      this._finishActivePan({ persist: false })
      panState.onMove = onMove
      panState.onUp = onUp
      this._panState = panState
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }
  }

  _frame.node.addEventListener('dblclick', this._onDblClick)
  _frame.node.addEventListener('mousedown', this._onMouseDown)
}

PaperViewport.prototype._finishActivePan = function ({ persist = true } = {}) {
  const state = this._panState
  if (!state) return false
  document.removeEventListener('mousemove', state.onMove)
  document.removeEventListener('mouseup', state.onUp)
  this._panState = null
  if (persist && state.moved) {
    // Each meaningful move is already revisioned so a concurrent Save token
    // cannot make later drag coordinates appear clean. Completion only
    // notifies dependent Paper UI without inventing another document change.
    this._persistChange('paper-viewport-origin', { silent: true })
  }
  return state.moved
}

/**
 * Activates this viewport for model panning operations.
 */
PaperViewport.prototype.activate = function() {
  if (this.activeForPanning) return
  this.activeForPanning = true
  this._frame.attr('stroke-width', 0.06) // Thicker border
  this._frame.stroke('#4a90e2') // Blue tint to show it's active

  // Listen for outside clicks
  this._onOutsideClick = (e) => {
    if (e.target === this._frame.node) return // Ignored if clicking on self
    this.deactivate()
  }
  
  // Use a slight timeout to prevent the current double-click from immediately deactivating
  this._activationTimer = setTimeout(() => {
    this._activationTimer = null
    window.addEventListener('mousedown', this._onOutsideClick)
  }, 10)
}

/**
 * Deactivates this viewport.
 */
PaperViewport.prototype.deactivate = function(options = {}) {
  this._finishActivePan({ persist: options.persistPan !== false })
  if (this._activationTimer) {
    clearTimeout(this._activationTimer)
    this._activationTimer = null
  }
  if (!this.activeForPanning) return
  this.activeForPanning = false
  this._frame.attr('stroke-width', 0.02)
  this._frame.stroke('#333333')
  if (this._onOutsideClick) {
    window.removeEventListener('mousedown', this._onOutsideClick)
    this._onOutsideClick = null
  }
}

/**
 * Remove from the SVG and clean up.
 */
PaperViewport.prototype.destroy = function () {
  const groupParent = this._group.parent()
  const clipParent = this._clipRect.parent()
  const groupIndex = groupParent
    ? Array.from(groupParent.node.children).indexOf(this._group.node)
    : -1
  const clipIndex = clipParent
    ? Array.from(clipParent.node.children).indexOf(this._clipRect.node)
    : -1

  try {
    this._group.remove()
    this._clipRect.remove()
  } catch (error) {
    const rollbackErrors = []
    const restore = (parent, element, index) => {
      if (!parent || element.node.parentNode === parent.node) return
      try {
        const reference = index >= 0 ? parent.node.children[index] || null : null
        parent.node.insertBefore(element.node, reference)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    restore(clipParent, this._clipRect, clipIndex)
    restore(groupParent, this._group, groupIndex)
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `${error.message} Restoring the Paper viewport also failed.`,
      )
    }
    throw error
  }

  try {
    this.deactivate({ persistPan: false })
  } catch (error) {
    try { console.error('[PaperViewport] Failed to deactivate a removed viewport:', error) } catch (_reportError) {}
  }
  if (this._frame && this._frame.node) {
    try { this._frame.node.removeEventListener('dblclick', this._onDblClick) } catch (_cleanupError) {}
    try { this._frame.node.removeEventListener('mousedown', this._onMouseDown) } catch (_cleanupError) {}
  }
}

export { PaperViewport }
