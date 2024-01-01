import { distanceFromPointToLine, distanceFromPointToCircle, distancePointToRectangleStroke } from '../utils/calculateDistance'

function Viewport(editor) {
  const signals = editor.signals
  const svg = editor.svg

  let hoverTreshold = 0.5
  let hoveredElements = []
  let isSelecting = false
  let zoomFactor = 0.1
  let coordinates = { x: 0, y: 0 }
  let GRID_SIZE = 20
  let GRID_SPACING = 1
  let lastMiddleClickTime = 0
  let middleClickCount = 0
  let isCapturingInput = false

  signals.clearSelection.add(() => {
    clearSelection(svg)
  })
  document.addEventListener('contextmenu', handleRightClick)
  let canvas = document.getElementById('canvas')
  // svg.addClass('canvas').panZoom({ zoomFactor, panButton: 1 }).mousemove(handleMove).mousedown(handleClick).click(handleRectSelection)
  svg
    .addClass('canvas')
    .mousemove(handleMove)
    .mousedown(handleMousedown)
    // .mouseup(handleClick)
    // .click(handleClick)
    .panZoom({ zoomFactor, panButton: 1 })
  drawGrid(svg, GRID_SIZE, GRID_SPACING)
  drawAxis(svg, GRID_SIZE)
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
    updateCoordinates(e)
    checkHover()
  }
  function updateCoordinates(e) {
    coordinates = svg.point(e.pageX, e.pageY)
    // TODO GRID SNAP TO AVOID THIS
    coordinates.x = coordinates.x
    coordinates.y = coordinates.y
    editor.signals.updatedCoordinates.dispatch(coordinates)
  }
  function checkHover() {
    if (!editor.isDrawing) {
      svg.children().each((el) => {
        if (!el.hasClass('grid') && !el.hasClass('axis')) {
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
        }
      })
    }
  }
  function handleMousedown(e) {
    if (e.button === 1) {
      // check middle click
      handleMiddleClick()
    } else {
      if (hoveredElements.length > 0) toogleSelect(hoveredElements[0])
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
          if (!(rect.x + rect.width >= coordinates.x)) e.srcElement.classList.add('selectionRectangleRight')
          else {
            e.target.classList.remove('selectionRectangleRight')
            findElementsWithinRect(svg, rect)
          }
        })
        .on('drawstop', (e) => {
          e.target.remove()
          editor.isDrawing = false
          selectHovered()
        })
    }
  }
  function findElementsWithinRect(svg, rect) {
    svg.children().each((el) => {
      if (!el.hasClass('grid') && !el.hasClass('axis') && !el.hasClass('selectionRectangle')) {
        const bbox = el.bbox()

        // Check if the element's bounding box intersects or is contained within the selection rectangle
        const intersects =
          bbox.x < rect.x + rect.width && bbox.x + bbox.width > rect.x && bbox.y < rect.y + rect.height && bbox.y + bbox.height > rect.y
        if (intersects) {
          el.addClass('elementHover')
          if (!hoveredElements.map((item) => item.node.id).includes(el.node.id)) {
            hoveredElements.push(el)
          }
        } else {
          el.removeClass('elementHover')
          hoveredElements = hoveredElements.filter((item) => item !== el)
        }
      }
    })
  }

  function selectHovered() {
    hoveredElements.forEach((el) => {
      el.selectize({ deepSelect: true })
      el.attr('selected', true)
      el.addClass('elementSelected')
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

export { Viewport }
