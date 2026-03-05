import { Command } from '../Command'

class TrimRectCommand extends Command {
    constructor(editor, element, trimData) {
        super(editor)
        this.type = 'TrimRectCommand'
        this.name = 'Trim Rectangle'
        this.element = element // the original rect
        this.trimData = trimData // { action, closestLineIndex, lines }
        this.parent = window.SVG(element.node.parentNode) || this.editor.activeCollection

        this.intactLines = []
        this.trimmedLines = []
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
        target.addClass('newDrawing')
    }

    execute() {
        this.editor.removeElement(this.element)

        if (!this.hasExecutedBefore) {
            this.hasExecutedBefore = true

            // Create the intact lines
            for (let i = 0; i < 4; i++) {
                if (i !== this.trimData.closestLineIndex) {
                    const l = this.trimData.lines[i]
                    const newLine = this.parent.line(l.x1, l.y1, l.x2, l.y2)
                    this.copyStyles(this.element, newLine)
                    this.intactLines.push(newLine)
                }
            }

            // Create the trimmed line(s)
            const action = this.trimData.action
            const targetLine = this.trimData.lines[this.trimData.closestLineIndex]

            if (action.type === 'shorten') {
                let newLine
                if (action.keep === 'start') {
                    newLine = this.parent.line(targetLine.x1, targetLine.y1, action.newX, action.newY)
                } else {
                    newLine = this.parent.line(action.newX, action.newY, targetLine.x2, targetLine.y2)
                }
                this.copyStyles(this.element, newLine)
                this.trimmedLines.push(newLine)
            } else if (action.type === 'split') {
                const line1 = this.parent.line(targetLine.x1, targetLine.y1, action.splitX1, action.splitY1)
                const line2 = this.parent.line(action.splitX2, action.splitY2, targetLine.x2, targetLine.y2)
                this.copyStyles(this.element, line1)
                this.copyStyles(this.element, line2)
                this.trimmedLines.push(line1, line2)
            }
            this.editor.signals.updatedOutliner.dispatch()
        } else {
            this.intactLines.forEach(l => this.editor.addElement(l, this.parent))
            this.trimmedLines.forEach(l => this.editor.addElement(l, this.parent))
        }
    }

    undo() {
        this.intactLines.forEach(l => this.editor.removeElement(l))
        this.trimmedLines.forEach(l => this.editor.removeElement(l))
        this.editor.addElement(this.element, this.parent)
    }
}

export { TrimRectCommand }
