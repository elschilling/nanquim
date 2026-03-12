/**
 * ExportPaper.js
 *
 * Export functions for the Paper editor.
 * - exportPaperSVG: Standalone SVG of the paper layout
 * - exportPaperPDF: PDF via jspdf + svg2pdf.js
 */

/**
 * Apply color mapping to an SVG string.
 * Replaces model colors with their print-mapped equivalents.
 */
function applyColorMap(svgString, colorMap) {
  if (!colorMap || Object.keys(colorMap).length === 0) return svgString

  const parser = new DOMParser()
  const doc = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${svgString}</svg>`, 'image/svg+xml')
  
  const ctx = document.createElement('canvas').getContext('2d')
  const normalizeColor = (c) => {
    if (!c || c === 'none' || c === 'transparent') return null
    ctx.fillStyle = c
    return ctx.fillStyle
  }

  const elements = doc.querySelectorAll('*')
  elements.forEach(el => {
    ['stroke', 'fill'].forEach(attr => {
      // Check attribute
      let attrVal = el.getAttribute(attr)
      if (attrVal) {
        let norm = normalizeColor(attrVal)
        if (norm && colorMap[norm] && colorMap[norm].enabled) {
          el.setAttribute(attr, colorMap[norm].printColor)
        }
      }
      
      // Check inline style
      let styleVal = el.style[attr]
      if (styleVal) {
        let norm = normalizeColor(styleVal)
        if (norm && colorMap[norm] && colorMap[norm].enabled) {
          el.style[attr] = colorMap[norm].printColor
        }
      }
    })
  })

  // Return the inner HTML of the temporary wrapper
  return doc.documentElement.innerHTML
}

/**
 * Build a standalone SVG string of the paper layout.
 */
function buildPaperSVGString(editor, viewports) {
  if (!editor.paperSvg) return null

  const { wSVG, hSVG } = editor.paperEditor.getPaperDimsSVG()
  // We don't want extra margin in the exported file
  const margin = 0

  // Temporarily hide UI artifacts: paper background, viewport handles, frames, and labels
  const uiElements = []
  
  const bgNode = editor.paperSvg.findOne('#paper-background')
  if (bgNode) uiElements.push(bgNode)
  
  editor.paperSvg.find('.vp-handle, .vp-frame, .vp-label').forEach(el => {
    uiElements.push(el)
  })

  // Hide them
  uiElements.forEach(el => {
    el.node.dataset.originalDisplay = el.node.style.display
    el.node.style.display = 'none'
  })

  // Serialize the paper SVG inner content
  let innerContent = editor.paperSvg.node.innerHTML

  // Restore UI artifacts
  uiElements.forEach(el => {
    el.node.style.display = el.node.dataset.originalDisplay || ''
  })

  // Embed the model drawing inside a <defs> block so <use> tags from viewports can resolve it
  const modelContent = `<defs>${editor.drawing.node.outerHTML}</defs>`
  innerContent = modelContent + '\n' + innerContent

  // Apply color mapping
  innerContent = applyColorMap(innerContent, editor.paperConfig.colorMap)

  const svgString = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    `  viewBox="${-margin} ${-margin} ${wSVG + margin * 2} ${hSVG + margin * 2}"`,
    `  width="${editor.paperConfig.width}mm"`,
    `  height="${editor.paperConfig.height}mm"`,
    `  data-nanquim-paper="true"`,
    `  data-paper-size="${editor.paperConfig.size}"`,
    `  data-paper-scale="${editor.paperConfig.unitsPerCm}">`,
    innerContent,
    `</svg>`,
  ].join('\n')

  return svgString
}

/**
 * Export the paper layout as a standalone SVG file.
 */
async function exportPaperSVG(editor, viewports) {
  const svgString = buildPaperSVGString(editor, viewports)
  if (!svgString) {
    console.error('Paper SVG export: paper canvas not initialized')
    return
  }

  const filename = `paper-${editor.paperConfig.size.toLowerCase()}.svg`
  const blob = new Blob([svgString], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Paper exported as SVG: ${filename}` })
}

/**
 * Export the paper layout as a PDF using jspdf + svg2pdf.js.
 */
async function exportPaperPDF(editor, viewports) {
  // Dynamically import jspdf and svg2pdf to keep the initial bundle smaller
  let jsPDFModule, svg2pdfModule
  try {
    jsPDFModule = await import('jspdf')
    svg2pdfModule = await import('svg2pdf.js')
  } catch (e) {
    editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: 'PDF export requires jspdf and svg2pdf.js. Run: npm install jspdf svg2pdf.js'
    })
    return
  }

  const { jsPDF } = jsPDFModule
  const { svg2pdf } = svg2pdfModule

  const cfg = editor.paperConfig
  const orientation = cfg.orientation === 'landscape' ? 'l' : 'p'

  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: [cfg.width, cfg.height],
  })

  // Build color-mapped SVG element
  const svgString = buildPaperSVGString(editor, viewports)
  if (!svgString) return

  const parser = new DOMParser()
  const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
  const svgEl = svgDoc.documentElement

  try {
    await svg2pdf(svgEl, doc, {
      x: 0,
      y: 0,
      width: cfg.width,
      height: cfg.height,
    })

    const filename = `paper-${cfg.size.toLowerCase()}.pdf`
    doc.save(filename)
    editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Paper exported as PDF: ${filename}` })
  } catch (e) {
    console.error('PDF export error:', e)
    editor.signals.terminalLogged.dispatch({ type: 'span', msg: `PDF export failed: ${e.message}` })
  }
}

export { exportPaperSVG, exportPaperPDF, applyColorMap, buildPaperSVGString }
