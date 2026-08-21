import { Command } from '../Command.js'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes.js'

class EditEllipseCommand extends Command {
    constructor(editor, element, oldValues, newValues) {
        super(editor)
        this.type = 'EditEllipseCommand'
        this.name = 'Edit Ellipse'
        this.element = element
        this.oldValues = oldValues // { cx, cy, rx, ry }
        this.newValues = newValues // { cx, cy, rx, ry }
    }

    execute() {
        this.applyValues(this.newValues)
    }

    undo() {
        this.applyValues(this.oldValues)
    }

    applyValues(values) {
        this.element.center(values.cx, values.cy)
        this.element.attr({ rx: values.rx, ry: values.ry })
        invalidateSpatialIndexes(this.editor)
    }
}

export { EditEllipseCommand }
