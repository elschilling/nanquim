import { Command } from '../Command'
import { calculateDeltaFromBasepoint } from '../utils/calculateDistance'

class CopyCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'CopyCommand'
    this.name = 'Copy'
    // Store bound function reference for proper cleanup
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.copiedElements = []
    this.interactiveExecutionDone = false
  }

  execute() {
    if (this.interactiveExecutionDone) {
      return
    }
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Select elements to copy and press Enter to confirm.`,
    })
    document.addEventListener('keydown', this.boundOnKeyDown)
  }

  onKeyDown(event) {
    if (event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter') {
      this.cleanup()
      this.editor.isInteracting = true
      this.onSelectionConfirmed()
    } else if (event.key === 'Escape') {
      // If we cloned elements for ghosting, we need to remove them
      if (this.copiedElements.length > 0) {
        this.copiedElements.forEach((el) => el.remove())
        this.copiedElements = []
      }
      this.cleanup()
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

    this.originalPositions = this.editor.selected.map((element) => this.getElementPosition(element))
    this.originalSelection = this.editor.selected.slice()

    this.editor.signals.terminalLogged.dispatch({ msg: `Selected ${selectedElements.length} elements.` })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Specify base point.' })
    this.editor.signals.pointCaptured.addOnce(this.onBasePoint, this)
  }

  onBasePoint(point) {
    this.basePoint = point
    this.editor.signals.terminalLogged.dispatch({ msg: `Base point: ${this.basePoint.x.toFixed(2)}, ${this.basePoint.y.toFixed(2)}` })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Specify second point or enter a distance.' })

    // Clone elements for ghosting
    this.copiedElements = this.originalSelection.map((el) => {
      const clone = el.clone()
      this.editor.drawing.add(clone)
      return clone
    })

    this.editor.signals.moveGhostingStarted.dispatch(this.copiedElements, this.basePoint)
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
          ;({ dx, dy } = calculateDeltaFromBasepoint(this.basePoint, { x: this.basePoint.x, y: secondPoint.y }, this.editor.distance))
        }
      } else {
        ;({ dx, dy } = calculateDeltaFromBasepoint(this.basePoint, secondPoint, this.editor.distance))
      }
    }
    if (this.editor.ortho) {
      if (Math.abs(dx) > Math.abs(dy)) {
        dy = 0
      } else {
        dx = 0
      }
    }

    this.dx = dx
    this.dy = dy

    // Move the copied elements to the final position
    this.copiedElements.forEach((clone, index) => {
      const originalPos = this.originalPositions[index]

      if (originalPos.type === 'line') {
        const newPoints = originalPos.points.map((p) => [p[0] + dx, p[1] + dy])
        clone.plot(newPoints)
      } else if (originalPos.type === 'center') {
        clone.center(originalPos.cx + dx, originalPos.cy + dy)
      } else {
        clone.move(originalPos.x + dx, originalPos.y + dy)
      }
    })

    this.editor.signals.terminalLogged.dispatch({ msg: 'Elements copied.' })
    this.editor.isInteracting = false

    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = []
    // this.editor.signals.updatedSelection.dispatch()

    this.interactiveExecutionDone = true
    this.editor.execute(this)
    this.editor.lastCommand = new CopyCommand(this.editor)
    this.editor.distance = null
  }

  getElementPosition(element) {
    if (element.type === 'line') {
      return {
        type: 'line',
        points: element.array().slice(),
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

  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    this.editor.isInteracting = false
    this.editor.signals.moveGhostingStopped.dispatch()
  }

  undo() {
    this.copiedElements.forEach((element) => {
      element.remove()
    })

    this.editor.selected = this.originalSelection.slice()
    this.editor.signals.updatedSelection.dispatch()

    this.editor.signals.terminalLogged.dispatch({ msg: 'Undo: Copies removed.' })
  }

  redo() {
    this.copiedElements.forEach((element) => {
      this.editor.drawing.add(element)
    })

    this.editor.selected = this.copiedElements.slice()
    this.editor.signals.updatedSelection.dispatch()

    this.editor.signals.terminalLogged.dispatch({ msg: 'Redo: Elements copied again.' })
  }
}

function copyCommand(editor) {
  const copyCommand = new CopyCommand(editor)
  copyCommand.execute()
}

export { copyCommand }
