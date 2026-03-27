import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import { applyOffsetToElement, computeOffsetVector } from '../utils/offsetCalc'

class OffsetCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'OffsetCommand'
    this.name = 'Offset'
    this.distance = null
    this.selectedElement = null

    // Bind handlers
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.boundOnElementSelected = this.onElementSelected.bind(this)
    this.boundOnConfirmPoint = this.onConfirmPoint.bind(this)
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
    const lastDistance = this.editor.lastOffsetDistance || 10 // Default to 10 if not set
    this.editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Enter a distance to offset <${lastDistance}>:` })
    this.editor.isInteracting = true
    this.editor.signals.inputValue.addOnce(this.onDistanceInput, this)
    this.editor.signals.commandCancelled.addOnce(this.cleanup, this)
    document.addEventListener('keydown', this.boundOnKeyDown)
  }

  onDistanceInput(inputVal) {
    let d
    // If user input is empty, use the last distance.
    if (inputVal === null || inputVal === undefined || String(inputVal).trim() === '') {
      d = this.editor.lastOffsetDistance || 10
    } else {
      d = parseFloat(inputVal)
    }

    if (isNaN(d) || d <= 0) {
      this.editor.signals.terminalLogged.dispatch({ msg: 'Invalid distance. Command cancelled.' })
      return this.cleanup()
    }
    this.distance = d
    this.editor.lastOffsetDistance = d // Remember this distance
    this.editor.signals.terminalLogged.dispatch({ msg: `Offset distance: ${this.distance}. Select one element.` })
    this.startSelection()
  }

  startSelection() {
    this.editor.signals.clearSelection.dispatch()
    this.editor.selectSingleElement = true
    this.editor.isInteracting = false
    this.editor.signals.toogledSelect.addOnce(this.boundOnElementSelected)
  }

  onElementSelected(el) {
    if (!el) return
    this.selectedElement = el

    // Start ghosting in viewport with fixed distance
    this.editor.signals.offsetGhostingStarted.dispatch([this.selectedElement], this.distance)

    // Now capture click to confirm side
    this.editor.isInteracting = true
    this.editor.signals.terminalLogged.dispatch({ msg: 'Move mouse to choose side, click to confirm.' })
    this.editor.signals.pointCaptured.addOnce(this.boundOnConfirmPoint)
  }

  onConfirmPoint(point) {
    if (!this.selectedElement) return this.cleanup()

    const clone = this.selectedElement.clone()

    // Remove interactive classes so the new element isn't highlighted or selected
    clone.removeClass('elementHover')
    clone.removeClass('elementSelected')
    if (clone.type === 'g' && clone.children) {
      const stripClasses = (element) => {
        element.removeClass('elementHover')
        element.removeClass('elementSelected')
        if (element.type === 'g' && element.children) {
          element.children().each(child => stripClasses(child))
        }
      }
      clone.children().each(child => stripClasses(child))
    }

    clone.putIn(this.selectedElement.parent() || this.editor.activeCollection)

    // For circles/rects, resize instead of translate
    if (this.selectedElement.type === 'circle') {
      const cx = this.selectedElement.cx()
      const cy = this.selectedElement.cy()
      const r = this.selectedElement.radius ? this.selectedElement.radius() : this.selectedElement.attr('r')
      const dx = point.x - cx
      const dy = point.y - cy
      const dist = Math.hypot(dx, dy)
      const inward = dist < (typeof r === 'number' ? r : parseFloat(r))
      const newR = Math.max(0, (typeof r === 'number' ? r : parseFloat(r)) + (inward ? -this.distance : this.distance))
      clone.center(cx, cy)
      if (clone.radius) clone.radius(newR)
      else clone.attr('r', newR)
    } else if (this.selectedElement.type === 'rect') {
      const x = this.selectedElement.x()
      const y = this.selectedElement.y()
      const w = this.selectedElement.width()
      const h = this.selectedElement.height()
      const cx = x + w / 2
      const cy = y + h / 2
      const inside = point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h
      const delta = inside ? -this.distance : this.distance
      const newW = Math.max(0, w + 2 * delta)
      const newH = Math.max(0, h + 2 * delta)
      const newX = cx - newW / 2
      const newY = cy - newH / 2
      clone.size(newW, newH)
      clone.move(newX, newY)
    } else {
      // Compute offset direction relative to the selected element and click position
      const { dx, dy } = computeOffsetVector(this.selectedElement, point, this.distance)
      try {
        applyOffsetToElement(clone, dx, dy)
      } catch (e) {
        const t = clone.transform ? clone.transform() : {}
        if (clone.transform) clone.transform(t).translate(dx, dy)
      }
    }
    // Assign id/name
    clone.attr('id', this.editor.elementIndex++)
    if (this.selectedElement.attr && this.selectedElement.attr('name')) {
      clone.attr('name', this.selectedElement.attr('name'))
    }

    // Stop ghosting for this element and allow another selection
    // Do this BEFORE executing AddElementCommand to prevent ghost from appearing in Outliner
    this.editor.signals.offsetGhostingStopped.dispatch()

    // Record into history for undo/redo
    this.editor.execute(new AddElementCommand(this.editor, clone))
    this.editor.signals.updatedOutliner.dispatch()

    this.editor.signals.terminalLogged.dispatch({ msg: `Created offset element. Select next element or press Esc to finish.` })

    // Continue: loop back to element selection with the same distance
    this.editor.selected = []
    this.selectedElement = null
    this.startSelection()
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      this.editor.signals.offsetGhostingStopped.dispatch()
      this.cleanup()
      this.editor.signals.terminalLogged.dispatch({ msg: 'Command finished.' })
    }
  }

  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    this.editor.signals.inputValue.remove(this.onDistanceInput, this)
    this.editor.signals.toogledSelect.remove(this.boundOnElementSelected)
    this.editor.signals.pointCaptured.remove(this.boundOnConfirmPoint)
    this.editor.signals.commandCancelled.remove(this.cleanup, this)
    this.editor.isInteracting = false
    setTimeout(() => {
      this.editor.selectSingleElement = false
    }, 10)
    this.editor.distance = null
    this.selectedElement = null
  }

  undo() { }
  redo() { }
}

function offsetCommand(editor) {
  const offsetCmd = new OffsetCommand(editor)
  offsetCmd.execute()
}

export { offsetCommand }
