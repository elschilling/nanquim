import { Command } from '../Command'
import { applyCollectionStyleToElement } from '../Collection'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes'
import { LinearDimensionCommand } from './LinearDimensionCommand'

function cloneDimensionData(data) {
    return JSON.parse(JSON.stringify(data))
}

function captureElementSnapshot(element) {
    const node = element.node
    return {
        attributes: Array.from(node.attributes, attribute => ({
            name: attribute.name,
            namespaceURI: attribute.namespaceURI,
            value: attribute.value,
        })),
        children: Array.from(node.childNodes, child => child.cloneNode(true)),
    }
}

function restoreElementSnapshot(element, snapshot) {
    const node = element.node
    Array.from(node.attributes).forEach(attribute => node.removeAttributeNode(attribute))
    snapshot.attributes.forEach(attribute => {
        if (attribute.namespaceURI) {
            node.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value)
        } else {
            node.setAttribute(attribute.name, attribute.value)
        }
    })
    node.replaceChildren(...snapshot.children.map(child => child.cloneNode(true)))
}

export class EditDimensionCommand extends Command {
    constructor(editor, dimensionUpdates, { notifySelection = true } = {}) {
        super(editor)
        this.type = 'EditDimensionCommand'
        this.name = 'Edit Dimension'
        this.notifySelection = notifySelection
        this.updates = dimensionUpdates.map(update => ({
            element: update.element,
            oldData: cloneDimensionData(update.oldData),
            newData: cloneDimensionData(update.newData),
        }))
    }

    execute() {
        this.applyUpdates(this.updates, false)
    }

    undo() {
        this.applyUpdates(this.updates, true)
    }

    applyUpdates(updates, isUndo) {
        const snapshots = updates.map(update => ({
            element: update.element,
            snapshot: captureElementSnapshot(update.element),
        }))

        try {
            updates.forEach(update => {
                const data = isUndo ? update.oldData : update.newData
                update.element.attr('data-dim-data', JSON.stringify(data))

                const styleId = data.styleId || 'Standard'
                const style = this.editor.dimensionManager.getStyle(styleId)
                const tempStyle = cloneDimensionData(style)
                if (data.textPosition) {
                    tempStyle.textPosition = data.textPosition
                }

                LinearDimensionCommand.renderDimensionGraphics(
                    update.element,
                    data.p1, data.p2, data.p3,
                    tempStyle,
                    1,
                    false,
                    data.dimType || 'linear',
                    this.editor
                )
                applyCollectionStyleToElement(this.editor, update.element)
            })
        } catch (error) {
            snapshots.forEach(({ element, snapshot }) => restoreElementSnapshot(element, snapshot))
            throw error
        }

        invalidateSpatialIndexes(this.editor)
        this.editor.signals.updatedOutliner.dispatch()
        if (this.notifySelection) this.editor.signals.updatedSelection.dispatch()
    }
}
