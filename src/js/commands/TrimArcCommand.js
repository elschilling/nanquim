import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'

class TrimArcCommand extends Command {
    constructor(editor, element, action) {
        super(editor)
        this.type = 'TrimArcCommand'
        this.name = 'Trim Arc'
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
                const { r, startPt, midPt, endPt, cx, cy } = arc

                let t1 = Math.atan2(startPt.y - cy, startPt.x - cx)
                let t2 = Math.atan2(midPt.y - cy, midPt.x - cx)
                let t3 = Math.atan2(endPt.y - cy, endPt.x - cx)
                if (t1 < 0) t1 += 2 * Math.PI
                if (t2 < 0) t2 += 2 * Math.PI
                if (t3 < 0) t3 += 2 * Math.PI

                let ccwDist = t3 - t1
                if (ccwDist < 0) ccwDist += 2 * Math.PI
                let midCcwDist = t2 - t1
                if (midCcwDist < 0) midCcwDist += 2 * Math.PI

                let sweepFlag = 0
                let largeArcFlag = 0
                if (midCcwDist < ccwDist) {
                    sweepFlag = 1
                    largeArcFlag = ccwDist > Math.PI ? 1 : 0
                } else {
                    sweepFlag = 0
                    let cwDist = 2 * Math.PI - ccwDist
                    largeArcFlag = cwDist > Math.PI ? 1 : 0
                }

                const d = `M ${startPt.x} ${startPt.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${endPt.x} ${endPt.y}`

                let newArc = this.parent.path(d)

                // Set the arcData for editability and snapping
                // p1 = start point, p2 = mid point, p3 = end point (following our DrawArcCommand convention)
                newArc.data('arcData', {
                    p1: { x: startPt.x, y: startPt.y },
                    p2: { x: midPt.x, y: midPt.y },
                    p3: { x: endPt.x, y: endPt.y }
                })

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

export { TrimArcCommand }
