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
 * Collect CSS text from all document stylesheets (same-origin and CORS-accessible).
 * Returns a combined CSS string suitable for embedding in a <style> block.
 */
async function collectDocumentCSS() {
  let combined = ''

  for (const sheet of document.styleSheets) {
    try {
      // Same-origin: read rules directly
      const rules = Array.from(sheet.cssRules || [])
      combined += rules.map(r => r.cssText).join('\n') + '\n'
    } catch (_) {
      // Cross-origin: try fetching the raw text (Google Fonts etc.)
      if (sheet.href) {
        try {
          const res = await fetch(sheet.href, { mode: 'cors' })
          if (res.ok) combined += (await res.text()) + '\n'
        } catch (_) { /* ignore inaccessible sheets */ }
      }
    }
  }

  return combined
}

/**
 * Local TTF font files bundled in public/fonts/.
 * jsPDF requires TTF format — woff2 from Google Fonts CDN cannot be used.
 * Each entry maps a font-family name to its local TTF paths (normal + italic).
 */
const LOCAL_TTF_FONTS = {
  'Inter': {
    normal: {
      400: '/fonts/generated/Inter-400.ttf',
      500: '/fonts/generated/Inter-500.ttf',
      600: '/fonts/generated/Inter-600.ttf',
      700: '/fonts/generated/Inter-700.ttf',
    },
    italic: {
      400: '/fonts/generated/Inter-Italic-400.ttf',
      500: '/fonts/generated/Inter-Italic-500.ttf',
      600: '/fonts/generated/Inter-Italic-600.ttf',
      700: '/fonts/generated/Inter-Italic-700.ttf',
    },
  },
  'DM Sans': {
    normal: {
      300: '/fonts/generated/DMSans-300.ttf',
      400: '/fonts/generated/DMSans-400.ttf',
      700: '/fonts/generated/DMSans-700.ttf',
    },
    italic: {
      300: '/fonts/generated/DMSans-Italic-300.ttf',
      400: '/fonts/generated/DMSans-Italic-400.ttf',
      700: '/fonts/generated/DMSans-Italic-700.ttf',
    },
  },
  'JetBrains Mono': {
    normal: {
      400: '/fonts/generated/JetBrainsMono-400.ttf',
      500: '/fonts/generated/JetBrainsMono-500.ttf',
      700: '/fonts/generated/JetBrainsMono-700.ttf',
    },
    italic: {
      400: '/fonts/generated/JetBrainsMono-Italic-400.ttf',
      500: '/fonts/generated/JetBrainsMono-Italic-500.ttf',
      700: '/fonts/generated/JetBrainsMono-Italic-700.ttf',
    },
  },
  'Fira Code': {
    normal: {
      400: '/fonts/generated/FiraCode-400.ttf',
      600: '/fonts/generated/FiraCode-600.ttf',
      700: '/fonts/generated/FiraCode-700.ttf',
    },
  },
}

function normalizeFontWeight(fontWeight) {
  if (fontWeight === undefined || fontWeight === null || fontWeight === '') return 'normal'
  if (typeof fontWeight === 'number') return fontWeight

  const trimmed = String(fontWeight).trim().toLowerCase()
  if (!trimmed) return 'normal'
  if (trimmed === 'regular') return 400
  if (trimmed === 'normal' || trimmed === 'bold') return trimmed

  const numeric = Number.parseInt(trimmed, 10)
  return Number.isNaN(numeric) ? trimmed : numeric
}

function normalizeNumericFontWeight(fontWeight) {
  const normalized = normalizeFontWeight(fontWeight)
  if (typeof normalized === 'number') return normalized
  if (normalized === 'bold') return 700
  return 400
}

function resolveLocalFontPath(local, fontStyle, fontWeight) {
  const styleKey = local[fontStyle] ? fontStyle : 'normal'
  const styleEntry = local[styleKey]
  if (!styleEntry) return null

  if (typeof styleEntry === 'string') return styleEntry

  const targetWeight = normalizeNumericFontWeight(fontWeight)
  const availableWeights = Object.keys(styleEntry)
    .map(Number)
    .filter(weight => !Number.isNaN(weight))
    .sort((a, b) => a - b)

  if (availableWeights.length === 0) return null

  const nearestWeight = availableWeights.reduce((best, current) => {
    if (best === null) return current
    const currentDistance = Math.abs(current - targetWeight)
    const bestDistance = Math.abs(best - targetWeight)
    if (currentDistance !== bestDistance) return currentDistance < bestDistance ? current : best
    return current > best ? current : best
  }, null)

  return styleEntry[nearestWeight] || null
}

