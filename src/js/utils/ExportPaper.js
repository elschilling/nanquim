/**
 * ExportPaper.js
 *
 * Export functions for the Paper editor.
 * - exportPaperSVG: Standalone SVG of the paper layout
 * - exportPaperPDF: PDF via jspdf + svg2pdf.js
 */

import { TRANSIENT_NODE_SELECTOR } from '../document/DocumentState'
import { remapSvgIds, rewriteStyleReferences } from './sanitizeSvg'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const SVGJS_NS = 'http://svgjs.com/svgjs'
const PAPER_EXPORT_UI_SELECTOR = [
  '#paper-background',
  '#paper-handlers',
  '.vp-frame',
  '.vp-label',
  TRANSIENT_NODE_SELECTOR,
].join(',')
const TRANSIENT_PRESENTATION_CLASSES = [
  'elementHover',
  'elementSelected',
  'block-edit-active',
  'handlers-editing',
]
const LOCAL_URL_REFERENCE = /url\(\s*(["']?)#([^\s"'()<>[\]{}\\]+)\1\s*\)/gi
const PAPER_PAINT_PROPERTIES = Object.freeze(['stroke', 'fill'])
const PAPER_PAINT_ELEMENTS = new Set([
  'g', 'path', 'line', 'circle', 'ellipse', 'rect', 'text', 'tspan', 'polyline', 'polygon', 'use',
])
const DEFAULT_PAPER_PDF_USE_LIMITS = Object.freeze({
  maxDepth: 32,
  maxExpandedNodes: 100000,
  maxExpandedUses: 4096,
  maxClonedMarkupBytes: 16 * 1024 * 1024,
})

function normalizePaperPaint(value, ctx = document.createElement('canvas').getContext('2d')) {
  if (!ctx || typeof value !== 'string') return null
  const source = value.trim()
  const lower = source.toLowerCase()
  if (
    !source
    || ['none', 'transparent', 'inherit', 'currentcolor', 'context-fill', 'context-stroke'].includes(lower)
    || lower.startsWith('url(')
    || lower.startsWith('var(')
  ) return null

  ctx.fillStyle = '#010203'
  const sentinel = String(ctx.fillStyle).toLowerCase()
  ctx.fillStyle = source
  const normalized = String(ctx.fillStyle).toLowerCase()
  if (normalized === sentinel && lower !== sentinel && lower !== '#010203') return null
  return normalized
}

function normalizedPaperColorMap(colorMap, ctx = document.createElement('canvas').getContext('2d')) {
  const normalized = new Map()
  Object.entries(colorMap || {}).forEach(([source, mapping]) => {
    const key = normalizePaperPaint(source, ctx)
    if (!key || !mapping || mapping.enabled !== true || normalized.has(key)) return
    const printColor = normalizePaperPaint(mapping.printColor, ctx)
    if (printColor) normalized.set(key, printColor)
  })
  return normalized
}

function authoredPaperPaint(element, property) {
  if (!element || element.nodeType !== 1) return ''
  return element.style?.getPropertyValue(property)?.trim()
    || element.getAttribute(property)?.trim()
    || ''
}

function computedPaperStyle(element) {
  const view = element?.ownerDocument?.defaultView
  if (!view?.getComputedStyle) return null
  try {
    return view.getComputedStyle(element)
  } catch (_) {
    return null
  }
}

/**
 * Resolve a concrete live paint without flattening authored paint servers or
 * CSS keywords. Missing presentation attributes are allowed to resolve through
 * class rules, inheritance, and SVG defaults.
 */
function resolvePaperPaint(element, property, ctx, resolvedStyle = undefined) {
  const authored = authoredPaperPaint(element, property)
  if (authored) return normalizePaperPaint(authored, ctx)
  const style = resolvedStyle === undefined ? computedPaperStyle(element) : resolvedStyle
  return normalizePaperPaint(style?.getPropertyValue(property), ctx)
}

function materializeEffectivePaperPaints(sourceRoot, cloneRoot, colorMap, sourceResolver) {
  if (!sourceRoot || !cloneRoot) return cloneRoot
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return cloneRoot
  const mappings = normalizedPaperColorMap(colorMap, ctx)
  if (mappings.size === 0) return cloneRoot

  const pending = [[sourceRoot, cloneRoot]]
  while (pending.length > 0) {
    const [source, clone] = pending.pop()
    if (!source || !clone || source.nodeType !== 1 || clone.nodeType !== 1) continue
    const hidden = source.getAttribute('data-hidden') === 'true'
      || source.getAttribute('data-gn-source') === 'true'
    if (!hidden && PAPER_PAINT_ELEMENTS.has(source.localName.toLowerCase())) {
      const needsComputedStyle = PAPER_PAINT_PROPERTIES.some((property) => (
        !authoredPaperPaint(source, property) || source.hasAttribute(`data-nanquim-orig-${property}`)
      ))
      const resolvedStyle = needsComputedStyle ? computedPaperStyle(source) : null
      PAPER_PAINT_PROPERTIES.forEach((property) => {
        const marker = `data-nanquim-orig-${property}`
        const authored = authoredPaperPaint(source, property)
        // Authored paint servers and keywords must stay semantic. Concrete
        // authored colors are already present on the clone unless a live Paper
        // mapping temporarily replaced them, which is identified by `marker`.
        if (authored && !source.hasAttribute(marker)) return
        const rememberedSource = typeof sourceResolver === 'function'
          ? sourceResolver(source, property)
          : null
        const resolved = normalizePaperPaint(
          rememberedSource || resolvedStyle?.getPropertyValue(property) || authored,
          ctx,
        )
        if (resolved && mappings.has(resolved)) clone.style.setProperty(property, resolved)
      })
    }

    if (hidden) continue
    const sourceChildren = Array.from(source.children)
    const cloneChildren = Array.from(clone.children)
    const count = Math.min(sourceChildren.length, cloneChildren.length)
    for (let index = count - 1; index >= 0; index -= 1) {
      pending.push([sourceChildren[index], cloneChildren[index]])
    }
  }
  return cloneRoot
}

function applyColorMapToRoot(root, colorMap) {
  if (!root || !colorMap || Object.keys(colorMap).length === 0) return root
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) throw new TypeError('Paper color mapping requires browser color parsing support.')
  const mappings = normalizedPaperColorMap(colorMap, ctx)
  if (mappings.size === 0) return root

  ;[root, ...root.querySelectorAll('*')].forEach((element) => {
    for (const property of ['stroke', 'fill']) {
      const attributeValue = element.getAttribute(property)
      const normalizedAttribute = normalizePaperPaint(attributeValue, ctx)
      if (normalizedAttribute && mappings.has(normalizedAttribute)) {
        element.setAttribute(property, mappings.get(normalizedAttribute))
      }

      const inlineValue = element.style?.getPropertyValue(property)
      const normalizedInline = normalizePaperPaint(inlineValue, ctx)
      if (normalizedInline && mappings.has(normalizedInline)) {
        element.style.setProperty(property, mappings.get(normalizedInline))
      }
    }
  })
  return root
}

/**
 * Apply color mapping to an SVG string.
 * Replaces model colors with their print-mapped equivalents.
 */
function applyColorMap(svgString, colorMap) {
  if (!colorMap || Object.keys(colorMap).length === 0) return svgString

  const parser = new DOMParser()
  const doc = parser.parseFromString(
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" xmlns:svgjs="${SVGJS_NS}">${svgString}</svg>`,
    'image/svg+xml',
  )
  if (
    doc.documentElement?.localName === 'parsererror'
    || doc.getElementsByTagName('parsererror').length > 0
  ) {
    throw new TypeError('Paper SVG content could not be parsed for color mapping.')
  }
  
  applyColorMapToRoot(doc.documentElement, colorMap)

  // Return the inner HTML of the temporary wrapper
  return doc.documentElement.innerHTML
}

function cleanExportTree(root) {
  Array.from(root.querySelectorAll(PAPER_EXPORT_UI_SELECTOR)).forEach(node => node.remove())
  ;[root, ...root.querySelectorAll('*')].forEach((element) => {
    TRANSIENT_PRESENTATION_CLASSES.forEach(className => element.classList.remove(className))
    element.removeAttribute('selected')
    if (!element.getAttribute('class')?.trim()) element.removeAttribute('class')
  })
  return root
}

function restoreLiveColorMapping(root) {
  ;[root, ...root.querySelectorAll('*')].forEach((element) => {
    for (const property of ['stroke', 'fill']) {
      const attribute = `data-nanquim-orig-${property}`
      if (!element.hasAttribute(attribute)) continue
      const original = element.getAttribute(attribute) || ''
      if (original) element.style.setProperty(property, original)
      else element.style.removeProperty(property)
      element.removeAttribute(attribute)
    }
    if (!element.getAttribute('style')?.trim()) element.removeAttribute('style')
  })
  return root
}

function rewritePaperIdReferences(root, idMap) {
  if (idMap.size === 0) return root
  ;[root, ...root.querySelectorAll('*')].forEach((element) => {
    if (element.localName.toLowerCase() === 'style') {
      element.textContent = rewriteStyleReferences(element.textContent || '', idMap)
      return
    }
    Array.from(element.attributes).forEach((attribute) => {
      const value = attribute.value
      const localName = attribute.localName.toLowerCase()
      if (localName === 'href' && value.trim().startsWith('#')) {
        const original = value.trim().slice(1)
        const isModelViewportReference = original === 'Collection'
          && element.closest('[data-paper-viewport="true"]')
        if (!isModelViewportReference && idMap.has(original)) {
          attribute.value = `#${idMap.get(original)}`
        }
        return
      }
      if (localName === 'aria-labelledby' || localName === 'aria-describedby') {
        attribute.value = value.split(/\s+/).map(id => idMap.get(id) || id).join(' ')
        return
      }
      if (!/url\s*\(/i.test(value)) return
      LOCAL_URL_REFERENCE.lastIndex = 0
      attribute.value = value.replace(
        LOCAL_URL_REFERENCE,
        (match, quote, id) => idMap.has(id) ? `url(${quote}#${idMap.get(id)}${quote})` : match,
      )
    })
  })
  return root
}

function remapPaperIdCollisions(paperRoot, reservedIds) {
  const modelIds = new Set(reservedIds)
  const paperIds = new Set()
  const collisionMap = new Map()
  let generatedId = 0
  let remapped = 0
  const allocateId = () => {
    let id
    do {
      generatedId += 1
      id = `nanquim-paper-export-${generatedId}`
    } while (reservedIds.has(id) || paperIds.has(id))
    return id
  }

  ;[paperRoot, ...paperRoot.querySelectorAll('[id]')].forEach((element) => {
    const original = element.getAttribute('id')
    if (!original) return
    const duplicateInPaper = paperIds.has(original)
    const collidesWithModel = modelIds.has(original)
    if (!duplicateInPaper && !collidesWithModel) {
      paperIds.add(original)
      reservedIds.add(original)
      return
    }

    const replacement = allocateId()
    element.setAttribute('id', replacement)
    paperIds.add(replacement)
    reservedIds.add(replacement)
    remapped += 1
    // Normal fragment resolution targets the first Paper element with a given
    // id. Only a collision with the already-imported Model tree changes that
    // first owner and therefore requires Paper-local references to be updated.
    if (collidesWithModel && !collisionMap.has(original)) {
      collisionMap.set(original, replacement)
    }
  })

  rewritePaperIdReferences(paperRoot, collisionMap)
  return remapped
}

function localReferenceIds(root) {
  const ids = new Set()
  ;[root, ...root.querySelectorAll('*')].forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const value = attribute.value.trim()
      if (attribute.localName.toLowerCase() === 'href' && value.startsWith('#')) {
        ids.add(value.slice(1))
      }
      LOCAL_URL_REFERENCE.lastIndex = 0
      let match
      while ((match = LOCAL_URL_REFERENCE.exec(value)) !== null) ids.add(match[2])
    })
    if (element.localName.toLowerCase() === 'style') {
      LOCAL_URL_REFERENCE.lastIndex = 0
      let match
      while ((match = LOCAL_URL_REFERENCE.exec(element.textContent || '')) !== null) ids.add(match[2])
    }
  })
  return ids
}

