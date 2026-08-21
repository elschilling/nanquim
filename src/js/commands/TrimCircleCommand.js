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

class TrimCircleCommand extends Command {
  constructor(editor, element, action) {
    super(editor)
    this.type = 'TrimCircleCommand'
    this.name = 'Trim Circle'
    this.element = element
    this.action = action
    this.parent = element.parent() || this.editor.activeCollection
    this.sourcePlacement = captureTrimPlacement(this.parent, element)
    this.arcPaths = []
    this.hasExecutedBefore = false
  }

  execute() {
    if (this.hasExecutedBefore) {
      replaceTrimSource(this.parent, this.element, this.arcPaths, this.sourcePlacement)
      notifyTrimMutation(this)
      return
    }

    this.arcPaths = createAndReplaceTrimSource({
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
      this.arcPaths,
      this.sourcePlacement,
    )
    notifyTrimMutation(this)
  }

  redo() {
    replaceTrimSource(this.parent, this.element, this.arcPaths, this.sourcePlacement)
    notifyTrimMutation(this)
  }

  _createReplacements() {
    if (this.action.type === 'remove') return []
    if (this.action.type !== 'arcs' || !Array.isArray(this.action.arcs)) {
      throw new TypeError('Trim circle action must be remove or include an arcs array')
    }
    return this.action.arcs.map((arc) => this._createArc(arc))
  }

  _createArc(arc) {
    const { cx, cy, r, theta1, theta2, startPt, endPt } = arc
    const ccw = arc.ccw !== false
    let span = ccw ? theta1 - theta2 : theta2 - theta1
    if (span < 0) span += 2 * Math.PI
    const sweepFlag = ccw ? 1 : 0
    const largeArcFlag = span > Math.PI ? 1 : 0
    const d = `M ${startPt.x} ${startPt.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${endPt.x} ${endPt.y}`
    const newArc = this.parent.path(d)
    const midAngle = ccw ? theta2 + span / 2 : theta2 - span / 2
    const midPt = {
      x: cx + r * Math.cos(midAngle),
      y: cy + r * Math.sin(midAngle),
    }

    copyTrimSemantics(this.element, newArc)
    newArc.data('circleTrimData', arc)
    newArc.data('arcData', {
      p1: { x: startPt.x, y: startPt.y },
      p2: midPt,
      p3: { x: endPt.x, y: endPt.y },
    })
    allocateTrimIdentity(this.editor, newArc, 'Arc')
    return newArc
  }
}

export { TrimCircleCommand }
