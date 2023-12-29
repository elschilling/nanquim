<template lang="pug">
.editor.canvas-editor
  .editor-header
    .wgt.wgt-menu
        span.icon.icon-editor-svgcad
        .icon.icon-dropdown
  .layout-editor
    //- canvas(ref='canvas' @click='handleClick' @contextmenu.prevent='stopDrawing' @mousedown="onPointerDown" @mousemove="onPointerMove" @mouseup="onPointerUp" @wheel="(e) => adjustZoom(e.deltaY*SCROLL_SENSITIVITY)")
    svg(id='canvas' viewBox="-50 -50 100 100" ref='svg' stroke='red' stroke-width='.1'
    @click='handleClick'
    @contextmenu.prevent='stopDrawing'
    @mousedown="onPointerDown"
    @mousemove="onPointerMove"
    @mouseup="onPointerUp"
    @wheel.prevent="adjustZoom")
      //- circle(cx='0' cy='0' r='5')
      //- circle(cx='0' cy='0' r='4')
      //- circle(cx='0' cy='0' r='3')
      //- circle(cx='0' cy='0' r='2')
      //- circle(cx='0' cy='0' r='1')
      line(x1="0" y1="-50" x2="0" y2="50" class='axis y-axis')
      line(x1="-50" y1="0" x2="50" y2="0" class='axis x-axis')
    Terminal(@inputAsk='capturePoint' @stopDrawing='stopDrawing' :coords='coordinates')
</template>

<script setup>
// PAN and ZOOM lifesave https://codepen.io/chengarda/pen/wRxoyB
import { ref, onMounted, reactive } from 'vue'
import { useEventBus, useMouse, useParentElement } from '@vueuse/core'
import Terminal from './Terminal.vue'
import { store } from '../store'
// import { SVG } from '@svgdotjs/svg.js'
// let draw = SVG().addTo('#canvas')
// console.log('draw', draw)
const svg = ref(null)
let isDragging = false
let dragStart = { x: 0, y: 0 }
let viewBox
let point
var startClient
let startGlobal
let coordGlobal
let zoomScaleFactor = 1.1

// Local events
const emit = defineEmits(['coordsUpdated'])

// Global events
const newCoords = useEventBus('newCoords')
const newPoint = useEventBus('newPoint')
const startDrawing = useEventBus('startDrawing')
const newDrawing = useEventBus('newDrawgin')
let unsubNewDrawing

let unsubStartDrawing
const coordinates = ref({ x: 0, y: 0 })
let drawings = []
let context = reactive({})
let cameraOffset = { x: 0, y: 0 }

const parentEl = useParentElement()
const extractor = (event) => {
  if (typeof Touch !== 'undefined' && event instanceof Touch) {
    return null
  } else {
    return [event.offsetX, event.offsetY]
  }
}
const { x, y, sourceType } = useMouse({ target: parentEl, type: extractor })
const mouse = { x: x, y: y }

unsubStartDrawing = startDrawing.on((drawCommand) => {
  if (unsubNewDrawing) unsubNewDrawing()
  store.isDrawing = true
  drawCommand()
  unsubNewDrawing = newDrawing.on((drawingCommand, drawingMode) => {
    if (drawingMode) {
      activeDrawing = drawingCommand
    } else {
      drawings.push(drawingCommand)
      activeDrawing = null
    }
  })
})

onMounted(() => {
  drawGrid(10, spacing)
  viewBox = svg.value.viewBox.baseVal
  console.log('viewBox', viewBox)
  startClient = svg.value.createSVGPoint()
  startGlobal = svg.value.createSVGPoint()
  coordGlobal = svg.value.createSVGPoint()
  point = svg.value.createSVGPoint()
  // context = getCanvasContext()
  // draw()
})

// function getCanvasContext() {
//   return canvas.value?.getContext('2d')
// }

let spacing = 2
let MAX_ZOOM = 5
let MIN_ZOOM = 0.1
let SCROLL_SENSITIVITY = 0.01
let activeDrawing
let isCapturingInput = false

// function resize() {
//   canvas.value.height = canvas.value.clientHeight - 4 // magic number!!!
//   canvas.value.width = canvas.value.clientWidth
// }

// function cameraTranslate() {
//   context.translate(canvas.value.width / 2, canvas.value.height / 2)
//   context.scale(cameraZoom, -cameraZoom)
//   context.translate(cameraOffset.x, -cameraOffset.y)
//   clearCanvas(canvas, context)
// }

// function draw() {
//   resize()
//   cameraTranslate()
//   context.strokeStyle = 'white'
//   context.lineWidth = 1
//   if (store.isDrawing) {
//     if (activeDrawing) {
//       clearCanvas(canvas, context)
//       activeDrawing()
//     }
//   }
//   drawings.forEach((drawingCommand) => drawingCommand())
//   drawAxis()
//   context.lineWidth = 0.5
//   drawGrid()

//   // insert new elements here

//   // drawLine(context, -100, 0, 100, 0)
//   // drawLine(context, 0, -100, 0, 100)
//   // drawLine(context, -100, -100, 100, 100)
//   // drawLine(context, 0, -100, 100, 0)
//   // drawRect(context, 10, 10, 100, 100)
//   context.beginPath()
//   context.arc(0, 0, 40, 0, 2 * Math.PI)
//   context.stroke()

