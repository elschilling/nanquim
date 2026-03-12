import { Command } from '../Command'
import { catmullRomToBezierPath } from './DrawSplineCommand'

class TrimSplineCommand extends Command {
    constructor(editor, element, action) {
        super(editor)
        this.type = 'TrimSplineCommand'
        this.name = 'Trim Spline'
        this.element = element
        this.action = action
        this.parent = window.SVG(element.node.parentNode) || this.editor.activeCollection
        this.newSplines = []
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
            this.newSplines.forEach(s => this.editor.addElement(s, this.parent))
        } else {
            this.hasExecutedBefore = true

            this.action.splines.forEach(points => {
                const d = catmullRomToBezierPath(points)
                const newSpline = this.parent.path(d)
                newSpline.data('splineData', { points: points.map(p => ({ x: p.x, y: p.y })) })
                this.copyStyles(this.element, newSpline)
                newSpline.attr('name', 'Spline')
                this.newSplines.push(newSpline)
            })

            this.editor.signals.updatedOutliner.dispatch()
        }
    }

    undo() {
        if (this.action.type !== 'remove') {
            this.newSplines.forEach(s => this.editor.removeElement(s))
        }
        this.editor.addElement(this.element, this.parent)
    }
}

export { TrimSplineCommand }
