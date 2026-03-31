import { getArcGeometry } from './utils/arcUtils'
import { catmullRomToBezierPath } from './commands/DrawSplineCommand'
import {
  calculateDistance,
  distanceFromPointToLine,
  distanceFromPointToCircle,
  distancePointToRectangleStroke,
  calculateDeltaFromBasepoint,
  calculateLocalDelta
} from './utils/calculateDistance'
import { isLineIntersectingRect, isCircleIntersectingRect, isPolygonIntersectingRect } from './utils/intersection'
import { applyOffsetToElement, computeOffsetVector } from './utils/offsetCalc'
import { getSelectableElements, findSelectableAncestor } from './Collection'
import { getPreferences } from './Preferences'
import { EditViewportCommand } from './commands/EditViewportCommand'
import { updateGrid as updateGridDraw } from './utils/gridDraw'
import { checkSnap as checkSnapSystem, drawSnap, clearSnap, drawExtensionLines } from './utils/snapSystem'
import { initToolbarHandlers } from './utils/toolbarHandlers'

function Viewport(editor) {
  const signals = editor.signals
  const svg = editor.svg
  const drawing = editor.drawing

  // Helper: get flat array of selectable drawing elements (visible + unlocked collections)
  function getSelectableDrawingElements() {
    return getSelectableElements(editor)
  }

  const prefs = getPreferences()
  let hoverTreshold = prefs.hoverThreshold
  let gridSpacing = prefs.gridSize
  let hoveredElements = []
  let disambiguationMenu = null
  let disambiguationCleanup = null
  let zoomFactor = 0.1
  let coordinates = { x: 0, y: 0 }
  let lastMiddleClickTime = 0
  let snapTolerance = 50
  let ghostElements = []
  let basePoint = null
  let initialTransforms = new Map()
  let isGhostingMove = false
  let isGhostingRotate = false
  let isGhostingOffset = false
  let isGhostingScale = false
  let offsetGhostClone = null
  let offsetDistance = null
  let centerPoint = null
  let referencePoint = null

  signals.moveGhostingStarted.add(onMoveGhostingStarted)
  signals.moveGhostingStopped.add(onMoveGhostingStopped)

  signals.scaleGhostingStarted.add(onScaleGhostingStarted)
  signals.scaleGhostingStopped.add(onScaleGhostingStopped)

  signals.rotateGhostingStarted.add(onRotateGhostingStarted)
  signals.rotateGhostingStopped.add(onRotateGhostingStopped)

  signals.offsetGhostingStarted.add(onOffsetGhostingStarted)
  signals.offsetGhostingStopped.add(onOffsetGhostingStopped)

  signals.vertexEditStarted.add(onVertexEditStarted)
  signals.vertexEditStopped.add(onVertexEditStopped)

  signals.updatedOutliner.add(() => {
    hoveredElements = []
    editor.spatialIndex.markDirty()
    editor.fullSpatialIndex.markDirty()
    // Notify paper viewports that model content may have changed
    if (editor.signals.modelContentChanged) {
      editor.signals.modelContentChanged.dispatch()
    }
  })
  signals.clearSelection.add(() => {
    if (editor.selected.length > 0) {
      editor.previousSelection = editor.selected.slice()
    }
    editor.selected.forEach((el) => {
      if (el && typeof el.removeClass === 'function') {
        el.removeClass('elementSelected')
        el.attr('selected', false)
      } else if (el && el._paperVp) {
        // Selection is a PaperViewport object, handled safely
      }
    })
    editor.selected = []
    editor.handlers.clear()
    clearHover()
    clearSelectionRectangle()
  })
  signals.commandCancelled.add(() => {
    if (_moveRafId !== null) {
      cancelAnimationFrame(_moveRafId)
      _moveRafId = null
      _pendingMoveEvent = null
    }
    editor.spatialIndex.markDirty()
    editor.fullSpatialIndex.markDirty()
    clearHover()
    const activeSvgForClear = editor.mode === 'paper' ? editor.paperSvg : editor.svg
    clearSnap(editor, activeSvgForClear)
    editor.extensionHovers = []
    clearPolarGuides()
    clearSelectionRectangle()
    editor.lastClick = null  // reset so next command has no stale base point
    editor.isDrawing = false
    editor.isSelecting = false
  })

  function clearSelectionRectangle() {
    const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
    if (activeSvg) activeSvg.find('.selectionRectangle').each(el => el.remove())
  }

  signals.requestHoverCheck.add(() => {
    checkHover()
  })

  const { handleRightClick, clearSelection: clearSelectionFn } = initToolbarHandlers(editor)
  document.addEventListener('contextmenu', handleRightClick)
  // Create groups for grid, axis, and polar guides within overlays
  const gridGroup = editor.overlays.group().addClass('grid')
  const axisGroup = editor.overlays.group().addClass('axis-group')
  const polarGroup = editor.overlays.group().addClass('polar-guides')

  function attachCanvasListeners(svgInstance) {
    if (svgInstance.node.dataset.viewportListenersAttached) return
    svgInstance.node.dataset.viewportListenersAttached = 'true'

    svgInstance
      .mousemove(handleMove)
      .mousedown(handleMousedown)
      .panZoom({ zoomFactor, panButton: 1 })
      .on('zoom', updateGrid)
      .on('pan', updateGrid)

    svgInstance.on('dblclick', (e) => {
      if (e.button === 0 && !editor.isInteracting && !editor.isDrawing) {
        if (hoveredElements.length > 0 && hoveredElements[0].type === 'text') {
          e.preventDefault()
          e.stopPropagation()
          import('./commands/EditTextCommand.js').then(({ editTextCommand }) => {
            editTextCommand(editor, hoveredElements[0])
          })
          return
        }
      }
    })

    // Handle middle-click double click on this specific instance
    svgInstance.on('mousedown', (e) => {
      if (e.button === 1 && e.detail >= 2) {
        e.preventDefault()
        e.stopPropagation()

        if (editor.mode === 'paper') {
          // For paper space, double-middle click could mean zoom to paper or something else
          // For now let's just do nothing or zoom to paper sheet
          return
        }

        const wasHandlersVisible = editor.handlers.visible()
        if (wasHandlersVisible) editor.handlers.hide()
        const box = editor.drawing.bbox()
        if (wasHandlersVisible) editor.handlers.show()

        if (box.width > 0 || box.height > 0) {
          const padding = Math.max(box.width, box.height) * 0.1 || 2
          svgInstance.animate(300, '>').viewbox(box.x - padding, box.y - padding, box.width + padding * 2, box.height + padding * 2).after(() => {
            updateGrid()
          })
        }
      }
    })
  }

  svg.addClass('canvas')
  attachCanvasListeners(svg)

  svg.viewbox(-5, -5, 10, 10)
  updateGrid()

  signals.editorModeChanged.add((mode) => {
    if (mode === 'paper' && editor.paperSvg) {
      attachCanvasListeners(editor.paperSvg)
    }
    updateGrid()
  })

  function updateGrid() {
    updateGridDraw(editor, gridGroup, axisGroup, gridSpacing)
  }

  function onMoveGhostingStarted(elements, point) {
    isGhostingMove = true
    ghostElements = elements
    editor.ghostNodes = new Set(elements.map(el => el.node))
    basePoint = point
    ghostElements.forEach((el) => {
      if (el._paperVp) {
        initialTransforms.set(el, { x: el._paperVp.x, y: el._paperVp.y, w: el._paperVp.w, h: el._paperVp.h })
      } else {
        initialTransforms.set(el, el.transform())
      }
    })
  }

  function onMoveGhostingStopped() {
    isGhostingMove = false
    editor.ghostNodes = null
    ghostElements.forEach((el) => {
      const initial = initialTransforms.get(el)
      if (el._paperVp) {
        el._paperVp.x = initial.x
        el._paperVp.y = initial.y
        el._paperVp.w = initial.w
        el._paperVp.h = initial.h
        el._paperVp.refreshGeometry()
      } else {
        el.transform(initial)
      }
    })
    ghostElements = []
    basePoint = null
    initialTransforms.clear()
  }

  function onScaleGhostingStarted(elements, point) {
    isGhostingScale = true
    ghostElements = elements
    editor.ghostNodes = new Set(elements.map(el => el.node))
    basePoint = point
    ghostElements.forEach((el) => {
      if (el._paperVp) {
        initialTransforms.set(el, { x: el._paperVp.x, y: el._paperVp.y, w: el._paperVp.w, h: el._paperVp.h })
      } else {
        initialTransforms.set(el, el.transform())
      }
    })
  }

  function onScaleGhostingStopped() {
    isGhostingScale = false
    editor.ghostNodes = null
    ghostElements.forEach((el) => {
      const initial = initialTransforms.get(el)
      if (el._paperVp) {
        el._paperVp.x = initial.x
        el._paperVp.y = initial.y
        el._paperVp.w = initial.w
        el._paperVp.h = initial.h
        el._paperVp.refreshGeometry()
      } else {
        el.transform(initial)
      }
    })
    ghostElements = []
    basePoint = null
    initialTransforms.clear()
  }

  function onRotateGhostingStarted(elements, cPoint, rPoint) {
    isGhostingRotate = true
    ghostElements = elements
    editor.ghostNodes = new Set(elements.map(el => el.node))
    centerPoint = cPoint
    referencePoint = rPoint
    ghostElements.forEach((el) => {
      if (el._paperVp) {
        initialTransforms.set(el, { x: el._paperVp.x, y: el._paperVp.y, w: el._paperVp.w, h: el._paperVp.h })
      } else {
        initialTransforms.set(el, el.transform())
      }
    })
  }

  function onRotateGhostingStopped() {
    isGhostingRotate = false
    editor.ghostNodes = null
    ghostElements.forEach((el) => {
      const initial = initialTransforms.get(el)
      if (el._paperVp) {
        el._paperVp.x = initial.x
        el._paperVp.y = initial.y
        el._paperVp.w = initial.w
        el._paperVp.h = initial.h
        el._paperVp.refreshGeometry()
      } else {
        el.transform(initial)
      }
    })
    ghostElements = []
    centerPoint = null
    referencePoint = null
    initialTransforms.clear()
  }

  function onOffsetGhostingStarted(element, distance) {
    const el = element[0]
    initialTransforms.set(el, el.transform())
    ghostElements = el
    isGhostingOffset = true
    offsetDistance = distance
  }

  function onOffsetGhostingStopped() {
    isGhostingOffset = false
    if (offsetGhostClone) offsetGhostClone.remove()
    // Remove ghost clones
    // ghostElements.remove()
    ghostElements = []
    offsetGhostClone = null
    offsetDistance = null
  }

  function onVertexEditStarted(vertices) {
    editor.isEditingVertex = true
    editor.editingVertices = vertices
    editor.handlers.addClass('handlers-editing')
  }

  function onVertexEditStopped() {
    editor.handlers.removeClass('handlers-editing')
    editor.isEditingVertex = false
    editor.editingVertices = []
  }

  function getOrthoConstrainedPoint(point, vertexData) {
    let baseX = 0, baseY = 0
    const { element, vertexIndex, originalPosition } = vertexData

    // Determine base point for ortho constraint
    if (element.type === 'line') {
      baseX = originalPosition.x
      baseY = originalPosition.y
    } else if (element.type === 'circle') {
      const { cx, cy, r } = originalPosition
      if (vertexIndex === 0) { baseX = cx; baseY = cy }
      else if (vertexIndex === 1) { baseX = cx; baseY = cy - r }
      else if (vertexIndex === 2) { baseX = cx + r; baseY = cy }
      else if (vertexIndex === 3) { baseX = cx; baseY = cy + r }
      else if (vertexIndex === 4) { baseX = cx - r; baseY = cy }
    } else if (element.type === 'rect') {
      const { x, y, width, height } = originalPosition
      if (vertexIndex === 0) { baseX = x; baseY = y }
      else if (vertexIndex === 1) { baseX = x + width; baseY = y }
      else if (vertexIndex === 2) { baseX = x + width; baseY = y + height }
      else if (vertexIndex === 3) { baseX = x; baseY = y + height }
      else if (vertexIndex === 4) { baseX = x + width / 2; baseY = y }
      else if (vertexIndex === 5) { baseX = x + width; baseY = y + height / 2 }
      else if (vertexIndex === 6) { baseX = x + width / 2; baseY = y + height }
      else if (vertexIndex === 7) { baseX = x; baseY = y + height / 2 }
    }

    const dx = point.x - baseX
    const dy = point.y - baseY

    if (Math.abs(dx) > Math.abs(dy)) {
      return { x: point.x, y: baseY }
    } else {
      return { x: baseX, y: point.y }
    }
  }

  function _doHandleMove(e) {
    const activeSvgMove = editor.mode === 'paper' ? editor.paperSvg : editor.svg
    clearSnap(editor, activeSvgMove)
    if (editor.isSnapping) {
      if ((editor.isDrawing && !editor.isSelecting) || editor.isInteracting || editor.isEditingVertex) {
        checkSnap({ x: e.pageX, y: e.pageY })
      } else {
        editor.snapPoint = null
        editor.extensionHovers = []
      }
    } else {
      editor.snapPoint = null
      editor.extensionHovers = []
    }
    const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
    if (!activeSvg) return
    coordinates = activeSvg.point(e.pageX, e.pageY)

    // Polar tracking: project cursor onto the nearest polar angle ray
    if (editor.polarTracking && !editor.ortho && !editor.suppressPolarTracking &&
      (editor.isDrawing || editor.isInteracting || editor.isEditingVertex)) {
      // Determine the best available base point
      const polarBase = basePoint || centerPoint || editor.lastClick || null
      if (polarBase) {
        const snapped = updatePolarGuides(coordinates, activeSvg)
        // Only override snap if object snap didn't already lock onto something
        if (snapped && !editor.snapPoint) {
          editor.snapPoint = snapped
        }
      } else {
        clearPolarGuides()
      }
    } else {
      clearPolarGuides()
    }
    if (ghostElements.length > 0) {
      if (isGhostingMove) {
        let dx = coordinates.x - basePoint.x
        let dy = coordinates.y - basePoint.y
        if (editor.distance) {
          if (editor.ortho) {
            if (Math.abs(dx) > Math.abs(dy)) {
              ; ({ dx, dy } = calculateDeltaFromBasepoint(basePoint, { x: coordinates.x, y: basePoint.y }, editor.distance))
            } else {
              ; ({ dx, dy } = calculateDeltaFromBasepoint(basePoint, { x: basePoint.x, y: coordinates.y }, editor.distance))
            }
          } else {
            ; ({ dx, dy } = calculateDeltaFromBasepoint(basePoint, coordinates, editor.distance))
          }
        }
        if (editor.ortho) {
          if (Math.abs(dx) > Math.abs(dy)) {
            dy = 0
          } else {
            dx = 0
          }
        }
        ghostElements.forEach((el) => {
          const initial = initialTransforms.get(el)
          if (el._paperVp) {
            el._paperVp.x = initial.x + dx
            el._paperVp.y = initial.y + dy
            el._paperVp.refreshGeometry()
          } else {
            const localDelta = calculateLocalDelta(el, dx, dy)
            el.transform(initial).translate(localDelta.dx, localDelta.dy)
          }
        })
      }
      if (isGhostingRotate) {
        let rotationAngle = calculateRotationAngle(centerPoint, referencePoint, coordinates)
        if (editor.distance) {
          rotationAngle = editor.distance
        }
        ghostElements.forEach((el) => {
          const initial = initialTransforms.get(el)
          if (!el._paperVp) {
            el.transform(initial)
            el.rotate(rotationAngle, centerPoint.x, centerPoint.y)
          }
        })
      }
      if (isGhostingScale) {
        const dist = calculateDistance(basePoint, coordinates)
        let scaleFactor = dist
        if (editor.distance) {
          scaleFactor = editor.distance
        }

        ghostElements.forEach((el) => {
          const initial = initialTransforms.get(el)
          if (el._paperVp) {
            el._paperVp.w = initial.w * scaleFactor
            el._paperVp.h = initial.h * scaleFactor
            // Also adjust position based on scaling from basePoint
            const ox = initial.x - basePoint.x
            const oy = initial.y - basePoint.y
            el._paperVp.x = basePoint.x + ox * scaleFactor
            el._paperVp.y = basePoint.y + oy * scaleFactor
            el._paperVp.refreshGeometry()
          } else {
            el.transform(initial)
            el.scale(scaleFactor, scaleFactor, basePoint.x, basePoint.y)
          }
        })
      }
    }
    if (isGhostingOffset) {
      updateOffsetGhosts(coordinates)
    }

    // Handle vertex editing
    if (editor.isEditingVertex && editor.editingVertices.length > 0) {
      let point = editor.snapPoint || coordinates

      if (editor.ortho) {
        const v0 = editor.editingVertices[0]
        let baseX = 0, baseY = 0

        // Determine base point for ortho constraint
        if (v0.element.type === 'line') {
          baseX = v0.originalPosition.x
          baseY = v0.originalPosition.y
        } else if (v0.element.type === 'circle') {
          const { cx, cy, r } = v0.originalPosition
          if (v0.vertexIndex === 0) { baseX = cx; baseY = cy }
          else if (v0.vertexIndex === 1) { baseX = cx; baseY = cy - r }
          else if (v0.vertexIndex === 2) { baseX = cx + r; baseY = cy }
          else if (v0.vertexIndex === 3) { baseX = cx; baseY = cy + r }
          else if (v0.vertexIndex === 4) { baseX = cx - r; baseY = cy }
        } else if (v0.element.type === 'rect') {
          const { x, y, width, height } = v0.originalPosition
          if (v0.vertexIndex === 0) { baseX = x; baseY = y }
          else if (v0.vertexIndex === 1) { baseX = x + width; baseY = y }
          else if (v0.vertexIndex === 2) { baseX = x + width; baseY = y + height }
          else if (v0.vertexIndex === 3) { baseX = x; baseY = y + height }
          else if (v0.vertexIndex === 4) { baseX = x + width / 2; baseY = y }
          else if (v0.vertexIndex === 5) { baseX = x + width; baseY = y + height / 2 }
          else if (v0.vertexIndex === 6) { baseX = x + width / 2; baseY = y + height }
          else if (v0.vertexIndex === 7) { baseX = x; baseY = y + height / 2 }
        } else if (v0.element._paperVp) {
          const { x, y, width, height } = v0.originalPosition
          if (v0.vertexIndex === 0) { baseX = x; baseY = y }
          else if (v0.vertexIndex === 1) { baseX = x + width; baseY = y }
          else if (v0.vertexIndex === 2) { baseX = x + width; baseY = y + height }
          else if (v0.vertexIndex === 3) { baseX = x; baseY = y + height }
          else if (v0.vertexIndex === 4) { baseX = x + width / 2; baseY = y }
          else if (v0.vertexIndex === 5) { baseX = x + width; baseY = y + height / 2 }
          else if (v0.vertexIndex === 6) { baseX = x + width / 2; baseY = y + height }
          else if (v0.vertexIndex === 7) { baseX = x; baseY = y + height / 2 }
        } else if (v0.element.type === 'ellipse') {
          baseX = v0.originalPosition.cx
          baseY = v0.originalPosition.cy
        }

        const dx = point.x - baseX
        const dy = point.y - baseY

        if (Math.abs(dx) > Math.abs(dy)) {
          point = { x: point.x, y: baseY }
        } else {
          point = { x: baseX, y: point.y }
        }
      }

      editor.editingVertices.forEach(vertexData => {
        const element = vertexData.element
        const vertexIndex = vertexData.vertexIndex

        if (element.type === 'line') {
          if (vertexIndex === 0) {
            // Update first vertex
            element.plot(point.x, point.y, element.node.x2.baseVal.value, element.node.y2.baseVal.value)
          } else {
            // Update second vertex
            element.plot(element.node.x1.baseVal.value, element.node.y1.baseVal.value, point.x, point.y)
          }
        } else if (element.type === 'circle') {
          const cx = vertexData.originalPosition.cx
          const cy = vertexData.originalPosition.cy

          if (vertexIndex === 0) {
            // Center handler: Move the circle
            element.center(point.x, point.y)
          } else {
            // Quadrant handler: Resize radius
            // Calculate distance from center to mouse point
            const currentCenter = { x: element.cx(), y: element.cy() }
            const newRadius = calculateDistance(currentCenter, point)
            element.radius(newRadius)
          }
        } else if (element.type === 'ellipse') {
          const original = vertexData.originalPosition
          if (vertexIndex === 0) {
            // Center: move the ellipse
            element.center(point.x, point.y)
          } else if (vertexIndex === 1 || vertexIndex === 3) {
            // Right or Left quadrant: change rx
            const newRx = Math.max(1e-3, Math.abs(point.x - original.cx))
            element.attr('rx', newRx)
          } else if (vertexIndex === 2 || vertexIndex === 4) {
            // Bottom or Top quadrant: change ry
            const newRy = Math.max(1e-3, Math.abs(point.y - original.cy))
            element.attr('ry', newRy)
          }
        } else if (element.type === 'rect') {
          const original = vertexData.originalPosition
          const index = vertexIndex

          let newX = element.x()
          let newY = element.y()
          let newW = element.width()
          let newH = element.height()

          // Helper to update rect from 2 corner points (normalize negative width/height)
          const setRectFromPoints = (x1, y1, x2, y2) => {
            const x = Math.min(x1, x2)
            const y = Math.min(y1, y2)
            const w = Math.abs(x2 - x1)
            const h = Math.abs(y2 - y1)
            element.move(x, y).size(w, h)
          }

          // Case 0: Top-Left Corner
          if (index === 0) {
            setRectFromPoints(point.x, point.y, original.x + original.width, original.y + original.height)
          }
          // Case 1: Top-Right Corner
          else if (index === 1) {
            setRectFromPoints(original.x, point.y, point.x, original.y + original.height)
          }
          // Case 2: Bottom-Right Corner
          else if (index === 2) {
            setRectFromPoints(original.x, original.y, point.x, point.y)
          }
          // Case 3: Bottom-Left Corner
          else if (index === 3) {
            setRectFromPoints(point.x, original.y, original.x + original.width, point.y)
          }
          // Case 4: Top Edge
          else if (index === 4) {
            setRectFromPoints(original.x, point.y, original.x + original.width, original.y + original.height)
          }
          // Case 5: Right Edge
          else if (index === 5) {
            setRectFromPoints(original.x, original.y, point.x, original.y + original.height)
          }
          // Case 6: Bottom Edge
          else if (index === 6) {
            setRectFromPoints(original.x, original.y, original.x + original.width, point.y)
          }
          // Case 7: Left Edge
          else if (index === 7) {
            setRectFromPoints(point.x, original.y, original.x + original.width, original.y + original.height)
          }
        } else if (element._paperVp) {
          const vp = element._paperVp
          const original = vertexData.originalPosition
          const index = vertexIndex

          // Helper to update viewport from 2 corner points (normalize negative width/height)
          const setVpFromPoints = (x1, y1, x2, y2) => {
            const x = Math.min(x1, x2)
            const y = Math.min(y1, y2)
            let w = Math.abs(x2 - x1)
            let h = Math.abs(y2 - y1)
            // enforce minimum scale
            if (w < 0.5) {
              w = 0.5
            }
            if (h < 0.5) {
              h = 0.5
            }
            vp.x = x
            vp.y = y
            vp.w = w
            vp.h = h
            vp.refreshGeometry()
            vp._editor.signals.paperViewportsChanged.dispatch()
          }

          if (index === 0) setVpFromPoints(point.x, point.y, original.x + original.width, original.y + original.height)
          else if (index === 1) setVpFromPoints(original.x, point.y, point.x, original.y + original.height)
          else if (index === 2) setVpFromPoints(original.x, original.y, point.x, point.y)
          else if (index === 3) setVpFromPoints(point.x, original.y, original.x + original.width, point.y)
          else if (index === 4) setVpFromPoints(original.x, point.y, original.x + original.width, original.y + original.height)
          else if (index === 5) setVpFromPoints(original.x, original.y, point.x, original.y + original.height)
          else if (index === 6) setVpFromPoints(original.x, original.y, original.x + original.width, point.y)
          else if (index === 7) setVpFromPoints(point.x, original.y, original.x + original.width, original.y + original.height)

        } else if (element.type === 'path' && element.data('arcData')) {
          const arcData = element.data('arcData')
          const values = {
            p1: { x: arcData.p1.x, y: arcData.p1.y },
            p2: { x: arcData.p2.x, y: arcData.p2.y },
            p3: { x: arcData.p3.x, y: arcData.p3.y }
          }
          if (vertexIndex === 0) values.p1 = { x: point.x, y: point.y }
          else if (vertexIndex === 1) values.p2 = { x: point.x, y: point.y }
          else if (vertexIndex === 2) values.p3 = { x: point.x, y: point.y }

          const p1 = values.p1
          const p2 = values.p2
          const p3 = values.p3

          const geo = getArcGeometry(p1, p2, p3)
          if (!geo) {
            element.plot(`M ${p1.x} ${p1.y} L ${p3.x} ${p3.y}`)
          } else {
            element.plot(`M ${p1.x} ${p1.y} A ${geo.radius} ${geo.radius} 0 ${geo.largeArcFlag} ${geo.sweepFlag} ${p3.x} ${p3.y}`)
          }

          element.data('arcData', values)
        } else if (element.type === 'path' && element.data('splineData')) {
          const splineData = element.data('splineData')
          const newPoints = splineData.points.map(p => ({ x: p.x, y: p.y }))
          newPoints[vertexIndex] = { x: point.x, y: point.y }
          const d = catmullRomToBezierPath(newPoints)
          element.plot(d)
          element.data('splineData', { points: newPoints })
        } else if (element.type === 'polyline') {
          const pts = element.array().map(p => [p[0], p[1]])
          pts[vertexIndex] = [point.x, point.y]
          element.plot(pts)
        } else if (element.type === 'g' && element.attr('data-element-type') === 'dimension') {
          // Live render during move
          try {
            const dimData = JSON.parse(element.attr('data-dim-data'))

            if (vertexIndex === 0) dimData.p1 = { x: point.x, y: point.y }
            else if (vertexIndex === 1) dimData.p2 = { x: point.x, y: point.y }
            else if (vertexIndex === 2) dimData.p3 = { x: point.x, y: point.y }
            else if (vertexIndex === 3) {
              // Dragging the text moves its offset relative to default center
              const base = JSON.parse(element.attr('data-dim-text-base'))
              dimData.textPosition = {
                x: point.x - base.x,
                y: point.y - base.y
              }
            }

            // Update the source of truth attribute so handlers can see new positions live
            element.attr('data-dim-data', JSON.stringify(dimData))

            const styleId = dimData.styleId || 'Standard'
            const style = editor.dimensionManager.getStyle(styleId)

            // We need to inject textPosition into the style data dynamically
            // or handle it in linearDimensionCommand.
            // Actually, textPosition is unique per dimension instance!
            // Let's modify linearDimensionCommand to accept dimData directly if passed into style
            const tempStyle = JSON.parse(JSON.stringify(style))
            if (dimData.textPosition) {
              tempStyle.textPosition = dimData.textPosition
            }

            if (window.LinearDimensionCommand) {
              window.LinearDimensionCommand.renderDimensionGraphics(
                element,
                dimData.p1, dimData.p2, dimData.p3,
                tempStyle,
                1,
                false,
                dimData.dimType || 'linear'
              )
            } else {
              import('./commands/LinearDimensionCommand.js').then(({ LinearDimensionCommand }) => {
                window.LinearDimensionCommand = LinearDimensionCommand
                LinearDimensionCommand.renderDimensionGraphics(
                  element,
                  dimData.p1, dimData.p2, dimData.p3,
                  tempStyle,
                  1,
                  false,
                  dimData.dimType || 'linear'
                )
              })
            }

          } catch (e) { }
        }
      })

      // Redraw handlers to follow the vertex
      signals.updatedSelection.dispatch()
    }
    updateCoordinates(coordinates)
    scheduleHoverCheck()
  }

  let _pendingMoveEvent = null
  let _moveRafId = null
  function handleMove(e) {
    _pendingMoveEvent = e
    if (_moveRafId === null) {
      _moveRafId = requestAnimationFrame(() => {
        _moveRafId = null
        _doHandleMove(_pendingMoveEvent)
      })
    }
  }

  function updateCoordinates(coordinates) {
    editor.signals.updatedCoordinates.dispatch(coordinates)
  }

  // Throttle hover checks to one per animation frame for performance
  let hoverCheckScheduled = false
  function scheduleHoverCheck() {
    if (!hoverCheckScheduled) {
      hoverCheckScheduled = true
      requestAnimationFrame(() => {
        hoverCheckScheduled = false
        checkHover()
      })
    }
  }
  // Helper to add/remove hover class recursively for groups
  function addHoverClass(el) {
    el.addClass('elementHover')
    if (el.type === 'g' && el.children) {
      el.children().each(child => addHoverClass(child))
    }
  }
  function removeHoverClass(el) {
    el.removeClass('elementHover')
    if (el.type === 'g' && el.children) {
      el.children().each(child => removeHoverClass(child))
    }
  }

  function clearHover() {
    hoveredElements.forEach((el) => removeHoverClass(el))
    hoveredElements = []
    editor.hoveredElements = []
  }

  function getElementDisplayInfo(el) {
    const elType = el.type || el.node.nodeName.toLowerCase()
    let iconClass = 'icon-element-default'
    if (elType === 'line') iconClass = 'icon-element-line'
    else if (elType === 'circle') iconClass = 'icon-element-circle'
    else if (elType === 'path') iconClass = 'icon-element-arc'
    else if (elType === 'rect') iconClass = 'icon-element-rect'
    else if (elType === 'polygon' || elType === 'polyline') iconClass = 'icon-element-rect'
    else if (elType === 'ellipse') iconClass = 'icon-element-circle'

    const name = el.attr('name') || elType

    let collectionName = ''
    let current = el
    while (current && current.parent) {
      const parent = current.parent()
      if (!parent || !parent.node) break
      if (parent.node.getAttribute && parent.node.getAttribute('data-collection') === 'true') {
        collectionName = parent.node.getAttribute('name') || 'Collection'
        break
      }
      current = parent
    }

    return { iconClass, name, collectionName }
  }

  function closeDisambiguationMenu() {
    if (disambiguationMenu) {
      disambiguationMenu.remove()
      disambiguationMenu = null
    }
    if (disambiguationCleanup) {
      disambiguationCleanup()
      disambiguationCleanup = null
    }
  }

  function showDisambiguationMenu(elements, e, mode) {
    closeDisambiguationMenu()

    const menu = document.createElement('div')
    menu.className = 'disambiguation-menu'
    menu.style.left = e.clientX + 'px'
    menu.style.top = e.clientY + 'px'

    elements.forEach((el) => {
      const info = getElementDisplayInfo(el)

      const item = document.createElement('div')
      item.className = 'disambiguation-menu-item'

      const icon = document.createElement('div')
      icon.className = 'icon ' + info.iconClass
      icon.style.flexShrink = '0'

      const label = document.createElement('span')
      label.textContent = info.name

      item.appendChild(icon)
      item.appendChild(label)

      if (info.collectionName) {
        const collLabel = document.createElement('span')
        collLabel.className = 'disambiguation-item-collection'
        collLabel.textContent = info.collectionName
        item.appendChild(collLabel)
      }

      item.addEventListener('mouseenter', () => {
        hoveredElements.forEach(h => removeHoverClass(h))
        addHoverClass(el)
      })

      item.addEventListener('mouseleave', () => {
        removeHoverClass(el)
      })

      item.addEventListener('click', (ev) => {
        ev.stopPropagation()
        if (mode === 'interacting') {
          signals.toogledSelect.dispatch(el, 'mousedown-interacting')
        } else {
          signals.toogledSelect.dispatch(el)
        }
        closeDisambiguationMenu()
      })

      menu.appendChild(item)
    })

    document.body.appendChild(menu)
    disambiguationMenu = menu

    // Adjust position if overflowing viewport
    const rect = menu.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      menu.style.left = (e.clientX - rect.width) + 'px'
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (e.clientY - rect.height) + 'px'
    }

    // Close handlers
    const onOutsideClick = (ev) => {
      if (!menu.contains(ev.target)) {
        closeDisambiguationMenu()
      }
    }
    const onEscape = (ev) => {
      if (ev.key === 'Escape') {
        closeDisambiguationMenu()
      }
    }

    setTimeout(() => {
      document.addEventListener('mousedown', onOutsideClick)
      document.addEventListener('keydown', onEscape)
    }, 10)

    disambiguationCleanup = () => {
      document.removeEventListener('mousedown', onOutsideClick)
      document.removeEventListener('keydown', onEscape)
    }
  }

  function checkHover() {
    if (editor.isDrawing || editor.isTypingText) {
      clearHover()
      return
    }
    const candidates = []
    const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
    if (!activeSvg) return
    // Compute inverted SVG root CTM once per frame (not per element)
    // Use screenCTM() instead of getCTM() to get the Firefox workaround for nested SVGs
    const svgCTM = activeSvg.screenCTM()
    let svgInvDet = 1
    let hasSvgCTM = false
    if (svgCTM) {
      svgInvDet = svgCTM.a * svgCTM.d - svgCTM.b * svgCTM.c
      hasSvgCTM = Math.abs(svgInvDet) > 1e-10
    }

    const vb = activeSvg.viewbox()
    const svgWidth = activeSvg.node.clientWidth || activeSvg.node.getBoundingClientRect().width || 1
    const worldPerPixel = vb.width / svgWidth
    const hoverThresholdWorld = hoverTreshold * worldPerPixel

    const pad = hoverThresholdWorld

    // ---- R-TREE SPATIAL QUERY ----
    // Only check elements whose bbox overlaps the cursor vicinity
    editor.spatialIndex.ensureFresh(editor)
    const rtreeCandidates = editor.spatialIndex.search({
      minX: coordinates.x - pad,
      minY: coordinates.y - pad,
      maxX: coordinates.x + pad,
      maxY: coordinates.y + pad,
    })

    rtreeCandidates.forEach((item) => {
      const el = item.element
      if (el.hasClass('ghostLine') || el.hasClass('selectionRectangle') || el.hasClass('grid') || el.hasClass('axis')) return

      // ---- PRECISE DISTANCE ----
      let distance
      const ctm = el.screenCTM()

      // Build toRootSpace closure for this element's CTM
      const toRootSpace = (ctm && hasSvgCTM) ? (lx, ly) => {
        const ex = ctm.a * lx + ctm.c * ly + ctm.e
        const ey = ctm.b * lx + ctm.d * ly + ctm.f
        return {
          x: (svgCTM.d * (ex - svgCTM.e) - svgCTM.c * (ey - svgCTM.f)) / svgInvDet,
          y: (-svgCTM.b * (ex - svgCTM.e) + svgCTM.a * (ey - svgCTM.f)) / svgInvDet,
        }
      } : (lx, ly) => ({ x: lx, y: ly })

      if (el.type === 'line') {
        let p1 = toRootSpace(el.node.x1.baseVal.value, el.node.y1.baseVal.value)
        let p2 = toRootSpace(el.node.x2.baseVal.value, el.node.y2.baseVal.value)
        distance = distanceFromPointToLine(coordinates, p1, p2)
      } else if (el.type === 'circle') {
        const center = toRootSpace(el.node.cx.baseVal.value, el.node.cy.baseVal.value)
        const edgePoint = toRootSpace(
          el.node.cx.baseVal.value + el.node.r.baseVal.value,
          el.node.cy.baseVal.value
        )
        const transformedRadius = calculateDistance(center, edgePoint)
        distance = distanceFromPointToCircle(coordinates, center, transformedRadius)
      } else if (el.type === 'rect') {
        const x = el.node.x.baseVal.value
        const y = el.node.y.baseVal.value
        const w = el.node.width.baseVal.value
        const h = el.node.height.baseVal.value
        const corners = [
          toRootSpace(x, y), toRootSpace(x + w, y),
          toRootSpace(x + w, y + h), toRootSpace(x, y + h)
        ]
        let minDist = Infinity
        for (let i = 0; i < 4; i++) {
          const d = distanceFromPointToLine(coordinates, corners[i], corners[(i + 1) % 4])
          if (d < minDist) minDist = d
        }
        distance = minDist
      } else if (el.type === 'path') {
        const arcData = el.data('arcData')
        if (arcData) {
          const geo = getArcGeometry(arcData.p1, arcData.p2, arcData.p3)
          if (geo) {
            const center = toRootSpace(geo.cx, geo.cy)
            const p1 = toRootSpace(arcData.p1.x, arcData.p1.y)
            const p3 = toRootSpace(arcData.p3.x, arcData.p3.y)
            const radius = calculateDistance(center, p1)
            const distFromCenter = calculateDistance(coordinates, center)
            const radialDist = Math.abs(distFromCenter - radius)

            // Check if cursor is within the angular sweep
            const angle = Math.atan2(coordinates.y - center.y, coordinates.x - center.x)
            let normAngle = angle < 0 ? angle + 2 * Math.PI : angle

            let isWithinSweep = false
            const t1 = geo.theta1, t3 = geo.theta3
            if (geo.sweepFlag === 1) { // CCW
              if (t1 < t3) isWithinSweep = normAngle >= t1 && normAngle <= t3
              else isWithinSweep = normAngle >= t1 || normAngle <= t3
            } else { // CW
              if (t3 < t1) isWithinSweep = normAngle >= t3 && normAngle <= t1
              else isWithinSweep = normAngle >= t3 || normAngle <= t1
            }

            if (isWithinSweep) {
              distance = radialDist
            } else {
              // Distance to endpoints
              distance = Math.min(
                calculateDistance(coordinates, p1),
                calculateDistance(coordinates, p3)
              )
            }
          }
        }

        if (distance === undefined) {
          const pathLength = el.length()
          if (pathLength === 0) {
            distance = Infinity
          } else {
            let minDistance = Infinity
            const step = Math.min(5, Math.max(1, pathLength / 20))
            for (let i = 0; i <= pathLength; i += step) {
              const p = el.pointAt(i)
              const rp = toRootSpace(p.x, p.y)
              const d = calculateDistance(coordinates, rp)
              if (d < minDistance) {
                minDistance = d
              }
            }
            distance = minDistance
          }
        }
      } else if (el.type === 'polygon' || el.type === 'polyline') {
        const points = el.node.points
        let minDist = Infinity
        for (let i = 0; i < points.numberOfItems; i++) {
          const pt = points.getItem(i)
          const rp = toRootSpace(pt.x, pt.y)
          const d = calculateDistance(coordinates, rp)
          if (d < minDist) minDist = d
        }
        for (let i = 0; i < points.numberOfItems - 1; i++) {
          const pt1 = points.getItem(i)
          const pt2 = points.getItem(i + 1)
          const rp1 = toRootSpace(pt1.x, pt1.y)
          const rp2 = toRootSpace(pt2.x, pt2.y)
          const d = distanceFromPointToLine(coordinates, rp1, rp2)
          if (d < minDist) minDist = d
        }
        distance = minDist
      } else if (el.type === 'ellipse') {
        const center = toRootSpace(el.node.cx.baseVal.value, el.node.cy.baseVal.value)
        const rx = el.node.rx.baseVal.value
        const ry = el.node.ry.baseVal.value
        const minR = Math.min(rx, ry)
        if (minR > 1e-6) {
          const nx = (coordinates.x - center.x) / rx
          const ny = (coordinates.y - center.y) / ry
          const distToUnitCircle = Math.sqrt(nx * nx + ny * ny)
          distance = Math.abs(distToUnitCircle - 1) * minR
        } else {
          distance = calculateDistance(coordinates, center)
        }
      } else if (el.type === 'text') {
        const bbox = el.bbox()
        const pts = [
          toRootSpace(bbox.x, bbox.y),
          toRootSpace(bbox.x + bbox.width, bbox.y),
          toRootSpace(bbox.x + bbox.width, bbox.y + bbox.height),
          toRootSpace(bbox.x, bbox.y + bbox.height)
        ]
        let minDist = Infinity
        // Check if cursor is inside bounding box loosely, or get distance to edges
        if (isPolygonIntersectingRect(pts, { x: coordinates.x, y: coordinates.y, width: 0, height: 0 })) {
          distance = 0
        } else {
          for (let i = 0; i < 4; i++) {
            const d = distanceFromPointToLine(coordinates, pts[i], pts[(i + 1) % 4])
            if (d < minDist) minDist = d
          }
          distance = minDist
        }
      }

      if (distance !== undefined && distance < hoverThresholdWorld) {
        candidates.push({ el, distance })
      }
    })

    // Remove hover from all previously hovered elements
    hoveredElements.forEach((el) => removeHoverClass(el))

    // Sort leaf candidates by distance
    candidates.sort((a, b) => a.distance - b.distance)

    // Resolve leaf elements to their group ancestors (if any)
    // and deduplicate so hovering any child of a group selects the group
    const resolvedCandidates = []
    const seen = new Set()
    candidates.forEach(c => {
      const ancestor = findSelectableAncestor(c.el)
      const key = ancestor.node
      if (!seen.has(key)) {
        seen.add(key)
        resolvedCandidates.push({ el: ancestor, distance: c.distance })
      }
    })

    if (resolvedCandidates.length > 0) {
      addHoverClass(resolvedCandidates[0].el)
    }

    // Store all within-threshold elements sorted by distance (for Trim/Extend)
    hoveredElements = resolvedCandidates.map((c) => c.el)
    editor.hoveredElements = hoveredElements
  }

  function handleMousedown(e) {
    if (e.button === 0) closeDisambiguationMenu()

    if (editor.isDrawing || editor.isInteracting) {
      // Track left-clicked point as base for polar tracking (the draw plugin handles the rest)
      // We must check e.button === 0 to avoid capturing middle-click (panning) or right-click
      if (e.button === 0) {
        const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
        if (activeSvg && !editor.isSelecting) {
          editor.lastClick = editor.snapPoint || activeSvg.point(e.pageX, e.pageY)
        }
      }
      if (editor.isDrawing) return
    }

    // Handle vertex editing commit
    if (editor.isEditingVertex) {
      const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
      if (!activeSvg) return
      let point = editor.snapPoint || activeSvg.point(e.pageX, e.pageY)

      if (editor.ortho && editor.editingVertices.length > 0) {
        point = getOrthoConstrainedPoint(point, editor.editingVertices[0])
      }

      // Separate line updates and circle updates
      const lineUpdates = []
      const circleUpdates = []
      const ellipseUpdates = []
      const arcUpdates = []
      const splineUpdates = []
      const polylineUpdates = []
      const dimensionUpdates = []
      const viewportUpdates = []

      editor.editingVertices.forEach(v => {
        if (v.element.type === 'line') {
          // ... existing line logic ...
          lineUpdates.push({
            element: v.element,
            vertexIndex: v.vertexIndex,
            oldX: v.originalPosition.x,
            oldY: v.originalPosition.y,
            newX: point.x,
            newY: point.y
          })
        } else if (v.element.type === 'circle') {
          // ... existing circle logic ...
          let newCx = v.originalPosition.cx
          let newCy = v.originalPosition.cy
          let newR = v.originalPosition.r

          if (v.vertexIndex === 0) {
            newCx = point.x
            newCy = point.y
          } else {
            const currentCenter = { x: v.originalPosition.cx, y: v.originalPosition.cy }
            newR = calculateDistance(currentCenter, point)
          }
          circleUpdates.push({
            element: v.element,
            oldValues: { cx: v.originalPosition.cx, cy: v.originalPosition.cy, r: v.originalPosition.r },
            newValues: { cx: newCx, cy: newCy, r: newR }
          })
        } else if (v.element.type === 'ellipse') {
          const original = v.originalPosition
          let newCx = original.cx, newCy = original.cy
          let newRx = original.rx, newRy = original.ry

          if (v.vertexIndex === 0) {
            newCx = point.x; newCy = point.y
          } else if (v.vertexIndex === 1 || v.vertexIndex === 3) {
            newRx = Math.max(1e-3, Math.abs(point.x - original.cx))
          } else if (v.vertexIndex === 2 || v.vertexIndex === 4) {
            newRy = Math.max(1e-3, Math.abs(point.y - original.cy))
          }

          ellipseUpdates.push({
            element: v.element,
            oldValues: { cx: original.cx, cy: original.cy, rx: original.rx, ry: original.ry },
            newValues: { cx: newCx, cy: newCy, rx: newRx, ry: newRy }
          })
        } else if (v.element.type === 'path' && v.element.data('arcData')) {
          const arcData = v.element.data('arcData')
          const oldValues = {
            p1: { x: arcData.p1.x, y: arcData.p1.y },
            p2: { x: arcData.p2.x, y: arcData.p2.y },
            p3: { x: arcData.p3.x, y: arcData.p3.y }
          }
          const newValues = {
            p1: { x: arcData.p1.x, y: arcData.p1.y },
            p2: { x: arcData.p2.x, y: arcData.p2.y },
            p3: { x: arcData.p3.x, y: arcData.p3.y }
          }

          if (v.vertexIndex === 0) newValues.p1 = { x: point.x, y: point.y }
          else if (v.vertexIndex === 1) newValues.p2 = { x: point.x, y: point.y }
          else if (v.vertexIndex === 2) newValues.p3 = { x: point.x, y: point.y }

          arcUpdates.push({ element: v.element, oldValues, newValues })
        } else if (v.element.type === 'path' && v.element.data('splineData')) {
          const splineData = v.element.data('splineData')
          const oldPoints = v.originalPosition.points
          const newPoints = splineData.points.map(p => ({ x: p.x, y: p.y }))

          splineUpdates.push({ element: v.element, oldPoints, newPoints })
        } else if (v.element.type === 'polyline') {
          const oldPoints = v.originalPosition.points
          const newPoints = v.element.array().map(p => [p[0], p[1]])
          polylineUpdates.push({ element: v.element, oldPoints, newPoints })
        } else if (v.element._paperVp) {
          const vp = v.element._paperVp
          viewportUpdates.push({
            viewport: vp,
            oldValues: v.originalPosition,
            newValues: {
              x: vp.x,
              y: vp.y,
              width: vp.w,
              height: vp.h
            }
          })
        } else if (v.element.type === 'g' && v.element.attr('data-element-type') === 'dimension') {
          try {
            const oldData = v.originalPosition
            const newData = JSON.parse(v.element.attr('data-dim-data'))
            dimensionUpdates.push({ element: v.element, oldData, newData })
          } catch (e) { }
        }
      })

      // Stop edit mode immediately
      signals.vertexEditStopped.dispatch()

      if (lineUpdates.length > 0) {
        import('./commands/MultiEditVertexCommand.js').then(({ MultiEditVertexCommand }) => {
          editor.execute(new MultiEditVertexCommand(editor, lineUpdates))
          signals.updatedSelection.dispatch()
        })
      }

      if (dimensionUpdates.length > 0) {
        import('./commands/EditDimensionCommand.js').then(({ EditDimensionCommand }) => {
          editor.execute(new EditDimensionCommand(editor, dimensionUpdates))
          signals.updatedSelection.dispatch()
        })
      }

      if (circleUpdates.length > 0) {
        import('./commands/EditCircleCommand.js').then(({ EditCircleCommand }) => {
          // For now, assume single circle editing or multiple independent circle edits
          circleUpdates.forEach(update => {
            editor.execute(new EditCircleCommand(editor, update.element, update.oldValues, update.newValues))
          })
          signals.updatedSelection.dispatch()
        })
      }

      if (ellipseUpdates.length > 0) {
        import('./commands/EditEllipseCommand.js').then(({ EditEllipseCommand }) => {
          ellipseUpdates.forEach(update => {
            editor.execute(new EditEllipseCommand(editor, update.element, update.oldValues, update.newValues))
          })
          signals.updatedSelection.dispatch()
        })
      }

      if (arcUpdates.length > 0) {
        import('./commands/EditArcCommand.js').then(({ EditArcCommand }) => {
          arcUpdates.forEach(update => {
            editor.execute(new EditArcCommand(editor, update.element, update.oldValues, update.newValues))
          })
          signals.updatedSelection.dispatch()
        })
      }

      if (splineUpdates.length > 0) {
        import('./commands/EditSplineCommand.js').then(({ EditSplineCommand }) => {
          splineUpdates.forEach(update => {
            editor.execute(new EditSplineCommand(editor, update.element, update.oldPoints, update.newPoints))
          })
          signals.updatedSelection.dispatch()
        })
      }

      if (polylineUpdates.length > 0) {
        import('./commands/EditPolylineCommand.js').then(({ EditPolylineCommand }) => {
          polylineUpdates.forEach(update => {
            editor.execute(new EditPolylineCommand(editor, update.element, update.oldPoints, update.newPoints))
          })
          signals.updatedSelection.dispatch()
        })
      }

      if (viewportUpdates.length > 0) {
        viewportUpdates.forEach(update => {
          editor.execute(new EditViewportCommand(editor, update.viewport, update.oldValues, update.newValues))
        })
        signals.updatedSelection.dispatch()
      }

      return
    }

    if (editor.isInteracting) {
      if (e.button === 0) {
        const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
        if (!activeSvg) return
        const point = activeSvg.point(e.pageX, e.pageY)

        // Only capture points for single-click operations here.
        // Rectangle selection captures its own points via draw plugin.
        if (!editor.isSelecting) {
          if (editor.snapPoint) {
            signals.pointCaptured.dispatch(editor.snapPoint)
          } else {
            signals.pointCaptured.dispatch(point)
          }
        }

        if (hoveredElements.length > 1) {
          showDisambiguationMenu(hoveredElements, e, 'interacting')
        } else if (hoveredElements.length === 1) {
          editor.lastClick = point
          signals.toogledSelect.dispatch(hoveredElements[0], 'mousedown-interacting')
        } else if (!editor.selectSingleElement) {
          handleRectSelection(e)
        }
        return
      }
      // Non-left-clicks (middle/right) fall through so panning/zoom can still work
    }

    if (e.button === 1) {
      // Middle click is handled by the panzoom plugin and the native dblclick listener at the top
    } else if (!editor.isDrawing) {
      if (hoveredElements.length > 1) {
        showDisambiguationMenu(hoveredElements, e, 'normal')
      } else if (hoveredElements.length === 1) {
        signals.toogledSelect.dispatch(hoveredElements[0])
      } else {
        if (!editor.selectSingleElement) handleRectSelection(e)
      }
    }
  }

  function handleRectSelection(e) {
    e.preventDefault()
    e.stopImmediatePropagation()
    if (!editor.isDrawing) {
      const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
      if (activeSvg && !editor.isSelecting) {
        const startX = coordinates.x
        editor.isDrawing = true
        editor.isSelecting = true
        activeSvg.rect()
          .addClass('selectionRectangle')
          .draw()
          .on('drawupdate', (e) => {
            const rect = {}
            rect.x = e.target.x.baseVal.value
            rect.y = e.target.y.baseVal.value
            rect.width = e.target.width.baseVal.value
            rect.height = e.target.height.baseVal.value
            if (coordinates.x < startX) {
              e.srcElement.classList.add('selectionRectangleRight')
              findElements(rect, 'inside')
            } else {
              e.target.classList.remove('selectionRectangleRight')
              findElements(rect, 'intersect')
            }
          })
          .on('drawstop', (e) => {
            e.target.remove()
            editor.isDrawing = false
            editor.isSelecting = false
            selectHovered()
          })
      }
    }
  }

  function findElements(rect, selectionMode) {
    // ---- R-TREE SPATIAL QUERY for rectangle selection ----
    editor.spatialIndex.ensureFresh(editor)
    const rtreeResults = editor.spatialIndex.search({
      minX: rect.x,
      minY: rect.y,
      maxX: rect.x + rect.width,
      maxY: rect.y + rect.height,
    })

    // Clear previous hover state from all hovered elements
    hoveredElements.forEach((el) => {
      const removeHoverRecursive = (node) => {
        node.removeClass('elementHover')
        if (node.type === 'g' && node.children) {
          node.children().each(removeHoverRecursive)
        }
      }
      removeHoverRecursive(el)
    })
    hoveredElements = []

    const groupCandidates = new Set()

    // Only iterate R-tree candidates (not all elements)
    // Use the R-tree's world-space bbox (item.minX/minY/maxX/maxY) for
    // containment/intersection checks, since both the selection rect and the
    // R-tree bboxes are in SVG viewBox space.
    rtreeResults.forEach((item) => {
      const el = item.element
      if (el.hasClass('selectionRectangle') || el.hasClass('ghostLine') || el.hasClass('grid') || el.hasClass('axis')) return

      let isInsideOrIntersecting = false

      if (selectionMode === 'intersect') {
        // Window select (left-to-right): element must be completely inside rect
        isInsideOrIntersecting =
          item.minX >= rect.x &&
          item.minY >= rect.y &&
          item.maxX <= rect.x + rect.width &&
          item.maxY <= rect.y + rect.height
      } else if (selectionMode === 'inside') {
        // Crossing select (right-to-left): element must intersect or be inside the rect

        // Fast-path: if the R-tree bounding box is completely enclosed by the selection rect,
        // it's definitely inside. No need for exact intersection math.
        const isFullyEnclosed =
          item.minX >= rect.x &&
          item.minY >= rect.y &&
          item.maxX <= rect.x + rect.width &&
          item.maxY <= rect.y + rect.height

        if (isFullyEnclosed) {
          isInsideOrIntersecting = true
        } else {
          const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
          const svgCTM = activeSvg.screenCTM()
          let svgInvDet = 1
          let hasSvgCTM = false
          if (svgCTM) {
            svgInvDet = svgCTM.a * svgCTM.d - svgCTM.b * svgCTM.c
            hasSvgCTM = Math.abs(svgInvDet) > 1e-10
          }

          const ctm = el.screenCTM()
          const toRootSpace = (ctm && hasSvgCTM) ? (lx, ly) => {
            const ex = ctm.a * lx + ctm.c * ly + ctm.e
            const ey = ctm.b * lx + ctm.d * ly + ctm.f
            return {
              x: (svgCTM.d * (ex - svgCTM.e) - svgCTM.c * (ey - svgCTM.f)) / svgInvDet,
              y: (-svgCTM.b * (ex - svgCTM.e) + svgCTM.a * (ey - svgCTM.f)) / svgInvDet,
            }
          } : (lx, ly) => ({ x: lx, y: ly })

          if (el.type === 'line') {
            const p1 = toRootSpace(el.attr('x1'), el.attr('y1'))
            const p2 = toRootSpace(el.attr('x2'), el.attr('y2'))
            isInsideOrIntersecting = isLineIntersectingRect({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }, rect)
          } else if (el.type === 'circle') {
            const center = toRootSpace(el.cx(), el.cy())
            const edgePoint = toRootSpace(el.cx() + el.attr('r'), el.cy())
            const radius = calculateDistance(center, edgePoint)
            isInsideOrIntersecting = isCircleIntersectingRect({ cx: center.x, cy: center.y, r: radius }, rect)
          } else if (el.type === 'rect') {
            const x = el.x(), y = el.y(), w = el.width(), h = el.height()
            const pts = [toRootSpace(x, y), toRootSpace(x + w, y), toRootSpace(x + w, y + h), toRootSpace(x, y + h)]
            isInsideOrIntersecting = isPolygonIntersectingRect(pts, rect)
          } else if (el.type === 'path' || el.type === 'polyline' || el.type === 'polygon') {
            // Approximate path/polygon as a points array
            const pts = []
            if (el.type === 'path') {
              const len = el.length()
              const step = Math.min(10, Math.max(1, len / 20))
              for (let i = 0; i <= len; i += step) {
                const p = el.pointAt(i)
                pts.push(toRootSpace(p.x, p.y))
              }
            } else {
              el.array().forEach(p => pts.push(toRootSpace(p[0], p[1])))
            }
            isInsideOrIntersecting = isPolygonIntersectingRect(pts, rect)
          } else if (el.type === 'text') {
            const bbox = el.bbox()
            const pts = [
              toRootSpace(bbox.x, bbox.y),
              toRootSpace(bbox.x + bbox.width, bbox.y),
              toRootSpace(bbox.x + bbox.width, bbox.y + bbox.height),
              toRootSpace(bbox.x, bbox.y + bbox.height)
            ]
            isInsideOrIntersecting = isPolygonIntersectingRect(pts, rect)
          } else {
            // Fallback to bbox if type is unhandled (e.g. ellipse)
            isInsideOrIntersecting = true
          }
        }
      }

      if (isInsideOrIntersecting) {
        const selectableAncestor = findSelectableAncestor(el)

        if (!groupCandidates.has(selectableAncestor.node)) {
          groupCandidates.add(selectableAncestor.node)

          const applyHoverRecursive = (node) => {
            node.addClass('elementHover')
            if (node.type === 'g' && node.children) {
              node.children().each(applyHoverRecursive)
            }
          }
          applyHoverRecursive(selectableAncestor)

          if (!hoveredElements.some((item) => item.node === selectableAncestor.node)) {
            hoveredElements.push(selectableAncestor)
          }
        }
      }
    })
  }

  function selectHovered() {
    const backupHovered = [...hoveredElements]

    // During interaction tools that support multi-selection (like Extend), dispatch toogledSelect directly
    if (editor.isInteracting && !editor.selectSingleElement) {
      // Create a unique copy based on node identity to prevent double-dispatch
      const elementsToDispatch = []
      const seenNodes = new Set()
      backupHovered.forEach(el => {
        if (!seenNodes.has(el.node)) {
          seenNodes.add(el.node)
          elementsToDispatch.push(el)
        }
      })

      // Update lastClick to current coordinates so direction logic works for rect selection
      editor.lastClick = coordinates

      elementsToDispatch.forEach(el => {
        signals.toogledSelect.dispatch(el, 'selectHovered-multi')
      })

      // Ensure hover state is properly updated after extend operations
      signals.requestHoverCheck.dispatch()
      return
    }

    clearHover()

    backupHovered.forEach((el) => {
      if (!editor.selected.some((item) => item.node === el.node)) {
        editor.selected.push(el)
      }
    })

    // Only dispatch the signal once after all elements are processed
    if (backupHovered.length > 0) {
      editor.signals.updatedSelection.dispatch()
    }
  }

  function checkSnap(screenCoords) {
    const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
    if (!activeSvg) return

    const result = checkSnapSystem(screenCoords, editor, activeSvg, snapTolerance)
    if (result) {
      drawSnap(result.worldPoint, activeSvg.zoom(), activeSvg, result.snapType)
      editor.snapPoint = result.worldPoint
    } else {
      editor.snapPoint = null
    }

    if (editor.snapTypes.extension && editor.extensionHovers && editor.extensionHovers.length > 0) {
      const cursorWorld = activeSvg.point(screenCoords.x, screenCoords.y)
      drawExtensionLines(editor.extensionHovers, cursorWorld, activeSvg.zoom(), activeSvg)
    }
  }

  // Update offset ghosts: translate for lines/paths, resize for circles/rects
  function updateOffsetGhosts(point) {
    if (ghostElements) {
      if (!offsetGhostClone) {
        offsetGhostClone = ghostElements.clone()
        offsetGhostClone.putIn(editor.drawing)
      }

      // For circles/rects, resize instead of translate
      if (ghostElements.type === 'circle') {
        offsetGhostClone.transform({}) // Reset transform
        const cx = ghostElements.cx()
        const cy = ghostElements.cy()
        const r = ghostElements.radius ? ghostElements.radius() : ghostElements.attr('r')
        const dx = point.x - cx
        const dy = point.y - cy
        const dist = Math.hypot(dx, dy)
        const inward = dist < (typeof r === 'number' ? r : parseFloat(r))
        const newR = Math.max(0, (typeof r === 'number' ? r : parseFloat(r)) + (inward ? -offsetDistance : offsetDistance))
        offsetGhostClone.center(cx, cy)
        if (offsetGhostClone.radius) offsetGhostClone.radius(newR)
        else offsetGhostClone.attr('r', newR)
      } else if (ghostElements.type === 'rect') {
        offsetGhostClone.transform({}) // Reset transform
        const x = ghostElements.x()
        const y = ghostElements.y()
        const w = ghostElements.width()
        const h = ghostElements.height()
        const cx = x + w / 2
        const cy = y + h / 2
        const inside = point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h
        const delta = inside ? -offsetDistance : offsetDistance
        const newW = Math.max(0, w + 2 * delta)
        const newH = Math.max(0, h + 2 * delta)
        const newX = cx - newW / 2
        const newY = cy - newH / 2
        offsetGhostClone.size(newW, newH)
        offsetGhostClone.move(newX, newY)
      } else {
        const initial = initialTransforms.get(ghostElements)
        offsetGhostClone.transform(initial || {}) // Reset to initial
        // Compute offset direction relative to the selected element and click position
        const { dx, dy } = computeOffsetVector(ghostElements, point, offsetDistance)
        offsetGhostClone.translate(dx, dy)
      }
    }
  }

  // --- Polar tracking guide helpers ---

  /**
   * Draws dashed guide lines for active polar angles and returns the snapped point.
   * @param {object} cursorPoint - Current cursor in world coords { x, y }
   * @param {SVG.Svg} activeSvg  - Active SVG canvas
   * @returns {{ x, y } | null}  - Snapped world point, or null if no angle matches
   */
  function updatePolarGuides(cursorPoint, activeSvg) {
    polarGroup.clear()

    // Pick base point: prefer ghosting base, then rotation center, then last click
    const base = basePoint || centerPoint || editor.lastClick
    if (!base) return null

    const dx = cursorPoint.x - base.x
    const dy = cursorPoint.y - base.y
    const dist = Math.hypot(dx, dy)
    if (dist < 1e-6) return null

    // SVG Y is inverted vs math convention → negate dy to measure angles Y-up
    const cursorAngleDeg = Math.atan2(-dy, dx) * (180 / Math.PI)
    const normalizedCursor = ((cursorAngleDeg % 360) + 360) % 360

    const angleTolerance = 5 // degrees
    let bestAngle = null
    let bestDiff = Infinity

    for (const angle of editor.polarAngles) {
      let diff = Math.abs(normalizedCursor - angle)
      if (diff > 180) diff = 360 - diff
      if (diff < angleTolerance && diff < bestDiff) {
        bestDiff = diff
        bestAngle = angle
      }
    }

    if (bestAngle === null) return null

    // Compute pixel→world ratio from viewbox (same approach as checkSnap)
    const vb = activeSvg.viewbox()
    const svgWidth = activeSvg.node.clientWidth || activeSvg.node.getBoundingClientRect().width || 1
    const worldPerPixel = vb.width / svgWidth

    const extent = Math.max(vb.width, vb.height) * 2
    const strokeW = 1.5 * worldPerPixel
    const dashOn = 6 * worldPerPixel
    const dashOff = 4 * worldPerPixel

    const rad = bestAngle * (Math.PI / 180)
    const cosA = Math.cos(rad)
    const sinA = Math.sin(rad)   // Y-up convention: +sin goes UP (negative SVG y)

    // Guide line: extend in both directions along the polar angle
    polarGroup
      .line(
        base.x - cosA * extent, base.y + sinA * extent,
        base.x + cosA * extent, base.y - sinA * extent
      )
      .stroke({ color: 'orange', width: strokeW, dasharray: `${dashOn} ${dashOff}` })
      .css('pointer-events', 'none')

    // Angle label — placed closely to the cursor
    const offsetX = 20 * worldPerPixel
    const offsetY = 20 * worldPerPixel
    const fontSize = 20 * worldPerPixel
    polarGroup
      .plain(`${bestAngle}\u00b0`)
      .attr({
        x: cursorPoint.x + offsetX,
        y: cursorPoint.y + offsetY,
        'dominant-baseline': 'hanging'
      })
      .font({ size: fontSize, fill: 'orange' })
      .css('pointer-events', 'none')

    // Project cursor onto the ray: snapped = base + dot(cursor-base, unit) * unit
    const dot = dx * cosA + (-dy) * sinA  // in Y-up math coords
    return {
      x: base.x + cosA * dot,
      y: base.y - sinA * dot              // convert back to SVG coords
    }
  }

  function clearPolarGuides() {
    polarGroup.clear()
  }
}

function calculateRotationAngle(centerPoint, referencePoint, targetPoint) {
  const vec1 = { x: referencePoint.x - centerPoint.x, y: referencePoint.y - centerPoint.y }
  const vec2 = { x: targetPoint.x - centerPoint.x, y: targetPoint.y - centerPoint.y }

  // Use atan2 of the cross product and dot product to get the signed angle
  const dot = vec1.x * vec2.x + vec1.y * vec2.y
  const cross = vec1.x * vec2.y - vec1.y * vec2.x
  const angleRad = Math.atan2(cross, dot)
  const angleDegrees = angleRad * (180 / Math.PI)
  return angleDegrees
}

export { Viewport }
