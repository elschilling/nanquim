import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import { calculateDistance } from '../utils/calculateDistance'
import { applyCollectionStyleToElement } from '../Collection'

class DrawArcCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'DrawArcCommand'
        this.name = 'Arc'
        this.drawing = this.editor.activeCollection
        this.points = []
        this.arcPath = null
        this.boundHandleMove = this.handleMove.bind(this)
        this.boundHandleClick = this.handleClick.bind(this)
    }

    execute() {
        this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'DRAW ' + this.name.toUpperCase() + ' ' })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `Click to set the start point of the arc`,
        })
        this.editor.setIsDrawing(true)

        // Bind directly to svg mousedown, capturing phase to avoid conflicts
        this.editor.svg.on('mousedown.arc', this.boundHandleClick)
        document.addEventListener('mousemove', this.boundHandleMove)

        // Listen for cancellation
        this.editor.svg.on('cancelDrawing', (e) => {
            this.cleanup()
        })
    }

    handleClick(e) {
        // Only left clicks
        if (e.button !== 0) return

        const point = this.editor.snapPoint || this.editor.svg.point(e.pageX, e.pageY)
        this.points.push(point)

        if (this.points.length === 1) {
            this.editor.signals.terminalLogged.dispatch({
                type: 'span',
                msg: `Start point set. Click to set the end point of the arc`,
            })

            // Start drawing the visual path
            this.arcPath = this.drawing.path(`M ${point.x} ${point.y} L ${point.x} ${point.y}`)
                .addClass('newDrawing')
                .fill('none')
                .stroke({ color: 'white', width: 0.1, linecap: 'round' })
            applyCollectionStyleToElement(this.editor, this.arcPath)

        } else if (this.points.length === 2) {
            this.editor.signals.terminalLogged.dispatch({
                type: 'span',
                msg: `End point set. Move mouse to set the radius/curvature and click to finish`,
            })
        } else if (this.points.length === 3) {
            // Finalize the arc
            this.finalizeArc()
        }
    }

    handleMove(e) {
        if (this.points.length === 0 || !this.arcPath) return

        const point = this.editor.snapPoint || this.editor.svg.point(e.pageX, e.pageY)

        if (this.points.length === 1) {
            // Drawing line from start point to current mouse position (end point preview)
            const start = this.points[0]
            this.arcPath.plot(`M ${start.x} ${start.y} L ${point.x} ${point.y}`)
        } else if (this.points.length === 2) {
            // Drawing the actual arc passing through start, point (mouse), and end
            const p1 = this.points[0]
            const p2 = point
            const p3 = this.points[1]

            // Calculate the circumcircle of the three points
            const A = p1.x * (p2.y - p3.y) - p1.y * (p2.x - p3.x) + p2.x * p3.y - p3.x * p2.y

            // If points are collinear (or very close), draw a straight line
            if (Math.abs(A) < 0.1) {
                this.arcPath.plot(`M ${p1.x} ${p1.y} L ${p3.x} ${p3.y}`)
                return
            }

            const p1sq = p1.x * p1.x + p1.y * p1.y
            const p2sq = p2.x * p2.x + p2.y * p2.y
            const p3sq = p3.x * p3.x + p3.y * p3.y

            const B = p1sq * (p3.y - p2.y) + p2sq * (p1.y - p3.y) + p3sq * (p2.y - p1.y)
            const C = p1sq * (p2.x - p3.x) + p2sq * (p3.x - p1.x) + p3sq * (p1.x - p2.x)

            const cx = -B / (2 * A)
            const cy = -C / (2 * A)

            // Radius is distance from center to any point
            let radius = Math.sqrt((cx - p1.x) ** 2 + (cy - p1.y) ** 2)
            radius = Math.min(radius, 100000)

            // Calculate angles from center to the three points
            let startAngle = Math.atan2(p1.y - cy, p1.x - cx)
            let midAngle = Math.atan2(p2.y - cy, p2.x - cx)
            let endAngle = Math.atan2(p3.y - cy, p3.x - cx)

            // Normalize angles to be between 0 and 2*PI
            if (startAngle < 0) startAngle += 2 * Math.PI
            if (midAngle < 0) midAngle += 2 * Math.PI
            if (endAngle < 0) endAngle += 2 * Math.PI

            // Math to determine if the midAngle is between startAngle and endAngle going clockwise or counter-clockwise
            let sweepFlag = 0
            let largeArcFlag = 0

            // Check counter-clockwise path from start to end
            let ccwDistance = endAngle - startAngle
            if (ccwDistance < 0) ccwDistance += 2 * Math.PI

            let midCcwDistance = midAngle - startAngle
            if (midCcwDistance < 0) midCcwDistance += 2 * Math.PI

            if (midCcwDistance < ccwDistance) {
                // p2 is visited when traversing from p1 to p3 counter-clockwise
                sweepFlag = 1
                largeArcFlag = ccwDistance > Math.PI ? 1 : 0
            } else {
                // p2 is visited when traversing from p1 to p3 clockwise
                sweepFlag = 0
                let cwDistance = 2 * Math.PI - ccwDistance
                largeArcFlag = cwDistance > Math.PI ? 1 : 0
            }

            this.arcPath.plot(`M ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${p3.x} ${p3.y}`)
        }
    }

    finalizeArc() {
        if (!this.arcPath) {
            return this.cleanup()
        }

        // Save the final path
        this.arcPath.attr('id', this.editor.elementIndex++)
        this.arcPath.attr('name', 'Arc')

        // Save the defining points so we can edit the arc later
        this.arcPath.data('arcData', {
            p1: { x: this.points[0].x, y: this.points[0].y },
            p2: { x: this.points[2].x, y: this.points[2].y },
            p3: { x: this.points[1].x, y: this.points[1].y }
        })

        // Add to history
        this.editor.history.undos.push(new AddElementCommand(this.editor, this.arcPath))
        this.editor.lastCommand = this
        this.updatedOutliner()

        this.editor.signals.terminalLogged.dispatch({ msg: 'Arc created.' })

        // Reset state for another arc or finish
        this.arcPath = null
        this.cleanup()
    }

    cleanup() {
        this.editor.svg.off('mousedown.arc')
        document.removeEventListener('mousemove', this.boundHandleMove)
        this.editor.setIsDrawing(false)
        this.points = []

        if (this.arcPath && this.arcPath.hasClass('newDrawing')) {
            this.arcPath.remove()
            this.arcPath = null
        }
    }
}

function drawArcCommand(editor) {
    const arcCommand = new DrawArcCommand(editor)
    arcCommand.execute()
}

export { drawArcCommand }
