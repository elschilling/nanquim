import { Command } from '../Command'
import { EditVertexCommand } from './EditVertexCommand'
import { ExtendArcCommand } from './ExtendArcCommand'
import { getLineEquation, getLineIntersection, getLineCircleIntersections, getLineRectIntersections, getCircleCircleIntersections } from '../utils/intersection'
import { getDrawableElements } from '../Collection'

class ExtendCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'ExtendCommand'
        this.name = 'Extend'
        this.boundaryElements = []
        this.autoExtendMode = false
        this.boundOnKeyDown = this.onKeyDown.bind(this)
        this.boundOnElementSelected = this.onElementSelected.bind(this)
        this.boundOnLineClicked = this.onLineClicked.bind(this)
        this.boundOnMouseOver = this.onMouseOver.bind(this)
        this.boundOnMouseOut = this.onMouseOut.bind(this)
        this.boundOnMouseMove = this.onMouseMove.bind(this)
        this.ghostLine = null
        this.isExtending = false
    }

    execute() {
        this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })

        this.editor.signals.commandCancelled.addOnce(this.cleanup, this)
        document.addEventListener('keydown', this.boundOnKeyDown)
        document.addEventListener('mousemove', this.boundOnMouseMove)

        // Check if elements are already pre-selected
        if (this.editor.selected.length > 0) {
            this.boundaryElements = [...this.editor.selected]
            this.editor.signals.clearSelection.dispatch()
            this.startExtendingLines()
            this.editor.signals.requestHoverCheck.dispatch()
            return
        }

        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `Select boundary elements and press Enter. Or press Enter immediately for Auto-Extend mode.`,
        })

        this.editor.isInteracting = true
        this.editor.selectSingleElement = true
        this.editor.signals.toogledSelect.add(this.boundOnElementSelected)
    }

    boundOnCanvasClick(e) {
        // This is a fallback click handler to ensure clicks are processed
        // Trigger hover check to update hoveredElements
        this.editor.signals.requestHoverCheck.dispatch()
    }

    onKeyDown(event) {
        if (event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter') {
            event.preventDefault()
            this.editor.signals.toogledSelect.remove(this.boundOnElementSelected)

            if (this.isExtending) {
                this.cleanup()
                this.editor.signals.terminalLogged.dispatch({ msg: 'Command finished.' })
                return
            }

            if (this.boundaryElements.length === 0) {
                this.autoExtendMode = true
                this.editor.signals.terminalLogged.dispatch({ msg: 'Auto-Extend Mode ON: Click lines to extend to nearest intersecting element.' })
            } else {
                this.autoExtendMode = false
                this.editor.signals.terminalLogged.dispatch({ msg: `Extending to ${this.boundaryElements.length} boundaries. Click lines to extend.` })
            }
            this.startExtendingLines()
            this.editor.signals.requestHoverCheck.dispatch()
        } else if (event.key === 'Escape') {
            this.cleanup()
            this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
        }
    }

    onElementSelected(el) {
        if (!el) return
        if (!this.boundaryElements.includes(el)) {
            this.boundaryElements.push(el)
            el.addClass('elementSelected') // Visually mark as selected
            this.editor.signals.clearSelection.dispatch() // prevent sticking in editor selected array
            this.editor.signals.terminalLogged.dispatch({ msg: `Selected boundary element. Press Enter to confirm selection.` })
        }
    }

    startExtendingLines() {
        this.isExtending = true
        this.editor.isInteracting = true
        this.editor.selectSingleElement = false

        // Re-attach event handlers in case they were detached
        this.setupHoverEventListeners()

        // In this phase, selecting an element means we want to extend it
        this.editor.signals.toogledSelect.remove(this.boundOnLineClicked)
        this.editor.signals.toogledSelect.add(this.boundOnLineClicked)
    }

    setupHoverEventListeners() {
        // Setup hover events for ghosting
        const elements = getDrawableElements(this.editor)
        elements.forEach(el => {
            if (el.type === 'line' || (el.type === 'path' && el.data('arcData'))) {
                el.node.removeEventListener('mouseover', this.boundOnMouseOver)
                el.node.removeEventListener('mouseout', this.boundOnMouseOut)
                el.node.addEventListener('mouseover', this.boundOnMouseOver)
                el.node.addEventListener('mouseout', this.boundOnMouseOut)
            }
        })
    }

    calculateExtension(el, point) {
        if (!this.editor.lastClick) {
            // In case of rectangle selection, we might not have a reliable lastClick per element.
            // But we can approximate by calculating distance to boundaries based on pure intersection
            // If they did a rect select, we can use the mouse position from the end of the rect select:
            // editor.coordinates is updated constantly. We can use this.editor.coordinates.
            point = point || this.editor.coordinates
        }

        if (!el || !point) return null
        if (el.type === 'line') return this.calculateLineExtension(el, point)
        if (el.type === 'path' && el.data('arcData')) return this.calculateArcExtension(el, point)
        return null
    }

    calculateLineExtension(el, point) {
        const lineEq = getLineEquation(el)

        // Determine which end of the line was clicked/hovered
        const distToStart = Math.hypot(point.x - lineEq.x1, point.y - lineEq.y1)
        const distToEnd = Math.hypot(point.x - lineEq.x2, point.y - lineEq.y2)
        const extendStart = distToStart < distToEnd

        // Find the intersection points
        const intersections = []

        let candidateBoundaries = []
        if (this.autoExtendMode) {
            // In auto mode, check against all elements EXCEPT the line itself and ghost previews
            const allElements = getDrawableElements(this.editor)
            allElements.forEach((child) => {
                if (child.node !== el.node && !child.hasClass('grid') && !child.hasClass('axis') && !child.hasClass('ghostLine')) {
                    candidateBoundaries.push(child)
                }
            })
        } else {
            candidateBoundaries = this.boundaryElements
        }

        // Ray calculation
        const dx = lineEq.x2 - lineEq.x1
        const dy = lineEq.y2 - lineEq.y1
        const lineLen = Math.hypot(dx, dy)
        if (lineLen < 1e-6) return null

        // Normalize direction
        const ux = dx / lineLen
        const uy = dy / lineLen

        // If extending start, direction is from End to Start
        const dirX = extendStart ? -ux : ux
        const dirY = extendStart ? -uy : uy

        const rayBaseX = extendStart ? lineEq.x1 : lineEq.x2
        const rayBaseY = extendStart ? lineEq.y1 : lineEq.y2
        const MAX_DIST = 100000

        const virtualLine = {
            x1: rayBaseX,
            y1: rayBaseY,
            x2: rayBaseX + dirX * MAX_DIST,
            y2: rayBaseY + dirY * MAX_DIST
        }

        for (const boundary of candidateBoundaries) {
            if (boundary === el) continue // skip self

            const checkAndAddIntersection = (intersect) => {
                if (!intersect) return
                const interDx = intersect.x - rayBaseX
                const interDy = intersect.y - rayBaseY
                const dotProduct = interDx * dirX + interDy * dirY

                if (dotProduct > 1e-5) {
                    const dist = Math.hypot(intersect.x - rayBaseX, intersect.y - rayBaseY)
                    intersections.push({ point: intersect, dist })
                }
            }

            if (boundary.type === 'line') {
                const intersect = getLineIntersection(virtualLine, boundary)
                if (intersect) {
                    const bEq = getLineEquation(boundary)
                    const minX = Math.min(bEq.x1, bEq.x2) - 1e-4
                    const maxX = Math.max(bEq.x1, bEq.x2) + 1e-4
                    const minY = Math.min(bEq.y1, bEq.y2) - 1e-4
                    const maxY = Math.max(bEq.y1, bEq.y2) + 1e-4

                    if (intersect.x >= minX && intersect.x <= maxX && intersect.y >= minY && intersect.y <= maxY) {
                        checkAndAddIntersection(intersect)
                    }
                }
            } else if (boundary.type === 'circle') {
                const cx = boundary.cx(), cy = boundary.cy(), r = boundary.radius ? boundary.radius() : boundary.attr('r')
                getLineCircleIntersections(virtualLine, { cx, cy, r: parseFloat(r) }).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'rect') {
                const rectBounds = { x: boundary.x(), y: boundary.y(), width: boundary.width(), height: boundary.height() }
                getLineRectIntersections(virtualLine, rectBounds).forEach(checkAndAddIntersection)
            }
        }

        if (intersections.length === 0) return null

        intersections.sort((a, b) => a.dist - b.dist)
        const closestIntersect = intersections[0].point

        return {
            extendStart,
            vertexIndex: extendStart ? 0 : 1,
            oldPosition: { x: rayBaseX, y: rayBaseY },
            newPosition: closestIntersect,
            lineEq: lineEq
        }
    }

    getArcGeometry(data) {
        const { p1, p2, p3 } = data
        const A = p1.x * (p2.y - p3.y) - p1.y * (p2.x - p3.x) + p2.x * p3.y - p3.x * p2.y
        if (Math.abs(A) < 0.1) return null

        const p1sq = p1.x * p1.x + p1.y * p1.y
        const p2sq = p2.x * p2.x + p2.y * p2.y
        const p3sq = p3.x * p3.x + p3.y * p3.y

        const B = p1sq * (p3.y - p2.y) + p2sq * (p1.y - p3.y) + p3sq * (p2.y - p1.y)
        const C = p1sq * (p2.x - p3.x) + p2sq * (p3.x - p1.x) + p3sq * (p1.x - p2.x)

        const cx = -B / (2 * A)
        const cy = -C / (2 * A)
        const r = Math.sqrt((cx - p1.x) ** 2 + (cy - p1.y) ** 2)

        let theta1 = Math.atan2(p1.y - cy, p1.x - cx) // Start
        let theta2 = Math.atan2(p2.y - cy, p2.x - cx) // Mid
        let theta3 = Math.atan2(p3.y - cy, p3.x - cx) // End
        if (theta1 < 0) theta1 += 2 * Math.PI
        if (theta2 < 0) theta2 += 2 * Math.PI
        if (theta3 < 0) theta3 += 2 * Math.PI

        let ccw = true
        let ccwDistance = theta3 - theta1
        if (ccwDistance < 0) ccwDistance += 2 * Math.PI

        let midCcwDistance = theta2 - theta1
        if (midCcwDistance < 0) midCcwDistance += 2 * Math.PI

        if (midCcwDistance > ccwDistance) {
            ccw = false
        }

        return { cx, cy, r, theta1, theta3, ccw }
    }

    calculateArcExtension(el, point) {
        const arcData = el.data('arcData')
        const geo = this.getArcGeometry(arcData)
        if (!geo) return null

        const { cx, cy, r, theta1, theta3, ccw } = geo

        // Determine which end of the arc was clicked/hovered
        const distToStart = Math.hypot(point.x - arcData.p1.x, point.y - arcData.p1.y)
        const distToEnd = Math.hypot(point.x - arcData.p3.x, point.y - arcData.p3.y)
        const extendStart = distToStart < distToEnd

        // Intersection circle
        const circle = { cx, cy, r }
        const intersections = []

        let candidateBoundaries = []
        if (this.autoExtendMode) {
            const allElements = getDrawableElements(this.editor)
            allElements.forEach((child) => {
                if (child.node !== el.node && !child.hasClass('grid') && !child.hasClass('axis') && !child.hasClass('ghostLine')) {
                    candidateBoundaries.push(child)
                }
            })
        } else {
            candidateBoundaries = this.boundaryElements
        }

        const checkAndAddIntersection = (intersect) => {
            if (!intersect) return
            // Calculate angle of intersection
            let theta = Math.atan2(intersect.y - cy, intersect.x - cx)
            if (theta < 0) theta += 2 * Math.PI

            // We want to find an intersection that is "outside" the current arc
            // and in the direction of the extension.

            let sweep = theta3 - theta1
            if (!ccw) {
                sweep = theta1 - theta3
            }
            if (sweep < 0) sweep += 2 * Math.PI

            let diff = theta - theta1
            if (!ccw) {
                diff = theta1 - theta
            }
            if (diff < 0) diff += 2 * Math.PI

            const isInside = diff > 1e-4 && diff < sweep - 1e-4

            if (!isInside) {
                // Determine if it's "ahead" of theta1 or theta3
                let distToTarget
                if (extendStart) {
                    distToTarget = ccw ? (theta1 - theta) : (theta - theta1)
                } else {
                    distToTarget = ccw ? (theta - theta3) : (theta3 - theta)
                }

                if (distToTarget < 0) distToTarget += 2 * Math.PI

                if (distToTarget > 1e-4) {
                    intersections.push({ point: intersect, dist: distToTarget })
                }
            }
        }

        for (const boundary of candidateBoundaries) {
            if (boundary.node === el.node) continue
            if (boundary.type === 'line') {
                const bEq = getLineEquation(boundary)
                getLineCircleIntersections(bEq, circle).forEach(pt => {
                    const minX = Math.min(bEq.x1, bEq.x2) - 1e-4
                    const maxX = Math.max(bEq.x1, bEq.x2) + 1e-4
                    const minY = Math.min(bEq.y1, bEq.y2) - 1e-4
                    const maxY = Math.max(bEq.y1, bEq.y2) + 1e-4
                    if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) {
                        checkAndAddIntersection(pt)
                    }
                })
            } else if (boundary.type === 'circle') {
                const bcx = boundary.cx(), bcy = boundary.cy(), br = boundary.radius ? boundary.radius() : parseFloat(boundary.attr('r'))
                getCircleCircleIntersections(circle, { cx: bcx, cy: bcy, r: br }).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'rect') {
                const rectBounds = { x: boundary.x(), y: boundary.y(), width: boundary.width(), height: boundary.height() }
                const segments = [
                    { x1: rectBounds.x, y1: rectBounds.y, x2: rectBounds.x + rectBounds.width, y2: rectBounds.y },
                    { x1: rectBounds.x + rectBounds.width, y1: rectBounds.y, x2: rectBounds.x + rectBounds.width, y2: rectBounds.y + rectBounds.height },
                    { x1: rectBounds.x + rectBounds.width, y1: rectBounds.y + rectBounds.height, x2: rectBounds.x, y2: rectBounds.y + rectBounds.height },
                    { x1: rectBounds.x, y1: rectBounds.y + rectBounds.height, x2: rectBounds.x, y2: rectBounds.y }
                ]
                segments.forEach(seg => {
                    getLineCircleIntersections(seg, circle).forEach(pt => {
                        const minX = Math.min(seg.x1, seg.x2) - 1e-4
                        const maxX = Math.max(seg.x1, seg.x2) + 1e-4
                        const minY = Math.min(seg.y1, seg.y2) - 1e-4
                        const maxY = Math.max(seg.y1, seg.y2) + 1e-4
                        if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) {
                            checkAndAddIntersection(pt)
                        }
                    })
                })
            }
        }

        if (intersections.length === 0) return null
        intersections.sort((a, b) => a.dist - b.dist)
        const closestIntersect = intersections[0].point

        return {
            type: 'arc',
            extendStart,
            vertexIndex: extendStart ? 0 : 2, // p1 is 0, p3 is 2 in our arcData usage
            oldPosition: extendStart ? arcData.p1 : arcData.p3,
            newPosition: closestIntersect,
            arcGeo: geo,
            arcData: arcData
        }
    }

    onMouseOver(e) {
        if (!this.editor.isInteracting) return

        // Find the precise SVG element associated with the event
        const el = SVG(e.target)
        if (!el || (el.type !== 'line' && !(el.type === 'path' && el.data('arcData')))) return

        // Need the mouse point translated to SVG coordinates
        const pt = this.editor.svg.node.createSVGPoint()
        pt.x = e.clientX
        pt.y = e.clientY
        const svgPt = pt.matrixTransform(this.editor.svg.node.getScreenCTM().inverse())
        const hoverPoint = { x: svgPt.x, y: svgPt.y }

        const extension = this.calculateExtension(el, hoverPoint)

        if (extension) {
            // Remove previous ghost if any
            this.clearGhost()

            if (extension.type === 'arc') {
                const { cx, cy, r } = extension.arcGeo
                const p1 = extension.extendStart ? extension.newPosition : extension.arcData.p1
                const p3 = extension.extendStart ? extension.arcData.p3 : extension.newPosition

                let tStartAngle = Math.atan2(p1.y - cy, p1.x - cx)
                let tEndAngle = Math.atan2(p3.y - cy, p3.x - cx)
                if (tStartAngle < 0) tStartAngle += 2 * Math.PI
                if (tEndAngle < 0) tEndAngle += 2 * Math.PI

                const ccw = extension.arcGeo.ccw
                const sweep = ccw ? 1 : 0
                let diff = ccw ? (tEndAngle - tStartAngle) : (tStartAngle - tEndAngle)
                if (diff < 0) diff += 2 * Math.PI
                const largeArc = diff > Math.PI ? 1 : 0

                const d = `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${p3.x} ${p3.y}`

                this.ghostLine = this.editor.overlays.path(d)
                    .stroke({ color: '#2196F3', width: 2, opacity: 0.5 }).fill('none') // styling as a preview
                    .addClass('newDrawing')
                    .addClass('ghostLine')
            } else {
                // Create ghost line
                const x1 = extension.extendStart ? extension.newPosition.x : extension.lineEq.x1
                const y1 = extension.extendStart ? extension.newPosition.y : extension.lineEq.y1
                const x2 = extension.extendStart ? extension.lineEq.x2 : extension.newPosition.x
                const y2 = extension.extendStart ? extension.lineEq.y2 : extension.newPosition.y

                this.ghostLine = this.editor.overlays.line(x1, y1, x2, y2)
                    .stroke({ color: '#2196F3', width: 2, opacity: 0.5 }) // styling as a preview
                    .addClass('newDrawing')
                    .addClass('ghostLine')
            }
        }
    }

    onMouseOut(e) {
        this.clearGhost()
    }

    onMouseMove(e) {
        // Force hover check on mouse move to ensure we can detect elements for rectangle selection
        if (this.isExtending && this.editor.isInteracting) {
            this.editor.signals.requestHoverCheck.dispatch()
        }
    }

    clearGhost() {
        if (this.ghostLine) {
            this.ghostLine.remove()
            this.ghostLine = null
        }
        // Also clear any ghost lines that might be in the drawing
        this.editor.svg.find('.ghostLine').forEach(el => el.remove())
    }

    onLineClicked(el, source) {
        try {
            if (!el || (el.type !== 'line' && !(el.type === 'path' && el.data('arcData'))) || el.hasClass('ghostLine')) {
                if (el && !el.hasClass('ghostLine')) {
                    this.editor.signals.terminalLogged.dispatch({ msg: 'Only lines and arcs can be extended.' })
                }
                return
            }

            this.clearGhost() // clear hover ghost immediately to avoid it being detected as a boundary

            const clickPos = this.editor.lastClick || this.editor.coordinates
            if (!clickPos) return

            const extension = this.calculateExtension(el, clickPos)

            if (!extension) {
                this.editor.signals.terminalLogged.dispatch({ msg: 'No intersecting boundaries found in that direction.' })
                return
            }

            // Apply change using appropriate command
            let editCommand
            if (extension.type === 'arc') {
                editCommand = new ExtendArcCommand(
                    this.editor,
                    el,
                    extension.extendStart,
                    extension.newPosition
                )
            } else {
                editCommand = new EditVertexCommand(
                    this.editor,
                    el,
                    extension.vertexIndex,
                    extension.oldPosition.x,
                    extension.oldPosition.y,
                    extension.newPosition.x,
                    extension.newPosition.y
                )
            }

            this.editor.execute(editCommand)
            el.removeClass('elementHover')

            // Reset hover state after extend
            this.editor.signals.requestHoverCheck.dispatch()

            // If this was from rectangle selection (multi-select), ensure state is fully reset
            if (source === 'selectHovered-multi') {
                // Force a brief delay to allow the UI to update before next interaction
                setTimeout(() => {
                    this.editor.signals.requestHoverCheck.dispatch()
                }, 50)
            }

            this.lastExtendedNode = el.node
            this.lastExtendedTime = Date.now()

            // Do NOT call this.cleanup(). Let the user keep extending other lines.
        } catch (error) {
            console.error("ExtendCommand error:", error)
        }
    }

    cleanup() {
        this.clearGhost()
        document.removeEventListener('keydown', this.boundOnKeyDown)
        document.removeEventListener('mousemove', this.boundOnMouseMove)
        this.editor.signals.toogledSelect.remove(this.boundOnElementSelected)
        this.editor.signals.toogledSelect.remove(this.boundOnLineClicked)
        this.editor.signals.commandCancelled.remove(this.cleanup, this)
        this.editor.isInteracting = false
        this.editor.selectSingleElement = false
        this.isExtending = false

        // Remove mouse listeners for ghosting
        const elements = getDrawableElements(this.editor)
        elements.forEach(el => {
            if (el.type === 'line' || (el.type === 'path' && el.data('arcData'))) {
                el.node.removeEventListener('mouseover', this.boundOnMouseOver)
                el.node.removeEventListener('mouseout', this.boundOnMouseOut)
            }
        })

        // Clear visual selection state of boundary elements
        this.boundaryElements.forEach(el => el.removeClass('elementSelected'))
        this.boundaryElements = []
    }
}

function extendCommand(editor) {
    const extendCmd = new ExtendCommand(editor)
    extendCmd.execute()
}

export { extendCommand }
