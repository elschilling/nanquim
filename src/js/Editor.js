import { History as _History } from './History'
import { DXFLoader } from '../utils/DXFloader'

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
  }
  this.history = new _History(this)
  this.canvas = document.getElementById('canvas')
  this.svg = SVG().addTo('#canvas')
  this.overlays = this.svg.group()
  this.overlays.attr('id', 'Overlays')
  this.handlers = this.overlays.group()
  this.handlers.attr('id', 'Handlers')
  this.drawing = this.svg.group()
  this.drawing.attr('id', 'Collection')
  this.isDrawing = false
  this.elementIndex = 0
  this.selected = []
  this.loader = new DXFLoader(this)
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
