import * as Helper from '../libs/dxf/src/Helper'
import { rebuildCollectionsFromDOM } from '../Collection'
import { bakeTransforms } from './transformGeometry'
import { rebuildBlockDefinitionsFromDOM } from '../BlockManager'
import {
  markupFitsSvgElementBudget,
  parseSafeJson,
  remapSvgIds,
  sanitizeCssValue,
  sanitizeSvgDocument,
  scopeSvgStyleElements,
} from './sanitizeSvg'

const MAX_SVG_IMPORT_BYTES = 64 * 1024 * 1024
const MAX_SVG_IMPORT_ELEMENTS = 100000
const NATIVE_STYLE_METADATA_LIMITS = Object.freeze({
  maxBytes: 256 * 1024,
  maxDepth: 8,
  maxNodes: 10000,
  maxStyles: 256,
  maxIdentifierLength: 128,
  maxNameLength: 256,
  maxFontFamilyLength: 128,
  maxPaintLength: 128,
  maxNumericMagnitude: 1000000,
  minPositiveNumber: 0.000001,
})
const TEXT_FONT_STYLES = new Set(['normal', 'italic', 'oblique'])
const TEXT_ANCHORS = new Set(['start', 'middle', 'end'])
const TEXT_BASELINES = new Set([
  'auto',
  'text-bottom',
  'alphabetic',
  'ideographic',
  'middle',
  'central',
  'mathematical',
  'hanging',
  'text-top',
])
const TEXT_DECORATIONS = new Set(['none', 'underline', 'overline', 'line-through'])
const DIMENSION_MARKERS = new Set(['arrow', 'tick', 'bullet'])
const MAX_EDITOR_ELEMENT_ID = 1000000000
const SAFE_BLOCK_NAME = /^[^\s"'()<>[\]{}\\#]{1,256}$/

function markupFitsSvgImportElementBudget(source, maxElements = MAX_SVG_IMPORT_ELEMENTS) {
  return markupFitsSvgElementBudget(source, maxElements)
}

function _esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function _finiteNumber(value, { min = -Infinity, max = Infinity } = {}) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null
}

function _record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function _boundedText(value, maxLength) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) return null
  return text
}

function _enumValue(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : null
}

function _safeColor(value) {
  if (typeof value !== 'string' || value.length > 128) return null
  const color = value.trim()
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color
  if (/^(?:rgb|rgba|hsl|hsla)\([\d\s.,%+\-]+\)$/i.test(color)) return color
  return /^[a-z]{1,32}$/i.test(color) ? color : null
}

