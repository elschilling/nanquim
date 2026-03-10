import { getArcGeometry } from '../utils/arcUtils'
import { Command } from '../Command'

class ExtendArcCommand extends Command {
    constructor(editor, element, extendStart, newPosition) {
        super(editor)
        this.type = 'ExtendArcCommand'
        this.name = 'Edit Arc'
        this.element = element
        this.extendStart = extendStart
        this.newPosition = newPosition

        const arcData = element.data('arcData')
        this.oldP1 = { ...arcData.p1 }
        this.oldP2 = { ...arcData.p2 }
        this.oldP3 = { ...arcData.p3 }

        // Calculate new p2 (midpoint) to maintain curvature
        this.newP1 = extendStart ? { ...newPosition } : { ...arcData.p1 }
        this.newP3 = extendStart ? { ...arcData.p3 } : { ...newPosition }

        this.newP2 = this.calculateNewMidpoint(this.newP1, arcData.p2, this.newP3)
    }

    calculateNewMidpoint(p1, oldP2, p3) {
        // We know the circle center and radius from the old points
        const geo = getArcGeometry(p1, oldP2, this.extendStart ? this.oldP3 : this.oldP1)
        if (!geo) return oldP2

        const { cx, cy, radius: r } = geo
        let theta1 = Math.atan2(p1.y - cy, p1.x - cx)
        let theta3 = Math.atan2(p3.y - cy, p3.x - cx)
        if (theta1 < 0) theta1 += 2 * Math.PI
        if (theta3 < 0) theta3 += 2 * Math.PI

        let diff = theta3 - theta1
        if (diff < 0) diff += 2 * Math.PI

        // We need to check use the same sweep as before.
        // The previous midPoint oldP2 tells us which way the arc goes.
        let thetaOldMid = Math.atan2(oldP2.y - cy, oldP2.x - cx)
        if (thetaOldMid < 0) thetaOldMid += 2 * Math.PI

        let midDiff = thetaOldMid - theta1
        if (midDiff < 0) midDiff += 2 * Math.PI

        // If mid point was "ahead" of theta1 in CCW direction, we continue CCW
        let sweepCCW = midDiff < diff || (diff < 0.001) // simple heuristic
        // Wait, if it's CCW, midAngle is theta1 + diff/2
        // if CW, midAngle is theta1 - (2*PI - diff)/2

        let midAngle
        if (midDiff < diff) {
            midAngle = theta1 + diff / 2
        } else {
            midAngle = theta1 - (2 * Math.PI - diff) / 2
        }

        return {
            x: cx + r * Math.cos(midAngle),
            y: cy + r * Math.sin(midAngle)
        }
    }

    execute() {
        this.updateArc(this.newP1, this.newP2, this.newP3)
    }

    undo() {
        this.updateArc(this.oldP1, this.oldP2, this.oldP3)
    }

    updateArc(p1, p2, p3) {
        const geo = getArcGeometry(p1, p2, p3)
        if (!geo) return

        this.element.plot(`M ${p1.x} ${p1.y} A ${geo.radius} ${geo.radius} 0 ${geo.largeArcFlag} ${geo.sweepFlag} ${p3.x} ${p3.y}`)
        this.element.data('arcData', { p1, p2, p3 })
        this.editor.signals.updatedOutliner.dispatch()
    }
}

export { ExtendArcCommand }
