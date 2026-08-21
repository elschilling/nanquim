import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import {
  applyOffsetToElement,
  computeOffsetVector,
  getOffsetResultIssue,
  getOffsetSupportIssue,
} from '../utils/offsetCalc'

const OFFSET_DIAGNOSTICS = {
  'invalid-geometry': 'OFFSET requires finite, non-degenerate geometry.',
  'inward-distance': 'OFFSET distance is too large for a valid inward result.',
  'outside-drawing': 'OFFSET can only modify geometry in the active drawing.',
  'rounded-rectangle': 'OFFSET does not yet support rounded rectangles.',
  transformed: 'OFFSET does not support transformed geometry or geometry inside transformed groups.',
  'unsupported-type': 'OFFSET supports only lines, circles, and square-corner rectangles.',
}

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
    if (!el) {
      this.startSelection()
      return
    }
    this.selectedElement = el
    const supportIssue = getOffsetSupportIssue(el, this.editor.drawing)
    if (supportIssue) {
      this.rejectSelectedElement(supportIssue)
      return
    }

    // Start ghosting in viewport with fixed distance
    this.editor.signals.offsetGhostingStarted.dispatch([this.selectedElement], this.distance)

    // Now capture click to confirm side
    this.editor.isInteracting = true
    this.editor.signals.terminalLogged.dispatch({ msg: 'Move mouse to choose side, click to confirm.' })
    this.editor.signals.pointCaptured.addOnce(this.boundOnConfirmPoint)
  }

  onConfirmPoint(point) {
    if (!this.selectedElement) return this.cleanup()

    const supportIssue = getOffsetSupportIssue(this.selectedElement, this.editor.drawing)
      || getOffsetResultIssue(this.selectedElement, point, this.distance)
    if (supportIssue) {
      this.rejectSelectedElement(supportIssue, { stopGhosting: true })
      return
    }

    const clone = this.selectedElement.clone()
    const parent = this.selectedElement.parent() || this.editor.activeCollection
    clone.attr('id', null)

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

    try {
      // For circles/rects, resize instead of translate
      if (this.selectedElement.type === 'circle') {
        const cx = this.selectedElement.cx()
        const cy = this.selectedElement.cy()
        const radius = this.selectedElement.radius
          ? this.selectedElement.radius()
          : Number(this.selectedElement.attr('r'))
        const inward = Math.hypot(point.x - cx, point.y - cy) < radius
        const newRadius = radius + (inward ? -this.distance : this.distance)
        clone.center(cx, cy)
        if (clone.radius) clone.radius(newRadius)
        else clone.attr('r', newRadius)
      } else if (this.selectedElement.type === 'rect') {
        const x = this.selectedElement.x()
        const y = this.selectedElement.y()
        const width = this.selectedElement.width()
        const height = this.selectedElement.height()
        const centerX = x + width / 2
        const centerY = y + height / 2
        const inside = point.x >= x && point.x <= x + width
          && point.y >= y && point.y <= y + height
        const delta = inside ? -this.distance : this.distance
        const newWidth = width + 2 * delta
        const newHeight = height + 2 * delta
        clone.size(newWidth, newHeight)
        clone.move(centerX - newWidth / 2, centerY - newHeight / 2)
      } else {
        const { dx, dy } = computeOffsetVector(this.selectedElement, point, this.distance)
        applyOffsetToElement(clone, dx, dy)
      }
    } catch (_error) {
      clone.remove()
      this.rejectSelectedElement('invalid-geometry', { stopGhosting: true })
      return
    }

    // Preserve the semantic name; AddElementCommand assigns the persistent ID
    // transactionally when History performs the first attachment.
    if (this.selectedElement.attr && this.selectedElement.attr('name')) {
      clone.attr('name', this.selectedElement.attr('name'))
    }

    // Stop ghosting for this element and allow another selection
    // Do this BEFORE executing AddElementCommand to prevent ghost from appearing in Outliner
    this.editor.signals.offsetGhostingStopped.dispatch()
    this.clearInteractionStyles(this.selectedElement)

    // Record into history for undo/redo
    try {
      this.editor.execute(new AddElementCommand(this.editor, clone, parent))
    } catch (error) {
      this.cleanup()
      throw error
    }

    this.editor.signals.terminalLogged.dispatch({ msg: `Created offset element. Select next element or press Esc to finish.` })

    // Continue: loop back to element selection with the same distance
    this.selectedElement = null
    this.startSelection()
  }

  rejectSelectedElement(issue, { stopGhosting = false } = {}) {
    if (stopGhosting) this.editor.signals.offsetGhostingStopped.dispatch()
    this.clearInteractionStyles(this.selectedElement)
    this.selectedElement = null
    this.editor.signals.terminalLogged.dispatch({
      msg: OFFSET_DIAGNOSTICS[issue] || OFFSET_DIAGNOSTICS['invalid-geometry'],
    })
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
    this.editor.signals.offsetGhostingStopped.dispatch()
    this.clearInteractionStyles(this.selectedElement)
    this.editor.isInteracting = false
    this.deferSessionTask(() => {
      this.editor.selectSingleElement = false
    }, 10)
    this.editor.distance = null
    this.selectedElement = null
  }

  clearInteractionStyles(element) {
    if (!element) return
    element.removeClass('elementHover')
    element.removeClass('elementSelected')
    if (element.type === 'g' && element.children) {
      element.children().each(child => this.clearInteractionStyles(child))
    }
  }

  undo() { }
  redo() { }
}

function offsetCommand(editor) {
  const offsetCmd = new OffsetCommand(editor)
  offsetCmd.execute()
}

export { offsetCommand, OffsetCommand }
