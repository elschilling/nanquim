import { Command } from '../Command'

export class EditDimensionCommand extends Command {
    constructor(editor, dimensionUpdates) {
        super(editor)
        this.type = 'EditDimensionCommand'
        this.name = 'Edit Dimension'
        this.updates = dimensionUpdates // Array of { element, oldData, newData }
    }

    execute() {
        this.applyUpdates(this.updates, false)
    }

    undo() {
        this.applyUpdates(this.updates, true)
    }

    applyUpdates(updates, isUndo) {
        updates.forEach(update => {
            const data = isUndo ? update.oldData : update.newData
            update.element.attr('data-dim-data', JSON.stringify(data))
            
            const styleId = data.styleId || 'Standard'
            const style = this.editor.dimensionManager.getStyle(styleId)
            
            const tempStyle = JSON.parse(JSON.stringify(style))
            if (data.textPosition) {
                tempStyle.textPosition = data.textPosition
            }

            // Redraw using the command's static method
            import('./LinearDimensionCommand.js').then(({ LinearDimensionCommand }) => {
                LinearDimensionCommand.renderDimensionGraphics(
                    update.element,
                    data.p1, data.p2, data.p3,
                    tempStyle,
                    1,
                    false
                )
                import('../Collection.js').then(({ applyCollectionStyleToElement }) => {
                    applyCollectionStyleToElement(this.editor, update.element)
                })
            })
        })
        
        this.editor.signals.updatedOutliner.dispatch()
        this.editor.signals.updatedSelection.dispatch()
    }
}
