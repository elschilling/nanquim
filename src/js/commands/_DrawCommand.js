// import { useEventBus } from '@vueuse/core'

// const terminalLog = useEventBus('terminalLog')
// const newPoint = useEventBus('newPoint')
// const startDrawing = useEventBus('startDrawing')
// const newDrawing = useEventBus('newDrawgin')
// const newCoords = useEventBus('newCoords')
// import { store } from '../store'

export class DrawCommand {
  constructor(editor, runOnce = true) {
    this.editor = editor
    this.startPoint = {}
    this.endPoint = {}
    this.unsubscribe = null
    this.unsubscribe2 = null
    this.commandName = ''
    this.emitedLog = false
    this.runOnce = runOnce
    this.signals = editor.signals
  }

  async start(commandType) {
    this.commandType = commandType
    this.signals.terminalLogged.dispatch({ type: 'strong', msg: 'DRAW ' + commandType.toUpperCase() + ' ' })
    this.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Click to start drawing a ${commandType} or type (x,y) coordinates `,
      inputAsk: true,
    })
    return new Promise((resolve, reject) => {
      console.log('new point')
      this.unsubscribe = newPoint.on((point) => {
        this.startPoint = { ...point.value }
        console.log('startPoint', this.startPoint)
        this.unsubscribe()
        startDrawing.emit(() => this.startDrawCommand().then(resolve))
      })
    })
  }

  async startDrawCommand() {
    return new Promise((resolve, reject) => {
      if (this.unsubscribe) this.unsubscribe()
      this.unsubscribe = newCoords.on((coords) => {
        if (store.isDrawing) {
          const command = this.createDrawCall(this.startPoint, coords)
          newDrawing.emit(() => command.draw(), true)
          this.nextPoint().then(resolve)
        }
      })
    })
  }

  async nextPoint() {
    // let emitedLog = false
    return new Promise((resolve, reject) => {
      if (store.isDrawing) {
        if (!this.emitedLog) {
          terminalLog.emit({
            type: 'p',
            msg: `Click to define the next point or type (x,y) coordinates. Press ESC or Right click to finish `,
            inputAsk: true,
          })
          this.emitedLog = true
        }
        if (this.unsubscribe2) this.unsubscribe2()
        this.unsubscribe2 = newPoint.on((e) => {
          this.endPoint = { ...e.value }
          this.emitedLog = false
          const command = this.createDrawCall(this.startPoint, this.endPoint)
          newDrawing.emit(command, false)
          this.startPoint = { ...this.endPoint }
          this.endPoint = {}
          if (this.runOnce) {
            store.isDrawing = false
            this.reset()
            resolve()
          } else {
            this.unsubscribe2()
            this.nextPoint().then(resolve)
          }
        })
      } else {
        this.reset()
        resolve()
      }
    })
  }
  reset() {
    this.startPoint = {}
    this.endPoint = {}
    if (this.unsubscribe) this.unsubscribe()
    if (this.unsubscribe2) this.unsubscribe2()
  }
  createDrawCall(startPoint, endPoint) {
    throw new Error('DrawCommand subclass must implement createDrawCall method')
  }
}
