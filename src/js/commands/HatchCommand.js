import { Command } from '../Command'
import { findEnclosingBoundary, boundaryToPathD, extractSegments, findIslands } from '../utils/boundaryDetection'
import { applyCollectionStyleToElement } from '../Collection'
import { ensurePattern, HATCH_PATTERNS } from '../utils/hatchPatterns'

class HatchCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'HatchCommand'
        this.name = 'Hatch'
        this.hatchElement = null
        this.interactiveExecutionDone = false
        this.patternType = editor.lastHatchPattern || 'SOLID'
        this.hatchScale = editor.lastHatchScale || 10
    }

    execute() {
        if (this.interactiveExecutionDone) {
            return
        }

        const patternLabel = HATCH_PATTERNS[this.patternType]?.label || this.patternType
        this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'HATCH ' })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `[${patternLabel} / scale ${this.hatchScale}] Click inside a closed region to hatch.`,
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
            this.editor.signals.pointCaptured.addOnce(this.onPointClicked, this)
            return
        }

        let pathD = boundaryToPathD(boundaryEdges, segments)
        if (!pathD) {
            this.editor.signals.terminalLogged.dispatch({ msg: 'Failed to create hatch path.' })
            this.cleanup()
            return
        }

        // Detect islands (closed shapes inside the boundary) and append as holes
        const islandPaths = findIslands(this.editor, boundaryEdges, segments, point)
        for (const ip of islandPaths) {
            pathD += ' ' + ip
        }

        // Derive fill color from active collection stroke
        const collection = this.editor.activeCollection
        let fillColor = '#888888'
        if (collection) {
            const collectionData = this.editor.collections
                ? this.editor.collections.get(collection.attr('id'))
                : null
            if (collectionData && collectionData.style && collectionData.style.stroke) {
                fillColor = collectionData.style.stroke
            } else {
                const stroke = collection.attr('stroke')
                if (stroke && stroke !== 'none') fillColor = stroke
            }
        }

        // Resolve fill — SVG pattern or solid
        let fillValue
        if (this.patternType === 'SOLID') {
            fillValue = { color: fillColor, opacity: 1.0 }
        } else {
            const patternId = ensurePattern(this.editor.svg, this.patternType, fillColor, this.hatchScale)
            if (patternId) {
                fillValue = `url(#${patternId})`
            } else {
                fillValue = { color: fillColor, opacity: 1.0 }
            }
        }

        // Create hatch path element
        const parent = this.editor.activeCollection || this.editor.drawing
        const hatchPath = parent.path(pathD)
        hatchPath.fill(fillValue)
        hatchPath.attr('fill-rule', 'evenodd')
        hatchPath.stroke({ width: 0, opacity: 0 })
        hatchPath.addClass('hatch-fill')
        hatchPath.attr('id', this.editor.elementIndex++)
        hatchPath.attr('name', 'Hatch')
        hatchPath.data('hatchData', {
            clickPoint: { x: point.x, y: point.y },
            fillColor,
            patternType: this.patternType,
            hatchScale: this.hatchScale,
            opacity: 1.0,
        })

        hatchPath.back()

        this.hatchElement = hatchPath
        this.editor.spatialIndex.markDirty()

        this.editor.signals.terminalLogged.dispatch({
            msg: `Hatch created with ${boundaryEdges.length} boundary edges.`,
        })

        this.cleanup()
        this.interactiveExecutionDone = true
        // Persist last-used settings on editor for next invocation
        this.editor.lastHatchPattern = this.patternType
        this.editor.lastHatchScale = this.hatchScale
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
            // Re-ensure pattern in case defs were cleared
            const hd = this.hatchElement.data('hatchData')
            if (hd && hd.patternType && hd.patternType !== 'SOLID') {
                ensurePattern(this.editor.svg, hd.patternType, hd.fillColor, hd.hatchScale)
            }
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
