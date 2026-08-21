import { Command } from '../Command.js'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes.js'

class EditTextPositionCommand extends Command {
    constructor(editor, element, oldValues, newValues) {
        super(editor)
        this.type = 'EditTextPositionCommand'
        this.name = 'Edit Text Position'
        this.element = element
        this.oldValues = oldValues // { x, y }
        this.newValues = newValues // { x, y }
    }

    execute() {
        this.applyValues(this.newValues)
    }

    undo() {
        this.applyValues(this.oldValues)
    }

    applyValues(values) {
        this.element.attr('x', values.x).attr('y', values.y)
        this.element.rebuild()
        invalidateSpatialIndexes(this.editor)
    }
}

export { EditTextPositionCommand }
