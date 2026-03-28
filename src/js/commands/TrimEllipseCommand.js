import { Command } from '../Command'

class TrimEllipseCommand extends Command {
    constructor(editor, element, action) {
        super(editor)
        this.type = 'TrimEllipseCommand'
        this.name = 'Trim Ellipse'
        this.element = element
        this.action = action
        this.parent = window.SVG(element.node.parentNode) || this.editor.activeCollection
        this.arcPaths = []
        this.hasExecutedBefore = false
    }

    copyStyles(source, target) {
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
                const { cx, cy, rx, ry, theta1, theta2, startPt, endPt } = arc

                // theta1 is start, theta2 is end (CCW sweep)
                let diff = (theta2 - theta1 + 2 * Math.PI) % (2 * Math.PI)
                const largeArcFlag = diff > Math.PI ? 1 : 0
                const sweepFlag = 1 // CCW

                const d = `M ${startPt.x} ${startPt.y} A ${rx} ${ry} 0 ${largeArcFlag} ${sweepFlag} ${endPt.x} ${endPt.y}`

                let newArc = this.parent.path(d)

                newArc.data('ellipseArcData', arc)
                newArc.attr('name', 'EllipseArc')

                this.copyStyles(this.element, newArc)
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

export { TrimEllipseCommand }
