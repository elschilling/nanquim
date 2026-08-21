import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import { applyCollectionStyleToElement } from '../Collection'
import { resolveInputCoordinate } from '../utils/coordinateInput'

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
      let circle = this.drawing.circle()
        .attr('data-nanquim-transient', 'true')
        .fill('transparent')
        .draw()
      applyCollectionStyleToElement(this.editor, circle)
      let hasCenter = !!centerPoint

      if (centerPoint) {
        // Simulate a click at the center point to start drawing
        circle.draw('cancel')
        circle.remove()
        circle = this.drawing.circle()
          .attr('data-nanquim-transient', 'true')
          .fill('transparent')
          .draw({ startPoint: centerPoint })
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
        cleanupActiveSvgListeners()
        circle.attr('name', 'Circle')
        circle.off()
        this.editor.execute(new AddElementCommand(this.editor, circle))
        circle = null
        this.updatedOutliner()
        this.editor.setIsDrawing(false)
      })

      const activeSvg = this.editor.mode === 'paper' ? this.editor.paperSvg : this.editor.svg

      // Handle @x,y coordinate input for center point
      const onCoordinateInput = () => {
        if (circle) {
          const coord = resolveInputCoordinate(this.editor, centerPoint)
          cleanupActiveSvgListeners()
          circle.off()
          circle.draw('cancel')
          circle = null
          // Use coordinate as center point
          this.editor.snapPoint = { x: coord.x, y: coord.y }
          this.draw({ x: coord.x, y: coord.y })
        }
      }

      // Handle numeric radius input after center is set
      const onValueInput = () => {
        if (circle && hasCenter && centerPoint) {
          const radius = parseFloat(this.editor.length)
          if (!isNaN(radius) && radius > 0) {
            cleanupActiveSvgListeners()
            circle.off()
            circle.draw('cancel')
            circle = null
            // Create circle with exact center and radius
            let newCircle = this.drawing
              .circle(radius * 2)
              .attr('data-nanquim-transient', 'true')
              .fill('transparent')
              .center(centerPoint.x, centerPoint.y)
            applyCollectionStyleToElement(this.editor, newCircle)
            newCircle.attr('name', 'Circle')
            this.editor.execute(new AddElementCommand(this.editor, newCircle))
            this.updatedOutliner()
            this.editor.signals.terminalLogged.dispatch({
              msg: `Circle created with radius ${radius}.`,
            })
            this.editor.setIsDrawing(false)
          }
        }
      }

      const onCancelDrawing = () => {
        if (circle) {
          circle.off()
          circle.draw('cancel')
          circle = null
          this.editor.setIsDrawing(false)
        }
        cleanupActiveSvgListeners()
      }
      const cleanupActiveSvgListeners = () => {
        activeSvg.off('coordinateInput.draw-circle', onCoordinateInput)
        activeSvg.off('valueInput.draw-circle', onValueInput)
        activeSvg.off('cancelDrawing.draw-circle', onCancelDrawing)
      }

      activeSvg.on('coordinateInput.draw-circle', onCoordinateInput)
      activeSvg.on('valueInput.draw-circle', onValueInput)
      activeSvg.on('cancelDrawing.draw-circle', onCancelDrawing)
    }
  }
}

function drawCircleCommand(editor) {
  const circleCommand = new DrawCircleCommand(editor)
  circleCommand.execute()
}

export { drawCircleCommand }
