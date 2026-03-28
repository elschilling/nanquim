import { Command } from '../Command.js'

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
        this.element.center(this.newValues.cx, this.newValues.cy)
        this.element.attr({ rx: this.newValues.rx, ry: this.newValues.ry })
    }

    undo() {
        this.element.center(this.oldValues.cx, this.oldValues.cy)
        this.element.attr({ rx: this.oldValues.rx, ry: this.oldValues.ry })
    }
}

export { EditEllipseCommand }
