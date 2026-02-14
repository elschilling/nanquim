import { Command } from '../Command.js'
import { EditVertexCommand } from './EditVertexCommand.js'

class MultiEditVertexCommand extends Command {
    constructor(editor, vertexUpdates) {
        super(editor)
        this.type = 'MultiEditVertexCommand'
        this.name = 'Multi Edit Vertex'
        this.vertexUpdates = vertexUpdates // Array of { element, vertexIndex, oldX, oldY, newX, newY }
        this.commands = []
    }

    execute() {
        this.commands = this.vertexUpdates.map(update => {
            const cmd = new EditVertexCommand(
                this.editor,
                update.element,
                update.vertexIndex,
                update.oldX,
                update.oldY,
                update.newX,
                update.newY
            )
            cmd.execute()
            return cmd
        })
    }

    undo() {
        // Undo in reverse order
        for (let i = this.commands.length - 1; i >= 0; i--) {
            this.commands[i].undo()
        }
    }
}

export { MultiEditVertexCommand }
