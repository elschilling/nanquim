/**
 * PaperViewport.js
 *
 * A viewport region in the Paper editor that shows a live view of the model
 * drawing using SVG <use> elements and a <clipPath> to confine the view.
 *
 * Architecture (live reference approach):
 *   <g id="vp-N-group">
 *     <defs>
 *       <clipPath id="vp-N-clip">
 *         <rect x=vpX y=vpY width=vpW height=vpH />
 *       </clipPath>
 *     </defs>
 *     <!-- Live model reference -->
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
 * The model drawing group has id="Collection" (set in Editor.js).
 * At scale 1:S: SVG units in model = S × SVG units in paper.
 * So we need to scale model content DOWN by 1/S and translate so that
 * modelOrigin lands at (vpX, vpY).
 */

function PaperViewport(editor, parentGroup, opts) {
  const {
    id,
    x, y, w, h,
    scale = 100,
    modelOriginX = 0,
    modelOriginY = 0,
  } = opts

  this.id = id
  this.x = x
  this.y = y
  this.w = w
  this.h = h
  this.scale = scale
  this.modelOriginX = modelOriginX
  this.modelOriginY = modelOriginY
  this.visible = true
  this.locked = false

  const svgRoot = editor.paperSvg

  // ── Build SVG structure ───────────────────────────────────────────────────

  // Wrapping group
  const group = parentGroup.group().attr('id', id + '-group')
  group.attr('data-paper-viewport', 'true')
  group.attr('data-vp-id', id)

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

  // Apply initial transform
  this.refreshTransform()

  // ── Interactions: Selection & Panning ─────────────────────────────────────
  this._attachInteractions()
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
 *   As SVG transform: translate(vpX - modelOriginX/scale, vpY - modelOriginY/scale) scale(1/scale)
 */
PaperViewport.prototype.refreshTransform = function () {
  const { x, y, scale, modelOriginX, modelOriginY, _useEl } = this
  const s = 1 / scale
  const tx = x - modelOriginX * s
  const ty = y - modelOriginY * s
  _useEl.transform({ scale: s, translateX: tx, translateY: ty })
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
 * Set the model origin (the model-space point that appears at the
 * top-left of the viewport). Usually set by panning inside the viewport.
 */
PaperViewport.prototype.setModelOrigin = function (mx, my) {
  this.modelOriginX = mx
  this.modelOriginY = my
  this.refreshTransform()
}

/**
 * Set the drawing scale (e.g. 100 for 1:100).
 */
PaperViewport.prototype.setScale = function (scale) {
  this.scale = scale
  this.refreshTransform()
  this.refreshGeometry()
}

/**
 * Toggle viewport visibility.
 */
PaperViewport.prototype.setVisible = function (visible) {
  this.visible = visible
  if (visible) {
    this._group.show()
  } else {
    this._group.hide()
  }
}

/**
 * Bind mouse interactions (Select and Pan) to the viewport frame.
 */
PaperViewport.prototype._attachInteractions = function() {
  const { _frame, _editor } = this

  this.activeForPanning = false
  this._onDblClick = (e) => {
    if (_editor.mode !== 'paper' || _editor.isDrawing) return
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
    if (_editor.mode !== 'paper' || _editor.isDrawing) return

    // Standard Select (Left Click)
    if (e.button === 0) {
      // Don't intercept if clicking on a selection handler that might overlap the viewport
      if (e.target.classList.contains('selection-handler')) return
      
      e.stopPropagation()
      const vpWrapper = { _paperVp: this }
      _editor.selected = [vpWrapper]
      _editor.signals.updatedSelection.dispatch()
    }

    // Panning (Middle Click)
    else if (e.button === 1) {
      if (!this.activeForPanning) return // Let the paper pan if we aren't active

      e.preventDefault()
      e.stopPropagation() // Prevent the main canvas from panning the paper sheet

      const svgEl = _editor.paperSvg.node
      const startMouse = { x: e.clientX, y: e.clientY }
      const startOrigin = { x: this.modelOriginX, y: this.modelOriginY }

      const onMove = (ev) => {
        // Delta in screen pixels
        const dx = ev.clientX - startMouse.x
        const dy = ev.clientY - startMouse.y

        // To map screen pixels back to model units:
        // 1. Convert screen delta to paper SVG units
        const ctm = svgEl.getScreenCTM()
        const svgDx = dx / ctm.a
        const svgDy = dy / ctm.d

        // 2. Convert paper SVG units delta to model units delta
        // If we move the mouse RIGHT, we are looking at things to the LEFT in the model, 
        // which means the modelOriginX decreases.
        const modelDx = -svgDx * this.scale
        const modelDy = -svgDy * this.scale

        this.setModelOrigin(startOrigin.x + modelDx, startOrigin.y + modelDy)
      }

      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }
  }

  _frame.node.addEventListener('dblclick', this._onDblClick)
  _frame.node.addEventListener('mousedown', this._onMouseDown)
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
  setTimeout(() => {
    window.addEventListener('mousedown', this._onOutsideClick)
  }, 10)
}

/**
 * Deactivates this viewport.
 */
PaperViewport.prototype.deactivate = function() {
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
  this.deactivate()
  if (this._frame && this._frame.node) {
    this._frame.node.removeEventListener('dblclick', this._onDblClick)
    this._frame.node.removeEventListener('mousedown', this._onMouseDown)
  }
  this._group.remove()
  this._clipRect.remove()
}

export { PaperViewport }
