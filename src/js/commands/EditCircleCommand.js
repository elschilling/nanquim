
import { Command } from '../Command.js'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes.js'

class EditCircleCommand extends Command {
    constructor(editor, element, oldValues, newValues) {
        super(editor)
        this.type = 'EditCircleCommand'
        this.name = 'Edit Circle'
        this.element = element
        this.oldValues = oldValues // { cx, cy, r }
        this.newValues = newValues // { cx, cy, r }
    }

    execute() {
        this.applyValues(this.newValues)
    }

    undo() {
        this.applyValues(this.oldValues)
    }

    applyValues(values) {
        this.element.center(values.cx, values.cy)
        this.element.radius(values.r)
        invalidateSpatialIndexes(this.editor)
    }
}

export { EditCircleCommand }
