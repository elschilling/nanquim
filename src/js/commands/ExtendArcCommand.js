import { getArcGeometry } from '../utils/arcUtils'
import { Command } from '../Command'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes'

class ExtendArcCommand extends Command {
    constructor(editor, element, extendStart, newPosition) {
        super(editor)
        this.type = 'ExtendArcCommand'
        this.name = 'Edit Arc'
        this.element = element
        this.extendStart = extendStart
        this.newPosition = newPosition

        const arcData = element.data('arcData')
        this.oldArcData = {
            ...arcData,
            p1: { ...arcData.p1 },
            p2: { ...arcData.p2 },
            p3: { ...arcData.p3 },
        }
        this.oldP2 = { ...arcData.p2 }

        // Keep the original circle and sweep while moving only the selected end.
        this.newP1 = extendStart ? { ...newPosition } : { ...arcData.p1 }
        this.newP3 = extendStart ? { ...arcData.p3 } : { ...newPosition }

        const originalGeometry = getArcGeometry(arcData.p1, arcData.p2, arcData.p3)
        this.newP2 = this.calculateNewMidpoint(this.newP1, this.newP3, originalGeometry)
        this.newArcData = {
            ...this.oldArcData,
            p1: this.newP1,
            p2: this.newP2,
            p3: this.newP3,
        }
        if (originalGeometry) {
            if (Object.hasOwn(this.newArcData, 'cx')) this.newArcData.cx = originalGeometry.cx
            if (Object.hasOwn(this.newArcData, 'cy')) this.newArcData.cy = originalGeometry.cy
            if (Object.hasOwn(this.newArcData, 'r')) this.newArcData.r = originalGeometry.radius
        }
    }

    calculateNewMidpoint(p1, p3, geometry) {
        if (!geometry) return { ...this.oldP2 }

        const { cx, cy, radius: r, ccw } = geometry
        let theta1 = Math.atan2(p1.y - cy, p1.x - cx)
        let theta3 = Math.atan2(p3.y - cy, p3.x - cx)
        if (theta1 < 0) theta1 += 2 * Math.PI
        if (theta3 < 0) theta3 += 2 * Math.PI

        let sweep = ccw ? theta3 - theta1 : theta1 - theta3
        if (sweep < 0) sweep += 2 * Math.PI
        const midAngle = ccw ? theta1 + sweep / 2 : theta1 - sweep / 2

        return {
            x: cx + r * Math.cos(midAngle),
            y: cy + r * Math.sin(midAngle)
        }
    }

    execute() {
        this.updateArc(this.newArcData)
    }

    undo() {
        this.updateArc(this.oldArcData)
    }

    updateArc(arcData) {
        const { p1, p2, p3 } = arcData
        const geo = getArcGeometry(p1, p2, p3)
        if (!geo) return

        this.element.plot(`M ${p1.x} ${p1.y} A ${geo.radius} ${geo.radius} 0 ${geo.largeArcFlag} ${geo.sweepFlag} ${p3.x} ${p3.y}`)
        this.element.data('arcData', {
            ...arcData,
            p1: { ...p1 },
            p2: { ...p2 },
            p3: { ...p3 },
        })
        invalidateSpatialIndexes(this.editor)
        this.dispatchSignal('updatedOutliner')
    }
}

export { ExtendArcCommand }
