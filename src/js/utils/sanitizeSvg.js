import {
  MAX_SVG_GEOMETRY_MAGNITUDE,
  sanitizeGeometryCssValue,
  sanitizeSvgNumericGeometry,
} from './svgNumericBounds.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'

// Keep this list deliberately smaller than the SVG specification. In
// particular, executable content, foreign HTML, SMIL animation, external
// resources and filter primitives do not belong in an editable CAD drawing.
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath',
  'lineargradient', 'radialgradient', 'stop',
  'pattern', 'clippath', 'mask', 'marker',
  'image', 'a', 'view',
  'style', 'title', 'desc', 'metadata',
])

const DROP_WITH_CONTENT = new Set([
  'script', 'foreignobject', 'iframe', 'object', 'embed',
  'audio', 'video', 'canvas',
  'animate', 'animatemotion', 'animatetransform', 'set', 'mpath',
])

const ALLOWED_ATTRIBUTES = new Set([
  'id', 'class', 'name', 'role', 'lang',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy',
  'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr', 'width', 'height',
  'd', 'points', 'pathlength', 'viewbox', 'preserveaspectratio',
  'transform', 'transform-origin', 'transform-box',
  'textlength', 'lengthadjust', 'rotate', 'startoffset', 'method', 'spacing', 'side',
  'refx', 'refy', 'markerwidth', 'markerheight', 'markerunits', 'orient',
  'patternunits', 'patterncontentunits', 'patterntransform',
  'gradientunits', 'gradienttransform', 'spreadmethod', 'offset',
  'clippathunits', 'maskunits', 'maskcontentunits',
  'href',
  'style',
  'alignment-baseline', 'baseline-shift', 'clip', 'clip-path', 'clip-rule',
  'color', 'color-interpolation', 'color-rendering',
  'direction', 'display', 'dominant-baseline',
  'fill', 'fill-opacity', 'fill-rule',
  'flood-color', 'flood-opacity',
  'font-family', 'font-size', 'font-size-adjust', 'font-stretch',
  'font-style', 'font-variant', 'font-weight',
  'image-rendering', 'letter-spacing', 'lighting-color',
  'marker', 'marker-start', 'marker-mid', 'marker-end', 'mask', 'mask-type',
  'opacity', 'overflow', 'paint-order', 'pointer-events',
  'shape-rendering', 'stop-color', 'stop-opacity',
  'stroke', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'stroke-width',
  'text-anchor', 'text-decoration', 'text-rendering',
  'unicode-bidi', 'vector-effect', 'visibility', 'white-space',
  'word-spacing', 'writing-mode',
])

const CSS_PROPERTIES = new Set([
  'alignment-baseline', 'baseline-shift', 'clip', 'clip-path', 'clip-rule',
  'color', 'color-interpolation', 'color-rendering',
  'direction', 'display', 'dominant-baseline',
  'fill', 'fill-opacity', 'fill-rule',
  'flood-color', 'flood-opacity',
  'font-family', 'font-size', 'font-size-adjust', 'font-stretch',
  'font-style', 'font-variant', 'font-weight',
  'image-rendering', 'letter-spacing', 'lighting-color',
  'marker', 'marker-start', 'marker-mid', 'marker-end', 'mask', 'mask-type',
  'opacity', 'overflow', 'paint-order', 'pointer-events',
  'shape-rendering', 'stop-color', 'stop-opacity',
  'stroke', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'stroke-width',
  'text-anchor', 'text-decoration', 'text-rendering',
  'transform', 'transform-box', 'transform-origin',
  'unicode-bidi', 'vector-effect', 'visibility', 'white-space',
  'word-spacing', 'writing-mode',
])

const CSS_URL_ATTRIBUTES = new Set([
  'clip', 'clip-path', 'fill', 'marker', 'marker-start', 'marker-mid',
  'marker-end', 'mask', 'stroke',
])

const DANGEROUS_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const LOCAL_REFERENCE = /^#[^\s"'()<>[\]{}\\]+$/
const SAFE_RASTER_DATA = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/]+={0,2}$/i