function ownsDefinitionId(root, id) {
  if (root.getAttribute('id') === id) return true
  return Array.from(root.querySelectorAll('[id]')).some(element => element.getAttribute('id') === id)
}

function isPersistentDefinition(root) {
  if (root.getAttribute('data-nanquim-root-semantics') === 'true') return false
  return root.localName.toLowerCase() === 'style'
    || root.getAttribute('data-nanquim-import-assets') === 'true'
    || root.getAttribute('data-block-def') === 'true'
    || root.getAttribute('data-nanquim-document-def') === 'true'
}

function getPaperModelDefinitionSources(editor, drawingRoot = editor?.drawing?.node) {
  const svg = editor.svg?.node
  if (!svg || !drawingRoot) return []
  const sourceDefinitions = Array.from(svg.children)
    .filter(element => element.namespaceURI === SVG_NS && element.localName.toLowerCase() === 'defs')
    .flatMap(defs => Array.from(defs.children))
  const selected = new Set(sourceDefinitions.filter(isPersistentDefinition))
  const pendingIds = [...localReferenceIds(drawingRoot)]
  selected.forEach(definition => {
    localReferenceIds(definition).forEach(reference => pendingIds.push(reference))
  })
  const visitedIds = new Set()

  while (pendingIds.length > 0) {
    const id = pendingIds.pop()
    if (!id || visitedIds.has(id)) continue
    visitedIds.add(id)
    const owner = sourceDefinitions.find(definition => ownsDefinitionId(definition, id))
    if (!owner || owner.getAttribute('data-nanquim-root-semantics') === 'true') continue
    if (!selected.has(owner)) {
      selected.add(owner)
      localReferenceIds(owner).forEach(reference => pendingIds.push(reference))
    }
  }

  return sourceDefinitions.filter(source => selected.has(source))
}

