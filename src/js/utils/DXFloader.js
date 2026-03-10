import * as Helper from '../libs/dxf/src/Helper'
import { rebuildCollectionsFromDOM } from '../Collection'
import { bakeTransforms } from './transformGeometry'

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

        // Repair older Nanquim SVGs missing the svgjs namespace definition
        if (!data.includes('xmlns:svgjs=')) {
          data = data.replace('<svg ', '<svg xmlns:svgjs="http://svgjs.com/svgjs" ')
        }
      }
      console.log(data)
      const parser = new DOMParser()
      const doc = parser.parseFromString(data, 'image/svg+xml')
      const svgRoot = doc.documentElement

      if (svgRoot.nodeName === 'parsererror' || doc.getElementsByTagName('parsererror').length > 0) {
        console.error('SVG Parsing Error:', doc.documentElement.textContent)
        if (editor.signals && editor.signals.terminalLogged) {
          editor.signals.terminalLogged.dispatch({ type: 'span', msg: 'Failed to open SVG: Corrupted or invalid format.' })
        }
        return
      }

      // Read Nanquim metadata if present
      const savedElementIndex = svgRoot.getAttribute('data-element-index')

      // Read stroke conversion metadata
      const convertedStrokes = svgRoot.getAttribute('data-nanquim-converted-strokes') === 'true'

      // Clear existing drawing
      editor.drawing.clear()

      let svgContent = ''
      Array.from(svgRoot.children).forEach(child => {
        svgContent += new XMLSerializer().serializeToString(child)
      })

      // If the file was saved with white strokes converted to black, revert them
      if (convertedStrokes) {
        svgContent = svgContent.replace(/stroke\s*=\s*(["'])#000000\1/gi, 'stroke=$1#ffffff$1')
        svgContent = svgContent.replace(/stroke\s*:\s*#000000/gi, 'stroke: #ffffff')
      }

      console.log('svgContent', svgContent)
      editor.drawing.svg(svgContent)

      // For DXF imports: flatten inline styling groups so leaf elements
      // sit directly inside collections (but keep transform groups intact)
      if (file.name.endsWith('.dxf')) {
        flattenDXFStylingGroups(editor)

        // Run the recursive transform baker to remove all 'transform=' attributes
        // from DXF block inserts, baking the coordinates straight into the geometry.
        // This solves all CAD-space distortion when rotating/moving nested blocks.
        editor.drawing.children().each(collectionGroup => {
          if (collectionGroup.attr('data-collection') === 'true') {
            bakeTransforms(collectionGroup)
          }
        })
      }

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

        // If this is a collection group, don't try to parse its ID as an integer
        // as collections use 'collection-N' format.
        if (el.attr('data-collection') === 'true') return

        let id = parseInt(el.attr('id'))
        if (isNaN(id)) {
          id = editor.elementIndex++
          el.attr('id', id)
        } else if (id >= editor.elementIndex) {
          editor.elementIndex = id + 1
        }

        if (!el.attr('name')) {
          const nodeName = el.node.nodeName
          const typeName = nodeName.charAt(0).toUpperCase() + nodeName.slice(1)
          el.attr('name', typeName + ' ' + id)
        }
      }

      const hydrateTree = (el) => {
        hydrateElement(el)
        if (el.children) {
          el.children().each(child => hydrateTree(child))
        }
      }

      editor.drawing.children().each(child => hydrateTree(child))

      // If saved elementIndex exists and is higher, use it
      if (savedElementIndex) {
        const idx = parseInt(savedElementIndex)
        if (!isNaN(idx) && idx > editor.elementIndex) {
          editor.elementIndex = idx
        }
      }

      // Rebuild collections from DOM (handles legacy and new files)
      rebuildCollectionsFromDOM(editor)

      // Build spatial index for fast hit-testing on the imported geometry
      editor.spatialIndex.rebuild(editor)

      editor.signals.updatedOutliner.dispatch()
      editor.signals.terminalLogged.dispatch({ type: 'span', msg: 'Opened: ' + file.name })
    }
    reader.readAsText(file)
  }
}

/**
 * Flatten DXF inline styling groups:
 * The DXF parser wraps each entity in <g stroke="..."> for per-entity color.
 * We unwrap these by pushing the stroke attribute directly onto the child
 * elements and moving them up to the parent.
 * 
 * IMPORTANT: We do NOT flatten <g transform="..."> groups because those
 * represent block references/inserts and are needed for correct positioning.
 * We only flatten groups whose sole purpose is to carry a stroke color.
 */
function flattenDXFStylingGroups(editor) {
  const flattenInGroup = (parent) => {
    // We need to iterate carefully since we modify the DOM during iteration
    const children = [...parent.children()]
    children.forEach(child => {
      if (child.type !== 'g') return
      // Skip collection groups and explicit groups
      if (child.attr('data-collection') === 'true') return
      if (child.attr('data-group') === 'true') return

      // Check if this is a pure styling wrapper:
      // it has a stroke attribute but NO transform attribute
      const hasStroke = child.attr('stroke')
      const hasTransform = child.attr('transform')

      if (hasStroke && !hasTransform) {
        // This is an inline styling wrapper - flatten it
        const innerChildren = [...child.children()]
        innerChildren.forEach(innerChild => {
          // Push stroke color down to inner child if it doesn't have one
          if (hasStroke && !innerChild.attr('stroke')) {
            innerChild.attr('stroke', hasStroke)
          }
          // Move inner child up to parent
          parent.add(innerChild)
        })
        // Remove the now-empty wrapper
        child.remove()
      } else {
        // This is a transform group or complex group - recurse into it
        // to flatten any styling wrappers inside
        flattenInGroup(child)
      }
    })
  }

  editor.drawing.children().each(collectionGroup => {
    if (collectionGroup.type === 'g') {
      flattenInGroup(collectionGroup)
    }
  })
}

export { DXFLoader }
