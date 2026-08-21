
import { Command } from '../Command.js'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes.js'

function snapshotNode(node) {
    return {
        attributes: Array.from(node.attributes, attribute => ({
            name: attribute.name,
            namespaceURI: attribute.namespaceURI,
            value: attribute.value,
        })),
        children: Array.from(node.childNodes, child => child.cloneNode(true)),
    }
}

function restoreNode(node, snapshot) {
    Array.from(node.attributes).forEach(attribute => node.removeAttributeNode(attribute))
    snapshot.attributes.forEach(({ name, namespaceURI, value }) => {
        if (namespaceURI) node.setAttributeNS(namespaceURI, name, value)
        else node.setAttribute(name, value)
    })
    node.replaceChildren(...snapshot.children.map(child => child.cloneNode(true)))
}

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
        this._apply(this.newValues)
    }

    undo() {
        this._apply(this.oldValues)
    }

    _apply(values) {
        const next = {
            h: Number(values.height),
            w: Number(values.width),
            x: Number(values.x),
            y: Number(values.y),
        }
        if (
            !Number.isFinite(next.x)
            || !Number.isFinite(next.y)
            || !Number.isFinite(next.w)
            || !Number.isFinite(next.h)
            || next.w <= 0
            || next.h <= 0
        ) {
            throw new TypeError('Viewport geometry must use finite coordinates and positive dimensions.')
        }

        const previous = {
            h: this.viewport.h,
            w: this.viewport.w,
            x: this.viewport.x,
            y: this.viewport.y,
        }
        const visualSnapshot = [
            this.viewport._clipRect?.node,
            this.viewport._frame?.node,
            this.viewport._label?.node,
            this.viewport._useEl?.node,
        ]
            .filter(Boolean)
            .map(node => ({ node, snapshot: snapshotNode(node) }))
        Object.assign(this.viewport, next)
        try {
            this.viewport.refreshGeometry()
        } catch (error) {
            Object.assign(this.viewport, previous)
            const rollbackErrors = []
            try {
                visualSnapshot.forEach(({ node, snapshot }) => restoreNode(node, snapshot))
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError)
            }
            if (rollbackErrors.length > 0) {
                throw new AggregateError(
                    [error, ...rollbackErrors],
                    `${error.message} Restoring the previous viewport geometry also failed.`,
                )
            }
            throw error
        }
        invalidateSpatialIndexes(this.editor)
        this.dispatchSignal('paperViewportsChanged')
    }
}

export { EditViewportCommand }
