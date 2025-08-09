import {
  calculateDistance,
  distanceFromPointToLine,
  distanceFromPointToCircle,
  distancePointToRectangleStroke,
  calculateDeltaFromBasepoint,
} from './utils/calculateDistance'
import { isLineIntersectingRect, isCircleIntersectingRect, isPolygonIntersectingRect } from './utils/intersection'

function Viewport(editor) {
  const signals = editor.signals
  const svg = editor.svg
  const drawing = editor.drawing

  let hoverTreshold = 0.5
  let hoveredElements = []
  let zoomFactor = 0.1
  let coordinates = { x: 0, y: 0 }
  let GRID_SIZE = 20
  let GRID_SPACING = 1
  let lastMiddleClickTime = 0
  let middleClickCount = 0
  let snapTolerance = 50
  let ghostElements = []
  let basePoint = null
  let initialTransforms = new Map()
  let isGhostingMove = false
  let isGhostingRotate = false
  let isGhostingOffset = false
  let offsetOriginalElements = []
  let offsetDistance = 0
  let centerPoint = null
  let referencePoint = null

  signals.moveGhostingStarted.add(onMoveGhostingStarted)
  signals.moveGhostingStopped.add(onMoveGhostingStopped)

  signals.rotateGhostingStarted.add(onRotateGhostingStarted)
  signals.rotateGhostingStopped.add(onRotateGhostingStopped)

  signals.offsetGhostingStarted.add(onOffsetGhostingStarted)
  signals.offsetGhostingStopped.add(onOffsetGhostingStopped)

  document.addEventListener('contextmenu', handleRightClick)
  let canvas = document.getElementById('canvas')
  svg
    .addClass('canvas')
    .addClass('cartesian')
    .mousemove(handleMove)
    .mousedown(handleMousedown)
    // .mouseup(handleClick)
    // .click(handleClick)
    .panZoom({ zoomFactor, panButton: 1 })
  drawGrid(editor.overlays, GRID_SIZE, GRID_SPACING)
  drawAxis(editor.overlays, GRID_SIZE)
  svg.animate(300).viewbox(svg.bbox())

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

  // Compute perpendicular offset vector for a given element towards mouse by a distance
  function computeOffsetVector(originalElement, mouse, distance) {
    try {
      if (!originalElement) return { dx: 0, dy: 0 }

      // svg.js element exposes .type
      const type =
        originalElement.type || (originalElement.node && originalElement.node.tagName && originalElement.node.tagName.toLowerCase()) || ''

      // Helper to normalize vector
      const normalize = (vx, vy) => {
        const len = Math.hypot(vx, vy) || 1
        return { x: vx / len, y: vy / len }
      }

      // Helper to compute sign based on which side of perpendicular mouse is
      const signForPerp = (center, perp) => {
        const toMouseX = mouse.x - center.x
        const toMouseY = mouse.y - center.y
        const proj = toMouseX * perp.x + toMouseY * perp.y
        return proj >= 0 ? 1 : -1
      }

      if (type === 'line') {
        const x1 = originalElement.node.x1.baseVal.value
        const y1 = originalElement.node.y1.baseVal.value
        const x2 = originalElement.node.x2.baseVal.value
        const y2 = originalElement.node.y2.baseVal.value
        const dir = normalize(x2 - x1, y2 - y1)
        // Perpendicular vector (rotate 90deg)
        const perp = { x: -dir.y, y: dir.x }
        const center = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }
        const s = signForPerp(center, perp)
        return { dx: perp.x * distance * s, dy: perp.y * distance * s }
      }

      if (type === 'rect') {
        const x = originalElement.x()
        const y = originalElement.y()
        const w = originalElement.width()
        const h = originalElement.height()
        const center = { x: x + w / 2, y: y + h / 2 }
        // Prefer axis with larger delta to mouse
        const dxm = mouse.x - center.x
        const dym = mouse.y - center.y
        if (Math.abs(dym) >= Math.abs(dxm)) {
          const s = dym >= 0 ? 1 : -1
          return { dx: 0, dy: distance * s }
        } else {
          const s = dxm >= 0 ? 1 : -1
          return { dx: distance * s, dy: 0 }
        }
      }

      if (type === 'circle' || type === 'ellipse') {
        const cx = originalElement.cx()
        const cy = originalElement.cy()
        const dir = normalize(mouse.x - cx, mouse.y - cy)
        const s = 1 // outward by default
        return { dx: dir.x * distance * s, dy: dir.y * distance * s }
      }

      // Default: vertical offset based on mouse.y
      let cx = 0
      let cy = 0
      if (originalElement.bbox) {
        const b = originalElement.bbox()
        cx = b.x + b.width / 2
        cy = b.y + b.height / 2
      }
      const s = mouse.y >= cy ? 1 : -1
      return { dx: 0, dy: distance * s }
    } catch (e) {
      console.warn('computeOffsetVector failed, defaulting to zero', e)
      return { dx: 0, dy: 0 }
    }
  }

  // Update offset ghosts: translate for lines/paths, resize for circles/rects
  function updateOffsetGhosts(mouse, distance) {
    if (!isGhostingOffset || ghostElements.length === 0 || offsetOriginalElements.length === 0) return

    const original = offsetOriginalElements[0]
    const ghost = ghostElements[0]
    if (!original || !ghost) return

    try {
      const type = original.type

      if (type === 'circle') {
        const cx = original.cx()
        const cy = original.cy()
        const r = original.radius ? original.radius() : original.attr('r')
        const dxm = mouse.x - cx
        const dym = mouse.y - cy
        const dist = Math.hypot(dxm, dym)
        const inward = dist < (typeof r === 'number' ? r : parseFloat(r))
        const newR = Math.max(0, (typeof r === 'number' ? r : parseFloat(r)) + (inward ? -distance : distance))
        // Reset transform and set new geometry
        const initial = initialTransforms.get(ghost)
        ghost.transform(initial)
        // Position the ghost circle offset along the radial direction by exactly the distance
        const unit = dist > 0 ? { x: dxm / dist, y: dym / dist } : { x: 0, y: -1 }
        const tx = unit.x * (inward ? -distance : distance)
        const ty = unit.y * (inward ? -distance : distance)
        ghost.center(cx + tx, cy + ty)
        if (ghost.radius) ghost.radius(newR)
        else ghost.attr('r', newR)
        return
      }

      if (type === 'rect') {
        const x = original.x()
        const y = original.y()
        const w = original.width()
        const h = original.height()
        const cx = x + w / 2
        const cy = y + h / 2
        // Determine inside/outside using bounding box
        const inside = mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h
        const delta = inside ? -distance : distance
        // Uniformly grow/shrink on all sides (keep center)
        const newW = Math.max(0, w + 2 * delta)
        const newH = Math.max(0, h + 2 * delta)
        const newX = cx - newW / 2
        const newY = cy - newH / 2
        const initial = initialTransforms.get(ghost)
        ghost.transform(initial)
        ghost.size(newW, newH)
        // Nudge the center toward/away from mouse by exactly distance on dominant axis to make the ghost visibly offset
        const dxm = mouse.x - cx
        const dym = mouse.y - cy
        if (Math.abs(dym) >= Math.abs(dxm)) {
          const ty = dym >= 0 ? distance : -distance
          ghost.move(newX, newY + (inside ? -ty : ty))
        } else {
          const tx = dxm >= 0 ? distance : -distance
          ghost.move(newX + (inside ? -tx : tx), newY)
        }
        return
      }

      // Default behavior: translate perpendicular like before
      const { dx, dy } = computeOffsetVector(original, mouse, distance)
      const initial = initialTransforms.get(ghost)
      ghost.transform(initial).translate(dx, dy)
    } catch (e) {
      // Fallback to translation if anything fails
      const { dx, dy } = computeOffsetVector(original, mouse, distance)
      const initial = initialTransforms.get(ghost)
      ghost.transform(initial).translate(dx, dy)
    }
  }

  function onOffsetGhostingStarted(elements, distance) {
    // Create clone ghosts in overlays and track initial transforms
    isGhostingOffset = true
    offsetOriginalElements = elements || []
    offsetDistance = typeof distance === 'number' ? distance : parseFloat(editor.distance || 0) || 0
    ghostElements = []
    initialTransforms.clear()

    // Immediately position the ghost based on current mouse
    if (coordinates) {
      updateOffsetGhosts(coordinates, offsetDistance)
    }
  }

  function onOffsetGhostingStopped() {
    isGhostingOffset = false
    // Remove ghost clones
    ghostElements.forEach((el) => {
      try {
        el.remove()
      } catch (e) {}
    })
    ghostElements = []
    offsetOriginalElements = []
    offsetDistance = 0
    initialTransforms.clear()
  }

  function zoomToFit(canvas) {
    canvas.animate(300).viewbox(canvas.bbox())
  }

  function drawAxis(svg, size) {
    const axisGroup = svg.group()
    axisGroup.addClass('axis')
    const xAxis = svg.line(-size, 0, size, 0).addClass('axis x-axis').addTo(axisGroup)
    const yAxis = svg.line(0, size, 0, -size).addClass('axis y-axis').addTo(axisGroup)
  }

  function drawGrid(svg, gridSize, spacing) {
    const gridGroup = svg.group()
    gridGroup.addClass('grid')
    for (let i = -gridSize; i <= gridSize; i += spacing) {
      if (i != 0) {
        const horizontalLines = svg
          .line(-gridSize * spacing, i * spacing, gridSize * spacing, i * spacing)
          .addClass('axis')
          .addTo(gridGroup)
        const verticalLines = svg
          .line(i * spacing, -gridSize * spacing, i * spacing, gridSize * spacing)
          .addClass('axis')
          .addTo(gridGroup)
      }
    }
  }
  function handleMove(e) {
    clearSnap()
    if (editor.isSnapping) {
      if (editor.isDrawing || editor.isInteracting) {
        checkSnap({ x: e.pageX, y: e.pageY })
      }
    }
    coordinates = svg.point(e.pageX, e.pageY)
    if (ghostElements.length > 0) {
      if (isGhostingMove) {
        let dx = coordinates.x - basePoint.x
        let dy = coordinates.y - basePoint.y
        if (editor.distance) {
          if (editor.ortho) {
            if (Math.abs(dx) > Math.abs(dy)) {
              ;({ dx, dy } = calculateDeltaFromBasepoint(basePoint, { x: coordinates.x, y: basePoint.y }, editor.distance))
            } else {
              ;({ dx, dy } = calculateDeltaFromBasepoint(basePoint, { x: basePoint.x, y: coordinates.y }, editor.distance))
            }
          } else {
            ;({ dx, dy } = calculateDeltaFromBasepoint(basePoint, coordinates, editor.distance))
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
          el.transform(initial).translate(dx, dy)
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
      if (isGhostingOffset) {
        const mouse = coordinates
        updateOffsetGhosts(mouse, offsetDistance)
      }
    }
    updateCoordinates(coordinates)
    checkHover()
  }
  function updateCoordinates(coordinates) {
    editor.signals.updatedCoordinates.dispatch(coordinates)
  }
  function checkHover() {
    if (!editor.isDrawing) {
      drawing.children().each((el) => {
        let distance
        if (el.type === 'line') {
          let p1 = { x: el.node.x1.baseVal.value, y: el.node.y1.baseVal.value }
          let p2 = { x: el.node.x2.baseVal.value, y: el.node.y2.baseVal.value }
          distance = distanceFromPointToLine(coordinates, p1, p2)
        } else if (el.type === 'circle') {
          distance = distanceFromPointToCircle(
            coordinates,
            { x: el.node.cx.baseVal.value, y: el.node.cy.baseVal.value },
            el.node.r.baseVal.value
          )
        } else if (el.type === 'rect') {
          distance = distancePointToRectangleStroke(coordinates, el.node)
        }
        if (distance < hoverTreshold) {
          if (!(hoveredElements.length > 0)) {
            el.addClass('elementHover')
            hoveredElements = [el]
          }
        } else {
          el.removeClass('elementHover')
          hoveredElements = hoveredElements.filter((item) => item !== el)
        }
      })
    }
  }
  function handleMousedown(e) {
    if (editor.isInteracting) {
      const point = svg.point(e.pageX, e.pageY)
      if (editor.snapPoint) {
        signals.pointCaptured.dispatch(editor.snapPoint)
      } else {
        signals.pointCaptured.dispatch(point)
      }
      return
    }

    if (e.button === 1) {
      // check middle click
      handleMiddleClick()
    } else {
      if (hoveredElements.length > 0) signals.toogledSelect.dispatch(hoveredElements[0])
      else {
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
            findElements(rect, 'intersect')
          } else {
            e.target.classList.remove('selectionRectangleRight')
            findElements(rect, 'inside')
          }
        })
        .on('drawstop', (e) => {
          e.target.remove()
          editor.isDrawing = false
          selectHovered()
        })
    }
  }

  function findElements(rect, selectionMode) {
    drawing.children().each((el) => {
      const bbox = el.bbox()

      let isInsideOrIntersecting = false
      if (selectionMode === 'intersect') {
        // Check if the element's bounding box is completely inside the selection rectangle
        isInsideOrIntersecting =
          bbox.x >= rect.x && bbox.y >= rect.y && bbox.x + bbox.width <= rect.x + rect.width && bbox.y + bbox.height <= rect.y + rect.height
      } else if (selectionMode === 'inside') {
        if (el.type === 'line') {
          const line = {
            x1: el.node.x1.baseVal.value,
            y1: el.node.y1.baseVal.value,
            x2: el.node.x2.baseVal.value,
            y2: el.node.y2.baseVal.value,
          }
          isInsideOrIntersecting = isLineIntersectingRect(line, rect)
        } else if (el.type === 'circle') {
          const circle = { cx: el.node.cx.baseVal.value, cy: el.node.cy.baseVal.value, r: el.node.r.baseVal.value }
          isInsideOrIntersecting = isCircleIntersectingRect(circle, rect)
        } else if (el.type === 'polygon') {
          const polygon = el.array().map((point) => ({ x: point[0], y: point[1] }))
          isInsideOrIntersecting = isPolygonIntersectingRect(polygon, rect)
        } else {
          // Fallback to bounding box for other element types
          isInsideOrIntersecting =
            bbox.x < rect.x + rect.width && bbox.x + bbox.width > rect.x && bbox.y < rect.y + rect.height && bbox.y + bbox.height > rect.y
        }
      }

      if (isInsideOrIntersecting) {
        el.addClass('elementHover')

        // Check if element is already in hoveredElements using direct reference comparison
        if (!hoveredElements.includes(el)) {
          hoveredElements.push(el)
        }
      } else {
        el.removeClass('elementHover')
        hoveredElements = hoveredElements.filter((item) => item !== el)
      }
    })
  }

  function selectHovered() {
    console.log('hovered', hoveredElements)
    hoveredElements.forEach((el) => {
      // Check if element is already selected before adding it
      if (!editor.selected.includes(el)) {
        editor.selected.push(el)
        console.log('Added element to selection:', el.type)
      } else {
        console.log('Element already selected, skipping:', el.type)
      }
    })

    // Only dispatch the signal once after all elements are processed
    if (hoveredElements.length > 0) {
      editor.signals.updatedSelection.dispatch()
    }
  }
  function handleMiddleClick() {
    const currentTime = new Date().getTime()
    const timeDiff = currentTime - lastMiddleClickTime
    if (timeDiff < 300) {
      middleClickCount++
      if (middleClickCount === 2) {
        zoomToFit(svg)
        middleClickCount = 0
      }
    } else {
      middleClickCount = 1
    }
    lastMiddleClickTime = currentTime
  }

  function checkSnap(coordinates) {
    let targets = []
    let snapCandidates = svg.find('.newDrawing')
    if (editor.isDrawing) {
      snapCandidates.pop()
    }
    // console.log('snapCandidates', snapCandidates)
    snapCandidates.forEach((el) => {
      // TO DO: Add other types
      if (el.type === 'line') {
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
        // console.log('distance', distance)
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
}

function drawSnap(point, zoom, svg) {
  const snapSquareScreenSize = 20
  const currentZoom = zoom && zoom ? zoom : 1
  const snapSquareWorldSize = snapSquareScreenSize / currentZoom
  const strokeWorldUnits = 1 / currentZoom
  svg
    .rect(snapSquareWorldSize, snapSquareWorldSize)
    .center(point.x, point.y)
    .fill('none')
    .stroke({ color: 'blue', width: strokeWorldUnits })
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

// Compute perpendicular offset vector for a given element towards mouse by a distance
function computeOffsetVector(originalElement, mouse, distance) {
  try {
    if (!originalElement) return { dx: 0, dy: 0 }

    // svg.js element exposes .type
    const type = originalElement.type || (originalElement.node && originalElement.node.tagName?.toLowerCase()) || ''

    // Helper to normalize vector
    const normalize = (vx, vy) => {
      const len = Math.hypot(vx, vy) || 1
      return { x: vx / len, y: vy / len }
    }

    // Helper to compute sign based on which side of perpendicular mouse is
    const signForPerp = (center, perp) => {
      const toMouseX = mouse.x - center.x
      const toMouseY = mouse.y - center.y
      const proj = toMouseX * perp.x + toMouseY * perp.y
      return proj >= 0 ? 1 : -1
    }

    if (type === 'line') {
      const x1 = originalElement.node.x1.baseVal.value
      const y1 = originalElement.node.y1.baseVal.value
      const x2 = originalElement.node.x2.baseVal.value
      const y2 = originalElement.node.y2.baseVal.value
      const dir = normalize(x2 - x1, y2 - y1)
      // Perpendicular vector (rotate 90deg)
      const perp = { x: -dir.y, y: dir.x }
      const center = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }
      const s = signForPerp(center, perp)
      return { dx: perp.x * distance * s, dy: perp.y * distance * s }
    }

    if (type === 'rect') {
      const x = originalElement.x()
      const y = originalElement.y()
      const w = originalElement.width()
      const h = originalElement.height()
      const center = { x: x + w / 2, y: y + h / 2 }
      // Prefer axis with larger delta to mouse
      const dxm = mouse.x - center.x
      const dym = mouse.y - center.y
      if (Math.abs(dym) >= Math.abs(dxm)) {
        const s = dym >= 0 ? 1 : -1
        return { dx: 0, dy: distance * s }
      } else {
        const s = dxm >= 0 ? 1 : -1
        return { dx: distance * s, dy: 0 }
      }
    }

    if (type === 'circle' || type === 'ellipse') {
      const cx = originalElement.cx()
      const cy = originalElement.cy()
      const dir = normalize(mouse.x - cx, mouse.y - cy)
      const s = 1 // outward by default
      return { dx: dir.x * distance * s, dy: dir.y * distance * s }
    }

    // Default: vertical offset based on mouse.y
    let cx = 0
    let cy = 0
    if (originalElement.bbox) {
      const b = originalElement.bbox()
      cx = b.x + b.width / 2
      cy = b.y + b.height / 2
    }
    const s = mouse.y >= cy ? 1 : -1
    return { dx: 0, dy: distance * s }
  } catch (e) {
    console.warn('computeOffsetVector failed, defaulting to zero', e)
    return { dx: 0, dy: 0 }
  }
}

// Update offset ghosts: translate for lines/paths, resize for circles/rects
function updateOffsetGhosts(mouse, distance) {
  if (!isGhostingOffset || offsetOriginalElements.length === 0) return

  const original = offsetOriginalElements[0]
  let ghost = ghostElements[0]
  if (!original) return

  try {
    const type = original.type

    if (type === 'circle') {
      const obox = original.rbox ? original.rbox(editor.svg) : original.bbox()
      const cx = obox.cx != null ? obox.cx : obox.x + obox.width / 2
      const cy = obox.cy != null ? obox.cy : obox.y + obox.height / 2
      const rWorld = obox.width / 2
      const dxm = mouse.x - cx
      const dym = mouse.y - cy
      const dist = Math.hypot(dxm, dym)
      const inward = dist < rWorld
      const newR = Math.max(0, rWorld + (inward ? -distance : distance))
      // Ensure we have a circle ghost element to draw into
      if (!ghost || ghost.type !== 'circle') {
        if (ghost) {
          try {
            ghost.remove()
          } catch (e) {}
        }
        ghost = editor.overlays.circle()
        ghost.addClass('elementSelected')
        ghost.addClass('offset-ghost')
        ghost.attr({ 'pointer-events': 'none', fill: 'none' })
        ghostElements[0] = ghost
      }
      // Reset any transform completely and set new geometry; keep center fixed
      ghost.attr('transform', null)
      ghost.attr({ cx: cx, cy: cy, r: newR })
      return
    }

    if (type === 'rect') {
      const obox = original.rbox ? original.rbox(editor.svg) : original.bbox()
      const x = obox.x
      const y = obox.y
      const w = obox.width
      const h = obox.height
      const cx = x + w / 2
      const cy = y + h / 2
      // Determine inside/outside using world-space bbox
      const inside = mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h
      const delta = inside ? -distance : distance
      // Uniformly grow/shrink on all sides (keep center)
      const newW = Math.max(0, w + 2 * delta)
      const newH = Math.max(0, h + 2 * delta)
      const newX = cx - newW / 2
      const newY = cy - newH / 2
      // Ensure we have a rect ghost element to draw into
      if (!ghost || ghost.type !== 'rect') {
        if (ghost) {
          try {
            ghost.remove()
          } catch (e) {}
        }
        ghost = editor.overlays.rect()
        ghost.addClass('elementSelected')
        ghost.addClass('offset-ghost')
        ghost.attr({ 'pointer-events': 'none', fill: 'none' })
        ghostElements[0] = ghost
      }
      // Reset any transform completely and set new geometry
      ghost.attr('transform', null)
      ghost.attr({ x: newX, y: newY, width: newW, height: newH })
      return
    }

    // Default behavior: translate perpendicular like before
    const { dx, dy } = computeOffsetVector(original, mouse, distance)
    if (!ghost) {
      // Create clone once for linear-like elements
      const clone = original.clone()
      if (clone.putIn) clone.putIn(editor.overlays)
      clone.attr({ 'pointer-events': 'none' })
      clone.addClass('elementSelected')
      clone.addClass('offset-ghost')
      ghost = clone
      ghostElements[0] = ghost
      initialTransforms.set(ghost, ghost.transform())
    }
    const initial = initialTransforms.get(ghost)
    ghost.transform(initial).translate(dx, dy)
  } catch (e) {
    // Fallback to translation if anything fails
    const { dx, dy } = computeOffsetVector(original, mouse, distance)
    const initial = initialTransforms.get(ghost)
    ghost.transform(initial).translate(dx, dy)
  }
}

window.handleToogleOverlay = handleToogleOverlay
window.handleToogleOrtho = handleToogleOrtho
window.handleToogleSnap = handleToogleSnap
window.menuOverlay = menuOverlay
export { Viewport }
