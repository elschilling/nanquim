import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import { applyCollectionStyleToElement, setElementOverrides } from '../Collection'

class LinearDimensionCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'LinearDimensionCommand'
        this.name = 'Linear Dimension'
        this.ghostGroup = null
        this.p1 = null
        this.p2 = null
        this.p3 = null
        this.boundOnMouseMove = null
        this.boundOnCancelled = null
    }

    execute() {
        this.editor.signals.terminalLogged.dispatch({
            type: 'strong',
            msg: 'DIMLINEAR ',
            clearSelection: true,
        })
        this.editor.isInteracting = true
        this.editor.selectSingleElement = true

        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: 'Specify first extension line origin: ',
        })

        this.boundOnFirstPoint = (p) => this.onFirstPoint(p)
        this.editor.signals.pointCaptured.addOnce(this.boundOnFirstPoint)

        this.boundOnFirstCoordinateInput = () => {
            this.editor.signals.pointCaptured.remove(this.boundOnFirstPoint)
            this.onFirstPoint(this.editor.inputCoord)
        }
        this.editor.signals.coordinateInput.addOnce(this.boundOnFirstCoordinateInput)

        this.boundOnCancelled = () => this.cleanup()
        this.editor.signals.commandCancelled.addOnce(this.boundOnCancelled)
    }

    onFirstPoint(point) {
        if (this.boundOnFirstCoordinateInput) {
            this.editor.signals.coordinateInput.remove(this.boundOnFirstCoordinateInput)
        }

        this.p1 = point
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `First point: ${point.x.toFixed(2)}, ${point.y.toFixed(2)}`,
        })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: 'Specify second extension line origin: ',
        })

        this.ghostGroup = this.editor.overlays.group().addClass('measure-ghost-group')
        this.ghostLine = this.ghostGroup
            .line(point.x, point.y, point.x, point.y)
            .addClass('measure-ghost')
            
        // Initial ghost line styling
        const activeStyleId = this.editor.dimensionManager.activeStyleId
        const activeStyle = this.editor.dimensionManager.getStyle(activeStyleId)
        this.ghostLine.stroke({ 
            color: activeStyle.lineColor && activeStyle.lineColor !== 'inherit' ? activeStyle.lineColor : 'white', 
            width: 1 / this.editor.svg.zoom() 
        })
        this.ghostLine.css('opacity', 0.5)

        this.boundOnMouseMove1 = (e) => {
            const coords = this.editor.snapPoint || this.editor.svg.point(e.pageX, e.pageY)
            if (this.ghostLine) {
                this.ghostLine.plot(this.p1.x, this.p1.y, coords.x, coords.y)
            }
        }
        this.editor.svg.on('mousemove', this.boundOnMouseMove1)

        this.boundOnSecondPoint = (p) => this.onSecondPoint(p)
        this.editor.signals.pointCaptured.addOnce(this.boundOnSecondPoint)

        this.boundOnSecondCoordinateInput = () => {
            this.editor.signals.pointCaptured.remove(this.boundOnSecondPoint)
            this.onSecondPoint(this.editor.inputCoord)
        }
        this.editor.signals.coordinateInput.addOnce(this.boundOnSecondCoordinateInput)
    }

    onSecondPoint(point) {
        if (this.boundOnSecondCoordinateInput) {
            this.editor.signals.coordinateInput.remove(this.boundOnSecondCoordinateInput)
        }
        if (this.boundOnMouseMove1) {
            this.editor.svg.off('mousemove', this.boundOnMouseMove1)
            this.boundOnMouseMove1 = null
        }
        this.p2 = point
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `Second point: ${point.x.toFixed(2)}, ${point.y.toFixed(2)}`,
        })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: 'Specify dimension line location: ',
        })

        // Move ghost line into full measuring preview
        if (this.ghostLine) {
            this.ghostLine.remove()
            this.ghostLine = null
        }

        // Draw temporary dimension group in overlays
        this.boundOnMouseMove2 = (e) => {
            const coords = this.editor.snapPoint || this.editor.svg.point(e.pageX, e.pageY)
            this.ghostGroup.clear()
            
            this.ghostGroup.addClass('measure-ghost-group')

            // Generate temporary dimension vectors
            LinearDimensionCommand.renderDimensionGraphics(
                this.ghostGroup,
                this.p1, this.p2, coords, 
                this.editor.dimensionManager.getActiveStyle(),
                this.editor.svg.zoom(),
                true // isGhost
            )
        }
        this.editor.svg.on('mousemove', this.boundOnMouseMove2)

        this.boundOnThirdPoint = (p) => this.onThirdPoint(p)
        this.editor.signals.pointCaptured.addOnce(this.boundOnThirdPoint)

        this.boundOnThirdCoordinateInput = () => {
            this.editor.signals.pointCaptured.remove(this.boundOnThirdPoint)
            this.onThirdPoint(this.editor.inputCoord)
        }
        this.editor.signals.coordinateInput.addOnce(this.boundOnThirdCoordinateInput)
    }

    onThirdPoint(point) {
        if (this.boundOnThirdCoordinateInput) {
            this.editor.signals.coordinateInput.remove(this.boundOnThirdCoordinateInput)
        }
        if (this.boundOnMouseMove2) {
            this.editor.svg.off('mousemove', this.boundOnMouseMove2)
            this.boundOnMouseMove2 = null
        }
        if (this.ghostGroup) {
            this.ghostGroup.remove()
            this.ghostGroup = null
        }

        this.p3 = point
        
        // Finalize drawing
        const activeStyleId = this.editor.dimensionManager.activeStyleId
        const activeStyle = this.editor.dimensionManager.getStyle(activeStyleId)
        
        const dimGroup = this.editor.activeCollection.group()
        
        // Store parametric data
        const paramData = {
            p1: this.p1,
            p2: this.p2,
            p3: this.p3,
            styleId: activeStyleId
        }
        dimGroup.attr('data-element-type', 'dimension')
        dimGroup.attr('data-dim-data', JSON.stringify(paramData))
        
        // ID & Name
        dimGroup.attr('id', this.editor.elementIndex++)
        dimGroup.attr('name', 'Dimension')
        
        // Setup internal styling override barrier - dimension parts shouldn't randomly inherit
        // things outside the style rules (unless specified 'inherit').
        // By default, group children look up to collection.
        // We handle exact line weights and fonts in renderDimensionGraphics.

        LinearDimensionCommand.renderDimensionGraphics(
            dimGroup, 
            this.p1, this.p2, this.p3, 
            activeStyle, 
            1, // actual geometry uses scale 1
            false
        )

        applyCollectionStyleToElement(this.editor, dimGroup)

        this.editor.history.undos.push(new AddElementCommand(this.editor, dimGroup))
        this.editor.lastCommand = this
        this.updatedOutliner()

        this.editor.signals.terminalLogged.dispatch({ msg: `Dimension created.` })

        this.cleanup()
    }

    cleanup() {
        if (this.boundOnMouseMove1) this.editor.svg.off('mousemove', this.boundOnMouseMove1)
        if (this.boundOnMouseMove2) this.editor.svg.off('mousemove', this.boundOnMouseMove2)
        if (this.ghostGroup) this.ghostGroup.remove()

        this.editor.signals.pointCaptured.remove(this.boundOnFirstPoint)
        this.editor.signals.pointCaptured.remove(this.boundOnSecondPoint)
        this.editor.signals.pointCaptured.remove(this.boundOnThirdPoint)
        
        if (this.boundOnFirstCoordinateInput) this.editor.signals.coordinateInput.remove(this.boundOnFirstCoordinateInput)
        if (this.boundOnSecondCoordinateInput) this.editor.signals.coordinateInput.remove(this.boundOnSecondCoordinateInput)
        if (this.boundOnThirdCoordinateInput) this.editor.signals.coordinateInput.remove(this.boundOnThirdCoordinateInput)
        
        if (this.boundOnCancelled) this.editor.signals.commandCancelled.remove(this.boundOnCancelled)

        this.editor.isInteracting = false
        setTimeout(() => {
            this.editor.selectSingleElement = false
        }, 10)
    }

    static renderDimensionGraphics(group, p1, p2, p3, style, zoom = 1, isGhost = false) {
        group.clear() // Remove existing graphics

        const props = style.properties
        
        // 1. Calculate orientation and offsets
        let dx = p2.x - p1.x
        let dy = p2.y - p1.y
        const p1p2Dist = Math.sqrt(dx*dx + dy*dy)

        // Prevent zero-length
        if (p1p2Dist < 0.0001) return

        let ndx = dx / p1p2Dist
        let ndy = dy / p1p2Dist

        const offX = Math.abs(p3.x - p1.x)
        const offY = Math.abs(p3.y - p1.y)

        let isHorizontalDir = true 
        if (Math.abs(dy) > Math.abs(dx)) {
            if (Math.abs(p3.x - p1.x) > Math.abs(p3.y - p1.y)) {
                isHorizontalDir = false 
            }
        } else {
            if (Math.abs(p3.y - p1.y) > Math.abs(p3.x - p1.x)) {
                isHorizontalDir = true 
            } else {
                isHorizontalDir = false
            }
        }

        let ex1Start, ex1End, ex2Start, ex2End
        let dimStart, dimEnd
        let textVal = ''

        if (isHorizontalDir) {
            textVal = Math.abs(p2.x - p1.x).toFixed(2)
            dimStart = { x: p1.x, y: p3.y }
            dimEnd = { x: p2.x, y: p3.y }
            const dirY = Math.sign(p3.y - p1.y) || 1
            const dirY2 = Math.sign(p3.y - p2.y) || 1
            ex1Start = { x: p1.x, y: p1.y + props.extensionLineOffset * dirY }
            ex1End = { x: p1.x, y: p3.y + props.extensionLineExtend * dirY }
            ex2Start = { x: p2.x, y: p2.y + props.extensionLineOffset * dirY2 }
            ex2End = { x: p2.x, y: p3.y + props.extensionLineExtend * dirY2 }
        } else {
            textVal = Math.abs(p2.y - p1.y).toFixed(2)
            dimStart = { x: p3.x, y: p1.y }
            dimEnd = { x: p3.x, y: p2.y }
            const dirX = Math.sign(p3.x - p1.x) || 1
            const dirX2 = Math.sign(p3.x - p2.x) || 1
            ex1Start = { x: p1.x + props.extensionLineOffset * dirX, y: p1.y }
            ex1End = { x: p3.x + props.extensionLineExtend * dirX, y: p1.y }
            ex2Start = { x: p2.x + props.extensionLineOffset * dirX2, y: p2.y }
            ex2End = { x: p3.x + props.extensionLineExtend * dirX2, y: p2.y }
        }

        // 2. Styling
        const lColor = props.lineColor !== 'inherit' && props.lineColor ? props.lineColor : '#ffffff'
        const tColor = props.textColor !== 'inherit' && props.textColor ? props.textColor : '#ffffff'
        // If zoom is 1 (creation), use a standard weight like 0.1 instead of 1.0 which is too huge for meters
        const lWidth = props.lineWidth === 'inherit' ? (isGhost ? 1/zoom : 0.1) : props.lineWidth

        const lStyle = { stroke: lColor, fill: 'none', 'stroke-width': lWidth }
        if (isGhost) lStyle.opacity = 0.5

        const setup = (el) => {
            el.css(lStyle)
            // CRITICAL: Protect against Collection.js style stripping
            setElementOverrides(el, { stroke: true, fill: true, 'stroke-width': true })
            return el
        }

        // 3. Draw Lines
        setup(group.line(ex1Start.x, ex1Start.y, ex1End.x, ex1End.y).addClass('dim-ext-line'))
        setup(group.line(ex2Start.x, ex2Start.y, ex2End.x, ex2End.y).addClass('dim-ext-line'))
        setup(group.line(dimStart.x, dimStart.y, dimEnd.x, dimEnd.y).addClass('dim-main-line'))

        // Draw arrowheads / ticks
        if (props.tickSize > 0) {
            const tick = props.tickSize
            setup(group.line(dimStart.x - tick, dimStart.y + tick, dimStart.x + tick, dimStart.y - tick).addClass('dim-tick'))
            setup(group.line(dimEnd.x - tick, dimEnd.y + tick, dimEnd.x + tick, dimEnd.y - tick).addClass('dim-tick'))
        } else if (props.arrowSize > 0) {
            const buildArrow = (pt, isStart) => {
                const factor = isStart ? 1 : -1
                let p1x, p1y, p2x, p2y, p3x, p3y
                if (isHorizontalDir) {
                    p1x = pt.x; p1y = pt.y
                    p2x = pt.x + (props.arrowSize * factor); p2y = pt.y + (props.arrowSize * 0.3)
                    p3x = pt.x + (props.arrowSize * factor); p3y = pt.y - (props.arrowSize * 0.3)
                } else {
                    p1x = pt.x; p1y = pt.y
                    p2x = pt.x + (props.arrowSize * 0.3); p2y = pt.y + (props.arrowSize * factor)
                    p3x = pt.x - (props.arrowSize * 0.3); p3y = pt.y + (props.arrowSize * factor)
                }
                const pathStr = `M ${p1x} ${p1y} L ${p2x} ${p2y} L ${p3x} ${p3y} Z`
                const ap = group.path(pathStr).addClass('dim-arrow')
                setup(ap)
                ap.attr('fill', lColor).css('fill', lColor)
            }
            const signX = Math.sign(dimEnd.x - dimStart.x) || 1
            const signY = Math.sign(dimEnd.y - dimStart.y) || 1
            buildArrow(dimStart, signX > 0 && signY > 0)
            buildArrow(dimEnd, !(signX > 0 && signY > 0))
        }

        // 4. Text
        let textBaseX = (dimStart.x + dimEnd.x) / 2
        let textBaseY = (dimStart.y + dimEnd.y) / 2
        
        const displayTextOffset = props.textOffset
        if (isHorizontalDir) {
            const dirY = Math.sign(dimStart.y - Math.min(p1.y, p2.y)) || -1
            textBaseY += displayTextOffset * dirY
        } else {
            const dirX = Math.sign(dimStart.x - Math.min(p1.x, p2.x)) || -1
            textBaseX += displayTextOffset * dirX
        }
        
        let txtX = textBaseX
        let txtY = textBaseY
        
        // Protect against NaN if textPosition has undefined components
        if (style.textPosition) {
            txtX += (style.textPosition.x || 0)
            txtY += (style.textPosition.y || 0)
        }

        const t = group.text(textVal).addClass('dim-text')
        t.center(txtX, txtY)
        
        group.attr('data-dim-text-center', JSON.stringify({ x: txtX, y: txtY }))
        group.attr('data-dim-text-base', JSON.stringify({ x: textBaseX, y: textBaseY }))
        
        t.font({
            family: props.fontFamily || 'Inter',
            size: props.fontSize || 0.15,
            anchor: 'middle'
        })
        
        const tStyle = { 'pointer-events': 'none', 'fill': tColor }
        if (isGhost) tStyle['opacity'] = 0.5
        
        t.css(tStyle)
        t.attr('fill', tColor).attr('stroke', 'none')
        t.attr('dy', '0.35em')
        
        setElementOverrides(t, { fill: true, stroke: true })
    }

    static registerRedrawListener(editor) {
        editor.signals.refreshDimensions.add(({ element, data }) => {
            const style = editor.dimensionManager.getStyle(data.styleId)
            const oldId = element.attr('id')
            const oldName = element.attr('name')
            const oldCollection = element.attr('data-collection')
            
            // Re-apply instance-specific textPosition if it exists
            const mergedStyle = JSON.parse(JSON.stringify(style))
            if (data.textPosition) {
                mergedStyle.textPosition = data.textPosition
            }

            // clear inline styles so they don't block new style redraw overrides if user had toggled them
            // Actually it's simpler: renderDimensionGraphics just clears the group and redraws everything inside it
            LinearDimensionCommand.renderDimensionGraphics(
                element,
                data.p1, data.p2, data.p3,
                mergedStyle,
                1,
                false
            )
            
            // Reapply collection styling for any "inherit" properties
            applyCollectionStyleToElement(editor, element)
        })
    }
}

function linearDimensionCommand(editor) {
    const cmd = new LinearDimensionCommand(editor)
    cmd.execute()
}

export { LinearDimensionCommand, linearDimensionCommand }
