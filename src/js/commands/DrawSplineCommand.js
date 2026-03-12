import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import { applyCollectionStyleToElement } from '../Collection'

/**
 * Convert an array of points to a smooth SVG cubic-bezier path string
 * using Catmull-Rom → Cubic Bezier conversion.
 *
 * The resulting curve passes through every point.
 */
function catmullRomToBezierPath(points) {
    if (points.length < 2) return ''
    if (points.length === 2) {
        return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
    }

    // Build extended array with virtual endpoints (mirror first/last tangent)
    const ext = []
    // Virtual start: reflect P1 across P0
    ext.push({
        x: 2 * points[0].x - points[1].x,
        y: 2 * points[0].y - points[1].y
    })
    for (const p of points) ext.push(p)
    // Virtual end: reflect P(n-2) across P(n-1)
    const n = points.length
    ext.push({
        x: 2 * points[n - 1].x - points[n - 2].x,
        y: 2 * points[n - 1].y - points[n - 2].y
    })

    let d = `M ${points[0].x} ${points[0].y}`

    // For each segment between points[i] and points[i+1],
    // use ext[i], ext[i+1], ext[i+2], ext[i+3] as P0,P1,P2,P3 of Catmull-Rom
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = ext[i]
        const p1 = ext[i + 1]
        const p2 = ext[i + 2]
        const p3 = ext[i + 3]

        // Catmull-Rom to Cubic Bezier control points
        const cp1x = p1.x + (p2.x - p0.x) / 6
        const cp1y = p1.y + (p2.y - p0.y) / 6
        const cp2x = p2.x - (p3.x - p1.x) / 6
        const cp2y = p2.y - (p3.y - p1.y) / 6

        d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
    }

    return d
}

class DrawSplineCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'DrawSplineCommand'
        this.name = 'Spline'
        this.drawing = this.editor.activeCollection
        this.points = []
        this.splinePath = null
        this.boundHandleMove = this.handleMove.bind(this)
        this.boundHandleClick = this.handleClick.bind(this)
        this.boundHandleRightClick = this.handleRightClick.bind(this)
        this.boundHandleKeyDown = this.handleKeyDown.bind(this)
        this.boundCancelDrawing = () => this.cleanup()
    }

    execute() {
        this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'DRAW ' + this.name.toUpperCase() + ' ' })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: 'Click to add spline points. Enter/Right-click to finish, Esc to cancel.',
        })
        this.editor.setIsDrawing(true)

        const activeSvg = this.editor.mode === 'paper' ? this.editor.paperSvg : this.editor.svg

        activeSvg.on('mousedown.spline', this.boundHandleClick)
        document.addEventListener('mousemove', this.boundHandleMove)
        document.addEventListener('contextmenu', this.boundHandleRightClick, true)
        document.addEventListener('keydown', this.boundHandleKeyDown)

        activeSvg.on('cancelDrawing.spline', this.boundCancelDrawing)
    }

    handleKeyDown(e) {
        if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
            e.preventDefault()
            e.stopPropagation()
            this.finalizeSpline()
        } else if (e.code === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            this.cleanup()
            this.editor.signals.terminalLogged.dispatch({ msg: 'Spline cancelled.' })
        }
    }

    handleRightClick(e) {
        e.preventDefault()
        e.stopImmediatePropagation()
        this.finalizeSpline()
    }

    handleClick(e) {
        if (e.button !== 0) return

        const activeSvg = this.editor.mode === 'paper' ? this.editor.paperSvg : this.editor.svg
        const point = this.editor.snapPoint || activeSvg.point(e.pageX, e.pageY)
        this.points.push({ x: point.x, y: point.y })

        if (this.points.length === 1) {
            // Create the path element
            this.splinePath = this.drawing.path(`M ${point.x} ${point.y}`)
                .fill('none')
                .stroke({ color: 'white', width: 0.1, linecap: 'round' })
            applyCollectionStyleToElement(this.editor, this.splinePath)

            this.editor.signals.terminalLogged.dispatch({
                type: 'span',
                msg: `Point 1 set. Click to add more points.`,
            })
        } else {
            this.editor.signals.terminalLogged.dispatch({
                type: 'span',
                msg: `Point ${this.points.length} set.`,
            })
            // Update path with current points
            this.updatePreview()
        }
    }

    handleMove(e) {
        if (this.points.length === 0 || !this.splinePath) return

        const activeSvg = this.editor.mode === 'paper' ? this.editor.paperSvg : this.editor.svg
        const point = this.editor.snapPoint || activeSvg.point(e.pageX, e.pageY)

        // Preview with cursor as virtual next point
        const previewPoints = [...this.points, { x: point.x, y: point.y }]
        const d = catmullRomToBezierPath(previewPoints)
        if (d) this.splinePath.plot(d)
    }

    updatePreview() {
        if (!this.splinePath || this.points.length < 2) return
        const d = catmullRomToBezierPath(this.points)
        if (d) this.splinePath.plot(d)
    }

    finalizeSpline() {
        if (this.points.length < 2) {
            this.editor.signals.terminalLogged.dispatch({ msg: 'Need at least 2 points. Spline cancelled.' })
            this.cleanup()
            return
        }

        // Final path from committed points
        const d = catmullRomToBezierPath(this.points)
        this.splinePath.plot(d)

        this.splinePath.attr('id', this.editor.elementIndex++)
        this.splinePath.attr('name', 'Spline')

        // Store spline point data for editing
        this.splinePath.data('splineData', {
            points: this.points.map(p => ({ x: p.x, y: p.y }))
        })

        this.editor.history.undos.push(new AddElementCommand(this.editor, this.splinePath))
        this.editor.lastCommand = this
        this.updatedOutliner()

        this.editor.signals.terminalLogged.dispatch({ msg: `Spline created with ${this.points.length} points.` })

        this.splinePath = null
        this.cleanupListeners()
        this.editor.setIsDrawing(false)
    }

    cleanupListeners() {
        const activeSvg = this.editor.mode === 'paper' ? this.editor.paperSvg : this.editor.svg
        activeSvg.off('mousedown.spline')
        activeSvg.off('cancelDrawing.spline')
        document.removeEventListener('mousemove', this.boundHandleMove)
        document.removeEventListener('contextmenu', this.boundHandleRightClick, true)
        document.removeEventListener('keydown', this.boundHandleKeyDown)
    }

    cleanup() {
        this.cleanupListeners()
        this.editor.setIsDrawing(false)
        this.points = []

        if (this.splinePath) {
            this.splinePath.remove()
            this.splinePath = null
        }
    }
}

function drawSplineCommand(editor) {
    const cmd = new DrawSplineCommand(editor)
    cmd.execute()
}

export { drawSplineCommand, catmullRomToBezierPath }
