import { Command } from '../Command'
import {
  allocateTrimIdentity,
  captureTrimPlacement,
  createAndReplaceTrimSource,
  insertTrimElement,
  notifyTrimMutation,
  prepareTrimClone,
  replaceTrimSource,
  restoreTrimSource,
} from './TrimTransaction'

class TrimLineCommand extends Command {
  constructor(editor, element, action) {
    super(editor)
    this.type = 'TrimLineCommand'
    this.name = 'Trim Line'
    this.element = element
    this.action = action
    this.originalGeometry = this._readGeometry()
    this.oldX1 = this.originalGeometry.x1
    this.oldY1 = this.originalGeometry.y1
    this.oldX2 = this.originalGeometry.x2
    this.oldY2 = this.originalGeometry.y2
    this.parent = element.parent() || this.editor.activeCollection
    this.sourcePlacement = captureTrimPlacement(this.parent, element)
    this.newLinePlacement = {
      index: this.sourcePlacement.index + 1,
      nextSibling: this.sourcePlacement.nextSibling,
    }
    this.newLine = null
    this.hasExecutedBefore = false
  }

  execute() {
    if (!['remove', 'shorten', 'split'].includes(this.action?.type)) {
      throw new TypeError('Trim line action must be remove, shorten, or split')
    }

    if (this.hasExecutedBefore) {
      this.redo()
      return
    }

    if (this.action.type === 'remove') {
      createAndReplaceTrimSource({
        createReplacements: () => [],
        editor: this.editor,
        parent: this.parent,
        source: this.element,
        sourcePlacement: this.sourcePlacement,
      })
    } else if (this.action.type === 'shorten') {
      this._applyGeometry(this._shortenedGeometry())
    } else {
      this._executeFirstSplit()
    }

    this.hasExecutedBefore = true
    notifyTrimMutation(this)
  }

  undo() {
    if (this.action.type === 'remove') {
      restoreTrimSource(this.parent, this.element, [], this.sourcePlacement)
    } else if (this.action.type === 'shorten') {
      this._applyGeometry(this.originalGeometry)
    } else {
      this._undoSplit()
    }
    notifyTrimMutation(this)
  }

  redo() {
    if (this.action.type === 'remove') {
      replaceTrimSource(this.parent, this.element, [], this.sourcePlacement)
    } else if (this.action.type === 'shorten') {
      this._applyGeometry(this._shortenedGeometry())
    } else {
      this._applySplit()
    }
    notifyTrimMutation(this)
  }

  _readGeometry() {
    return {
      x1: Number(this.element.attr('x1')),
      x2: Number(this.element.attr('x2')),
      y1: Number(this.element.attr('y1')),
      y2: Number(this.element.attr('y2')),
    }
  }

  _plotGeometry({ x1, y1, x2, y2 }) {
    this.element.plot(x1, y1, x2, y2)
  }

  _applyGeometry(geometry) {
    const previous = this._readGeometry()
    try {
      this._plotGeometry(geometry)
    } catch (error) {
      this._plotGeometry(previous)
      throw error
    }
  }

  _shortenedGeometry() {
    if (this.action.keep === 'start') {
      return {
        ...this.originalGeometry,
        x2: this.action.newX,
        y2: this.action.newY,
      }
    }
    if (this.action.keep === 'end') {
      return {
        ...this.originalGeometry,
        x1: this.action.newX,
        y1: this.action.newY,
      }
    }
    throw new TypeError('Trim line shorten action requires a retained end')
  }

  _splitGeometry() {
    return {
      first: {
        ...this.originalGeometry,
        x2: this.action.splitX1,
        y2: this.action.splitY1,
      },
      second: {
        ...this.originalGeometry,
        x1: this.action.splitX2,
        y1: this.action.splitY2,
      },
    }
  }

  _executeFirstSplit() {
    const startingElementIndex = this.editor.elementIndex
    const { second } = this._splitGeometry()
    try {
      this.newLine = prepareTrimClone(this.element)
      this.newLine.plot(second.x1, second.y1, second.x2, second.y2)
      allocateTrimIdentity(this.editor, this.newLine, 'Line')
      this._applySplit()
    } catch (error) {
      if (this.newLine?.node?.parentNode) this.newLine.remove()
      this._plotGeometry(this.originalGeometry)
      this.editor.elementIndex = startingElementIndex
      this.newLine = null
      this.hasExecutedBefore = false
      throw error
    }
  }

  _applySplit() {
    if (!this.newLine) throw new Error('Trim line split replacement is unavailable')
    const previous = this._readGeometry()
    try {
      this._plotGeometry(this._splitGeometry().first)
      insertTrimElement(this.parent, this.newLine, this.newLinePlacement)
    } catch (error) {
      if (this.newLine.node.parentNode) this.newLine.remove()
      this._plotGeometry(previous)
      throw error
    }
  }

  _undoSplit() {
    const splitGeometry = this._splitGeometry().first
    try {
      if (this.newLine?.node?.parentNode) this.newLine.remove()
      this._plotGeometry(this.originalGeometry)
    } catch (error) {
      this._plotGeometry(splitGeometry)
      if (this.newLine?.node?.parentNode !== this.parent.node) {
        insertTrimElement(this.parent, this.newLine, this.newLinePlacement)
      }
      throw error
    }
  }
}

export { TrimLineCommand }
