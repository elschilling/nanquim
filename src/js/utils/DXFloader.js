import * as Helper from '../libs/dxf/src/Helper'

function DXFLoader(editor) {
  this.loadFile = function (file) {
    console.log('file', file)

    const reader = new FileReader()
    reader.onload = function (e) {
      let data = e.target.result
      if (file.type === 'image/vnd.dxf' || file.name.endsWith('.dxf')) {
        console.log('loading dxf')
        data = new Helper.default(data).toSVG()
      } else if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
        console.log('loading svg')
      }
      console.log(data)
      const parser = new DOMParser()
      const doc = parser.parseFromString(data, 'image/svg+xml')
      const svgRoot = doc.documentElement

      // Read Nanquim metadata if present
      const savedElementIndex = svgRoot.getAttribute('data-element-index')

      // Clear existing drawing
      editor.drawing.clear()

      const svgContent = svgRoot.innerHTML
      console.log('svgContent', svgContent)
      editor.drawing.svg(svgContent)

      // Restore data attributes (arcData, circleTrimData) from data-* DOM attributes
      // SVG.js doesn't auto-hydrate data-* attributes when content is inserted via .svg()
      // We need to manually parse them so SVG.js data() method can access them
      editor.drawing.children().each((el) => {
        // Re-hydrate SVG.js data from DOM data-* attributes
        const node = el.node
        Array.from(node.attributes).forEach((attr) => {
          if (attr.name.startsWith('data-')) {
            const key = attr.name.slice(5) // Remove 'data-' prefix
            // Convert kebab-case to camelCase (e.g., 'arc-data' -> 'arcData')
            const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
            try {
              const value = JSON.parse(attr.value)
              el.data(camelKey, value)
            } catch (err) {
              // Not JSON, store as string
              el.data(camelKey, attr.value)
            }
          }
        })

        // Track element IDs
        const id = parseInt(el.attr('id'))
        if (!isNaN(id) && id >= editor.elementIndex) {
          editor.elementIndex = id + 1
        }
      })

      // If saved elementIndex exists and is higher, use it
      if (savedElementIndex) {
        const idx = parseInt(savedElementIndex)
        if (!isNaN(idx) && idx > editor.elementIndex) {
          editor.elementIndex = idx
        }
      }

      editor.signals.updatedOutliner.dispatch()
      editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Opened: ${file.name}` })
    }
    reader.readAsText(file)
  }
}

export { DXFLoader }
