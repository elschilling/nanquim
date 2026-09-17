import { Command } from '../Command.js'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes.js'

function copyBounds(values) {
  return Object.fromEntries(['x', 'y', 'width', 'height', 'clip-path']
    .filter(key => Object.hasOwn(values, key))
    .map(key => [key, values[key]]))
}

class EditImageCommand extends Command {
  constructor(editor, element, oldValues, newValues) {
    super(editor)
    this.type = 'EditImageCommand'
    this.name = 'Edit Image'
    this.element = element
    this.oldValues = copyBounds(oldValues)
    if (oldValues.attributes) this.oldValues.attributes = copyBounds(oldValues.attributes)
    this.newValues = copyBounds(newValues)
    if (Object.hasOwn(this.newValues, 'clip-path') && !Object.hasOwn(this.oldValues, 'clip-path')) {
      this.oldValues['clip-path'] = null
      if (this.oldValues.attributes) this.oldValues.attributes['clip-path'] = null
    }
  }

  execute() {
    this._apply(this.newValues)
  }

  undo() {
    this._apply(this.oldValues.attributes || this.oldValues)
  }

  _apply(values) {
    this.element.attr(values)
    invalidateSpatialIndexes(this.editor)
  }
}

export { EditImageCommand }
