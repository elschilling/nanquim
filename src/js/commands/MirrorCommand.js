import { getArcGeometry } from '../utils/arcUtils'
import { Command } from '../Command'
import { applyCollectionStyleToElement } from '../Collection'
import { renderEllipseArc } from '../utils/ellipseArcUtils'
import { remapSvgIds } from '../utils/sanitizeSvg'
import {
    hasOwnGeometryTransform,
    hasUnsupportedAncestorTransform,
} from '../utils/geometryTransformQualification'

const TRANSFORMED_MIRROR_DIAGNOSTIC = 'MIRROR does not support transformed geometry or geometry inside transformed groups.'

function hasUnsupportedMirrorTransform(element, drawing) {
    return hasUnsupportedAncestorTransform(element, drawing) || hasOwnGeometryTransform(element)
}

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
 * Reflects a complete SVG path array across an axis.
 * Toggles sweep-flag for arc segments.
 */
function reflectPath(pathArray, p1, p2) {
    return pathArray.map(segment => {
        const type = segment[0]
        const newSegment = [type]

        if (type === 'M' || type === 'L' || type === 'T') {
            const refl = reflectPoint({ x: segment[1], y: segment[2] }, p1, p2)
            newSegment.push(refl.x, refl.y)
        } else if (type === 'H') {
            // Convert to L since horizontal might not be horizontal after reflection
            const refl = reflectPoint({ x: segment[1], y: 0 }, p1, p2) // Reference y is tricky here, but path usually starts after M
            // For simplicity in mirroring complex paths, we assume callers might have used absolute coords
            // but H/V are rare in our generated paths. If encountered, we treat them as absolute points.
            newSegment[0] = 'L'
            newSegment.push(refl.x, refl.y)
        } else if (type === 'V') {
            const refl = reflectPoint({ x: 0, y: segment[1] }, p1, p2)
            newSegment[0] = 'L'
            newSegment.push(refl.x, refl.y)
        } else if (type === 'C') {
            const r1 = reflectPoint({ x: segment[1], y: segment[2] }, p1, p2)
            const r2 = reflectPoint({ x: segment[3], y: segment[4] }, p1, p2)
            const r3 = reflectPoint({ x: segment[5], y: segment[6] }, p1, p2)
            newSegment.push(r1.x, r1.y, r2.x, r2.y, r3.x, r3.y)
        } else if (type === 'S' || type === 'Q') {
            const r1 = reflectPoint({ x: segment[1], y: segment[2] }, p1, p2)
            const r2 = reflectPoint({ x: segment[3], y: segment[4] }, p1, p2)
            newSegment.push(r1.x, r1.y, r2.x, r2.y)
        } else if (type === 'A') {
            // A rx ry x-axis-rotation large-arc-flag sweep-flag x y
            const refl = reflectPoint({ x: segment[6], y: segment[7] }, p1, p2)
            newSegment.push(segment[1], segment[2], segment[3], segment[4])
            // TOGGLE SWEEP FLAG: mirroring flips the orientation
            newSegment.push(segment[5] === 1 ? 0 : 1)
            newSegment.push(refl.x, refl.y)
        } else if (type === 'Z') {
            // Nothing to do
        }
        return newSegment
    })
}

/**
 * Rebuild an SVG arc path string from 3 defining points (same math as DrawArcCommand).
 */
function rebuildArcPath(rp1, rp2, rp3) {
    const geo = getArcGeometry(rp1, rp2, rp3)

    // Collinear → straight line
    if (!geo) {
        return `M ${rp1.x} ${rp1.y} L ${rp3.x} ${rp3.y}`
    }

    return `M ${rp1.x} ${rp1.y} A ${geo.radius} ${geo.radius} 0 ${geo.largeArcFlag} ${geo.sweepFlag} ${rp3.x} ${rp3.y}`
}

class MirrorCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'MirrorCommand'
        this.name = 'Mirror'
        this.boundOnKeyDown = this.onKeyDown.bind(this)
        this.copiedElements = []
        this.copiedParents = []
        this.copiedNextSiblings = []
        this.originalParents = []
        this.originalNextSiblings = []
        this.idsRemapped = false
        this.interactiveExecutionDone = false
        this.ghostLine = null
    }

    execute() {
        if (this.interactiveExecutionDone) {
            this.applyMutation()
            return
        }

        this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `Select elements to mirror and press Enter to confirm.`,
        })
        document.addEventListener('keydown', this.boundOnKeyDown)
        this.editor.signals.commandCancelled.addOnce(this.cancelCommand, this)
        this.editor.suppressHandlers = true
        this.editor.handlers.clear()
    }

    onKeyDown(event) {
        if (event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter') {
            document.removeEventListener('keydown', this.boundOnKeyDown)
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
        if (selectedElements.some((element) => (
            hasUnsupportedMirrorTransform(element, this.editor.drawing)
        ))) {
            this.editor.signals.terminalLogged.dispatch({
                msg: TRANSFORMED_MIRROR_DIAGNOSTIC,
                type: 'error',
            })
            this.cleanup()
            return
        }

        this.originalPositions = this.editor.selected.map((element) => this.getElementPosition(element))
        this.originalSelection = this.editor.selected.slice()
        this.originalParents = this.originalSelection.map((element) => element.parent() || this.editor.activeCollection)
        this.originalNextSiblings = this.originalSelection.map((element) => element.node.nextSibling)

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
            .addClass('mirror-axis-helper')
            .stroke({ color: '#fff', width: .1, dasharray: '.1,.1' })
            .attr('pointer-events', 'none')

        // Create clones that will update during mousemove
        this.copiedElements = this.originalSelection.map((el, index) => {
            const originalPos = this.originalPositions[index]
            const parent = el.parent() || this.editor.activeCollection
            this.copiedParents[index] = parent

            if (originalPos.type === 'rect') {
                // Convert rect to polygon so it can represent rotated reflections
                const poly = parent.polygon([
                    [originalPos.x, originalPos.y],
                    [originalPos.x + originalPos.width, originalPos.y],
                    [originalPos.x + originalPos.width, originalPos.y + originalPos.height],
                    [originalPos.x, originalPos.y + originalPos.height]
                ])
                // Copy styles from the original rect
                // If it's hovered or selected, getComputedStyle might be wrong
                const isHighlighted = el.hasClass('elementHover') || el.hasClass('elementSelected')
                const strokeColor = isHighlighted ? (el.attr('stroke') || '#000') : (window.getComputedStyle(el.node).stroke || el.attr('stroke'))
                const strokeWidth = isHighlighted ? (el.attr('stroke-width') || 1) : (parseFloat(window.getComputedStyle(el.node).strokeWidth) || parseFloat(el.attr('stroke-width')) || 1)
                const fillColor = isHighlighted ? (el.attr('fill') || 'none') : (window.getComputedStyle(el.node).fill || el.attr('fill') || 'none')

                poly.stroke({
                    color: strokeColor,
                    width: strokeWidth
                })
                poly.fill(fillColor)
                poly.attr('name', el.attr('name') || 'Rectangle')
                poly.attr('data-nanquim-transient', 'true')
                poly.attr('opacity', 0.5)
                return poly
            } else {
                const clone = el.clone()
                clone.attr('data-nanquim-transient', 'true')
                parent.add(clone)
                clone.attr('opacity', 0.5)
                // Remove interactive classes from the mirror clone
                const stripClasses = (element) => {
                    element.removeClass('elementHover')
                    element.removeClass('elementSelected')
                    if (element.type === 'g' && element.children) {
                        element.children().each(child => stripClasses(child))
                    }
                }
                stripClasses(clone)

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
        this.updateMirroredGeometry(p2)
    }

    updateMirroredGeometry(p2) {
        // Update ghost clones positions based on reflection math
        this.copiedElements.forEach((clone, index) => {
            const originalPos = this.originalPositions[index]

            if (originalPos.type === 'line' || originalPos.type === 'polygon') {
                const newPoints = originalPos.points.map((p) => {
                    const refl = reflectPoint({ x: p[0], y: p[1] }, this.basePoint, p2)
                    return [refl.x, refl.y]
                })
                clone.plot(newPoints)
            } else if (originalPos.type === 'path') {
                if (originalPos.arcData) {
                    // Arc: reflect the 3 defining points and rebuild the SVG path
                    const ad = originalPos.arcData
                    const rp1 = reflectPoint(ad.p1, this.basePoint, p2)
                    const rp2 = reflectPoint(ad.p2, this.basePoint, p2)
                    const rp3 = reflectPoint(ad.p3, this.basePoint, p2)
                    clone.plot(rebuildArcPath(rp1, rp2, rp3))
                    clone.data('arcData', { p1: rp1, p2: rp2, p3: rp3 })
                } else if (originalPos.splineData) {
                    // Spline: reflect all control points and rebuild with Catmull-Rom
                    const sd = originalPos.splineData
                    const reflectedPoints = sd.points.map(p => reflectPoint(p, this.basePoint, p2))
                    clone.data('splineData', { points: reflectedPoints })
                    // Path array already handled by reflectPath above for visual
                } else {
                    // General path (DXF import, etc.): reflect the path segments
                    clone.plot(reflectPath(originalPos.pathArray, this.basePoint, p2))
                }
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

        if (
            this.secondPoint.x === this.basePoint.x
            && this.secondPoint.y === this.basePoint.y
        ) {
            this.editor.signals.terminalLogged.dispatch({ msg: 'Mirror axis requires two different points.', type: 'error' })
            this.cancelCommand()
            return
        }

        this.updateMirroredGeometry(this.secondPoint)

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
                this.deletedSource = true
                this.editor.signals.terminalLogged.dispatch({ msg: 'Source objects deleted.' })
            } else {
                this.deletedSource = false
                this.editor.signals.terminalLogged.dispatch({ msg: 'Source objects kept.' })
            }
            this.finishCommand()
        }

        this.editor.signals.inputValue.addOnce(this.boundOnInput, this)
    }

    finishCommand() {
        this.cleanup()
        this.editor.selectSingleElement = false

        // The reflected elements were live, transient previews. Detach them
        // before recording so History.execute performs the persistent change.
        this.copiedElements.forEach((element) => element.remove())

        this.interactiveExecutionDone = true
        try {
            this.editor.execute(this)
            this.dispatchSignal('clearSelection')
            this.editor.selected = []
        } catch (error) {
            this.editor.selected = this.originalSelection.slice()
            this.dispatchSignal('updatedSelection')
            throw error
        }
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
        if (originalPos.splineData) {
            const sd = originalPos.splineData
            element.data('splineData', {
                points: sd.points.map(p => reflectPoint(p, p1, p2))
            })
        }
        if (originalPos.ellipseArcData) {
            const mirrored = reflectEllipseArcData(originalPos.ellipseArcData, p1, p2)
            if (mirrored) renderEllipseArc(element, mirrored)
            else element.removeData('ellipseArcData')
        }
    }

    getElementPosition(element) {
        const data = {
            arcData: element.data('arcData'),
            circleTrimData: element.data('circleTrimData'),
            splineData: element.data('splineData'),
            ellipseArcData: element.data('ellipseArcData'),
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
                pathArray: element.array().slice(),
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
        if (this.boundOnEsc) document.removeEventListener('keydown', this.boundOnEsc)
        if (this.boundOnMouseMove) document.removeEventListener('mousemove', this.boundOnMouseMove)
        this.editor.signals.commandCancelled.remove(this.cancelCommand, this)
        this.editor.signals.pointCaptured.remove(this.onBasePoint, this)
        this.editor.signals.pointCaptured.remove(this.onSecondPoint, this)
        if (this.boundOnInput) this.editor.signals.inputValue.remove(this.boundOnInput, this)
        this.editor.isInteracting = false
        this.editor.suppressHandlers = false
        this.deferSessionTask(() => {
            this.editor.selectSingleElement = false
        }, 10)
    }

    undo() {
        const transientAttributes = this.copiedElements.map((element) => (
            element.attr('data-nanquim-transient')
        ))
        try {
            this.copiedElements.forEach((element) => {
                element.remove()
            })

            if (this.deletedSource) this.restoreOriginalElements()
        } catch (error) {
            const rollbackErrors = []
            if (this.deletedSource) {
                this.originalSelection.forEach((element) => {
                    try {
                        if (element.node.parentNode) {
                            element.node.parentNode.removeChild(element.node)
                        }
                    } catch (rollbackError) {
                        rollbackErrors.push(rollbackError)
                    }
                })
            }
            try {
                this.restoreCopiedElements()
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError)
            }
            this.copiedElements.forEach((element, index) => {
                try {
                    this.restoreTransientAttribute(element, transientAttributes[index])
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError)
                }
            })
            this.invalidateGeometry()
            if (rollbackErrors.length > 0) {
                throw new AggregateError(
                    [error, ...rollbackErrors],
                    'Mirror Undo failed and the applied geometry could not be fully restored.',
                    { cause: error },
                )
            }
            throw error
        }

        this.editor.selected = this.originalSelection.slice()
        this.invalidateGeometry()
        this.dispatchSignal('updatedSelection')
        this.dispatchSignal('terminalLogged', { msg: 'Undo: Mirror undone.' })
    }

    redo() {
        this.applyMutation()
        this.editor.selected = this.copiedElements.slice()
        this.dispatchSignal('updatedSelection')

        this.dispatchSignal('terminalLogged', { msg: 'Redo: Mirror reapplied.' })
    }

    applyMutation() {
        const initialElementIndex = this.editor.elementIndex
        const hadRemappedIds = this.idsRemapped
        const transientAttributes = this.copiedElements.map((element) => (
            element.attr('data-nanquim-transient')
        ))
        try {
            this.remapCopiedIds()
            this.copiedElements.forEach((element, index) => {
                const parent = this.copiedParents[index]
                if (parent) parent.add(element)
                element.attr('data-nanquim-transient', null)
            })

            if (this.deletedSource) {
                this.originalSelection.forEach((element) => element.remove())
            }

            this.copiedElements.forEach((element, index) => {
                this.copiedNextSiblings[index] = element.node.nextSibling
            })
        } catch (error) {
            const rollbackErrors = []
            this.copiedElements.forEach((element, index) => {
                try {
                    if (element.node.parentNode) {
                        element.node.parentNode.removeChild(element.node)
                    }
                    this.restoreTransientAttribute(element, transientAttributes[index])
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError)
                }
            })
            if (this.deletedSource) {
                try {
                    this.restoreOriginalElements()
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError)
                }
            }
            if (!hadRemappedIds) {
                this.editor.elementIndex = initialElementIndex
                this.idsRemapped = false
            }
            this.invalidateGeometry()
            if (rollbackErrors.length > 0) {
                throw new AggregateError(
                    [error, ...rollbackErrors],
                    'Mirror failed and its original geometry could not be fully restored.',
                    { cause: error },
                )
            }
            throw error
        }

        this.invalidateGeometry()
    }

    restoreOriginalElements() {
        for (let index = this.originalSelection.length - 1; index >= 0; index -= 1) {
            const element = this.originalSelection[index]
            const parent = this.originalParents[index]
            if (!parent) continue
            const nextSibling = this.originalNextSiblings[index]
            const reference = nextSibling?.parentNode === parent.node ? nextSibling : null
            parent.node.insertBefore(element.node, reference)
        }
    }

    restoreCopiedElements() {
        for (let index = this.copiedElements.length - 1; index >= 0; index -= 1) {
            const element = this.copiedElements[index]
            const parent = this.copiedParents[index]
            if (!parent || element.node.parentNode === parent.node) continue
            const nextSibling = this.copiedNextSiblings[index]
            const reference = nextSibling?.parentNode === parent.node ? nextSibling : null
            parent.node.insertBefore(element.node, reference)
        }
    }

    restoreTransientAttribute(element, value) {
        if (value == null) element.attr('data-nanquim-transient', null)
        else element.attr('data-nanquim-transient', value)
    }

    invalidateGeometry() {
        this.editor.spatialIndex.markDirty()
        this.editor.fullSpatialIndex.markDirty()
        this.dispatchSignal('updatedOutliner')
        this.dispatchSignal('updatedProperties')
    }

    remapCopiedIds() {
        if (this.idsRemapped) return
        const initialElementIndex = this.editor.elementIndex
        try {
            this.copiedElements.forEach((element) => {
                remapSvgIds([element.node], () => this.editor.elementIndex++)
            })
            this.idsRemapped = true
        } catch (error) {
            this.editor.elementIndex = initialElementIndex
            throw error
        }
    }
}

function reflectEllipseArcData(data, p1, p2) {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const length = Math.hypot(dx, dy)
    if (length < 1e-6) return null

    // Reflection preserves the ellipse radii but rotates its local x-axis.
    // The reflected local y-axis is reversed, so the parameter direction and
    // SVG sweep must be inverted as well.
    const ux = dx / length
    const uy = dy / length
    const rotation = data.rotation || 0
    const localXAxis = { x: Math.cos(rotation), y: Math.sin(rotation) }
    const reflectedXAxis = {
        x: (2 * ux * ux - 1) * localXAxis.x + (2 * ux * uy) * localXAxis.y,
        y: (2 * ux * uy) * localXAxis.x + (2 * uy * uy - 1) * localXAxis.y,
    }

    const center = reflectPoint({ x: data.cx, y: data.cy }, p1, p2)
    return {
        ...data,
        cx: center.x,
        cy: center.y,
        rotation: Math.atan2(reflectedXAxis.y, reflectedXAxis.x),
        theta1: -data.theta1,
        theta2: -data.theta2,
        ccw: data.ccw === false,
    }
}

export function mirrorCommand(editor) {
    const cmd = new MirrorCommand(editor)
    cmd.execute()
}

export { MirrorCommand }
