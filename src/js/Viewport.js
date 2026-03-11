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
  })
  signals.clearSelection.add(() => {
    editor.selected.forEach((el) => {
      el.removeClass('elementSelected')
      el.attr('selected', false)
    })
    editor.selected = []
    editor.handlers.clear()
    clearHover()
    clearSelectionRectangle()
  })
  signals.commandCancelled.add(() => {
    editor.spatialIndex.markDirty()
    clearHover()
    clearSnap()
    clearSelectionRectangle()
    editor.isDrawing = false
    editor.isSelecting = false
  })

  function clearSelectionRectangle() {
    svg.find('.selectionRectangle').each(el => el.remove())
  }

  signals.requestHoverCheck.add(() => {
    checkHover()
  })

  document.addEventListener('contextmenu', handleRightClick)
  // Create groups for grid and axis within overlays
  const gridGroup = editor.overlays.group().addClass('grid')
  const axisGroup = editor.overlays.group().addClass('axis-group')

  svg
    .addClass('canvas')
    .mousemove(handleMove)
    .mousedown(handleMousedown)
    // .mouseup(handleClick)
    // .click(handleClick)
    .panZoom({ zoomFactor, panButton: 1 })
    .on('zoom', updateGrid)
    .on('pan', updateGrid)

  svg.viewbox(-5, -5, 10, 10)
  updateGrid()

  signals.preferencesChanged.add((newPrefs) => {
    hoverTreshold = newPrefs.hoverThreshold
    gridSpacing = newPrefs.gridSize
    updateGrid()
  })

  // Zoom to extents (drawing elements only) on double middle click
  svg.on('mousedown', (e) => {
    // Check for middle click (button === 1) and double click (detail >= 2, handles rapid clicks by OS)
    if (e.button === 1 && e.detail >= 2) {
      e.preventDefault()
      e.stopPropagation()

      // Hide handlers temporarily so their bounding boxes don't affect the extents
      const wasHandlersVisible = editor.handlers.visible()
      if (wasHandlersVisible) editor.handlers.hide()

      const box = editor.drawing.bbox()

      if (wasHandlersVisible) editor.handlers.show()

      // Only zoom if there's actual content
      if (box.width > 0 || box.height > 0) {
        const padding = Math.max(box.width, box.height) * 0.1 || 2

        // Disable rendering handlers temporarily while animating
        svg.animate(300, '>').viewbox(box.x - padding, box.y - padding, box.width + padding * 2, box.height + padding * 2).after(() => {
          updateGrid()
        })

        // Keep grid updating slightly during animation if needed, or rely on .after
      }
    }
  })

  function updateGrid() {
    const rect = svg.node.getBoundingClientRect()
    const p1 = svg.point(rect.left, rect.top)
    const p2 = svg.point(rect.right, rect.top)
    const p3 = svg.point(rect.left, rect.bottom)
    const p4 = svg.point(rect.right, rect.bottom)

    const xMin = Math.min(p1.x, p2.x, p3.x, p4.x)
    const xMax = Math.max(p1.x, p2.x, p3.x, p4.x)
    const yMin = Math.min(p1.y, p2.y, p3.y, p4.y)
    const yMax = Math.max(p1.y, p2.y, p3.y, p4.y)

    // Add a generous margin so the grid extends beyond the visible viewport,
    // preventing blank borders when zooming out
    const marginX = (xMax - xMin) * 0.5
    const marginY = (yMax - yMin) * 0.5

    const vb = {
      x: xMin - marginX,
      y: yMin - marginY,
      width: (xMax - xMin) + marginX * 2,
      height: (yMax - yMin) + marginY * 2
    }

    // Set fixed spacing to 1
    const spacing = gridSpacing

    // Optimization: Don't draw the grid if it's too dense (lines would be < 2px apart)
    const zoom = svg.zoom()
    if (spacing * zoom < 2) {
      gridGroup.clear()
      axisGroup.clear()
      drawAxis(axisGroup, vb)
      return
    }

    // Clear old drawings
    gridGroup.clear()
    axisGroup.clear()

    drawGrid(gridGroup, vb, spacing)
    drawAxis(axisGroup, vb)
  }

  function drawAxis(group, vb) {
    const { x, y, width, height } = vb
    const xMax = x + width
    const yMax = y + height

    // Draw X-axis if visible
    if (y <= 0 && yMax >= 0) {
      group.line(x, 0, xMax, 0).addClass('axis x-axis')
    }
    // Draw Y-axis if visible
    if (x <= 0 && xMax >= 0) {
      group.line(0, y, 0, yMax).addClass('axis y-axis')
    }
  }

  function drawGrid(group, vb, spacing) {
    const { x, y, width, height } = vb
    const xMin = x
    const xMax = x + width
    const yMin = y
    const yMax = y + height

    // Calculate starting points rounded to spacing
    const startX = Math.floor(xMin / spacing) * spacing
    const startY = Math.floor(yMin / spacing) * spacing

    for (let gx = startX; gx <= xMax; gx += spacing) {
      if (Math.abs(gx) > 0.001) { // Avoid drawing over the axis
        group.line(gx, yMin, gx, yMax).addClass('axis')
      }
    }

    for (let gy = startY; gy <= yMax; gy += spacing) {
      if (Math.abs(gy) > 0.001) { // Avoid drawing over the axis
        group.line(xMin, gy, xMax, gy).addClass('axis')
      }
    }
  }

  function onMoveGhostingStarted(elements, point) {
    isGhostingMove = true
    ghostElements = elements
    basePoint = point
    ghostElements.forEach((el) => {
      initialTransforms.set(el, el.transform())
    })
  }

  function onMoveGhostingStopped() {
    isGhostingMove = false
    ghostElements.forEach((el) => {
      const initial = initialTransforms.get(el)
      el.transform(initial)
    })
    ghostElements = []
    basePoint = null
    initialTransforms.clear()
  }

  function onScaleGhostingStarted(elements, point) {
    isGhostingScale = true
    ghostElements = elements
    basePoint = point
    ghostElements.forEach((el) => {
      initialTransforms.set(el, el.transform())
    })
  }

  function onScaleGhostingStopped() {
    isGhostingScale = false
    ghostElements.forEach((el) => {
      const initial = initialTransforms.get(el)
      el.transform(initial)
    })
    ghostElements = []
    basePoint = null
    initialTransforms.clear()
  }

  function onRotateGhostingStarted(elements, cPoint, rPoint) {
    isGhostingRotate = true
    ghostElements = elements
    centerPoint = cPoint
    referencePoint = rPoint
    ghostElements.forEach((el) => {
      initialTransforms.set(el, el.transform())
    })
  }

  function onRotateGhostingStopped() {
    isGhostingRotate = false
    ghostElements.forEach((el) => {
      const initial = initialTransforms.get(el)
      el.transform(initial)
    })
    ghostElements = []
    centerPoint = null
    referencePoint = null
    initialTransforms.clear()
  }

  function onOffsetGhostingStarted(element, distance) {
    // Create clone ghosts in overlays and track initial transforms
    console.log('ghost started. ghost element:', element)
    const el = element[0]
    initialTransforms.set(el, el.transform())
    console.log('initial transforms', initialTransforms)
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
    console.log('Vertex edit started for', vertices.length, 'vertices')
  }

  function onVertexEditStopped() {
    editor.handlers.removeClass('handlers-editing')
    editor.isEditingVertex = false
    editor.editingVertices = []
    console.log('Vertex edit stopped')
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

  function handleMove(e) {
    clearSnap()
    if (editor.isSnapping) {
      if ((editor.isDrawing && !editor.isSelecting) || editor.isInteracting || editor.isEditingVertex) {
        checkSnap({ x: e.pageX, y: e.pageY })
      } else {
        editor.snapPoint = null
      }
    } else {
      editor.snapPoint = null
    }
    coordinates = svg.point(e.pageX, e.pageY)
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
          const localDelta = calculateLocalDelta(el, dx, dy)
          el.transform(initial).translate(localDelta.dx, localDelta.dy)
        })
      }
      if (isGhostingRotate) {
        let rotationAngle = calculateRotationAngle(centerPoint, referencePoint, coordinates)
        if (editor.distance) {
          rotationAngle = editor.distance
        }
        ghostElements.forEach((el) => {
          const initial = initialTransforms.get(el)
          el.transform(initial)
          el.rotate(rotationAngle, centerPoint.x, centerPoint.y)
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
          el.transform(initial).scale(scaleFactor, scaleFactor, basePoint.x, basePoint.y)
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
        }
      })

      // Redraw handlers to follow the vertex
      signals.updatedSelection.dispatch()
    }
    updateCoordinates(coordinates)
    scheduleHoverCheck()
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

  function checkHover() {
    if (editor.isDrawing) {
      clearHover()
      return
    }
    const candidates = []
    const svgNode = svg.node

    // Compute inverted SVG root CTM once per frame (not per element)
    const svgCTM = svgNode.getCTM()
    let svgInvDet = 1
    let hasSvgCTM = false
    if (svgCTM) {
      svgInvDet = svgCTM.a * svgCTM.d - svgCTM.b * svgCTM.c
      hasSvgCTM = Math.abs(svgInvDet) > 1e-10
    }

    const pad = hoverTreshold

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
      const ctm = el.node.getCTM()

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
        distance = calculateDistance(coordinates, center)
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

      if (distance !== undefined && distance < hoverTreshold) {
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
    console.log('[DEBUG handleMousedown] isDrawing=', editor.isDrawing, 'isInteracting=', editor.isInteracting, 'isEditingVertex=', editor.isEditingVertex)
    if (editor.isDrawing) return

    // Handle vertex editing commit
    if (editor.isEditingVertex) {
      let point = editor.snapPoint || svg.point(e.pageX, e.pageY)

      if (editor.ortho && editor.editingVertices.length > 0) {
        point = getOrthoConstrainedPoint(point, editor.editingVertices[0])
      }

      // Separate line updates and circle updates
      const lineUpdates = []
      const circleUpdates = []
      const arcUpdates = []
      const splineUpdates = []

      editor.editingVertices.forEach(v => {
        if (v.element.type === 'line') {
          lineUpdates.push({
            element: v.element,
            vertexIndex: v.vertexIndex,
            oldX: v.originalPosition.x,
            oldY: v.originalPosition.y,
            newX: point.x,
            newY: point.y
          })
        } else if (v.element.type === 'circle') {
          // For circle, we calculate the final state
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

      if (circleUpdates.length > 0) {
        import('./commands/EditCircleCommand.js').then(({ EditCircleCommand }) => {
          // For now, assume single circle editing or multiple independent circle edits
          circleUpdates.forEach(update => {
            editor.execute(new EditCircleCommand(editor, update.element, update.oldValues, update.newValues))
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

      return
    }

    if (editor.isInteracting) {
      const point = svg.point(e.pageX, e.pageY)

      // Only capture points for single-click operations here. 
      // Rectangle selection captures its own points via draw plugin.
      if (!editor.isSelecting) {
        if (editor.snapPoint) {
          signals.pointCaptured.dispatch(editor.snapPoint)
        } else {
          signals.pointCaptured.dispatch(point)
        }
      }

      if (hoveredElements.length > 0) {
        editor.lastClick = point
        signals.toogledSelect.dispatch(hoveredElements[0], 'mousedown-interacting')
      } else if (!editor.selectSingleElement) {
        handleRectSelection(e)
      }
      return
    }

    if (e.button === 1) {
      // Middle click is handled by the panzoom plugin and the native dblclick listener at the top
    } else if (!editor.isDrawing) {
      console.log('hoveredElements', hoveredElements)
      if (hoveredElements.length > 0) {
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
      const startX = coordinates.x
      editor.isDrawing = true
      editor.isSelecting = true
      svg.click(null)
      svg
        .rect()
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
          const svgNode = svg.node
          const svgCTM = svgNode.getCTM()
          let svgInvDet = 1
          let hasSvgCTM = false
          if (svgCTM) {
            svgInvDet = svgCTM.a * svgCTM.d - svgCTM.b * svgCTM.c
            hasSvgCTM = Math.abs(svgInvDet) > 1e-10
          }

          const ctm = el.node.getCTM()
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
      // Check if element is already selected before adding it using node identity
      if (!editor.selected.some((item) => item.node === el.node)) {
        editor.selected.push(el)
        console.log('Added element to selection:', el.type)
      } else {
        console.log('Element already selected, skipping:', el.type)
      }
    })

    // Only dispatch the signal once after all elements are processed
    if (backupHovered.length > 0) {
      editor.signals.updatedSelection.dispatch()
    }
  }

  function checkSnap(coordinates) {
    let targets = []

    // ---- R-TREE SPATIAL QUERY for snap ----
    // Convert snap tolerance from screen pixels to world units
    const vb = svg.viewbox()
    const svgWidth = svg.node.clientWidth || svg.node.getBoundingClientRect().width || 1
    const worldPerPixel = vb.width / svgWidth
    const snapWorldRadius = snapTolerance * worldPerPixel
    const cursorWorld = svg.point(coordinates.x, coordinates.y)

    editor.spatialIndex.ensureFresh(editor)
    const nearbyCandidates = editor.spatialIndex.search({
      minX: cursorWorld.x - snapWorldRadius,
      minY: cursorWorld.y - snapWorldRadius,
      maxX: cursorWorld.x + snapWorldRadius,
      maxY: cursorWorld.y + snapWorldRadius,
    })

    // Build snap candidates from R-tree results, applying the same filters
    let snapCandidates = nearbyCandidates.map(item => item.element)
    if (editor.isDrawing) {
      snapCandidates = snapCandidates.filter(el => el.attr('id') !== undefined && el.attr('id') !== null)
    }
    if (editor.isEditingVertex && editor.editingVertices.length > 0) {
      const editingNodes = editor.editingVertices.map(v => v.element.node)
      snapCandidates = snapCandidates.filter(el => !editingNodes.includes(el.node))
    }

    snapCandidates.forEach((el) => {
      if (el.type === 'line') {
        el.array().forEach((pointArr) => {
          let worldPoint = { x: pointArr[0], y: pointArr[1] }
          let screenPoint = worldToScreen(worldPoint, editor.svg)
          targets.push(screenPoint)
        })
      } else if (el.type === 'circle') {
        const cx = el.node.cx.baseVal.value
        const cy = el.node.cy.baseVal.value
        const r = el.node.r.baseVal.value

        const points = [
          { x: cx, y: cy },
          { x: cx, y: cy - r },
          { x: cx + r, y: cy },
          { x: cx, y: cy + r },
          { x: cx - r, y: cy }
        ]

        points.forEach(p => {
          targets.push(worldToScreen(p, editor.svg))
        })
      } else if (el.type === 'rect') {
        const rx = el.node.x.baseVal.value
        const ry = el.node.y.baseVal.value
        const rw = el.node.width.baseVal.value
        const rh = el.node.height.baseVal.value

        const points = [
          { x: rx, y: ry },
          { x: rx + rw, y: ry },
          { x: rx + rw, y: ry + rh },
          { x: rx, y: ry + rh },
          { x: rx + rw / 2, y: ry },
          { x: rx + rw, y: ry + rh / 2 },
          { x: rx + rw / 2, y: ry + rh },
          { x: rx, y: ry + rh / 2 }
        ]

        points.forEach(p => {
          targets.push(worldToScreen(p, editor.svg))
        })
      } else if (el.type === 'path' && el.data('arcData')) {
        const arcData = el.data('arcData')
        const points = [
          { x: arcData.p1.x, y: arcData.p1.y },
          { x: arcData.p2.x, y: arcData.p2.y },
          { x: arcData.p3.x, y: arcData.p3.y }
        ]

        points.forEach(p => {
          targets.push(worldToScreen(p, editor.svg))
        })
      } else if (el.type === 'polygon' || el.type === 'polyline') {
        el.array().forEach((pointArr) => {
          let worldPoint = { x: pointArr[0], y: pointArr[1] }
          let screenPoint = worldToScreen(worldPoint, editor.svg)
          targets.push(screenPoint)
        })
      }
    })
    let closest
    let minDistance = Infinity
    for (let target of targets) {
      const distance = calculateDistance(coordinates, target)
      if (distance < snapTolerance && distance < minDistance) {
        minDistance = distance
        closest = target
      }
    }
    const currentZoom = editor.svg.zoom()
    if (closest) {
      let closestWorld = svg.point(closest.x, closest.y)
      drawSnap(closestWorld, currentZoom, editor.snap)
      editor.snapPoint = closestWorld
    } else {
      editor.snapPoint = null
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
}

function drawSnap(point, zoom, svg) {
  const snapSquareScreenSize = 15
  const currentZoom = zoom && zoom ? zoom : 1
  const snapSquareWorldSize = snapSquareScreenSize / currentZoom
  const strokeWorldUnits = 3 / currentZoom
  svg
    .rect(snapSquareWorldSize, snapSquareWorldSize)
    .center(point.x, point.y)
    .fill('none')
    .stroke({ color: 'hsl(217, 47%, 55%)', width: strokeWorldUnits })
}

function clearSnap() {
  if (editor.snap) {
    editor.snap.clear()
  }
}

function handleRightClick(e) {
  e.preventDefault()
  editor.svg.fire('cancelDrawing', e)
}

function clearSelection(svg) {
  svg.children().each((el) => {
    if (!el.hasClass('grid') && !el.hasClass('axis')) {
      if (el.attr('selected') === 'true') {
        el.selectize(false, { deepSelect: true })
        el.attr('selected', false)
        el.removeClass('elementSelected')
      }
    }
  })
}

function menuOverlay() {
  let overlayMenu = document.getElementsByClassName('overlay-menu')[0]
  overlayMenu.classList.toggle('show-menu')
  setTimeout(() => checkMouseOverMenu(), 1000)
  function checkMouseOverMenu() {
    window.addEventListener('mousemove', mouseMoveListener)
  }

  function mouseMoveListener(event) {
    if (event.target != overlayMenu) {
      overlayMenu.classList.remove('show-menu')
      window.removeEventListener('mousemove', mouseMoveListener)
    }
  }
}

function handleToogleOverlay() {
  let overlayButton = document.getElementsByClassName('icon-overlay')[0]
  if (overlayButton.classList.contains('is-active')) {
    overlayButton.classList.remove('is-active')
    editor.overlays.hide()
  } else {
    overlayButton.classList.add('is-active')
    editor.overlays.show()
  }
}

function handleToogleOrtho() {
  let orthoButton = document.getElementsByClassName('icon-orthomode')[0]
  if (orthoButton.classList.contains('is-active')) {
    orthoButton.classList.remove('is-active')
    editor.ortho = false
    editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'Ortho OFF' })
  } else {
    orthoButton.classList.add('is-active')
    editor.ortho = true
    editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'Ortho ON' })
  }
  editor.svg.fire('orthoChange')
}

function handleToogleSnap() {
  let snapButton = document.getElementsByClassName('icon-snap-off')[0]
  if (snapButton.classList.contains('is-active')) {
    snapButton.classList.remove('is-active')
    editor.isSnapping = false
    editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'Snap OFF' })
  } else {
    snapButton.classList.add('is-active')
    editor.isSnapping = true
    editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'Snap ON' })
  }
}

/**
 * Converts a point from SVG world coordinates to screen coordinates using svg.js helpers.
 * @param {object} worldPoint - The point in world space { x, y }.
 * @param {SVG.Svg} svgCanvas - The main svg.js canvas element.
 * @returns {object} The converted point in screen space { x, y }.
 */
function worldToScreen(worldPoint, svgCanvas) {
  // Get the screen transformation matrix from the canvas
  const matrix = svgCanvas.screenCTM()

  // Create an svg.js point and apply the transformation
  const screenPoint = new SVG.Point(worldPoint).transform(matrix)

  return { x: screenPoint.x, y: screenPoint.y }
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

window.handleToogleOverlay = handleToogleOverlay
window.handleToogleOrtho = handleToogleOrtho
window.handleToogleSnap = handleToogleSnap
window.menuOverlay = menuOverlay

function handleToggleNonScalingStroke(enabled) {
  const svgEl = document.getElementById('canvas').querySelector('svg')
  if (enabled) {
    svgEl.classList.add('non-scaling-stroke')
  } else {
    svgEl.classList.remove('non-scaling-stroke')
  }
}
window.handleToggleNonScalingStroke = handleToggleNonScalingStroke

export { Viewport }
