import { Command } from '../Command'

function childIndex(element) {
  const parent = element.parent()
  return parent ? Array.from(parent.node.children).indexOf(element.node) : -1
}

function insertAt(parent, element, index) {
  const reference = index >= 0 ? parent.node.children[index] || null : null
  parent.node.insertBefore(element.node, reference)
}

function restoreGroups(records) {
  records.forEach(({ children, group }) => {
    children.forEach((child) => group.add(child))
  })

  const byParent = new Map()
  records.forEach((record) => {
    if (!byParent.has(record.parent)) byParent.set(record.parent, [])
    byParent.get(record.parent).push(record)
  })
  byParent.forEach((entries) => {
    entries
      .sort((left, right) => left.index - right.index)
      .forEach(({ group, index, parent }) => insertAt(parent, group, index))
  })
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

const GROUP_PRESENTATION_ATTRIBUTES = [
  'clip-path',
  'color',
  'display',
  'fill',
  'fill-opacity',
  'filter',
  'mask',
  'opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-width',
  'visibility',
]

const TRANSIENT_GROUP_CLASSES = new Set([
  'elementHover',
  'elementSelected',
  'selected',
])

function hasUnsupportedGroupPresentation(group) {
  let transform
  try {
    transform = group.matrixify()
  } catch (error) {
    return true
  }
  const hasTransform = !(
    Math.abs(transform.a - 1) < 1e-12
    && Math.abs(transform.b) < 1e-12
    && Math.abs(transform.c) < 1e-12
    && Math.abs(transform.d - 1) < 1e-12
    && Math.abs(transform.e) < 1e-12
    && Math.abs(transform.f) < 1e-12
  )
  const presentationClasses = Array.from(group.node.classList || [])
    .filter((className) => !TRANSIENT_GROUP_CLASSES.has(className))
  if (hasTransform || group.node.style.length > 0 || presentationClasses.length > 0) return true
  return GROUP_PRESENTATION_ATTRIBUTES.some((attribute) => group.node.hasAttribute(attribute))
}

class UngroupCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'UngroupCommand'
    this.name = 'Ungroup'
    this.selectionBefore = [...editor.selected]
    this.proceduralGroups = editor.selected.filter((element) => (
      element.attr && element.attr('data-geometry-nodes') === 'true'
    ))
    this.ordinaryGroups = editor.selected.filter((element) => (
      element.type === 'g'
      && element.attr('data-group') === 'true'
      && element.attr('data-geometry-nodes') !== 'true'
    ))
    this.unsupportedGroups = this.ordinaryGroups.filter(hasUnsupportedGroupPresentation)
    this.selectedGroups = this.unsupportedGroups.length > 0 ? [] : this.ordinaryGroups
    this.records = this.selectedGroups.map((group) => ({
      children: Array.from(group.children()),
      group,
      index: childIndex(group),
      parent: group.parent(),
    }))
    this.extracted = this.records.flatMap(({ children }) => children)
    this.extractedPlacements = []
  }

  get isValid() {
    return this.records.length > 0
  }

  reportInvalid() {
    if (this.unsupportedGroups.length > 0) {
      this.editor.signals.terminalLogged.dispatch({
        msg: 'Transformed or styled groups cannot be ungrouped without flattening their appearance.',
      })
    } else if (this.proceduralGroups.length > 0) {
      this.editor.signals.terminalLogged.dispatch({
        msg: 'Apply Geometry Nodes before ungrouping a procedural object.',
      })
    } else {
      this.editor.signals.terminalLogged.dispatch({ msg: 'No groups selected to ungroup.' })
    }
  }

  execute() {
    if (!this.isValid) throw new TypeError('Ungroup requires at least one ordinary group.')
    if (this.proceduralGroups.length > 0) {
      this.editor.signals.terminalLogged.dispatch({
        msg: 'Apply Geometry Nodes before ungrouping a procedural object.',
      })
    }

    try {
      this.records.forEach(({ children, group, parent }) => {
        children.forEach((child) => parent.node.insertBefore(child.node, group.node))
        group.remove()
      })
    } catch (error) {
      restoreGroups(this.records)
      throw error
    }
    this.extractedPlacements = this.extracted.map((element) => ({
      element,
      index: childIndex(element),
      parent: element.parent(),
    }))
    this._notify(this.extracted, `Ungrouped ${this.records.length} group(s).`)
  }

  undo() {
    try {
      restoreGroups(this.records)
    } catch (error) {
      const rollbackErrors = []
      this.records.forEach(({ group }) => {
        try {
          group.remove()
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      })
      try {
        restorePlacements(this.extractedPlacements)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      throw combinedError(
        error,
        rollbackErrors,
        `${error.message} Restoring the ungrouped state also failed.`,
      )
    }
    this._notify(this.selectionBefore, `Undo: restored ${this.records.length} group(s).`)
  }

  redo() {
    try {
      this.records.forEach(({ children, group, parent }) => {
        children.forEach((child) => parent.node.insertBefore(child.node, group.node))
        group.remove()
      })
    } catch (error) {
      restoreGroups(this.records)
      throw error
    }
    this._notify(this.extracted, `Redo: ungrouped ${this.records.length} group(s).`)
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

function ungroupCommand(editor) {
  const command = new UngroupCommand(editor)
  if (!command.isValid) {
    command.reportInvalid()
    return null
  }
  return editor.execute(command)
}

export { UngroupCommand, ungroupCommand }
