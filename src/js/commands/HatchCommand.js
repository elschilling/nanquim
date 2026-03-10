import { Command } from '../Command'
import { findEnclosingBoundary, boundaryToPathD, extractSegments } from '../utils/boundaryDetection'
import { applyCollectionStyleToElement } from '../Collection'

class HatchCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'HatchCommand'
        this.name = 'Hatch'
        this.hatchElement = null
        this.interactiveExecutionDone = false
    }

    execute() {
        if (this.interactiveExecutionDone) {
            return
        }

        this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'HATCH ' })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: 'Click inside a region to hatch.',
        })

        this.editor.isInteracting = true
        this.editor.suppressHandlers = true
        this.editor.selectSingleElement = true
        this.editor.signals.commandCancelled.addOnce(this.cleanup, this)
        this.editor.signals.pointCaptured.addOnce(this.onPointClicked, this)
    }

    onPointClicked(point) {
        this.clickPoint = point
        this.editor.signals.terminalLogged.dispatch({
            msg: `Detecting boundary at (${point.x.toFixed(2)}, ${point.y.toFixed(2)})...`,
        })

        const segments = extractSegments(this.editor)
        const boundaryEdges = findEnclosingBoundary(this.editor, point)

        if (!boundaryEdges || boundaryEdges.length < 2) {
            this.editor.signals.terminalLogged.dispatch({
                msg: 'No closed boundary found at that point. Try clicking inside a closed region.',
            })
            // Allow the user to try again
            this.editor.signals.pointCaptured.addOnce(this.onPointClicked, this)
            return
        }

        // Build path from boundary edges (supports arc commands)
        const pathD = boundaryToPathD(boundaryEdges, segments)
        if (!pathD) {
            this.editor.signals.terminalLogged.dispatch({ msg: 'Failed to create hatch path.' })
            this.cleanup()
            return
        }

        // Get fill color from active collection style
        const collection = this.editor.activeCollection
        let fillColor = '#888888'
        if (collection) {
            const collectionData = this.editor.collections
                ? this.editor.collections.get(collection.attr('id'))
                : null
            if (collectionData && collectionData.style && collectionData.style.stroke) {
                fillColor = collectionData.style.stroke
            } else {
                // Fallback: read stroke from the collection group
                const stroke = collection.attr('stroke')
                if (stroke && stroke !== 'none') fillColor = stroke
            }
        }

        // Create hatch fill element
        const parent = this.editor.activeCollection || this.editor.drawing
        const hatchPath = parent.path(pathD)
        hatchPath.fill({ color: fillColor, opacity: 0.3 })
        hatchPath.stroke({ width: 0, opacity: 0 })
        hatchPath.addClass('hatch-fill')
        hatchPath.attr('id', this.editor.elementIndex++)
        hatchPath.attr('name', 'Hatch')
        hatchPath.data('hatchData', {
            clickPoint: { x: point.x, y: point.y },
            fillColor,
        })

        // Send it behind other elements in the collection
        hatchPath.back()

        this.hatchElement = hatchPath
        this.editor.spatialIndex.markDirty()

        this.editor.signals.terminalLogged.dispatch({
            msg: `Hatch created with ${boundaryEdges.length} boundary edges.`,
        })

        this.cleanup()
        this.interactiveExecutionDone = true
        this.editor.execute(this)
        this.editor.lastCommand = this
        this.editor.signals.updatedOutliner.dispatch()
    }

    cleanup() {
        this.editor.isInteracting = false
        this.editor.suppressHandlers = false
        setTimeout(() => {
            this.editor.selectSingleElement = false
        }, 10)
        this.editor.signals.pointCaptured.remove(this.onPointClicked, this)
        this.editor.signals.commandCancelled.remove(this.cleanup, this)
    }

    undo() {
        if (this.hatchElement) {
            this.hatchElement.remove()
            this.editor.spatialIndex.markDirty()
            this.editor.signals.updatedOutliner.dispatch()
            this.editor.signals.terminalLogged.dispatch({ msg: 'Undo: Hatch removed.' })
        }
    }

    redo() {
        if (this.hatchElement) {
            const parent = this.editor.activeCollection || this.editor.drawing
            parent.add(this.hatchElement)
            this.hatchElement.back()
            this.editor.spatialIndex.markDirty()
            this.editor.signals.updatedOutliner.dispatch()
            this.editor.signals.terminalLogged.dispatch({ msg: 'Redo: Hatch restored.' })
        }
    }
}

function hatchCommand(editor) {
    const cmd = new HatchCommand(editor)
    cmd.execute()
}

export { hatchCommand }
