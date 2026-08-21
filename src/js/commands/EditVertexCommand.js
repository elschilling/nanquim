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
            this.element.plot(this.newX, this.newY, Number(this.element.attr('x2')), Number(this.element.attr('y2')))
        } else {
            this.element.plot(Number(this.element.attr('x1')), Number(this.element.attr('y1')), this.newX, this.newY)
        }
        this.invalidateGeometry()
    }

    undo() {
        // Restore the original vertex position
        if (this.vertexIndex === 0) {
            this.element.plot(this.oldX, this.oldY, Number(this.element.attr('x2')), Number(this.element.attr('y2')))
        } else {
            this.element.plot(Number(this.element.attr('x1')), Number(this.element.attr('y1')), this.oldX, this.oldY)
        }
        this.invalidateGeometry()
    }

    invalidateGeometry() {
        this.editor.spatialIndex?.markDirty()
        this.editor.fullSpatialIndex?.markDirty()
        this.dispatchSignal('updatedOutliner')
    }
}

export { EditVertexCommand }
