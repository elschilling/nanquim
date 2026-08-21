import { Command } from '../Command'
import { catmullRomToBezierPath } from './DrawSplineCommand'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes'

/**
 * Undo/Redo command for editing a spline's control points.
 */
class EditSplineCommand extends Command {
    constructor(editor, element, oldPoints, newPoints) {
        super(editor)
        this.type = 'EditSplineCommand'
        this.element = element
        this.oldPoints = oldPoints.map(p => ({ x: p.x, y: p.y }))
        this.newPoints = newPoints.map(p => ({ x: p.x, y: p.y }))
    }

    execute() {
        this.applyPoints(this.newPoints)
    }

    undo() {
        this.applyPoints(this.oldPoints)
    }

    applyPoints(points) {
        const d = catmullRomToBezierPath(points)
        this.element.plot(d)
        this.element.data('splineData', { points: points.map(p => ({ x: p.x, y: p.y })) })
        invalidateSpatialIndexes(this.editor)
    }
}

export { EditSplineCommand }
