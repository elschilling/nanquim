import { Command } from '../Command'

class DrawCircleCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'DrawCircleCommand'
    this.name = 'Circle'
    this.draw = this.draw.bind(this)
    this.svg = this.editor.svg
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
    this.editor.svg
      .circle()
      .addClass('newDrawing')
      .fill('transparent')
      .draw()
      .on('drawstop', () => this.editor.setIsDrawing(false))
  }
}

function drawCircleCommand(editor) {
  const circleCommand = new DrawCircleCommand(editor)
  circleCommand.execute()
}

export { drawCircleCommand }