function _safeStylePaint(value) {
  if (typeof value !== 'string' || value.length > NATIVE_STYLE_METADATA_LIMITS.maxPaintLength) return null
  const paint = sanitizeCssValue(value)
  if (paint === null || paint.length > NATIVE_STYLE_METADATA_LIMITS.maxPaintLength) return null
  if (_safeColor(paint)) return paint
  return /^url\(\s*(["']?)#[^\s"'()<>[\]{}\\]+\1\s*\)$/i.test(paint) ? paint : null
}

function _safeFontFamily(value) {
  const family = _boundedText(value, NATIVE_STYLE_METADATA_LIMITS.maxFontFamilyLength)
  if (family === null || sanitizeCssValue(family) === null) return null
  const names = family.split(',').map(name => name.trim())
  if (names.some(name => !name || !/^[\p{L}\p{N} _.-]+$/u.test(name))) return null
  return names.join(', ')
}

function _safeFontWeight(value) {
  if (typeof value === 'string' && ['normal', 'bold', 'bolder', 'lighter'].includes(value)) return value
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 1000 ? String(numeric) : null
}

function _assignFinite(target, source, name, bounds) {
  const value = _finiteNumber(source[name], bounds)
  if (value !== null) target[name] = value
}

function _textStyleProperties(value) {
  const source = _record(value) ? value : {}
  const properties = {}
  const maxMagnitude = NATIVE_STYLE_METADATA_LIMITS.maxNumericMagnitude
  const fontFamily = _safeFontFamily(source.fontFamily)
  const fontWeight = _safeFontWeight(source.fontWeight)
  const fontStyle = _enumValue(source.fontStyle, TEXT_FONT_STYLES)
  const textAnchor = _enumValue(source.textAnchor, TEXT_ANCHORS)
  const dominantBaseline = _enumValue(source.dominantBaseline, TEXT_BASELINES)
  const textDecoration = _enumValue(source.textDecoration, TEXT_DECORATIONS)
  const fill = _safeStylePaint(source.fill)

  if (fontFamily !== null) properties.fontFamily = fontFamily
  _assignFinite(properties, source, 'fontSize', {
    min: NATIVE_STYLE_METADATA_LIMITS.minPositiveNumber,
    max: maxMagnitude,
  })
  if (fontWeight !== null) properties.fontWeight = fontWeight
  if (fontStyle !== null) properties.fontStyle = fontStyle
  if (textAnchor !== null) properties.textAnchor = textAnchor
  if (dominantBaseline !== null) properties.dominantBaseline = dominantBaseline
  _assignFinite(properties, source, 'letterSpacing', { min: -maxMagnitude, max: maxMagnitude })
  if (textDecoration !== null) properties.textDecoration = textDecoration
  if (fill !== null) properties.fill = fill
  return properties
}

function _dimensionStyleProperties(value) {
  const source = _record(value) ? value : {}
  const properties = {}
  const maxMagnitude = NATIVE_STYLE_METADATA_LIMITS.maxNumericMagnitude
  const textStyleId = _boundedText(source.textStyleId, NATIVE_STYLE_METADATA_LIMITS.maxIdentifierLength)
  const explicitMarker = _enumValue(source.markerType, DIMENSION_MARKERS)
  const legacyTickSize = _finiteNumber(source.tickSize, { min: 0, max: maxMagnitude })
  const legacyArrowSize = _finiteNumber(source.arrowSize, { min: 0, max: maxMagnitude })
  const markerSize = _finiteNumber(source.markerSize, { min: 0, max: maxMagnitude })
  const textColor = _safeStylePaint(source.textColor)
  const lineColor = _safeStylePaint(source.lineColor)

  properties.textStyleId = textStyleId || 'Standard'
  properties.markerType = explicitMarker || (legacyTickSize > 0 ? 'tick' : 'arrow')
  if (markerSize !== null) properties.markerSize = markerSize
  else if (legacyTickSize > 0) properties.markerSize = legacyTickSize
  else if (legacyArrowSize !== null) properties.markerSize = legacyArrowSize
  _assignFinite(properties, source, 'extensionLineOffset', { min: -maxMagnitude, max: maxMagnitude })
  _assignFinite(properties, source, 'extensionLineExtend', { min: -maxMagnitude, max: maxMagnitude })
  _assignFinite(properties, source, 'textOffset', { min: -maxMagnitude, max: maxMagnitude })
  if (textColor !== null) properties.textColor = textColor
  if (lineColor !== null) properties.lineColor = lineColor
  if (source.lineWidth === 'inherit') properties.lineWidth = 'inherit'
  else {
    _assignFinite(properties, source, 'lineWidth', {
      min: NATIVE_STYLE_METADATA_LIMITS.minPositiveNumber,
      max: maxMagnitude,
    })
  }
  return properties
}

function _styleManagerMetadata(value, sanitizeProperties) {
  if (
    !_record(value)
    || !Array.isArray(value.styles)
    || value.styles.length > NATIVE_STYLE_METADATA_LIMITS.maxStyles
  ) return null

  const styles = []
  const identifiers = new Set()
  for (const candidate of value.styles) {
    if (!_record(candidate)) return null
    const id = _boundedText(candidate.id, NATIVE_STYLE_METADATA_LIMITS.maxIdentifierLength)
    const name = _boundedText(candidate.name, NATIVE_STYLE_METADATA_LIMITS.maxNameLength)
    if (!id || !name || identifiers.has(id)) return null
    if (candidate.properties !== undefined && !_record(candidate.properties)) return null
    identifiers.add(id)
    styles.push({ id, name, properties: sanitizeProperties(candidate.properties) })
  }

  const requestedActiveId = _boundedText(
    value.activeStyleId,
    NATIVE_STYLE_METADATA_LIMITS.maxIdentifierLength,
  )
  return {
    activeStyleId: requestedActiveId && identifiers.has(requestedActiveId)
      ? requestedActiveId
      : 'Standard',
    styles,
  }
}

function _parseStyleManagerMetadata(source, sanitizeProperties) {
  const parsed = parseSafeJson(source, {
    maxLength: NATIVE_STYLE_METADATA_LIMITS.maxBytes,
    maxDepth: NATIVE_STYLE_METADATA_LIMITS.maxDepth,
    maxNodes: NATIVE_STYLE_METADATA_LIMITS.maxNodes,
  })
  return _styleManagerMetadata(parsed, sanitizeProperties)
}

function _paperConfigMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const config = {}
  if (['A0', 'A1', 'A2', 'A3', 'A4', 'custom'].includes(value.size)) config.size = value.size
  if (value.orientation === 'portrait' || value.orientation === 'landscape') config.orientation = value.orientation

  const width = _finiteNumber(value.width, { min: 0.1, max: 10000 })
  const height = _finiteNumber(value.height, { min: 0.1, max: 10000 })
  const unitsPerCm = _finiteNumber(value.unitsPerCm, { min: 0.000001, max: 1000000 })
  if (width !== null) config.width = width
  if (height !== null) config.height = height
  if (unitsPerCm !== null) config.unitsPerCm = unitsPerCm

  if (value.colorMap && typeof value.colorMap === 'object' && !Array.isArray(value.colorMap)) {
    const colorMap = {}
    Object.entries(value.colorMap).slice(0, 1024).forEach(([source, mapping]) => {
      const safeSource = _safeColor(source)
      const printColor = mapping && _safeColor(mapping.printColor)
      if (!safeSource || !printColor) return
      colorMap[safeSource] = { printColor, enabled: mapping.enabled !== false }
    })
    config.colorMap = colorMap
  }
  return config
}

function _paperViewportsMetadata(value) {
  if (!Array.isArray(value) || value.length > 256) return null
  const viewports = []
  for (const viewport of value) {
    if (!viewport || typeof viewport !== 'object' || Array.isArray(viewport)) return null
    const x = _finiteNumber(viewport.x, { min: -1000000, max: 1000000 })
    const y = _finiteNumber(viewport.y, { min: -1000000, max: 1000000 })
    const w = _finiteNumber(viewport.w, { min: 0.000001, max: 1000000 })
    const h = _finiteNumber(viewport.h, { min: 0.000001, max: 1000000 })
    const scale = _finiteNumber(viewport.scale, { min: 0.000001, max: 1000000000 })
    const modelOriginX = _finiteNumber(viewport.modelOriginX, { min: -1000000000, max: 1000000000 })
    const modelOriginY = _finiteNumber(viewport.modelOriginY, { min: -1000000000, max: 1000000000 })
    if ([x, y, w, h, scale, modelOriginX, modelOriginY].some((entry) => entry === null)) return null
    viewports.push({ x, y, w, h, scale, modelOriginX, modelOriginY })
  }
  return viewports
}

function _rejectImport(editor, reason) {
  console.error('SVG import rejected:', reason)
  if (editor.signals && editor.signals.terminalLogged) {
    editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Failed to open SVG: ${reason}` })
  }
}

function _replaceImportedAssets(editor) {
  const defs = editor.svg.defs().node
  defs.querySelectorAll('[data-nanquim-import-assets="true"]').forEach((node) => node.remove())
  // Block definitions are document content even when they were created during
  // the session rather than loaded into the owned import container. Opening a
  // different drawing must not merge those old blocks into the new document.
  defs.querySelectorAll('[data-block-def="true"]').forEach((node) => node.remove())
  const container = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  container.setAttribute('data-nanquim-import-assets', 'true')
  defs.appendChild(container)
  return container
}

function _importDefinitionChildren(sourceDefs, destination) {
  Array.from(sourceDefs.children).forEach((child) => {
    destination.appendChild(document.importNode(child, true))
  })
}

function _retainedLiveIds(editor) {
  const svgNode = editor.svg && editor.svg.node
  const drawingNode = editor.drawing && editor.drawing.node
  const ids = new Set()
  if (!svgNode) return ids

  ;[svgNode, ...svgNode.querySelectorAll('[id]')].forEach((node) => {
    if (!node.id) return
    if (drawingNode && node !== drawingNode && drawingNode.contains(node)) return
    if (node.closest && node.closest('[data-nanquim-import-assets="true"]')) return
    if (node.closest && node.closest('[data-block-def="true"]')) return
    ids.add(node.id)
  })
  return ids
}

/**
 * Give every imported SVG target a collision-free identity while the document
 * is still inert. Ordinary geometry and definition children receive numeric
 * editor IDs, so the later hydration pass becomes a no-op. Block definition
 * IDs remain in BlockManager's `block-*` namespace and their instances are
 * updated together. Missing local references are redirected to a guaranteed
 * dangling ID instead of resolving into the host SVG (notably #Collection).
 */
function prepareSanitizedSvgForImport(svgRoot, editor, { reserveForeignCollection = false } = {}) {
  if (!svgRoot || svgRoot.nodeType !== 1) throw new TypeError('A sanitized SVG root is required.')

  const elements = [svgRoot, ...svgRoot.querySelectorAll('*')]
  const reservedIds = _retainedLiveIds(editor)
  const plannedIds = new Set()
  const blockPlans = new Map()
  const blockNames = new Map()
  let blockIndex = 0

  elements.filter((element) => element.getAttribute('data-block-def') === 'true').forEach((element) => {
    const originalId = element.getAttribute('id') || ''
    const originalName = originalId.startsWith('block-')
      ? originalId.slice('block-'.length)
      : originalId
    if (originalName && blockNames.has(originalName)) {
      throw new TypeError(`Duplicate imported block definition: ${originalName}`)
    }

    blockIndex += 1
    const baseName = SAFE_BLOCK_NAME.test(originalName)
      ? originalName
      : `imported-${blockIndex}`
    let name = baseName
    let id = `block-${name}`
    let collisionIndex = 1
    while (reservedIds.has(id) || plannedIds.has(id)) {
      name = `${baseName}-imported-${collisionIndex++}`
      id = `block-${name}`
    }
    plannedIds.add(id)
    blockPlans.set(element, { id, name, originalName })
    if (originalName) blockNames.set(originalName, { id, name })
  })

  let nextElementIndex = Number.isSafeInteger(editor.elementIndex) && editor.elementIndex >= 0
    ? editor.elementIndex
    : 0
  const allocateNumericId = () => {
    let id
    do {
      if (nextElementIndex > MAX_EDITOR_ELEMENT_ID) {
        throw new RangeError('The imported SVG exhausts the safe editor ID range.')
      }
      id = String(nextElementIndex++)
    } while (reservedIds.has(id) || plannedIds.has(id))
    plannedIds.add(id)
    return id
  }

  let danglingIndex = 0
  let danglingId
  do {
    danglingId = `nanquim-unresolved-import-${nextElementIndex}-${danglingIndex++}`
  } while (reservedIds.has(danglingId) || plannedIds.has(danglingId))

  const idMap = remapSvgIds(
    [svgRoot],
    (element) => blockPlans.get(element)?.id || allocateNumericId(),
    { danglingId, rewriteMetadataUrls: true },
  )

  elements.forEach((element) => {
    element.removeAttribute('data-nanquim-preserve-id')
    const originalBlockName = element.getAttribute('data-block-name')
    const blockPlan = originalBlockName && blockNames.get(originalBlockName)
    if (!blockPlan) return
    element.setAttribute('data-block-name', blockPlan.name)
    if (element.localName.toLowerCase() === 'use' || element.getAttribute('data-block-instance') === 'true') {
      element.setAttribute('href', `#${blockPlan.id}`)
    }
  })

  const foreignCollectionId = reserveForeignCollection ? allocateNumericId() : null
  return {
    danglingId,
    foreignCollectionId,
    idMap,
    nextElementIndex,
  }
}

