import { Command } from '../Command.js'

class EditPolylineCommand extends Command {
  constructor(editor, element, oldPoints, newPoints) {
    super(editor)
    this.type = 'EditPolylineCommand'
    this.name = 'Edit Polyline Vertex'
    this.element = element
    this.oldPoints = oldPoints.map(p => [p[0], p[1]])
    this.newPoints = newPoints.map(p => [p[0], p[1]])
  }

  execute() {
    this.element.plot(this.newPoints)
  }

  undo() {
    this.element.plot(this.oldPoints)
  }
}

export { EditPolylineCommand }
