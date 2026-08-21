import { Command } from '../Command.js'
import { EditVertexCommand } from './EditVertexCommand.js'

class MultiEditVertexCommand extends Command {
    constructor(editor, vertexUpdates) {
        super(editor)
        this.type = 'MultiEditVertexCommand'
        this.name = 'Multi Edit Vertex'
        this.vertexUpdates = vertexUpdates // Array of { element, vertexIndex, oldX, oldY, newX, newY }
        this.commands = this.vertexUpdates.map(update => new EditVertexCommand(
            this.editor,
            update.element,
            update.vertexIndex,
            update.oldX,
            update.oldY,
            update.newX,
            update.newY
        ))
    }

    execute() {
        const applied = []
        try {
          this.commands.forEach(cmd => {
            try {
              cmd.execute()
              applied.push(cmd)
            } catch (error) {
              cmd.undo()
              throw error
            }
          })
        } catch (error) {
          for (let index = applied.length - 1; index >= 0; index -= 1) {
            applied[index].undo()
          }
          throw error
        }
    }

    undo() {
        // Undo in reverse order
        for (let i = this.commands.length - 1; i >= 0; i--) {
            this.commands[i].undo()
        }
    }
}

export { MultiEditVertexCommand }
