import { getArcGeometry } from '../utils/arcUtils'
import { Command } from '../Command'
import { EditVertexCommand } from './EditVertexCommand'
import { ExtendArcCommand } from './ExtendArcCommand'
import { ExtendSplineCommand } from './ExtendSplineCommand'
import { getLineEquation, getLineIntersection, getLineCircleIntersections, getLineRectIntersections, getCircleCircleIntersections, getPathIntersections, getPolylineSegments, getLineEllipseIntersections } from '../utils/intersection'
import { EditPolylineCommand } from './EditPolylineCommand'
import { getDrawableElements } from '../Collection'
import { catmullRomToBezierPath } from './DrawSplineCommand'

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
        this.editor.suppressPolarTracking = true
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
        this.editor.suppressPolarTracking = true
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
            if (el.type === 'line' || el.type === 'polyline' || (el.type === 'path' && (el.data('arcData') || el.data('splineData')))) {
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
        if (el.type === 'path' && el.data('splineData')) return this.calculateSplineExtension(el, point)
        if (el.type === 'polyline') return this.calculatePolylineExtension(el, point)
        return null
    }

    calculatePolylineExtension(el, point) {
        const pts = el.array().map(p => [p[0], p[1]])
        if (pts.length < 2) return null

        const first = pts[0], last = pts[pts.length - 1]
        const distToFirst = Math.hypot(point.x - first[0], point.y - first[1])
        const distToLast = Math.hypot(point.x - last[0], point.y - last[1])
        const extendStart = distToFirst < distToLast

        let dx, dy, rayBase
        if (extendStart) {
            dx = first[0] - pts[1][0]; dy = first[1] - pts[1][1]
            rayBase = { x: first[0], y: first[1] }
        } else {
            dx = last[0] - pts[pts.length - 2][0]; dy = last[1] - pts[pts.length - 2][1]
            rayBase = { x: last[0], y: last[1] }
        }

        const segLen = Math.hypot(dx, dy)
        if (segLen < 1e-6) return null
        const dirX = dx / segLen, dirY = dy / segLen
        const MAX_DIST = 100000

        const virtualLine = {
            x1: rayBase.x, y1: rayBase.y,
            x2: rayBase.x + dirX * MAX_DIST, y2: rayBase.y + dirY * MAX_DIST,
        }

        const intersections = []
        const allElements = this.autoExtendMode ? getDrawableElements(this.editor) : null
        const candidateBoundaries = this.autoExtendMode
            ? allElements.filter(c => c.node !== el.node && !c.hasClass('grid') && !c.hasClass('axis') && !c.hasClass('ghostLine'))
            : this.boundaryElements

        const checkAndAddIntersection = (intersect) => {
            if (!intersect) return
            const dot = (intersect.x - rayBase.x) * dirX + (intersect.y - rayBase.y) * dirY
            if (dot > 1e-5) intersections.push({ point: intersect, dist: Math.hypot(intersect.x - rayBase.x, intersect.y - rayBase.y) })
        }

        for (const boundary of candidateBoundaries) {
            if (boundary === el) continue
            if (boundary.type === 'line') {
                const intersect = getLineIntersection(virtualLine, boundary)
                if (intersect) {
                    const bEq = getLineEquation(boundary)
                    if (intersect.x >= Math.min(bEq.x1, bEq.x2) - 1e-3 && intersect.x <= Math.max(bEq.x1, bEq.x2) + 1e-3 &&
                        intersect.y >= Math.min(bEq.y1, bEq.y2) - 1e-3 && intersect.y <= Math.max(bEq.y1, bEq.y2) + 1e-3) {
                        checkAndAddIntersection(intersect)
                    }
                }
            } else if (boundary.type === 'circle') {
                const cx = boundary.cx(), cy = boundary.cy()
                const r = parseFloat(boundary.radius ? boundary.radius() : (boundary.attr('r') || boundary.attr('rx')))
                getLineCircleIntersections(virtualLine, { cx, cy, r }).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'ellipse') {
                const cx = boundary.cx(), cy = boundary.cy()
                const rx = parseFloat(boundary.attr('rx')), ry = parseFloat(boundary.attr('ry'))
                getLineEllipseIntersections(virtualLine, { cx, cy, rx, ry }).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'rect') {
                getLineRectIntersections(virtualLine, { x: boundary.x(), y: boundary.y(), width: boundary.width(), height: boundary.height() }).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'path') {
                getPathIntersections(boundary, virtualLine).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'polyline') {
                getPolylineSegments(boundary).forEach(seg => {
                    const intersect = getLineIntersection(virtualLine, seg)
                    if (intersect) {
                        if (intersect.x >= Math.min(seg.x1, seg.x2) - 1e-3 && intersect.x <= Math.max(seg.x1, seg.x2) + 1e-3 &&
                            intersect.y >= Math.min(seg.y1, seg.y2) - 1e-3 && intersect.y <= Math.max(seg.y1, seg.y2) + 1e-3) {
                            checkAndAddIntersection(intersect)
                        }
                    }
                })
            }
        }

        if (intersections.length === 0) return null
        intersections.sort((a, b) => a.dist - b.dist)

        return {
            type: 'polyline',
            extendStart,
            vertexIndex: extendStart ? 0 : pts.length - 1,
            oldPoints: pts,
            newPosition: intersections[0].point,
        }
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
                    const minX = Math.min(bEq.x1, bEq.x2) - 1e-3
                    const maxX = Math.max(bEq.x1, bEq.x2) + 1e-3
                    const minY = Math.min(bEq.y1, bEq.y2) - 1e-3
                    const maxY = Math.max(bEq.y1, bEq.y2) + 1e-3

                    if (intersect.x >= minX && intersect.x <= maxX && intersect.y >= minY && intersect.y <= maxY) {
                        checkAndAddIntersection(intersect)
                    }
                }
            } else if (boundary.type === 'circle') {
                const cx = boundary.cx(), cy = boundary.cy(), r = parseFloat(boundary.radius ? boundary.radius() : (boundary.attr('r') || boundary.attr('rx')))
                getLineCircleIntersections(virtualLine, { cx, cy, r }).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'ellipse') {
                const cx = boundary.cx(), cy = boundary.cy()
                const rx = parseFloat(boundary.attr('rx')), ry = parseFloat(boundary.attr('ry'))
                getLineEllipseIntersections(virtualLine, { cx, cy, rx, ry }).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'rect') {
                const rectBounds = { x: boundary.x(), y: boundary.y(), width: boundary.width(), height: boundary.height() }
                getLineRectIntersections(virtualLine, rectBounds).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'path') {
                getPathIntersections(boundary, virtualLine).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'polyline') {
                getPolylineSegments(boundary).forEach(seg => {
                    const intersect = getLineIntersection(virtualLine, seg)
                    if (intersect) {
                        const minX = Math.min(seg.x1, seg.x2) - 1e-3
                        const maxX = Math.max(seg.x1, seg.x2) + 1e-3
                        const minY = Math.min(seg.y1, seg.y2) - 1e-3
                        const maxY = Math.max(seg.y1, seg.y2) + 1e-3
                        if (intersect.x >= minX && intersect.x <= maxX && intersect.y >= minY && intersect.y <= maxY) {
                            checkAndAddIntersection(intersect)
                        }
                    }
                })
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
        const geo = getArcGeometry(p1, p2, p3)
        if (!geo) return null

        return {
            cx: geo.cx,
            cy: geo.cy,
            r: geo.radius,
            theta1: geo.theta1,
            theta3: geo.theta3,
            ccw: geo.ccw
        }
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
            } else if (boundary.type === 'path' && boundary.data('splineData')) {
                // Approximate arc-spline intersection via circle-segment intersections
                const segments = getPathSegments(boundary)
                segments.forEach(seg => {
                    getLineCircleIntersections(seg, circle).forEach(checkAndAddIntersection)
                })
            } else if (boundary.type === 'polyline') {
                getPolylineSegments(boundary).forEach(seg => {
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

    calculateSplineExtension(el, point) {
        const splineData = el.data('splineData')
        if (!splineData || splineData.points.length < 2) return null

        const points = splineData.points
        const distToStart = Math.hypot(point.x - points[0].x, point.y - points[0].y)
        const distToEnd = Math.hypot(point.x - points[points.length - 1].x, point.y - points[points.length - 1].y)
        const extendStart = distToStart < distToEnd

        // Ray calculation
        let dx, dy, rayBase
        if (extendStart) {
            dx = points[0].x - points[1].x
            dy = points[0].y - points[1].y
            rayBase = points[0]
        } else {
            dx = points[points.length - 1].x - points[points.length - 2].x
            dy = points[points.length - 1].y - points[points.length - 2].y
            rayBase = points[points.length - 1]
        }

        const lineLen = Math.hypot(dx, dy)
        if (lineLen < 1e-6) return null

        const dirX = dx / lineLen
        const dirY = dy / lineLen
        const MAX_DIST = 100000

        const virtualLine = {
            x1: rayBase.x,
            y1: rayBase.y,
            x2: rayBase.x + dirX * MAX_DIST,
            y2: rayBase.y + dirY * MAX_DIST
        }

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

        for (const boundary of candidateBoundaries) {
            if (boundary.node === el.node) continue

            const checkAndAddIntersection = (intersect) => {
                if (!intersect) return
                const interDx = intersect.x - rayBase.x
                const interDy = intersect.y - rayBase.y
                const dotProduct = interDx * dirX + interDy * dirY

                if (dotProduct > 1e-5) {
                    const dist = Math.hypot(intersect.x - rayBase.x, intersect.y - rayBase.y)
                    intersections.push({ point: intersect, dist })
                }
            }

            if (boundary.type === 'line') {
                const intersect = getLineIntersection(virtualLine, boundary)
                if (intersect) {
                    const bEq = getLineEquation(boundary)
                    const minX = Math.min(bEq.x1, bEq.x2) - 1e-3
                    const maxX = Math.max(bEq.x1, bEq.x2) + 1e-3
                    const minY = Math.min(bEq.y1, bEq.y2) - 1e-3
                    const maxY = Math.max(bEq.y1, bEq.y2) + 1e-3
                    if (intersect.x >= minX && intersect.x <= maxX && intersect.y >= minY && intersect.y <= maxY) {
                        checkAndAddIntersection(intersect)
                    }
                }
            } else if (boundary.type === 'circle') {
                const cx = boundary.cx(), cy = boundary.cy(), r = parseFloat(boundary.radius ? boundary.radius() : (boundary.attr('r') || boundary.attr('rx')))
                getLineCircleIntersections(virtualLine, { cx, cy, r }).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'ellipse') {
                const cx = boundary.cx(), cy = boundary.cy()
                const rx = parseFloat(boundary.attr('rx')), ry = parseFloat(boundary.attr('ry'))
                getLineEllipseIntersections(virtualLine, { cx, cy, rx, ry }).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'rect') {
                const rectBounds = { x: boundary.x(), y: boundary.y(), width: boundary.width(), height: boundary.height() }
                getLineRectIntersections(virtualLine, rectBounds).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'path') {
                getPathIntersections(boundary, virtualLine).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'polyline') {
                getPolylineSegments(boundary).forEach(seg => {
                    const intersect = getLineIntersection(virtualLine, seg)
                    if (intersect) {
                        const minX = Math.min(seg.x1, seg.x2) - 1e-3
                        const maxX = Math.max(seg.x1, seg.x2) + 1e-3
                        const minY = Math.min(seg.y1, seg.y2) - 1e-3
                        const maxY = Math.max(seg.y1, seg.y2) + 1e-3
                        if (intersect.x >= minX && intersect.x <= maxX && intersect.y >= minY && intersect.y <= maxY) {
                            checkAndAddIntersection(intersect)
                        }
                    }
                })
            }

        }

        if (intersections.length === 0) return null
        intersections.sort((a, b) => a.dist - b.dist)

        return {
            type: 'spline',
            extendStart,
            oldPosition: rayBase,
            newPosition: intersections[0].point,
            splineData: splineData
        }
    }

    onMouseOver(e) {
        if (!this.editor.isInteracting) return

        // Find the precise SVG element associated with the event
        const el = SVG(e.target)
        const isExtendable = el && (
            el.type === 'line' || el.type === 'polyline' ||
            (el.type === 'path' && (el.data('arcData') || el.data('splineData')))
        )
        if (!isExtendable) return

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
                    .addClass('ghostLine')
            } else if (extension.type === 'spline') {
                const points = [...extension.splineData.points]
                if (extension.extendStart) points[0] = extension.newPosition
                else points[points.length - 1] = extension.newPosition

                const d = catmullRomToBezierPath(points)
                this.ghostLine = this.editor.overlays.path(d)
                    .stroke({ color: '#2196F3', width: 2, opacity: 0.5 }).fill('none')
                    .addClass('ghostLine')
            } else if (extension.type === 'polyline') {
                // Show only the extension segment (from old endpoint to new position)
                const { extendStart, oldPoints, newPosition } = extension
                const base = extendStart ? oldPoints[0] : oldPoints[oldPoints.length - 1]
                this.ghostLine = this.editor.overlays.line(base[0], base[1], newPosition.x, newPosition.y)
                    .stroke({ color: '#2196F3', width: 2, opacity: 0.5 })
                    .addClass('ghostLine')
            } else {
                // Create ghost line
                const x1 = extension.extendStart ? extension.newPosition.x : extension.lineEq.x1
                const y1 = extension.extendStart ? extension.newPosition.y : extension.lineEq.y1
                const x2 = extension.extendStart ? extension.lineEq.x2 : extension.newPosition.x
                const y2 = extension.extendStart ? extension.lineEq.y2 : extension.newPosition.y

                this.ghostLine = this.editor.overlays.line(x1, y1, x2, y2)
                    .stroke({ color: '#2196F3', width: 2, opacity: 0.5 }) // styling as a preview

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
            const isExtendable = el && (
                el.type === 'line' || el.type === 'polyline' ||
                (el.type === 'path' && (el.data('arcData') || el.data('splineData')))
            )
            if (!isExtendable || el.hasClass('ghostLine')) {
                if (el && !el.hasClass('ghostLine')) {
                    this.editor.signals.terminalLogged.dispatch({ msg: 'Only lines, arcs, splines, and polylines can be extended.' })
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
            } else if (extension.type === 'spline') {
                editCommand = new ExtendSplineCommand(
                    this.editor,
                    el,
                    extension.extendStart,
                    extension.newPosition
                )
            } else if (extension.type === 'polyline') {
                const newPoints = extension.oldPoints.map(p => [p[0], p[1]])
                newPoints[extension.vertexIndex] = [extension.newPosition.x, extension.newPosition.y]
                editCommand = new EditPolylineCommand(this.editor, el, extension.oldPoints, newPoints)
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
        this.editor.suppressPolarTracking = false
        setTimeout(() => {
            this.editor.selectSingleElement = false
        }, 10)
        this.isExtending = false

        // Remove mouse listeners for ghosting
        const elements = getDrawableElements(this.editor)
        elements.forEach(el => {
            if (el.type === 'line' || el.type === 'polyline' || (el.type === 'path' && (el.data('arcData') || el.data('splineData')))) {
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