function appendModelDefinitions(editor, outputDefs, targetDocument) {
  const sourceResolver = editor.paperEditor?.getLivePaintSource
  getPaperModelDefinitionSources(editor).forEach((source) => {
    const clone = targetDocument.importNode(source, true)
    materializeEffectivePaperPaints(
      source,
      clone,
      editor.paperConfig.colorMap,
      sourceResolver,
    )
    outputDefs.appendChild(cleanExportTree(clone))
  })
}

function createPaperExportDocument(editor) {
  const parser = new DOMParser()
  const output = parser.parseFromString(
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" xmlns:svgjs="${SVGJS_NS}"/>`,
    'image/svg+xml',
  )
  if (output.querySelector('parsererror')) {
    throw new TypeError('Paper SVG output could not be initialized.')
  }
  const root = output.documentElement
  const { wSVG, hSVG } = editor.paperEditor.getPaperDimsSVG()
  root.setAttribute('viewBox', `0 0 ${wSVG} ${hSVG}`)
  root.setAttribute('width', `${editor.paperConfig.width}mm`)
  root.setAttribute('height', `${editor.paperConfig.height}mm`)
  root.setAttribute('data-nanquim-paper', 'true')
  root.setAttribute('data-paper-size', editor.paperConfig.size)
  root.setAttribute('data-paper-scale', String(editor.paperConfig.unitsPerCm))

  const drawingClone = output.importNode(editor.drawing.node, true)
  restoreLiveColorMapping(drawingClone)
  materializeEffectivePaperPaints(
    editor.drawing.node,
    drawingClone,
    editor.paperConfig.colorMap,
    editor.paperEditor?.getLivePaintSource,
  )
  cleanExportTree(drawingClone)
  const modelDefinitions = output.createElementNS(SVG_NS, 'defs')
  appendModelDefinitions(editor, modelDefinitions, output)
  modelDefinitions.appendChild(drawingClone)
  root.appendChild(modelDefinitions)

  const paperClone = cleanExportTree(output.importNode(editor.paperSvg.node, true))
  const reservedIds = new Set(Array.from(root.querySelectorAll('[id]'), element => element.id))
  remapPaperIdCollisions(paperClone, reservedIds)
  Array.from(paperClone.childNodes).forEach(child => root.appendChild(child))
  applyColorMapToRoot(root, editor.paperConfig.colorMap)
  return output
}

