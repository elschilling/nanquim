import { getArcGeometry } from '../utils/arcUtils.js'
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

        const geo = getArcGeometry(p1, p2, p3)

        // If points are collinear (or very close), draw a straight line
        if (!geo) {
            this.element.plot(`M ${p1.x} ${p1.y} L ${p3.x} ${p3.y}`)
            return
        }

        this.element.plot(`M ${p1.x} ${p1.y} A ${geo.radius} ${geo.radius} 0 ${geo.largeArcFlag} ${geo.sweepFlag} ${p3.x} ${p3.y}`)
    }
}

export { EditArcCommand }
