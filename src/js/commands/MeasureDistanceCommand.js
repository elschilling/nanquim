import { Command } from '../Command'
import { calculateDistance } from '../utils/calculateDistance'
import { resolveInputCoordinate } from '../utils/coordinateInput'
import { MAX_SVG_GEOMETRY_MAGNITUDE } from '../utils/svgNumericBounds'
import { clearSnap } from '../utils/snapSystem'

class MeasureDistanceCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'MeasureDistanceCommand'
        this.name = 'Dist'
        this.svg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
        this.ghostLine = null
        this.ghostGroup = null
        this.measureGroup = null
        this.boundOnMouseMove = null
        this.boundOnCancelled = null
        this.boundOnModeChanged = null
    }

    execute() {
        this.editor.signals.terminalLogged.dispatch({
            type: 'strong',
            msg: 'DIST ',
            clearSelection: true,
        })
        this.editor.isInteracting = true
        this.editor.selectSingleElement = true
        this.editor.snapPoint = null
        this.svg.fire('snapChange')

        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: 'Specify first point: ',
            recordInput: true,
        })

        this.listenForFirstPoint()

        // Capture the root for this session and dispose its feedback before
        // points from another editor space can enter the measurement.
        this.boundOnModeChanged = () => this.cleanup()
        this.editor.signals.editorModeChanged.add(this.boundOnModeChanged, this)

        this.boundOnCancelled = () => this.cleanup()
        this.editor.signals.commandCancelled.addOnce(this.boundOnCancelled, this)
    }

    listenForFirstPoint() {
        this.editor.signals.pointCaptured.addOnce(this.onFirstPoint, this)

        // Listen for coordinate input for first point
        this.boundOnFirstCoordinateInput = () => {
            this.editor.signals.pointCaptured.remove(this.onFirstPoint, this)
            this.onFirstPoint(resolveInputCoordinate(this.editor))
        }
        this.editor.signals.coordinateInput.addOnce(this.boundOnFirstCoordinateInput, this)
    }

    onFirstPoint(point) {
        this.editor.signals.pointCaptured.remove(this.onFirstPoint, this)
        if (this.boundOnFirstCoordinateInput) {
            this.editor.signals.coordinateInput.remove(this.boundOnFirstCoordinateInput, this)
        }

        if (!this.isValidPoint(point)) {
            this.reportInvalidPoint('first')
            this.listenForFirstPoint()
            return
        }

        this.firstPoint = { x: point.x, y: point.y }
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `First point: ${point.x.toFixed(4)}, ${point.y.toFixed(4)}`,
        })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: 'Specify second point: ',
            recordInput: true,
        })

        // Keep active command feedback independent from the optional F3
        // overlays group. This root is transient and never enters the drawing.
        this.ghostGroup = this.createViewportLayer('measure-ghost-group')
        this.ghostLine = this.ghostGroup
            .line(point.x, point.y, point.x, point.y)
            .addClass('measure-ghost')
            .attr('stroke-dasharray', '6 4')
        this.ghostText = this.ghostGroup
            .text('')
            .addClass('measure-text')
            .attr('font-family', "'JetBrains Mono', 'Fira Code', monospace")
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')

        // Live update ghost line and distance label on mouse move
        this.boundOnMouseMove = (e) => {
            const coords = this.editor.snapPoint || this.svg.point(e.pageX, e.pageY)
            if (!this.isValidPoint(coords)) return
            if (this.ghostLine) {
                this.ghostLine.plot(this.firstPoint.x, this.firstPoint.y, coords.x, coords.y)
            }
            if (this.ghostText) {
                const zoom = this.svg.zoom() || 1
                const dx = coords.x - this.firstPoint.x
                const dy = coords.y - this.firstPoint.y
                const dist = Math.hypot(dx, dy)
                const angle = Math.atan2(dy, dx)
                let angleDeg = angle * (180 / Math.PI)
                if (angleDeg > 90) angleDeg -= 180
                if (angleDeg < -90) angleDeg += 180
                const midX = this.firstPoint.x + dx / 2
                const midY = this.firstPoint.y + dy / 2
                const offsetDist = 10 / zoom
                const ox = midX - Math.sin(angle) * offsetDist
                const oy = midY + Math.cos(angle) * offsetDist
                this.ghostText
                    .text(dist.toFixed(4))
                    .attr('font-size', 14 / zoom)
                    .attr('transform', `translate(${ox}, ${oy}) rotate(${angleDeg})`)
            }
        }
        this.svg.on('mousemove', this.boundOnMouseMove)

        this.listenForSecondPoint()
    }

    listenForSecondPoint() {
        this.editor.signals.pointCaptured.addOnce(this.onSecondPoint, this)

        // Listen for coordinate input for second point
        this.boundOnSecondCoordinateInput = () => {
            this.editor.signals.pointCaptured.remove(this.onSecondPoint, this)
            this.onSecondPoint(resolveInputCoordinate(this.editor, this.firstPoint))
        }
        this.editor.signals.coordinateInput.addOnce(this.boundOnSecondCoordinateInput, this)
    }

    onSecondPoint(point) {
        this.editor.signals.pointCaptured.remove(this.onSecondPoint, this)
        if (this.boundOnSecondCoordinateInput) {
            this.editor.signals.coordinateInput.remove(this.boundOnSecondCoordinateInput, this)
        }

        if (!this.isValidPoint(point)) {
            this.reportInvalidPoint('second')
            this.listenForSecondPoint()
            return
        }

        // Remove ghost line
        if (this.boundOnMouseMove) {
            this.svg.off('mousemove', this.boundOnMouseMove)
            this.boundOnMouseMove = null
        }
        if (this.ghostGroup) {
            this.ghostGroup.remove()
            this.ghostGroup = null
            this.ghostLine = null
            this.ghostText = null
        }

        this.secondPoint = { x: point.x, y: point.y }
        const distance = calculateDistance(this.firstPoint, this.secondPoint)
        const dx = Math.abs(this.secondPoint.x - this.firstPoint.x)
        const dy = Math.abs(this.secondPoint.y - this.firstPoint.y)

        // Log to terminal
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `Distance = ${distance.toFixed(4)}`,
        })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `Delta X = ${dx.toFixed(4)}, Delta Y = ${dy.toFixed(4)}`,
        })

        // Draw measurement annotation on viewport
        this.drawMeasurement(this.firstPoint, this.secondPoint, distance)

        this.cleanup({ keepMeasurement: true })
    }

    drawMeasurement(p1, p2, distance) {
        // Remove any existing measurement
        this.clearMeasurement()

        const zoom = this.svg.zoom() || 1
        const fontSize = 14 / zoom
        // Measurement lines use non-scaling strokes, so their width and dash
        // pattern are already screen-space values and must not be divided by zoom.
        const strokeWidth = 1.5

        this.measureGroup = this.createViewportLayer('measure-overlay')

        // Dashed line between points
        this.measureGroup
            .line(p1.x, p1.y, p2.x, p2.y)
            .addClass('measure-line')
            .stroke({ width: strokeWidth })
            .attr('stroke-dasharray', '6 4')

        // Small cross markers at each point
        const crossSize = 6 / zoom
        this.drawCross(this.measureGroup, p1, crossSize, strokeWidth)
        this.drawCross(this.measureGroup, p2, crossSize, strokeWidth)

        // Text label at midpoint, offset perpendicularly and rotated to match line angle
        const midX = (p1.x + p2.x) / 2
        const midY = (p1.y + p2.y) / 2
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x)
        let angleDeg = angle * (180 / Math.PI)
        if (angleDeg > 90) angleDeg -= 180
        if (angleDeg < -90) angleDeg += 180
        const offsetDist = 10 / zoom
        const offsetX = midX - Math.sin(angle) * offsetDist
        const offsetY = midY + Math.cos(angle) * offsetDist

        this.measureGroup
            .text(distance.toFixed(4))
            .addClass('measure-text')
            .attr('font-family', "'JetBrains Mono', 'Fira Code', monospace")
            .attr('font-size', fontSize)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('transform', `translate(${offsetX}, ${offsetY}) rotate(${angleDeg})`)

        // Register cleanup on next command or cancel
        this.boundOnClearMeasure = () => this.cleanup()
        this.editor.signals.commandCancelled.addOnce(this.boundOnClearMeasure, this)
    }

    createViewportLayer(className) {
        return this.svg
            .group()
            .addClass(className)
            .attr({
                'aria-hidden': 'true',
                'data-nanquim-transient': 'true',
                'pointer-events': 'none',
            })
    }

    drawCross(group, point, size, strokeWidth) {
        group
            .line(point.x - size, point.y, point.x + size, point.y)
            .addClass('measure-line')
            .stroke({ width: strokeWidth })
        group
            .line(point.x, point.y - size, point.x, point.y + size)
            .addClass('measure-line')
            .stroke({ width: strokeWidth })
    }

    clearMeasurement() {
        if (this.measureGroup) {
            this.measureGroup.remove()
            this.measureGroup = null
        }
        if (this.boundOnClearMeasure) {
            this.editor.signals.commandCancelled.remove(this.boundOnClearMeasure, this)
            this.boundOnClearMeasure = null
        }
    }

    isValidPoint(point) {
        return Number.isFinite(point?.x) && Number.isFinite(point?.y)
            && Math.abs(point.x) <= MAX_SVG_GEOMETRY_MAGNITUDE
            && Math.abs(point.y) <= MAX_SVG_GEOMETRY_MAGNITUDE
    }

    reportInvalidPoint(which) {
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `Invalid coordinate. Specify ${which} point: `,
            recordInput: true,
        })
    }

    cleanup({ keepMeasurement = false } = {}) {
        // Remove ghost elements
        if (this.boundOnMouseMove) {
            this.svg.off('mousemove', this.boundOnMouseMove)
            this.boundOnMouseMove = null
        }
        if (this.ghostGroup) {
            this.ghostGroup.remove()
            this.ghostGroup = null
            this.ghostLine = null
            this.ghostText = null
        }

        // Remove signal listeners
        this.editor.signals.pointCaptured.remove(this.onFirstPoint, this)
        this.editor.signals.pointCaptured.remove(this.onSecondPoint, this)
        if (this.boundOnFirstCoordinateInput) {
            this.editor.signals.coordinateInput.remove(this.boundOnFirstCoordinateInput, this)
            this.boundOnFirstCoordinateInput = null
        }
        if (this.boundOnSecondCoordinateInput) {
            this.editor.signals.coordinateInput.remove(this.boundOnSecondCoordinateInput, this)
            this.boundOnSecondCoordinateInput = null
        }
        if (this.boundOnCancelled) {
            this.editor.signals.commandCancelled.remove(this.boundOnCancelled, this)
            this.boundOnCancelled = null
        }

        if (!keepMeasurement) {
            this.clearMeasurement()
            if (this.boundOnModeChanged) {
                this.editor.signals.editorModeChanged.remove(this.boundOnModeChanged, this)
                this.boundOnModeChanged = null
            }
        }

        this.firstPoint = null
        this.secondPoint = null
        this.editor.inputCoord = null
        this.editor.inputCoordMode = null
        this.editor.snapPoint = null
        clearSnap(this.editor, this.svg)

        this.editor.isInteracting = false
        this.editor.selectSingleElement = false
    }
}

function measureDistanceCommand(editor) {
    const cmd = new MeasureDistanceCommand(editor)
    cmd.execute()
}

export { measureDistanceCommand }
