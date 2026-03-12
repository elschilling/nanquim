import { History as _History } from './History'
import { DXFLoader } from './utils/DXFloader'
import { initCollections } from './Collection'
import { SpatialIndex } from './SpatialIndex'

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
    moveGhostingStarted: new Signal(),
    moveGhostingStopped: new Signal(),
    rotateGhostingStarted: new Signal(),
    rotateGhostingStopped: new Signal(),
    offsetGhostingStarted: new Signal(),
    offsetGhostingStopped: new Signal(),
    scaleGhostingStarted: new Signal(),
    scaleGhostingStopped: new Signal(),
    inputValue: new Signal(),
    zoomChanged: new Signal(),
    coordinateInput: new Signal(),
    vertexEditStarted: new Signal(),
    vertexEditStopped: new Signal(),
    refreshHandlers: new Signal(),
    commandCancelled: new Signal(),
    requestHoverCheck: new Signal(),
    updatedCollections: new Signal(),
    preferencesChanged: new Signal(),
    editorModeChanged: new Signal(),   // dispatched when switching model <-> paper
    modelContentChanged: new Signal(), // dispatched when model drawing is modified
    paperViewportsChanged: new Signal(), // dispatched when paper viewports change
    colorMapUpdated: new Signal(),      // dispatched when print colors are modified
  }
  this.history = new _History(this)
  this.canvas = document.getElementById('canvas')
  this.svg = SVG().addTo('#canvas')
  this.overlays = this.svg.group()
  this.overlays.attr('id', 'Overlays')
  this.snap = this.svg.group()
  this.snap.attr('id', 'Snap')
  this.drawing = this.svg.group()
  this.drawing.attr('id', 'Collection')
  this.handlers = this.svg.group()
  this.handlers.attr('id', 'Handlers')
  this.modelHandlers = this.handlers // Store reference for mode-switching
  this.isDrawing = false
  this.isInteracting = false
  this.selectSingleElement = false
  this.isSelecting = false
  this.isSnapping = false
  this.elementIndex = 0
  this.selected = []
  this.loader = new DXFLoader(this)
  this.orthomode = true
  this.length = null
  this.distance = null
  this.offsetDX = null
  this.offsetDY = null
  this.snapPoint = null
  this.lastCommand = null
  this.lastClick = null
  this.isEditingVertex = false
  this.editingVertices = [] // Array of { element, vertexIndex, originalPosition }
  this.cmdParams = {
    filletRadius: 0,
  }

  // ── Paper Mode ──────────────────────────────────────────────────────────────
  // 'model' | 'paper'
  this.mode = 'model'

  // Paper configuration (persisted into saved SVG metadata)
  this.paperConfig = {
    // Paper size preset: 'A0'|'A1'|'A2'|'A3'|'A4'|'custom'
    size: 'A4',
    // Paper dimensions in mm (used when size === 'custom' or derived from preset)
    width: 210,
    height: 297,
    // 'portrait' | 'landscape'
    orientation: 'portrait',
    // Coordinate scale: SVG units per centimeter.
    // Default 1 means 1 SVG unit = 1cm.
    // At 1:100 scale, 1m in model space maps to 1cm on paper.
    // Users can change this in Paper Settings.
    unitsPerCm: 1,
    // Color translation map: { '#rrggbb': { printColor: '#rrggbb', enabled: true } }
    colorMap: {},
  }

  // Initialize collection system (creates default collection)
  initCollections(this)

  // Spatial index for fast hit-testing (R-tree)
  this.spatialIndex = new SpatialIndex()
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
    this.spatialIndex.markDirty()
    this.signals.updatedOutliner.dispatch()
  },

  removeElement: function (element) {
    console.log('removeElement', element)

    // Check if element is in selection and remove it
    if (this.selected.includes(element)) {
      this.selected = this.selected.filter(el => el !== element)
      this.signals.clearSelection.dispatch()
      // If other elements remain selected, update handlers
      if (this.selected.length > 0) {
        this.signals.updatedSelection.dispatch()
      }
    }

    element.remove()
    // element[0].remove()
    this.spatialIndex.markDirty()
    this.signals.updatedOutliner.dispatch()
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
