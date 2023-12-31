import { distanceFromPointToLine, distanceFromPointToCircle, distancePointToRectangleStroke } from '../utils/calculateDistance'

function Viewport(editor) {
  function update(isDrawing) {
    console.log('isDrawing', isDrawing)
  }
  const signals = editor.signals
  const svg = editor.svg

  let hoverTreshold = 0.5
  let zoomFactor = 0.1
  let coordinates = { x: 0, y: 0 }
  let GRID_SIZE = 20
  let GRID_SPACING = 1
  let lastMiddleClickTime = 0
  let middleClickCount = 0
  let isCapturingInput = false

  signals.inputAsked.add(() => {
    isCapturingInput = true
  })
  document.addEventListener('contextmenu', handleRightClick)

  svg.addClass('canvas').panZoom({ zoomFactor, panButton: 1 }).mousemove(handleMove).mousedown(handleClick)
  drawGrid(svg, GRID_SIZE, GRID_SPACING)
  drawAxis(svg, GRID_SIZE)
  svg.animate(300).viewbox(svg.bbox())
  // svg.line(5, -5, 10, 10).stroke({ color: 'white', width: 0.1 })
  // svg.circle(5).stroke({ color: 'white', width: 0.1 }).move(-2.5, -2.5)

  function handleClick(e) {
    if (e.button === 1) {
      const currentTime = new Date().getTime()
      const timeDiff = currentTime - lastMiddleClickTime
      if (timeDiff < 300) {
        middleClickCount++
        if (middleClickCount === 2) {
          console.log('double midle click detected!!!')
          zoomToFit(svg, 1)
          middleClickCount = 0
        }
      } else {
        middleClickCount = 1
      }
      lastMiddleClickTime = currentTime
    }
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
    coordinates.x = Math.round(coordinates.x)
    coordinates.y = Math.round(coordinates.y)
    editor.signals.updatedCoordinates.dispatch(coordinates)
  }
  function checkHover() {
    if (!editor.isDrawing) {
      svg.children().each((el) => {
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
          el.addClass('elementHover')
        } else {
          el.removeClass('elementHover')
        }
      })
    }
  }
}

function handleRightClick(e) {
  e.preventDefault()
  editor.svg.fire('cancelDrawing', e)
}

export { Viewport }
