import { History as _History } from './History'

function Editor() {
  const Signal = signals.Signal

  this.signals = {
    updatedCoordinates: new Signal(),
    terminalLogged: new Signal(),
    inputAsked: new Signal(),
  }
  this.history = new _History(this)
  this.canvas = document.getElementById('canvas')
  this.svg = SVG().addTo('#canvas')
  this.isDrawing = false
  this.observers = []
}

Editor.prototype = {
  execute: function (cmd, optionalName) {
    this.history.execute(cmd, optionalName)
  },
  setIsDrawing: function (value) {
    this.isDrawing = value
    // this.notifyObservers()
  },
  // addObserver: function (observer) {
  //   this.observers.push(observer)
  // },
  // notifyObservers: function () {
  //   this.observers.forEach((observer) => {
  //     console.log('observer', observer)
  //     observer.update(this.isDrawing)
  //   })
  // },
}

export { Editor }
