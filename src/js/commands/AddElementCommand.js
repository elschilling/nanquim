import { Command } from './Command.js'

class AddElementCommand extends Command {
  constructor(editor, element) {
    super(editor)

    this.type = 'AddElementCommand'

    this.element = element
    if (element !== undefined) {
      this.name = `Add Element: ${element.name}`
    }
    // console.log('construct add', element)
    this.parent = element.node.parentNode
  }

  execute() {
    this.editor.addElement(this.element, this.parent)
    // this.editor.select( this.element );
  }

  undo() {
    this.editor.removeElement(this.element)
    // this.editor.deselect();
  }
}

export { AddElementCommand }
