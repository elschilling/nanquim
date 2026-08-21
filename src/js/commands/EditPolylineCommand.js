import { Command } from '../Command.js'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes.js'

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
    this.applyPoints(this.newPoints)
  }

  undo() {
    this.applyPoints(this.oldPoints)
  }

  applyPoints(points) {
    this.element.plot(points)
    invalidateSpatialIndexes(this.editor)
  }
}

export { EditPolylineCommand }
