import { Command } from '../Command'

class DrawRectangleCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'DrawRectangleCommand'
    this.name = 'Rectangle'
    this.draw = this.draw.bind(this)
    this.svg = this.editor.svg
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
    this.editor.svg
      .rect()
      .addClass('newDrawing')
      .draw()
      .on('drawstop', () => this.editor.setIsDrawing(false))
  }
}

function drawRectangleCommand(editor) {
  const rectangleCommand = new DrawRectangleCommand(editor)
  rectangleCommand.execute()
}

export { drawRectangleCommand }
