import { Command } from '../Command'
import { calculateDistance } from '../utils/calculateDistance'
import { bakeTransforms, applyMatrixToPoint } from '../utils/transformGeometry'

class ScaleCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'ScaleCommand'
    this.name = 'Scale'
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.interactiveExecutionDone = false
    this.scaleFactor = 1
    this.originalPositions = []
  }

  execute() {
    if (this.interactiveExecutionDone) {
      return
    }
    if (this.editor.selected.length > 0) {
      this.editor.suppressHandlers = true
      this.editor.handlers.clear()
      this.editor.isInteracting = true
      this.onSelectionConfirmed()
      return
    }

    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Select elements to scale and press Enter to confirm.`,
    })
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
      this.cleanup()
      this.performScale()

      this.interactiveExecutionDone = true
      this.editor.execute(this)
      this.editor.lastCommand = this
    } else {
      // Otherwise, ask for a second point or scale factor
      this.editor.signals.terminalLogged.dispatch({ msg: 'Specify second point or enter a scale factor.' })
      this.editor.signals.scaleGhostingStarted.dispatch(this.selectedElements, this.basePoint)
      this.editor.signals.inputValue.addOnce(this.onScaleFactor, this)
      this.editor.signals.pointCaptured.addOnce(this.onSecondPoint, this)
    }
  }

  onScaleFactor(scaleFactor) {
    this.editor.signals.pointCaptured.remove(this.onSecondPoint, this)
    this.scaleFactor = scaleFactor
    this.editor.distance = null

    this.cleanup()
    this.performScale()

    this.interactiveExecutionDone = true
    this.editor.execute(this)
    this.editor.lastCommand = this
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

    this.cleanup()
    this.performScale()

    this.interactiveExecutionDone = true
    this.editor.execute(this)
    this.editor.lastCommand = this
  }

  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    this.editor.isInteracting = false
    this.editor.suppressHandlers = false
    setTimeout(() => {
      this.editor.selectSingleElement = false
    }, 10)
    this.editor.signals.scaleGhostingStopped.dispatch()
  }

  getElementPosition(element) {
    const data = {
      arcData: element.data('arcData'),
      circleTrimData: element.data('circleTrimData'),
      splineData: element.data('splineData')
    }

    const pos = {
      type: element.type,
      matrix: element.matrix(), // Store local matrix relative to parent
      ...data
    }
    if (element._paperVp) {
      const vp = element._paperVp
      return {
        type: 'viewport',
        vp: vp,
        x: vp.x,
        y: vp.y,
        width: vp.w,
        height: vp.h,
        scale: vp.scale
      }
    }
    if (element.type === 'line' || element.type === 'polyline' || element.type === 'polygon' || element.type === 'path') {
      pos.points = element.array().slice()
      if (element.type === 'path') {
        pos.d = element.attr('d')
      }
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
      pos.attrs = { ...element.attr() }
    } else {
      // fallback
      pos.x = element.x ? element.x() : 0
      pos.y = element.y ? element.y() : 0
      pos.transform = element.transform ? element.transform() : null
    }
    return pos
  }

  applyScale(element, originalPos, factor) {
    if (typeof factor !== 'number' || isNaN(factor)) return element

    if (originalPos.type === 'viewport') {
      const vp = originalPos.vp
      // Scale dimensions
      vp.w = originalPos.width * factor
      vp.h = originalPos.height * factor
      
      // Scale position relative to base point
      const dx = originalPos.x - this.basePoint.x
      const dy = originalPos.y - this.basePoint.y
      vp.x = this.basePoint.x + dx * factor
      vp.y = this.basePoint.y + dy * factor
      
      vp.refreshGeometry()
      vp._editor.signals.paperViewportsChanged.dispatch()
      return element
    }

    const parent = element.parent()
    const worldToParent = parent.ctm().inverse().multiply(this.editor.drawing.ctm())
    const baseInParent = applyMatrixToPoint(worldToParent, this.basePoint.x, this.basePoint.y)

    // Create the scaling matrix in the parent's space
    const sInParent = new SVG.Matrix().scale(factor, factor, baseInParent.x, baseInParent.y)

    // Combine the new scale with the element's original local transformation
    const finalLocalMatrix = sInParent.multiply(originalPos.matrix)

    // Set the new transform and bake it into the geometry
    element.transform(finalLocalMatrix)
    return bakeTransforms(element)
  }

  performScale() {
    try {
      this.selectedElements = this.selectedElements.map((element, index) => {
        const originalPos = this.originalPositions[index]
        return this.applyScale(element, originalPos, this.scaleFactor)
      })

      this.editor.signals.terminalLogged.dispatch({ msg: `Scale applied to ${this.selectedElements.length} elements.` })
      this.editor.signals.clearSelection.dispatch()
      this.editor.selected = []
    } catch (e) {
      console.error('Error in performScale:', e)
      this.editor.signals.terminalLogged.dispatch({
        msg: `Error applying scale: ${e.message}. See console for details.`
      })
      if (e.stack) {
        console.error(e.stack)
      }
    }
  }

  undo() {
    this.selectedElements.forEach((element, index) => {
      const originalPos = this.originalPositions[index]
      if (originalPos.type === 'line' || originalPos.type === 'polyline' || originalPos.type === 'polygon' || originalPos.type === 'points' || originalPos.type === 'path') {
        element.plot(originalPos.points || originalPos.d)
      } else if (originalPos.type === 'circle') {
        element.center(originalPos.cx, originalPos.cy)
        element.radius(originalPos.radius)
      } else if (originalPos.type === 'ellipse') {
        element.center(originalPos.cx, originalPos.cy)
        element.rx(originalPos.rx)
        element.ry(originalPos.ry)
      } else if (originalPos.type === 'rect') {
        if (element.type === 'polygon') {
          const rect = element.parent().rect(originalPos.width, originalPos.height)
          rect.move(originalPos.x, originalPos.y)
          rect.attr(originalPos.attrs)
          element.remove()
          this.selectedElements[index] = rect
        } else {
          element.move(originalPos.x, originalPos.y)
          element.size(originalPos.width, originalPos.height)
        }
      } else if (originalPos.type === 'image') {
        element.move(originalPos.x, originalPos.y)
        element.size(originalPos.width, originalPos.height)
      } else {
        // fallback
        element.move(originalPos.x, originalPos.y)
        if (originalPos.transform) {
          element.transform(originalPos.transform)
        } else if (originalPos.matrix) {
          element.transform(originalPos.matrix)
        }
      }

      // Restore metadata
      if (originalPos.arcData) element.data('arcData', originalPos.arcData)
      if (originalPos.circleTrimData) element.data('circleTrimData', originalPos.circleTrimData)
      if (originalPos.splineData) element.data('splineData', originalPos.splineData)
    })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Undo: Scale reset.' })
  }

  redo() {
    this.undo() // Reset to original state first
    this.performScale()
    this.editor.signals.terminalLogged.dispatch({ msg: 'Redo: Scale applied again.' })
  }
}

function scaleCommand(editor) {
  const scaleCommand = new ScaleCommand(editor)
  scaleCommand.execute()
}

export { scaleCommand }
