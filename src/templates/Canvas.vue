<template lang="pug">
.editor.canvas-editor
  .editor-header
    .wgt.wgt-menu
        span.icon.icon-editor-svgcad
        .icon.icon-dropdown
  .layout-editor#canvas
    //- canvas(ref='canvas' @click='handleClick' @contextmenu.prevent='stopDrawing' @mousedown="onPointerDown" @mousemove="onPointerMove" @mouseup="onPointerUp" @wheel="(e) => adjustZoom(e.deltaY*SCROLL_SENSITIVITY)")
    //- svg(id='canvas' viewBox="-10 -10 20 20" ref='svg'
    //- @click='handleClick'
    //- @contextmenu.prevent='stopDrawing'
    //- @mousedown="onPointerDown"
    //- @mousemove="onPointerMove"
    //- @mouseup="onPointerUp"
    //- @wheel.prevent="adjustZoom")
      //- circle(cx='0' cy='0' r='5')
      //- circle(cx='0' cy='0' r='4')
      //- circle(cx='0' cy='0' r='3')
      //- circle(cx='0' cy='0' r='2')
      //- circle(cx='0' cy='0' r='1')
      line(x1="0" y1="-5000000" x2="0" y2="5000000" class='axis y-axis')
      line(x1="-5000000" y1="0" x2="5000000" y2="0" class='axis x-axis')
    Terminal(@inputAsk='capturePoint' @stopDrawing='stopDrawing' :coords='coordinates' :ctx='getCanvas')
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useEventBus } from '@vueuse/core'
import Terminal from './Terminal.vue'
import { store } from '../store'
import { SVG } from '@svgdotjs/svg.js'
import '@svgdotjs/svg.panzoom.js'
import '@svgdotjs/svg.draggable.js'
// import '../utils/svg.draw'
// import '../utils/svg.panzoom.js'

import '@svgdotjs/svg.draw.js'
// import '../utils/svg.draw'

console.log('SVG', SVG)

function zoomToFit(canvas) {
  const bbox = canvas.bbox()
  canvas.rect(bbox.width, bbox.height).stroke({ color: 'yellow', width: 0.2 }).fill({ opacity: 0.4 }).move(bbox.x, bbox.y)
  console.log('bbox', bbox)
  canvas.animate(300).viewbox(bbox)
}

// SVG.extend(SVG.Dom, {
//   zoomToFit: function (padding = 10) {
//     const bbox = this.rbox()
//     const viewbox = this.viewbox()

//     const zoomX = viewbox.width / bbox.width
//     const zoomY = viewbox.height / bbox.height
//     const zoom = Math.min(zoomX, zoomY)

//     const centerX = bbox.cx
//     const centerY = bbox.cy

//     const offsetX = centerX * zoom - viewbox.width / 2
//     const offsetY = centerY * zoom - viewbox.height / 2

//     this.animate(300).viewbox({
//       x: offsetX - padding,
//       y: offsetY - padding,
//       width: viewbox.width * zoom + padding * 2,
//       height: viewbox.height * zoom + padding * 2,
//     })
//   },
// })

let canvas
let viewbox
let viewboxSize = 10
const coordinates = ref({ x: 0, y: 0 })
let zoomFactor = 0.1
let lastMiddleClickTime = 0
let middleClickCount = 0
let GRID_SIZE = 20
let GRID_SPACING = 1
let isCapturingInput = false
// Local events
const emit = defineEmits(['coordsUpdated'])

// Global events
const newCoords = useEventBus('newCoords')
const newPoint = useEventBus('newPoint')
const startDrawing = useEventBus('startDrawing')
const newDrawing = useEventBus('newDrawing')
let unsubStartDrawing
let unsubNewDrawing

