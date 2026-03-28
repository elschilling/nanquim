import * as Helper from '../libs/dxf/src/Helper'
import { rebuildCollectionsFromDOM } from '../Collection'
import { bakeTransforms } from './transformGeometry'

function DXFLoader(editor) {
  this.loadFile = function (file) {
    editor.resetPaperConfig()

    const reader = new FileReader()
    reader.onload = function (e) {
      let data = e.target.result
      if (file.type === 'image/vnd.dxf' || file.name.endsWith('.dxf')) {
        data = new Helper.default(data).toSVG()
      } else if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {

        // Repair older Nanquim SVGs missing the svgjs namespace definition
        if (!data.includes('xmlns:svgjs=')) {
          data = data.replace('<svg ', '<svg xmlns:svgjs="http://svgjs.com/svgjs" ')
        }
      }
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

      // Read Paper Space metadata
      const savedPaperConfigStr = svgRoot.getAttribute('data-paper-config')
      const savedPaperViewportsStr = svgRoot.getAttribute('data-paper-viewports')

      // Read Dimension Styles
      const savedDimStylesStr = svgRoot.getAttribute('data-dim-styles')

      if (savedPaperConfigStr) {
        try {
          const parsedConfig = JSON.parse(savedPaperConfigStr)
          Object.assign(editor.paperConfig, parsedConfig)
        } catch (e) {
          console.warn('Failed to parse paper config', e)
        }
      }

      if (savedDimStylesStr) {
        try {
          const parsedStyles = JSON.parse(savedDimStylesStr)
          editor.dimensionManager.fromJSON(parsedStyles)
        } catch (e) {
          console.warn('Failed to parse dimension styles', e)
        }
      }

      // Clear existing drawing
      editor.drawing.clear()

      let svgContent = ''
      Array.from(svgRoot.children).forEach(child => {
        svgContent += new XMLSerializer().serializeToString(child)
      })

      // If the file was saved with white strokes/fills converted to black, revert them
      if (convertedStrokes) {
        svgContent = svgContent.replace(/stroke\s*=\s*(["'])#000000\1/gi, 'stroke=$1#ffffff$1')
        svgContent = svgContent.replace(/stroke\s*:\s*#000000/gi, 'stroke: #ffffff')

        svgContent = svgContent.replace(/fill\s*=\s*(["'])#000000\1/gi, 'fill=$1#ffffff$1')
        svgContent = svgContent.replace(/fill\s*:\s*#000000/gi, 'fill: #ffffff')
      }
      editor.drawing.svg(svgContent)

      // Hydrate data attributes recursively (including inside collection groups).
      // Must run BEFORE bakeTransforms so that arcData/splineData/etc. are
      // in-memory when applyMatrixToElement tries to transform them.
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

      // For DXF imports: flatten inline styling groups so leaf elements
      // sit directly inside collections (but keep transform groups intact)
      if (file.name.endsWith('.dxf')) {
        flattenDXFStylingGroups(editor)

        // Run the recursive transform baker to remove all 'transform=' attributes
        // from DXF block inserts, baking the coordinates straight into the geometry.
        // This solves all CAD-space distortion when rotating/moving nested blocks.
        // arcData/splineData are already in-memory (hydrated above) so they get
        // correctly transformed alongside the path geometry.
        editor.drawing.children().each(collectionGroup => {
          if (collectionGroup.attr('data-collection') === 'true') {
            bakeTransforms(collectionGroup)
          }
        })
      }

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

      // Clear existing viewports
      if (editor.paperEditor) {
        const existingVps = [...(editor.paperViewports || [])]
        existingVps.forEach(vp => editor.paperEditor.removeViewport(vp.id))
      }

      if (savedPaperViewportsStr && editor.paperEditor) {
        try {
          const parsedVps = JSON.parse(savedPaperViewportsStr)
          // Make sure Paper Space SVG exists before creating viewports
          if (!editor.paperSvg || !editor.paperViewportsGroup) {
            // activate() will build the SVG structure, then we revert back if we weren't in paper mode
            const wasPaper = editor.mode === 'paper'
            editor.paperEditor.activate()
            if (!wasPaper) editor.paperEditor.deactivate()
          }
          parsedVps.forEach(vpData => {
            const vp = editor.paperEditor.createViewport(vpData.x, vpData.y, vpData.w, vpData.h, vpData.scale)
            vp.setModelOrigin(vpData.modelOriginX, vpData.modelOriginY)
          })
          
          if (editor.mode === 'paper') {
            editor.paperEditor.deactivate()
            editor.paperEditor.activate()
          }
        } catch (e) {
          console.warn('Failed to parse paper viewports', e)
        }
      }

      editor.signals.updatedOutliner.dispatch()
      editor.signals.terminalLogged.dispatch({ type: 'span', msg: 'Opened: ' + file.name })
    }
    reader.readAsText(file)
  }
}

/**
 * Optimize DXF imports by flattening purely redundant structural groups.
 * Unlike older versions, we NO LONGER push stroke colors down to leaf elements,
 * because doing so creates hardcoded inline styles that block inheritance
 * from the Properties panel and Collection styles.
 * If a group has a stroke color, we leave it intact or promote the stroke up
 * to ensure styling is applied at the highest possible group level.
 */
function flattenDXFStylingGroups(editor) {
  const flattenInGroup = (parent) => {
    // We need to iterate carefully since we modify the DOM during iteration
    const children = [...parent.children()]
    children.forEach(child => {
      if (child.type !== 'g') return
      // Skip collection groups and explicit user/block groups
      if (child.attr('data-collection') === 'true') return
      if (child.attr('data-group') === 'true') return

      // Recurse first so inner structure is as flat as possible
      flattenInGroup(child)

      const hasStroke = child.attr('stroke')
      const hasTransform = child.attr('transform')

      // Case 1: Purely structural wrapper (no stroke, no transform)
      // We can safely hoist all children up.
      if (!hasStroke && !hasTransform) {
        const innerChildren = [...child.children()]
        innerChildren.forEach(innerChild => parent.add(innerChild))
        child.remove()
        return
      }

      // Case 2: Styling wrapper (has stroke, no transform)
      // We want to KEEP the group so its stroke can be inherited, BUT
      // if it only contains ONE child, we can apply the stroke directly
      // to that child (if it doesn't have one) and remove the wrapper
      // for a cleaner DOM.
      if (hasStroke && !hasTransform) {
        const innerChildren = [...child.children()]
        if (innerChildren.length === 1) {
          const innerChild = innerChildren[0]
          if (!innerChild.attr('stroke')) {
            innerChild.attr('stroke', hasStroke)
          }
          parent.add(innerChild)
          child.remove()
        }
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
