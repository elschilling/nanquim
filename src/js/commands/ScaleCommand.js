import { Command } from '../Command'
import { calculateDeltaFromBasepoint } from '../utils/calculateDistance'

class ScaleCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'ScaleCommand'
    this.name = 'Scale'
    // Store bound function reference for proper cleanup
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.interactiveExecutionDone = false
  }

  execute() {
    if (this.interactiveExecutionDone) {
      return
    }
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Select elements to scale and press Enter to confirm.`,
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
      this.editor.signals.scaleGhostingStopped.dispatch()
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
    this.editor.signals.terminalLogged.dispatch({ msg: 'Specify second point or enter a scale factor.' })
    this.editor.signals.scaleGhostingStarted.dispatch(this.editor.selected, this.basePoint)
    this.editor.signals.pointCaptured.addOnce(this.onSecondPoint, this)
  }

  onSecondPoint(point) {
    this.editor.signals.scaleGhostingStopped.dispatch()
    this.scaleElements()
  }

  // Cleanup method to properly reset state and remove listeners
  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    this.editor.isInteracting = false
    this.editor.signals.scaleGhostingStopped.dispatch()
  }

  scaleElements() {
    // implement scale to elements selected
  }

  undo() {
    // implement undo logic
  }

  redo() {
    // implement redo logic
  }
}

function scaleCommand(editor) {
  const scaleCommand = new ScaleCommand(editor)
  scaleCommand.execute()
}

export { scaleCommand }
