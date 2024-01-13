import { Command } from '../Command'

class DrawLineCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'DrawLineCommand'
    this.name = 'Line'
    // this.draw = this.draw.bind(this)
    this.drawing = this.editor.drawing
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'DRAW ' + this.name.toUpperCase() + ' ', clearSelection: true })
    this.editor.setIsDrawing(true)
    this.draw()
  }
  draw(startPoint) {
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Click to start drawing a ${this.name} or type (x,y) coordinates `,
    })
    if (this.isDrawing) {
      let line = this.drawing.line().addClass('newDrawing').draw({ startPoint, drawCircles: false, ortho: this.editor.ortho })
      line.on('drawstart', (e) => {
        startPoint = e.detail.startPoint
      })
      line.on('drawstop', (e) => {
        line.attr('id', this.editor.elementIndex++)
        line.off()
        line = null
        this.updatedOutliner()
        this.draw({ x: e.detail[1][0], y: e.detail[1][1] }) // call next line draw starting from last endpoint
      })
      this.editor.svg.on('cancelDrawing', (e) => {
        if (line) {
          line.off()
          line.draw('cancel')
          this.editor.setIsDrawing(false)
        }
      })
      this.editor.svg.on('orthoChange', () => {
        if (line) {
          line.draw('cancel')
          this.draw(startPoint)
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
