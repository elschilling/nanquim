import { Command } from '../Command.js'

class EditVertexCommand extends Command {
    constructor(editor, element, vertexIndex, oldX, oldY, newX, newY) {
        super(editor)

        this.type = 'EditVertexCommand'
        this.name = 'Edit Vertex'
        this.element = element
        this.vertexIndex = vertexIndex
        this.oldX = oldX
        this.oldY = oldY
        this.newX = newX
        this.newY = newY
    }

    execute() {
        // Update the vertex position
        if (this.vertexIndex === 0) {
            this.element.plot(this.newX, this.newY, this.element.node.x2.baseVal.value, this.element.node.y2.baseVal.value)
        } else {
            this.element.plot(this.element.node.x1.baseVal.value, this.element.node.y1.baseVal.value, this.newX, this.newY)
        }
    }

    undo() {
        // Restore the original vertex position
        if (this.vertexIndex === 0) {
            this.element.plot(this.oldX, this.oldY, this.element.node.x2.baseVal.value, this.element.node.y2.baseVal.value)
        } else {
            this.element.plot(this.element.node.x1.baseVal.value, this.element.node.y1.baseVal.value, this.oldX, this.oldY)
        }
    }
}

export { EditVertexCommand }
