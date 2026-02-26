import { Command } from '../Command'
import { TrimLineCommand } from './TrimLineCommand'
import { TrimRectCommand } from './TrimRectCommand'
import { TrimCircleCommand } from './TrimCircleCommand'
import { getLineEquation, getLineIntersection, getLineCircleIntersections, getLineRectIntersections, getCircleCircleIntersections } from '../utils/intersection'

function isPointInArc(pt, arcData) {
    const { cx, cy, theta1, theta2 } = arcData
    let angle = Math.atan2(pt.y - cy, pt.x - cx)
    if (angle < 0) angle += 2 * Math.PI
    let sweep = theta1 - theta2
    if (sweep < 0) sweep += 2 * Math.PI
    let aDiff = angle - theta2
    if (aDiff < 0) aDiff += 2 * Math.PI
    return aDiff <= sweep + 1e-4
}

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
            this.ghostLine = this.editor.drawing.line(0, 0, 0, 0)
                .stroke({ color: '#F44336', width: 0.5, opacity: 0.8, linecap: 'round' })
                .addClass('ghostLine')
            this.ghostLine.node.style.pointerEvents = 'none'
            this.ghostLine.hide()
        }
        if (!this.ghostArc) {
            this.ghostArc = this.editor.drawing.path('M 0 0')
                .stroke({ color: '#F44336', width: 0.5, opacity: 0.8, linecap: 'round' }).fill('none')
                .addClass('ghostLine')
            this.ghostArc.node.style.pointerEvents = 'none'
            this.ghostArc.hide()
        }
    }

    startTrimmingLines() {
        this.isTrimming = true
        this.editor.isInteracting = true
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
            this.editor.drawing.children().each((child) => {
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
                const cx = boundary.cx(), cy = boundary.cy(), r = boundary.radius ? boundary.radius() : parseFloat(boundary.attr('r'))
                getLineCircleIntersections({ x1: lineEq.x1, y1: lineEq.y1, x2: lineEq.x2, y2: lineEq.y2 }, { cx, cy, r }).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'rect') {
                const rectBounds = { x: boundary.x(), y: boundary.y(), width: boundary.width(), height: boundary.height() }
                getLineRectIntersections({ x1: lineEq.x1, y1: lineEq.y1, x2: lineEq.x2, y2: lineEq.y2 }, rectBounds).forEach(checkAndAddIntersection)
            } else if (boundary.type === 'path' && boundary.data('circleTrimData')) {
                const arcData = boundary.data('circleTrimData')
                getLineCircleIntersections({ x1: lineEq.x1, y1: lineEq.y1, x2: lineEq.x2, y2: lineEq.y2 }, arcData).forEach(pt => {
                    if (isPointInArc(pt, arcData)) checkAndAddIntersection(pt)
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
        let cx, cy, r
        if (el.type === 'circle') {
            cx = el.cx ? el.cx() : parseFloat(el.attr('cx'))
            cy = el.cy ? el.cy() : parseFloat(el.attr('cy'))
            r = el.radius ? el.radius() : parseFloat(el.attr('r'))
        } else if (el.type === 'path' && el.data('circleTrimData')) {
            const arcData = el.data('circleTrimData')
            cx = arcData.cx
            cy = arcData.cy
            r = arcData.r
        } else {
            return null
        }

        const candidateBoundaries = this.getCandidateBoundaries(el)

        const intersections = []
        const checkAndAddIntersection = (intersect) => {
            if (!intersect) return
            let theta = Math.atan2(intersect.y - cy, intersect.x - cx)
            if (theta < 0) theta += 2 * Math.PI
            intersections.push({ theta, x: intersect.x, y: intersect.y })
        }

        if (el.type === 'path' && el.data('circleTrimData')) {
            const arcData = el.data('circleTrimData')
            intersections.push({ theta: arcData.theta1, x: arcData.endPt.x, y: arcData.endPt.y })
            intersections.push({ theta: arcData.theta2, x: arcData.startPt.x, y: arcData.startPt.y })
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
                const segments = [
                    { x1: rectBounds.x, y1: rectBounds.y, x2: rectBounds.x + rectBounds.width, y2: rectBounds.y },
                    { x1: rectBounds.x + rectBounds.width, y1: rectBounds.y, x2: rectBounds.x + rectBounds.width, y2: rectBounds.y + rectBounds.height },
                    { x1: rectBounds.x + rectBounds.width, y1: rectBounds.y + rectBounds.height, x2: rectBounds.x, y2: rectBounds.y + rectBounds.height },
                    { x1: rectBounds.x, y1: rectBounds.y + rectBounds.height, x2: rectBounds.x, y2: rectBounds.y }
                ]
                segments.forEach(seg => {
                    const intersects = getLineCircleIntersections(seg, { cx, cy, r })
                    intersects.forEach(pt => {
                        const intersectMinX = Math.min(seg.x1, seg.x2) - 1e-4;
                        const intersectMaxX = Math.max(seg.x1, seg.x2) + 1e-4;
                        const intersectMinY = Math.min(seg.y1, seg.y2) - 1e-4;
                        const intersectMaxY = Math.max(seg.y1, seg.y2) + 1e-4;
                        if (pt.x >= intersectMinX && pt.x <= intersectMaxX && pt.y >= intersectMinY && pt.y <= intersectMaxY) {
                            checkAndAddIntersection(pt)
                        }
                    })
                })
            } else if (boundary.type === 'path' && boundary.data('circleTrimData')) {
                const arcData = boundary.data('circleTrimData')
                getCircleCircleIntersections(arcData, { cx, cy, r }).forEach(pt => {
                    checkAndAddIntersection(pt)
                })
            }
        }

        intersections.sort((a, b) => a.theta - b.theta)

        const uniqueIntersects = []
        for (const inter of intersections) {
            if (uniqueIntersects.length === 0) {
                uniqueIntersects.push(inter)
            } else {
                const prev = uniqueIntersects[uniqueIntersects.length - 1]
                let diff = Math.abs(inter.theta - prev.theta)
                if (diff > Math.PI) diff = 2 * Math.PI - diff
                if (diff > 1e-4) {
                    uniqueIntersects.push(inter)
                }
            }
        }
        if (uniqueIntersects.length > 1) {
            const first = uniqueIntersects[0]
            const last = uniqueIntersects[uniqueIntersects.length - 1]
            let diff = Math.abs(first.theta - last.theta)
            if (diff > Math.PI) diff = 2 * Math.PI - diff
            if (diff <= 1e-4) {
                uniqueIntersects.pop()
            }
        }

        if (uniqueIntersects.length < 2) return null

        let theta_mouse = Math.atan2(point.y - cy, point.x - cx)
        if (theta_mouse < 0) theta_mouse += 2 * Math.PI

        let p1, p2
        let found = false
        for (let i = 0; i < uniqueIntersects.length - 1; i++) {
            if (theta_mouse >= uniqueIntersects[i].theta && theta_mouse <= uniqueIntersects[i + 1].theta) {
                p1 = uniqueIntersects[i]
                p2 = uniqueIntersects[i + 1]
                found = true
                break
            }
        }
        if (!found) {
            p1 = uniqueIntersects[uniqueIntersects.length - 1]
            p2 = uniqueIntersects[0]
        }

        if (el.type === 'path' && el.data('circleTrimData')) {
            if (!isPointInArc(point, el.data('circleTrimData'))) return null;
        }

        let arcsToKeep = []
        if (el.type === 'path' && el.data('circleTrimData')) {
            const arcData = el.data('circleTrimData')

            function isAngleSignificant(tA, tB) {
                let diff = tA - tB;
                if (diff < 0) diff += 2 * Math.PI;
                return diff > 1e-4;
            }

            if (isAngleSignificant(p1.theta, arcData.theta2)) {
                arcsToKeep.push({
                    cx, cy, r,
                    theta2: arcData.theta2, theta1: p1.theta,
                    startPt: { x: arcData.startPt.x, y: arcData.startPt.y },
                    endPt: { x: p1.x, y: p1.y }
                })
            }
            if (isAngleSignificant(arcData.theta1, p2.theta)) {
                arcsToKeep.push({
                    cx, cy, r,
                    theta2: p2.theta, theta1: arcData.theta1,
                    startPt: { x: p2.x, y: p2.y },
                    endPt: { x: arcData.endPt.x, y: arcData.endPt.y }
                })
            }
            if (arcsToKeep.length === 0) {
                return { type: 'circle', action: { type: 'remove' } }
            }
        } else {
            arcsToKeep.push({ cx, cy, r, theta2: p2.theta, theta1: p1.theta, startPt: { x: p2.x, y: p2.y }, endPt: { x: p1.x, y: p1.y } })
        }

        return {
            type: 'circle',
            action: { type: 'arcs', arcs: arcsToKeep },
            preview: { type: 'arc', cx, cy, r, theta2: p1.theta, theta1: p2.theta, startPt: { x: p1.x, y: p1.y }, endPt: { x: p2.x, y: p2.y } }
        }
    }

    calculateTrim(el, point) {
        if (!el || !point) return null
        if (el.type === 'line') return this.calculateLineTrim(el, point)
        if (el.type === 'rect') return this.calculateRectTrim(el, point)
        if (el.type === 'circle' || (el.type === 'path' && el.data('circleTrimData'))) return this.calculateCircleTrim(el, point)
        return null
    }

    onMouseMove(e) {
        if (!this.isTrimming || !this.editor.isInteracting) return

        const hoveredList = this.editor.hoveredElements || []
        let targetEl = null

        for (const item of hoveredList) {
            const el = window.SVG(item.node)
            if (!el || el.type === 'svg' || el.hasClass('ghostLine') || el.hasClass('grid') || el.hasClass('axis')) continue

            let isValidHover = el.type === 'line' || el.type === 'rect' || el.type === 'circle'
            if (el.type === 'path' && el.data('circleTrimData')) isValidHover = true

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

                let diff = p.theta1 - p.theta2
                if (diff < 0) diff += 2 * Math.PI
                const largeArc = diff > Math.PI ? 1 : 0
                const d = `M ${p.startPt.x} ${p.startPt.y} A ${p.r} ${p.r} 0 ${largeArc} 1 ${p.endPt.x} ${p.endPt.y} `

                this.ghostArc.plot(d).show().front()
            } else {
                this.ghostArc.hide()
                this.ghostLine.plot(p.x1, p.y1, p.x2, p.y2).show().front()
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
            let isValid = el.type === 'line' || el.type === 'rect' || el.type === 'circle'
            if (el.type === 'path' && el.data('circleTrimData')) isValid = true

            if (!isValid) {
                this.editor.signals.terminalLogged.dispatch({ msg: 'Only lines, rectangles, and circles/arcs can be trimmed.' })
                return
            }

            this.clearGhost()

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
                trimCommand = new TrimCircleCommand(this.editor, el, trimData.action)
            }

            if (trimCommand) this.editor.execute(trimCommand)

            el.removeClass('elementHover')
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

        if (this.ghostLine) this.ghostLine.remove()
        if (this.ghostArc) this.ghostArc.remove()
        this.ghostLine = null
        this.ghostArc = null

        this.boundaryElements = []
        this.isTrimming = false
        this.autoTrimMode = false
        this.editor.isInteracting = false
        this.editor.selectSingleElement = false
        this.editor.signals.updatedOutliner.dispatch()
    }
}

function trimCommand(editor) {
    const cmd = new TrimCommand(editor)
    cmd.execute()
}

export { trimCommand }
