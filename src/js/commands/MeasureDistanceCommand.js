import { Command } from '../Command'
import { calculateDistance } from '../utils/calculateDistance'

class MeasureDistanceCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'MeasureDistanceCommand'
        this.name = 'Dist'
        this.ghostLine = null
        this.ghostGroup = null
        this.measureGroup = null
        this.boundOnMouseMove = null
        this.boundOnCancelled = null
    }

    execute() {
        this.editor.signals.terminalLogged.dispatch({
            type: 'strong',
            msg: 'DIST ',
            clearSelection: true,
        })
        this.editor.isInteracting = true
        this.editor.selectSingleElement = true

        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: 'Specify first point: ',
        })

        this.editor.signals.pointCaptured.addOnce(this.onFirstPoint, this)

        // Listen for coordinate input for first point
        this.boundOnFirstCoordinateInput = () => {
            this.editor.signals.pointCaptured.remove(this.onFirstPoint, this)
            this.onFirstPoint(this.editor.inputCoord)
        }
        this.editor.signals.coordinateInput.addOnce(this.boundOnFirstCoordinateInput, this)

        // Listen for cancel
        this.boundOnCancelled = () => this.cleanup()
        this.editor.signals.commandCancelled.addOnce(this.boundOnCancelled, this)
    }

    onFirstPoint(point) {
        if (this.boundOnFirstCoordinateInput) {
            this.editor.signals.coordinateInput.remove(this.boundOnFirstCoordinateInput, this)
        }

        this.firstPoint = point
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `First point: ${point.x.toFixed(4)}, ${point.y.toFixed(4)}`,
        })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: 'Specify second point: ',
        })

        // Create ghost line group in overlays
        this.ghostGroup = this.editor.overlays.group().addClass('measure-ghost-group')
        this.ghostLine = this.ghostGroup
            .line(point.x, point.y, point.x, point.y)
            .addClass('measure-ghost')
        this.ghostText = this.ghostGroup
            .text('')
            .addClass('measure-text')
            .attr('font-family', "'Fira Mono', 'JetBrains Mono', 'Cascadia Code', monospace")
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .fill('#cccccc')

        // Live update ghost line and distance label on mouse move
        this.boundOnMouseMove = (e) => {
            const coords = this.editor.snapPoint || this.editor.svg.point(e.pageX, e.pageY)
            if (this.ghostLine) {
                this.ghostLine.plot(this.firstPoint.x, this.firstPoint.y, coords.x, coords.y)
            }
            if (this.ghostText) {
                const zoom = this.editor.svg.zoom() || 1
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
        this.editor.svg.on('mousemove', this.boundOnMouseMove)

        this.editor.signals.pointCaptured.addOnce(this.onSecondPoint, this)

        // Listen for coordinate input for second point
        this.boundOnSecondCoordinateInput = () => {
            this.editor.signals.pointCaptured.remove(this.onSecondPoint, this)
            this.onSecondPoint(this.editor.inputCoord)
        }
        this.editor.signals.coordinateInput.addOnce(this.boundOnSecondCoordinateInput, this)
    }

    onSecondPoint(point) {
        if (this.boundOnSecondCoordinateInput) {
            this.editor.signals.coordinateInput.remove(this.boundOnSecondCoordinateInput, this)
        }

        // Remove ghost line
        if (this.boundOnMouseMove) {
            this.editor.svg.off('mousemove', this.boundOnMouseMove)
            this.boundOnMouseMove = null
        }
        if (this.ghostGroup) {
            this.ghostGroup.remove()
            this.ghostGroup = null
            this.ghostLine = null
        }

        this.secondPoint = point
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

        this.cleanup()
    }

    drawMeasurement(p1, p2, distance) {
        // Remove any existing measurement
        this.clearMeasurement()

        const zoom = this.editor.svg.zoom() || 1
        const fontSize = 14 / zoom
        const strokeWidth = 1.5 / zoom

        this.measureGroup = this.editor.overlays.group().addClass('measure-overlay')

        // Dashed line between points
        this.measureGroup
            .line(p1.x, p1.y, p2.x, p2.y)
            .addClass('measure-line')
            .stroke({ width: strokeWidth, dasharray: `${6 / zoom} ${4 / zoom}` })

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
            .attr('font-family', "'Fira Mono', 'JetBrains Mono', 'Cascadia Code', monospace")
            .attr('font-size', fontSize)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .fill('#cccccc')
            .attr('transform', `translate(${offsetX}, ${offsetY}) rotate(${angleDeg})`)

        // Register cleanup on next command or cancel
        this.boundOnClearMeasure = () => this.clearMeasurement()
        this.editor.signals.commandCancelled.addOnce(this.boundOnClearMeasure, this)
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

    cleanup() {
        // Remove ghost elements
        if (this.boundOnMouseMove) {
            this.editor.svg.off('mousemove', this.boundOnMouseMove)
            this.boundOnMouseMove = null
        }
        if (this.ghostGroup) {
            this.ghostGroup.remove()
            this.ghostGroup = null
            this.ghostLine = null
        }

        // Remove signal listeners
        this.editor.signals.pointCaptured.remove(this.onFirstPoint, this)
        this.editor.signals.pointCaptured.remove(this.onSecondPoint, this)
        if (this.boundOnFirstCoordinateInput) {
            this.editor.signals.coordinateInput.remove(this.boundOnFirstCoordinateInput, this)
        }
        if (this.boundOnSecondCoordinateInput) {
            this.editor.signals.coordinateInput.remove(this.boundOnSecondCoordinateInput, this)
        }
        if (this.boundOnCancelled) {
            this.editor.signals.commandCancelled.remove(this.boundOnCancelled, this)
            this.boundOnCancelled = null
        }

        this.editor.isInteracting = false
        this.editor.selectSingleElement = false
    }
}

function measureDistanceCommand(editor) {
    const cmd = new MeasureDistanceCommand(editor)
    cmd.execute()
}

export { measureDistanceCommand }
