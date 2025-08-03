import { History as _History } from './History'
import { DXFLoader } from './utils/DXFloader'

function Editor() {
  const Signal = signals.Signal

  this.signals = {
    updatedCoordinates: new Signal(),
    updatedOutliner: new Signal(),
    updatedSelection: new Signal(),
    terminalLogged: new Signal(),
    clearSelection: new Signal(),
    toogledSelect: new Signal(),
    updatedProperties: new Signal(),
    pointCaptured: new Signal(),
    ghostingStarted: new Signal(),
    ghostingStopped: new Signal(),
  }
  this.history = new _History(this)
  this.canvas = document.getElementById('canvas')
  this.svg = SVG().addTo('#canvas')
  this.overlays = this.svg.group()
  this.overlays.attr('id', 'Overlays')
  this.handlers = this.overlays.group()
  this.handlers.attr('id', 'Handlers')
  this.snap = this.svg.group()
  this.snap.attr('id', 'Snap')
  this.drawing = this.svg.group()
  this.drawing.attr('id', 'Collection')
  this.isDrawing = false
  this.isInteracting = false
  this.elementIndex = 0
  this.selected = []
  this.loader = new DXFLoader(this)
  this.orthomode = true
  this.length = null
  this.distance = null
  this.snapPoint = null
}

Editor.prototype = {
  setIsDrawing: function (value) {
    this.isDrawing = value
  },

  addElement: function (element, parent) {
    console.log('addElement', element)
    console.log('addElement parent', parent)
    // parent.put(element)
    element.putIn(parent)
    // element[0].remove()
  },

  removeElement: function (element) {
    console.log('removeElement', element)
    element.remove()
    // element[0].remove()
  },

  execute: function (cmd) {
    this.history.execute(cmd)
  },

  undo: function () {
    this.history.undo()
  },

  redo: function () {
    this.history.redo()
  },
}

export { Editor }
