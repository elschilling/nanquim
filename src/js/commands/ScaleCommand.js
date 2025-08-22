import { Command } from '../Command'
import { calculateDistance } from '../utils/calculateDistance'

class ScaleCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'ScaleCommand'
    this.name = 'Scale'
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.interactiveExecutionDone = false
    this.scaleFactor = 1
    this.originalPositions = [] // Changed from originalTransforms
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
    document.addEventListener('keydown', this.boundOnKeyDown)
  }

  onKeyDown(event) {
    if (event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter') {
      this.cleanup()
      this.editor.isInteracting = true
      this.onSelectionConfirmed()
    } else if (event.key === 'Escape') {
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

    this.selectedElements = [...selectedElements]
    // Store original positions for each element
    this.originalPositions = this.selectedElements.map((element) => this.getElementPosition(element))

    this.editor.signals.terminalLogged.dispatch({ msg: `Selected ${selectedElements.length} elements.` })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Specify base point.' })
    this.editor.signals.pointCaptured.addOnce(this.onBasePoint, this)
  }

  onBasePoint(point) {
    this.basePoint = point
    this.editor.signals.terminalLogged.dispatch({ msg: `Base point: ${this.basePoint.x.toFixed(2)}, ${this.basePoint.y.toFixed(2)}` })

    if (this.editor.distance && this.editor.distance > 0) {
      // If a scale factor was already provided, apply it immediately
      this.scaleFactor = this.editor.distance
      this.editor.distance = null // Clear it after use
      this.scaleElements() // Apply the scale
      this.cleanup()
    } else {
      // Otherwise, ask for a second point or scale factor
      this.editor.signals.terminalLogged.dispatch({ msg: 'Specify second point or enter a scale factor.' })
      this.editor.signals.scaleGhostingStarted.dispatch(this.selectedElements, this.basePoint)
      this.editor.signals.inputValue.addOnce(this.onScaleFactor, this)
      this.editor.signals.pointCaptured.addOnce(this.onSecondPoint, this)
    }
  }

  onScaleFactor(scaleFactor) {
    console.log('onScaleFactor', scaleFactor)
    this.editor.signals.pointCaptured.remove(this.onSecondPoint, this)
    this.scaleFactor = scaleFactor
    this.editor.distance = null // Clear it after use
    this.scaleElements()
    this.cleanup()
  }

  onSecondPoint(point) {
    this.editor.signals.inputValue.remove(this.onScaleFactor, this)
    if (this.editor.distance && this.editor.distance > 0) {
      this.scaleFactor = this.editor.distance
    } else {
      const dist = calculateDistance(this.basePoint, point)
      this.scaleFactor = dist
    }
    this.editor.distance = null
    this.scaleElements()
    this.cleanup()
  }

  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    this.editor.isInteracting = false
    this.editor.signals.scaleGhostingStopped.dispatch()
  }

  getElementPosition(element) {
    const pos = {
      type: element.type,
    }
    if (element.type === 'line' || element.type === 'polyline' || element.type === 'polygon' || element.type === 'path') {
      pos.points = element.array().slice()
    } else if (element.type === 'circle') {
      pos.cx = element.cx()
      pos.cy = element.cy()
      pos.radius = element.radius()
    } else if (element.type === 'ellipse') {
      pos.cx = element.cx()
      pos.cy = element.cy()
      pos.rx = element.rx()
      pos.ry = element.ry()
    } else if (element.type === 'rect' || element.type === 'image') {
      pos.x = element.x()
      pos.y = element.y()
      pos.width = element.width()
      pos.height = element.height()
    } else {
      // path, text, etc. - fallback to x, y and rely on SVG.js internal scaling if possible
      pos.x = element.x()
      pos.y = element.y()
    }
    return pos
  }

  applyScale(element, originalPos, factor) {
    if (originalPos.type === 'line' || originalPos.type === 'polyline' || originalPos.type === 'polygon') {
      const newPoints = originalPos.points.map((point) => {
        const newX = this.basePoint.x + (point[0] - this.basePoint.x) * factor
        const newY = this.basePoint.y + (point[1] - this.basePoint.y) * factor
        return [newX, newY]
      })
      element.plot(newPoints)
    } else if (originalPos.type === 'path') {
      let newPathString = ''
      originalPos.points.forEach((segment) => {
        const command = segment[0]
        newPathString += command
        if (command.toUpperCase() === 'A') {
          const [rx, ry, xAxisRotation, largeArcFlag, sweepFlag, x, y] = segment.slice(1)
          const newRx = rx * factor
          const newRy = ry * factor
          const newX = this.basePoint.x + (x - this.basePoint.x) * factor
          const newY = this.basePoint.y + (y - this.basePoint.y) * factor
          newPathString += ` ${newRx} ${newRy} ${xAxisRotation} ${largeArcFlag} ${sweepFlag} ${newX} ${newY}`
        } else {
          for (let i = 1; i < segment.length; i += 2) {
            const newX = this.basePoint.x + (segment[i] - this.basePoint.x) * factor
            const newY = this.basePoint.y + (segment[i + 1] - this.basePoint.y) * factor
            newPathString += ` ${newX} ${newY}`
          }
        }
      })
      element.plot(newPathString)
    } else if (originalPos.type === 'circle') {
      const newCx = this.basePoint.x + (originalPos.cx - this.basePoint.x) * factor
      const newCy = this.basePoint.y + (originalPos.cy - this.basePoint.y) * factor
      element.center(newCx, newCy)
      element.radius(originalPos.radius * factor)
    } else if (originalPos.type === 'ellipse') {
      const newCx = this.basePoint.x + (originalPos.cx - this.basePoint.x) * factor
      const newCy = this.basePoint.y + (originalPos.cy - this.basePoint.y) * factor
      element.center(newCx, newCy)
      element.rx(originalPos.rx * factor)
      element.ry(originalPos.ry * factor)
    } else if (originalPos.type === 'rect' || originalPos.type === 'image') {
      const newX = this.basePoint.x + (originalPos.x - this.basePoint.x) * factor
      const newY = this.basePoint.y + (originalPos.y - this.basePoint.y) * factor
      element.move(newX, newY)
      element.size(originalPos.width * factor, originalPos.height * factor)
    } else {
      // path, text, etc.
      const newX = this.basePoint.x + (originalPos.x - this.basePoint.x) * factor
      const newY = this.basePoint.y + (originalPos.y - this.basePoint.y) * factor
      element.move(newX, newY)
    }
  }

  scaleElements() {
    this.selectedElements.forEach((element, index) => {
      const originalPos = this.originalPositions[index]
      this.applyScale(element, originalPos, this.scaleFactor)
    })

    this.editor.signals.terminalLogged.dispatch({ msg: `Elements scaled by a factor of ${this.scaleFactor}.` })
    this.editor.isInteracting = false
    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = []
    this.interactiveExecutionDone = true
    this.editor.execute(this)
    this.editor.lastCommand = this
  }

  undo() {
    this.selectedElements.forEach((element, index) => {
      const originalPos = this.originalPositions[index]
      if (originalPos.type === 'line' || originalPos.type === 'polyline' || originalPos.type === 'polygon' || originalPos.type === 'path') {
        element.plot(originalPos.points)
      } else if (originalPos.type === 'circle') {
        element.center(originalPos.cx, originalPos.cy)
        element.radius(originalPos.radius)
      } else if (originalPos.type === 'ellipse') {
        element.center(originalPos.cx, originalPos.cy)
        element.rx(originalPos.rx)
        element.ry(originalPos.ry)
      } else if (originalPos.type === 'rect' || originalPos.type === 'image') {
        element.move(originalPos.x, originalPos.y)
        element.size(originalPos.width, originalPos.height)
      } else {
        // path, text, etc.
        element.move(originalPos.x, originalPos.y)
      }
    })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Undo: Scale reset.' })
  }

  redo() {
    this.selectedElements.forEach((element, index) => {
      const originalPos = this.originalPositions[index]
      this.applyScale(element, originalPos, this.scaleFactor)
    })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Redo: Scale applied again.' })
  }
}

function scaleCommand(editor) {
  const scaleCommand = new ScaleCommand(editor)
  scaleCommand.execute()
}

export { scaleCommand }
