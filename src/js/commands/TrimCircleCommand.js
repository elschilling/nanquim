import { Command } from '../Command'

class TrimCircleCommand extends Command {
    constructor(editor, element, action) {
        super(editor)
        this.type = 'TrimCircleCommand'
        this.name = 'Trim Circle'
        this.element = element
        this.action = action
        this.parent = window.SVG(element.node.parentNode) || this.editor.activeCollection
        this.arcPaths = []
        this.hasExecutedBefore = false
    }

    copyStyles(source, target) {
        // Securely copy explicit styles (stroke color, width, etc from original)
        // We use raw DOM methods to avoid reading transient CSS/computed styles like hover effects
        const copyDOMStyles = (src, dest) => {
            ['stroke', 'stroke-width', 'opacity', 'stroke-dasharray', 'stroke-linecap'].forEach(prop => {
                const attrVal = src.getAttribute(prop)
                if (attrVal !== null) dest.setAttribute(prop, attrVal)

                const styleVal = src.style[prop]
                if (styleVal) dest.style[prop] = styleVal
            })
            const overrides = src.getAttribute('data-style-overrides')
            if (overrides) dest.setAttribute('data-style-overrides', overrides)
        }

        copyDOMStyles(source.node, target.node)
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

                let newArc = this.parent.path(d)

                // Calculate midPt for 3-point handlers
                const midAngle = theta2 + diff / 2
                const midPt = {
                    x: cx + r * Math.cos(midAngle),
                    y: cy + r * Math.sin(midAngle)
                }

                newArc.data('circleTrimData', arc)
                newArc.data('arcData', { p1: startPt, p2: midPt, p3: endPt })

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
