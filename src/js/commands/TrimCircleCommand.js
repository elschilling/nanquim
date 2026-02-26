import { Command } from '../Command'

class TrimCircleCommand extends Command {
    constructor(editor, element, action) {
        super(editor)
        this.type = 'TrimCircleCommand'
        this.name = 'Trim Circle'
        this.element = element
        this.action = action
        this.parent = element.node.parentNode
        this.arcPaths = []
        this.hasExecutedBefore = false
    }

    copyStyles(source, target) {
        const stroke = source.attr('stroke')
        const strokeWidth = source.attr('stroke-width')
        const opacity = source.attr('opacity')
        const strokeDasharray = source.attr('stroke-dasharray')

        if (stroke) target.attr('stroke', stroke)
        if (strokeWidth) target.attr('stroke-width', strokeWidth)
        if (opacity !== undefined) target.attr('opacity', opacity)
        if (strokeDasharray) target.attr('stroke-dasharray', strokeDasharray)
        target.attr('fill', 'none')
        target.addClass('newDrawing')
    }

    execute() {
        this.editor.removeElement(this.element)

        if (this.action.type === 'remove') {
            return
        }

        if (this.hasExecutedBefore) {
            this.arcPaths.forEach(p => this.editor.addElement(p, this.parent))
        } else {
            this.hasExecutedBefore = true

            this.action.arcs.forEach(arc => {
                const { cx, cy, r, theta1, theta2, startPt, endPt } = arc
                let sweepFlag = 1 // counter clockwise sweep from theta2 to theta1
                let diff = theta1 - theta2
                if (diff < 0) diff += 2 * Math.PI

                const largeArcFlag = diff > Math.PI ? 1 : 0

                const d = `M ${startPt.x} ${startPt.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${endPt.x} ${endPt.y}`

                let newArc = this.editor.drawing.path(d)
                newArc.data('circleTrimData', arc)
                this.copyStyles(this.element, newArc)
                newArc.attr('name', 'Arc ' + newArc.node.id.replace('SvgjsPath', ''))
                this.arcPaths.push(newArc)
            })

            this.editor.signals.updatedOutliner.dispatch()
        }
    }

    undo() {
        if (this.action.type !== 'remove') {
            this.arcPaths.forEach(p => this.editor.removeElement(p))
        }
        this.editor.addElement(this.element, this.parent)
    }
}

export { TrimCircleCommand }
