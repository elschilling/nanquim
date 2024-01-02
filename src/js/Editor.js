import { History as _History } from './History'

function Editor() {
  const Signal = signals.Signal

  this.signals = {
    updatedCoordinates: new Signal(),
    updatedOutliner: new Signal(),
    terminalLogged: new Signal(),
    clearSelection: new Signal(),
  }
  this.history = new _History(this)
  this.canvas = document.getElementById('canvas')
  this.svg = SVG().addTo('#canvas')
  this.overlays = this.svg.group()
  this.drawing = this.svg.group()
  this.isDrawing = false
  this.elementIndex = 0
}

Editor.prototype = {
  execute: function (cmd, optionalName) {
    this.history.execute(cmd, optionalName)
  },
  setIsDrawing: function (value) {
    this.isDrawing = value
  },
}

export { Editor }
