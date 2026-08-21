import { Command } from '../Command'

function childIndex(element) {
  const parent = element.parent()
  return parent ? Array.from(parent.node.children).indexOf(element.node) : -1
}

function insertAt(parent, element, index) {
  const reference = index >= 0 ? parent.node.children[index] || null : null
  parent.node.insertBefore(element.node, reference)
}

function restorePlacements(placements) {
  const byParent = new Map()
  placements.forEach((placement) => {
    if (!byParent.has(placement.parent)) byParent.set(placement.parent, [])
    byParent.get(placement.parent).push(placement)
  })
  byParent.forEach((entries) => {
    entries
      .sort((left, right) => left.index - right.index)
      .forEach(({ element, index, parent }) => insertAt(parent, element, index))
  })
}

function combinedError(error, rollbackErrors, message) {
  if (rollbackErrors.length === 0) return error
  return new AggregateError([error, ...rollbackErrors], message)
}

function restoreGroupedState(command) {
  const errors = []
  try {
    insertAt(command.parent, command.group, command.groupIndex)
  } catch (error) {
    errors.push(error)
  }
  command.orderedElements.forEach((element) => {
    try {
      command.group.add(element)
    } catch (error) {
      errors.push(error)
    }
  })
  return errors
}

class GroupCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'GroupCommand'
    this.name = 'Group'
    this.selected = [...editor.selected]
    this.selectionBefore = [...editor.selected]
    this.parent = this.selected[0]?.parent() || null
    this.hasMixedParents = this.selected.some((element) => (
      element.parent()?.node !== this.parent?.node
    ))
    this.placements = this.selected.map((element) => ({
      element,
      index: childIndex(element),
      parent: element.parent(),
    }))
    this.orderedElements = [...this.placements]
      .sort((left, right) => left.index - right.index)
      .map(({ element }) => element)
    this.group = null
    this.groupIndex = -1
  }

  get isValid() {
    return this.selected.length > 0 && Boolean(this.parent) && !this.hasMixedParents
  }

  reportInvalid() {
    this.editor.signals.terminalLogged.dispatch({
      msg: this.hasMixedParents
        ? 'Selected elements must share the same parent before they can be grouped.'
        : 'No elements selected to group.',
    })
  }

  execute() {
    if (!this.isValid) throw new TypeError('Group requires at least one selected element.')

    const startingElementIndex = this.editor.elementIndex
    const firstApply = !this.group
    const parentChildrenBefore = new Set(Array.from(this.parent.node.children))
    try {
      if (firstApply) {
        const id = this.editor.elementIndex++
        this.group = this.parent.group().attr({
          id,
          name: `Group ${id}`,
          'data-group': 'true',
        })
        this.groupIndex = Math.min(...this.placements.map(({ index }) => index))
        insertAt(this.parent, this.group, this.groupIndex)
      } else {
        insertAt(this.parent, this.group, this.groupIndex)
      }

      this.orderedElements.forEach((element) => this.group.add(element))
    } catch (error) {
      this.group?.remove()
      Array.from(this.parent.node.children).forEach((node) => {
        if (!parentChildrenBefore.has(node)) node.remove()
      })
      restorePlacements(this.placements)
      if (firstApply) {
        this.group = null
        this.groupIndex = -1
        this.editor.elementIndex = startingElementIndex
      }
      throw error
    }

    this._notify([this.group], `Created ${this.group.attr('name')} with ${this.selected.length} elements.`)
  }

  undo() {
    try {
      this.group.remove()
      restorePlacements(this.placements)
    } catch (error) {
      const rollbackErrors = restoreGroupedState(this)
      throw combinedError(
        error,
        rollbackErrors,
        `${error.message} Restoring the grouped state also failed.`,
      )
    }
    this._notify(this.selectionBefore, `Undo: ${this.group.attr('name')} removed.`)
  }

  redo() {
    try {
      insertAt(this.parent, this.group, this.groupIndex)
      this.orderedElements.forEach((element) => this.group.add(element))
    } catch (error) {
      this.group.remove()
      restorePlacements(this.placements)
      throw error
    }
    this._notify([this.group], `Redo: ${this.group.attr('name')} restored.`)
  }

  _notify(selection, message) {
    this.editor.spatialIndex.markDirty()
    this.editor.fullSpatialIndex.markDirty()
    this.dispatchSignal('clearSelection')
    this.editor.selected = [...selection]
    this.dispatchSignal('updatedSelection')
    this.dispatchSignal('updatedOutliner')
    this.dispatchSignal('terminalLogged', { msg: message })
  }
}

function groupCommand(editor) {
  const command = new GroupCommand(editor)
  if (!command.isValid) {
    command.reportInvalid()
    return null
  }
  return editor.execute(command)
}

export { GroupCommand, groupCommand }
