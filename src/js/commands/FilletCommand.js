import { Command } from '../Command'
import arc from '../libs/dxf/src/handlers/entity/arc'

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

    const intersection = this.getLineIntersection(line1, line2)

    // Get line equations
    const l1 = this.getLineEquation(line1)
    const l2 = this.getLineEquation(line2)

    // Find which endpoints to preserve (those closer to click positions)
    const dist1ToStartFromClick = Math.sqrt((click1.x - l1.x1) ** 2 + (click1.y - l1.y1) ** 2)
    const dist1ToEndFromClick = Math.sqrt((click1.x - l1.x2) ** 2 + (click1.y - l1.y2) ** 2)
    const dist2ToStartFromClick = Math.sqrt((click2.x - l2.x1) ** 2 + (click2.y - l2.y1) ** 2)
    const dist2ToEndFromClick = Math.sqrt((click2.x - l2.x2) ** 2 + (click2.y - l2.y2) ** 2)

    // Determine preserved endpoints
    const preserveStart1 = dist1ToStartFromClick < dist1ToEndFromClick
    const preserveStart2 = dist2ToStartFromClick < dist2ToEndFromClick

    // Get vectors FROM intersection TO preserved endpoints (these are the directions to keep)
    let dir1, dir2
    if (preserveStart1) {
      dir1 = { dx: l1.x1 - intersection.x, dy: l1.y1 - intersection.y }
    } else {
      dir1 = { dx: l1.x2 - intersection.x, dy: l1.y2 - intersection.y }
    }

    if (preserveStart2) {
      dir2 = { dx: l2.x1 - intersection.x, dy: l2.y1 - intersection.y }
    } else {
      dir2 = { dx: l2.x2 - intersection.x, dy: l2.y2 - intersection.y }
    }

    // Normalize directions
    const len1 = Math.sqrt(dir1.dx * dir1.dx + dir1.dy * dir1.dy)
    const len2 = Math.sqrt(dir2.dx * dir2.dx + dir2.dy * dir2.dy)

    if (len1 === 0 || len2 === 0) {
      throw new Error('Invalid line configuration')
    }

    dir1.dx /= len1
    dir1.dy /= len1
    dir2.dx /= len2
    dir2.dy /= len2

    // Calculate angle between the directions
    const dot = dir1.dx * dir2.dx + dir1.dy * dir2.dy
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)))

    if (angle < 0.01 || angle > Math.PI - 0.01) {
      throw new Error('Lines are too close to parallel or opposite for filleting')
    }

    // Calculate distance from intersection to tangent points
    const distance = radius / Math.tan(angle / 2)

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

    if (bisectorLen === 0) {
      throw new Error('Cannot calculate arc center')
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

    // Calculate start and end angles for the arc
    const startAngle = Math.atan2(point1.y - arcCenter.y, point1.x - arcCenter.x)
    const endAngle = Math.atan2(point2.y - arcCenter.y, point2.x - arcCenter.x)

    // Determine sweep direction based on cross product
    const cross = dir1.dx * dir2.dy - dir1.dy * dir2.dx
    const sweepFlag = cross > 0 ? 0 : 1 // 0 for counter-clockwise, 1 for clockwise

    // Create the arc path
    const pathData = `M ${point1.x} ${point1.y} A ${radius} ${radius} 0 0 ${sweepFlag} ${point2.x} ${point2.y}`

    // Try to find the correct drawing context
    let drawContext = null
    if (this.editor.draw) {
      drawContext = this.editor.draw
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
    this.trimLineToPoint(line1, point1, intersection, click1)
    this.trimLineToPoint(line2, point2, intersection, click2)
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
