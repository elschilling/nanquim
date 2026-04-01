import { addRecentFile } from './WelcomeScreen.js'

function Navbar(editor) {
  const form = document.createElement('form')
  form.style.display = 'none'
  document.body.appendChild(form)
  const fileInput = document.createElement('input')
  fileInput.multiple = false
  fileInput.type = 'file'
  fileInput.accept = '.svg,.dxf'
  fileInput.addEventListener('change', function () {
    editor.loader.loadFile(fileInput.files[0])
    form.reset()
  })
  window.fileInput = fileInput
  form.appendChild(fileInput)

  // Save SVG — serialize the drawing group into a standalone SVG and trigger download
  window.saveSVG = async function () {
    const filename = 'drawing.svg'

    const convertStrokes = window.confirm(
      'Convert white strokes to black? (Recommended for viewing the SVG in other programs. They will be converted back to white when opened in Nanquim)'
    )

    // Force in-memory SVG.js data object into DOM data-* attributes so they get serialized
    // Also bake explicitly black strokes into elements using the .newDrawing class,
    // since their white color comes from CSS and won't be visible in standalone SVGs
    editor.drawing.children().each((group) => {
      // Serialize collection state
      if (group.attr('data-collection') === 'true') {
        const collData = editor.collections.get(group.attr('id'))
        if (collData) {
          group.attr('data-locked', collData.locked ? 'true' : 'false')
        }
      }

      // Iterate through collection children for element baking
      const children = group.attr('data-collection') === 'true' ? group.children() : [group]
      const iterFn = (el) => {
        // Serialize data attributes
        if (el.data('arcData')) {
          el.attr('data-arc-data', JSON.stringify(el.data('arcData')))
        }
        if (el.data('circleTrimData')) {
          el.attr('data-circle-trim-data', JSON.stringify(el.data('circleTrimData')))
        }
        if (el.data('splineData')) {
          el.attr('data-spline-data', JSON.stringify(el.data('splineData')))
        }

        // Baking legacy styles deprecated: Managed by Collection inline overrides
      }
      if (group.attr('data-collection') === 'true') {
        group.children().each(iterFn)
      } else {
        iterFn(group)
      }
    })

    // Get inner content only (no wrapping <g> tag)
    let drawingContent = editor.drawing.node.innerHTML

    // Revert logic decoupled: Export relies strictly on inline rendering variables

    // Convert any explicit white inline strokes and fills to black for standalone SVG visibility
    if (convertStrokes) {
      // Handle stroke="..." attributes
      drawingContent = drawingContent.replace(/stroke\s*=\s*["'](?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|var\(--editor-text-color\))["']/gi, 'stroke="#000000"')
      // Handle stroke: ... inside style="..." attributes
      drawingContent = drawingContent.replace(/stroke\s*:\s*(?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|var\(--editor-text-color\))/gi, 'stroke: #000000')

      // Handle fill="..." attributes
      drawingContent = drawingContent.replace(/fill\s*=\s*["'](?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|var\(--editor-text-color\))["']/gi, 'fill="#000000"')
      // Handle fill: ... inside style="..." attributes
      drawingContent = drawingContent.replace(/fill\s*:\s*(?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|var\(--editor-text-color\))/gi, 'fill: #000000')
    }

    // Get current viewbox to preserve the view
    const vb = editor.svg.viewbox()

    const paperConfigStr = JSON.stringify(editor.paperConfig).replace(/"/g, '&quot;')
    
    // Serialize viewports (only necessary properties)
    const viewportsData = (editor.paperViewports || []).map(vp => ({
      id: vp.id,
      x: vp.x,
      y: vp.y,
      w: vp.w,
      h: vp.h,
      scale: vp.scale,
      modelOriginX: vp.modelOriginX,
      modelOriginY: vp.modelOriginY
    }))
    const viewportsStr = JSON.stringify(viewportsData).replace(/"/g, '&quot;')

    // Serialize Dimension Styles
    const dimStylesStr = JSON.stringify(editor.dimensionManager.toJSON()).replace(/"/g, '&quot;')

    // Serialize Text Styles
    const textStylesStr = JSON.stringify(editor.textStyleManager.toJSON()).replace(/"/g, '&quot;')

    const svgString = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svgjs="http://svgjs.com/svgjs"`,
      `  viewBox="${vb.x} ${vb.y} ${vb.width} ${vb.height}"`,
      `  data-nanquim-version="1"`,
      `  data-element-index="${editor.elementIndex}"`,
      `  data-paper-config="${paperConfigStr}"`,
      `  data-paper-viewports="${viewportsStr}"`,
      `  data-dim-styles="${dimStylesStr}"`,
      `  data-text-styles="${textStylesStr}"`,
      convertStrokes ? `  data-nanquim-converted-strokes="true">` : `>`,
      drawingContent,
      `</svg>`,
    ].join('\n')

    const blob = new Blob([svgString], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    // Update the recent files entry with the current saved content
    const recentName = editor.currentFileName || filename
    const dataURL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString)
    addRecentFile(recentName, dataURL)

    editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Drawing successfully saved.` })
  }

  // Open SVG — trigger the file input
  window.openSVG = function () {
    fileInput.click()
  }

  window.onclick = function (event) {
    if (!event.target.matches('.navbar-menus')) {
      let menus = document.getElementsByClassName('dropdown-menu')
      for (let i = 0; i < menus.length; i++) {
        if (menus[i].classList.contains('show-menu')) {
          menus[i].classList.remove('show-menu')
        }
      }
    }
  }
}
function menuFile() {
  document.getElementsByClassName('dropdown-menu')[0].classList.toggle('show-menu')
}
window.menuFile = menuFile
export { Navbar }
