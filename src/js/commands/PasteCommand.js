import { Command } from '../Command'

class PasteCommand extends Command {
  constructor(editor, data) {
    super(editor)
    this.type = 'PasteCommand'
    this.name = 'Paste'
    this.data = data
    this.pastedElements = []
    this.parent = editor.activeCollection || editor.drawing
  }

  execute() {
    this.pastedElements = []

    this.data.elements.forEach(item => {
      let svgStr = item.svg.trim()
      if (!svgStr.startsWith('<svg')) {
        svgStr = `<svg xmlns="http://www.w3.org/2000/svg">${svgStr}</svg>`
      }
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgStr, 'image/svg+xml')
      if (doc.documentElement.nodeName === 'parsererror') return

      const sourceRoot = doc.documentElement
      const candidates = svgStr.startsWith('<svg xmlns="http://www.w3.org/2000/svg">') && !item.svg.trim().startsWith('<svg')
        ? Array.from(sourceRoot.childNodes).filter(n => n.nodeType === 1)
        : [doc.documentElement]

      candidates.forEach(rawNode => {
        const node = document.adoptNode(rawNode)

        const stripIds = n => {
          if (n.removeAttribute) n.removeAttribute('id')
          if (n.children) Array.from(n.children).forEach(stripIds)
        }
        stripIds(node)

        this.parent.node.appendChild(node)
        const el = SVG(node)

        const newId = this.editor.elementIndex++
        el.attr('id', newId)
        const typeName = el.node.nodeName.charAt(0).toUpperCase() + el.node.nodeName.slice(1)
        el.attr('name', typeName + ' ' + newId)

        Array.from(node.attributes).forEach(attr => {
          if (attr.name.startsWith('data-')) {
            const key = attr.name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
            try { el.data(key, JSON.parse(attr.value)) } catch { el.data(key, attr.value) }
          }
        })

        const hydrateChildren = (parentEl) => {
          if (!parentEl.children) return
          parentEl.children().each(child => {
            const childId = this.editor.elementIndex++
            child.attr('id', childId)
            if (!child.attr('name')) {
              const cn = child.node.nodeName.charAt(0).toUpperCase() + child.node.nodeName.slice(1)
              child.attr('name', cn + ' ' + childId)
            }
            Array.from(child.node.attributes).forEach(attr => {
              if (attr.name.startsWith('data-')) {
                const key = attr.name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
                try { child.data(key, JSON.parse(attr.value)) } catch { child.data(key, attr.value) }
              }
            })
            if (child.type === 'g') hydrateChildren(child)
          })
        }
        if (el.type === 'g') hydrateChildren(el)

        this.pastedElements.push(el)
      })
    })

    if (this.pastedElements.length > 0) {
      this.editor.spatialIndex.markDirty()
      this.editor.signals.clearSelection.dispatch()
      this.editor.selected = this.pastedElements.slice()
      this.editor.signals.updatedSelection.dispatch()
      this.editor.signals.updatedOutliner.dispatch()
      this.editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Pasted ${this.pastedElements.length} element(s).` })
    }
  }

  undo() {
    this.pastedElements.forEach(el => this.editor.removeElement(el))
    this.editor.signals.clearSelection.dispatch()
    this.editor.signals.updatedOutliner.dispatch()
    this.editor.signals.terminalLogged.dispatch({ type: 'span', msg: 'Undo: Paste removed.' })
  }

  redo() {
    this.pastedElements.forEach(el => {
      this.parent.node.appendChild(el.node)
    })
    this.editor.spatialIndex.markDirty()
    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = this.pastedElements.slice()
    this.editor.signals.updatedSelection.dispatch()
    this.editor.signals.updatedOutliner.dispatch()
    this.editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Redo: Pasted ${this.pastedElements.length} element(s).` })
  }
}

export { PasteCommand }
