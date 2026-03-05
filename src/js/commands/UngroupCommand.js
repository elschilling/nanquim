import { Command } from '../Command'

class UngroupCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'UngroupCommand'
        this.name = 'Ungroup'
        // Only keep selected elements that are groups
        this.selectedGroups = editor.selected.filter(el => el.type === 'g' && el.attr('data-group') === 'true')
    }

    execute() {
        if (this.selectedGroups.length === 0) {
            this.editor.signals.terminalLogged.dispatch({ msg: 'No groups selected to ungroup.' })
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
