import { Command } from '../Command'

class TrimLineCommand extends Command {
    constructor(editor, element, action) {
        super(editor)
        this.type = 'TrimLineCommand'
        this.name = 'Trim Line'
        this.element = element
        this.action = action

        // Backup original coords
        this.oldX1 = element.node.x1.baseVal.value
        this.oldY1 = element.node.y1.baseVal.value
        this.oldX2 = element.node.x2.baseVal.value
        this.oldY2 = element.node.y2.baseVal.value

        this.parent = window.SVG(element.node.parentNode) || this.editor.activeCollection
        this.newLine = null // If 'split', store the new line created
    }

    execute() {
        if (this.action.type === 'remove') {
            this.editor.removeElement(this.element)
        } else if (this.action.type === 'shorten') {
            if (this.action.keep === 'start') {
                this.element.plot(this.oldX1, this.oldY1, this.action.newX, this.action.newY)
            } else { // keep === 'end'
                this.element.plot(this.action.newX, this.action.newY, this.oldX2, this.oldY2)
            }
        } else if (this.action.type === 'split') {
            // Shorten the original line
            this.element.plot(this.oldX1, this.oldY1, this.action.splitX1, this.action.splitY1)

            // Create a new line for the remaining part in the same parent layer
            if (!this.newLine) {
                this.newLine = this.parent.line(this.action.splitX2, this.action.splitY2, this.oldX2, this.oldY2)

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

                copyDOMStyles(this.element.node, this.newLine.node)

                const rawId = this.newLine.node.id.replace('SvgjsLine', '')
                this.newLine.attr('name', 'Line ' + rawId)
                this.newLine

                this.editor.signals.updatedOutliner.dispatch()
            } else {
                this.editor.addElement(this.newLine, this.parent)
            }
        }
    }

    undo() {
        if (this.action.type === 'remove') {
            this.editor.addElement(this.element, this.parent)
        } else if (this.action.type === 'shorten') {
            this.element.plot(this.oldX1, this.oldY1, this.oldX2, this.oldY2)
        } else if (this.action.type === 'split') {
            // Remove the newly created line
            if (this.newLine) {
                this.editor.removeElement(this.newLine)
            }
            // Restore the original line
            this.element.plot(this.oldX1, this.oldY1, this.oldX2, this.oldY2)
        }
    }
}

export { TrimLineCommand }
