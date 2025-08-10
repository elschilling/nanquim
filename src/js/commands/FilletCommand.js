import { Command } from '../Command'

class FilletCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'FilletCommand'
    this.name = 'Fillet'
    this.selectedElements = []

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
    }

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
    }
  }

  // Create fillet arc between lines (radius > 0)
  createFilletArc(line1, line2, radius) {
    const intersection = this.getLineIntersection(line1, line2)
    const lastClick = this.editor.lastClick

    // Get line directions - we need to orient them correctly based on click position
    const l1 = this.getLineEquation(line1)
    const l2 = this.getLineEquation(line2)

    // Determine which end of each line is closer to the click (preserve these ends)
    const dist1ToStartFromClick = Math.sqrt((lastClick.x - l1.x1) ** 2 + (lastClick.y - l1.y1) ** 2)
    const dist1ToEndFromClick = Math.sqrt((lastClick.x - l1.x2) ** 2 + (lastClick.y - l1.y2) ** 2)
    const dist2ToStartFromClick = Math.sqrt((lastClick.x - l2.x1) ** 2 + (lastClick.y - l2.y1) ** 2)
    const dist2ToEndFromClick = Math.sqrt((lastClick.x - l2.x2) ** 2 + (lastClick.y - l2.y2) ** 2)

    // Get directions pointing AWAY from the click position (towards intersection)
    let dir1, dir2
    if (dist1ToStartFromClick < dist1ToEndFromClick) {
      // Start is closer to click, direction goes from start to end
      dir1 = { dx: l1.x2 - l1.x1, dy: l1.y2 - l1.y1 }
    } else {
      // End is closer to click, direction goes from end to start
      dir1 = { dx: l1.x1 - l1.x2, dy: l1.y1 - l1.y2 }
    }

    if (dist2ToStartFromClick < dist2ToEndFromClick) {
      // Start is closer to click, direction goes from start to end
      dir2 = { dx: l2.x2 - l2.x1, dy: l2.y2 - l2.y1 }
    } else {
      // End is closer to click, direction goes from end to start
      dir2 = { dx: l2.x1 - l2.x2, dy: l2.y1 - l2.y2 }
    }

    // Normalize directions
    const len1 = Math.sqrt(dir1.dx * dir1.dx + dir1.dy * dir1.dy)
    const len2 = Math.sqrt(dir2.dx * dir2.dx + dir2.dy * dir2.dy)
    dir1.dx /= len1
    dir1.dy /= len1
    dir2.dx /= len2
    dir2.dy /= len2

    // Calculate angle between lines
    const dot = dir1.dx * dir2.dx + dir1.dy * dir2.dy
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)))

    if (angle < 0.01) {
      // Nearly parallel lines
      throw new Error('Lines are too close to parallel for filleting')
    }

    // Calculate distance from intersection to arc center along each line
    const distance = radius / Math.tan(angle / 2)

    if (distance <= 0) {
      throw new Error('Invalid fillet configuration')
    }

    // Find points on each line where the arc will connect
    const point1 = {
      x: intersection.x - distance * dir1.dx,
      y: intersection.y - distance * dir1.dy,
    }

    const point2 = {
      x: intersection.x - distance * dir2.dx,
      y: intersection.y - distance * dir2.dy,
    }

    // Calculate arc center
    const normal1 = { x: -dir1.dy, y: dir1.dx } // Perpendicular to line1
    const normal2 = { x: -dir2.dy, y: dir2.dx } // Perpendicular to line2

    // The center is at radius distance along the normals from the connection points
    const center1 = {
      x: point1.x + radius * normal1.x,
      y: point1.y + radius * normal1.y,
    }

    const center2 = {
      x: point2.x + radius * normal2.x,
      y: point2.y + radius * normal2.y,
    }

    // Average the two centers (they should be very close)
    const arcCenter = {
      x: (center1.x + center2.x) / 2,
      y: (center1.y + center2.y) / 2,
    }

    // Calculate start and end angles for the arc
    const startAngle = Math.atan2(point1.y - arcCenter.y, point1.x - arcCenter.x)
    const endAngle = Math.atan2(point2.y - arcCenter.y, point2.x - arcCenter.x)

    // Determine if we need large arc flag and sweep direction
    let deltaAngle = endAngle - startAngle
    if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI
    if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI

    const largeArcFlag = Math.abs(deltaAngle) > Math.PI ? 1 : 0
    const sweepFlag = deltaAngle > 0 ? 1 : 0

    // Create the arc path using SVG.js
    const pathData = `M ${point1.x} ${point1.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${point2.x} ${point2.y}`
    const arcPath = this.editor.draw.path(pathData)
    arcPath.attr({
      fill: 'none',
      stroke: line1.attr('stroke') || 'black',
      'stroke-width': line1.attr('stroke-width') || 1,
    })

    // Trim the lines to the fillet points
    this.trimLineToPoint(line1, point1, intersection)
    this.trimLineToPoint(line2, point2, intersection)
  }

  // Helper function to trim a line to a specific point
  trimLineToPoint(line, trimPoint, intersection) {
    const l = this.getLineEquation(line)
    const lastClick = this.editor.lastClick

    // We need to determine which endpoint is on the same side of the intersection as the click
    // We'll use the intersection point as a reference and see which endpoint is on the same side as the click

    // Calculate vectors from intersection to each endpoint and to the click
    const vecToStart = { x: l.x1 - intersection.x, y: l.y1 - intersection.y }
    const vecToEnd = { x: l.x2 - intersection.x, y: l.y2 - intersection.y }
    const vecToClick = { x: lastClick.x - intersection.x, y: lastClick.y - intersection.y }

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
    this.selectedElements = []
  }

  undo() {}
  redo() {}
}

function filletCommand(editor) {
  const filletCmd = new FilletCommand(editor)
  filletCmd.execute()
}

export { filletCommand }
