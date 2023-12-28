<template lang="pug">
main
  NavBar
  section.screen
    .viewport
      Canvas(@coordsUpdated='updateCoordinates')
    .sidepanel-resize(@mousedown='resizePanel')
    .sidepanel(ref='sidepanel')
      .outliner(ref='outliner')
        .editor-header
            .wgt.wgt-menu
              span.icon.icon-editor-properties
              .icon.icon-dropdown
      .outliner-resize(@mousedown='resizeOutliner')
      .properties
        .editor-header
          .wgt.wgt-menu
            span.icon.icon-editor-properties
            .icon.icon-dropdown

        .layout-row.row
          .wgt.wgt-menu.expand
            span Add Modifier
            .icon.icon-dropdown

        .modifier.active
          .modifier-header
            .layout-row
              .wgt.wgt-tool.no-emboss
                .icon.icon-collapse
              .wgt.wgt-regular.no-emboss
                .icon.icon-mod-node

              .layout-row.expand.align
                .wgt.wgt-text GeometryNodes
                .wgt.wgt-regular
                  .icon.icon-restrict-edit-mode
                .wgt.wgt-regular.active
                  .icon.icon-restrict-screen
                .wgt.wgt-regular.active
                  .icon.icon-restrict-render
                .wgt.wgt-menu
                  .icon.icon-dropdown
              .wgt.wgt-tool.no-emboss
                .icon.icon-x
              .wgt.wgt-drag.no-emboss
                .icon.icon-drag
  StatusBar(:coords='coordinates')
</template>

<script setup>
import NavBar from './templates/NavBar.vue'
import StatusBar from './templates/StatusBar.vue'
import Canvas from './templates/Canvas.vue'
import { ref } from 'vue'

const coordinates = ref({ x: 0, y: 0 })
const sidepanel = ref(null)
const outliner = ref(null)
let isResizingPanel, isResizingOutliner, startX, startWidth, startY, startHeight

function updateCoordinates(coords) {
  coordinates.value = coords
}

const resizeOutliner = (e) => {
  isResizingOutliner = true
  console.log('e.y', e.y)
  console.log('outliner', getComputedStyle(outliner.value).width)
  startY = e.y
  startHeight = parseInt(getComputedStyle(outliner.value, '').height)
  outliner.value.parentNode.addEventListener('mousemove', (ex) => resizeOut(ex, outliner.value))
  outliner.value.parentNode.addEventListener('mouseup', () => stopResizeOutliner())
}
const resizeOut = (e, panel) => {
  if (isResizingOutliner) {
    let dy = -e.y + startY
    panel.style.height = startHeight - dy + 'px'
  }
}
const resizePanel = (e) => {
  isResizingPanel = true
  console.log('e.x', e.x)
  console.log('sidepanel', getComputedStyle(sidepanel.value).width)
  startX = e.x
  startWidth = parseInt(getComputedStyle(sidepanel.value, '').width)
  sidepanel.value.parentNode.addEventListener('mousemove', (ex) => resizeSidepanel(ex, sidepanel.value))
  sidepanel.value.parentNode.addEventListener('mouseup', () => stopResizePanel())
}

const resizeSidepanel = (e, panel) => {
  if (isResizingPanel) {
    let dx = -e.x + startX
    panel.style.width = startWidth + dx + 'px'
  }
}
const stopResizeOutliner = () => {
  isResizingOutliner = false
  outliner.value.parentNode.removeEventListener('mousemove', resizeOut)
  outliner.value.parentNode.removeEventListener('mouseup', stopResizeOutliner)
}
const stopResizePanel = () => {
  isResizingPanel = false
  sidepanel.value.parentNode.removeEventListener('mousemove', resizeSidepanel)
  sidepanel.value.parentNode.removeEventListener('mouseup', stopResizePanel)
}
</script>

<style lang="sass" scoped>
main
  height: 100%
  display: flex
  flex-direction: column
.screen
  background: var(--editor-border-color)
  flex: 1
  display: flex
.viewport
  display: relative
  border-right: solid calc(var(--editor-border-width)/1.5) var(--editor-border-color)
  border-radius: 20px
  flex: 1
  background: #444
  width: 70%
.sidepanel
  border-left: solid calc(var(--editor-border-width)/1.5) var(--editor-border-color)
  border-radius: 20px
  // background: var(--editor-header-bg)
  min-width: 200px
  display: flex
  flex-direction: column
.sidepanel-resize
    width: var(--editor-border-width)
    cursor: col-resize
    // background: blue
    top: 0
    bottom: 0
.outliner
  border-bottom: solid calc(var(--editor-border-width)/1.5) var(--editor-border-color)
  border-radius: 20px
  background: var(--editor-header-bg)
  height: 40%
.outliner-resize
  height: var(--editor-border-width)
  left: 0
  right: 0
  // background: green
  cursor: row-resize
.properties
  flex: 1
  border-top: solid calc(var(--editor-border-width)/1.5) var(--editor-border-color)
  border-radius: 20px
  background: var(--editor-header-bg)

.editor-header
  border-top-left-radius: 20px
  border-top-right-radius: 20px
</style>
