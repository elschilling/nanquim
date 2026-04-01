import { Command } from '../Command.js'

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
        this.element.attr({ x: this.newValues.x, y: this.newValues.y })
    }

    undo() {
        this.element.attr({ x: this.oldValues.x, y: this.oldValues.y })
    }
}

export { EditTextPositionCommand }
