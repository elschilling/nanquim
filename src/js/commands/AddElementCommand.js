import { Command } from '../Command.js'

class AddElementCommand extends Command {
  constructor(editor, element, parent = element?.node?.parentNode) {
    super(editor)

    this.type = 'AddElementCommand'

    this.element = element
    if (element !== undefined) {
      this.name = `Add Element: ${element.name}`
      // Interactive drawing tools create their preview in the live SVG before
      // the completed mutation enters History. Mark that node as transient so
      // DocumentState does not count preview construction as a separate edit.
      // execute() removes the marker inside History's tracking suppression.
      element.attr('data-nanquim-transient', 'true')
    }
    this.parent = parent
  }

  execute() {
    const previousParent = this.element.node.parentNode
    const previousNextSibling = this.element.node.nextSibling
    const previousTransient = this.element.attr('data-nanquim-transient')
    const previousId = this.element.attr('id')
    const initialElementIndex = this.editor.elementIndex
    const needsId = previousId == null || previousId === ''
    try {
      if (needsId) this.element.attr('id', this.editor.elementIndex++)
      this.element.attr('data-nanquim-transient', null)
      this.editor.addElement(this.element, this.parent)
    } catch (error) {
      if (previousParent) {
        const reference = previousNextSibling?.parentNode === previousParent
          ? previousNextSibling
          : null
        previousParent.insertBefore(this.element.node, reference)
      } else {
        this.element.remove()
      }
      this.element.attr('data-nanquim-transient', previousTransient ?? null)
      if (needsId) {
        this.element.attr('id', null)
        this.editor.elementIndex = initialElementIndex
      }
      this.editor.spatialIndex?.markDirty()
      this.editor.fullSpatialIndex?.markDirty()
      throw error
    }
    // this.editor.select( this.element );
  }

  undo() {
    const node = this.element.node
    const parent = node.parentNode
    const index = parent ? Array.from(parent.childNodes).indexOf(node) : -1
    const selectionBefore = Array.isArray(this.editor.selected)
      ? [...this.editor.selected]
      : []
    try {
      this.editor.removeElement(this.element)
    } catch (error) {
      const rollbackErrors = []
      if (parent && node.parentNode !== parent) {
        try {
          const reference = index >= 0 ? parent.childNodes[index] || null : null
          parent.insertBefore(node, reference)
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      this.editor.selected = selectionBefore
      this.editor.spatialIndex?.markDirty()
      this.editor.fullSpatialIndex?.markDirty()
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          `${error.message} Restoring the created element also failed.`,
        )
      }
      throw error
    }
    // this.editor.deselect();
  }
}

export { AddElementCommand }
