function Navbar(editor) {
  const form = document.createElement('form')
  form.style.display = 'none'
  document.body.appendChild(form)
  const fileInput = document.createElement('input')
  fileInput.multiple = false
  fileInput.type = 'file'
  fileInput.accept = '.svg,.dxf'
  fileInput.addEventListener('change', function () {
    console.log('load file', fileInput.files)
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

        // Bake CSS styles into inline attributes so standalone SVGs render correctly
        if (el.hasClass('newDrawing')) {
          el.attr('data-temp-export-baked', 'true')
          if (convertStrokes) {
            el.stroke({ color: '#000000', width: 0.1, linecap: 'round' })
          } else {
            el.stroke({ color: '#ffffff', width: 0.1, linecap: 'round' })
          }

          // Only override fill if it's not already explicitly set
          if (!el.attr('fill')) {
            el.attr('data-temp-fill-export', 'true')
            el.fill('none')
          }
        }
      }
      if (group.attr('data-collection') === 'true') {
        group.children().each(iterFn)
      } else {
        iterFn(group)
      }
    })

    // Get inner content only (no wrapping <g> tag)
    let drawingContent = editor.drawing.node.innerHTML

    // Revert the temporary baked attributes so the live editor goes back to using CSS variables
    editor.drawing.children().each((group) => {
      const revertFn = (el) => {
        if (el.attr('data-temp-export-baked')) {
          el.node.removeAttribute('stroke')
          el.node.removeAttribute('stroke-width')
          el.node.removeAttribute('stroke-linecap')
          el.node.removeAttribute('data-temp-export-baked')
        }
        if (el.attr('data-temp-fill-export')) {
          el.node.removeAttribute('fill')
          el.node.removeAttribute('data-temp-fill-export')
        }
      }
      if (group.attr('data-collection') === 'true') {
        group.children().each(revertFn)
      } else {
        revertFn(group)
      }
    })

    // Convert any explicit white inline strokes to black for standalone SVG visibility
    if (convertStrokes) {
      // Handle stroke="..." attributes
      drawingContent = drawingContent.replace(/stroke\s*=\s*["'](?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|var\(--editor-text-color\))["']/gi, 'stroke="#000000"')
      // Handle stroke: ... inside style="..." attributes
      drawingContent = drawingContent.replace(/stroke\s*:\s*(?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|var\(--editor-text-color\))/gi, 'stroke: #000000')
    }

    // Get current viewbox to preserve the view
    const vb = editor.svg.viewbox()

    const svgString = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
      `  viewBox="${vb.x} ${vb.y} ${vb.width} ${vb.height}"`,
      `  data-nanquim-version="1"`,
      `  data-element-index="${editor.elementIndex}"`,
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