//   requestAnimationFrame(draw)
// }

function stopDrawing() {
  //   clearCanvas(canvas, context)
  //   store.isDrawing = false
  //   isCapturingInput = false
  //   activeDrawing = 0
  //   unsubNewDrawing()
}

function drawGrid(gridSize, spacing) {
  const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  gridGroup.setAttribute('stroke', '#4f4f4f')
  gridGroup.setAttribute('stroke-width', '.1')
  gridGroup.setAttribute('vector-effect', 'non-scaling-stroke')
  gridGroup.setAttribute('class', 'grid')

  for (let x = -gridSize; x <= gridSize; x += spacing) {
    if (x != 0) {
      const verticalLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      verticalLine.setAttribute('x1', -gridSize * spacing)
      verticalLine.setAttribute('y1', x * spacing)
      verticalLine.setAttribute('x2', gridSize * spacing)
      verticalLine.setAttribute('y2', x * spacing)
      // verticalLine.setAttribute('class', 'grid')
      gridGroup.appendChild(verticalLine)
      const horizontalLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      horizontalLine.setAttribute('x1', x * spacing)
      horizontalLine.setAttribute('y1', -gridSize * spacing)
      horizontalLine.setAttribute('x2', x * spacing)
      horizontalLine.setAttribute('y2', gridSize * spacing)
      gridGroup.appendChild(horizontalLine)
    }
  }

  svg.value.appendChild(gridGroup)
}

// function drawGrid(svg) {
//   // let steps = Math.ceil(canvas.value.width / GRID_SIZE / cameraZoom)
//   const gridGroup = svg.group().attr({ class: 'grid' })
//   let steps = 11
//   context.strokeStyle = '#4f4f4f'
//   for (let i = -steps; i < steps; i++) {
//     if (i != 0) {
//       const verticalLine = svg.line(-steps * GRID_SIZE, i * GRID_SIZE, (steps - 1) * GRID_SIZE, i * GRID_SIZE).addTo(gridGroup)
//       // drawLine(getCanvasContext, -steps * GRID_SIZE, i * GRID_SIZE, (steps - 1) * GRID_SIZE, i * GRID_SIZE)
//       // drawLine(getCanvasContext, i * GRID_SIZE, -steps * GRID_SIZE, i * GRID_SIZE, (steps - 1) * GRID_SIZE)
//     }
//   }
// }

function updateCoordinates() {
  coordGlobal.x = mouse.x.value
  coordGlobal.y = mouse.y.value
  coordGlobal = coordGlobal.matrixTransform(svg.value.getScreenCTM().inverse())
  coordinates.value = coordGlobal
  emit('coordsUpdated', coordGlobal)
  newCoords.emit(coordGlobal)
}

function onPointerDown(e) {
  isDragging = true
  startClient.x = e.x
  startClient.y = e.y
  startGlobal = startClient.matrixTransform(svg.value.getScreenCTM().inverse())
}

function onPointerMove(e) {
  updateCoordinates()
  if (isDragging) {
    updateViewBox(e)
  }
}

function onPointerUp(e) {
  isDragging = false
}

function updateViewBox(e) {
  point.x = e.x
  point.y = e.y

  var moveGlobal = point.matrixTransform(svg.value.getScreenCTM().inverse())

  viewBox.x -= moveGlobal.x - startGlobal.x
  viewBox.y -= moveGlobal.y - startGlobal.y
}

function adjustZoom(e) {
  if (!isDragging) {
    var normalized
    var delta = e.wheelDelta
    if (delta) {
      normalized = delta % 120 == 0 ? delta / 120 : delta / 12
    } else {
      delta = e.deltaY || e.detail || 0
      normalized = -(delta % 3 ? delta * 10 : delta / 3)
    }
    var scaleDelta = normalized > 0 ? 1 / zoomScaleFactor : zoomScaleFactor
    point.x = e.clientX
    point.y = e.clientY
    var startPoint = point.matrixTransform(svg.value.getScreenCTM().inverse())
    viewBox.x -= (startPoint.x - viewBox.x) * (scaleDelta - 1)
    viewBox.y -= (startPoint.y - viewBox.y) * (scaleDelta - 1)
    viewBox.width *= scaleDelta
    viewBox.height *= scaleDelta
  }
}

function capturePoint() {
  isCapturingInput = true
}

async function handleClick(e) {
  if (isCapturingInput) {
    isCapturingInput = false
    newPoint.emit(coordinates)
  }
}
</script>

<style lang="sass" scoped>
.editor-header
  border-top-left-radius: 20px
  border-top-right-radius: 20px
.canvas-editor
  cursor: crosshair
  border-radius: 20px
  box-sizing: border-box
  background-color: var(--node-editor-bg)
  position: relative
  display: flex
  flex-flow: column
  flex-grow: 1
.layout-editor
  box-sizing: border-box
  width: 100%
  height: 100%
  display: block
svg
  position: absolute
  box-sizing: border-box
  background: var(--canvas-bg)
  overflow: hidden
  min-width: 600px
  width: 100%
  height: 100%

.axis
  vector-effect: non-scaling-stroke
  stroke-width: 2
.x-axis
  stroke: #597631
.y-axis
  stroke: #843d47
.grid
  stroke-width: 2
  stroke: blue
  // vector-effect: non-scaling-stroke
</style>
