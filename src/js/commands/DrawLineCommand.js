import { Command } from '../Command'

class DrawLineCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'DrawLineCommand'
    this.name = 'Line'
    this.draw = this.draw.bind(this)
    this.svg = this.editor.svg
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'DRAW ' + this.name.toUpperCase() + ' ' })
    this.editor.setIsDrawing(true)
    this.draw()
  }
  draw(startPoint) {
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Click to start drawing a ${this.name} or type (x,y) coordinates `,
    })
    if (this.isDrawing) {
      let drawing = this.svg
      let line = drawing.line().addClass('newDrawing').draw({ startPoint, drawCircles: false })
      line.on('drawstop', (e) => {
        line.off()
        line = null
        this.draw({ x: e.detail[1][0], y: e.detail[1][1] }) // call next line draw starting from last endpoint
      })
      drawing.on('cancelDrawing', (e) => {
        if (line) {
          line.off()
          line.draw('cancel')
          this.isDrawing = false
          this.editor.setIsDrawing(false)
        }
      })
    }
  }
}

function drawLineCommand(editor) {
  const lineCommand = new DrawLineCommand(editor)
  lineCommand.execute()
}

export { drawLineCommand }
