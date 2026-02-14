
import { Command } from '../Command.js'

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
        this.element.center(this.newValues.cx, this.newValues.cy)
        this.element.radius(this.newValues.r)
    }

    undo() {
        this.element.center(this.oldValues.cx, this.oldValues.cy)
        this.element.radius(this.oldValues.r)
    }
}

export { EditCircleCommand }
