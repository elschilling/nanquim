import { Command } from '../Command'
import { catmullRomToBezierPath } from './DrawSplineCommand'

class ExtendSplineCommand extends Command {
    constructor(editor, element, extendStart, newPosition) {
        super(editor)
        this.type = 'ExtendSplineCommand'
        this.name = 'Extend Spline'
        this.element = element
        this.extendStart = extendStart
        this.newPosition = { x: newPosition.x, y: newPosition.y }

        const splineData = element.data('splineData')
        this.oldPoints = splineData.points.map(p => ({ x: p.x, y: p.y }))

        this.newPoints = [...this.oldPoints]
        if (extendStart) {
            this.newPoints[0] = this.newPosition
        } else {
            this.newPoints[this.newPoints.length - 1] = this.newPosition
        }
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
    }
}

export { ExtendSplineCommand }
