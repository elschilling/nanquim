import { Command } from '../Command'

class TrimPolylineCommand extends Command {
  constructor(editor, element, action) {
    super(editor)
    this.type = 'TrimPolylineCommand'
    this.name = 'Trim Polyline'
    this.element = element
    this.action = action
    this.parent = window.SVG(element.node.parentNode) || this.editor.activeCollection
    this.newPolylines = []
    this.hasExecutedBefore = false
  }

  copyStyles(source, target) {
    ;['stroke', 'stroke-width', 'opacity', 'stroke-dasharray', 'stroke-linecap'].forEach(prop => {
      const attrVal = source.node.getAttribute(prop)
      if (attrVal !== null) target.node.setAttribute(prop, attrVal)
      const styleVal = source.node.style[prop]
      if (styleVal) target.node.style[prop] = styleVal
    })
    const overrides = source.node.getAttribute('data-style-overrides')
    if (overrides) target.node.setAttribute('data-style-overrides', overrides)
    target.attr('fill', 'none')
  }

  execute() {
    this.editor.removeElement(this.element)

    if (this.action.type === 'remove') return

    if (this.hasExecutedBefore) {
      this.newPolylines.forEach(pl => this.editor.addElement(pl, this.parent))
    } else {
      this.hasExecutedBefore = true

      this.action.resultPolylines.forEach(pts => {
        if (pts.length < 2) return
        const newPl = this.parent.polyline(pts).fill('none')
        this.copyStyles(this.element, newPl)
        newPl.attr('id', this.editor.elementIndex++)
        newPl.attr('name', 'Polyline')
        this.newPolylines.push(newPl)
      })

      this.editor.signals.updatedOutliner.dispatch()
    }
  }

  undo() {
    this.newPolylines.forEach(pl => this.editor.removeElement(pl))
    this.editor.addElement(this.element, this.parent)
  }
}

export { TrimPolylineCommand }
