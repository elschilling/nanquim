import { Command } from '../Command'
import { applyCollectionStyleToElement } from '../Collection'

class DrawRectangleCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'DrawRectangleCommand'
    this.name = 'Rectangle'
    this.draw = this.draw.bind(this)
    this.drawing = this.editor.activeCollection
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'DRAW ' + this.name.toUpperCase() + ' ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Click to start drawing a ${this.name} or type (x,y) coordinates `,
    })
    this.editor.setIsDrawing(true)
    this.draw()
  }
  draw() {
    const rect = this.drawing
      .rect()

      .fill('none')
      .attr('id', this.editor.elementIndex++)
    applyCollectionStyleToElement(this.editor, rect)

    rect.draw()
      .on('drawstop', () => {
        this.updatedOutliner()
        this.editor.setIsDrawing(false)
      })
  }
}

function drawRectangleCommand(editor) {
  const rectangleCommand = new DrawRectangleCommand(editor)
  rectangleCommand.execute()
}

export { drawRectangleCommand }