/**
 * Apply a conservative element bound before DOMParser materializes an
 * untrusted SVG. XML names may start with non-ASCII characters, so an ASCII
 * tag-name regex is not a safe counting boundary. Comments, CDATA and
 * processing instructions are skipped as complete lexical sections; every
 * other non-closing markup opener counts as a possible start tag. Unsupported
 * declarations fail closed (DOCTYPE is rejected by callers as well).
 */
function markupFitsSvgElementBudget(source, maxElements) {
  if (typeof source !== 'string' || !Number.isFinite(maxElements) || maxElements < 1) return false

  let count = 0
  let cursor = 0
  while (cursor < source.length) {
    const open = source.indexOf('<', cursor)
    if (open < 0) break

    if (source.startsWith('<!--', open)) {
      const close = source.indexOf('-->', open + 4)
      if (close < 0) return false
      cursor = close + 3
      continue
    }
    if (source.startsWith('<![CDATA[', open)) {
      const close = source.indexOf(']]>', open + 9)
      if (close < 0) return false
      cursor = close + 3
      continue
    }
    if (source.startsWith('<?', open)) {
      const close = source.indexOf('?>', open + 2)
      if (close < 0) return false
      cursor = close + 2
      continue
    }

    const marker = source[open + 1]
    if (marker === '/') {
      cursor = open + 2
      continue
    }
    if (!marker || marker === '!') return false

    count += 1
    if (count > maxElements) return false
    cursor = open + 1
  }

  return true
}

function splitCssTopLevel(value, delimiter) {
  const chunks = []
  let start = 0
  let quote = null
  let depth = 0

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1)
    else if (char === delimiter && depth === 0) {
      chunks.push(value.slice(start, index))
      start = index + 1
    }
  }
  chunks.push(value.slice(start))
  return chunks
}

function findCssColon(declaration) {
  let quote = null
  let depth = 0
  for (let index = 0; index < declaration.length; index += 1) {
    const char = declaration[index]
    if (quote) {
      if (char === quote && declaration[index - 1] !== '\\') quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1)
    else if (char === ':' && depth === 0) return index
  }
  return -1
}

