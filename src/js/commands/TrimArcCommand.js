import { Command } from '../Command'
import {
  allocateTrimIdentity,
  captureTrimPlacement,
  createAndReplaceTrimSource,
  notifyTrimMutation,
  prepareTrimClone,
  replaceTrimSource,
  restoreTrimSource,
} from './TrimTransaction'

class TrimArcCommand extends Command {
  constructor(editor, element, action) {
    super(editor)
    this.type = 'TrimArcCommand'
    this.name = 'Trim Arc'
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
      throw new TypeError('Trim arc action must be remove or include an arcs array')
    }
    return this.action.arcs.map((arc) => this._createArc(arc))
  }

  _createArc(arc) {
    const { r, startPt, midPt, endPt, cx, cy } = arc
    let startAngle = Math.atan2(startPt.y - cy, startPt.x - cx)
    let midAngle = Math.atan2(midPt.y - cy, midPt.x - cx)
    let endAngle = Math.atan2(endPt.y - cy, endPt.x - cx)
    if (startAngle < 0) startAngle += 2 * Math.PI
    if (midAngle < 0) midAngle += 2 * Math.PI
    if (endAngle < 0) endAngle += 2 * Math.PI

    let ccwDistance = endAngle - startAngle
    if (ccwDistance < 0) ccwDistance += 2 * Math.PI
    let midCcwDistance = midAngle - startAngle
    if (midCcwDistance < 0) midCcwDistance += 2 * Math.PI
    const sweepFlag = midCcwDistance < ccwDistance ? 1 : 0
    const sweepDistance = sweepFlag ? ccwDistance : 2 * Math.PI - ccwDistance
    const largeArcFlag = sweepDistance > Math.PI ? 1 : 0
    const d = `M ${startPt.x} ${startPt.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${endPt.x} ${endPt.y}`
    const newArc = prepareTrimClone(this.element)

    newArc.plot(d)
    newArc.data('arcData', {
      p1: { x: startPt.x, y: startPt.y },
      p2: { x: midPt.x, y: midPt.y },
      p3: { x: endPt.x, y: endPt.y },
    })
    if (this.element.data('circleTrimData')) {
      newArc.data('circleTrimData', arc)
    }
    allocateTrimIdentity(this.editor, newArc, 'Arc')
    return newArc
  }
}

export { TrimArcCommand }
