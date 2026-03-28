import { getArcGeometry, isPointInArc } from '../utils/arcUtils'
import { Command } from '../Command'
import { TrimLineCommand } from './TrimLineCommand'
import { TrimRectCommand } from './TrimRectCommand'
import { TrimCircleCommand } from './TrimCircleCommand'
import { TrimArcCommand } from './TrimArcCommand'
import { TrimSplineCommand } from './TrimSplineCommand'
import { TrimPolylineCommand } from './TrimPolylineCommand'
import { TrimEllipseCommand } from './TrimEllipseCommand'
import { getLineEquation, getLineIntersection, getLineCircleIntersections, getLineRectIntersections, getCircleCircleIntersections, getPathIntersections, getPathSegments, getPolylineSegments, getLineEllipseIntersections, getEllipseAngle } from '../utils/intersection'
import { getDrawableElements } from '../Collection'
import { getPreferences } from '../Preferences'
import { catmullRomToBezierPath } from './DrawSplineCommand'

class TrimCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'TrimCommand'
        this.name = 'Trim'
        this.boundaryElements = []
        this.autoTrimMode = false
        this.boundOnKeyDown = this.onKeyDown.bind(this)
        this.boundOnElementSelected = this.onElementSelected.bind(this)
        this.boundOnLineClicked = this.onLineClicked.bind(this)
        this.boundOnMouseMove = this.onMouseMove.bind(this)
        this.cleanup = this.cleanup.bind(this)
        this.isTrimming = false
        this.ghostLine = null
        this.ghostArc = null

        this.boundOnPreferencesChanged = (prefs) => {
            if (this.ghostLine) this.ghostLine.attr('style', `stroke: #F44336 !important; stroke-width: var(--hover-stroke-width, ${prefs.hoverStrokeWidth}) !important; pointer-events: none;`)
            if (this.ghostArc) this.ghostArc.attr('style', `stroke: #F44336 !important; stroke-width: var(--hover-stroke-width, ${prefs.hoverStrokeWidth}) !important; pointer-events: none; fill: none !important;`)
        }
        this.editor.signals.preferencesChanged.add(this.boundOnPreferencesChanged)
    }

    execute() {
        this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
        this.editor.signals.commandCancelled.addOnce(this.cleanup, this)
        document.addEventListener('keydown', this.boundOnKeyDown)

        if (this.editor.selected.length > 0) {
            this.boundaryElements = [...this.editor.selected]
            this.editor.signals.clearSelection.dispatch()
            this.startTrimmingLines()
            this.editor.signals.requestHoverCheck.dispatch()
            return
        }

        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `Select boundary elements and press Enter.Or press Enter immediately for Auto - Trim mode.`,
        })

        this.editor.isInteracting = true
        this.editor.suppressPolarTracking = true
        this.editor.selectSingleElement = true
        this.editor.signals.toogledSelect.add(this.boundOnElementSelected)
    }

    onKeyDown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            if (!this.isTrimming) {
                if (this.boundaryElements.length === 0) {
                    this.autoTrimMode = true
                    this.editor.signals.terminalLogged.dispatch({ msg: 'Auto-Trim mode enabled.' })
                } else {
                    this.editor.signals.terminalLogged.dispatch({ msg: `Selected ${this.boundaryElements.length} boundary elements.` })
                }

                this.editor.signals.terminalLogged.dispatch({ msg: 'Select elements to trim.' })

                this.editor.signals.toogledSelect.remove(this.boundOnElementSelected)
                this.editor.signals.clearSelection.dispatch()

                this.startTrimmingLines()
                this.editor.signals.requestHoverCheck.dispatch()
            }
        } else if (event.key === 'Escape') {
            this.cleanup()
        }
    }

    onElementSelected(el) {
        if (!this.isTrimming) {
            const index = this.boundaryElements.findIndex(b => b.node === el.node)
            if (index > -1) {
                this.boundaryElements.splice(index, 1)
                el.removeClass('elementSelected')
            } else {
                this.boundaryElements.push(el)
            }
        }
    }

    initGhosts() {
        if (!this.ghostLine) {
            const width = getPreferences().hoverStrokeWidth
            this.ghostLine = this.editor.overlays.line(0, 0, 0, 0)
                .stroke({ color: '#F44336', width: width, opacity: 0.8, linecap: 'round' })
                .addClass('ghostLine')
            this.ghostLine.node.style.pointerEvents = 'none'
            this.ghostLine.attr('style', `stroke: #F44336 !important; stroke-width: var(--hover-stroke-width, ${width}) !important; pointer-events: none;`)
            this.ghostLine.hide()
        }
        if (!this.ghostArc) {
            const width = getPreferences().hoverStrokeWidth
            this.ghostArc = this.editor.overlays.path('M 0 0')
                .stroke({ color: '#F44336', width: width, opacity: 0.8, linecap: 'round' }).fill('none')
                .addClass('ghostLine')
            this.ghostArc.node.style.pointerEvents = 'none'
            this.ghostArc.attr('style', `stroke: #F44336 !important; stroke-width: var(--hover-stroke-width, ${width}) !important; pointer-events: none; fill: none !important;`)
            this.ghostArc.hide()
        }
    }

    startTrimmingLines() {
        this.isTrimming = true
        this.editor.isInteracting = true
        this.editor.suppressPolarTracking = true
        this.editor.selectSingleElement = false

        this.initGhosts()

        document.removeEventListener('mousemove', this.boundOnMouseMove)
        document.addEventListener('mousemove', this.boundOnMouseMove)

        this.editor.signals.toogledSelect.remove(this.boundOnLineClicked)
        this.editor.signals.toogledSelect.add(this.boundOnLineClicked)
    }

    getCandidateBoundaries(originalEl) {
        let candidateBoundaries = []
        if (this.autoTrimMode) {
            const allElements = getDrawableElements(this.editor)
            allElements.forEach((child) => {
                if (child.node !== originalEl.node && !child.hasClass('grid') && !child.hasClass('axis') && !child.hasClass('ghostLine')) {
                    candidateBoundaries.push(child)
                }
            })
        } else {
            candidateBoundaries = this.boundaryElements
        }
        return candidateBoundaries
    }

    calculateLineTrim(el, point, originalEl = el) {
        const lineEq = getLineEquation(el)
        const dx = lineEq.x2 - lineEq.x1
        const dy = lineEq.y2 - lineEq.y1
        const lineLen = Math.hypot(dx, dy)
        if (lineLen < 1e-6) return null

        function getT(x, y) {
            if (Math.abs(dx) > Math.abs(dy)) return (x - lineEq.x1) / dx
            return (y - lineEq.y1) / dy
        }

        const intersections = []
        intersections.push({ t: 0, x: lineEq.x1, y: lineEq.y1 })
        intersections.push({ t: 1, x: lineEq.x2, y: lineEq.y2 })

        const candidateBoundaries = this.getCandidateBoundaries(originalEl)

        const checkAndAddIntersection = (intersect) => {
            if (!intersect) return
            const minX = Math.min(lineEq.x1, lineEq.x2) - 1e-4
            const maxX = Math.max(lineEq.x1, lineEq.x2) + 1e-4
            const minY = Math.min(lineEq.y1, lineEq.y2) - 1e-4
            const maxY = Math.max(lineEq.y1, lineEq.y2) + 1e-4

            if (intersect.x >= minX && intersect.x <= maxX && intersect.y >= minY && intersect.y <= maxY) {
                const t = getT(intersect.x, intersect.y)
                if (t > 1e-4 && t < 1 - 1e-4) {
                    intersections.push({ t, x: intersect.x, y: intersect.y })
                }
            }
        }

        for (const boundary of candidateBoundaries) {
            if (boundary.node === originalEl.node) continue

            if (boundary.type === 'line') {
                const intersect = getLineIntersection({ x1: lineEq.x1, y1: lineEq.y1, x2: lineEq.x2, y2: lineEq.y2 }, boundary)
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
                const cx = boundary.cx(), cy = boundary.cy(), r = parseFloat(boundary.radius ? boundary.radius() : (boundary.attr('r') || boundary.attr('rx')))
                getLineCircleIntersections({ x1: lineEq.x1, y1: lineEq.y1, x2: lineEq.x2, y2: lineEq.y2 }, { cx, cy, r }).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'ellipse') {
                const cx = boundary.cx(), cy = boundary.cy()
                const rx = parseFloat(boundary.attr('rx')), ry = parseFloat(boundary.attr('ry'))
                getLineEllipseIntersections({ x1: lineEq.x1, y1: lineEq.y1, x2: lineEq.x2, y2: lineEq.y2 }, { cx, cy, rx, ry }).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'rect') {
                const rectBounds = { x: boundary.x(), y: boundary.y(), width: boundary.width(), height: boundary.height() }
                getLineRectIntersections({ x1: lineEq.x1, y1: lineEq.y1, x2: lineEq.x2, y2: lineEq.y2 }, rectBounds).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'path') {
                getPathIntersections(el, boundary).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'polyline') {
                getPolylineSegments(boundary).forEach(seg => {
                    const intersect = getLineIntersection({ x1: lineEq.x1, y1: lineEq.y1, x2: lineEq.x2, y2: lineEq.y2 }, seg)
                    if (intersect) {
                        const minX = Math.min(seg.x1, seg.x2) - 1e-4
                        const maxX = Math.max(seg.x1, seg.x2) + 1e-4
                        const minY = Math.min(seg.y1, seg.y2) - 1e-4
                        const maxY = Math.max(seg.y1, seg.y2) + 1e-4
                        if (intersect.x >= minX && intersect.x <= maxX && intersect.y >= minY && intersect.y <= maxY) {
                            checkAndAddIntersection(intersect)
                        }
                    }
                })
            }

        }

        intersections.sort((a, b) => a.t - b.t)

        const uniqueIntersects = []
        let lastT = -100
        for (const inter of intersections) {
            if (Math.abs(inter.t - lastT) > 1e-4) {
                uniqueIntersects.push(inter)
                lastT = inter.t
            }
        }

        if (uniqueIntersects.length <= 2) return null

        let t_mouse = getT(point.x, point.y)
        t_mouse = Math.max(0, Math.min(1, t_mouse))

        let t1 = 0, t2 = 1, p1 = uniqueIntersects[0], p2 = uniqueIntersects[uniqueIntersects.length - 1]
        for (let i = 0; i < uniqueIntersects.length - 1; i++) {
            if (t_mouse >= uniqueIntersects[i].t && t_mouse <= uniqueIntersects[i + 1].t) {
                t1 = uniqueIntersects[i].t
                t2 = uniqueIntersects[i + 1].t
                p1 = uniqueIntersects[i]
                p2 = uniqueIntersects[i + 1]
                break
            }
        }

        let action = {}
        if (t1 < 1e-4 && t2 > 1 - 1e-4) {
            action = { type: 'remove' }
        } else if (t1 < 1e-4 && t2 <= 1 - 1e-4) {
            action = { type: 'shorten', keep: 'end', newX: p2.x, newY: p2.y }
        } else if (t1 >= 1e-4 && t2 > 1 - 1e-4) {
            action = { type: 'shorten', keep: 'start', newX: p1.x, newY: p1.y }
        } else {
            action = { type: 'split', splitX1: p1.x, splitY1: p1.y, splitX2: p2.x, splitY2: p2.y }
        }

        return {
            type: 'line',
            action: action,
            preview: { type: 'line', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
        }
    }

    calculateRectTrim(el, point) {
        const x = el.x(), y = el.y(), w = el.width(), h = el.height()
        const lines = [
            { x1: x, y1: y, x2: x + w, y2: y },
            { x1: x + w, y1: y, x2: x + w, y2: y + h },
            { x1: x + w, y1: y + h, x2: x, y2: y + h },
            { x1: x, y1: y + h, x2: x, y2: y }
        ]

        let minDist = Infinity
        let closestLineIndex = -1

        const distToSegment = (p, p1, p2) => {
            const l2 = Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2);
            if (l2 === 0) return Math.hypot(p.x - p1.x, p.y - p1.y);
            let t = ((p.x - p1.x) * (p2.x - p1.x) + (p.y - p1.y) * (p2.y - p1.y)) / l2;
            t = Math.max(0, Math.min(1, t));
            return Math.hypot(p.x - (p1.x + t * (p2.x - p1.x)), p.y - (p1.y + t * (p2.y - p1.y)));
        }

        for (let i = 0; i < lines.length; i++) {
            const d = distToSegment(point, { x: lines[i].x1, y: lines[i].y1 }, { x: lines[i].x2, y: lines[i].y2 })
            if (d < minDist) {
                minDist = d
                closestLineIndex = i
            }
        }

        const virtualLineElement = {
            type: 'line',
            node: el.node,
            attr: (attrName) => {
                if (attrName === 'x1') return lines[closestLineIndex].x1
                if (attrName === 'y1') return lines[closestLineIndex].y1
                if (attrName === 'x2') return lines[closestLineIndex].x2
                if (attrName === 'y2') return lines[closestLineIndex].y2
            }
        }

        const trimData = this.calculateLineTrim(virtualLineElement, point, el)
        if (!trimData) return null

        return {
            type: 'rect',
            action: trimData.action,
            preview: trimData.preview,
            closestLineIndex: closestLineIndex,
            lines: lines
        }
    }

    calculateCircleTrim(el, point) {
        let cx, cy, r, isArc = false, arcGeo = null
        if (el.type === 'circle') {
            cx = el.cx ? el.cx() : parseFloat(el.attr('cx'))
            cy = el.cy ? el.cy() : parseFloat(el.attr('cy'))
            r = el.radius ? el.radius() : parseFloat(el.attr('r'))
        } else if (el.type === 'path' && (el.data('circleTrimData') || el.data('arcData'))) {
            arcGeo = el.data('circleTrimData') || this.getArcGeometry(el.data('arcData'))
            if (!arcGeo) return null
            cx = arcGeo.cx
            cy = arcGeo.cy
            r = arcGeo.r
            isArc = true
        } else {
            return null
        }

        const candidateBoundaries = this.getCandidateBoundaries(el)
        const intersections = []

        const checkPointOnArc = (pt) => {
            if (!isArc) return true
            // In TrimCommand, theta2 is start and theta1 is end
            return isPointInArc(pt, arcGeo.cx, arcGeo.cy, arcGeo.theta2, arcGeo.theta1, arcGeo.ccw)
        }

        const checkAndAddIntersection = (intersect) => {
            if (!intersect) return
            if (!checkPointOnArc(intersect)) return

            let theta = Math.atan2(intersect.y - cy, intersect.x - cx)
            if (theta < 0) theta += 2 * Math.PI
            intersections.push({ theta, x: intersect.x, y: intersect.y })
        }

        // Add endpoints if it's an arc
        if (isArc) {
            intersections.push({ theta: arcGeo.theta2, x: arcGeo.startPt ? arcGeo.startPt.x : (cx + r * Math.cos(arcGeo.theta2)), y: arcGeo.startPt ? arcGeo.startPt.y : (cy + r * Math.sin(arcGeo.theta2)) })
            intersections.push({ theta: arcGeo.theta1, x: arcGeo.endPt ? arcGeo.endPt.x : (cx + r * Math.cos(arcGeo.theta1)), y: arcGeo.endPt ? arcGeo.endPt.y : (cy + r * Math.sin(arcGeo.theta1)) })
        }

        for (const boundary of candidateBoundaries) {
            if (boundary.node === el.node) continue

            if (boundary.type === 'line') {
                const bEq = getLineEquation(boundary)
                getLineCircleIntersections(bEq, { cx, cy, r }).forEach(pt => {
                    const intersectMinX = Math.min(bEq.x1, bEq.x2) - 1e-4;
                    const intersectMaxX = Math.max(bEq.x1, bEq.x2) + 1e-4;
                    const intersectMinY = Math.min(bEq.y1, bEq.y2) - 1e-4;
                    const intersectMaxY = Math.max(bEq.y1, bEq.y2) + 1e-4;
                    if (pt.x >= intersectMinX && pt.x <= intersectMaxX && pt.y >= intersectMinY && pt.y <= intersectMaxY) {
                        checkAndAddIntersection(pt)
                    }
                })
            } else if (boundary.type === 'rect') {
                const rectBounds = { x: boundary.x(), y: boundary.y(), width: boundary.width(), height: boundary.height() }
                const h = rectBounds.height;
                const w = rectBounds.width;
                const rectSegments = [
                    { x1: rectBounds.x, y1: rectBounds.y, x2: rectBounds.x + w, y2: rectBounds.y },
                    { x1: rectBounds.x + w, y1: rectBounds.y, x2: rectBounds.x + w, y2: rectBounds.y + h },
                    { x1: rectBounds.x + w, y1: rectBounds.y + h, x2: rectBounds.x, y2: rectBounds.y + h },
                    { x1: rectBounds.x, y1: rectBounds.y + h, x2: rectBounds.x, y2: rectBounds.y }
                ]
                rectSegments.forEach(seg => {
                    getLineCircleIntersections(seg, { cx, cy, r }).forEach(pt => {
                        const intersectMinX = Math.min(seg.x1, seg.x2) - 1e-4;
                        const intersectMaxX = Math.max(seg.x1, seg.x2) + 1e-4;
                        const intersectMinY = Math.min(seg.y1, seg.y2) - 1e-4;
                        const intersectMaxY = Math.max(seg.y1, seg.y2) + 1e-4;
                        if (pt.x >= intersectMinX && pt.x <= intersectMaxX && pt.y >= intersectMinY && pt.y <= intersectMaxY) {
                            checkAndAddIntersection(pt)
                        }
                    })
                })
            } else if (boundary.type === 'path' && (boundary.data('circleTrimData') || boundary.data('arcData'))) {
                const bArcData = boundary.data('circleTrimData') || this.getArcGeometry(boundary.data('arcData'))
                getCircleCircleIntersections(bArcData, { cx, cy, r }).forEach(pt => {
                    const bStartAngle = bArcData.theta1 !== undefined ? bArcData.theta1 : bArcData.theta2
                    const bEndAngle = bArcData.theta3 !== undefined ? bArcData.theta3 : bArcData.theta1
                    if (isPointInArc(pt, bArcData.cx, bArcData.cy, bStartAngle, bEndAngle, bArcData.ccw)) checkAndAddIntersection(pt)
                })
            } else if (boundary.type === 'path' && boundary.data('splineData')) {
                getPathIntersections(boundary, el).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'polyline') {
                getPolylineSegments(boundary).forEach(seg => {
                    getLineCircleIntersections(seg, { cx, cy, r }).forEach(pt => {
                        const minX = Math.min(seg.x1, seg.x2) - 1e-4
                        const maxX = Math.max(seg.x1, seg.x2) + 1e-4
                        const minY = Math.min(seg.y1, seg.y2) - 1e-4
                        const maxY = Math.max(seg.y1, seg.y2) + 1e-4
                        if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) {
                            checkAndAddIntersection(pt)
                        }
                    })
                })
            } else if (boundary.type === 'circle') {
                const bcx = boundary.cx(), bcy = boundary.cy(), br = parseFloat(boundary.radius ? boundary.radius() : (boundary.attr('r') || boundary.attr('rx')))
                getCircleCircleIntersections({ cx: bcx, cy: bcy, r: br }, { cx, cy, r }).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'ellipse') {
                const ecx = boundary.cx(), ecy = boundary.cy()
                const erx = parseFloat(boundary.attr('rx')), ery = parseFloat(boundary.attr('ry'))
                const segs = 36
                for (let i = 0; i < segs; i++) {
                    const a1 = (i / segs) * 2 * Math.PI
                    const a2 = ((i + 1) / segs) * 2 * Math.PI
                    const seg = {
                        x1: ecx + erx * Math.cos(a1), y1: ecy + ery * Math.sin(a1),
                        x2: ecx + erx * Math.cos(a2), y2: ecy + ery * Math.sin(a2),
                    }
                    getLineCircleIntersections(seg, { cx, cy, r }).forEach(pt => {
                        const minX = Math.min(seg.x1, seg.x2) - 1e-4
                        const maxX = Math.max(seg.x1, seg.x2) + 1e-4
                        const minY = Math.min(seg.y1, seg.y2) - 1e-4
                        const maxY = Math.max(seg.y1, seg.y2) + 1e-4
                        if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) checkAndAddIntersection(pt)
                    })
                }
            }

        }

        const ccw = isArc ? arcGeo.ccw : true
        const startTheta = isArc ? arcGeo.theta2 : 0

        const getDist = (theta) => {
            let d = ccw ? (theta - startTheta) : (startTheta - theta)
            if (d < 0) d += 2 * Math.PI
            return d
        }

        intersections.forEach(inter => inter.dist = getDist(inter.theta))
        intersections.sort((a, b) => a.dist - b.dist)

        const uniqueIntersects = []
        for (const inter of intersections) {
            if (uniqueIntersects.length === 0 || Math.abs(inter.dist - uniqueIntersects[uniqueIntersects.length - 1].dist) > 1e-4) {
                uniqueIntersects.push(inter)
            }
        }

        if (uniqueIntersects.length < 2) return null

        let theta_mouse = Math.atan2(point.y - cy, point.x - cx)
        if (theta_mouse < 0) theta_mouse += 2 * Math.PI
        let dist_mouse = getDist(theta_mouse)

        // Find the segment containing the mouse
        let p1, p2, mouseSegIdx = -1
        for (let i = 0; i < uniqueIntersects.length - 1; i++) {
            if (dist_mouse >= uniqueIntersects[i].dist && dist_mouse <= uniqueIntersects[i + 1].dist) {
                p1 = uniqueIntersects[i]
                p2 = uniqueIntersects[i + 1]
                mouseSegIdx = i
                break
            }
        }

        if (mouseSegIdx === -1 && !isArc) {
            // For circles, could be in the wrap-around segment
            p1 = uniqueIntersects[uniqueIntersects.length - 1]
            p2 = uniqueIntersects[0]
            mouseSegIdx = uniqueIntersects.length - 1
        }

        if (mouseSegIdx === -1) return null

        let arcsToKeep = []
        function isAngleSignificant(tA, tB) {
            let diff = Math.abs(tA - tB);
            if (diff > Math.PI) diff = 2 * Math.PI - diff;
            return diff > 1e-4;
        }

        // Keep all segments except the mouseSegIdx
        for (let i = 0; i < uniqueIntersects.length - 1; i++) {
            if (i === mouseSegIdx) continue
            const s1 = uniqueIntersects[i], s2 = uniqueIntersects[i + 1]
            if (isAngleSignificant(s1.theta, s2.theta)) {
                arcsToKeep.push(this.createArcDataFromAngles(cx, cy, r, s1.theta, s2.theta, ccw))
            }
        }

        if (!isArc && mouseSegIdx !== uniqueIntersects.length - 1) {
            const s1 = uniqueIntersects[uniqueIntersects.length - 1], s2 = uniqueIntersects[0]
            if (isAngleSignificant(s1.theta, s2.theta)) {
                arcsToKeep.push(this.createArcDataFromAngles(cx, cy, r, s1.theta, s2.theta, ccw))
            }
        }

        if (arcsToKeep.length === 0) {
            return { type: 'circle', action: { type: 'remove' } }
        }

        return {
            type: 'circle',
            action: { type: 'arcs', arcs: arcsToKeep },
            preview: { type: 'arc', cx, cy, r, theta2: p1.theta, theta1: p2.theta, startPt: { x: p1.x, y: p1.y }, endPt: { x: p2.x, y: p2.y }, ccw }
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
            theta1: geo.theta3, // End angle
            theta2: geo.theta1, // Start angle
            startPt: p1,
            endPt: p3,
            ccw: geo.ccw
        }
    }

    isPointInArcData(pt, data) {
        const geo = this.getArcGeometry(data)
        if (!geo) return false
        return isPointInArc(pt, geo.cx, geo.cy, geo.theta2, geo.theta1, geo.ccw)
    }

    createArcDataFromAngles(cx, cy, r, startAngle, endAngle, ccw = true) {
        const startPt = { x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) }
        const endPt = { x: cx + r * Math.cos(endAngle), y: cy + r * Math.sin(endAngle) }

        // Find mid point for our p1, p2, p3 format
        let diff = ccw ? (endAngle - startAngle) : (startAngle - endAngle)
        if (diff < 0) diff += 2 * Math.PI
        const midAngle = ccw ? (startAngle + diff / 2) : (startAngle - diff / 2)
        const midPt = { x: cx + r * Math.cos(midAngle), y: cy + r * Math.sin(midAngle) }

        return {
            cx, cy, r,
            theta2: startAngle, theta1: endAngle,
            startPt, endPt, midPt, // Including midPt for easy reconstruction
            ccw // Pass ccw through
        }
    }

    calculateEllipseTrim(el, point) {
        const cx = el.cx ? el.cx() : parseFloat(el.attr('cx'))
        const cy = el.cy ? el.cy() : parseFloat(el.attr('cy'))
        const rx = parseFloat(el.attr('rx'))
        const ry = parseFloat(el.attr('ry'))

        const candidateBoundaries = this.getCandidateBoundaries(el)
        const intersections = []

        const checkAndAddIntersection = (intersect) => {
            if (!intersect) return
            const theta = getEllipseAngle(intersect, { cx, cy, rx, ry })
            intersections.push({ theta, x: intersect.x, y: intersect.y })
        }

        for (const boundary of candidateBoundaries) {
            if (boundary.node === el.node) continue

            if (boundary.type === 'line') {
                const bEq = getLineEquation(boundary)
                getLineEllipseIntersections(bEq, { cx, cy, rx, ry }).forEach(pt => {
                    const intersectMinX = Math.min(bEq.x1, bEq.x2) - 1e-4
                    const intersectMaxX = Math.max(bEq.x1, bEq.x2) + 1e-4
                    const intersectMinY = Math.min(bEq.y1, bEq.y2) - 1e-4
                    const intersectMaxY = Math.max(bEq.y1, bEq.y2) + 1e-4
                    if (pt.x >= intersectMinX && pt.x <= intersectMaxX && pt.y >= intersectMinY && pt.y <= intersectMaxY) {
                        checkAndAddIntersection(pt)
                    }
                })
            } else if (boundary.type === 'rect') {
                const rectBounds = { x: boundary.x(), y: boundary.y(), width: boundary.width(), height: boundary.height() }
                const rectSegments = [
                    { x1: rectBounds.x, y1: rectBounds.y, x2: rectBounds.x + rectBounds.width, y2: rectBounds.y },
                    { x1: rectBounds.x + rectBounds.width, y1: rectBounds.y, x2: rectBounds.x + rectBounds.width, y2: rectBounds.y + rectBounds.height },
                    { x1: rectBounds.x + rectBounds.width, y1: rectBounds.y + rectBounds.height, x2: rectBounds.x, y2: rectBounds.y + rectBounds.height },
                    { x1: rectBounds.x, y1: rectBounds.y + rectBounds.height, x2: rectBounds.x, y2: rectBounds.y }
                ]
                rectSegments.forEach(seg => {
                    getLineEllipseIntersections(seg, { cx, cy, rx, ry }).forEach(pt => {
                        const intersectMinX = Math.min(seg.x1, seg.x2) - 1e-4
                        const intersectMaxX = Math.max(seg.x1, seg.x2) + 1e-4
                        const intersectMinY = Math.min(seg.y1, seg.y2) - 1e-4
                        const intersectMaxY = Math.max(seg.y1, seg.y2) + 1e-4
                        if (pt.x >= intersectMinX && pt.x <= intersectMaxX && pt.y >= intersectMinY && pt.y <= intersectMaxY) {
                            checkAndAddIntersection(pt)
                        }
                    })
                })
            } else if (boundary.type === 'circle') {
                const bcx = boundary.cx(), bcy = boundary.cy(), br = parseFloat(boundary.radius ? boundary.radius() : (boundary.attr('r') || boundary.attr('rx')))
                // Approximate circle-ellipse intersection by sampling ellipse as segments
                const segs = 72
                for (let i = 0; i < segs; i++) {
                    const a1 = (i / segs) * 2 * Math.PI
                    const a2 = ((i + 1) / segs) * 2 * Math.PI
                    const seg = {
                        x1: cx + rx * Math.cos(a1), y1: cy + ry * Math.sin(a1),
                        x2: cx + rx * Math.cos(a2), y2: cy + ry * Math.sin(a2),
                    }
                    getLineCircleIntersections(seg, { cx: bcx, cy: bcy, r: br }).forEach(pt => {
                        const minX = Math.min(seg.x1, seg.x2) - 1e-4
                        const maxX = Math.max(seg.x1, seg.x2) + 1e-4
                        const minY = Math.min(seg.y1, seg.y2) - 1e-4
                        const maxY = Math.max(seg.y1, seg.y2) + 1e-4
                        if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) checkAndAddIntersection(pt)
                    })
                }
            } else if (boundary.type === 'ellipse') {
                // Both ellipses: sample boundary ellipse as line segments and use getLineEllipseIntersections
                const ecx = boundary.cx(), ecy = boundary.cy()
                const erx = parseFloat(boundary.attr('rx')), ery = parseFloat(boundary.attr('ry'))
                const segs = 72
                for (let i = 0; i < segs; i++) {
                    const a1 = (i / segs) * 2 * Math.PI
                    const a2 = ((i + 1) / segs) * 2 * Math.PI
                    const seg = {
                        x1: ecx + erx * Math.cos(a1), y1: ecy + ery * Math.sin(a1),
                        x2: ecx + erx * Math.cos(a2), y2: ecy + ery * Math.sin(a2),
                    }
                    getLineEllipseIntersections(seg, { cx, cy, rx, ry }).forEach(pt => {
                        const minX = Math.min(seg.x1, seg.x2) - 1e-4
                        const maxX = Math.max(seg.x1, seg.x2) + 1e-4
                        const minY = Math.min(seg.y1, seg.y2) - 1e-4
                        const maxY = Math.max(seg.y1, seg.y2) + 1e-4
                        if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) checkAndAddIntersection(pt)
                    })
                }
            } else if (boundary.type === 'path' && boundary.data('splineData')) {
                getPathIntersections(boundary, el).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'polyline') {
                getPolylineSegments(boundary).forEach(seg => {
                    getLineEllipseIntersections(seg, { cx, cy, rx, ry }).forEach(pt => {
                        const minX = Math.min(seg.x1, seg.x2) - 1e-4
                        const maxX = Math.max(seg.x1, seg.x2) + 1e-4
                        const minY = Math.min(seg.y1, seg.y2) - 1e-4
                        const maxY = Math.max(seg.y1, seg.y2) + 1e-4
                        if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) checkAndAddIntersection(pt)
                    })
                })
            }
        }

        const ccw = true
        const startTheta = 0

        const getDist = (theta) => {
            let d = theta - startTheta
            if (d < 0) d += 2 * Math.PI
            return d
        }

        intersections.forEach(inter => inter.dist = getDist(inter.theta))
        intersections.sort((a, b) => a.dist - b.dist)

        const uniqueIntersects = []
        for (const inter of intersections) {
            if (uniqueIntersects.length === 0 || Math.abs(inter.dist - uniqueIntersects[uniqueIntersects.length - 1].dist) > 1e-4) {
                uniqueIntersects.push(inter)
            }
        }

        if (uniqueIntersects.length < 2) return null

        let theta_mouse = getEllipseAngle(point, { cx, cy, rx, ry })
        let dist_mouse = getDist(theta_mouse)

        let p1, p2, mouseSegIdx = -1
        for (let i = 0; i < uniqueIntersects.length - 1; i++) {
            if (dist_mouse >= uniqueIntersects[i].dist && dist_mouse <= uniqueIntersects[i + 1].dist) {
                p1 = uniqueIntersects[i]
                p2 = uniqueIntersects[i + 1]
                mouseSegIdx = i
                break
            }
        }

        if (mouseSegIdx === -1) {
            // Wrap-around segment
            p1 = uniqueIntersects[uniqueIntersects.length - 1]
            p2 = uniqueIntersects[0]
            mouseSegIdx = uniqueIntersects.length - 1
        }

        if (mouseSegIdx === -1) return null

        function isAngleSignificant(tA, tB) {
            let diff = Math.abs(tA - tB)
            if (diff > Math.PI) diff = 2 * Math.PI - diff
            return diff > 1e-4
        }

        const arcsToKeep = []

        for (let i = 0; i < uniqueIntersects.length - 1; i++) {
            if (i === mouseSegIdx) continue
            const s1 = uniqueIntersects[i], s2 = uniqueIntersects[i + 1]
            if (isAngleSignificant(s1.theta, s2.theta)) {
                arcsToKeep.push({
                    cx, cy, rx, ry,
                    theta1: s1.theta,
                    theta2: s2.theta,
                    startPt: { x: cx + rx * Math.cos(s1.theta), y: cy + ry * Math.sin(s1.theta) },
                    endPt: { x: cx + rx * Math.cos(s2.theta), y: cy + ry * Math.sin(s2.theta) },
                })
            }
        }

        if (mouseSegIdx !== uniqueIntersects.length - 1) {
            const s1 = uniqueIntersects[uniqueIntersects.length - 1], s2 = uniqueIntersects[0]
            if (isAngleSignificant(s1.theta, s2.theta)) {
                arcsToKeep.push({
                    cx, cy, rx, ry,
                    theta1: s1.theta,
                    theta2: s2.theta,
                    startPt: { x: cx + rx * Math.cos(s1.theta), y: cy + ry * Math.sin(s1.theta) },
                    endPt: { x: cx + rx * Math.cos(s2.theta), y: cy + ry * Math.sin(s2.theta) },
                })
            }
        }

        if (arcsToKeep.length === 0) {
            return { type: 'ellipse', action: { type: 'remove' } }
        }

        return {
            type: 'ellipse',
            action: { type: 'arcs', arcs: arcsToKeep },
            preview: {
                type: 'ellipseArc',
                cx, cy, rx, ry,
                theta1: p1.theta,
                theta2: p2.theta,
                startPt: { x: p1.x, y: p1.y },
                endPt: { x: p2.x, y: p2.y },
            }
        }
    }

    calculateSplineTrim(el, point) {
        const splineData = el.data('splineData')
        if (!splineData) return null

        const len = el.length()
        if (len === 0) return null

        const intersections = []
        // Add start and end points
        intersections.push({ t: 0, x: splineData.points[0].x, y: splineData.points[0].y })
        intersections.push({ t: 1, x: splineData.points[splineData.points.length - 1].x, y: splineData.points[splineData.points.length - 1].y })

        const candidateBoundaries = this.getCandidateBoundaries(el)

        for (const boundary of candidateBoundaries) {
            if (boundary.node === el.node) continue

            // Use our new generic path intersection utility
            const pts = getPathIntersections(el, boundary)
            pts.forEach(pt => {
                if (pt.t > 1e-4 && pt.t < 1 - 1e-4) {
                    intersections.push({ t: pt.t, x: pt.x, y: pt.y })
                }
            })
        }

        intersections.sort((a, b) => a.t - b.t)

        const uniqueIntersects = []
        let lastT = -100
        for (const inter of intersections) {
            if (Math.abs(inter.t - lastT) > 1e-3) {
                uniqueIntersects.push(inter)
                lastT = inter.t
            }
        }

        if (uniqueIntersects.length <= 2) return null

        // Find which segment the mouse is in
        // Again, we need t_mouse
        let minDistMouse = Infinity, t_mouse = 0
        const searchSamples = Math.max(100, Math.floor(len / 2))
        for (let i = 0; i <= searchSamples; i++) {
            const d = (i / searchSamples) * len
            const p = el.node.getPointAtLength(d)
            const dist = Math.hypot(p.x - point.x, p.y - point.y)
            if (dist < minDistMouse) {
                minDistMouse = dist
                t_mouse = d / len
            }
        }

        let mouseSegIdx = -1
        for (let i = 0; i < uniqueIntersects.length - 1; i++) {
            if (t_mouse >= uniqueIntersects[i].t && t_mouse <= uniqueIntersects[i + 1].t) {
                mouseSegIdx = i
                break
            }
        }

        if (mouseSegIdx === -1) return null

        const splinesToKeep = []

        const getPointsInInterval = (tStart, tEnd, startPt, endPt) => {
            const pts = [{ x: startPt.x, y: startPt.y }]
            // Add original points that fall within this t-interval
            // We need approximate t for each original point too...
            // Or just use the original points and check their distance along path
            splineData.points.forEach(p => {
                // Approximate t for point p
                let tP = -1
                let minDist = Infinity
                for (let d = 0; d <= len; d += len / 50) {
                    let pathP = el.node.getPointAtLength(d)
                    let dist = Math.hypot(pathP.x - p.x, pathP.y - p.y)
                    if (dist < minDist) {
                        minDist = dist
                        tP = d / len
                    }
                }
                if (tP > tStart + 1e-3 && tP < tEnd - 1e-3) {
                    pts.push({ x: p.x, y: p.y })
                }
            })
            pts.push({ x: endPt.x, y: endPt.y })
            return pts
        }

        for (let i = 0; i < uniqueIntersects.length - 1; i++) {
            if (i === mouseSegIdx) continue
            const pts = getPointsInInterval(uniqueIntersects[i].t, uniqueIntersects[i + 1].t, uniqueIntersects[i], uniqueIntersects[i + 1])
            if (pts.length >= 2) splinesToKeep.push(pts)
        }

        if (splinesToKeep.length === 0) {
            return { type: 'spline', action: { type: 'remove' } }
        }

        // Preview: the segment to be removed
        const previewPts = getPointsInInterval(uniqueIntersects[mouseSegIdx].t, uniqueIntersects[mouseSegIdx + 1].t, uniqueIntersects[mouseSegIdx], uniqueIntersects[mouseSegIdx + 1])

        return {
            type: 'spline',
            action: { type: 'splines', splines: splinesToKeep },
            preview: { type: 'spline', points: previewPts }
        }
    }

    calculatePolylineTrim(el, point) {
        const pts = el.array().map(p => [p[0], p[1]])
        if (pts.length < 2) return null

        const distToSeg = (p, seg) => {
            const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1
            const l2 = dx * dx + dy * dy
            if (l2 === 0) return Math.hypot(p.x - seg.x1, p.y - seg.y1)
            let t = ((p.x - seg.x1) * dx + (p.y - seg.y1) * dy) / l2
            t = Math.max(0, Math.min(1, t))
            return Math.hypot(p.x - (seg.x1 + t * dx), p.y - (seg.y1 + t * dy))
        }

        // Find the closest segment to the click point
        let k = 0, minDist = Infinity
        for (let i = 0; i < pts.length - 1; i++) {
            const seg = { x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1] }
            const d = distToSeg(point, seg)
            if (d < minDist) { minDist = d; k = i }
        }

        const seg = { x1: pts[k][0], y1: pts[k][1], x2: pts[k + 1][0], y2: pts[k + 1][1] }
        const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1
        const segLen = Math.hypot(dx, dy)
        if (segLen < 1e-6) return null

        const getT = (x, y) => Math.abs(dx) > Math.abs(dy) ? (x - seg.x1) / dx : (y - seg.y1) / dy

        const segIntersections = [
            { t: 0, x: seg.x1, y: seg.y1 },
            { t: 1, x: seg.x2, y: seg.y2 },
        ]

        const candidateBoundaries = this.getCandidateBoundaries(el)

        const checkAndAdd = (intersect) => {
            if (!intersect) return
            const minX = Math.min(seg.x1, seg.x2) - 1e-4
            const maxX = Math.max(seg.x1, seg.x2) + 1e-4
            const minY = Math.min(seg.y1, seg.y2) - 1e-4
            const maxY = Math.max(seg.y1, seg.y2) + 1e-4
            if (intersect.x < minX || intersect.x > maxX || intersect.y < minY || intersect.y > maxY) return
            const t = getT(intersect.x, intersect.y)
            if (t > 1e-4 && t < 1 - 1e-4) segIntersections.push({ t, x: intersect.x, y: intersect.y })
        }

        for (const boundary of candidateBoundaries) {
            if (boundary.node === el.node) continue
            if (boundary.type === 'line') {
                const intersect = getLineIntersection(seg, boundary)
                if (intersect) {
                    const bEq = getLineEquation(boundary)
                    const minX = Math.min(bEq.x1, bEq.x2) - 1e-4
                    const maxX = Math.max(bEq.x1, bEq.x2) + 1e-4
                    const minY = Math.min(bEq.y1, bEq.y2) - 1e-4
                    const maxY = Math.max(bEq.y1, bEq.y2) + 1e-4
                    if (intersect.x >= minX && intersect.x <= maxX && intersect.y >= minY && intersect.y <= maxY) checkAndAdd(intersect)
                }
            } else if (boundary.type === 'circle' || boundary.type === 'ellipse') {
                const cx = boundary.cx(), cy = boundary.cy()
                const r = parseFloat(boundary.radius ? boundary.radius() : (boundary.attr('r') || boundary.attr('rx')))
                getLineCircleIntersections(seg, { cx, cy, r }).forEach(checkAndAdd)
            } else if (boundary.type === 'rect') {
                getLineRectIntersections(seg, { x: boundary.x(), y: boundary.y(), width: boundary.width(), height: boundary.height() }).forEach(checkAndAdd)
            } else if (boundary.type === 'path') {
                getPathSegments(boundary).forEach(ps => {
                    const intersect = getLineIntersection(seg, ps)
                    if (intersect) {
                        const minX = Math.min(ps.x1, ps.x2) - 1e-4
                        const maxX = Math.max(ps.x1, ps.x2) + 1e-4
                        const minY = Math.min(ps.y1, ps.y2) - 1e-4
                        const maxY = Math.max(ps.y1, ps.y2) + 1e-4
                        if (intersect.x >= minX && intersect.x <= maxX && intersect.y >= minY && intersect.y <= maxY) checkAndAdd(intersect)
                    }
                })
            } else if (boundary.type === 'polyline') {
                getPolylineSegments(boundary).forEach(ps => {
                    const intersect = getLineIntersection(seg, ps)
                    if (intersect) {
                        const minX = Math.min(ps.x1, ps.x2) - 1e-4
                        const maxX = Math.max(ps.x1, ps.x2) + 1e-4
                        const minY = Math.min(ps.y1, ps.y2) - 1e-4
                        const maxY = Math.max(ps.y1, ps.y2) + 1e-4
                        if (intersect.x >= minX && intersect.x <= maxX && intersect.y >= minY && intersect.y <= maxY) checkAndAdd(intersect)
                    }
                })
            }
        }

        segIntersections.sort((a, b) => a.t - b.t)
        const unique = []
        let lastT = -100
        for (const inter of segIntersections) {
            if (Math.abs(inter.t - lastT) > 1e-4) { unique.push(inter); lastT = inter.t }
        }

        if (unique.length <= 2) return null // no interior intersections on this segment

        // Find which interval contains the click
        const t_mouse = Math.max(0, Math.min(1, getT(point.x, point.y)))
        let i1Idx = 0, i2Idx = 1
        for (let i = 0; i < unique.length - 1; i++) {
            if (t_mouse >= unique[i].t && t_mouse <= unique[i + 1].t) { i1Idx = i; i2Idx = i + 1; break }
        }

        const I1 = unique[i1Idx]
        const I2 = unique[i2Idx]

        // Build result polylines: everything before I1, and everything after I2
        const partA = pts.slice(0, k + 1).map(p => [p[0], p[1]])
        if (I1.t > 1e-4) partA.push([I1.x, I1.y])

        const partB = []
        if (I2.t < 1 - 1e-4) partB.push([I2.x, I2.y])
        pts.slice(k + 1).forEach(p => partB.push([p[0], p[1]]))

        const resultPolylines = []
        if (partA.length >= 2) resultPolylines.push(partA)
        if (partB.length >= 2) resultPolylines.push(partB)

        if (resultPolylines.length === 0) return { type: 'polyline', action: { type: 'remove' }, preview: null }

        return {
            type: 'polyline',
            action: { type: 'polylines', resultPolylines },
            preview: { type: 'line', x1: I1.x, y1: I1.y, x2: I2.x, y2: I2.y },
        }
    }

    calculateTrim(el, point) {
        if (!el || !point) return null
        if (el.type === 'line') return this.calculateLineTrim(el, point)
        if (el.type === 'rect') return this.calculateRectTrim(el, point)
        if (el.type === 'circle' || (el.type === 'path' && (el.data('circleTrimData') || el.data('arcData')))) return this.calculateCircleTrim(el, point)
        if (el.type === 'ellipse') return this.calculateEllipseTrim(el, point)
        if (el.type === 'path' && el.data('splineData')) return this.calculateSplineTrim(el, point)
        if (el.type === 'polyline') return this.calculatePolylineTrim(el, point)
        return null
    }

    onMouseMove(e) {
        if (!this.isTrimming || !this.editor.isInteracting) return

        const hoveredList = this.editor.hoveredElements || []
        let targetEl = null

        for (const item of hoveredList) {
            const el = window.SVG(item.node)
            if (!el || el.type === 'svg' || el.hasClass('ghostLine') || el.hasClass('grid') || el.hasClass('axis')) continue

            let isValidHover = el.type === 'line' || el.type === 'rect' || el.type === 'circle' || el.type === 'ellipse' || el.type === 'polyline'
            if (el.type === 'path' && (el.data('circleTrimData') || el.data('arcData') || el.data('splineData'))) isValidHover = true

            if (isValidHover) {
                targetEl = el
                break
            }
        }

        if (!targetEl) {
            this.clearGhost()
            return
        }

        const pt = this.editor.svg.point(e.clientX, e.clientY)
        const trimData = this.calculateTrim(targetEl, pt)

        if (trimData && trimData.preview) {
            const p = trimData.preview

            if (p.type === 'arc') {
                this.ghostLine.hide()

                const ccw = p.ccw !== undefined ? p.ccw : true
                const sweep = ccw ? 1 : 0
                let diff = ccw ? (p.theta1 - p.theta2) : (p.theta2 - p.theta1)
                if (diff < 0) diff += 2 * Math.PI
                const largeArc = diff > Math.PI ? 1 : 0
                const d = `M ${p.startPt.x} ${p.startPt.y} A ${p.r} ${p.r} 0 ${largeArc} ${sweep} ${p.endPt.x} ${p.endPt.y}`

                this.ghostArc.plot(d).show().front()
                this.ghostArc.attr('style', `stroke: #F44336 !important; stroke-width: var(--hover-stroke-width, 0.4) !important; pointer-events: none; fill: none !important;`)
            } else if (p.type === 'ellipseArc') {
                this.ghostLine.hide()

                // CCW sweep from theta1 to theta2
                let diff = (p.theta2 - p.theta1 + 2 * Math.PI) % (2 * Math.PI)
                const largeArc = diff > Math.PI ? 1 : 0
                const d = `M ${p.startPt.x} ${p.startPt.y} A ${p.rx} ${p.ry} 0 ${largeArc} 1 ${p.endPt.x} ${p.endPt.y}`

                this.ghostArc.plot(d).show().front()
                this.ghostArc.attr('style', `stroke: #F44336 !important; stroke-width: var(--hover-stroke-width, 0.4) !important; pointer-events: none; fill: none !important;`)
            } else if (p.type === 'spline') {
                this.ghostLine.hide()
                const d = catmullRomToBezierPath(p.points)
                this.ghostArc.plot(d).show().front()
                this.ghostArc.attr('style', `stroke: #F44336 !important; stroke-width: var(--hover-stroke-width, 0.4) !important; pointer-events: none; fill: none !important;`)
            } else {
                this.ghostArc.hide()
                this.ghostLine.plot(p.x1, p.y1, p.x2, p.y2).show().front()
                this.ghostLine.attr('style', `stroke: #F44336 !important; stroke-width: var(--hover-stroke-width, 0.4) !important; pointer-events: none;`)
            }
        } else {
            this.clearGhost()
        }
    }

    clearGhost() {
        if (this.ghostLine) this.ghostLine.hide()
        if (this.ghostArc) this.ghostArc.hide()
    }

    onLineClicked(el, source) {
        try {
            if (!el || el.hasClass('ghostLine')) return
            let isValid = el.type === 'line' || el.type === 'rect' || el.type === 'circle' || el.type === 'ellipse' || el.type === 'polyline'
            if (el.type === 'path' && (el.data('circleTrimData') || el.data('arcData') || el.data('splineData'))) isValid = true

            if (!isValid) {
                this.editor.signals.terminalLogged.dispatch({ msg: 'Only lines, rectangles, circles/arcs, ellipses, splines, and polylines can be trimmed.' })
                return
            }

            this.clearGhost()
            el.removeClass('elementHover') // Remove hover BEFORE calculating or cloning styles

            const clickPos = this.editor.lastClick || this.editor.coordinates
            if (!clickPos) return

            const trimData = this.calculateTrim(el, clickPos)
            if (!trimData) return

            let trimCommand
            if (trimData.type === 'line') {
                trimCommand = new TrimLineCommand(this.editor, el, trimData.action)
            } else if (trimData.type === 'rect') {
                trimCommand = new TrimRectCommand(this.editor, el, trimData)
            } else if (trimData.type === 'circle') {
                if (el.data('arcData')) {
                    trimCommand = new TrimArcCommand(this.editor, el, trimData.action)
                } else {
                    trimCommand = new TrimCircleCommand(this.editor, el, trimData.action)
                }
            } else if (trimData.type === 'ellipse') {
                trimCommand = new TrimEllipseCommand(this.editor, el, trimData.action)
            } else if (trimData.type === 'spline') {
                trimCommand = new TrimSplineCommand(this.editor, el, { type: trimData.actionType, splines: trimData.splines })
            } else if (trimData.type === 'polyline') {
                trimCommand = new TrimPolylineCommand(this.editor, el, trimData.action)
            }

            if (trimCommand) this.editor.execute(trimCommand)

            this.editor.signals.requestHoverCheck.dispatch()

            if (source === 'selectHovered-multi') {
                setTimeout(() => {
                    this.editor.signals.requestHoverCheck.dispatch()
                }, 50)
            }

        } catch (error) {
            console.error("TrimCommand error:", error)
        }
    }

    cleanup() {
        document.removeEventListener('keydown', this.boundOnKeyDown)
        document.removeEventListener('mousemove', this.boundOnMouseMove)
        this.editor.signals.toogledSelect.remove(this.boundOnElementSelected)
        this.editor.signals.toogledSelect.remove(this.boundOnLineClicked)
        this.editor.signals.preferencesChanged.remove(this.boundOnPreferencesChanged)

        if (this.ghostLine) this.ghostLine.remove()
        if (this.ghostArc) this.ghostArc.remove()
        this.ghostLine = null
        this.ghostArc = null

        this.boundaryElements = []
        this.isTrimming = false
        this.autoTrimMode = false
        this.editor.isInteracting = false
        this.editor.suppressPolarTracking = false
        setTimeout(() => {
            this.editor.selectSingleElement = false
        }, 10)
        this.editor.signals.updatedOutliner.dispatch()
    }
}

function trimCommand(editor) {
    const cmd = new TrimCommand(editor)
    cmd.execute()
}

export { trimCommand }
