import { Command } from '../Command'
import { getElementOverrides, setElementOverrides, applyCollectionStyleToElement } from '../Collection'
import { Matrix } from '@svgdotjs/svg.js'

class MatchPropertiesCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'MatchPropertiesCommand'
        this.name = 'Match Properties'
        this.boundOnKeyDown = this.onKeyDown.bind(this)
        this.boundOnSelection = this.onSelection.bind(this)
        this.boundOnRightClick = this.onRightClick.bind(this)
        this.state = 'waitingForSource' // waitingForSource, waitingForTargets
        this.sourceProperties = null
    }

    execute() {
        this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: 'Select source object (Esc to cancel)',
        })

        // Deselect current selection to start fresh
        this.editor.signals.clearSelection.dispatch()
        this.editor.selected = []

        document.addEventListener('keydown', this.boundOnKeyDown)
        // Add right-click handler
        document.addEventListener('contextmenu', this.boundOnRightClick)

        // When isInteracting is true, Viewport.js logic requires selectSingleElement to be true to trigger toogledSelect
        this.editor.selectSingleElement = true
        // Prevent default selection via Outliner.js
        this.editor.preventSelection = true
        this.editor.signals.toogledSelect.add(this.boundOnSelection)
        this.editor.signals.commandCancelled.addOnce(this.cleanup, this)
        this.editor.isInteracting = true
    }

    onKeyDown(event) {
        if (event.code === 'Escape' || event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter') {
            event.preventDefault()
            event.stopPropagation()
            this.cleanup()
            this.editor.signals.terminalLogged.dispatch({ msg: 'Command finished.' })
        }
    }

    onSelection(element) {
        // With toogledSelect within isInteracting, we get the element directly
        if (this.state === 'waitingForSource') {
            if (element) {
                this.captureSourceProperties(element)
            }
        }
    }

    onTargetSelection() {
        // This is called when updatedSelection fires (standard selection mode)
        if (this.state === 'waitingForTargets') {
            const selected = this.editor.selected
            if (selected.length > 0) {
                this.applyPropertiesToTargets(selected)
            }
        }
    }

    captureSourceProperties(element) {
        const node = element.node
        // Remove hover class to get the actual style, not the hover style
        const hadHover = element.hasClass('elementHover')
        if (hadHover) element.removeClass('elementHover')

        const computedStyle = window.getComputedStyle(node)

        const parseNum = (val, fallback) => {
            const num = parseFloat(val)
            return isNaN(num) ? fallback : num
        }

        const currentFill = element.css('fill') || element.attr('fill') || 'none'
        let visualFill = computedStyle.fill !== 'none' && computedStyle.fill !== '' ? computedStyle.fill : currentFill
        if (visualFill === 'transparent' || visualFill === 'rgba(0, 0, 0, 0)') visualFill = 'none'

        const currentStroke = element.css('stroke') || element.attr('stroke') || 'none'
        let visualStroke = computedStyle.stroke !== 'none' && computedStyle.stroke !== '' ? computedStyle.stroke : currentStroke
        if (visualStroke === 'transparent' || visualStroke === 'rgba(0, 0, 0, 0)') visualStroke = 'none'

        // Capture properties based on computed style for accuracy
        this.sourceProperties = {
            fill: visualFill,
            stroke: visualStroke,
            strokeWidth: parseNum(computedStyle.strokeWidth, parseNum(element.css('stroke-width') || element.attr('stroke-width'), 1)),
            strokeDasharray: computedStyle.strokeDasharray !== 'none' ? computedStyle.strokeDasharray : (element.attr('stroke-dasharray') || 'none'),
            opacity: parseNum(computedStyle.opacity, parseNum(element.attr('opacity'), 1)),
            collectionId: element.parent() && element.parent().attr('data-collection') === 'true' ? element.parent().attr('id') : null,
            fontFamily: element.type === 'text' ? (element.font('family') || element.css('font-family') || computedStyle.fontFamily || 'monospace') : null,
            fontSize: element.type === 'text' ? parseNum(element.font('size'), parseNum(element.css('font-size'), 0.5)) : null,
            rotation: element.transform ? (element.transform().rotate || 0) : 0,
            overrides: { ...getElementOverrides(element) }
        }

        // Restore hover class if needed (though we're about to move away usually)
        if (hadHover) element.addClass('elementHover')

        this.editor.signals.terminalLogged.dispatch({ msg: `Source captured! (Stroke: ${this.sourceProperties.stroke}, Fill: ${this.sourceProperties.fill})` })
        this.editor.signals.terminalLogged.dispatch({ msg: 'Select destination objects (Rectangle selection allowed).' })

        // We don't need to clear selection per se if using toogledSelect logic which doesn't maintain an array when isInteracting=true
        // But let's follow the pattern
        this.editor.selected = [] // Clear any internal selection state if relevant

        // Switch to standard interaction mode to allow rectangle selection
        this.state = 'waitingForTargets'
        this.editor.isInteracting = false
        this.editor.selectSingleElement = false
        this.editor.preventSelection = false // Allow normal selection for targets if desired (or keep blocked if targets shouldn't be highlighted?)
        // Standard behavior is targets ARE selected, so let's allow it.

        // Stop listening to single select, start listening to standard selection update
        this.editor.signals.toogledSelect.remove(this.boundOnSelection)
        this.editor.signals.updatedSelection.add(this.boundOnTargetSelection)
    }

    applyPropertiesToTargets(elements) {
        if (!this.sourceProperties) return

        const props = this.sourceProperties
        let count = 0

        elements.forEach(element => {
            // Apply styles using .css() to ensure override
            if (props.fill) element.css('fill', props.fill)
            if (props.stroke) element.css('stroke', props.stroke)
            if (props.strokeWidth !== undefined) element.css('stroke-width', props.strokeWidth)
            if (props.strokeDasharray) {
                if (props.strokeDasharray === 'none') {
                    element.node.style.removeProperty('stroke-dasharray')
                    element.node.removeAttribute('stroke-dasharray')
                } else {
                    element.css('stroke-dasharray', props.strokeDasharray)
                }
            }
            if (props.opacity !== undefined) element.css('opacity', props.opacity)

            if (element.type === 'text') {
                if (props.fontFamily) element.font({ family: props.fontFamily })
                if (props.fontSize !== null && props.fontSize !== undefined) element.font({ size: props.fontSize })
            }

            // Apply rotation safely, mapping to global bounding center
            if (props.rotation !== undefined && element.transform) {
                const currentRot = element.transform().rotate || 0
                const delta = props.rotation - currentRot
                if (delta !== 0) {
                    const bbox = element.bbox()
                    const transform = element.transform()
                    const matrix = new Matrix(transform)

                    const globalCx = matrix.a * bbox.cx + matrix.c * bbox.cy + matrix.e
                    const globalCy = matrix.b * bbox.cx + matrix.d * bbox.cy + matrix.f

                    element.transform(matrix.rotate(delta, globalCx, globalCy))
                }
            }

            // Move to same collection
            if (props.collectionId && this.editor.collections.has(props.collectionId)) {
                this.editor.collections.get(props.collectionId).group.add(element)
            }

            // Apply same override flags
            setElementOverrides(element, props.overrides)

            // Reapply collection style base
            applyCollectionStyleToElement(this.editor, element)

            count++
        })

        if (count > 0) {
            this.editor.signals.terminalLogged.dispatch({ msg: `Properties applied to ${count} element(s).` })

            // Clear selection immediately so they don't remain selected
            this.editor.signals.clearSelection.dispatch()
            this.editor.signals.updatedOutliner.dispatch()
        }
    }

    onRightClick(event) {
        event.preventDefault()
        event.stopPropagation()
        this.cleanup()
        this.editor.signals.terminalLogged.dispatch({ msg: 'Command finished.' })
    }

    cleanup() {
        document.removeEventListener('keydown', this.boundOnKeyDown)
        document.removeEventListener('contextmenu', this.boundOnRightClick)
        this.editor.signals.toogledSelect.remove(this.boundOnSelection)
        this.editor.signals.commandCancelled.remove(this.cleanup, this)
        // Also remove target selection listener if it was added
        if (this.boundOnTargetSelection) {
            this.editor.signals.updatedSelection.remove(this.boundOnTargetSelection)
        }

        // Swallow the keyup event that follows the keydown to prevent Terminal.js from repeating the command
        const swallowKeyUp = (e) => {
            if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
                e.preventDefault()
                e.stopImmediatePropagation()
            }
        }
        document.addEventListener('keyup', swallowKeyUp, { capture: true, once: true })

        this.editor.isInteracting = false
        this.editor.selectSingleElement = false // Reset this
        this.editor.preventSelection = false // Reset this
        this.editor.signals.clearSelection.dispatch()
        this.editor.selected = []
    }
}

function matchPropertiesCommand(editor) {
    const cmd = new MatchPropertiesCommand(editor)
    // Fix binding
    cmd.boundOnTargetSelection = cmd.onTargetSelection.bind(cmd)
    cmd.execute()
}

export { matchPropertiesCommand }
