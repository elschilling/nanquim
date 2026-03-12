import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import { applyCollectionStyleToElement } from '../Collection'

class DrawLineCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'DrawLineCommand'
    this.name = 'Line'
    // this.draw = this.draw.bind(this)
    this.drawing = this.editor.activeCollection
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
      let line = this.drawing.line().draw({ startPoint, drawCircles: false, ortho: this.editor.ortho, length })
      applyCollectionStyleToElement(this.editor, line)
      line.on('drawstart', (e) => {
        startPoint = e.detail.startPoint
      })
      line.on('drawstop', (e) => {
        line.attr('id', this.editor.elementIndex++)
        line.attr('name', 'Line')
        line.off()
        this.editor.history.undos.push(new AddElementCommand(editor, line))
        this.editor.lastCommand = this
        // this.editor.execute(new AddElementCommand(editor, line))
        line = null
        this.updatedOutliner()
        this.draw({ x: e.detail[1][0], y: e.detail[1][1] }) // call next line draw starting from last endpoint
      })
      const activeSvg = this.editor.mode === 'paper' ? this.editor.paperSvg : this.editor.svg
      activeSvg.on('valueInput', (e) => {
        if (line) {
          line.off()
          line.draw('cancel')
          line = null
          this.draw(startPoint, this.editor.length)
        }
      })
      activeSvg.on('coordinateInput', (e) => {
        if (line) {
          const coord = this.editor.inputCoord
          line.off()
          line.draw('cancel')
          line = null
          if (!startPoint) {
            // No start point yet - use coordinate as start point
            this.editor.snapPoint = { x: coord.x, y: coord.y }
            this.draw({ x: coord.x, y: coord.y })
          } else {
            // Start point exists - draw line to absolute coordinate
            let newLine = this.drawing.line(startPoint.x, startPoint.y, coord.x, coord.y)
            applyCollectionStyleToElement(this.editor, newLine)
            newLine.attr('id', this.editor.elementIndex++)
            newLine.attr('name', 'Line')
            this.editor.history.undos.push(new AddElementCommand(this.editor, newLine))
            this.editor.lastCommand = this
            this.updatedOutliner()
            this.editor.snapPoint = { x: coord.x, y: coord.y }
            this.draw({ x: coord.x, y: coord.y })
          }
        }
      })
      activeSvg.on('orthoChange', () => {
        if (line) {
          line.off()
          line.draw('cancel')
          line = null
          this.draw(startPoint, this.editor.length)
        }
      })
      activeSvg.on('cancelDrawing', (e) => {
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
