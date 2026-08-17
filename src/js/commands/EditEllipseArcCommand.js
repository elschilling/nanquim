import { Command } from '../Command.js'
import { renderEllipseArc } from '../utils/ellipseArcUtils.js'

class EditEllipseArcCommand extends Command {
  constructor(editor, element, oldData, newData) {
    super(editor)
    this.type = 'EditEllipseArcCommand'
    this.name = 'Edit Ellipse Arc'
    this.element = element
    this.oldData = oldData
    this.newData = newData
  }

  execute() {
    renderEllipseArc(this.element, this.newData)
  }

  undo() {
    renderEllipseArc(this.element, this.oldData)
  }
}

export { EditEllipseArcCommand }
