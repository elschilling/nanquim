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
  })

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
          // Case 7: Left Edge
          else if (index === 7) {
            setRectFromPoints(point.x, original.y, original.x + original.width, original.y + original.height)
          }
        }
      })

      // Redraw handlers to follow the vertex
      signals.updatedSelection.dispatch()
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
        } else if (el.type === 'path') {
          const pathLength = el.length()
          if (pathLength === 0) {
            distance = Infinity
          } else {
            let minDistance = Infinity
            const step = Math.max(1, pathLength / 20) // Sample at least 20 points
            for (let i = 0; i <= pathLength; i += step) {
              const p = el.pointAt(i)
              const d = calculateDistance(coordinates, p)
              if (d < minDistance) {
                minDistance = d
              }
            }
            distance = minDistance
          }
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
    // Handle vertex editing commit
    if (editor.isEditingVertex) {
      let point = editor.snapPoint || svg.point(e.pageX, e.pageY)

      if (editor.ortho && editor.editingVertices.length > 0) {
        point = getOrthoConstrainedPoint(point, editor.editingVertices[0])
      }

      // Separate line updates and circle updates
      const lineUpdates = []
      const circleUpdates = []

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

      return
    }

    if (editor.isInteracting) {
      const point = svg.point(e.pageX, e.pageY)
      if (editor.snapPoint) {
        signals.pointCaptured.dispatch(editor.snapPoint)
      } else {
        signals.pointCaptured.dispatch(point)
      }
      if (editor.selectSingleElement) {
        if (hoveredElements.length > 0) {
          editor.lastClick = point
          signals.toogledSelect.dispatch(hoveredElements[0])
        }
      }
      return
    }

    if (e.button === 1) {
      // check middle click
      handleMiddleClick()
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
    drawing.children().each((el) => {
      const bbox = el.bbox()

      let isInsideOrIntersecting = false
      if (selectionMode === 'intersect') {
        if (el.type === 'path') {
          const pathLength = el.length()
          if (pathLength > 0) {
            isInsideOrIntersecting = true // Assume it is, until proven otherwise
            const step = Math.max(1, pathLength / 20)
            for (let i = 0; i <= pathLength; i += step) {
              const p = el.pointAt(i)
              if (!(p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height)) {
                isInsideOrIntersecting = false
                break
              }
            }
          } else {
            isInsideOrIntersecting = false
          }
        } else {
          // Check if the element's bounding box is completely inside the selection rectangle
          isInsideOrIntersecting =
            bbox.x >= rect.x &&
            bbox.y >= rect.y &&
            bbox.x + bbox.width <= rect.x + rect.width &&
            bbox.y + bbox.height <= rect.y + rect.height
        }
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
        } else if (el.type === 'path') {
          const pathLength = el.length()
          if (pathLength > 0) {
            const polyline = []
            const step = Math.max(1, pathLength / 20) // Sample at least 20 points
            for (let i = 0; i <= pathLength; i += step) {
              polyline.push(el.pointAt(i))
            }
            // Check if any segment of the polyline intersects the rect
            for (let i = 0; i < polyline.length - 1; i++) {
              const line = { x1: polyline[i].x, y1: polyline[i].y, x2: polyline[i + 1].x, y2: polyline[i + 1].y }
              if (isLineIntersectingRect(line, rect)) {
                isInsideOrIntersecting = true
                break
              }
            }
            // If no intersection, check if the path is completely inside
            if (!isInsideOrIntersecting) {
              const p = el.pointAt(0)
              if (p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height) {
                isInsideOrIntersecting = true
              }
            }
          }
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
    if (editor.isEditingVertex && editor.editingVertices.length > 0) {
      const editingNodes = editor.editingVertices.map(v => v.element.node)
      snapCandidates = snapCandidates.filter(el => !editingNodes.includes(el.node))
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
export { Viewport }
