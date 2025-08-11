import { Command } from '../Command'

class FilletCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'FilletCommand'
    this.name = 'Fillet'
    this.selectedElements = []
    this.originalStates = [] // Store original line states for undo
    this.createdElements = [] // Store created arc elements for undo

    // Bind handlers
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.boundOnElementSelected = this.onElementSelected.bind(this)
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Select elements to fillet - Radius: ` + this.editor.cmdParams.filletRadius,
    })
    this.editor.isInteracting = true
    this.editor.signals.inputValue.addOnce(this.onRadiusParam, this)
    document.addEventListener('keydown', this.boundOnKeyDown)
    this.startSelection()
  }

  onRadiusParam(input) {
    this.editor.signals.terminalLogged.dispatch({ msg: `Enter fillet radius` })
    this.editor.signals.inputValue.addOnce(this.onRadiusInput, this)
  }

  onRadiusInput(input) {
    this.editor.signals.terminalLogged.dispatch({ msg: `Radius set to ` + input })
    this.editor.cmdParams.filletRadius = input
    this.execute()
  }

  startSelection() {
    this.editor.signals.clearSelection.dispatch()
    this.editor.selectSingleElement = true
    this.editor.signals.toogledSelect.addOnce(this.boundOnElementSelected)
  }

  onElementSelected(el) {
    this.editor.signals.toogledSelect.remove(this.boundOnElementSelected)
    if (!el) return
    this.selectedElements.push([el, this.editor.lastClick])
    console.log('selectedElements', this.selectedElements)
    if (this.selectedElements.length < 2) {
      this.startSelection()
    } else {
      this.filletElements()
    }
  }

  // Store original state before modification
  storeOriginalStates() {
    this.originalStates = []
    this.createdElements = []

    for (let i = 0; i < this.selectedElements.length; i++) {
      const [line, click] = this.selectedElements[i]
      const originalState = {
        element: line,
        x1: line.attr('x1'),
        y1: line.attr('y1'),
        x2: line.attr('x2'),
        y2: line.attr('y2'),
      }
      this.originalStates.push(originalState)
    }
  }

  filletElements() {
    console.log('lastClick', this.editor.lastClick)
    if (this.selectedElements.length !== 2) return

    const line1Data = this.selectedElements[0] // [element, clickPosition]
    const line2Data = this.selectedElements[1] // [element, clickPosition]

    // Extract elements for type checking
    const line1 = line1Data[0]
    const line2 = line2Data[0]

    // Verify both elements are lines
    if (line1.type !== 'line' || line2.type !== 'line') {
      this.editor.signals.terminalLogged.dispatch({ msg: 'Fillet only works with line elements.' })
      this.cleanup()
      return
    }

    // Store original states before modification
    this.storeOriginalStates()

    const radius = parseFloat(this.editor.cmdParams.filletRadius) || 0

    try {
      if (radius === 0) {
        this.extendLinesToIntersection(line1Data, line2Data)
      } else {
        this.createFilletArc(line1Data, line2Data, radius)
      }

      this.editor.signals.terminalLogged.dispatch({ msg: `Fillet completed with radius ${radius}` })
    } catch (error) {
      this.editor.signals.terminalLogged.dispatch({ msg: `Fillet failed: ${error.message}` })
      // Restore original states on error
      this.undo()
    }
    this.editor.execute(this)
    this.editor.lastCommand = this
    this.cleanup()
  }

  // Utility functions for line geometry
  getLineEquation(line) {
    // SVG.js uses attr() method instead of getAttribute()
    const x1 = parseFloat(line.attr('x1'))
    const y1 = parseFloat(line.attr('y1'))
    const x2 = parseFloat(line.attr('x2'))
    const y2 = parseFloat(line.attr('y2'))

    return { x1, y1, x2, y2 }
  }

  getLineIntersection(line1, line2) {
    const l1 = this.getLineEquation(line1)
    const l2 = this.getLineEquation(line2)

    const denom = (l1.x1 - l1.x2) * (l2.y1 - l2.y2) - (l1.y1 - l1.y2) * (l2.x1 - l2.x2)

    if (Math.abs(denom) < 1e-10) {
      throw new Error('Lines are parallel or coincident')
    }

    const t = ((l1.x1 - l2.x1) * (l2.y1 - l2.y2) - (l1.y1 - l2.y1) * (l2.x1 - l2.x2)) / denom

    return {
      x: l1.x1 + t * (l1.x2 - l1.x1),
      y: l1.y1 + t * (l1.y2 - l1.y1),
    }
  }

  getLineDirection(line) {
    const l = this.getLineEquation(line)
    const dx = l.x2 - l.x1
    const dy = l.y2 - l.y1
    const length = Math.sqrt(dx * dx + dy * dy)
    return { dx: dx / length, dy: dy / length }
  }

  getLineLength(line) {
    const l = this.getLineEquation(line)
    return Math.sqrt((l.x2 - l.x1) ** 2 + (l.y2 - l.y1) ** 2)
  }

  // Extend lines to their intersection point (radius = 0)
  extendLinesToIntersection(line1Data, line2Data) {
    try {
      const [line1, click1] = line1Data
      const [line2, click2] = line2Data

      const intersection = this.getLineIntersection(line1, line2)

      console.log('Intersection:', intersection)
      console.log('Click1:', click1)
      console.log('Click2:', click2)

      if (!click1 || !click2 || !intersection) {
        console.log('Missing click positions or intersection')
        return
      }

      // For line1: Find which endpoint is on the same side as the click relative to intersection
      const l1 = this.getLineEquation(line1)
      console.log('Line1 before:', l1)

      // Calculate vectors from intersection to each endpoint and to click
      const vecToStart1 = { x: l1.x1 - intersection.x, y: l1.y1 - intersection.y }
      const vecToEnd1 = { x: l1.x2 - intersection.x, y: l1.y2 - intersection.y }
      const vecToClick1 = { x: click1.x - intersection.x, y: click1.y - intersection.y }

      // Calculate dot products to see which endpoint is more aligned with click direction
      const dotStart1 = vecToStart1.x * vecToClick1.x + vecToStart1.y * vecToClick1.y
      const dotEnd1 = vecToEnd1.x * vecToClick1.x + vecToEnd1.y * vecToClick1.y

      console.log('Line1 - dot product start:', dotStart1, 'dot product end:', dotEnd1)

      if (dotStart1 > dotEnd1) {
        // Start is more aligned with click direction (same side), keep start and move end to intersection
        console.log('Line1: Keeping start (same side as click), moving end to intersection')
        line1.attr({ x2: intersection.x, y2: intersection.y })
      } else {
        // End is more aligned with click direction (same side), keep end and move start to intersection
        console.log('Line1: Keeping end (same side as click), moving start to intersection')
        line1.attr({ x1: intersection.x, y1: intersection.y })
      }

      // For line2: Same logic
      const l2 = this.getLineEquation(line2)
      console.log('Line2 before:', l2)

      const vecToStart2 = { x: l2.x1 - intersection.x, y: l2.y1 - intersection.y }
      const vecToEnd2 = { x: l2.x2 - intersection.x, y: l2.y2 - intersection.y }
      const vecToClick2 = { x: click2.x - intersection.x, y: click2.y - intersection.y }

      const dotStart2 = vecToStart2.x * vecToClick2.x + vecToStart2.y * vecToClick2.y
      const dotEnd2 = vecToEnd2.x * vecToClick2.x + vecToEnd2.y * vecToClick2.y

      console.log('Line2 - dot product start:', dotStart2, 'dot product end:', dotEnd2)

      if (dotStart2 > dotEnd2) {
        // Start is more aligned with click direction (same side), keep start and move end to intersection
        console.log('Line2: Keeping start (same side as click), moving end to intersection')
        line2.attr({ x2: intersection.x, y2: intersection.y })
      } else {
        // End is more aligned with click direction (same side), keep end and move start to intersection
        console.log('Line2: Keeping end (same side as click), moving start to intersection')
        line2.attr({ x1: intersection.x, y1: intersection.y })
      }

      console.log('Line1 after:', this.getLineEquation(line1))
      console.log('Line2 after:', this.getLineEquation(line2))
    } catch (error) {
      console.error('Error in extendLinesToIntersection:', error)
      throw error // Re-throw to trigger undo in filletElements
    }
  }

  // Create fillet arc between lines (radius > 0)
  createFilletArc(line1Data, line2Data, radius) {
    const [line1, click1] = line1Data
    const [line2, click2] = line2Data

    // Get line equations
    const l1 = this.getLineEquation(line1)
    const l2 = this.getLineEquation(line2)

    // Check if lines are already connected (share an endpoint)
    let sharedPoint = null
    let line1FreeEnd = null
    let line2FreeEnd = null

    const tolerance = 0.001

    // Check all possible endpoint connections
    if (Math.abs(l1.x1 - l2.x1) < tolerance && Math.abs(l1.y1 - l2.y1) < tolerance) {
      sharedPoint = { x: l1.x1, y: l1.y1 }
      line1FreeEnd = { x: l1.x2, y: l1.y2 }
      line2FreeEnd = { x: l2.x2, y: l2.y2 }
    } else if (Math.abs(l1.x1 - l2.x2) < tolerance && Math.abs(l1.y1 - l2.y2) < tolerance) {
      sharedPoint = { x: l1.x1, y: l1.y1 }
      line1FreeEnd = { x: l1.x2, y: l1.y2 }
      line2FreeEnd = { x: l2.x1, y: l2.y1 }
    } else if (Math.abs(l1.x2 - l2.x1) < tolerance && Math.abs(l1.y2 - l2.y1) < tolerance) {
      sharedPoint = { x: l1.x2, y: l1.y2 }
      line1FreeEnd = { x: l1.x1, y: l1.y1 }
      line2FreeEnd = { x: l2.x2, y: l2.y2 }
    } else if (Math.abs(l1.x2 - l2.x2) < tolerance && Math.abs(l1.y2 - l2.y2) < tolerance) {
      sharedPoint = { x: l1.x2, y: l1.y2 }
      line1FreeEnd = { x: l1.x1, y: l1.y1 }
      line2FreeEnd = { x: l2.x1, y: l2.y1 }
    }

    let intersection, dir1, dir2, availableLength1, availableLength2

    if (sharedPoint) {
      // Lines are connected - use shared point as intersection
      intersection = sharedPoint

      // Direction vectors FROM intersection TO free ends
      dir1 = { dx: line1FreeEnd.x - intersection.x, dy: line1FreeEnd.y - intersection.y }
      dir2 = { dx: line2FreeEnd.x - intersection.x, dy: line2FreeEnd.y - intersection.y }

      availableLength1 = Math.sqrt(dir1.dx * dir1.dx + dir1.dy * dir1.dy)
      availableLength2 = Math.sqrt(dir2.dx * dir2.dx + dir2.dy * dir2.dy)
    } else {
      // Lines are separate - find intersection by extending them
      intersection = this.getLineIntersection(line1, line2)

      // Find which endpoints to preserve (those closer to click positions)
      const dist1ToStartFromClick = Math.sqrt((click1.x - l1.x1) ** 2 + (click1.y - l1.y1) ** 2)
      const dist1ToEndFromClick = Math.sqrt((click1.x - l1.x2) ** 2 + (click1.y - l1.y2) ** 2)
      const dist2ToStartFromClick = Math.sqrt((click2.x - l2.x1) ** 2 + (click2.y - l2.y1) ** 2)
      const dist2ToEndFromClick = Math.sqrt((click2.x - l2.x2) ** 2 + (click2.y - l2.y2) ** 2)

      // Determine preserved endpoints and get their coordinates
      const preserveStart1 = dist1ToStartFromClick < dist1ToEndFromClick
      const preserveStart2 = dist2ToStartFromClick < dist2ToEndFromClick

      const preservedPoint1 = preserveStart1 ? { x: l1.x1, y: l1.y1 } : { x: l1.x2, y: l1.y2 }
      const preservedPoint2 = preserveStart2 ? { x: l2.x1, y: l2.y1 } : { x: l2.x2, y: l2.y2 }

      // Get vectors FROM intersection TO preserved endpoints
      dir1 = { dx: preservedPoint1.x - intersection.x, dy: preservedPoint1.y - intersection.y }
      dir2 = { dx: preservedPoint2.x - intersection.x, dy: preservedPoint2.y - intersection.y }

      availableLength1 = Math.sqrt(dir1.dx * dir1.dx + dir1.dy * dir1.dy)
      availableLength2 = Math.sqrt(dir2.dx * dir2.dx + dir2.dy * dir2.dy)
    }

    if (availableLength1 < tolerance || availableLength2 < tolerance) {
      throw new Error('Lines are too short for filleting with this radius')
    }

    // Normalize directions
    dir1.dx /= availableLength1
    dir1.dy /= availableLength1
    dir2.dx /= availableLength2
    dir2.dy /= availableLength2

    // Calculate angle between the directions
    const dot = dir1.dx * dir2.dx + dir1.dy * dir2.dy
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)))

    if (angle < 0.01) {
      throw new Error('Lines are too close to parallel for filleting')
    }

    if (angle > Math.PI - 0.01) {
      throw new Error('Lines are opposite - cannot create fillet')
    }

    // Calculate distance from intersection to tangent points
    const distance = radius / Math.tan(angle / 2)

    // Calculate maximum possible radius based on available line lengths
    // For a given line length L and angle, max radius R = L * tan(angle/2)
    const maxRadius1 = availableLength1 * Math.tan(angle / 2)
    const maxRadius2 = availableLength2 * Math.tan(angle / 2)
    const maxRadius = Math.min(maxRadius1, maxRadius2)

    // Validate that the radius is not too large (use 95% of max for safety margin)
    if (radius > maxRadius * 0.95) {
      throw new Error(
        `Fillet radius ${radius} is too large. Maximum radius for this configuration is approximately ${(maxRadius * 0.95).toFixed(2)}`
      )
    }

    // Additional validation: check if calculated distance exceeds available length
    if (distance > availableLength1 * 0.98) {
      throw new Error(`Fillet radius ${radius} requires more length on first line than available`)
    }

    if (distance > availableLength2 * 0.98) {
      throw new Error(`Fillet radius ${radius} requires more length on second line than available`)
    }

    // Find tangent points on each line
    const point1 = {
      x: intersection.x + distance * dir1.dx,
      y: intersection.y + distance * dir1.dy,
    }

    const point2 = {
      x: intersection.x + distance * dir2.dx,
      y: intersection.y + distance * dir2.dy,
    }

    // Calculate the bisector direction (average of the two unit vectors)
    const bisectorX = (dir1.dx + dir2.dx) / 2
    const bisectorY = (dir1.dy + dir2.dy) / 2
    const bisectorLen = Math.sqrt(bisectorX * bisectorX + bisectorY * bisectorY)

    if (bisectorLen < 0.001) {
      throw new Error('Cannot calculate arc center - lines may be opposite')
    }

    // Normalize bisector
    const bisectorUnitX = bisectorX / bisectorLen
    const bisectorUnitY = bisectorY / bisectorLen

    // Calculate distance from intersection to arc center along bisector
    const centerDistance = radius / Math.sin(angle / 2)

    // Arc center is along the bisector
    const arcCenter = {
      x: intersection.x + centerDistance * bisectorUnitX,
      y: intersection.y + centerDistance * bisectorUnitY,
    }

    // Verify arc center is at correct distance from both tangent points
    const dist1ToCenter = Math.sqrt((point1.x - arcCenter.x) ** 2 + (point1.y - arcCenter.y) ** 2)
    const dist2ToCenter = Math.sqrt((point2.x - arcCenter.x) ** 2 + (point2.y - arcCenter.y) ** 2)

    if (Math.abs(dist1ToCenter - radius) > 0.1 || Math.abs(dist2ToCenter - radius) > 0.1) {
      throw new Error('Geometric calculation error - arc center validation failed')
    }

    // Determine sweep direction based on cross product
    const cross = dir1.dx * dir2.dy - dir1.dy * dir2.dx
    const sweepFlag = cross > 0 ? 0 : 1 // 0 for counter-clockwise, 1 for clockwise

    // Create the arc path
    const pathData = `M ${point1.x} ${point1.y} A ${radius} ${radius} 0 0 ${sweepFlag} ${point2.x} ${point2.y}`

    // Try to find the correct drawing context
    let drawContext = null
    if (this.editor.drawing) {
      drawContext = this.editor.drawing
    } else if (this.editor.svg) {
      drawContext = this.editor.svg
    } else if (line1.parent) {
      drawContext = line1.parent()
    } else {
      throw new Error('Cannot find SVG drawing context')
    }

    const arcPath = drawContext.path(pathData)

    // Inherit all visual styles from line1 (or line2 if line1 doesn't have them)
    const inheritedStyles = {
      fill: 'none', // Always no fill for strokes
      stroke: line1.attr('stroke') || line2.attr('stroke') || '#000000',
      'stroke-width': line1.attr('stroke-width') || line2.attr('stroke-width') || '1',
      'stroke-linecap': line1.attr('stroke-linecap') || line2.attr('stroke-linecap') || 'butt',
      'stroke-linejoin': line1.attr('stroke-linejoin') || line2.attr('stroke-linejoin') || 'miter',
      'stroke-dasharray': line1.attr('stroke-dasharray') || line2.attr('stroke-dasharray') || 'none',
      'stroke-dashoffset': line1.attr('stroke-dashoffset') || line2.attr('stroke-dashoffset') || '0',
      'stroke-opacity': line1.attr('stroke-opacity') || line2.attr('stroke-opacity') || '1',
      opacity: line1.attr('opacity') || line2.attr('opacity') || '1',
    }

    // Remove any null/undefined values
    Object.keys(inheritedStyles).forEach((key) => {
      if (inheritedStyles[key] === null || inheritedStyles[key] === undefined || inheritedStyles[key] === 'null') {
        delete inheritedStyles[key]
      }
    })

    // arcPath.attr(inheritedStyles)
    arcPath.addClass('newDrawing')

    // Store created arc for undo
    this.createdElements.push(arcPath)

    // Trim the lines to the fillet points
    if (sharedPoint) {
      // For connected lines, trim from shared point to tangent points
      this.trimConnectedLineToPoint(line1, point1, sharedPoint, line1FreeEnd)
      this.trimConnectedLineToPoint(line2, point2, sharedPoint, line2FreeEnd)
    } else {
      // For separate lines, use original trimming logic
      this.trimLineToPoint(line1, point1, intersection, click1)
      this.trimLineToPoint(line2, point2, intersection, click2)
    }
  }

  // Helper function to trim connected lines
  trimConnectedLineToPoint(line, trimPoint, sharedPoint, freeEnd) {
    // Determine which endpoint is the shared point and trim from there
    const l = this.getLineEquation(line)
    const tolerance = 0.001

    if (Math.abs(l.x1 - sharedPoint.x) < tolerance && Math.abs(l.y1 - sharedPoint.y) < tolerance) {
      // x1,y1 is the shared point, move it to the trim point
      line.attr({ x1: trimPoint.x, y1: trimPoint.y })
    } else {
      // x2,y2 is the shared point, move it to the trim point
      line.attr({ x2: trimPoint.x, y2: trimPoint.y })
    }
  }

  // Helper function to trim a line to a specific point
  trimLineToPoint(line, trimPoint, intersection, clickPoint) {
    const l = this.getLineEquation(line)

    // We need to determine which endpoint is on the same side of the intersection as the click
    // Calculate vectors from intersection to each endpoint and to the click
    const vecToStart = { x: l.x1 - intersection.x, y: l.y1 - intersection.y }
    const vecToEnd = { x: l.x2 - intersection.x, y: l.y2 - intersection.y }
    const vecToClick = { x: clickPoint.x - intersection.x, y: clickPoint.y - intersection.y }

    // Calculate dot products to see which endpoint is more aligned with the click direction
    const dotStart = vecToStart.x * vecToClick.x + vecToStart.y * vecToClick.y
    const dotEnd = vecToEnd.x * vecToClick.x + vecToEnd.y * vecToClick.y

    console.log('Trimming line - dot product start:', dotStart, 'dot product end:', dotEnd)

    if (dotStart > dotEnd) {
      // Start is more aligned with click direction (same side), preserve start and trim end
      console.log('Preserving start, trimming end to arc point')
      line.attr({ x2: trimPoint.x, y2: trimPoint.y })
    } else {
      // End is more aligned with click direction (same side), preserve end and trim start
      console.log('Preserving end, trimming start to arc point')
      line.attr({ x1: trimPoint.x, y1: trimPoint.y })
    }
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      this.cleanup()
      this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
    }
  }

  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    this.editor.signals.toogledSelect.remove(this.boundOnElementSelected)
    this.editor.signals.inputValue.remove(this.onRadiusParam, this)
    this.editor.signals.inputValue.remove(this.onRadiusInput, this)
    this.editor.isInteracting = false
    this.editor.selectSingleElement = false
    this.editor.distance = null
    this.selectedElement = null
    // Don't clear selectedElements - we need it for undo/redo
    // this.selectedElements = []
  }

  // Add a method to fully reset the command (call this when starting a new fillet)
  reset() {
    this.cleanup()
    this.selectedElements = []
    this.originalStates = []
    this.createdElements = []
  }

  undo() {
    // Restore original line states
    for (let i = 0; i < this.originalStates.length; i++) {
      const state = this.originalStates[i]
      state.element.attr({
        x1: state.x1,
        y1: state.y1,
        x2: state.x2,
        y2: state.y2,
      })
    }

    // Remove any created arc elements
    for (let i = 0; i < this.createdElements.length; i++) {
      this.createdElements[i].remove()
    }

    console.log('Fillet undone')
  }

  redo() {
    // Re-execute the fillet operation
    if (this.originalStates.length > 0 && this.selectedElements.length === 2) {
      const radius = parseFloat(this.editor.cmdParams.filletRadius) || 0

      // Clear the createdElements array for redo
      this.createdElements = []

      try {
        if (radius === 0) {
          // selectedElements is already in the format [[element, click], [element, click]]
          this.extendLinesToIntersection(this.selectedElements[0], this.selectedElements[1])
        } else {
          this.createFilletArc(this.selectedElements[0], this.selectedElements[1], radius)
        }
        console.log('Fillet redone')
      } catch (error) {
        console.error('Error in redo:', error)
        // If redo fails, restore original state again
        this.undo()
      }
    } else {
      console.log('Cannot redo: missing original states or selected elements')
    }
  }
}

function filletCommand(editor) {
  const filletCmd = new FilletCommand(editor)
  filletCmd.execute()
}

export { filletCommand }
