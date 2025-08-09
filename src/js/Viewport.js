import {
  calculateDistance,
  distanceFromPointToLine,
  distanceFromPointToCircle,
  distancePointToRectangleStroke,
  calculateDeltaFromBasepoint,
} from './utils/calculateDistance'
import { isLineIntersectingRect, isCircleIntersectingRect, isPolygonIntersectingRect } from './utils/intersection'
import { applyOffsetToElement, computeOffsetVector } from './utils/offsetCalc'

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
  let offsetGhostClone = null
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

  function onOffsetGhostingStarted(element, distance) {
    // Create clone ghosts in overlays and track initial transforms
    console.log('ghost started. ghost element:', element)
    initialTransforms.set(element, element[0].transform())
    console.log('initial transforms', initialTransforms)
    ghostElements = element[0]
    isGhostingOffset = true
  }

  function onOffsetGhostingStopped() {
    isGhostingOffset = false
    if (offsetGhostClone) offsetGhostClone.remove()
    // Remove ghost clones
    // ghostElements.remove()
    ghostElements = []
    offsetGhostClone = null
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
    }
    if (isGhostingOffset) {
      updateOffsetGhosts(coordinates)
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

  // Update offset ghosts: translate for lines/paths, resize for circles/rects
  function updateOffsetGhosts(point) {
    if (ghostElements) {
      if (!offsetGhostClone) {
        offsetGhostClone = ghostElements.clone()
        offsetGhostClone.putIn(editor.drawing)
      }
      offsetGhostClone.transform({})
      // For circles/rects, resize instead of translate
      if (ghostElements.type === 'circle') {
        const cx = ghostElements.cx()
        const cy = ghostElements.cy()
        const r = ghostElements.radius ? ghostElements.radius() : ghostElements.attr('r')
        const dx = point.x - cx
        const dy = point.y - cy
        const dist = Math.hypot(dx, dy)
        const inward = dist < (typeof r === 'number' ? r : parseFloat(r))
        const newR = Math.max(0, (typeof r === 'number' ? r : parseFloat(r)) + (inward ? -editor.distance : editor.distance))
        offsetGhostClone.center(cx, cy)
        if (offsetGhostClone.radius) offsetGhostClone.radius(newR)
        else offsetGhostClone.attr('r', newR)
      } else if (ghostElements.type === 'rect') {
        const x = ghostElements.x()
        const y = ghostElements.y()
        const w = ghostElements.width()
        const h = ghostElements.height()
        const cx = x + w / 2
        const cy = y + h / 2
        const inside = point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h
        const delta = inside ? -editor.distance : editor.distance
        const newW = Math.max(0, w + 2 * delta)
        const newH = Math.max(0, h + 2 * delta)
        const newX = cx - newW / 2
        const newY = cy - newH / 2
        offsetGhostClone.size(newW, newH)
        offsetGhostClone.move(newX, newY)
      } else {
        // Compute offset direction relative to the selected element and click position
        const { dx, dy } = computeOffsetVector(ghostElements, point, editor.distance)
        console.log('dx, dy', dx, dy)
        try {
          applyOffsetToElement(clone, dx, dy)
        } catch (e) {
          const t = offsetGhostClone.transform ? offsetGhostClone.transform() : {}
          if (offsetGhostClone.transform) offsetGhostClone.transform(t).translate(dx, dy)
        }
      }
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

window.handleToogleOverlay = handleToogleOverlay
window.handleToogleOrtho = handleToogleOrtho
window.handleToogleSnap = handleToogleSnap
window.menuOverlay = menuOverlay
export { Viewport }
