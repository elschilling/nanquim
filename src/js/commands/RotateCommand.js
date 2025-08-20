import { Command } from '../Command'

class RotateCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'RotateCommand'
    this.name = 'Rotate'
    // Store bound function reference for proper cleanup
    this.boundOnKeyDown = this.onKeyDown.bind(this)
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Select elements to Rotate and press Enter to confirm.`,
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
    if (this.editor.distance) {
      this.angle = this.editor.distance
      this.angleRad = this.angle * (Math.PI / 180)
      this.editor.distance = null
      this.performRotation()
      this.editor.execute(this)
      this.editor.lastCommand = this
      this.cleanup()
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
    this.cleanup()
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

    this.performRotation()
    this.editor.signals.terminalLogged.dispatch({ msg: `Elements rotated by ${this.angle.toFixed(2)} degrees.` })

    // Set up for undo/redo system
    this.editor.execute(this)
    this.editor.lastCommand = this
    this.cleanup()
  }

  performRotation() {
    const newSelectedElements = []

    this.selectedElements.forEach((element, index) => {
      // Check if element is still valid
      if (!element || !element.type) {
        newSelectedElements.push(element)
        return
      }

      // Use the original coordinates stored at selection time
      const originalCoords = this.originalCoordinates[index]
      if (!originalCoords) {
        newSelectedElements.push(element)
        return
      }

      if (element.type === 'line') {
      }

      try {
        const newElement = this.rotateElementFromOriginal(element, originalCoords, this.angleRad, this.centerPoint)
        newSelectedElements.push(newElement)

        if (newElement.type === 'line') {
        }
      } catch (error) {
        console.error(`Error rotating element ${index}:`, error)
        newSelectedElements.push(element)
        // Continue with other elements
      }
    })

    this.selectedElements = newSelectedElements

    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = []
  }

  getElementCoordinates(element) {
    // Store just the coordinate data that we need for rotation
    if (element.type === 'line' || element.type === 'polyline' || element.type === 'polygon') {
      return {
        type: 'points',
        points: element.array().map((point) => [...point]), // Deep copy of points
      }
    } else if (element.type === 'circle') {
      return {
        type: 'circle',
        cx: element.cx(),
        cy: element.cy(),
      }
    } else if (element.type === 'ellipse') {
      return {
        type: 'ellipse',
        cx: element.cx(),
        cy: element.cy(),
      }
    } else if (element.type === 'rect') {
      return {
        type: 'rect',
        x: element.x(),
        y: element.y(),
        width: element.width(),
        height: element.height(),
      }
    } else if (element.type === 'text') {
      return {
        type: 'text',
        x: element.x(),
        y: element.y(),
      }
    } else if (element.type === 'path') {
      return {
        type: 'path',
        d: element.attr('d'),
      }
    } else {
      return {
        type: 'generic',
        x: element.x ? element.x() : 0,
        y: element.y ? element.y() : 0,
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
        const polygon = parent.polygon(polygonPoints)
        polygon.attr(element.attr()) // Copy attributes
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
    } else if (originalCoords.type === 'text') {
      // Rotate text position from original
      const rotated = rotatePoint(originalCoords.x, originalCoords.y)
      element.move(rotated.x, rotated.y)
      element.transform({ rotate: this.angle })
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
    // Store the current state for undo - need to capture actual coordinates
    if (element.type === 'line' || element.type === 'polyline' || element.type === 'polygon') {
      return {
        type: 'points',
        points: element.array().map((point) => [...point]), // Deep copy
      }
    } else if (element.type === 'circle') {
      return {
        type: 'circle',
        cx: element.cx(),
        cy: element.cy(),
        radius: element.radius ? element.radius() : element.attr('r'), // Try both methods
      }
    } else if (element.type === 'ellipse') {
      return {
        type: 'ellipse',
        cx: element.cx(),
        cy: element.cy(),
        rx: element.rx ? element.rx() : element.attr('rx'),
        ry: element.ry ? element.ry() : element.attr('ry'),
      }
    } else if (element.type === 'rect') {
      return {
        type: 'rect',
        x: element.x(),
        y: element.y(),
        width: element.width(),
        height: element.height(),
        attrs: { ...element.attr() }, // Copy all attributes
      }
    } else if (element.type === 'text') {
      return {
        type: 'text',
        x: element.x(),
        y: element.y(),
        transform: element.transform ? element.transform() : null,
      }
    } else if (element.type === 'path') {
      return {
        type: 'path',
        d: element.attr('d'),
      }
    } else {
      return {
        type: 'generic',
        x: element.x ? element.x() : 0,
        y: element.y ? element.y() : 0,
        transform: element.transform ? element.transform() : null,
      }
    }
  }

  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    this.editor.isInteracting = false
    this.editor.signals.rotateGhostingStopped.dispatch()
  }

  undo() {
    this.selectedElements.forEach((element, index) => {
      const originalState = this.originalStates[index]

      if (originalState.type === 'points') {
        element.plot(originalState.points)
      } else if (originalState.type === 'circle') {
        element.center(originalState.cx, originalState.cy)
      } else if (originalState.type === 'ellipse') {
        element.center(originalState.cx, originalState.cy)
      } else if (originalState.type === 'rect') {
        // If rect was converted to polygon, we need special handling
        if (element.type === 'polygon') {
          // Create new rectangle and replace polygon
          const rect = element.parent().rect(originalState.width, originalState.height)
          rect.move(originalState.x, originalState.y)
          rect.attr(originalState.attrs)
          element.remove()

          // Update reference
          const elementIndex = this.selectedElements.indexOf(element)
          if (elementIndex !== -1) {
            this.selectedElements[elementIndex] = rect
          }
        } else {
          element.move(originalState.x, originalState.y)
        }
      } else if (originalState.type === 'text') {
        element.move(originalState.x, originalState.y)
        element.transform(originalState.transform)
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
    })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Undo: Rotation reversed.' })
  }

  redo() {
    this.performRotation()
    this.editor.signals.terminalLogged.dispatch({ msg: 'Redo: Rotation reapplied.' })
  }
}

function rotateCommand(editor) {
  const rotateCommand = new RotateCommand(editor)
  rotateCommand.execute()
}

export { rotateCommand }
