import { Command } from '../Command.js'
import { renderEllipseArc } from '../utils/ellipseArcUtils.js'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes.js'

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
    this.applyData(this.newData)
  }

  undo() {
    this.applyData(this.oldData)
  }

  applyData(data) {
    renderEllipseArc(this.element, data)
    invalidateSpatialIndexes(this.editor)
  }
}

export { EditEllipseArcCommand }
