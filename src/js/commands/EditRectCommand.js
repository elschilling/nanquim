
import { Command } from '../Command.js'

class EditRectCommand extends Command {
    constructor(editor, element, oldValues, newValues) {
        super(editor)
        this.type = 'EditRectCommand'
        this.name = 'Edit Rectangle'
        this.element = element
        this.oldValues = oldValues // { x, y, width, height }
        this.newValues = newValues // { x, y, width, height }
    }

    execute() {
        this.element.move(this.newValues.x, this.newValues.y)
        this.element.size(this.newValues.width, this.newValues.height)
    }

    undo() {
        this.element.move(this.oldValues.x, this.oldValues.y)
        this.element.size(this.oldValues.width, this.oldValues.height)
    }
}

export { EditRectCommand }