function collectUsedFontVariants(svgEl) {
  const variants = new Map()

  const addFamilies = (value) => {
    if (!value) return []
    return value
      .split(',')
      .map(f => f.trim().replace(/['"]/g, ''))
      .filter(Boolean)
  }

  const addVariant = (family, fontStyle, fontWeight) => {
    const normalizedFamily = family?.trim()
    if (!normalizedFamily) return

    const normalizedStyle = (fontStyle || 'normal').trim().toLowerCase()
    const normalizedWeight = normalizeFontWeight(fontWeight)
    const key = `${normalizedFamily}|${normalizedStyle}|${normalizedWeight}`

    if (!variants.has(key)) {
      variants.set(key, {
        family: normalizedFamily,
        fontStyle: normalizedStyle,
        fontWeight: normalizedWeight,
      })
    }
  }

  svgEl.querySelectorAll('text, tspan').forEach(el => {
    const attrStyle = el.getAttribute('font-style')
    const inlineStyle = el.style.fontStyle
    const fontStyle = attrStyle || inlineStyle || 'normal'

    const attrWeight = el.getAttribute('font-weight')
    const inlineWeight = el.style.fontWeight
    const fontWeight = attrWeight || inlineWeight || 'normal'

    const attrFamilies = addFamilies(el.getAttribute('font-family'))
    const inlineFamilies = addFamilies(el.style.fontFamily)
    const families = attrFamilies.length ? attrFamilies : inlineFamilies

    families.forEach(family => addVariant(family, fontStyle, fontWeight))
  })

  return Array.from(variants.values())
}

/**
 * Fetch a font file and convert to base64 for jsPDF registration.
 * Returns null on failure.
 */
async function fetchFontAsBase64(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunk = 1024
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)))
    }
    return btoa(binary)
  } catch (_) {
    return null
  }
}

/**
 * Scan an SVG element for font-family values, then find, fetch, and register
 * each non-builtin font with jsPDF so svg2pdf can render text correctly.
 *
 * Prefers local TTF files (public/fonts/) over CSS @font-face sources, since
 * Google Fonts serves woff2 which jsPDF cannot parse.
 *
 * @param {jsPDF} doc
 * @param {SVGElement} svgEl
 * @param {string} combinedCSS - CSS text from collectDocumentCSS()
 */
async function registerFontsWithJsPDF(doc, svgEl, combinedCSS) {
  const usedVariants = collectUsedFontVariants(svgEl)
  const usedFamilies = new Set(usedVariants.map(variant => variant.family))

  if (usedVariants.length === 0) return

  // Fonts built into jsPDF — no registration needed
  const builtinFonts = new Set([
    'helvetica', 'times', 'courier', 'symbol', 'zapfdingbats',
    'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'inherit', 'initial',
  ])

  const registered = new Set()

  // --- Phase 1: register local TTF fonts ---
  for (const { family, fontStyle, fontWeight } of usedVariants) {
    if (builtinFonts.has(family.toLowerCase())) continue
    const local = LOCAL_TTF_FONTS[family]
    if (!local) continue

    const path = resolveLocalFontPath(local, fontStyle, fontWeight)
    if (!path) continue

    const key = `${family}|${fontStyle}|${fontWeight}`
    if (registered.has(key)) continue

    const base64 = await fetchFontAsBase64(path)
    if (!base64) continue

    registered.add(key)
    const filename = `${family}-${fontWeight}-${fontStyle}.ttf`
    doc.addFileToVFS(filename, base64)
    doc.addFont(filename, family, fontStyle, fontWeight)
  }

  // --- Phase 2: fall back to CSS @font-face for remaining fonts (TTF URLs only) ---
  const fontSources = []

  const parseFontFacesFromCSS = (cssText, baseUrl) => {
    const re = /@font-face\s*\{([^}]+)\}/g
    let m
    while ((m = re.exec(cssText)) !== null) {
      const block = m[1]
      const familyM = block.match(/font-family\s*:\s*['"]?([^;'"]+)['"]?/)
      const srcM = block.match(/url\(["']?([^"')]+)["']?\)/)
      if (!familyM || !srcM) continue
      const family = familyM[1].trim().replace(/['"]/g, '')
      if (!usedFamilies.has(family) || builtinFonts.has(family.toLowerCase())) continue
      // Skip woff2 URLs — jsPDF cannot parse them
      const url = srcM[1]
      if (url.endsWith('.woff2') || url.includes('.woff')) continue
      const weight = (block.match(/font-weight\s*:\s*([^;\n]+)/) || [])[1]?.trim() || 'normal'
      const fontStyle = (block.match(/font-style\s*:\s*([^;\n]+)/) || [])[1]?.trim() || 'normal'
      fontSources.push({ family, url: new URL(url, baseUrl).href, weight, fontStyle })
    }
  }

  parseFontFacesFromCSS(combinedCSS, location.href)

  for (const { family, url, weight, fontStyle } of fontSources) {
    const key = `${family}|${weight}|${fontStyle}`
    if (registered.has(key)) continue
    registered.add(key)
    const base64 = await fetchFontAsBase64(url)
    if (!base64) continue
    const filename = `${family}-${weight}-${fontStyle}.ttf`
    doc.addFileToVFS(filename, base64)
    doc.addFont(filename, family, fontStyle, weight)
  }
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

  // Collect document CSS (for @font-face rules and class-based styles)
  const combinedCSS = await collectDocumentCSS()

  const parser = new DOMParser()
  const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
  const svgEl = svgDoc.documentElement

  // Inject document CSS into the SVG so svg2pdf can resolve class-based styles
  if (combinedCSS) {
    const styleEl = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'style')
    styleEl.textContent = combinedCSS
    svgEl.insertBefore(styleEl, svgEl.firstChild)
  }

  // Register non-builtin fonts with jsPDF so svg2pdf can render them
  await registerFontsWithJsPDF(doc, svgEl, combinedCSS)

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
