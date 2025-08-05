import { Command } from '../Command'
import { calculateDeltaFromBasepoint } from '../utils/calculateDistance'

class MoveCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'MoveCommand'
    this.name = 'Move'
    // Store bound function reference for proper cleanup
    this.boundOnKeyDown = this.onKeyDown.bind(this)
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Select elements to move and press Enter to confirm.`,
    })
    // Use the stored bound reference
    document.addEventListener('keydown', this.boundOnKeyDown)
  }

  onKeyDown(event) {
    if (event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter') {
      this.cleanup()
      this.editor.isInteracting = true
      this.onSelectionConfirmed()
    } else if (event.key === 'Escape') {
      this.cleanup()
      this.editor.signals.moveGhostingStopped.dispatch()
      this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
    }
  }

  onSelectionConfirmed() {
    const selectedElements = this.editor.selected
    if (selectedElements.length === 0) {
      this.editor.signals.terminalLogged.dispatch({ msg: 'No elements selected. Command cancelled.' })
      this.cleanup()
      return
    }

    // Store original positions for each element
    this.originalPositions = this.editor.selected.map((element) => this.getElementPosition(element))

    this.editor.signals.terminalLogged.dispatch({ msg: `Selected ${selectedElements.length} elements.` })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Specify base point.' })
    this.editor.signals.pointCaptured.addOnce(this.onBasePoint, this)
  }

  onBasePoint(point) {
    this.basePoint = point
    this.editor.signals.terminalLogged.dispatch({ msg: `Base point: ${this.basePoint.x.toFixed(2)}, ${this.basePoint.y.toFixed(2)}` })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Specify second point or enter a distance.' })
    this.editor.signals.moveGhostingStarted.dispatch(this.editor.selected, this.basePoint)
    this.editor.signals.pointCaptured.addOnce(this.onSecondPoint, this)
  }

  onSecondPoint(point) {
    this.editor.signals.moveGhostingStopped.dispatch()
    const secondPoint = point
    let dx = secondPoint.x - this.basePoint.x
    let dy = secondPoint.y - this.basePoint.y
    if (this.editor.distance) {
      if (this.editor.ortho) {
        if (Math.abs(dx) > Math.abs(dy)) {
          ;({ dx, dy } = calculateDeltaFromBasepoint(this.basePoint, { x: secondPoint.x, y: this.basePoint.y }, this.editor.distance))
        } else {
          ;({ dx, dy } = calculateDeltaFromBasepoint(this.basePoint, { x: this.basePoint.x, y: secondPoint.y }, editor.distance))
        }
      } else {
        ;({ dx, dy } = calculateDeltaFromBasepoint(this.basePoint, secondPoint, editor.distance))
      }
    }
    if (editor.ortho) {
      if (Math.abs(dx) > Math.abs(dy)) {
        dy = 0
      } else {
        dx = 0
      }
    }
    this.moveElements(dx, dy)
    this.editor.distance = null
  }

  // Helper method to get consistent position data for any element type
  getElementPosition(element) {
    if (element.type === 'line') {
      return {
        type: 'line',
        points: element.array().slice(), // Copy the array
      }
    } else if (element.type === 'circle' || element.type === 'ellipse') {
      return {
        type: 'center',
        cx: element.cx(),
        cy: element.cy(),
      }
    } else {
      return {
        type: 'position',
        x: element.x(),
        y: element.y(),
      }
    }
  }

  // Cleanup method to properly reset state and remove listeners
  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    this.editor.isInteracting = false
    this.editor.signals.moveGhostingStopped.dispatch()
  }

  // Method 2: Alternative using direct position manipulation (if transform doesn't work)
  moveElements(dx, dy) {
    this.dx = dx
    this.dy = dy
    this.editor.selected.forEach((element, index) => {
      const originalPos = this.originalPositions[index]

      if (originalPos.type === 'line') {
        // For lines, translate all points
        const newPoints = originalPos.points.map((point) => [point[0] + dx, point[1] + dy])
        element.plot(newPoints)
      } else if (originalPos.type === 'center') {
        // For circles/ellipses, move center
        element.center(originalPos.cx + dx, originalPos.cy + dy)
      } else {
        // For other elements, move position
        element.move(originalPos.x + dx, originalPos.y + dy)
      }
    })

    this.editor.signals.terminalLogged.dispatch({ msg: 'Elements moved.' })
    this.editor.isInteracting = false
    this.selectedElements = this.editor.selected
    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = []
    this.editor.execute(this)
    this.editor.lastCommand = this
  }

  undo() {
    this.selectedElements.forEach((element, index) => {
      const originalPos = this.originalPositions[index]

      if (originalPos.type === 'line') {
        // For lines, translate all points
        element.plot(originalPos.points)
      } else if (originalPos.type === 'center') {
        // For circles/ellipses, move center
        element.center(originalPos.cx, originalPos.cy)
      } else {
        // For other elements, move position
        element.move(originalPos.x, originalPos.y)
      }
    })

    this.editor.signals.terminalLogged.dispatch({ msg: 'Undo: Elements moved back.' })
  }

  redo() {
    this.selectedElements.forEach((element, index) => {
      const originalPos = this.originalPositions[index]

      if (originalPos.type === 'line') {
        // For lines, translate all points
        const newPoints = originalPos.points.map((point) => [point[0] + this.dx, point[1] + this.dy])
        element.plot(newPoints)
      } else if (originalPos.type === 'center') {
        // For circles/ellipses, move center
        element.center(originalPos.cx + this.dx, originalPos.cy + this.dy)
      } else {
        // For other elements, move position
        element.move(originalPos.x + this.dx, originalPos.y + this.dy)
      }
    })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Redo: Elements moved again.' })
  }
}

function moveCommand(editor) {
  const moveCommand = new MoveCommand(editor)
  moveCommand.execute()
}

export { moveCommand }
