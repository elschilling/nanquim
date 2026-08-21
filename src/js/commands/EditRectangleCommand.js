import { Command } from '../Command.js'

class EditRectangleCommand extends Command {
  constructor(editor, element, oldValues, newValues) {
    super(editor)
    this.type = 'EditRectangleCommand'
    this.name = 'Edit Rectangle'
    this.element = element
    this.oldValues = { ...oldValues }
    this.newValues = { ...newValues }
  }

  execute() {
    this._apply(this.newValues)
  }

  undo() {
    this._apply(this.oldValues)
  }

  _apply(values) {
    this.element.move(values.x, values.y).size(values.width, values.height)
  }
}

export { EditRectangleCommand }
