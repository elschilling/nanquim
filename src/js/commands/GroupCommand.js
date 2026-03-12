import { Command } from '../Command'

class GroupCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'GroupCommand'
        this.name = 'Group'
        this.selected = [...editor.selected]
    }

    execute() {
        if (this.selected.length === 0) {
            this.editor.signals.terminalLogged.dispatch({ msg: 'No elements selected to group.' })
            return
        }

        // Use the parent of the first selected element (should be a collection group)
        let parent = this.selected[0].parent()
        if (parent.attr('data-collection') !== 'true') {
            while (parent && parent.attr('data-collection') !== 'true' && parent.type === 'g') {
                parent = parent.parent()
            }
            if (!parent || parent.attr('data-collection') !== 'true') {
                parent = this.editor.activeCollection
            }
        }

        const id = this.editor.elementIndex++
        const group = parent.group()
            .attr({
                'id': id,
                'name': 'Group ' + id,
                'data-group': 'true'
            })

        this.selected.forEach(el => {
            group.add(el)
        })

        // Select the new group instead of the individual elements
        this.editor.signals.clearSelection.dispatch()
        this.editor.selected = [group]

        this.editor.signals.updatedSelection.dispatch()
        this.editor.signals.updatedOutliner.dispatch()
        this.editor.signals.terminalLogged.dispatch({ msg: 'Created ' + group.attr('name') + ' with ' + this.selected.length + ' elements.' })
    }
}

function groupCommand(editor) {
    editor.execute(new GroupCommand(editor))
}

export { GroupCommand, groupCommand }
