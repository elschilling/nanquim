import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'

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
  draw(startPoint, length) {
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Click to start drawing a ${this.name} or type (x,y) coordinates `,
    })
    if (this.isDrawing) {
      let line = this.drawing.line().addClass('newDrawing').draw({ startPoint, drawCircles: false, ortho: this.editor.ortho, length })
      line.on('drawstart', (e) => {
        startPoint = e.detail.startPoint
      })
      line.on('drawstop', (e) => {
        line.attr('id', this.editor.elementIndex++)
        line.attr('name', 'Line')
        // console.log('drawstop', this.editor.elementIndex)
        line.off()
        this.editor.history.undos.push(new AddElementCommand(editor, line))
        // this.editor.execute(new AddElementCommand(editor, line))
        line = null
        this.updatedOutliner()
        this.draw({ x: e.detail[1][0], y: e.detail[1][1] }) // call next line draw starting from last endpoint
      })
      this.editor.svg.on('valueInput', (e) => {
        console.log(e.detail)
        if (line) {
          console.log('length line')
          line.off()
          line.draw('cancel')
          line = null
          this.draw(startPoint, this.editor.length)
        }
      })
      this.editor.svg.on('orthoChange', () => {
        if (line) {
          console.log('line', line)
          line.off()
          line.draw('cancel')
          line = null
          this.draw(startPoint, this.editor.length)
        }
      })
      this.editor.svg.on('cancelDrawing', (e) => {
        if (line) {
          line.off()
          line.draw('cancel')
          line = null
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
