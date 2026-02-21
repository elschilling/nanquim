import { Command } from '../Command'
import { EditVertexCommand } from './EditVertexCommand'
import { getLineEquation, getLineIntersection, getLineCircleIntersections, getLineRectIntersections } from '../utils/intersection'

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
        this.ghostLine = null
    }

    execute() {
        this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })

        // Check if elements are already pre-selected
        if (this.editor.selected.length > 0) {
            this.boundaryElements = [...this.editor.selected]
            this.editor.signals.clearSelection.dispatch()
            this.startExtendingLines()
            return
        }

        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `Select boundary elements and press Enter. Or press Enter immediately for Auto-Extend mode.`,
        })

        this.editor.isInteracting = true
        this.editor.selectSingleElement = true
        document.addEventListener('keydown', this.boundOnKeyDown)
        this.editor.signals.toogledSelect.add(this.boundOnElementSelected)
    }

    onKeyDown(event) {
        if (event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter') {
            event.preventDefault()
            this.editor.signals.toogledSelect.remove(this.boundOnElementSelected)

            if (this.boundaryElements.length === 0) {
                this.autoExtendMode = true
                this.editor.signals.terminalLogged.dispatch({ msg: 'Auto-Extend Mode ON: Click lines to extend to nearest intersecting element.' })
            } else {
                this.autoExtendMode = false
                this.editor.signals.terminalLogged.dispatch({ msg: `Extending to ${this.boundaryElements.length} boundaries. Click lines to extend.` })
            }
            this.startExtendingLines()
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
        this.editor.isInteracting = true
        this.editor.selectSingleElement = false
        // In this phase, selecting an element means we want to extend it
        this.editor.signals.toogledSelect.add(this.boundOnLineClicked)

        // Setup hover events for ghosting
        const elements = this.editor.drawing.children()
        elements.forEach(el => {
            if (el.type === 'line') {
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

        if (!el || el.type !== 'line' || !point) return null

        const lineEq = getLineEquation(el)

        // Determine which end of the line was clicked/hovered
        const distToStart = Math.hypot(point.x - lineEq.x1, point.y - lineEq.y1)
        const distToEnd = Math.hypot(point.x - lineEq.x2, point.y - lineEq.y2)
        const extendStart = distToStart < distToEnd

        // Find the intersection points
        const intersections = []

        let candidateBoundaries = []
        if (this.autoExtendMode) {
            // In auto mode, check against all elements EXCEPT the line itself
            this.editor.drawing.children().each((child) => {
                if (child.node !== el.node && !child.hasClass('grid') && !child.hasClass('axis')) {
                    candidateBoundaries.push(child)
                }
            })
        } else {
            candidateBoundaries = this.boundaryElements
        }

        // Ray calculation
        const dx = lineEq.x2 - lineEq.x1
        const dy = lineEq.y2 - lineEq.y1

        // If extending start, direction is from End to Start
        const dirX = extendStart ? -dx : dx
        const dirY = extendStart ? -dy : dy

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

    onMouseOver(e) {
        if (!this.editor.isInteracting) return

        // Find the precise SVG element associated with the event
        const el = SVG(e.target)
        if (!el || el.type !== 'line') return

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

            // Create ghost line
            const x1 = extension.extendStart ? extension.newPosition.x : extension.lineEq.x1
            const y1 = extension.extendStart ? extension.newPosition.y : extension.lineEq.y1
            const x2 = extension.extendStart ? extension.lineEq.x2 : extension.newPosition.x
            const y2 = extension.extendStart ? extension.lineEq.y2 : extension.newPosition.y

            this.ghostLine = this.editor.drawing.line(x1, y1, x2, y2)
                .stroke({ color: '#2196F3', width: 2, opacity: 0.5 }) // styling as a preview
                .addClass('newDrawing')
                .addClass('ghostLine')
        }
    }

    onMouseOut(e) {
        this.clearGhost()
    }

    clearGhost() {
        if (this.ghostLine) {
            this.ghostLine.remove()
            this.ghostLine = null
        }
    }

    onLineClicked(el) {
        if (!el || el.type !== 'line') {
            this.editor.signals.terminalLogged.dispatch({ msg: 'Only lines can be extended.' })
            return
        }

        const clickPos = this.editor.lastClick || this.editor.coordinates
        if (!clickPos) return

        const extension = this.calculateExtension(el, clickPos)
        this.clearGhost() // clear hover ghost on commit

        if (!extension) {
            this.editor.signals.terminalLogged.dispatch({ msg: 'No intersecting boundaries found in that direction.' })
            return
        }

        // Apply change using EditVertexCommand for undo support
        const editCommand = new EditVertexCommand(
            this.editor,
            el,
            extension.vertexIndex,
            extension.oldPosition.x,
            extension.oldPosition.y,
            extension.newPosition.x,
            extension.newPosition.y
        )

        this.editor.execute(editCommand)
        this.editor.signals.clearSelection.dispatch()
        // Do NOT call this.cleanup(). Let the user keep extending other lines.
    }

    cleanup() {
        this.clearGhost()
        document.removeEventListener('keydown', this.boundOnKeyDown)
        this.editor.signals.toogledSelect.remove(this.boundOnElementSelected)
        this.editor.signals.toogledSelect.remove(this.boundOnLineClicked)
        this.editor.isInteracting = false
        this.editor.selectSingleElement = false

        // Remove mouse listeners for ghosting
        const elements = this.editor.drawing.children()
        elements.forEach(el => {
            if (el.type === 'line') {
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
