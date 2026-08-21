import { Command } from '../Command'
import {
  allocateTrimIdentity,
  captureTrimPlacement,
  copyTrimSemantics,
  createAndReplaceTrimSource,
  notifyTrimMutation,
  replaceTrimSource,
  restoreTrimSource,
} from './TrimTransaction'

class TrimRectCommand extends Command {
  constructor(editor, element, trimData) {
    super(editor)
    this.type = 'TrimRectCommand'
    this.name = 'Trim Rectangle'
    this.element = element
    this.trimData = trimData
    this.parent = element.parent() || this.editor.activeCollection
    this.sourcePlacement = captureTrimPlacement(this.parent, element)
    this.intactLines = []
    this.trimmedLines = []
    this.replacementLines = []
    this.hasExecutedBefore = false
  }

  execute() {
    if (this.hasExecutedBefore) {
      replaceTrimSource(
        this.parent,
        this.element,
        this.replacementLines,
        this.sourcePlacement,
      )
      notifyTrimMutation(this)
      return
    }

    const buckets = { intact: [], trimmed: [] }
    try {
      this.replacementLines = createAndReplaceTrimSource({
        createReplacements: () => this._createReplacements(buckets),
        editor: this.editor,
        parent: this.parent,
        source: this.element,
        sourcePlacement: this.sourcePlacement,
      })
    } catch (error) {
      this.intactLines = []
      this.trimmedLines = []
      this.replacementLines = []
      this.hasExecutedBefore = false
      throw error
    }

    this.intactLines = buckets.intact
    this.trimmedLines = buckets.trimmed
    this.hasExecutedBefore = true
    notifyTrimMutation(this)
  }

  undo() {
    restoreTrimSource(
      this.parent,
      this.element,
      this.replacementLines,
      this.sourcePlacement,
    )
    notifyTrimMutation(this)
  }

  redo() {
    replaceTrimSource(
      this.parent,
      this.element,
      this.replacementLines,
      this.sourcePlacement,
    )
    notifyTrimMutation(this)
  }

  _createReplacements(buckets) {
    const { action, closestLineIndex, lines } = this.trimData
    if (!Array.isArray(lines) || lines.length !== 4
      || !Number.isInteger(closestLineIndex)
      || closestLineIndex < 0
      || closestLineIndex >= lines.length) {
      throw new TypeError('Trim rectangle requires four edges and a target edge')
    }
    if (!action || !['remove', 'shorten', 'split'].includes(action.type)) {
      throw new TypeError('Trim rectangle action must be remove, shorten, or split')
    }

    const replacements = []
    lines.forEach((line, index) => {
      if (index !== closestLineIndex) {
        const intact = this._createLine(line)
        buckets.intact.push(intact)
        replacements.push(intact)
        return
      }

      this._targetSegments(line, action).forEach((segment) => {
        const trimmed = this._createLine(segment)
        buckets.trimmed.push(trimmed)
        replacements.push(trimmed)
      })
    })
    return replacements
  }

  _targetSegments(line, action) {
    if (action.type === 'remove') return []
    if (action.type === 'shorten') {
      if (action.keep === 'start') {
        return [{ ...line, x2: action.newX, y2: action.newY }]
      }
      if (action.keep === 'end') {
        return [{ ...line, x1: action.newX, y1: action.newY }]
      }
      throw new TypeError('Trim rectangle shorten action requires a retained end')
    }
    return [
      { ...line, x2: action.splitX1, y2: action.splitY1 },
      { ...line, x1: action.splitX2, y1: action.splitY2 },
    ]
  }

  _createLine({ x1, y1, x2, y2 }) {
    const line = this.parent.line(x1, y1, x2, y2)
    copyTrimSemantics(this.element, line)
    allocateTrimIdentity(this.editor, line, 'Line')
    return line
  }
}

export { TrimRectCommand }
