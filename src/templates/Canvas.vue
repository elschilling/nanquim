<template lang="pug">
.canvas-editor
  .editor-header
    .wgt.wgt-menu
        span.icon.icon-canvas
        .icon.icon-dropdown
  .layout-editor
    canvas(ref='canvas' @click='handleClick' @contextmenu.prevent='stopDrawing' @mousedown="onPointerDown" @mousemove="onPointerMove" @mouseup="onPointerUp" @wheel="(e) => adjustZoom(e.deltaY*SCROLL_SENSITIVITY)")
    Terminal(@inputAsk='capturePoint' @stopDrawing='stopDrawing' :coords='coordinates' :ctx='getCanvasContext')
</template>

<script setup>
// PAN and ZOOM lifesave https://codepen.io/chengarda/pen/wRxoyB
import { ref, onMounted, reactive } from 'vue'
import { useEventBus, useMouse, useParentElement } from '@vueuse/core'
import Terminal from './Terminal.vue'
import { drawLine } from '../utils/drawLine'
import { store } from '../store'

// Local events
const emit = defineEmits(['coordsUpdated'])

// Global events
const newCoords = useEventBus('newCoords')
const newPoint = useEventBus('newPoint')
const startDrawing = useEventBus('startDrawing')
const newDrawing = useEventBus('newDrawgin')
let unsubNewDrawing

let unsubStartDrawing
const canvas = ref(null)
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
  context = getCanvasContext()
  draw()
})

function getCanvasContext() {
  return canvas.value?.getContext('2d')
}

let cameraZoom = 1
let GRID_SIZE = 100
let MAX_ZOOM = 5
let MIN_ZOOM = 0.1
let SCROLL_SENSITIVITY = 0.0005
let activeDrawing
let isCapturingInput = false

function resize() {
  canvas.value.height = canvas.value.clientHeight
  canvas.value.width = canvas.value.clientWidth
}

function cameraTranslate() {
  context.translate(canvas.value.width / 2, canvas.value.height / 2)
  context.scale(cameraZoom, -cameraZoom)
  context.translate(cameraOffset.x, -cameraOffset.y)
  // clearCanvas(canvas, context)
}

function draw() {
  resize()
  cameraTranslate()
  drawAxis()
  context.lineWidth = 0.5
  drawGrid()
  context.beginPath()
  context.arc(0, 0, 40, 0, 2 * Math.PI)
  context.stroke()
  context.strokeStyle = 'white'
  context.lineWidth = 1
  if (store.isDrawing) {
    if (activeDrawing) {
      // clearCanvas(canvas, context)
      activeDrawing()
    }
  }
  drawings.forEach((drawingCommand) => drawingCommand())

  requestAnimationFrame(draw)
}

function stopDrawing() {
  clearCanvas(canvas, context)
  store.isDrawing = false
  isCapturingInput = false
  activeDrawing = 0
  unsubNewDrawing()
}

function clearCanvas(canvas, context) {
  context.clearRect(-canvas.value.width / 2, -canvas.value.height / 2, canvas.value.width / 2, canvas.value.height / 2)
}

function drawText(text, x, y, size, font) {
  context.font = `${size}px ${font}`
  context.fillText(text, x, y)
}

function drawAxis() {
  context.lineWidth = 4
  // x axis
  context.strokeStyle = '#597631'
  drawLine(
    getCanvasContext,
    -canvas.value.width / 2 / cameraZoom - cameraOffset.x,
    0,
    canvas.value.width / 2 / cameraZoom - cameraOffset.x,
    0
  )
  // y axis
  context.strokeStyle = '#843d47'
  drawLine(
    getCanvasContext,
    0,
    -canvas.value.height / 2 / cameraZoom + cameraOffset.y,
    0,
    canvas.value.height / 2 / cameraZoom + cameraOffset.y
  )
}

function drawGrid() {
  // let steps = Math.ceil(canvas.value.width / GRID_SIZE / cameraZoom)
  let steps = 11
  context.strokeStyle = '#4f4f4f'
  for (let i = -steps; i < steps; i++) {
    if (i != 0) {
      drawLine(getCanvasContext, -steps * GRID_SIZE, i * GRID_SIZE, (steps - 1) * GRID_SIZE, i * GRID_SIZE)
      drawLine(getCanvasContext, i * GRID_SIZE, -steps * GRID_SIZE, i * GRID_SIZE, (steps - 1) * GRID_SIZE)
    }
  }
}

let isDragging = false
let dragStart = { x: 0, y: 0 }

// Gets the relevant location from a mouse or single touch event
function getEventLocation(e) {
  if (e.touches && e.touches.length == 1) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY }
  } else if (e.clientX && e.clientY) {
    return { x: e.clientX, y: e.clientY }
  }
}

function updateCoordinates() {
  const coords = {
    x: Math.round(-(canvas.value.width / 2 - mouse.x.value) / cameraZoom - cameraOffset.x),
    y: Math.round((canvas.value.height / 2 - mouse.y.value) / cameraZoom + cameraOffset.y),
  }
  coordinates.value = coords
  emit('coordsUpdated', coords)
  newCoords.emit(coords)
}

function onPointerDown(e) {
  isDragging = true
  dragStart.x = getEventLocation(e).x / cameraZoom - cameraOffset.x
  dragStart.y = getEventLocation(e).y / cameraZoom - cameraOffset.y
}

function onPointerUp(e) {
  isDragging = false
  initialPinchDistance = null
  lastZoom = cameraZoom
}

function onPointerMove(e) {
  updateCoordinates()
  if (isDragging) {
    cameraOffset.x = getEventLocation(e).x / cameraZoom - dragStart.x
    cameraOffset.y = getEventLocation(e).y / cameraZoom - dragStart.y
  }
}

function handleTouch(e, singleTouchHandler) {
  if (e.touches.length == 1) {
    singleTouchHandler(e)
  } else if (e.type == 'touchmove' && e.touches.length == 2) {
    isDragging = false
    handlePinch(e)
  }
}

let initialPinchDistance = null
let lastZoom = cameraZoom

function handlePinch(e) {
  e.preventDefault()

  let touch1 = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  let touch2 = { x: e.touches[1].clientX, y: e.touches[1].clientY }

  // This is distance squared, but no need for an expensive sqrt as it's only used in ratio
  let currentDistance = (touch1.x - touch2.x) ** 2 + (touch1.y - touch2.y) ** 2

  if (initialPinchDistance == null) {
    initialPinchDistance = currentDistance
  } else {
    adjustZoom(null, currentDistance / initialPinchDistance)
  }
}

function adjustZoom(zoomAmount, zoomFactor) {
  if (!isDragging) {
    if (zoomAmount) {
      cameraZoom -= zoomAmount
    } else if (zoomFactor) {
      cameraZoom = zoomFactor * lastZoom
    }

    cameraZoom = Math.min(cameraZoom, MAX_ZOOM)
    cameraZoom = Math.max(cameraZoom, MIN_ZOOM)
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
.canvas-editor
  display: flex
  flex-direction: column
  width: 100%
  height: 100%
  border-radius: 20px
  background: var(--node-editor-bg)
.editor-header
  border-top-left-radius: 20px
  border-top-right-radius: 20px
.layout-editor
  position: relative
  box-sizing: border-box
  width: 100%
  height: 100%
canvas
  position: absolute
  box-sizing: border-box
  // background: --canvas-bg
  overflow: hidden
  min-width: 600px
  width: 100%
  height: 100%
  object-fit: contain
</style>
<!-- box-sizing: border-box
background-color: var(--node-editor-bg)
position: relative
display: flex
flex-flow: column
flex-grow: 1 -->
