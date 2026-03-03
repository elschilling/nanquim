import * as Helper from '../libs/dxf/src/Helper'
import { rebuildCollectionsFromDOM } from '../Collection'

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

      // Read stroke conversion metadata
      const convertedStrokes = svgRoot.getAttribute('data-nanquim-converted-strokes') === 'true'

      // Clear existing drawing
      editor.drawing.clear()

      let svgContent = svgRoot.innerHTML

      // If the file was saved with white strokes converted to black, revert them
      if (convertedStrokes) {
        svgContent = svgContent.replace(/stroke\s*=\s*(["'])#000000\1/gi, 'stroke=$1#ffffff$1')
        svgContent = svgContent.replace(/stroke\s*:\s*#000000/gi, 'stroke: #ffffff')
      }

      console.log('svgContent', svgContent)
      editor.drawing.svg(svgContent)

      // Hydrate data attributes recursively (including inside collection groups)
      const hydrateElement = (el) => {
        const node = el.node
        Array.from(node.attributes).forEach((attr) => {
          if (attr.name.startsWith('data-')) {
            const key = attr.name.slice(5)
            const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
            try {
              const value = JSON.parse(attr.value)
              el.data(camelKey, value)
            } catch (err) {
              el.data(camelKey, attr.value)
            }
          }
        })
        const id = parseInt(el.attr('id'))
        if (!isNaN(id) && id >= editor.elementIndex) {
          editor.elementIndex = id + 1
        }
      }

      editor.drawing.children().each((child) => {
        if (child.type === 'g') {
          // Hydrate the group itself
          hydrateElement(child)
          // Hydrate its children
          child.children().each(hydrateElement)
        } else {
          hydrateElement(child)
        }
      })

      // If saved elementIndex exists and is higher, use it
      if (savedElementIndex) {
        const idx = parseInt(savedElementIndex)
        if (!isNaN(idx) && idx > editor.elementIndex) {
          editor.elementIndex = idx
        }
      }

      // Rebuild collections from DOM (handles legacy and new files)
      rebuildCollectionsFromDOM(editor)

      editor.signals.updatedOutliner.dispatch()
      editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Opened: ${file.name}` })
    }
    reader.readAsText(file)
  }
}

export { DXFLoader }
