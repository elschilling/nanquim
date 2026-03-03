import { Command } from '../Command'
import { applyCollectionStyleToElement } from '../Collection'

function reflectPoint(p, p1, p2) {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y

    if (dx === 0 && dy === 0) return { x: p.x, y: p.y }

    const L2 = dx * dx + dy * dy
    const dot = (p.x - p1.x) * dx + (p.y - p1.y) * dy
    const projX = p1.x + (dot * dx) / L2
    const projY = p1.y + (dot * dy) / L2

    return {
        x: 2 * projX - p.x,
        y: 2 * projY - p.y
    }
}

/**
 * Rebuild an SVG arc path string from 3 defining points (same math as DrawArcCommand).
 */
function rebuildArcPath(rp1, rp2, rp3) {
    const A = rp1.x * (rp2.y - rp3.y) - rp1.y * (rp2.x - rp3.x) + rp2.x * rp3.y - rp3.x * rp2.y

    // Collinear → straight line
    if (Math.abs(A) < 0.1) {
        return `M ${rp1.x} ${rp1.y} L ${rp3.x} ${rp3.y}`
    }

    const p1sq = rp1.x * rp1.x + rp1.y * rp1.y
    const p2sq = rp2.x * rp2.x + rp2.y * rp2.y
    const p3sq = rp3.x * rp3.x + rp3.y * rp3.y

    const B = p1sq * (rp3.y - rp2.y) + p2sq * (rp1.y - rp3.y) + p3sq * (rp2.y - rp1.y)
    const C = p1sq * (rp2.x - rp3.x) + p2sq * (rp3.x - rp1.x) + p3sq * (rp1.x - rp2.x)

    const cx = -B / (2 * A)
    const cy = -C / (2 * A)

    let radius = Math.sqrt((cx - rp1.x) ** 2 + (cy - rp1.y) ** 2)
    radius = Math.min(radius, 100000)

    let startAngle = Math.atan2(rp1.y - cy, rp1.x - cx)
    let midAngle = Math.atan2(rp2.y - cy, rp2.x - cx)
    let endAngle = Math.atan2(rp3.y - cy, rp3.x - cx)

    if (startAngle < 0) startAngle += 2 * Math.PI
    if (midAngle < 0) midAngle += 2 * Math.PI
    if (endAngle < 0) endAngle += 2 * Math.PI

    let sweepFlag = 0
    let largeArcFlag = 0

    let ccwDistance = endAngle - startAngle
    if (ccwDistance < 0) ccwDistance += 2 * Math.PI

    let midCcwDistance = midAngle - startAngle
    if (midCcwDistance < 0) midCcwDistance += 2 * Math.PI

    if (midCcwDistance < ccwDistance) {
        sweepFlag = 1
        largeArcFlag = ccwDistance > Math.PI ? 1 : 0
    } else {
        sweepFlag = 0
        let cwDistance = 2 * Math.PI - ccwDistance
        largeArcFlag = cwDistance > Math.PI ? 1 : 0
    }

    return `M ${rp1.x} ${rp1.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${rp3.x} ${rp3.y}`
}

class MirrorCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'MirrorCommand'
        this.name = 'Mirror'
        this.boundOnKeyDown = this.onKeyDown.bind(this)
        this.copiedElements = []
        this.interactiveExecutionDone = false
        this.ghostLine = null
    }

    execute() {
        if (this.interactiveExecutionDone) return

        this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `Select elements to mirror and press Enter to confirm.`,
        })
        document.addEventListener('keydown', this.boundOnKeyDown)
        this.editor.suppressHandlers = true
        this.editor.handlers.clear()
    }

    onKeyDown(event) {
        if (event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter') {
            this.cleanup()
            this.editor.isInteracting = true
            this.onSelectionConfirmed()
        } else if (event.key === 'Escape') {
            this.cancelCommand()
        }
    }

    cancelCommand() {
        if (this.copiedElements.length > 0) {
            this.copiedElements.forEach((el) => el.remove())
            this.copiedElements = []
        }
        if (this.ghostLine) {
            this.ghostLine.remove()
            this.ghostLine = null
        }
        if (this.boundOnMouseMove) {
            document.removeEventListener('mousemove', this.boundOnMouseMove)
        }
        if (this.boundOnEsc) {
            document.removeEventListener('keydown', this.boundOnEsc)
        }
        this.cleanup()
        this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
    }

    onSelectionConfirmed() {
        const selectedElements = this.editor.selected
        if (selectedElements.length === 0) {
            this.editor.signals.terminalLogged.dispatch({ msg: 'No elements selected. Command cancelled.' })
            this.cleanup()
            return
        }

        this.originalPositions = this.editor.selected.map((element) => this.getElementPosition(element))
        this.originalSelection = this.editor.selected.slice()

        this.editor.selectSingleElement = true

        this.editor.signals.terminalLogged.dispatch({ msg: `Selected ${selectedElements.length} elements.` })
        this.editor.signals.terminalLogged.dispatch({ msg: 'Specify first point of mirror line.' })
        this.editor.signals.pointCaptured.addOnce(this.onBasePoint, this)

        this.boundOnEsc = (event) => {
            if (event.code === 'Escape') this.cancelCommand()
        }
        document.addEventListener('keydown', this.boundOnEsc)
    }

    onBasePoint(point) {
        this.basePoint = point
        this.editor.signals.terminalLogged.dispatch({ msg: `First point: ${this.basePoint.x.toFixed(2)}, ${this.basePoint.y.toFixed(2)}` })
        this.editor.signals.terminalLogged.dispatch({ msg: 'Specify second point of mirror line.' })

        // Draw a ghost line for the mirror axis
        this.ghostLine = this.editor.svg.line(this.basePoint.x, this.basePoint.y, this.basePoint.x, this.basePoint.y)
            .addClass('ghostLine')
            .stroke({ color: '#fff', width: .1, dasharray: '.1,.1' })
            .attr('pointer-events', 'none')

        // Create clones that will update during mousemove
        this.copiedElements = this.originalSelection.map((el, index) => {
            const originalPos = this.originalPositions[index]
            const parent = el.parent() || this.editor.activeCollection

            if (originalPos.type === 'rect') {
                // Convert rect to polygon so it can represent rotated reflections
                const poly = this.editor.drawing.polygon([
                    [originalPos.x, originalPos.y],
                    [originalPos.x + originalPos.width, originalPos.y],
                    [originalPos.x + originalPos.width, originalPos.y + originalPos.height],
                    [originalPos.x, originalPos.y + originalPos.height]
                ])
                // Copy styles from the original rect
                const computedStyle = window.getComputedStyle(el.node)
                poly.stroke({
                    color: computedStyle.stroke || el.attr('stroke'),
                    width: parseFloat(computedStyle.strokeWidth) || parseFloat(el.attr('stroke-width')) || 1
                })
                poly.fill(computedStyle.fill || el.attr('fill') || 'none')
                poly.attr('name', el.attr('name') || 'Rectangle')
                poly.attr('id', this.editor.elementIndex++)
                parent.add(poly)
                poly.attr('opacity', 0.5)
                return poly
            } else {
                const clone = el.clone()
                parent.add(clone)
                clone.attr('opacity', 0.5)
                return clone
            }
        })

        this.boundOnMouseMove = this.onMouseMove.bind(this)
        document.addEventListener('mousemove', this.boundOnMouseMove)

        this.editor.signals.pointCaptured.addOnce(this.onSecondPoint, this)
    }

    onMouseMove(event) {
        let currentPoint = this.editor.snapPoint || this.editor.coordinates
        if (!currentPoint) return

        let p2 = { x: currentPoint.x, y: currentPoint.y }

        // Ortho mode
        if (this.editor.ortho) {
            const dx = p2.x - this.basePoint.x
            const dy = p2.y - this.basePoint.y
            if (Math.abs(dx) > Math.abs(dy)) {
                p2.y = this.basePoint.y
            } else {
                p2.x = this.basePoint.x
            }
        }

        // Protect against zero-length axis
        if (p2.x === this.basePoint.x && p2.y === this.basePoint.y) {
            p2.x += 1e-5
        }

        this.ghostLine.plot(this.basePoint.x, this.basePoint.y, p2.x, p2.y)

        // Update ghost clones positions based on reflection math
        this.copiedElements.forEach((clone, index) => {
            const originalPos = this.originalPositions[index]

            if (originalPos.type === 'line' || originalPos.type === 'polygon') {
                const newPoints = originalPos.points.map((p) => {
                    const refl = reflectPoint({ x: p[0], y: p[1] }, this.basePoint, p2)
                    return [refl.x, refl.y]
                })
                clone.plot(newPoints)
            } else if (originalPos.type === 'path' && originalPos.arcData) {
                // Arc: reflect the 3 defining points and rebuild the SVG path
                const ad = originalPos.arcData
                const rp1 = reflectPoint(ad.p1, this.basePoint, p2)
                const rp2 = reflectPoint(ad.p2, this.basePoint, p2)
                const rp3 = reflectPoint(ad.p3, this.basePoint, p2)
                clone.plot(rebuildArcPath(rp1, rp2, rp3))
                clone.data('arcData', { p1: rp1, p2: rp2, p3: rp3 })
            } else if (originalPos.type === 'center') {
                const refl = reflectPoint({ x: originalPos.cx, y: originalPos.cy }, this.basePoint, p2)
                clone.center(refl.x, refl.y)
            } else if (originalPos.type === 'rect') {
                // Reflect all 4 corners and update the polygon points
                const corners = [
                    { x: originalPos.x, y: originalPos.y },
                    { x: originalPos.x + originalPos.width, y: originalPos.y },
                    { x: originalPos.x + originalPos.width, y: originalPos.y + originalPos.height },
                    { x: originalPos.x, y: originalPos.y + originalPos.height }
                ]
                const reflected = corners.map(c => reflectPoint(c, this.basePoint, p2))
                clone.plot(reflected.map(r => [r.x, r.y]))
            } else {
                // Fallback for text, etc.
                const refl = reflectPoint({ x: originalPos.x, y: originalPos.y }, this.basePoint, p2)
                clone.move(refl.x, refl.y)
            }

            this.updateArcData(clone, originalPos, this.basePoint, p2)
        })
    }

    onSecondPoint(point) {
        document.removeEventListener('mousemove', this.boundOnMouseMove)
        if (this.boundOnEsc) document.removeEventListener('keydown', this.boundOnEsc)

        this.secondPoint = point
        if (this.editor.ortho) {
            const dx = this.secondPoint.x - this.basePoint.x
            const dy = this.secondPoint.y - this.basePoint.y
            if (Math.abs(dx) > Math.abs(dy)) {
                this.secondPoint.y = this.basePoint.y
            } else {
                this.secondPoint.x = this.basePoint.x
            }
        }

        if (this.ghostLine) {
            this.ghostLine.remove()
            this.ghostLine = null
        }

        // Restore opacity on clones
        this.copiedElements.forEach((clone, index) => {
            const origOpacity = this.originalPositions[index].opacity
            if (origOpacity !== undefined) {
                clone.attr('opacity', origOpacity)
            } else {
                clone.attr('opacity', 1)
            }
            applyCollectionStyleToElement(this.editor, clone)
        })

        // Prompt for delete
        this.editor.signals.terminalLogged.dispatch({ type: 'span', msg: 'Delete source objects? [Y/N] (default: N):' })

        this.boundOnInput = (value) => {
            const val = value.trim().toLowerCase()
            if (val === 'y' || val === 'yes') {
                // Delete original selection
                this.originalSelection.forEach((el) => {
                    if (el && el.node) el.remove()
                })
                this.deletedSource = true
                this.editor.signals.terminalLogged.dispatch({ msg: 'Source objects deleted.' })
            } else {
                this.deletedSource = false
                this.editor.signals.terminalLogged.dispatch({ msg: 'Source objects kept.' })
            }
            this.finishCommand()
        }

        this.editor.signals.inputValue.addOnce(this.boundOnInput)
    }

    finishCommand() {
        this.editor.isInteracting = false
        this.editor.suppressHandlers = false
        this.editor.selectSingleElement = false
        this.editor.signals.clearSelection.dispatch()
        this.editor.selected = []
        this.editor.signals.updatedOutliner.dispatch()

        this.interactiveExecutionDone = true
        this.editor.execute(this)
        this.editor.lastCommand = new MirrorCommand(this.editor)
    }

    updateArcData(element, originalPos, p1, p2) {
        if (originalPos.arcData) {
            const ad = originalPos.arcData
            element.data('arcData', {
                p1: reflectPoint(ad.p1, p1, p2),
                p2: reflectPoint(ad.p2, p1, p2),
                p3: reflectPoint(ad.p3, p1, p2)
            })
        }
        if (originalPos.circleTrimData) {
            const ctd = originalPos.circleTrimData
            element.data('circleTrimData', {
                ...ctd,
                cx: reflectPoint({ x: ctd.cx, y: ctd.cy }, p1, p2).x,
                cy: reflectPoint({ x: ctd.cx, y: ctd.cy }, p1, p2).y,
                startPt: reflectPoint(ctd.startPt, p1, p2),
                endPt: reflectPoint(ctd.endPt, p1, p2)
            })
        }
    }

    getElementPosition(element) {
        const data = {
            arcData: element.data('arcData'),
            circleTrimData: element.data('circleTrimData'),
            opacity: element.attr('opacity')
        }

        if (element.type === 'line') {
            return {
                type: 'line',
                points: element.array().slice(),
                ...data
            }
        } else if (element.type === 'path') {
            return {
                type: 'path',
                d: element.attr('d'),
                ...data
            }
        } else if (element.type === 'polygon' || element.type === 'polyline') {
            return {
                type: 'polygon',
                points: element.array().slice(),
                ...data
            }
        } else if (element.type === 'circle' || element.type === 'ellipse') {
            return {
                type: 'center',
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
        } else {
            return {
                type: 'position',
                x: element.x(),
                y: element.y(),
                ...data
            }
        }
    }

    cleanup() {
        document.removeEventListener('keydown', this.boundOnKeyDown)
        this.editor.isInteracting = false
        this.editor.selectSingleElement = false
        this.editor.suppressHandlers = false
    }

    undo() {
        // Revert what we did: remove clones
        this.copiedElements.forEach((element) => {
            element.remove()
        })

        // If we deleted source, restore them
        if (this.deletedSource) {
            this.originalSelection.forEach((element) => {
                const parent = element.parent() || this.editor.activeCollection || this.editor.drawing
                if (parent) parent.add(element)
            })
            this.editor.selected = this.originalSelection.slice()
        } else {
            this.editor.selected = this.originalSelection.slice()
        }

        this.editor.signals.updatedSelection.dispatch()
        this.editor.signals.terminalLogged.dispatch({ msg: 'Undo: Mirror undone.' })
    }

    redo() {
        // Redo what we did: add clones back
        this.copiedElements.forEach((element) => {
            const parent = element.parent() || this.editor.activeCollection || this.editor.drawing
            if (parent) parent.add(element)
        })

        // If we deleted source, remove them again
        if (this.deletedSource) {
            this.originalSelection.forEach((element) => {
                element.remove()
            })
        }

        this.editor.selected = this.copiedElements.slice()
        this.editor.signals.updatedSelection.dispatch()

        this.editor.signals.terminalLogged.dispatch({ msg: 'Redo: Mirror reapplied.' })
    }
}

export function mirrorCommand(editor) {
    const cmd = new MirrorCommand(editor)
    cmd.execute()
}
