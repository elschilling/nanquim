import { Command } from '../Command'

class UngroupCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'UngroupCommand'
        this.name = 'Ungroup'
        // A Geometry Nodes wrapper owns a hidden canonical source and a derived
        // cache. Generic ungrouping would expose both and duplicate the drawing;
        // users must Apply the modifier first.
        this.proceduralGroups = editor.selected.filter(el => el.attr && el.attr('data-geometry-nodes') === 'true')
        this.selectedGroups = editor.selected.filter(el =>
            el.type === 'g' &&
            el.attr('data-group') === 'true' &&
            el.attr('data-geometry-nodes') !== 'true'
        )
    }

    execute() {
        if (this.proceduralGroups.length > 0) {
            this.editor.signals.terminalLogged.dispatch({ msg: 'Apply Geometry Nodes before ungrouping a procedural object.' })
        }
        if (this.selectedGroups.length === 0) {
            if (this.proceduralGroups.length === 0) {
                this.editor.signals.terminalLogged.dispatch({ msg: 'No groups selected to ungroup.' })
            }
            return
        }

        let newSelection = []

        this.selectedGroups.forEach(group => {
            const parent = group.parent()

            // Copy children array first since it mutates during iteration
            const children = [...group.children()]
            children.forEach(child => {
                parent.add(child)
                newSelection.push(child)
            })

            // Remove the empty group wrapper
            group.remove()
        })

        // Select the newly extracted elements
        this.editor.signals.clearSelection.dispatch()
        this.editor.selected = newSelection

        this.editor.signals.updatedSelection.dispatch()
        this.editor.signals.updatedOutliner.dispatch()
        this.editor.signals.terminalLogged.dispatch({ msg: 'Ungrouped ' + this.selectedGroups.length + ' group(s).' })
    }
}

function ungroupCommand(editor) {
    editor.execute(new UngroupCommand(editor))
}

export { UngroupCommand, ungroupCommand }
