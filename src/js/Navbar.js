import { addRecentFile } from './WelcomeScreen.js'
import { DXFExporter } from './utils/DXFexporter.js'

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
  window.saveSVG = async function ({ direct = false } = {}) {
    const filename = 'drawing.svg'
    const directSaveHandle = direct && editor.currentFileHandle && /\.svg$/i.test(editor.currentFileName || editor.currentFileHandle.name)

    // Direct saves preserve the editable Nanquim styling and must not interrupt
    // Ctrl+S with the export-only stroke conversion question.
    const convertStrokes = directSaveHandle
      ? false
      : window.confirm(
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

    // Strip interaction classes — they live in the DOM and would bake into the saved file,
    // causing elements to appear pre-hovered/selected when the file is reopened.
    drawingContent = drawingContent
      .replace(/\belementHover\b\s*/g, '')
      .replace(/\belementSelected\b\s*/g, '')
      // Clean up any class="..." attributes left empty or with only whitespace
      .replace(/\bclass="\s*"/g, '')

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

    // Serialize block definitions from <defs>
    let blockDefsContent = ''
    const blockDefEls = editor.svg.defs().find('[data-block-def="true"]')
    if (blockDefEls.length > 0) {
      blockDefsContent = '<defs>' + blockDefEls.map(d => d.node.outerHTML).join('') + '</defs>'
    }

    // Serialize block definitions metadata
    const blockDefsMetaStr = JSON.stringify(
      Array.from(editor.blockDefinitions.entries())
    ).replace(/"/g, '&quot;')

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
      `  data-block-definitions="${blockDefsMetaStr}"`,
      convertStrokes ? `  data-nanquim-converted-strokes="true">` : `>`,
      blockDefsContent,
      drawingContent,
      `</svg>`,
    ].join('\n')

    if (directSaveHandle) {
      try {
        const permission = await editor.currentFileHandle.queryPermission({ mode: 'readwrite' })
        if (permission !== 'granted') {
          editor.signals.terminalLogged.dispatch({ msg: 'This file is not writable. Use Save SVG to export a copy.' })
          return
        }
        const writable = await editor.currentFileHandle.createWritable()
        await writable.write(svgString)
        await writable.close()
        editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Saved ${editor.currentFileName || editor.currentFileHandle.name}.` })
        return
      } catch (error) {
        console.error('[Navbar] Failed to save file:', error)
        editor.signals.terminalLogged.dispatch({ msg: 'Could not save the current file.' })
        return
      }
    }

    // A first save chooses a disk location and keeps its handle. Subsequent
    // Ctrl+S calls can then overwrite this exact file without another dialog.
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: editor.currentFileName || filename,
          types: [{
            description: 'SVG drawing',
            accept: { 'image/svg+xml': ['.svg'] },
          }],
        })
        const writable = await handle.createWritable()
        await writable.write(svgString)
        await writable.close()
        editor.currentFileName = handle.name
        editor.currentFileHandle = handle
        await addRecentFile(handle)
        editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Saved ${handle.name}.` })
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('[Navbar] Failed to save file:', error)
          editor.signals.terminalLogged.dispatch({ msg: 'Could not save the file.' })
        }
      }
      return
    }

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

  // Export DXF — convert current drawing to DXF and trigger download
  window.saveDXF = function () {
    new DXFExporter(editor).saveFile('drawing.dxf')
  }

  // Open SVG/DXF with a persistent disk handle when the browser supports it.
  window.openSVG = async function () {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{
            description: 'Nanquim drawings',
            accept: {
              'image/svg+xml': ['.svg'],
              'image/vnd.dxf': ['.dxf'],
            },
          }],
        })
        const file = await handle.getFile()
        editor.currentFileName = file.name
        editor.currentFileHandle = handle
        // Ask for write access while this picker action still has a user
        // gesture, so later Ctrl+S saves directly without a prompt.
        await handle.requestPermission({ mode: 'readwrite' })
        await addRecentFile(handle)
        editor.loader.loadFile(file)
      } catch (error) {
        // The picker reports AbortError when the user cancels it.
        if (error.name !== 'AbortError') console.error('[Navbar] Failed to open file:', error)
      }
      return
    }

    // Browsers without the File System Access API can open a file, but no disk
    // reference is available to persist as a recent file.
    editor.signals.terminalLogged.dispatch({
      msg: 'Recent disk files require HTTPS or localhost and File System Access support.',
    })
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
