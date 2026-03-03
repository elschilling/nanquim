import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import { applyCollectionStyleToElement } from '../Collection'

class DrawCircleCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'DrawCircleCommand'
    this.name = 'Circle'
    this.drawing = this.editor.activeCollection
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'DRAW ' + this.name.toUpperCase() + ' ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Click to set center or type @x,y coordinates `,
    })
    this.editor.setIsDrawing(true)
    this.draw()
  }

  draw(centerPoint) {
    if (this.isDrawing) {
      let circle = this.drawing.circle().addClass('newDrawing').fill('transparent').draw()
      applyCollectionStyleToElement(this.editor, circle)
      let hasCenter = !!centerPoint

      if (centerPoint) {
        // Simulate a click at the center point to start drawing
        circle.draw('cancel')
        circle.remove()
        circle = this.drawing.circle().addClass('newDrawing').fill('transparent').draw({ startPoint: centerPoint })
        applyCollectionStyleToElement(this.editor, circle)
        this.editor.signals.terminalLogged.dispatch({
          type: 'span',
          msg: `Center set at (${centerPoint.x.toFixed(2)}, ${centerPoint.y.toFixed(2)}). Click to set radius or type a value. `,
        })
      }

      circle.on('drawstart', (e) => {
        hasCenter = true
        centerPoint = e.detail.startPoint
        this.editor.signals.terminalLogged.dispatch({
          type: 'span',
          msg: `Center set. Click to set radius or type a value. `,
        })
      })

      circle.on('drawstop', () => {
        circle.attr('id', this.editor.elementIndex++)
        circle.attr('name', 'Circle')
        circle.off()
        this.editor.history.undos.push(new AddElementCommand(this.editor, circle))
        this.editor.lastCommand = this
        circle = null
        this.updatedOutliner()
        this.editor.setIsDrawing(false)
      })

      // Handle @x,y coordinate input for center point
      this.editor.svg.on('coordinateInput', (e) => {
        if (circle) {
          const coord = this.editor.inputCoord
          circle.off()
          circle.draw('cancel')
          circle = null
          // Use coordinate as center point
          this.editor.snapPoint = { x: coord.x, y: coord.y }
          this.draw({ x: coord.x, y: coord.y })
        }
      })

      // Handle numeric radius input after center is set
      this.editor.svg.on('valueInput', (e) => {
        if (circle && hasCenter && centerPoint) {
          const radius = parseFloat(this.editor.length)
          if (!isNaN(radius) && radius > 0) {
            circle.off()
            circle.draw('cancel')
            circle = null
            // Create circle with exact center and radius
            let newCircle = this.drawing
              .circle(radius * 2)
              .addClass('newDrawing')
              .fill('transparent')
              .center(centerPoint.x, centerPoint.y)
            applyCollectionStyleToElement(this.editor, newCircle)
            newCircle.attr('id', this.editor.elementIndex++)
            newCircle.attr('name', 'Circle')
            this.editor.history.undos.push(new AddElementCommand(this.editor, newCircle))
            this.editor.lastCommand = this
            this.updatedOutliner()
            this.editor.signals.terminalLogged.dispatch({
              msg: `Circle created with radius ${radius}.`,
            })
            this.editor.setIsDrawing(false)
          }
        }
      })

      this.editor.svg.on('cancelDrawing', (e) => {
        if (circle) {
          circle.off()
          circle.draw('cancel')
          circle = null
          this.editor.setIsDrawing(false)
        }
      })
    }
  }
}

function drawCircleCommand(editor) {
  const circleCommand = new DrawCircleCommand(editor)
  circleCommand.execute()
}

export { drawCircleCommand }