/**
 * Build a standalone SVG string of the paper layout.
 */
function buildPaperSVGString(editor, viewports) {
  if (!editor.paperSvg) return null
  const output = createPaperExportDocument(editor)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(output.documentElement)}`
}

/**
 * Replace Paper viewport <use> references with inline model clones before
 * passing the document to svg2pdf.
 *
 * svg2pdf renders a <use> target through a PDF Form XObject whose /BBox is
 * derived before the referenced element's inherited styles are applied. A
 * stroke-only horizontal or vertical <line> can therefore be omitted from the
 * calculated bounds and clipped out of an otherwise valid PDF. Rendering the
 * same target inline keeps the viewport clip-path and transform while avoiding
 * that implicit Form XObject clip.
 */
function expandPaperViewportUsesForPDF(svgEl, options = {}) {
  const doc = svgEl?.ownerDocument
  if (!doc) return 0

  const boundedLimit = (name) => {
    const value = options[name] ?? DEFAULT_PAPER_PDF_USE_LIMITS[name]
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Paper PDF ${name} must be a positive safe integer.`)
    }
    return value
  }
  const limits = {
    maxDepth: boundedLimit('maxDepth'),
    maxExpandedNodes: boundedLimit('maxExpandedNodes'),
    maxExpandedUses: boundedLimit('maxExpandedUses'),
    maxClonedMarkupBytes: boundedLimit('maxClonedMarkupBytes'),
  }
  let expanded = 0
  let expandedNodes = 0
  let clonedMarkupBytes = 0
  let generatedId = 0
  const provenance = new WeakMap()
  const reservedIds = new Set(Array.from(svgEl.querySelectorAll('[id]'), element => element.id))
  const allocateId = () => {
    let id
    do {
      generatedId += 1
      id = `nanquim-paper-pdf-${expanded + 1}-${generatedId}`
    } while (reservedIds.has(id))
    reservedIds.add(id)
    return id
  }
  const rememberProvenance = (source, clone) => {
    if (!source || !clone || source.nodeType !== 1 || clone.nodeType !== 1) return
    provenance.set(clone, provenance.get(source) || source)
    const sourceChildren = Array.from(source.children)
    const cloneChildren = Array.from(clone.children)
    const count = Math.min(sourceChildren.length, cloneChildren.length)
    for (let index = 0; index < count; index += 1) {
      rememberProvenance(sourceChildren[index], cloneChildren[index])
    }
  }
  const cloneReference = (referenced) => {
    if (referenced.localName.toLowerCase() !== 'symbol') {
      const clone = referenced.cloneNode(true)
      rememberProvenance(referenced, clone)
      return clone
    }
    const clone = doc.createElementNS(SVG_NS, 'svg')
    Array.from(referenced.attributes).forEach(attribute => (
      clone.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value)
    ))
    Array.from(referenced.childNodes).forEach(child => clone.appendChild(child.cloneNode(true)))
    rememberProvenance(referenced, clone)
    return clone
  }
  const markupBytes = (root) => {
    if (!root) return 0
    let bytes = 0
    const pending = [root]
    while (pending.length > 0) {
      const node = pending.pop()
      if (node.nodeType === 3) {
        bytes += node.data.length * 2
        continue
      }
      if (node.nodeType !== 1) continue
      bytes += node.localName.length * 2
      Array.from(node.attributes).forEach((attribute) => {
        bytes += (attribute.name.length + attribute.value.length) * 2
      })
      Array.from(node.childNodes).forEach(child => pending.push(child))
    }
    return bytes
  }

  const expandUse = (use, ancestors, depth) => {
    if (!svgEl.contains(use)) return
    if (depth > limits.maxDepth) {
      throw new TypeError(`Paper PDF nested use depth exceeds ${limits.maxDepth}.`)
    }
    if (expanded >= limits.maxExpandedUses) {
      throw new TypeError(`Paper PDF use expansion exceeds ${limits.maxExpandedUses} references.`)
    }
    const href = use.getAttribute('href') || use.getAttribute('xlink:href')
    if (!href || !href.startsWith('#')) return

    const referenced = doc.getElementById(href.slice(1))
    if (!referenced) return
    const sourceIdentity = provenance.get(referenced) || referenced
    if (ancestors.has(sourceIdentity)) {
      throw new TypeError(`Paper PDF contains a cyclic local use reference at ${href}.`)
    }

    const wrapper = doc.createElementNS(SVG_NS, 'g')
    Array.from(use.attributes).forEach((attr) => {
      if (attr.localName === 'href' || attr.localName === 'x' || attr.localName === 'y' || attr.localName === 'width' || attr.localName === 'height') return
      wrapper.setAttributeNS(attr.namespaceURI, attr.name, attr.value)
    })

    const x = Number.parseFloat(use.getAttribute('x') || '0')
    const y = Number.parseFloat(use.getAttribute('y') || '0')
    if (x || y) {
      const transform = wrapper.getAttribute('transform')
      wrapper.setAttribute('transform', `${transform ? `${transform} ` : ''}translate(${x} ${y})`)
    }

    wrapper.setAttribute('data-paper-pdf-expanded-use', href.slice(1))
    const externalStyles = Array.from(svgEl.querySelectorAll('style')).filter(style => (
      !referenced.contains(style) && style.textContent?.includes(href)
    ))
    const nextMarkupBytes = markupBytes(referenced)
      + externalStyles.reduce((total, style) => total + markupBytes(style), 0)
    if (clonedMarkupBytes + nextMarkupBytes > limits.maxClonedMarkupBytes) {
      throw new TypeError(
        `Paper PDF use expansion exceeds ${limits.maxClonedMarkupBytes} cloned markup bytes.`,
      )
    }
    clonedMarkupBytes += nextMarkupBytes

    const clone = cloneReference(referenced)
    if (['svg', 'symbol'].includes(referenced.localName.toLowerCase())) {
      for (const property of ['width', 'height']) {
        if (use.hasAttribute(property)) clone.setAttribute(property, use.getAttribute(property))
      }
    }
    externalStyles.forEach((style) => {
      clone.insertBefore(style.cloneNode(true), clone.firstChild)
    })
    const cloneNodes = 1 + clone.querySelectorAll('*').length
    if (expandedNodes + cloneNodes > limits.maxExpandedNodes) {
      throw new TypeError(`Paper PDF use expansion exceeds ${limits.maxExpandedNodes} cloned nodes.`)
    }
    expandedNodes += cloneNodes
    remapSvgIds([clone], allocateId)
    wrapper.appendChild(clone)
    use.replaceWith(wrapper)
    expanded++

    const nextAncestors = new Set(ancestors)
    nextAncestors.add(sourceIdentity)
    Array.from(wrapper.querySelectorAll('use')).forEach(nested => (
      expandUse(nested, nextAncestors, depth + 1)
    ))
  }

  Array.from(svgEl.querySelectorAll('[data-paper-viewport="true"] use')).forEach(use => (
    expandUse(use, new Set(), 0)
  ))

  return expanded
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
      // Cross-origin: try fetching the raw stylesheet when CORS permits it.
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
 * Local TTF font files bundled in public/fonts/generated/.
 * jsPDF requires TTF font data rather than browser-only remote stylesheets.
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

