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

class TrimEllipseCommand extends Command {
  constructor(editor, element, action) {
    super(editor)
    this.type = 'TrimEllipseCommand'
    this.name = 'Trim Ellipse'
    this.element = element
    this.action = action
    this.parent = element.parent() || this.editor.activeCollection
    this.sourcePlacement = {
      index: getChildIndex(this.parent, element),
      nextSibling: element.node.nextSibling,
    }
    this.arcPaths = []
    this.hasExecutedBefore = false
  }

  copyStyles(source, target) {
    const copyDOMStyles = (src, dest) => {
      ;['stroke', 'stroke-width', 'opacity', 'stroke-dasharray', 'stroke-linecap'].forEach(prop => {
        const attrVal = src.getAttribute(prop)
        if (attrVal !== null) dest.setAttribute(prop, attrVal)

        const styleVal = src.style[prop]
        if (styleVal) dest.style[prop] = styleVal
      })
      const overrides = src.getAttribute('data-style-overrides')
      if (overrides) dest.setAttribute('data-style-overrides', overrides)
    }

    copyDOMStyles(source.node, target.node)
    target.attr('fill', 'none')
  }

  execute() {
    if (this.hasExecutedBefore) {
      this._replaceSourceWith(this.arcPaths)
      this._notifyMutation()
      return
    }

    const startingElementIndex = this.editor.elementIndex
    const childrenBefore = new Set(this.parent.node.children)
    const replacements = []

    try {
      if (this.action.type !== 'remove') {
        if (!Array.isArray(this.action.arcs)) {
          throw new TypeError('Trim ellipse action must include an arcs array')
        }

        this.action.arcs.forEach((arc) => {
          const replacement = this._createArc(arc)
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
      this.arcPaths = []
      this.hasExecutedBefore = false
      throw error
    }

    this.arcPaths = replacements
    this.hasExecutedBefore = true
    this._notifyMutation()
  }

  undo() {
    this._restoreSource(this.arcPaths)
    this._notifyMutation()
  }

  redo() {
    this._replaceSourceWith(this.arcPaths)
    this._notifyMutation()
  }

  _createArc(arc) {
    const { rx, ry, theta1, theta2, startPt, endPt } = arc
    const ccw = arc.ccw !== false
    const diff = ccw
      ? (theta2 - theta1 + 2 * Math.PI) % (2 * Math.PI)
      : (theta1 - theta2 + 2 * Math.PI) % (2 * Math.PI)
    const largeArcFlag = diff > Math.PI ? 1 : 0
    const sweepFlag = ccw ? 1 : 0
    const d = `M ${startPt.x} ${startPt.y} A ${rx} ${ry} 0 ${largeArcFlag} ${sweepFlag} ${endPt.x} ${endPt.y}`
    const newArc = this.parent.path(d)

    newArc.data('ellipseArcData', arc)
    newArc.attr('id', this.editor.elementIndex++)
    newArc.attr('name', 'EllipseArc')
    this.copyStyles(this.element, newArc)
    return newArc
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

export { TrimEllipseCommand }
