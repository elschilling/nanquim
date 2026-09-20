import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import { applyCollectionStyleToElement } from '../Collection'
import { LinearDimensionCommand } from './LinearDimensionCommand'
import { resolveInputCoordinate } from '../utils/coordinateInput'

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
            this.onFirstPoint(resolveInputCoordinate(this.editor))
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

        this.ghostGroup = LinearDimensionCommand.createPreviewGroup(this.editor)
        this.boundOnMouseMove1 = (coords) => {
            const point = this.editor.snapPoint || coords
            if (!point || !this.ghostGroup) return
            const position = this.editor.dimensionManager
                .getActiveStyle?.()?.properties?.position || 'above'
            LinearDimensionCommand.renderSecondPointPreview(
                this.ghostGroup,
                this.p1,
                point,
                'aligned',
                position,
                this.editor.svg.zoom()
            )
        }
        this.editor.signals.updatedCoordinates.add(this.boundOnMouseMove1, this)
        this.boundOnMouseMove1(this.editor.snapPoint || this.editor.coordinates || point)

        this.boundOnSecondPoint = (p) => this.onSecondPoint(p)
        this.editor.signals.pointCaptured.addOnce(this.boundOnSecondPoint)

        this.boundOnSecondCoordinateInput = () => {
            this.editor.signals.pointCaptured.remove(this.boundOnSecondPoint)
            this.onSecondPoint(resolveInputCoordinate(this.editor, this.p1))
        }
        this.editor.signals.coordinateInput.addOnce(this.boundOnSecondCoordinateInput)
    }

    onSecondPoint(point) {
        if (this.boundOnSecondCoordinateInput) {
            this.editor.signals.coordinateInput.remove(this.boundOnSecondCoordinateInput)
        }
        if (this.boundOnMouseMove1) {
            this.editor.signals.updatedCoordinates.remove(this.boundOnMouseMove1, this)
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
        this.ghostGroup.clear()
        this.ghostGroup.removeClass('dimension-second-point-preview')
        this.ghostLine = null
        this.ghostText = null

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
                'aligned',
                this.editor
            )
        }
        this.editor.svg.on('mousemove', this.boundOnMouseMove2)

        this.boundOnThirdPoint = (p) => this.onThirdPoint(p)
        this.editor.signals.pointCaptured.addOnce(this.boundOnThirdPoint)

        this.boundOnThirdCoordinateInput = () => {
            this.editor.signals.pointCaptured.remove(this.boundOnThirdPoint)
            this.onThirdPoint(resolveInputCoordinate(this.editor, this.p2))
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
        dimGroup.attr('name', 'Aligned Dimension')
        
        LinearDimensionCommand.renderDimensionGraphics(
            dimGroup,
            this.p1, this.p2, this.p3,
            activeStyle,
            1,
            false,
            'aligned',
            this.editor
        )

        applyCollectionStyleToElement(this.editor, dimGroup)

        this.editor.execute(new AddElementCommand(this.editor, dimGroup))
        this.updatedOutliner()

        this.editor.signals.terminalLogged.dispatch({ msg: `Aligned dimension created.` })

        this.cleanup()
    }

    cleanup() {
        if (this.boundOnMouseMove1) {
            this.editor.signals.updatedCoordinates.remove(this.boundOnMouseMove1, this)
        }
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
        this.deferSessionTask(() => {
            this.editor.selectSingleElement = false
        }, 10)
    }
}

function alignedDimensionCommand(editor) {
    const cmd = new AlignedDimensionCommand(editor)
    cmd.execute()
}

export { alignedDimensionCommand }
