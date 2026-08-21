import { Command } from '../Command'
import { catmullRomToBezierPath } from './DrawSplineCommand'
import {
  allocateTrimIdentity,
  captureTrimPlacement,
  createAndReplaceTrimSource,
  notifyTrimMutation,
  prepareTrimClone,
  replaceTrimSource,
  restoreTrimSource,
} from './TrimTransaction'

class TrimSplineCommand extends Command {
  constructor(editor, element, action) {
    super(editor)
    this.type = 'TrimSplineCommand'
    this.name = 'Trim Spline'
    this.element = element
    this.action = action
    this.parent = element.parent() || this.editor.activeCollection
    this.sourcePlacement = captureTrimPlacement(this.parent, element)
    this.newSplines = []
    this.hasExecutedBefore = false
  }

  execute() {
    if (this.hasExecutedBefore) {
      replaceTrimSource(this.parent, this.element, this.newSplines, this.sourcePlacement)
      notifyTrimMutation(this)
      return
    }

    this.newSplines = createAndReplaceTrimSource({
      createReplacements: () => this._createReplacements(),
      editor: this.editor,
      parent: this.parent,
      source: this.element,
      sourcePlacement: this.sourcePlacement,
    })
    this.hasExecutedBefore = true
    notifyTrimMutation(this)
  }

  undo() {
    restoreTrimSource(
      this.parent,
      this.element,
      this.newSplines,
      this.sourcePlacement,
    )
    notifyTrimMutation(this)
  }

  redo() {
    replaceTrimSource(this.parent, this.element, this.newSplines, this.sourcePlacement)
    notifyTrimMutation(this)
  }

  _createReplacements() {
    if (this.action.type === 'remove') return []
    if (this.action.type !== 'splines' || !Array.isArray(this.action.splines)) {
      throw new TypeError('Trim spline action must be remove or include a splines array')
    }
    return this.action.splines.map((points) => {
      if (!Array.isArray(points) || points.length < 2) {
        throw new TypeError('Trim spline replacements require at least two points')
      }
      const newSpline = prepareTrimClone(this.element)
      const splinePoints = points.map((point) => ({ x: point.x, y: point.y }))
      newSpline.plot(catmullRomToBezierPath(splinePoints))
      newSpline.data('splineData', { points: splinePoints })
      allocateTrimIdentity(this.editor, newSpline, 'Spline')
      return newSpline
    })
  }
}

export { TrimSplineCommand }
