import { Command } from './Command.js'

class EditArcCommand extends Command {
    constructor(editor, element, oldValues, newValues) {
        super(editor)
        this.type = 'EditArcCommand'
        this.name = 'Edit Arc'
        this.element = element
        this.oldValues = oldValues
        this.newValues = newValues
    }

    execute() {
        this.applyArcValues(this.newValues)
        this.editor.signals.terminalLogged.dispatch({
            msg: `Arc edited.`,
        })
        this.editor.signals.refreshHandlers.dispatch()
    }

    undo() {
        this.applyArcValues(this.oldValues)
        this.editor.signals.refreshHandlers.dispatch()
    }

    applyArcValues(values) {
        const p1 = values.p1
        const p2 = values.p2
        const p3 = values.p3

        // Update the element's stored data
        this.element.data('arcData', values)

        // Calculate the circumcircle of the three points
        const A = p1.x * (p2.y - p3.y) - p1.y * (p2.x - p3.x) + p2.x * p3.y - p3.x * p2.y

        // If points are collinear (or very close), draw a straight line
        if (Math.abs(A) < 0.1) {
            this.element.plot(`M ${p1.x} ${p1.y} L ${p3.x} ${p3.y}`)
            return
        }

        const p1sq = p1.x * p1.x + p1.y * p1.y
        const p2sq = p2.x * p2.x + p2.y * p2.y
        const p3sq = p3.x * p3.x + p3.y * p3.y

        const B = p1sq * (p3.y - p2.y) + p2sq * (p1.y - p3.y) + p3sq * (p2.y - p1.y)
        const C = p1sq * (p2.x - p3.x) + p2sq * (p3.x - p1.x) + p3sq * (p1.x - p2.x)

        const cx = -B / (2 * A)
        const cy = -C / (2 * A)

        // Radius is distance from center to any point
        let radius = Math.sqrt((cx - p1.x) ** 2 + (cy - p1.y) ** 2)
        radius = Math.min(radius, 100000)

        // Calculate angles from center to the three points
        let startAngle = Math.atan2(p1.y - cy, p1.x - cx)
        let midAngle = Math.atan2(p2.y - cy, p2.x - cx)
        let endAngle = Math.atan2(p3.y - cy, p3.x - cx)

        // Normalize angles to be between 0 and 2*PI
        if (startAngle < 0) startAngle += 2 * Math.PI
        if (midAngle < 0) midAngle += 2 * Math.PI
        if (endAngle < 0) endAngle += 2 * Math.PI

        // Math to determine if the midAngle is between startAngle and endAngle going clockwise or counter-clockwise
        let sweepFlag = 0
        let largeArcFlag = 0

        // Check counter-clockwise path from start to end
        let ccwDistance = endAngle - startAngle
        if (ccwDistance < 0) ccwDistance += 2 * Math.PI

        let midCcwDistance = midAngle - startAngle
        if (midCcwDistance < 0) midCcwDistance += 2 * Math.PI

        if (midCcwDistance < ccwDistance) {
            // p2 is visited when traversing from p1 to p3 counter-clockwise
            sweepFlag = 1
            largeArcFlag = ccwDistance > Math.PI ? 1 : 0
        } else {
            // p2 is visited when traversing from p1 to p3 clockwise
            sweepFlag = 0
            let cwDistance = 2 * Math.PI - ccwDistance
            largeArcFlag = cwDistance > Math.PI ? 1 : 0
        }

        this.element.plot(`M ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${p3.x} ${p3.y}`)
    }
}

export { EditArcCommand }
