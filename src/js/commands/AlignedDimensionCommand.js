import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import { applyCollectionStyleToElement } from '../Collection'
import { LinearDimensionCommand } from './LinearDimensionCommand'

class AlignedDimensionCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'AlignedDimensionCommand'
        this.name = 'Aligned Dimension'
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
            msg: 'DIMALIGNED ',
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
                true, // isGhost
                'aligned'
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
            styleId: activeStyleId,
            dimType: 'aligned'
        }
        dimGroup.attr('data-element-type', 'dimension')
        dimGroup.attr('data-group', 'true')
        dimGroup.attr('data-dim-data', JSON.stringify(paramData))
        
        // ID & Name
        dimGroup.attr('id', this.editor.elementIndex++)
        dimGroup.attr('name', 'Aligned Dimension')
        
        LinearDimensionCommand.renderDimensionGraphics(
            dimGroup, 
            this.p1, this.p2, this.p3, 
            activeStyle, 
            1,
            false,
            'aligned'
        )

        applyCollectionStyleToElement(this.editor, dimGroup)

        this.editor.history.undos.push(new AddElementCommand(this.editor, dimGroup))
        this.editor.lastCommand = this
        this.updatedOutliner()

        this.editor.signals.terminalLogged.dispatch({ msg: `Aligned dimension created.` })

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
}

function alignedDimensionCommand(editor) {
    const cmd = new AlignedDimensionCommand(editor)
    cmd.execute()
}

export { alignedDimensionCommand }
