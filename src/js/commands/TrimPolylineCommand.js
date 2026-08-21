import { Command } from '../Command'

function getChildIndex(parent, element) {
  return Array.from(parent.node.children).indexOf(element.node)
}

function getPlacementReference(parent, placement) {
  if (placement.nextSibling?.parentNode === parent.node) {
    return placement.nextSibling
  }
  return parent.node.children[placement.index] || null
}

function insertAtPlacement(parent, element, placement) {
  parent.node.insertBefore(element.node, getPlacementReference(parent, placement))
}

function insertManyAtPlacement(parent, elements, placement) {
  const reference = getPlacementReference(parent, placement)
  elements.forEach((element) => parent.node.insertBefore(element.node, reference))
}

function removeIfAttached(element) {
  if (element?.node?.parentNode) element.remove()
}

class TrimPolylineCommand extends Command {
  constructor(editor, element, action) {
    super(editor)
    this.type = 'TrimPolylineCommand'
    this.name = 'Trim Polyline'
    this.element = element
    this.action = action
    this.parent = element.parent() || this.editor.activeCollection
    this.sourcePlacement = {
      index: getChildIndex(this.parent, element),
      nextSibling: element.node.nextSibling,
    }
    this.newPolylines = []
    this.hasExecutedBefore = false
  }

  copyStyles(source, target) {
    ;['stroke', 'stroke-width', 'opacity', 'stroke-dasharray', 'stroke-linecap'].forEach(prop => {
      const attrVal = source.node.getAttribute(prop)
      if (attrVal !== null) target.node.setAttribute(prop, attrVal)
      const styleVal = source.node.style[prop]
      if (styleVal) target.node.style[prop] = styleVal
    })
    const overrides = source.node.getAttribute('data-style-overrides')
    if (overrides) target.node.setAttribute('data-style-overrides', overrides)
    target.attr('fill', 'none')
  }

  execute() {
    if (this.hasExecutedBefore) {
      this._replaceSourceWith(this.newPolylines)
      this._notifyMutation()
      return
    }

    const startingElementIndex = this.editor.elementIndex
    const childrenBefore = new Set(this.parent.node.children)
    const replacements = []

    try {
      if (this.action.type !== 'remove') {
        if (!Array.isArray(this.action.resultPolylines)) {
          throw new TypeError('Trim polyline action must include a resultPolylines array')
        }

        this.action.resultPolylines.forEach((points) => {
          if (points.length < 2) return
          const replacement = this._createPolyline(points)
          replacements.push(replacement)
          replacement.remove()
        })
      }

      this._replaceSourceWith(replacements)
    } catch (error) {
      replacements.forEach(removeIfAttached)
      Array.from(this.parent.node.children).forEach((node) => {
        if (!childrenBefore.has(node)) node.remove()
      })
      if (this.element.node.parentNode !== this.parent.node) {
        insertAtPlacement(this.parent, this.element, this.sourcePlacement)
      }
      this.editor.elementIndex = startingElementIndex
      this.newPolylines = []
      this.hasExecutedBefore = false
      throw error
    }

    this.newPolylines = replacements
    this.hasExecutedBefore = true
    this._notifyMutation()
  }

  undo() {
    this._restoreSource(this.newPolylines)
    this._notifyMutation()
  }

  redo() {
    this._replaceSourceWith(this.newPolylines)
    this._notifyMutation()
  }

  _createPolyline(points) {
    const newPolyline = this.parent.polyline(points).fill('none')
    this.copyStyles(this.element, newPolyline)
    newPolyline.attr('id', this.editor.elementIndex++)
    newPolyline.attr('name', 'Polyline')
    return newPolyline
  }

  _replaceSourceWith(replacements) {
    const currentPlacement = {
      index: getChildIndex(this.parent, this.element),
      nextSibling: this.element.node.nextSibling,
    }

    try {
      removeIfAttached(this.element)
      insertManyAtPlacement(this.parent, replacements, this.sourcePlacement)
    } catch (error) {
      replacements.forEach(removeIfAttached)
      if (this.element.node.parentNode !== this.parent.node) {
        insertAtPlacement(this.parent, this.element, currentPlacement)
      }
      throw error
    }
  }

  _restoreSource(replacements) {
    const replacementPlacements = replacements.map((replacement) => ({
      element: replacement,
      index: getChildIndex(this.parent, replacement),
      nextSibling: replacement.node.nextSibling,
    }))

    try {
      replacements.forEach(removeIfAttached)
      insertAtPlacement(this.parent, this.element, this.sourcePlacement)
    } catch (error) {
      removeIfAttached(this.element)
      replacementPlacements
        .sort((left, right) => left.index - right.index)
        .forEach(({ element, ...placement }) => {
          insertAtPlacement(this.parent, element, placement)
        })
      throw error
    }
  }

  _notifyMutation() {
    this.editor.spatialIndex?.markDirty()
    this.editor.fullSpatialIndex?.markDirty()
    this.dispatchSignal('updatedOutliner')
  }
}

export { TrimPolylineCommand }
