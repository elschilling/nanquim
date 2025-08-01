import {
  calculateDistance,
  distanceFromPointToLine,
  distanceFromPointToCircle,
  distancePointToRectangleStroke,
} from '../utils/calculateDistance'
import { isLineIntersectingRect, isCircleIntersectingRect } from '../utils/intersection'

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
    if (editor.isDrawing) {
      checkSnap({ x: e.pageX, y: e.pageY })
    }
    coordinates = svg.point(e.pageX, e.pageY)
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
    if (e.button === 1) {
      // check middle click
      handleMiddleClick()
    } else {
      if (hoveredElements.length > 0) signals.toogledSelect.dispatch(hoveredElements[0])
      else handleRectSelection(e)
    }
  }
  function handleRectSelection(e) {
    e.preventDefault()
    e.stopImmediatePropagation()
    if (!editor.isDrawing) {
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
          if (!(rect.x + rect.width >= coordinates.x)) {
            e.srcElement.classList.add('selectionRectangleRight')
            findElements(svg, rect, 'intersect')
          } else {
            e.target.classList.remove('selectionRectangleRight')
            findElements(svg, rect, 'inside')
          }
        })
        .on('drawstop', (e) => {
          e.target.remove()
          editor.isDrawing = false
          selectHovered()
        })
    }
  }
  function findElements(svg, rect, selectionMode) {
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
        } else {
          // Fallback to bounding box for other element types
          isInsideOrIntersecting =
            bbox.x < rect.x + rect.width && bbox.x + bbox.width > rect.x && bbox.y < rect.y + rect.height && bbox.y + bbox.height > rect.y
        }
      }

      if (isInsideOrIntersecting) {
        el.addClass('elementHover')
        if (!hoveredElements.map((item) => item.node.id).includes(el.node.id)) {
          hoveredElements.push(el)
        }
      } else {
        el.removeClass('elementHover')
        hoveredElements = hoveredElements.filter((item) => item !== el)
      }
    })
  }

  function selectHovered() {
    hoveredElements.forEach((el) => {
      editor.selected.push(el)
      editor.signals.updatedSelection.dispatch()
      // el.selectize({ deepSelect: true })
      // el.attr('selected', true)
      // el.addClass('elementSelected')
    })
  }
  function toogleSelect(el) {
    if (el.attr('selected') === 'true') {
      el.selectize(false, { deepSelect: true })
      el.attr('selected', false)
      el.removeClass('elementSelected')
    } else {
      el.selectize({ deepSelect: true })
      el.attr('selected', true)
      el.addClass('elementSelected')
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
    snapCandidates.pop()
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

window.handleToogleOverlay = handleToogleOverlay
window.handleToogleOrtho = handleToogleOrtho
window.menuOverlay = menuOverlay
export { Viewport }
