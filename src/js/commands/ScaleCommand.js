import { Command } from '../Command'
import { calculateDistance } from '../utils/calculateDistance'
import {
  hasOwnGeometryTransform,
  hasUnsupportedAncestorTransform,
} from '../utils/geometryTransformQualification'
import { bakeTransforms } from '../utils/transformGeometry'

const TRANSFORMED_SCALE_DIAGNOSTIC = 'SCALE does not support transformed primitive geometry or geometry inside transformed groups.'

function hasUnsupportedScaleTransform(element, drawing) {
  if (hasUnsupportedAncestorTransform(element, drawing)) return true
  return !['g', 'use'].includes(element.type) && hasOwnGeometryTransform(element)
}

class ScaleCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'ScaleCommand'
    this.name = 'Scale'
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.interactiveExecutionDone = false
    this.scaleFactor = 1
    this.originalPositions = []
    this.elementReplacements = []
  }

  execute() {
    if (this.editor.mode === 'paper') {
      this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
      this.editor.signals.terminalLogged.dispatch({ type: 'error', msg: 'Command not available in Paper Space.' })
      return
    }
    if (this.interactiveExecutionDone) {
      this.performScale()
      return
    }
    this.editor.signals.commandCancelled.addOnce(this.cleanup, this)
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
    if (selectedElements.some((element) => (
      hasUnsupportedScaleTransform(element, this.editor.drawing)
    ))) {
      this.editor.signals.terminalLogged.dispatch({
        msg: TRANSFORMED_SCALE_DIAGNOSTIC,
        type: 'error',
      })
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
      this.commitScale()
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
    this.scaleFactor = parseFloat(scaleFactor)
    this.editor.distance = null

    this.commitScale()
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

    this.commitScale()
  }

  commitScale() {
    if (!Number.isFinite(this.scaleFactor) || this.scaleFactor <= 0) {
      this.editor.signals.terminalLogged.dispatch({ msg: 'Enter a scale factor greater than zero.', type: 'error' })
      this.cleanup()
      return
    }

    this.cleanup()
    this.interactiveExecutionDone = true
    this.editor.execute(this)
  }

  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    this.editor.signals.commandCancelled.remove(this.cleanup, this)
    this.editor.signals.pointCaptured.remove(this.onBasePoint, this)
    this.editor.signals.pointCaptured.remove(this.onSecondPoint, this)
    this.editor.signals.inputValue.remove(this.onScaleFactor, this)
    this.editor.isInteracting = false
    this.editor.suppressHandlers = false
    this.deferSessionTask(() => {
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
      transformAttribute: element.attr('transform'),
      parent: element.parent(),
      nextSibling: element.node.nextSibling,
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
      pos.points = element.array().map((segment) => [...segment])
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
    } else if (element.type === 'use') {
      pos.x = element.x()
      pos.y = element.y()
      pos.transform = element.transform()
    } else if (element.type === 'text' || element.type === 'g') {
      pos.transform = element.transform()
    } else {
      // fallback
      if (element.x) pos.x = element.x()
      if (element.y) pos.y = element.y()
      if (element.transform) pos.transform = element.transform()
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
      this.dispatchSignal('paperViewportsChanged')
      return element
    }

    // Block instances: restore decomposed transform, compose scale, skip bake
    // Matches the ghost preview path (transform → scale) exactly
    if (element.type === 'use' && element.attr('data-block-instance') === 'true') {
      element.transform(originalPos.transform)
      element.scale(factor, factor, this.basePoint.x, this.basePoint.y)
      return element
    }

    // Baking a group changes every child and cannot be reversed by restoring
    // only the group's transform. Keep group geometry intact and compose the
    // scale on the group itself so Undo/Redo remains lossless.
    if (element.type === 'g') {
      element.transform(originalPos.matrix)
      element.scale(factor, factor, this.basePoint.x, this.basePoint.y)
      return element
    }

    // Restore the element's original local transform, then apply scale via SVG.js
    // relative mode — identical to what the ghost preview does — then bake.
    element.transform(originalPos.matrix)
    element.scale(factor, factor, this.basePoint.x, this.basePoint.y)
    return bakeTransforms(element)
  }

  performScale({ updateSelection = true } = {}) {
    const workingElements = this.selectedElements.slice()
    try {
      workingElements.forEach((element, index) => {
        const originalPos = this.originalPositions[index]
        if (originalPos.type === 'rect' && this.elementReplacements[index]) {
          workingElements[index] = this.activateReplacement(index)
          return
        }
        const transformedElement = this.applyScale(element, originalPos, this.scaleFactor)
        workingElements[index] = transformedElement
        if (originalPos.type === 'rect' && transformedElement !== element) {
          this.elementReplacements[index] = {
            nextSibling: originalPos.nextSibling,
            original: element,
            parent: originalPos.parent,
            transformed: transformedElement,
          }
          // bakeTransforms detaches the rectangle after applying a temporary
          // scale matrix. Keep that inactive original canonical so a failed
          // Undo/Redo rollback does not retain hidden transformed state.
          element.attr(originalPos.attrs)
          element.transform(originalPos.matrix)
          if (originalPos.transformAttribute == null) {
            element.node.removeAttribute('transform')
          } else {
            element.attr('transform', originalPos.transformAttribute)
          }
        }
      })
      this.selectedElements = workingElements

      this.dispatchSignal('terminalLogged', { msg: `Scale applied to ${this.selectedElements.length} elements.` })
      if (updateSelection) {
        this.dispatchSignal('clearSelection')
        this.editor.selected = []
      }
      this.invalidateGeometry()
    } catch (e) {
      this.selectedElements = workingElements
      try {
        this.restoreOriginalPositions()
      } catch (rollbackError) {
        this.invalidateGeometry()
        throw new AggregateError(
          [e, rollbackError],
          'Scale failed and its original geometry could not be fully restored.',
          { cause: e },
        )
      }
      this.invalidateGeometry()
      this.dispatchSignal('terminalLogged', {
        msg: `Error applying scale: ${e.message}. See console for details.`
      })
      throw e
    }
  }

  undo() {
    try {
      this.restoreOriginalPositions()
    } catch (error) {
      try {
        // A geometry method may throw before resetting the failing element.
        // Complete a clean original-state pass before scaling from that base.
        this.restoreOriginalPositions()
        this.performScale({ updateSelection: false })
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Scale Undo failed and the applied geometry could not be fully restored.',
          { cause: error },
        )
      }
      throw error
    }
    this.invalidateGeometry()
    this.dispatchSignal('terminalLogged', { msg: 'Undo: Scale reset.' })
  }

  restoreOriginalPositions() {
    for (let index = this.selectedElements.length - 1; index >= 0; index -= 1) {
      const element = this.selectedElements[index]
      const originalPos = this.originalPositions[index]
      let restoredElement = element
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
        if (this.elementReplacements[index]) {
          restoredElement = this.restoreReplacement(index)
        } else {
          element.move(originalPos.x, originalPos.y)
        }
        restoredElement.move(originalPos.x, originalPos.y)
        restoredElement.size(originalPos.width, originalPos.height)
        restoredElement.attr(originalPos.attrs)
      } else if (originalPos.type === 'image') {
        element.move(originalPos.x, originalPos.y)
        element.size(originalPos.width, originalPos.height)
      } else if (originalPos.type === 'use') {
        element.transform(originalPos.transform)
      } else if (originalPos.type === 'text' || originalPos.type === 'g') {
        element.transform(originalPos.transform)
      } else {
        // fallback
        if (originalPos.x !== undefined && originalPos.y !== undefined) {
            element.move(originalPos.x, originalPos.y)
        }
        if (originalPos.transform) {
          element.transform(originalPos.transform)
        } else if (originalPos.matrix) {
          element.transform(originalPos.matrix)
        }
      }

      if (restoredElement.transform && originalPos.matrix) {
        restoredElement.transform(originalPos.matrix)
        if (originalPos.transformAttribute == null) {
          restoredElement.node.removeAttribute('transform')
        } else {
          restoredElement.attr('transform', originalPos.transformAttribute)
        }
      }

      // Restore metadata
      if (originalPos.arcData) restoredElement.data('arcData', originalPos.arcData)
      if (originalPos.circleTrimData) restoredElement.data('circleTrimData', originalPos.circleTrimData)
      if (originalPos.splineData) restoredElement.data('splineData', originalPos.splineData)
      const reference = originalPos.nextSibling?.parentNode === originalPos.parent?.node
        ? originalPos.nextSibling
        : null
      if (originalPos.parent) {
        originalPos.parent.node.insertBefore(restoredElement.node, reference)
      }
    }
  }

  activateReplacement(index) {
    const replacement = this.elementReplacements[index]
    const { original, parent, transformed } = replacement
    if (original.node.parentNode === parent.node) {
      parent.node.insertBefore(transformed.node, original.node)
      original.remove()
    } else {
      const reference = replacement.nextSibling?.parentNode === parent.node
        ? replacement.nextSibling
        : null
      parent.node.insertBefore(transformed.node, reference)
    }
    return transformed
  }

  restoreReplacement(index) {
    const replacement = this.elementReplacements[index]
    const { original, parent, transformed } = replacement
    if (transformed.node.parentNode === parent.node) {
      parent.node.insertBefore(original.node, transformed.node)
      transformed.remove()
    } else if (original.node.parentNode !== parent.node) {
      const reference = replacement.nextSibling?.parentNode === parent.node
        ? replacement.nextSibling
        : null
      parent.node.insertBefore(original.node, reference)
    }
    this.selectedElements[index] = original
    return original
  }

  redo() {
    this.performScale()
    this.dispatchSignal('terminalLogged', { msg: 'Redo: Scale applied again.' })
  }

  invalidateGeometry() {
    this.editor.spatialIndex.markDirty()
    this.editor.fullSpatialIndex.markDirty()
    this.dispatchSignal('updatedProperties')
    this.dispatchSignal('updatedOutliner')
  }
}

function scaleCommand(editor) {
  const scaleCommand = new ScaleCommand(editor)
  scaleCommand.execute()
}

export { scaleCommand, ScaleCommand }
