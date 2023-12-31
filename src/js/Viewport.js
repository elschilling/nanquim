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

  signals.clearSelection.add(() => {
    clearSelection(svg)
  })
  document.addEventListener('contextmenu', handleRightClick)
  let canvas = document.getElementById('canvas')
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

  function zoomToFit(canvas) {
    const bbox = canvas.bbox()
    // canvas.rect(bbox.width, bbox.height).stroke({ color: 'yellow', width: 0.2 }).fill({ opacity: 0.4 }).move(bbox.x, bbox.y)
    // console.log('bbox', bbox)
    canvas.animate(300).viewbox(bbox)
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
      svg.off('click')
      console.log('isDrawing', editor.isDrawing)
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
            el.addClass('elementHover')
            // el.selectize({ deepSelect: true })
            // canvas.addEventListener('click', (e) => handleClick(e, el))
            svg.off('click').click((e) => handleClick(e, el))
            // el.on('click', () => console.log('handle line click'))
          } else {
            el.removeClass('elementHover')

            // el.selectize(false, { deepSelect: true })
            // console.log('el.attr', el.attr)
          }
        }
        function handleClick(e, el) {
          svg.off('click')
          e.stopImmediatePropagation()
          console.log('e', e)
          console.log('el', el)
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
      })
    }
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