function fontVariantKey(family, fontStyle, fontWeight) {
  const normalizedFamily = String(family || '').trim().toLowerCase()
  const normalizedStyle = String(fontStyle || 'normal').trim().toLowerCase()
  const normalizedWeight = normalizeNumericFontWeight(fontWeight)
  return `${normalizedFamily}|${normalizedStyle}|${normalizedWeight}`
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

function fontStyleRules(cssText) {
  const rules = []
  const source = String(cssText || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@font-face\s*\{[^}]*\}/gi, '')
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = rulePattern.exec(source)) !== null) {
    const selectors = match[1]
      .split(',')
      .map(selector => selector.trim())
      .filter(selector => selector && !selector.startsWith('@'))
    if (selectors.length === 0) continue
    const block = match[2]
    const declaration = name => block.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i'))?.[1].trim()
    const family = declaration('font-family')
    const fontStyle = declaration('font-style')
    const fontWeight = declaration('font-weight')
    if (family || fontStyle || fontWeight) rules.push({ selectors, family, fontStyle, fontWeight })
  }
  return rules
}

function collectUsedFontVariants(svgEl, combinedCSS = '', { materialize = false } = {}) {
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

  const embeddedCSS = Array.from(svgEl.querySelectorAll('style'), style => style.textContent || '').join('\n')
  const rules = fontStyleRules(`${combinedCSS}\n${embeddedCSS}`)
  svgEl.querySelectorAll('text, tspan').forEach(el => {
    const ancestry = []
    let current = el
    while (current?.nodeType === 1) {
      ancestry.unshift(current)
      if (current === svgEl) break
      current = current.parentElement
    }

    const effective = { family: null, fontStyle: 'normal', fontWeight: 'normal' }
    ancestry.forEach((element) => {
      rules.forEach((rule) => {
        let matches = false
        try {
          matches = rule.selectors.some(selector => element.matches(selector))
        } catch (_error) {
          matches = false
        }
        if (!matches) return
        if (rule.family) effective.family = rule.family
        if (rule.fontStyle) effective.fontStyle = rule.fontStyle
        if (rule.fontWeight) effective.fontWeight = rule.fontWeight
      })
      const attrFamily = element.getAttribute('font-family')
      const inlineFamily = element.style?.fontFamily
      if (attrFamily || inlineFamily) effective.family = attrFamily || inlineFamily
      effective.fontStyle = element.getAttribute('font-style') || element.style?.fontStyle || effective.fontStyle
      effective.fontWeight = element.getAttribute('font-weight') || element.style?.fontWeight || effective.fontWeight
    })

    if (materialize && effective.family) {
      el.setAttribute('font-family', effective.family)
      el.setAttribute('font-style', effective.fontStyle)
      el.setAttribute('font-weight', effective.fontWeight)
    }
    addFamilies(effective.family).forEach(family => (
      addVariant(family, effective.fontStyle, effective.fontWeight)
    ))
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
 * Prefers the bundled local TTF files over CSS @font-face sources so browser
 * rendering and PDF embedding resolve the same project-controlled variants.
 *
 * @param {jsPDF} doc
 * @param {SVGElement} svgEl
 * @param {string} combinedCSS - CSS text from collectDocumentCSS()
 */
async function registerFontsWithJsPDF(doc, svgEl, combinedCSS) {
  const usedVariants = collectUsedFontVariants(svgEl, combinedCSS, { materialize: true })
  const usedFamilies = new Set(usedVariants.map(variant => variant.family))
  const usedVariantKeys = new Set(usedVariants.map(
    ({ family, fontStyle, fontWeight }) => fontVariantKey(family, fontStyle, fontWeight),
  ))

  // Fonts built into jsPDF — no registration needed
  const builtinFonts = new Set([
    'helvetica', 'times', 'courier', 'symbol', 'zapfdingbats',
    'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'inherit', 'initial',
  ])

  const registered = new Set()
  const requestedKeys = new Set(usedVariants
    .filter(({ family }) => !builtinFonts.has(family.toLowerCase()))
    .map(({ family, fontStyle, fontWeight }) => fontVariantKey(family, fontStyle, fontWeight)))

  if (requestedKeys.size === 0) {
    return Object.freeze({ requested: 0, registered: 0, fallback: 0 })
  }

  // --- Phase 1: register local TTF fonts ---
  for (const { family, fontStyle, fontWeight } of usedVariants) {
    if (builtinFonts.has(family.toLowerCase())) continue
    const local = LOCAL_TTF_FONTS[family]
    if (!local) continue

    const path = resolveLocalFontPath(local, fontStyle, fontWeight)
    if (!path) continue

    const key = fontVariantKey(family, fontStyle, fontWeight)
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
      // Bundled families are resolved from LOCAL_TTF_FONTS above. Re-reading
      // their @font-face rules would fetch and register every declared variant.
      if (LOCAL_TTF_FONTS[family]) continue
      // Skip woff2 URLs — jsPDF cannot parse them
      const url = srcM[1]
      if (url.endsWith('.woff2') || url.includes('.woff')) continue
      const weight = (block.match(/font-weight\s*:\s*([^;\n]+)/) || [])[1]?.trim() || 'normal'
      const fontStyle = (block.match(/font-style\s*:\s*([^;\n]+)/) || [])[1]?.trim() || 'normal'
      const key = fontVariantKey(family, fontStyle, weight)
      if (!usedVariantKeys.has(key)) continue
      fontSources.push({ family, url: new URL(url, baseUrl).href, weight, fontStyle, key })
    }
  }

  parseFontFacesFromCSS(combinedCSS, location.href)

  for (const { family, url, weight, fontStyle, key } of fontSources) {
    if (registered.has(key)) continue
    const base64 = await fetchFontAsBase64(url)
    if (!base64) continue
    registered.add(key)
    const filename = `${family}-${weight}-${fontStyle}.ttf`
    doc.addFileToVFS(filename, base64)
    doc.addFont(filename, family, fontStyle, weight)
  }

  return Object.freeze({
    requested: requestedKeys.size,
    registered: registered.size,
    fallback: Array.from(requestedKeys).filter(key => !registered.has(key)).length,
  })
}

function logPaperExport(editor, message) {
  try {
    editor.signals.terminalLogged.dispatch({ type: 'span', msg: message })
  } catch (error) {
    try { console.error('[ExportPaper] A terminal listener failed:', error) } catch (_reportError) {}
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
    logPaperExport(editor, 'PDF export is unavailable because its local renderer could not be loaded.')
    return
  }

  const { jsPDF } = jsPDFModule
  const { svg2pdf } = svg2pdfModule

  try {
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

    // Avoid svg2pdf's implicit Form XObject bounds clipping stroke-only line
    // geometry from viewport references.
    expandPaperViewportUsesForPDF(svgEl)

    // Resolve inherited/class-based font properties onto the detached SVG and
    // register only the variants its text actually uses. Injecting the entire
    // application stylesheet makes svg2pdf match thousands of unrelated UI
    // selectors and can turn a small Paper export into unbounded work.
    const fontResult = await registerFontsWithJsPDF(doc, svgEl, combinedCSS)
    if (fontResult.fallback > 0) {
      const noun = fontResult.fallback === 1 ? 'font variant was' : 'font variants were'
      logPaperExport(
        editor,
        `${fontResult.fallback} PDF ${noun} unavailable; renderer fallback will be used.`,
      )
    }

    await svg2pdf(svgEl, doc, {
      x: 0,
      y: 0,
      width: cfg.width,
      height: cfg.height,
    })

    const filename = `paper-${cfg.size.toLowerCase()}.pdf`
    doc.save(filename)
    logPaperExport(editor, `Paper exported as PDF: ${filename}`)
  } catch (e) {
    console.error('PDF export error:', e)
    logPaperExport(editor, `PDF export failed: ${e.message}`)
  }
}

export {
  exportPaperSVG,
  exportPaperPDF,
  applyColorMap,
  buildPaperSVGString,
  expandPaperViewportUsesForPDF,
  getPaperModelDefinitionSources,
  normalizePaperPaint,
  normalizedPaperColorMap,
  resolvePaperPaint,
  registerFontsWithJsPDF,
}
