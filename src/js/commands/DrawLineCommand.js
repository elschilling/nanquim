import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import { applyCollectionStyleToElement } from '../Collection'
import { resolveInputCoordinate } from '../utils/coordinateInput'

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
      let line = this.drawing.line()
        .attr('data-nanquim-transient', 'true')
        .draw({ startPoint, drawCircles: false, ortho: this.editor.ortho, length })
      applyCollectionStyleToElement(this.editor, line)
      line.on('drawstart', (e) => {
        startPoint = e.detail.startPoint
      })
      line.on('drawstop', (e) => {
        cleanupActiveSvgListeners()
        line.attr('name', 'Line')
        line.off()
        this.editor.execute(new AddElementCommand(this.editor, line))
        // this.editor.execute(new AddElementCommand(editor, line))
        line = null
        this.updatedOutliner()
        this.draw({ x: e.detail[1][0], y: e.detail[1][1] }) // call next line draw starting from last endpoint
      })
      const activeSvg = this.editor.mode === 'paper' ? this.editor.paperSvg : this.editor.svg
      const onValueInput = () => {
        if (line) {
          cleanupActiveSvgListeners()
          line.off()
          line.draw('cancel')
          line = null
          this.draw(startPoint, this.editor.length)
        }
      }
      const onCoordinateInput = () => {
        if (line) {
          const coord = resolveInputCoordinate(this.editor, startPoint)
          cleanupActiveSvgListeners()
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
              .attr('data-nanquim-transient', 'true')
            applyCollectionStyleToElement(this.editor, newLine)
            newLine.attr('name', 'Line')
            this.editor.execute(new AddElementCommand(this.editor, newLine))
            this.updatedOutliner()
            this.editor.snapPoint = { x: coord.x, y: coord.y }
            this.draw({ x: coord.x, y: coord.y })
          }
        }
      }
      const onOrthoChange = () => {
        if (line) {
          cleanupActiveSvgListeners()
          line.off()
          line.draw('cancel')
          line = null
          this.draw(startPoint, this.editor.length)
        }
      }
      const onCancelDrawing = () => {
        if (line) {
          line.off()
          line.draw('cancel')
          line = null
          this.editor.setIsDrawing(false)
        }
        cleanupActiveSvgListeners()
      }
      const cleanupActiveSvgListeners = () => {
        activeSvg.off('valueInput.draw-line', onValueInput)
        activeSvg.off('coordinateInput.draw-line', onCoordinateInput)
        activeSvg.off('orthoChange.draw-line', onOrthoChange)
        activeSvg.off('cancelDrawing.draw-line', onCancelDrawing)
      }

      activeSvg.on('valueInput.draw-line', onValueInput)
      activeSvg.on('coordinateInput.draw-line', onCoordinateInput)
      activeSvg.on('orthoChange.draw-line', onOrthoChange)
      activeSvg.on('cancelDrawing.draw-line', onCancelDrawing)
    }
  }
}

function drawLineCommand(editor) {
  const lineCommand = new DrawLineCommand(editor)
  lineCommand.execute()
}

export { drawLineCommand }