function sanitizeCssValue(rawValue) {
  const value = String(rawValue).trim()
  if (!value || value.length > 100000) return null

  // CSS escapes and comments can conceal dangerous function and URL names.
  // Comments have already been removed from stylesheet blocks; rejecting both
  // here also covers inline declarations.
  if (/[\\{}<>]/.test(value) || /\/\*/.test(value)) return null
  if (/(?:javascript|vbscript|data|https?|ftp|file|blob|filesystem)\s*:|(?:^|[\s("'])\/\/|expression\s*\(|@import|(?:^|[-])behavior\s*:|-moz-binding/i.test(value)) return null
  if (/(?:-webkit-)?image-set\s*\(|cross-fade\s*\(|(?:^|[^-])image\s*\(|paint\s*\(/i.test(value)) return null

  let urlCount = 0
  const urlPattern = /url\s*\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/gi
  let match
  while ((match = urlPattern.exec(value))) {
    urlCount += 1
    const target = String(match[2] ?? match[3] ?? '').trim()
    if (!LOCAL_REFERENCE.test(target)) return null
  }

  const apparentUrls = value.match(/url\s*\(/gi)
  if ((apparentUrls ? apparentUrls.length : 0) !== urlCount) return null
  return value
}

function sanitizeStyleDeclarationsDetailed(cssText, options = {}) {
  const source = String(cssText)
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const declarations = []
  let filtered = withoutComments !== source

  splitCssTopLevel(withoutComments, ';').forEach((candidate) => {
    if (!candidate.trim()) return
    const colon = findCssColon(candidate)
    if (colon < 1) {
      filtered = true
      return
    }
    const property = candidate.slice(0, colon).trim().toLowerCase()
    if (!CSS_PROPERTIES.has(property) && !/^--[a-z0-9_-]{1,64}$/i.test(property)) {
      filtered = true
      return
    }
    if ((property === 'transform' || property === 'transform-origin') && options.allowTransform !== true) {
      filtered = true
      return
    }
    const safeCssValue = sanitizeCssValue(candidate.slice(colon + 1))
    const value = safeCssValue === null
      ? null
      : sanitizeGeometryCssValue(property, safeCssValue)
    if (value === null) {
      filtered = true
      return
    }
    declarations.push(`${property}:${value}`)
  })

  return { value: declarations.join(';'), filtered }
}

function sanitizeStyleDeclarations(cssText) {
  return sanitizeStyleDeclarationsDetailed(cssText, { allowTransform: true }).value
}

function scopeSelector(selector, scope, stylesheetRoot = scope) {
  const trimmed = selector.trim()
  if (!trimmed || trimmed.length > 2000) return null
  if (/[{};@\\<\x00-\x1f]/.test(trimmed)) return null
  if (/^[+~]/.test(trimmed)) return null
  if (scope === null) return trimmed

  // Styles authored against the standalone SVG root should target Nanquim's
  // drawing group after import. Every other selector is forced to be a
  // descendant of that group, preventing an imported stylesheet from changing
  // the terminal, panels, paper canvas, overlays or other host UI.
  if (/^(?:svg|:root)$/i.test(trimmed)) return stylesheetRoot
  const rooted = trimmed.match(/^(svg|:root)(?=\s+|\s*>)/i)
  if (rooted) {
    const rest = trimmed.slice(rooted[1].length)
    if (/^\s*[+~]/.test(rest)) return null
    return `${stylesheetRoot}${rest}`
  }

  // Native files can already contain the scope emitted by a previous open.
  // Treat it as another spelling of the standalone SVG root so reopening a
  // drawing is idempotent instead of producing `#Collection #Collection ...`.
  // The replacement still uses stylesheetRoot, keeping spoofed foreign input
  // inside its dedicated import wrapper. Collapse repeated legacy prefixes as
  // well, since older reopen cycles may already have accumulated more than one.
  if (scope === '#Collection' && /^#Collection(?=$|\s+|\s*>)/.test(trimmed)) {
    let rest = trimmed.slice('#Collection'.length)
    let repeatedRoot = rest.match(/^\s+#Collection(?=$|\s+|\s*>)/)
    while (repeatedRoot) {
      rest = rest.slice(repeatedRoot[0].length)
      repeatedRoot = rest.match(/^\s+#Collection(?=$|\s+|\s*>)/)
    }
    if (/^\s*[+~]/.test(rest)) return null
    return `${stylesheetRoot}${rest}`
  }
  return `${scope} ${trimmed}`
}

function sanitizeStyleSheetDetailed(cssText, scope = '#Collection', stylesheetRoot = scope) {
  const source = String(cssText)
  let filtered = /\/\*[\s\S]*?\*\//.test(source)
  let removedStatementRule = false
  const css = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Remove statement-form at-rules independently so a leading @import does
    // not cause the following ordinary (and otherwise safe) rule to be lost.
    .replace(/@(import|charset|namespace)\b[\s\S]*?;/gi, () => {
      removedStatementRule = true
      return ''
    })
  filtered ||= removedStatementRule
  const rules = []
  let cursor = 0

  while (cursor < css.length) {
    const open = css.indexOf('{', cursor)
    if (open < 0) break
    const close = css.indexOf('}', open + 1)
    if (close < 0) break
    const prelude = css.slice(cursor, open).trim()
    const body = css.slice(open + 1, close)
    cursor = close + 1

    // Nested blocks and at-rules (including @import and @font-face) are not
    // needed for technical SVG styling and substantially widen the attack
    // surface, so discard the complete rule.
    if (!prelude || prelude.startsWith('@') || /[{}]/.test(body)) {
      filtered = true
      continue
    }
    const declarationResult = sanitizeStyleDeclarationsDetailed(body)
    filtered ||= declarationResult.filtered
    const declarations = declarationResult.value
    if (!declarations) {
      filtered = true
      continue
    }

    const selectorCandidates = splitCssTopLevel(prelude, ',')
    const selectors = selectorCandidates
      .map((selector) => scopeSelector(selector, scope, stylesheetRoot))
      .filter(Boolean)
    if (selectors.length !== selectorCandidates.length) filtered = true
    if (selectors.length > 0) rules.push(`${selectors.join(',')}{${declarations}}`)
  }

  if (css.slice(cursor).trim()) filtered = true
  return { value: rules.join('\n'), filtered }
}

function sanitizeStyleSheet(cssText, scope = '#Collection', stylesheetRoot = scope) {
  return sanitizeStyleSheetDetailed(cssText, scope, stylesheetRoot).value
}

function sanitizeHref(rawValue, elementName) {
  const value = String(rawValue).trim()
  if (LOCAL_REFERENCE.test(value)) return value
  if (elementName !== 'image' || value.length > 12 * 1024 * 1024) return null
  return SAFE_RASTER_DATA.test(value) ? value : null
}

function safeNamespaceAttribute(attribute, element) {
  if (attribute.namespaceURI === XMLNS_NS || attribute.name === 'xmlns') {
    if (attribute.name === 'xmlns') return element.localName.toLowerCase() === 'svg' && attribute.value === SVG_NS
    if (attribute.localName === 'xlink') return attribute.value === XLINK_NS
    if (attribute.localName === 'svgjs') return attribute.value === 'http://svgjs.com/svgjs'
    return false
  }
  if (attribute.namespaceURI === XML_NS) return attribute.localName === 'space' || attribute.localName === 'lang'
  if (attribute.namespaceURI === XLINK_NS) return attribute.localName.toLowerCase() === 'href'
  return !attribute.namespaceURI
}

function markSanitized(state) {
  state.changed = true
  state.mutations += 1
}

function sanitizeAttributes(element, state) {
  const elementName = element.localName.toLowerCase()
  Array.from(element.attributes).forEach((attribute) => {
    const localName = attribute.localName.toLowerCase()
    const qualifiedName = attribute.name.toLowerCase()
    const isData = qualifiedName.startsWith('data-')
    const isAria = qualifiedName.startsWith('aria-')

    if (!safeNamespaceAttribute(attribute, element)) {
      element.removeAttributeNode(attribute)
      markSanitized(state)
      return
    }
    if (localName.startsWith('on') || qualifiedName.startsWith('on')) {
      element.removeAttributeNode(attribute)
      markSanitized(state)
      return
    }
    if (isData && qualifiedName.split(/[-:]/).some((part) => DANGEROUS_JSON_KEYS.has(part))) {
      element.removeAttributeNode(attribute)
      markSanitized(state)
      return
    }
    if (!isData && !isAria && !ALLOWED_ATTRIBUTES.has(localName) && attribute.namespaceURI !== XMLNS_NS && attribute.namespaceURI !== XML_NS) {
      element.removeAttributeNode(attribute)
      markSanitized(state)
      return
    }
    if (attribute.value.length > 4 * 1024 * 1024 && localName !== 'href') {
      element.removeAttributeNode(attribute)
      markSanitized(state)
      return
    }

    if (localName === 'href') {
      const safeHref = sanitizeHref(attribute.value, elementName)
      if (safeHref === null) {
        element.removeAttributeNode(attribute)
        markSanitized(state)
      }
      else attribute.value = safeHref
      return
    }
    if (localName === 'style') {
      const result = sanitizeStyleDeclarationsDetailed(attribute.value, { allowTransform: true })
      if (result.value) attribute.value = result.value
      else element.removeAttributeNode(attribute)
      if (result.filtered || !result.value) markSanitized(state)
      return
    }
    if (CSS_URL_ATTRIBUTES.has(localName)) {
      const safeValue = sanitizeCssValue(attribute.value)
      if (safeValue === null) {
        element.removeAttributeNode(attribute)
        markSanitized(state)
      }
      else attribute.value = safeValue
    }
  })
}

function sanitizeElement(element, options, state, depth) {
  state.elements += 1
  if (state.elements > options.maxElements) {
    throw new RangeError('The SVG contains too many elements to import safely.')
  }
  if (depth > options.maxDepth) {
    throw new RangeError('The SVG element tree is too deeply nested to import safely.')
  }

  const name = element.localName.toLowerCase()
  if (element.namespaceURI !== SVG_NS || DROP_WITH_CONTENT.has(name) || !ALLOWED_ELEMENTS.has(name)) {
    element.remove()
    markSanitized(state)
    return
  }

  sanitizeAttributes(element, state)

  if (name === 'style') {
    const result = sanitizeStyleSheetDetailed(
      element.textContent,
      options.deferStyleScoping ? null : options.scopeSelector,
      options.deferStyleScoping ? null : options.stylesheetRootSelector,
    )
    if (!result.value) element.remove()
    else element.textContent = result.value
    if (result.filtered || !result.value) markSanitized(state)
    return
  }
  if (name === 'metadata' && element.textContent.length > options.maxMetadataLength) {
    element.remove()
    markSanitized(state)
    return
  }

  Array.from(element.childNodes).forEach((child) => {
    if (child.nodeType === 1) sanitizeElement(child, options, state, depth + 1)
    else if (child.nodeType !== 3) {
      child.remove()
      markSanitized(state)
    }
  })
}

/**
 * Mutate an inert image/svg+xml document into a strict, import-safe subset.
 * This must run before metadata is trusted or any node is imported into the
 * live Nanquim document. IDs are intentionally preserved so local references
 * in gradients, patterns, clip paths, markers and block definitions survive.
 */
function sanitizeSvgDocument(documentRef, options = {}) {
  const root = documentRef && documentRef.documentElement
  if (!root || root.localName.toLowerCase() !== 'svg' || root.namespaceURI !== SVG_NS) {
    throw new TypeError('The imported document is not an SVG document.')
  }
  const normalizedOptions = {
    scopeSelector: options.scopeSelector || '#Collection',
    stylesheetRootSelector: options.stylesheetRootSelector || options.scopeSelector || '#Collection',
    maxMetadataLength: Number.isFinite(options.maxMetadataLength)
      ? Math.max(0, options.maxMetadataLength)
      : 5 * 1024 * 1024,
    maxElements: Number.isFinite(options.maxElements)
      ? Math.max(1, options.maxElements)
      : 100000,
    maxDepth: Number.isFinite(options.maxDepth)
      ? Math.max(1, options.maxDepth)
      : 128,
    deferStyleScoping: options.deferStyleScoping === true,
  }
  const state = { changed: false, elements: 0, mutations: 0 }
  sanitizeElement(root, normalizedOptions, state, 0)
  sanitizeSvgNumericGeometry(root, {
    onMutation: () => markSanitized(state),
    rootViewportIsGeometry: options.rootViewportIsGeometry === true,
  })
  if (options.report && typeof options.report === 'object') {
    options.report.changed = state.changed
    options.report.mutations = state.mutations
  }
  return root
}

/**
 * Parse application metadata without allowing prototype-mutating keys or
 * inputs large/deep enough to turn a drawing open into an easy memory/stack
 * denial of service. Returns null for invalid or unsafe input.
 */
function parseSafeJson(source, options = {}) {
  if (typeof source !== 'string') return null
  const maxLength = Number.isFinite(options.maxLength) ? options.maxLength : 5 * 1024 * 1024
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 64
  const maxNodes = Number.isFinite(options.maxNodes) ? options.maxNodes : 200000
  const maxAbsNumber = Number.isFinite(options.maxAbsNumber)
    ? Math.max(0, Math.abs(options.maxAbsNumber))
    : Infinity
  if (source.length > maxLength) return null

  let value
  try {
    value = JSON.parse(source)
  } catch (error) {
    return null
  }

  let nodeCount = 0
  const visit = (candidate, depth) => {
    nodeCount += 1
    if (nodeCount > maxNodes || depth > maxDepth) return false
    if (typeof candidate === 'number') {
      return Number.isFinite(candidate) && Math.abs(candidate) <= maxAbsNumber
    }
    if (!candidate || typeof candidate !== 'object') return true
    if (Array.isArray(candidate)) return candidate.every((entry) => visit(entry, depth + 1))
    const keys = Object.keys(candidate)
    if (keys.some((key) => DANGEROUS_JSON_KEYS.has(key))) return false
    return keys.every((key) => visit(candidate[key], depth + 1))
  }

  return visit(value, 0) ? value : null
}

function rewriteLocalUrls(value, idMap, options = {}) {
  const danglingId = options && options.danglingId
    ? String(options.danglingId)
    : ''
  const targetId = (original) => idMap.get(original) || danglingId || ''
  const escaped = String(value).replace(
    /url\s*\(\s*\\(["'])#([^\s"'()<>[\]{}\\]+)\\\1\s*\)/gi,
    (match, quote, original) => {
      const replacement = targetId(original)
      return replacement ? `url(\\${quote}#${replacement}\\${quote})` : match
    },
  )
  return escaped.replace(
    /url\s*\(\s*(["']?)#([^\s"'()<>[\]{}\\]+)\1\s*\)/gi,
    (match, quote, original) => {
      const replacement = targetId(original)
      return replacement ? `url(${quote}#${replacement}${quote})` : match
    },
  )
}

function cssAttributeString(value) {
  return String(value).replace(/[\x00-\x1f\x7f"\\]/g, (character) => {
    return `\\${character.codePointAt(0).toString(16)} `
  })
}

function rewriteAttributeSelectorReferences(selector, idMap, options = {}) {
  const match = String(selector).match(
    /^(\[\s*((?:(?:\*|[-_a-z0-9]+)\|)?([-_a-z0-9]+))\s*=\s*)(["'])(.*?)\4(\s*(?:[is]\s*)?\])$/i,
  )
  if (!match) return selector

  const [, prefix, , localNameRaw, quote, originalValue, suffix] = match
  const localName = localNameRaw.toLowerCase()
  let value = originalValue

  if (localName === 'id') {
    value = idMap.get(value) || value
  } else if (localName === 'href' && LOCAL_REFERENCE.test(value)) {
    value = `#${idMap.get(value.slice(1)) || options.danglingId || value.slice(1)}`
  } else if (localName === 'aria-labelledby' || localName === 'aria-describedby') {
    value = value.split(/\s+/).map((id) => idMap.get(id) || options.danglingId || id).join(' ')
  } else if (localName === 'style' || CSS_URL_ATTRIBUTES.has(localName)) {
    value = rewriteLocalUrls(value, idMap, options)
  }

  return value === originalValue ? selector : `${prefix}${quote}${value}${quote}${suffix}`
}

function findAttributeSelectorEnd(source, start) {
  let quote = null
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === ']') return index
  }
  return -1
}

function isSimpleCssIdentifierCharacter(character) {
  return character !== undefined && /[-_a-z0-9\u0080-\uffff]/i.test(character)
}

function rewriteSelectorIds(selectorText, idMap, options = {}) {
  const source = String(selectorText)
  const result = []
  let quote = null

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === quote) quote = null
      result.push(character)
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      result.push(character)
      continue
    }
    if (character === '[') {
      const end = findAttributeSelectorEnd(source, index)
      if (end < 0) {
        result.push(source.slice(index))
        break
      }
      result.push(rewriteAttributeSelectorReferences(source.slice(index, end + 1), idMap, options))
      index = end
      continue
    }
    if (character !== '#') {
      result.push(character)
      continue
    }

    let end = index + 1
    while (isSimpleCssIdentifierCharacter(source[end])) end += 1
    if (end === index + 1) {
      result.push(character)
      continue
    }
    const original = source.slice(index + 1, end)
    const replacement = idMap.get(original)
    result.push(replacement === undefined ? `#${original}` : `[id="${cssAttributeString(replacement)}"]`)
    index = end - 1
  }
  return result.join('')
}

function rewriteStyleReferences(cssText, idMap, options = {}) {
  return String(cssText).replace(/([^{}]+)\{([^{}]*)\}/g, (_rule, selectorText, declarationText) => {
    // Sanitization rejects CSS escapes, so a single pass over ordinary CSS ID
    // tokens is enough. Declaration colors live after `{` and cannot be
    // mistaken for selectors here.
    const selectors = rewriteSelectorIds(selectorText, idMap, options)
    return `${selectors}{${rewriteLocalUrls(declarationText, idMap, options)}}`
  })
}

function scopeSvgStyleElements(root, scope = '#Collection', stylesheetRoot = scope) {
  if (!root || root.nodeType !== 1) return root
  const styles = root.localName.toLowerCase() === 'style'
    ? [root]
    : Array.from(root.querySelectorAll('style'))
  styles.forEach((element) => {
    const safeCss = sanitizeStyleSheet(element.textContent, scope, stylesheetRoot)
    if (safeCss) element.textContent = safeCss
    else element.remove()
  })
  return root
}

/**
 * Assign collision-free IDs to a sanitized SVG forest and repair its local
 * href, url(#id), ARIA and stylesheet references. Duplicate source IDs map to
 * the first element, matching normal document fragment resolution.
 */
function remapSvgIds(roots, allocateId, options = {}) {
  if (typeof allocateId !== 'function') throw new TypeError('An SVG ID allocator is required.')
  const rewriteOptions = options && options.danglingId
    ? { danglingId: String(options.danglingId) }
    : {}
  const pending = Array.from(roots || []).reverse()
  const elements = []
  while (pending.length > 0) {
    const element = pending.pop()
    if (!element || element.nodeType !== 1) continue
    elements.push(element)
    const children = Array.from(element.children)
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index])
  }

  const idMap = new Map()
  elements.forEach((element) => {
    const original = element.getAttribute('id')
    const replacement = String(allocateId(element, original))
    if (original && !idMap.has(original)) idMap.set(original, replacement)
    element.setAttribute('id', replacement)
  })

  elements.forEach((element) => {
    if (element.localName.toLowerCase() === 'style') {
      element.textContent = rewriteStyleReferences(element.textContent, idMap, rewriteOptions)
      return
    }
    if (
      options.rewriteMetadataUrls === true
      && element.localName.toLowerCase() === 'metadata'
      && /url\s*\(/i.test(element.textContent)
    ) {
      element.textContent = rewriteLocalUrls(element.textContent, idMap, rewriteOptions)
    }
    Array.from(element.attributes).forEach((attribute) => {
      const localName = attribute.localName.toLowerCase()
      const value = attribute.value
      if (localName === 'href' && LOCAL_REFERENCE.test(value.trim())) {
        const replacement = idMap.get(value.trim().slice(1))
        if (replacement || rewriteOptions.danglingId) {
          attribute.value = `#${replacement || rewriteOptions.danglingId}`
        }
        return
      }
      if (localName === 'aria-labelledby' || localName === 'aria-describedby') {
        attribute.value = value.split(/\s+/).map(
          (id) => idMap.get(id) || rewriteOptions.danglingId || id,
        ).join(' ')
        return
      }
      if (/url\s*\(/i.test(value)) {
        attribute.value = rewriteLocalUrls(value, idMap, rewriteOptions)
      }
    })
  })

  return idMap
}

export {
  MAX_SVG_GEOMETRY_MAGNITUDE,
  markupFitsSvgElementBudget,
  parseSafeJson,
  remapSvgIds,
  rewriteStyleReferences,
  scopeSvgStyleElements,
  sanitizeCssValue,
  sanitizeStyleDeclarations,
  sanitizeStyleDeclarationsDetailed,
  sanitizeStyleSheet,
  sanitizeStyleSheetDetailed,
  sanitizeSvgDocument,
}
