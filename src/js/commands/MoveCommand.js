import { Command } from '../Command'
import { calculateDeltaFromBasepoint, calculateLocalDelta } from '../utils/calculateDistance'

class MoveCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'MoveCommand'
    this.name = 'Move'
    // Store bound function reference for proper cleanup
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.interactiveExecutionDone = false
  }

  execute() {
    if (this.interactiveExecutionDone) {
      return
    }
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })

    if (this.editor.selected.length > 0) {
      this.editor.suppressHandlers = true
      this.editor.handlers.clear() // Force clear directly
      this.editor.isInteracting = true
      this.onSelectionConfirmed()
      return
    }

    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Select elements to move and press Enter to confirm.`,
    })
    // Use the stored bound reference
    document.addEventListener('keydown', this.boundOnKeyDown)
    this.editor.suppressHandlers = true
    this.editor.signals.commandCancelled.addOnce(this.cleanup, this)
  }

  onKeyDown(event) {
    if (event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter') {
      document.removeEventListener('keydown', this.boundOnKeyDown)
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

    // Disable rectangle selection during transform operations
    this.editor.selectSingleElement = true

    // Store original positions for each element
    this.originalPositions = this.editor.selected.map((element) => this.getElementPosition(element))

    this.editor.signals.terminalLogged.dispatch({ msg: `Selected ${selectedElements.length} elements.` })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Specify base point.' })
    this.editor.signals.pointCaptured.addOnce(this.onBasePoint, this)

    // Listen for coordinate input for base point
    this.boundOnBaseCoordinateInput = () => {
      this.editor.signals.pointCaptured.remove(this.onBasePoint, this)
      this.onBasePoint(this.editor.inputCoord)
    }
    this.editor.signals.coordinateInput.addOnce(this.boundOnBaseCoordinateInput, this)
  }

  onBasePoint(point) {
    if (this.boundOnBaseCoordinateInput) {
      this.editor.signals.coordinateInput.remove(this.boundOnBaseCoordinateInput, this)
    }
    this.basePoint = point
    this.editor.signals.terminalLogged.dispatch({ msg: `Base point: ${this.basePoint.x.toFixed(2)}, ${this.basePoint.y.toFixed(2)}` })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Specify second point or type a distance.' })
    this.editor.signals.moveGhostingStarted.dispatch(this.editor.selected, this.basePoint)
    this.editor.signals.pointCaptured.addOnce(this.onSecondPoint, this)

    // Listen for typed distance input — move in current mouse direction by the typed amount
    this.boundOnDistanceInput = () => {
      // Remove the pointCaptured listener since we're using the typed distance
      this.editor.signals.pointCaptured.remove(this.onSecondPoint, this)
      // Use the current mouse position on the editor as direction reference
      const dirPoint = this.editor.snapPoint || this.editor.coordinates
      this.onSecondPoint(dirPoint)
    }
    this.editor.signals.inputValue.addOnce(this.boundOnDistanceInput, this)

    // Listen for absolute coordinate input for second point
    this.boundOnSecondCoordinateInput = () => {
      this.editor.signals.pointCaptured.remove(this.onSecondPoint, this)
      if (this.boundOnDistanceInput) {
        this.editor.signals.inputValue.remove(this.boundOnDistanceInput, this)
      }
      this.onSecondPoint(this.editor.inputCoord)
    }
    this.editor.signals.coordinateInput.addOnce(this.boundOnSecondCoordinateInput, this)
  }

  onSecondPoint(point) {
    // Clean up listeners if we got here via click or other inputs
    if (this.boundOnDistanceInput) {
      this.editor.signals.inputValue.remove(this.boundOnDistanceInput, this)
    }
    if (this.boundOnSecondCoordinateInput) {
      this.editor.signals.coordinateInput.remove(this.boundOnSecondCoordinateInput, this)
    }
    this.editor.signals.moveGhostingStopped.dispatch()
    const secondPoint = point
    let dx = secondPoint.x - this.basePoint.x
    let dy = secondPoint.y - this.basePoint.y
    if (this.editor.distance) {
      if (this.editor.ortho) {
        if (Math.abs(dx) > Math.abs(dy)) {
          ; ({ dx, dy } = calculateDeltaFromBasepoint(this.basePoint, { x: secondPoint.x, y: this.basePoint.y }, this.editor.distance))
        } else {
          ; ({ dx, dy } = calculateDeltaFromBasepoint(this.basePoint, { x: this.basePoint.x, y: secondPoint.y }, this.editor.distance))
        }
      } else {
        ; ({ dx, dy } = calculateDeltaFromBasepoint(this.basePoint, secondPoint, this.editor.distance))
      }
    }
    if (this.editor.ortho) {
      if (Math.abs(dx) > Math.abs(dy)) {
        dy = 0
      } else {
        dx = 0
      }
    }
    this.moveElements(dx, dy)
    this.editor.distance = null
    this.cleanup()
  }

  // Helper method to get consistent position data for any element type
  getElementPosition(element) {
    const data = {
      arcData: element.data('arcData'),
      circleTrimData: element.data('circleTrimData')
    }

    if (element.type === 'line') {
      return {
        type: 'line',
        points: element.array().slice(), // Copy the array
        ...data
      }
    } else if (element.type === 'circle' || element.type === 'ellipse') {
      return {
        type: 'center',
        cx: element.cx(),
        cy: element.cy(),
        ...data
      }
    } else {
      return {
        type: 'position',
        x: element.x(),
        y: element.y(),
        ...data
      }
    }
  }

  // Cleanup method to properly reset state and remove listeners
  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    if (this.boundOnBaseCoordinateInput) {
      this.editor.signals.coordinateInput.remove(this.boundOnBaseCoordinateInput, this)
    }
    if (this.boundOnDistanceInput) {
      this.editor.signals.inputValue.remove(this.boundOnDistanceInput, this)
    }
    if (this.boundOnSecondCoordinateInput) {
      this.editor.signals.coordinateInput.remove(this.boundOnSecondCoordinateInput, this)
    }
    this.editor.isInteracting = false
    this.editor.suppressHandlers = false
    setTimeout(() => {
      this.editor.selectSingleElement = false
    }, 10)
    this.editor.signals.moveGhostingStopped.dispatch()
  }

  // Method 2: Alternative using direct position manipulation (if transform doesn't work)
  moveElements(dx, dy) {
    this.dx = dx
    this.dy = dy
    this.editor.selected.forEach((element, index) => {
      const originalPos = this.originalPositions[index]
      const localDelta = calculateLocalDelta(element, dx, dy)
      const ldx = localDelta.dx
      const ldy = localDelta.dy

      if (originalPos.type === 'line') {
        // For lines, translate all points
        const newPoints = originalPos.points.map((point) => [point[0] + ldx, point[1] + ldy])
        element.plot(newPoints)
      } else if (originalPos.type === 'center') {
        // For circles/ellipses, move center
        element.center(originalPos.cx + ldx, originalPos.cy + ldy)
      } else {
        // For other elements, move position
        element.move(originalPos.x + ldx, originalPos.y + ldy)
      }

      this.updateArcData(element, originalPos, ldx, ldy)
    })

    this.editor.signals.terminalLogged.dispatch({ msg: 'Elements moved.' })
    this.editor.isInteracting = false
    this.editor.suppressHandlers = false // Reset handlers suppression
    this.selectedElements = this.editor.selected
    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = []
    this.interactiveExecutionDone = true
    this.editor.execute(this)
    this.editor.lastCommand = new MoveCommand(this.editor)
  }

  updateArcData(element, originalPos, dx, dy) {
    if (originalPos.arcData) {
      const ad = originalPos.arcData
      element.data('arcData', {
        p1: { x: ad.p1.x + dx, y: ad.p1.y + dy },
        p2: { x: ad.p2.x + dx, y: ad.p2.y + dy },
        p3: { x: ad.p3.x + dx, y: ad.p3.y + dy }
      })
    }
    if (originalPos.circleTrimData) {
      const ctd = originalPos.circleTrimData
      element.data('circleTrimData', {
        ...ctd,
        cx: ctd.cx + dx,
        cy: ctd.cy + dy,
        startPt: { x: ctd.startPt.x + dx, y: ctd.startPt.y + dy },
        endPt: { x: ctd.endPt.x + dx, y: ctd.endPt.y + dy }
      })
    }
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

      // Restore original data
      if (originalPos.arcData) element.data('arcData', originalPos.arcData)
      if (originalPos.circleTrimData) element.data('circleTrimData', originalPos.circleTrimData)
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

      this.updateArcData(element, originalPos, this.dx, this.dy)
    })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Redo: Elements moved again.' })
  }
}

function moveCommand(editor) {
  const moveCommand = new MoveCommand(editor)
  moveCommand.execute()
}

export { moveCommand }