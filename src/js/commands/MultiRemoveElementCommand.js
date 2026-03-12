import { Command } from '../Command'

class MultiRemoveElementCommand extends Command {
    constructor(editor, elements) {
        super(editor)
        this.type = 'MultiRemoveElementCommand'
        this.name = 'Remove Elements'
        this.elements = elements
        this.parents = elements.map(element => (element && element.node) ? element.node.parentNode : undefined)
    }

    execute() {
        this.elements.forEach(element => {
            this.editor.removeElement(element)
        })
    }

    undo() {
        this.elements.forEach((element, index) => {
            this.editor.addElement(element, this.parents[index])
        })
    }
}

export { MultiRemoveElementCommand }