function DXFLoader(editor) {
  this.loadFile = function (file) {
    if (!file || (Number.isFinite(file.size) && file.size > MAX_SVG_IMPORT_BYTES)) {
      _rejectImport(editor, 'File is too large to import safely.')
      return
    }
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
      if (typeof data !== 'string' || data.length > MAX_SVG_IMPORT_BYTES) {
        _rejectImport(editor, 'File is too large to import safely.')
        return
      }
      if (/<!DOCTYPE\b/i.test(data)) {
        _rejectImport(editor, 'DOCTYPE declarations are not supported.')
        return
      }
      if (!markupFitsSvgImportElementBudget(data)) {
        _rejectImport(editor, 'SVG contains too many elements to import safely.')
        return
      }
      const parser = new DOMParser()
      const doc = parser.parseFromString(data, 'image/svg+xml')
      let svgRoot = doc.documentElement

      if (svgRoot.nodeName === 'parsererror' || doc.getElementsByTagName('parsererror').length > 0) {
        console.error('SVG Parsing Error:', doc.documentElement.textContent)
        if (editor.signals && editor.signals.terminalLogged) {
          editor.signals.terminalLogged.dispatch({ type: 'span', msg: 'Failed to open SVG: Corrupted or invalid format.' })
        }
        return
      }

      let isNanquimFile = false
      let geometryNodesMetadata = null
      let importIdPlan = null

      // DOMParser creates an inert XML document, but imported nodes become live
      // as soon as they are cloned into editor.svg or passed to drawing.svg().
      // Sanitize the complete tree before native-file detection, metadata reads,
      // defs cloning or any other interaction with the live document. A foreign
      // file can spoof Nanquim's data-collection marker, so both branches must
      // pass through exactly the same markup policy.
      try {
        // Keep selectors in their sanitized standalone form until local IDs
        // have been remapped. Otherwise a source id named "Collection" could
        // make the remapper rewrite the host scope inserted by the sanitizer.
        svgRoot = sanitizeSvgDocument(doc, { deferStyleScoping: true })
        isNanquimFile = Array.from(svgRoot.children).some(
          child => child.getAttribute('data-collection') === 'true'
        )
        geometryNodesMetadata = Array.from(svgRoot.children).find(
          child => child.localName === 'metadata' && child.getAttribute('id') === 'nanquim-geometry-nodes'
        ) || null
        importIdPlan = prepareSanitizedSvgForImport(svgRoot, editor, {
          reserveForeignCollection: !isNanquimFile,
        })
        scopeSvgStyleElements(
          svgRoot,
          '#Collection',
          isNanquimFile
            ? '#Collection'
            : '#Collection > [data-nanquim-import-root="true"]',
        )
      } catch (error) {
        console.error('Unsafe or unsupported SVG:', error)
        if (editor.signals && editor.signals.terminalLogged) {
          editor.signals.terminalLogged.dispatch({ type: 'span', msg: 'Failed to open SVG: Unsafe or unsupported format.' })
        }
        return
      }

      // Only mutate document-level editor state after the candidate file has
      // passed parsing and sanitization. A rejected file must leave the open
      // drawing and its paper configuration untouched.
      editor.resetPaperConfig()

      // Read Nanquim metadata if present
      const savedElementIndex = svgRoot.getAttribute('data-element-index')

      // Read stroke conversion metadata
      const convertedStrokes = svgRoot.getAttribute('data-nanquim-converted-strokes') === 'true'

      // Read Paper Space metadata
      const savedPaperConfigStr = svgRoot.getAttribute('data-paper-config')
      const savedPaperViewportsStr = svgRoot.getAttribute('data-paper-viewports')

      // Read Dimension Styles
      const savedDimStylesStr = svgRoot.getAttribute('data-dim-styles')

      // Read Text Styles
      const savedTextStylesStr = svgRoot.getAttribute('data-text-styles')

      // Read Block Definitions metadata
      const savedBlockDefsStr = svgRoot.getAttribute('data-block-definitions')

      // Geometry Nodes uses a proper metadata element because graph JSON can
      // grow well beyond what is reasonable or safe in a root attribute.
      let savedGeometryNodes = null
      if (geometryNodesMetadata && geometryNodesMetadata.textContent) {
        savedGeometryNodes = parseSafeJson(geometryNodesMetadata.textContent, { maxNodes: 50000 })
        if (savedGeometryNodes === null) console.warn('Ignored invalid or unsafe Geometry Nodes metadata')
      }

      if (editor.geometryNodes && typeof editor.geometryNodes.reset === 'function') {
        editor.geometryNodes.reset({ preserveDom: true })
      }

      if (savedPaperConfigStr) {
        const parsedConfig = _paperConfigMetadata(parseSafeJson(savedPaperConfigStr, { maxLength: 256 * 1024, maxNodes: 10000 }))
        if (parsedConfig) {
          Object.assign(editor.paperConfig, parsedConfig)
        } else console.warn('Ignored invalid or unsafe paper config metadata')
      }

      if (savedDimStylesStr) {
        try {
          const parsedStyles = _parseStyleManagerMetadata(savedDimStylesStr, _dimensionStyleProperties)
          if (!parsedStyles) throw new TypeError('Dimension styles metadata is invalid')
          editor.dimensionManager.fromJSON(parsedStyles)
        } catch (error) {
          console.warn('Ignored invalid or unsafe dimension styles metadata', error)
        }
      }

      if (savedTextStylesStr) {
        try {
          const parsedTextStyles = _parseStyleManagerMetadata(savedTextStylesStr, _textStyleProperties)
          if (!parsedTextStyles) throw new TypeError('Text styles metadata is invalid')
          editor.textStyleManager.fromJSON(parsedTextStyles)
        } catch (error) {
          console.warn('Ignored invalid or unsafe text styles metadata', error)
        }
      }

      // Clear existing drawing
      editor.drawing.clear()

      // Definitions and styles loaded from the previous drawing must not leak
      // into this one. Keep imported assets in one owned container so replacing
      // them leaves app-owned hatch patterns and other runtime defs untouched.
      const importedAssets = _replaceImportedAssets(editor)

      // Non-geometry node names that should go into <defs> or be discarded
      const NON_GEOMETRY = new Set(['defs', 'style', 'metadata', 'title', 'desc', 'script'])

      let svgContent = ''

      if (isNanquimFile) {
        // Nanquim file: extract all safe definitions before serializing. This
        // includes block defs as well as gradients/patterns referenced by native
        // geometry, and preserves their IDs verbatim.
        Array.from(svgRoot.children).forEach(child => {
          if (child.localName === 'defs') {
            _importDefinitionChildren(child, importedAssets)
          } else if (child.localName === 'style') {
            importedAssets.appendChild(document.importNode(child, true))
          } else if (!NON_GEOMETRY.has(child.localName)) {
            svgContent += new XMLSerializer().serializeToString(child)
          }
        })

        // If the file was saved with white strokes/fills converted to black, revert them
        if (convertedStrokes) {
          svgContent = svgContent.replace(/stroke\s*=\s*(["'])#000000\1/gi, 'stroke=$1#ffffff$1')
          svgContent = svgContent.replace(/stroke\s*:\s*#000000/gi, 'stroke: #ffffff')

          svgContent = svgContent.replace(/fill\s*=\s*(["'])#000000\1/gi, 'fill=$1#ffffff$1')
          svgContent = svgContent.replace(/fill\s*:\s*#000000/gi, 'fill: #ffffff')
        }
        editor.drawing.svg(svgContent)
      } else {
        // Foreign SVG: handle defs separately and wrap geometry in a collection

        // 1. Move <defs> / <style> content into the main SVG's own <defs>
        Array.from(svgRoot.children).forEach(child => {
          const name = child.localName
          // Ignore non-SVG namespace junk (sodipodi, inkscape, etc.)
          if (child.namespaceURI && child.namespaceURI !== 'http://www.w3.org/2000/svg') return
          if (name === 'defs') _importDefinitionChildren(child, importedAssets)
          else if (name === 'style') importedAssets.appendChild(document.importNode(child, true))
        })

        // 2. Build the geometry content string (skip non-geometry nodes)
        let geometryContent = ''
        Array.from(svgRoot.children).forEach(child => {
          const name = child.localName
          if (child.namespaceURI && child.namespaceURI !== 'http://www.w3.org/2000/svg') return
          if (NON_GEOMETRY.has(name)) return
          geometryContent += new XMLSerializer().serializeToString(child)
        })

        // 3. Wrap everything in a single collection group with a transparent/inherit style
        //    so the Nanquim default white stroke doesn't clobber foreign colors.
        const collectionId = importIdPlan.foreignCollectionId
        const collectionName = file.name.replace(/\.svg$/i, '')
        svgContent =
          `<g id="${collectionId}" name="${_esc(collectionName)}" ` +
          `data-collection="true" ` +
          `data-nanquim-import-root="true" ` +
          `style="stroke:inherit;fill:inherit;">` +
          geometryContent +
          `</g>`

        editor.drawing.svg(svgContent)

        // 4. Mark every element that carries its own inline stroke/fill/color
        //    as a style-override so the collection panel can't accidentally reset them.
        const markOverrides = (svgEl) => {
          svgEl.children().each(child => {
            const overrides = {}
            const style = child.node.getAttribute('style') || ''
            if (child.node.getAttribute('stroke') || /stroke\s*:/.test(style)) overrides.stroke = true
            if (child.node.getAttribute('fill') || /fill\s*:/.test(style)) overrides.fill = true
            if (Object.keys(overrides).length > 0) {
              child.attr('data-style-overrides', JSON.stringify(overrides))
            }
            if (child.type === 'g') markOverrides(child)
          })
        }
        markOverrides(editor.drawing)
      }

      // Commit the preallocated ID range only after both definitions and
      // drawing content have been inserted successfully. Hydration below sees
      // these numeric IDs and therefore does not rename reference targets.
      editor.elementIndex = Math.max(editor.elementIndex, importIdPlan.nextElementIndex)

      // Strip any hover/selected classes that were baked into the saved SVG.
      // These classes live in the DOM so they survive serialization; clear them now
      // before the editor's selection/hover state is re-established.
      editor.drawing.node.querySelectorAll('.elementHover, .elementSelected').forEach(node => {
        node.classList.remove('elementHover', 'elementSelected')
      })

      // Hydrate data attributes recursively (including inside collection groups).
      // Must run BEFORE bakeTransforms so that arcData/splineData/etc. are
      // in-memory when applyMatrixToElement tries to transform them.
      const hydrateElement = (el) => {
        const node = el.node
        Array.from(node.attributes).forEach((attr) => {
          if (attr.name.startsWith('data-')) {
            const key = attr.name.slice(5)
            const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
            const value = parseSafeJson(attr.value, { maxLength: 1024 * 1024, maxDepth: 32, maxNodes: 50000 })
            if (value !== null) {
              el.data(camelKey, value)
            } else if (/^\s*[{[]/.test(attr.value)) {
              node.removeAttribute(attr.name)
            } else {
              el.data(camelKey, attr.value)
            }
          }
        })

        // If this is a collection group, don't try to parse its ID as an integer
        // as collections use 'collection-N' format.
        if (el.attr('data-collection') === 'true') return

        // Procedural rendering namespaces semantic SVG ids so internal
        // clip/mask/gradient/href references survive arrays, save/load and
        // Apply. These ids intentionally remain non-numeric.
        if (el.attr('data-nanquim-preserve-id') === 'true') return

        const rawId = el.attr('id')
        let id = rawId === null || rawId === undefined || rawId === '' ? NaN : Number(rawId)
        if (!Number.isSafeInteger(id) || id < 0 || id > 1000000000) {
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
        const idx = Number(savedElementIndex)
        if (Number.isSafeInteger(idx) && idx >= 0 && idx <= 1000000000 && idx > editor.elementIndex) {
          editor.elementIndex = idx
        }
      }

      // Rebuild collections from DOM (handles legacy and new files)
      rebuildCollectionsFromDOM(editor)

      // Rebuild block definitions from <defs> DOM and/or saved metadata
      if (savedBlockDefsStr) {
        try {
          const entries = parseSafeJson(savedBlockDefsStr, { maxLength: 1024 * 1024 })
          if (!Array.isArray(entries)) throw new TypeError('Block definitions metadata must be an array')
          editor.blockDefinitions = new Map(entries)
        } catch (e) {
          console.warn('Ignored invalid or unsafe block definitions metadata', e)
        }
      }
      rebuildBlockDefinitionsFromDOM(editor)

      // Restore graph assets and bind their modifier instances to the wrapper
      // groups that were just hydrated. The manager keeps the cached SVG output
      // if a graph is missing or from a newer schema.
      if (editor.geometryNodes && typeof editor.geometryNodes.load === 'function') {
        try {
          editor.geometryNodes.load(savedGeometryNodes || { schemaVersion: 1, graphs: [], instances: [] })
        } catch (e) {
          console.warn('Failed to restore Geometry Nodes', e)
          if (editor.signals && editor.signals.terminalLogged) {
            editor.signals.terminalLogged.dispatch({ type: 'span', msg: 'Geometry Nodes could not be restored; cached SVG output was kept.' })
          }
        }
      }

      // Collapse all collections and group elements in the outliner on load
      editor.collections.forEach(data => {
        data.collapsed = true
      })
      editor.drawing.find('[data-group="true"]').each(g => {
        g.attr('data-collapsed', 'true')
      })

      // Build spatial index for fast hit-testing on the imported geometry
      editor.spatialIndex.rebuild(editor)

      // Clear existing viewports
      if (editor.paperEditor) {
        const existingVps = [...(editor.paperViewports || [])]
        existingVps.forEach(vp => editor.paperEditor.removeViewport(vp.id))
      }

      if (savedPaperViewportsStr && editor.paperEditor) {
        try {
          const parsedVps = _paperViewportsMetadata(parseSafeJson(savedPaperViewportsStr, { maxLength: 1024 * 1024, maxNodes: 10000 }))
          if (!parsedVps) throw new TypeError('Paper viewports metadata is invalid')
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

export {
  DXFLoader,
  MAX_SVG_IMPORT_BYTES,
  MAX_SVG_IMPORT_ELEMENTS,
  NATIVE_STYLE_METADATA_LIMITS,
  markupFitsSvgImportElementBudget,
  prepareSanitizedSvgForImport,
}
