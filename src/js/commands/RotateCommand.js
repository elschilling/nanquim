import { Command } from '../Command'
import { Matrix } from '@svgdotjs/svg.js'
import {
  hasOwnGeometryTransform,
  hasUnsupportedAncestorTransform,
} from '../utils/geometryTransformQualification'

const TRANSFORMED_ROTATE_DIAGNOSTIC = 'ROTATE does not support transformed primitive geometry or geometry inside transformed groups.'

function hasUnsupportedRotateTransform(element, drawing) {
  if (hasUnsupportedAncestorTransform(element, drawing)) return true
  return !['g', 'use'].includes(element.type) && hasOwnGeometryTransform(element)
}

class RotateCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'RotateCommand'
    this.name = 'Rotate'
    // Store bound function reference for proper cleanup
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.interactiveExecutionDone = false
    this.elementReplacements = []
  }

  execute() {
    if (this.interactiveExecutionDone) {
      this.performRotation()
      return
    }
    if (this.editor.mode === 'paper') {
      this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
      this.editor.signals.terminalLogged.dispatch({ type: 'error', msg: 'Command not available in Paper Space.' })
      return
    }
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
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
      msg: `Select elements to Rotate and press Enter to confirm.`,
    })
    // Use the stored bound reference
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
    this.selectedElements = this.editor.selected.slice() // Create a copy
    if (this.selectedElements.length === 0) {
      this.editor.signals.terminalLogged.dispatch({ msg: 'No elements selected. Command cancelled.' })
      this.cleanup()
      return
    }
    if (this.selectedElements.some((element) => (
      hasUnsupportedRotateTransform(element, this.editor.drawing)
    ))) {
      this.editor.signals.terminalLogged.dispatch({
        msg: TRANSFORMED_ROTATE_DIAGNOSTIC,
        type: 'error',
      })
      this.cleanup()
      return
    }

    // Disable rectangle selection during transform operations
    this.editor.selectSingleElement = true

    // Store original states AND original coordinates for each element BEFORE any rotation
    this.originalStates = this.selectedElements.map((element) => this.getElementState(element))
    this.originalCoordinates = this.selectedElements.map((element) => this.getElementCoordinates(element))

    this.editor.signals.terminalLogged.dispatch({ msg: `Selected ${this.selectedElements.length} elements.` })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Specify center point.' })
    this.editor.signals.pointCaptured.addOnce(this.onCenterPoint, this)
  }

  onCenterPoint(point) {
    this.centerPoint = point
    this.editor.signals.terminalLogged.dispatch({ msg: `Center point: ${this.centerPoint.x.toFixed(2)}, ${this.centerPoint.y.toFixed(2)}` })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Specify reference point or an angle to rotate.' })
    this.editor.signals.pointCaptured.addOnce(this.onReferencePoint, this)
    this.editor.signals.inputValue.addOnce(this.onAngleInput, this)
  }

  onAngleInput() {
    this.editor.signals.pointCaptured.remove(this.onReferencePoint, this)
    if (Number.isFinite(this.editor.distance)) {
      this.angle = this.editor.distance
      this.angleRad = this.angle * (Math.PI / 180)
      this.editor.distance = null
      this.commitRotation()
    }
  }

  onReferencePoint(point) {
    this.editor.signals.inputValue.remove(this.onAngleInput, this)
    this.referencePoint = point
    this.editor.signals.terminalLogged.dispatch({
      msg: `Reference point: ${this.referencePoint.x.toFixed(2)}, ${this.referencePoint.y.toFixed(2)}`,
    })
    this.editor.signals.rotateGhostingStarted.dispatch(this.selectedElements, this.centerPoint, this.referencePoint)
    this.editor.signals.terminalLogged.dispatch({ msg: 'Specify the target point.' })
    this.editor.signals.pointCaptured.addOnce(this.onTargetPoint, this)
  }

  onTargetPoint(point) {
    this.targetPoint = point
    this.editor.signals.terminalLogged.dispatch({
      msg: `Target point: ${this.targetPoint.x.toFixed(2)}, ${this.targetPoint.y.toFixed(2)}`,
    })

    // Calculate vectors from center point to reference and target points
    const vec1 = { x: this.referencePoint.x - this.centerPoint.x, y: this.referencePoint.y - this.centerPoint.y }
    const vec2 = { x: this.targetPoint.x - this.centerPoint.x, y: this.targetPoint.y - this.centerPoint.y }

    // Use atan2 of the cross product and dot product to get the signed angle
    const dot = vec1.x * vec2.x + vec1.y * vec2.y
    const cross = vec1.x * vec2.y - vec1.y * vec2.x
    const angleRad = Math.atan2(cross, dot)

    this.angle = angleRad * (180 / Math.PI) // convert to degrees
    this.angleRad = angleRad // keep radians for calculations

    this.editor.signals.terminalLogged.dispatch({
      msg: `Rotation angle: ${this.angle.toFixed(2)}°`,
    })

    this.commitRotation()
  }

  commitRotation() {
    if (!Number.isFinite(this.angleRad) || !this.centerPoint) {
      this.editor.signals.terminalLogged.dispatch({ msg: 'Enter a valid rotation angle.', type: 'error' })
      this.cleanup()
      return
    }

    this.cleanup()
    this.interactiveExecutionDone = true
    this.editor.execute(this)
    this.dispatchSignal('terminalLogged', { msg: `Elements rotated by ${this.angle.toFixed(2)} degrees.` })
  }

  performRotation({ updateSelection = true } = {}) {
    const workingElements = this.selectedElements.slice()

    try {
      workingElements.forEach((element, index) => {
        if (!element || !element.type) {
          return
        }

        const originalCoords = this.originalCoordinates[index]
        if (!originalCoords) {
          return
        }

        if (element._paperVp) {
          this.editor.signals.terminalLogged.dispatch({ msg: 'Viewports cannot be rotated.', type: 'error' })
          return
        }

        if (originalCoords.type === 'rect' && this.elementReplacements[index]) {
          workingElements[index] = this.activateReplacement(index)
          return
        }

        try {
          const transformedElement = this.rotateElementFromOriginal(
            element,
            originalCoords,
            this.angleRad,
            this.centerPoint,
          )
          workingElements[index] = transformedElement
          if (originalCoords.type === 'rect' && transformedElement !== element) {
            const originalState = this.originalStates[index]
            this.elementReplacements[index] = {
              nextSibling: originalState.nextSibling,
              original: element,
              parent: originalState.parent,
              transformed: transformedElement,
            }
          }
        } catch (error) {
          throw new Error(`Unable to rotate element ${index + 1}.`, { cause: error })
        }
      })
    } catch (error) {
      this.selectedElements = workingElements
      try {
        this.restoreOriginalStates()
      } catch (rollbackError) {
        this.invalidateGeometry()
        throw new AggregateError(
          [error, rollbackError],
          'Rotation failed and its original geometry could not be fully restored.',
          { cause: error },
        )
      }
      this.invalidateGeometry()
      throw error
    }

    this.selectedElements = workingElements

    if (updateSelection) {
      this.dispatchSignal('clearSelection')
      this.editor.selected = []
    }
    this.invalidateGeometry()
  }

  getElementCoordinates(element) {
    const data = {
      arcData: element.data('arcData'),
      circleTrimData: element.data('circleTrimData'),
      splineData: element.data('splineData')
    }

    // Store just the coordinate data that we need for rotation
    if (element.type === 'line' || element.type === 'polyline' || element.type === 'polygon') {
      return {
        type: 'points',
        points: element.array().map((point) => [...point]), // Deep copy of points
        ...data
      }
    } else if (element.type === 'circle') {
      return {
        type: 'circle',
        cx: element.cx(),
        cy: element.cy(),
        ...data
      }
    } else if (element.type === 'ellipse') {
      return {
        type: 'ellipse',
        cx: element.cx(),
        cy: element.cy(),
        ...data
      }
    } else if (element.type === 'rect') {
      return {
        type: 'rect',
        x: element.x(),
        y: element.y(),
        width: element.width(),
        height: element.height(),
        ...data
      }
    } else if (element.type === 'use') {
      return {
        type: 'use',
        transform: element.transform(),
        ...data
      }
    } else if (element.type === 'text' || element.type === 'g') {
      return {
        type: element.type,
        transform: element.transform(),
        ...data
      }
    } else if (element.type === 'path') {
      return {
        type: 'path',
        d: element.attr('d'),
        ...data
      }
    } else {
      return {
        type: 'generic',
        x: element.x ? element.x() : 0,
        y: element.y ? element.y() : 0,
        ...data
      }
    }
  }

  rotateElementFromOriginal(element, originalCoords, angleRad, centerPoint) {
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)
    const cx = centerPoint.x
    const cy = centerPoint.y

    // Helper function to rotate a point around the center
    const rotatePoint = (x, y) => {
      const dx = x - cx
      const dy = y - cy
      const rotatedX = cx + dx * cos - dy * sin
      const rotatedY = cy + dx * sin + dy * cos

      return {
        x: rotatedX,
        y: rotatedY,
      }
    }

    // Update arcData if it exists
    if (originalCoords.arcData) {
      const ad = originalCoords.arcData
      const p1 = rotatePoint(ad.p1.x, ad.p1.y)
      const p2 = rotatePoint(ad.p2.x, ad.p2.y)
      const p3 = rotatePoint(ad.p3.x, ad.p3.y)
      element.data('arcData', { p1, p2, p3 })
    }

    // Update circleTrimData if it exists
    if (originalCoords.circleTrimData) {
      const ctd = originalCoords.circleTrimData
      const center = rotatePoint(ctd.cx, ctd.cy)
      const sPt = rotatePoint(ctd.startPt.x, ctd.startPt.y)
      const ePt = rotatePoint(ctd.endPt.x, ctd.endPt.y)
      element.data('circleTrimData', {
        ...ctd,
        cx: center.x,
        cy: center.y,
        startPt: sPt,
        endPt: ePt
      })
    }

    if (originalCoords.splineData) {
      const sd = originalCoords.splineData
      element.data('splineData', {
        points: sd.points.map(p => {
          const rp = rotatePoint(p.x, p.y)
          return { x: rp.x, y: rp.y }
        })
      })
    }

    if (originalCoords.type === 'points') {
      // Rotate all points from the original coordinates

      const rotatedPoints = originalCoords.points.map(([x, y]) => {
        const rotated = rotatePoint(x, y)
        return [rotated.x, rotated.y]
      })

      element.plot(rotatedPoints)
    } else if (originalCoords.type === 'circle') {
      // Rotate the center point from original position
      const rotated = rotatePoint(originalCoords.cx, originalCoords.cy)
      element.center(rotated.x, rotated.y)
    } else if (originalCoords.type === 'ellipse') {
      // Rotate the center point from original position
      const rotated = rotatePoint(originalCoords.cx, originalCoords.cy)
      element.center(rotated.x, rotated.y)
    } else if (originalCoords.type === 'rect') {
      // Calculate the four corners from original rectangle
      const corners = [
        { x: originalCoords.x, y: originalCoords.y },
        { x: originalCoords.x + originalCoords.width, y: originalCoords.y },
        { x: originalCoords.x + originalCoords.width, y: originalCoords.y + originalCoords.height },
        { x: originalCoords.x, y: originalCoords.y + originalCoords.height },
      ]

      // Rotate all corners
      const rotatedCorners = corners.map((corner) => rotatePoint(corner.x, corner.y))

      // Convert to polygon since rotated rectangle is no longer axis-aligned
      const polygonPoints = rotatedCorners.map((corner) => [corner.x, corner.y])

      // Check if element and its parent are still valid
      const parent = element.parent ? element.parent() : null
      if (!parent) {
        console.error('Element has no valid parent, skipping rotation')
        return element
      }

      try {
        // Replace rectangle with polygon
        const nextSibling = element.node.nextSibling
        const polygon = parent.polygon(polygonPoints)
        polygon.attr(element.attr()) // Copy attributes
        if (nextSibling?.parentNode === parent.node) {
          parent.node.insertBefore(polygon.node, nextSibling)
        }
        element.remove() // Remove original rectangle

        // Update reference to the new polygon
        return polygon
      } catch (error) {
        console.error('Failed to create polygon:', error)
        // Fallback: just move the rectangle to the rotated position without converting
        const rotated = rotatePoint(originalCoords.x, originalCoords.y)
        element.move(rotated.x, rotated.y)
        if (element.transform) {
          element.transform({ rotate: this.angle })
        }
      }
    } else if (originalCoords.type === 'use') {
      // Block instances: restore decomposed transform, compose rotation
      // Matches the ghost preview path (transform → rotate) exactly
      element.transform(originalCoords.transform)
      element.rotate(this.angle, centerPoint.x, centerPoint.y)
    } else if (originalCoords.type === 'text' || originalCoords.type === 'g') {
      // Use pure Matrix transformation for text and block groups to avoid coordinate lock bugs
      const matrix = new Matrix(originalCoords.transform)
      element.transform(matrix.rotate(this.angle, centerPoint.x, centerPoint.y))
    } else if (originalCoords.type === 'path') {
      // For paths, rotate from original path data
      this.rotatePathFromOriginal(element, originalCoords.d, angleRad, centerPoint)
    } else {
      // Generic case: rotate from original position
      const rotated = rotatePoint(originalCoords.x, originalCoords.y)
      if (element.move) {
        element.move(rotated.x, rotated.y)
      }
      if (element.transform) {
        element.transform({ rotate: this.angle })
      }
    }

    return element
  }

  rotatePathFromOriginal(pathElement, originalPathData, angleRad, centerPoint) {
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)
    const cx = centerPoint.x
    const cy = centerPoint.y
    const angleDeg = angleRad * (180 / Math.PI)

    const rotatePoint = (x, y) => {
      const dx = x - cx
      const dy = y - cy
      return {
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos,
      }
    }

    // Create a temporary path element to parse the original path data.
    // This avoids any side effects on the actual element and leverages svg.js's parser.
    const tempPath = pathElement.parent().path(originalPathData)
    const pathArray = tempPath.array()
    tempPath.remove()

    const newPathArray = []
    let lastPoint = { x: 0, y: 0 }

    for (const segment of pathArray) {
      const newSegment = [...segment]
      const command = newSegment[0]

      switch (command) {
        case 'M': {
          const p = rotatePoint(newSegment[1], newSegment[2])
          newSegment[1] = p.x
          newSegment[2] = p.y
          lastPoint = { x: newSegment[1], y: newSegment[2] }
          break
        }
        case 'L':
        case 'T': {
          const p = rotatePoint(newSegment[1], newSegment[2])
          newSegment[1] = p.x
          newSegment[2] = p.y
          lastPoint = { x: newSegment[1], y: newSegment[2] }
          break
        }
        case 'H': {
          const p = rotatePoint(newSegment[1], lastPoint.y)
          newSegment[0] = 'L' // Convert H to L
          newSegment[1] = p.x
          newSegment[2] = p.y
          lastPoint = { x: p.x, y: p.y }
          break
        }
        case 'V': {
          const p = rotatePoint(lastPoint.x, newSegment[1])
          newSegment[0] = 'L' // Convert V to L
          newSegment[1] = p.x
          newSegment[2] = p.y
          lastPoint = { x: p.x, y: p.y }
          break
        }
        case 'C': {
          const p1 = rotatePoint(newSegment[1], newSegment[2])
          newSegment[1] = p1.x
          newSegment[2] = p1.y
          const p2 = rotatePoint(newSegment[3], newSegment[4])
          newSegment[3] = p2.x
          newSegment[4] = p2.y
          const p3 = rotatePoint(newSegment[5], newSegment[6])
          newSegment[5] = p3.x
          newSegment[6] = p3.y
          lastPoint = { x: newSegment[5], y: newSegment[6] }
          break
        }
        case 'S':
        case 'Q': {
          const p1 = rotatePoint(newSegment[1], newSegment[2])
          newSegment[1] = p1.x
          newSegment[2] = p1.y
          const p2 = rotatePoint(newSegment[3], newSegment[4])
          newSegment[3] = p2.x
          newSegment[4] = p2.y
          lastPoint = { x: newSegment[3], y: newSegment[4] }
          break
        }
        case 'A': {
          // A rx ry x-axis-rotation large-arc-flag sweep-flag x y
          newSegment[3] = parseFloat(newSegment[3]) + angleDeg
          const p = rotatePoint(newSegment[6], newSegment[7])
          newSegment[6] = p.x
          newSegment[7] = p.y
          lastPoint = { x: newSegment[6], y: newSegment[7] }
          break
        }
        case 'Z':
        case 'z':
          // No parameters to change
          break
        default:
          console.warn(`Unhandled path command: ${command}. Rotation may be incorrect.`)
      }
      newPathArray.push(newSegment)
    }

    pathElement.plot(newPathArray)
  }

  getElementState(element) {
    const data = {
      arcData: element.data('arcData'),
      circleTrimData: element.data('circleTrimData'),
      splineData: element.data('splineData'),
      transformAttribute: element.attr('transform'),
      parent: element.parent(),
      nextSibling: element.node.nextSibling,
    }
    // Store the current state for undo - need to capture actual coordinates
    if (element.type === 'line' || element.type === 'polyline' || element.type === 'polygon') {
      return {
        type: 'points',
        points: element.array().map((point) => [...point]), // Deep copy
        ...data,
      }
    } else if (element.type === 'circle') {
      return {
        type: 'circle',
        cx: element.cx(),
        cy: element.cy(),
        radius: element.radius ? element.radius() : element.attr('r'), // Try both methods
        ...data,
      }
    } else if (element.type === 'ellipse') {
      return {
        type: 'ellipse',
        cx: element.cx(),
        cy: element.cy(),
        rx: element.rx ? element.rx() : element.attr('rx'),
        ry: element.ry ? element.ry() : element.attr('ry'),
        ...data,
      }
    } else if (element.type === 'rect') {
      return {
        type: 'rect',
        x: element.x(),
        y: element.y(),
        width: element.width(),
        height: element.height(),
        attrs: { ...element.attr() }, // Copy all attributes
        ...data,
      }
    } else if (element.type === 'use') {
      return {
        type: 'use',
        transform: element.transform(),
        ...data,
      }
    } else if (element.type === 'text' || element.type === 'g') {
      return {
        type: element.type,
        transform: element.transform(),
        ...data,
      }
    } else if (element.type === 'path') {
      return {
        type: 'path',
        d: element.attr('d'),
        ...data,
      }
    } else {
      return {
        type: 'generic',
        x: element.x ? element.x() : 0,
        y: element.y ? element.y() : 0,
        transform: element.transform ? element.transform() : null,
        ...data,
      }
    }
  }

  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    this.editor.signals.commandCancelled.remove(this.cleanup, this)
    this.editor.signals.pointCaptured.remove(this.onCenterPoint, this)
    this.editor.signals.pointCaptured.remove(this.onReferencePoint, this)
    this.editor.signals.pointCaptured.remove(this.onTargetPoint, this)
    this.editor.signals.inputValue.remove(this.onAngleInput, this)
    this.editor.isInteracting = false
    this.editor.suppressHandlers = false
    this.deferSessionTask(() => {
      this.editor.selectSingleElement = false
    }, 10)
    this.editor.signals.rotateGhostingStopped.dispatch()
  }

  undo() {
    try {
      this.restoreOriginalStates()
    } catch (error) {
      try {
        this.performRotation({ updateSelection: false })
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Rotation Undo failed and the applied geometry could not be fully restored.',
          { cause: error },
        )
      }
      throw error
    }
    this.invalidateGeometry()
    this.dispatchSignal('terminalLogged', { msg: 'Undo: Rotation reversed.' })
  }

  restoreOriginalStates() {
    for (let index = this.selectedElements.length - 1; index >= 0; index -= 1) {
      const element = this.selectedElements[index]
      const originalState = this.originalStates[index]
      let restoredElement = element

      if (originalState.type === 'points') {
        element.plot(originalState.points)
      } else if (originalState.type === 'circle') {
        element.center(originalState.cx, originalState.cy)
      } else if (originalState.type === 'ellipse') {
        element.center(originalState.cx, originalState.cy)
      } else if (originalState.type === 'rect') {
        if (this.elementReplacements[index]) {
          restoredElement = this.restoreReplacement(index)
        } else {
          element.move(originalState.x, originalState.y)
        }
        restoredElement.move(originalState.x, originalState.y)
        restoredElement.size(originalState.width, originalState.height)
        restoredElement.attr(originalState.attrs)
      } else if (originalState.type === 'use') {
        element.transform(originalState.transform)
      } else if (originalState.type === 'text' || originalState.type === 'g') {
        const matrix = originalState.transform
        element.transform(matrix)
      } else if (originalState.type === 'path') {
        element.attr('d', originalState.d)
      } else {
        if (element.move) {
          element.move(originalState.x, originalState.y)
        }
        if (originalState.transform && element.transform) {
          element.transform(originalState.transform)
        }
      }

      if (originalState.arcData) restoredElement.data('arcData', originalState.arcData)
      if (originalState.circleTrimData) restoredElement.data('circleTrimData', originalState.circleTrimData)
      if (originalState.splineData) restoredElement.data('splineData', originalState.splineData)
      if (originalState.transformAttribute == null) {
        restoredElement.node.removeAttribute('transform')
      } else {
        restoredElement.attr('transform', originalState.transformAttribute)
      }
      const reference = originalState.nextSibling?.parentNode === originalState.parent?.node
        ? originalState.nextSibling
        : null
      if (originalState.parent) {
        originalState.parent.node.insertBefore(restoredElement.node, reference)
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
    this.performRotation()
    this.dispatchSignal('terminalLogged', { msg: 'Redo: Rotation reapplied.' })
  }

  invalidateGeometry() {
    this.editor.spatialIndex.markDirty()
    this.editor.fullSpatialIndex.markDirty()
    this.dispatchSignal('updatedProperties')
    this.dispatchSignal('updatedOutliner')
  }
}

function rotateCommand(editor) {
  const rotateCommand = new RotateCommand(editor)
  rotateCommand.execute()
}

export { rotateCommand, RotateCommand }
