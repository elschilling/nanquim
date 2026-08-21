import { MultiRemoveElementCommand } from './MultiRemoveElementCommand'

class RemoveElementCommand extends MultiRemoveElementCommand {
  constructor(editor, element) {
    super(editor, element ? [element] : [])
    this.type = 'RemoveElementCommand'
    this.name = 'Remove Element'
    this.element = element
    this.parent = this.placements[0]?.parent
  }
}

export { RemoveElementCommand }
