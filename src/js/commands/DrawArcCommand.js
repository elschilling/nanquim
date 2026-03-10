import { getArcGeometry } from '../utils/arcUtils'
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

            const geo = getArcGeometry(p1, p2, p3)

            // If points are collinear (or very close), draw a straight line
            if (!geo) {
                this.arcPath.plot(`M ${p1.x} ${p1.y} L ${p3.x} ${p3.y}`)
                return
            }

            this.arcPath.plot(`M ${p1.x} ${p1.y} A ${geo.radius} ${geo.radius} 0 ${geo.largeArcFlag} ${geo.sweepFlag} ${p3.x} ${p3.y}`)
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

        if (this.arcPath) {
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
