import { Command } from '../Command'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes'

function nodeIndex(node) {
  const parent = node?.parentNode
  return parent ? Array.from(parent.childNodes).indexOf(node) : -1
}

function selectedRoots(elements) {
  const byNode = new Map()
  elements.forEach((element) => {
    if (element?.node && !byNode.has(element.node)) byNode.set(element.node, element)
  })

  const selectedNodes = new Set(byNode.keys())
  return [...byNode.entries()]
    .filter(([node]) => {
      let ancestor = node.parentNode
      while (ancestor) {
        if (selectedNodes.has(ancestor)) return false
        ancestor = ancestor.parentNode
      }
      return true
    })
    .map(([, element]) => element)
}

function groupByParent(placements) {
  const groups = new Map()
  placements.forEach((placement) => {
    if (!groups.has(placement.parent)) groups.set(placement.parent, [])
    groups.get(placement.parent).push(placement)
  })
  return groups
}

function removalOrder(placements) {
  return [...groupByParent(placements).values()]
    .flatMap((entries) => entries.sort((left, right) => right.index - left.index))
}

function restorationOrder(placements) {
  return [...groupByParent(placements).values()]
    .flatMap((entries) => entries.sort((left, right) => left.index - right.index))
}

function insertAt(placement) {
  const { index, node, parent } = placement
  const reference = parent.childNodes[index] || null
  parent.insertBefore(node, reference)
}

function combinedError(error, rollbackErrors, message) {
  if (rollbackErrors.length === 0) return error
  return new AggregateError([error, ...rollbackErrors], message)
}

class MultiRemoveElementCommand extends Command {
  constructor(editor, elements = []) {
    super(editor)
    this.type = 'MultiRemoveElementCommand'
    this.name = 'Remove Elements'
    this.selectionBefore = Array.isArray(editor.selected) ? [...editor.selected] : []
    this.requestedElements = Array.isArray(elements) ? [...elements] : []
    this.hasPaperViewport = this.requestedElements.some((element) => element?._paperVp)
    this.hasUnsupportedElement = this.requestedElements.some((element) => (
      !element?._paperVp && (!element?.node || element.node.nodeType !== 1)
    ))
    this.elements = selectedRoots(this.requestedElements)
    this.placements = this.elements.map((element) => ({
      element,
      index: nodeIndex(element.node),
      node: element.node,
      parent: element.node.parentNode,
    }))
    this.hasDetachedElement = this.placements.some(({ index, parent }) => !parent || index < 0)
  }

  get isValid() {
    return this.requestedElements.length > 0
      && this.elements.length > 0
      && !this.hasPaperViewport
      && !this.hasUnsupportedElement
      && !this.hasDetachedElement
  }

  get validationMessage() {
    if (this.hasPaperViewport) {
      return 'Paper viewports cannot be erased with Delete. Use the Paper Space viewport controls.'
    }
    if (this.hasUnsupportedElement || this.hasDetachedElement) {
      return 'The selection contains an unsupported or detached item and was not erased.'
    }
    return 'No elements selected to erase.'
  }

  reportInvalid() {
    this.editor.signals.terminalLogged.dispatch({ msg: this.validationMessage })
  }

  execute() {
    this._remove()
  }

  redo() {
    this._remove()
  }

  undo() {
    this._requireValid()
    this._assertAllDetached()

    try {
      restorationOrder(this.placements).forEach(insertAt)
    } catch (error) {
      const rollbackErrors = this._removeAnyAttached()
      throw combinedError(
        error,
        rollbackErrors,
        `${error.message} Restoring the deleted state also failed.`,
      )
    }

    this._notify(this.selectionBefore)
  }

  _remove() {
    this._requireValid()
    this._assertAllPresent()

    try {
      removalOrder(this.placements).forEach(({ node, parent }) => {
        parent.removeChild(node)
      })
    } catch (error) {
      const rollbackErrors = this._restoreAnyMissing()
      throw combinedError(
        error,
        rollbackErrors,
        `${error.message} Restoring the original drawing also failed.`,
      )
    }

    this._notify([])
  }

  _requireValid() {
    if (!this.isValid) throw new TypeError(this.validationMessage)
  }

  _assertAllPresent() {
    if (this.placements.some(({ node, parent }) => node.parentNode !== parent)) {
      throw new Error('The selected elements changed parent before they could be erased.')
    }
  }

  _assertAllDetached() {
    if (this.placements.some(({ node }) => node.parentNode)) {
      throw new Error('The erased elements must be detached before Undo can restore them.')
    }
  }

  _restoreAnyMissing() {
    const errors = []
    restorationOrder(this.placements).forEach((placement) => {
      if (placement.node.parentNode === placement.parent) return
      try {
        if (placement.node.parentNode) {
          placement.node.parentNode.removeChild(placement.node)
        }
        insertAt(placement)
      } catch (error) {
        errors.push(error)
      }
    })
    return errors
  }

  _removeAnyAttached() {
    const errors = []
    removalOrder(this.placements).forEach(({ node }) => {
      if (!node.parentNode) return
      try {
        node.parentNode.removeChild(node)
      } catch (error) {
        errors.push(error)
      }
    })
    return errors
  }

  _notify(selection) {
    invalidateSpatialIndexes(this.editor)
    this.dispatchSignal('clearSelection')
    this.editor.selected = [...selection]
    this.dispatchSignal('updatedSelection')
    this.dispatchSignal('updatedOutliner')
  }
}

export { MultiRemoveElementCommand }