onMounted(() => {
  canvas = SVG()
    .addTo('#canvas')
    .addClass('canvas')
    // .viewbox(-viewboxSize * 0.3 + ' ' + -viewboxSize / 1.5 + ' ' + viewboxSize * 2 + ' ' + viewboxSize / 2)
    .panZoom({ zoomFactor, panButton: 1 })
    .mousemove(updateCoordinates)
    .mousedown(handleClick)
  console.log('canvas', canvas)
  // .rect()
  // .draw()
  // .scale(1, -1)
  viewbox = canvas.viewbox()
  drawGrid(canvas, GRID_SIZE, GRID_SPACING)
  drawAxis(canvas, GRID_SIZE)
  canvas.rect(2, 5).move(3, -5)
  canvas.rect(2, 5).move(3, 0)
  // let rectan = SVG().addTo('#canvas').rect().draw().attr('stroke-width', 5).attr('fill', 'none')
  let rect = canvas.rect(15, 15).move(-0.5, -0.5).fill({ color: 'teal', opacity: 0.5 }).stroke({ color: 'orange', width: 0.1 })
  rect.draggable()
  // canvas.rect().draw()
  canvas.rect(1, 1).move(4.5, -0.5).fill({ color: 'teal', opacity: 0.5 }).stroke({ color: 'orange', width: 0.1 })
  canvas.rect(1, 1).move(-4.5, -0.5).fill({ color: 'teal', opacity: 0.5 }).stroke({ color: 'orange', width: 0.1 })
  canvas.text('svgcad').font({ size: 1 }).fill({ color: 'white' })
  canvas.text('I ❤ SVG!').font({ size: 1, anchor: 'end' }).move(10, -1).fill({ color: 'red' })
  canvas.line(0, 0, 5, -5).stroke({ color: 'white', width: 0.1 }).plot(0, -5, 5, 0).move(0, -10)
  // canvas.zoom(1).animate(300).zoom(50)
  canvas.animate(600).viewbox(canvas.bbox())
})

function drawAxis(canvas, size) {
  const axisGroup = canvas.group()
  const xAxis = canvas.line(-size, 0, size, 0).addClass('axis x-axis').addTo(axisGroup)
  const yAxis = canvas.line(0, size, 0, -size).addClass('axis y-axis').addTo(axisGroup)
}

function drawGrid(canvas, gridSize, spacing) {
  const gridGroup = canvas.group()
  gridGroup.addClass('grid')
  for (let i = -gridSize; i <= gridSize; i += spacing) {
    if (i != 0) {
      const horizontalLines = canvas
        .line(-gridSize * spacing, i * spacing, gridSize * spacing, i * spacing)
        .addClass('axis')
        .addTo(gridGroup)
      const verticalLines = canvas
        .line(i * spacing, -gridSize * spacing, i * spacing, gridSize * spacing)
        .addClass('axis')
        .addTo(gridGroup)
    }
  }
}

function getCanvas() {
  return canvas
}

unsubStartDrawing = startDrawing.on((drawCommand) => {
  if (unsubNewDrawing) unsubNewDrawing()
  store.isDrawing = true
  console.log('start drawin', drawCommand)
  drawCommand()
  unsubNewDrawing = newDrawing.on((drawingCommand, drawingMode) => {
    console.log('drawingMode', drawingMode)
    if (drawingMode) {
      activeDrawing = drawingCommand
    } else {
      drawings.push(drawingCommand)
      activeDrawing = null
    }
  })
})

function updateCoordinates(e) {
  coordinates.value = canvas.point(e.pageX, e.pageY)
  // TODO GRID SNAP TO AVOID THIS
  coordinates.value.x = Math.round(coordinates.value.x)
  coordinates.value.y = Math.round(coordinates.value.y)
  emit('coordsUpdated', coordinates.value)
  newCoords.emit(coordinates.value)
}

function handleClick(e) {
  if (e.button === 1) {
    const currentTime = new Date().getTime()
    const timeDiff = currentTime - lastMiddleClickTime
    if (timeDiff < 300) {
      middleClickCount++
      if (middleClickCount === 2) {
        console.log('double midle click detected!!!')
        zoomToFit(canvas, 1)
        middleClickCount = 0
      }
    } else {
      middleClickCount = 1
    }
    lastMiddleClickTime = currentTime
  } else if (isCapturingInput) {
    console.log('emit new point')
    isCapturingInput = false
    console.log('isCapturingInput', isCapturingInput)
    newPoint.emit(coordinates)
  }
}

function capturePoint() {
  isCapturingInput = true
  console.log('isCapturingInput', isCapturingInput)
}

function stopDrawing() {
  // clearCanvas(canvas, context)
  store.isDrawing = false
  isCapturingInput = false
  // activeDrawing = 0
  // unsubNewDrawing()
}
</script>

<style lang="sass">
.editor-header
  border-top-left-radius: 20px
  border-top-right-radius: 20px
.canvas-editor
  border-radius: 20px
  box-sizing: border-box
  background-color: var(--node-editor-bg)
  position: relative
  display: flex
  flex-flow: column
  flex-grow: 1
.layout-editor
  position: relative
  box-sizing: border-box
  flex: 1
  min-width: 600px
  width: 100%
  height: 100%
.canvas
  // preserveAspectRatio:
  cursor: crosshair
  position: absolute
  min-width: 600px
  width: 100%
  height: 100%

.axis
  vector-effect: non-scaling-stroke
  stroke-width: 1
.x-axis
  stroke: #597631
.y-axis
  stroke: #843d47
.grid
  stroke: #4f4f4f
</style>
