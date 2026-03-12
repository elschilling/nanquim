
import { Command } from '../Command.js'

class EditViewportCommand extends Command {
    constructor(editor, viewport, oldValues, newValues) {
        super(editor)
        this.type = 'EditViewportCommand'
        this.name = 'Edit Viewport'
        this.viewport = viewport
        this.oldValues = oldValues // { x, y, width, height }
        this.newValues = newValues // { x, y, width, height }
    }

    execute() {
        this.viewport.x = this.newValues.x
        this.viewport.y = this.newValues.y
        this.viewport.w = this.newValues.width
        this.viewport.h = this.newValues.height
        this.viewport.refreshGeometry()
        this.editor.signals.paperViewportsChanged.dispatch()
    }

    undo() {
        this.viewport.x = this.oldValues.x
        this.viewport.y = this.oldValues.y
        this.viewport.w = this.oldValues.width
        this.viewport.h = this.oldValues.height
        this.viewport.refreshGeometry()
        this.editor.signals.paperViewportsChanged.dispatch()
    }
}

export { EditViewportCommand }
