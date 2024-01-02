import { Command } from '../Command'

class DrawCircleCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'DrawCircleCommand'
    this.name = 'Circle'
    // this.draw = this.draw.bind(this)
    this.drawing = this.editor.drawing
  }

  execute() {
    // const svg = this.editor.svg
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'DRAW ' + this.name.toUpperCase() + ' ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Click to start drawing a ${this.name} or type (x,y) coordinates `,
      inputAsk: true,
    })
    this.editor.setIsDrawing(true)
    this.draw()
  }
  draw() {
    this.drawing
      .circle()
      .addClass('newDrawing')
      .attr('id', this.editor.elementIndex++)
      .fill('transparent')
      .draw()
      .on('drawstop', () => {
        this.updatedOutliner()
        this.editor.setIsDrawing(false)
      })
  }
}

function drawCircleCommand(editor) {
  const circleCommand = new DrawCircleCommand(editor)
  circleCommand.execute()
}

export { drawCircleCommand }
