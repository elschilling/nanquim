import { sanitizeCssValue } from '../utils/sanitizeSvg'

const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024

const GEOMETRY_NODES_METADATA_LIMITS = Object.freeze({
  maxLength: 4 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 100000,
})

const ELEMENT_DATA_METADATA_LIMITS = Object.freeze({
  maxLength: 1024 * 1024,
  maxDepth: 32,
  maxNodes: 50000,
})

const DOCUMENT_METADATA_LIMITS = Object.freeze({
  'data-paper-config': Object.freeze({
    maxLength: 256 * 1024,
    maxDepth: 16,
    maxNodes: 10000,
  }),
  'data-paper-viewports': Object.freeze({
    maxLength: 1024 * 1024,
    maxDepth: 16,
    maxNodes: 20000,
  }),
  'data-dim-styles': Object.freeze({
    maxLength: 256 * 1024,
    maxDepth: 16,
    maxNodes: 10000,
  }),
  'data-text-styles': Object.freeze({
    maxLength: 256 * 1024,
    maxDepth: 16,
    maxNodes: 10000,
  }),
  'data-block-definitions': Object.freeze({
    maxLength: 1024 * 1024,
    maxDepth: 24,
    maxNodes: 50000,
  }),
})

function sourceExceedsByteLimit(source, limit = MAX_DOCUMENT_BYTES) {
  let bytes = 0
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < source.length) {
      const next = source.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else bytes += 3
    } else bytes += 3
    if (bytes > limit) return true
  }
  return false
}

function assertDocumentSourceSize(source, limit = MAX_DOCUMENT_BYTES) {
  if (typeof source !== 'string') throw new TypeError('Document source must be text.')
  if (sourceExceedsByteLimit(source, limit)) {
    throw new RangeError('The native document exceeds the supported file-size limit.')
  }
  return source
}

function assertXml10Characters(value, label = 'Document text') {
  const text = String(value)
  for (let index = 0; index < text.length; index += 1) {
    const first = text.charCodeAt(index)
    let codePoint = first

    if (first >= 0xd800 && first <= 0xdbff) {
      const second = text.charCodeAt(index + 1)
      if (second < 0xdc00 || second > 0xdfff) {
        throw new TypeError(`${label} contains an invalid XML character.`)
      }
      codePoint = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00)
      index += 1
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      throw new TypeError(`${label} contains an invalid XML character.`)
    }

    const isXmlCharacter = codePoint === 0x9
      || codePoint === 0xa
      || codePoint === 0xd
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
    const isNoncharacter = (codePoint >= 0xfdd0 && codePoint <= 0xfdef)
      || (codePoint & 0xffff) === 0xfffe
      || (codePoint & 0xffff) === 0xffff

    if (!isXmlCharacter || isNoncharacter) {
      throw new TypeError(`${label} contains an invalid XML character.`)
    }
  }
  return text
}

const NATIVE_STYLE_METADATA_LIMITS = Object.freeze({
  // Kept as a compatibility alias for callers that use the attribute budget
  // when constructing adversarial fixtures.
  maxBytes: DOCUMENT_METADATA_LIMITS['data-text-styles'].maxLength,
  maxDepth: DOCUMENT_METADATA_LIMITS['data-text-styles'].maxDepth,
  maxNodes: DOCUMENT_METADATA_LIMITS['data-text-styles'].maxNodes,
  maxStyles: 256,
  maxIdentifierLength: 128,
  maxNameLength: 256,
  maxFontFamilyLength: 128,
  maxPaintLength: 128,
  maxNumericMagnitude: 1000000,
  minPositiveNumber: 0.000001,
})

const PAPER_CONFIG_METADATA_LIMITS = Object.freeze({
  maxColorMappings: 1024,
  minDimension: 0.1,
  maxDimension: 10000,
  minUnitsPerCm: 0.000001,
  maxUnitsPerCm: 1000000,
})
const MAX_BLOCK_DISPLAY_NAME_LENGTH = 256

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
const PAPER_SIZES = new Set(['A0', 'A1', 'A2', 'A3', 'A4', 'custom'])
const PAPER_ORIENTATIONS = new Set(['portrait', 'landscape'])
const DANGEROUS_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const DEFAULT_TEXT_STYLE_PROPERTIES = Object.freeze({
  fontFamily: 'Inter',
  fontSize: 0.15,
  fontWeight: 'normal',
  fontStyle: 'normal',
  textAnchor: 'start',
  dominantBaseline: 'auto',
  letterSpacing: 0,
  textDecoration: 'none',
  fill: '#ffffff',
})

const DEFAULT_DIMENSION_STYLE_PROPERTIES = Object.freeze({
  textStyleId: 'Standard',
  markerType: 'arrow',
  markerSize: 0.15,
  extensionLineOffset: 0.1,
  extensionLineExtend: 0.1,
  textOffset: 0.1,
  textColor: '#ffffff',
  lineColor: '#ffffff',
  lineWidth: 0.01,
})

const DEFAULT_PAPER_CONFIG = Object.freeze({
  size: 'A4',
  width: 210,
  height: 297,
  orientation: 'portrait',
  unitsPerCm: 1,
})

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function semanticEqual(left, right) {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => semanticEqual(entry, right[index]))
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && semanticEqual(left[key], right[key])
    ))
}

function finiteNumber(value, { min = -Infinity, max = Infinity } = {}) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? (Object.is(value, -0) ? 0 : value)
    : null
}

function boundedText(value, maxLength) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) return null
  return text
}

function validateBlockDisplayName(value) {
  if (typeof value !== 'string') return null
  if (
    !value
    || value !== value.trim()
    || value.length > MAX_BLOCK_DISPLAY_NAME_LENGTH
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return null
  return value
}

function enumValue(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : null
}

function safeColor(value) {
  if (typeof value !== 'string' || value.length > NATIVE_STYLE_METADATA_LIMITS.maxPaintLength) return null
  const color = value.trim()
  if (!color || DANGEROUS_JSON_KEYS.has(color)) return null
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color
  if (/^(?:rgb|rgba|hsl|hsla)\([\d\s.,%+\-]+\)$/i.test(color)) return color
  return /^[a-z]{1,32}$/i.test(color) ? color : null
}

function safeStylePaint(value) {
  if (typeof value !== 'string' || value.length > NATIVE_STYLE_METADATA_LIMITS.maxPaintLength) return null
  const paint = sanitizeCssValue(value)
  if (paint === null || paint.length > NATIVE_STYLE_METADATA_LIMITS.maxPaintLength) return null
  if (safeColor(paint)) return paint
  return /^url\(\s*(["']?)#[^\s"'()<>[\]{}\\]+\1\s*\)$/i.test(paint) ? paint : null
}

function safeFontFamily(value) {
  const family = boundedText(value, NATIVE_STYLE_METADATA_LIMITS.maxFontFamilyLength)
  if (family === null || sanitizeCssValue(family) === null) return null
  const names = family.split(',').map(name => name.trim())
  if (names.some(name => !name || !/^[\p{L}\p{N} _.-]+$/u.test(name))) return null
  return names.join(', ')
}

function safeFontWeight(value) {
  if (typeof value === 'string' && ['normal', 'bold', 'bolder', 'lighter'].includes(value)) return value
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 1000 ? String(numeric) : null
}

function canonicalTextStyleProperties(value) {
  const source = isRecord(value) ? value : {}
  const maxMagnitude = NATIVE_STYLE_METADATA_LIMITS.maxNumericMagnitude
  return {
    fontFamily: safeFontFamily(source.fontFamily) || DEFAULT_TEXT_STYLE_PROPERTIES.fontFamily,
    fontSize: finiteNumber(source.fontSize, {
      min: NATIVE_STYLE_METADATA_LIMITS.minPositiveNumber,
      max: maxMagnitude,
    }) ?? DEFAULT_TEXT_STYLE_PROPERTIES.fontSize,
    fontWeight: safeFontWeight(source.fontWeight) || DEFAULT_TEXT_STYLE_PROPERTIES.fontWeight,
    fontStyle: enumValue(source.fontStyle, TEXT_FONT_STYLES) || DEFAULT_TEXT_STYLE_PROPERTIES.fontStyle,
    textAnchor: enumValue(source.textAnchor, TEXT_ANCHORS) || DEFAULT_TEXT_STYLE_PROPERTIES.textAnchor,
    dominantBaseline: enumValue(source.dominantBaseline, TEXT_BASELINES)
      || DEFAULT_TEXT_STYLE_PROPERTIES.dominantBaseline,
    letterSpacing: finiteNumber(source.letterSpacing, {
      min: -maxMagnitude,
      max: maxMagnitude,
    }) ?? DEFAULT_TEXT_STYLE_PROPERTIES.letterSpacing,
    textDecoration: enumValue(source.textDecoration, TEXT_DECORATIONS)
      || DEFAULT_TEXT_STYLE_PROPERTIES.textDecoration,
    fill: safeStylePaint(source.fill) || DEFAULT_TEXT_STYLE_PROPERTIES.fill,
  }
}

function canonicalDimensionStyleProperties(value) {
  const source = isRecord(value) ? value : {}
  const maxMagnitude = NATIVE_STYLE_METADATA_LIMITS.maxNumericMagnitude
  const textStyleId = boundedText(source.textStyleId, NATIVE_STYLE_METADATA_LIMITS.maxIdentifierLength)
  const explicitMarker = enumValue(source.markerType, DIMENSION_MARKERS)
  const legacyTickSize = finiteNumber(source.tickSize, { min: 0, max: maxMagnitude })
  const legacyArrowSize = finiteNumber(source.arrowSize, { min: 0, max: maxMagnitude })
  const markerSize = finiteNumber(source.markerSize, { min: 0, max: maxMagnitude })
  const textColor = safeStylePaint(source.textColor)
  const lineColor = safeStylePaint(source.lineColor)
  const lineWidth = source.lineWidth === 'inherit'
    ? 'inherit'
    : finiteNumber(source.lineWidth, {
        min: NATIVE_STYLE_METADATA_LIMITS.minPositiveNumber,
        max: maxMagnitude,
      })

  return {
    textStyleId: textStyleId || DEFAULT_DIMENSION_STYLE_PROPERTIES.textStyleId,
    markerType: explicitMarker || (legacyTickSize > 0 ? 'tick' : DEFAULT_DIMENSION_STYLE_PROPERTIES.markerType),
    markerSize: markerSize
      ?? (legacyTickSize > 0
        ? legacyTickSize
        : legacyArrowSize ?? DEFAULT_DIMENSION_STYLE_PROPERTIES.markerSize),
    extensionLineOffset: finiteNumber(source.extensionLineOffset, {
      min: -maxMagnitude,
      max: maxMagnitude,
    }) ?? DEFAULT_DIMENSION_STYLE_PROPERTIES.extensionLineOffset,
    extensionLineExtend: finiteNumber(source.extensionLineExtend, {
      min: -maxMagnitude,
      max: maxMagnitude,
    }) ?? DEFAULT_DIMENSION_STYLE_PROPERTIES.extensionLineExtend,
    textOffset: finiteNumber(source.textOffset, {
      min: -maxMagnitude,
      max: maxMagnitude,
    }) ?? DEFAULT_DIMENSION_STYLE_PROPERTIES.textOffset,
    textColor: textColor || DEFAULT_DIMENSION_STYLE_PROPERTIES.textColor,
    lineColor: lineColor || DEFAULT_DIMENSION_STYLE_PROPERTIES.lineColor,
    lineWidth: lineWidth ?? DEFAULT_DIMENSION_STYLE_PROPERTIES.lineWidth,
  }
}

function validateStyleManagerMetadata(value, canonicalProperties, defaultProperties) {
  if (
    !isRecord(value)
    || !Array.isArray(value.styles)
    || value.styles.length > NATIVE_STYLE_METADATA_LIMITS.maxStyles
  ) return { value: null, recovered: true }

  const styles = []
  const identifiers = new Set()
  for (const candidate of value.styles) {
    if (!isRecord(candidate)) return { value: null, recovered: true }
    const id = boundedText(candidate.id, NATIVE_STYLE_METADATA_LIMITS.maxIdentifierLength)
    const name = boundedText(candidate.name, NATIVE_STYLE_METADATA_LIMITS.maxNameLength)
    if (!id || !name || identifiers.has(id)) return { value: null, recovered: true }
    if (candidate.properties !== undefined && !isRecord(candidate.properties)) {
      return { value: null, recovered: true }
    }
    identifiers.add(id)
    styles.push({
      id,
      name,
      properties: canonicalProperties(candidate.properties),
    })
  }

  if (!identifiers.has('Standard')) {
    if (styles.length >= NATIVE_STYLE_METADATA_LIMITS.maxStyles) {
      return { value: null, recovered: true }
    }
    identifiers.add('Standard')
    styles.push({
      id: 'Standard',
      name: 'Standard',
      properties: { ...defaultProperties },
    })
  }

  const requestedActiveId = boundedText(
    value.activeStyleId,
    NATIVE_STYLE_METADATA_LIMITS.maxIdentifierLength,
  )
  const normalized = {
    activeStyleId: requestedActiveId && identifiers.has(requestedActiveId)
      ? requestedActiveId
      : 'Standard',
    styles,
  }
  return { value: normalized, recovered: !semanticEqual(value, normalized) }
}

function validateTextStyleMetadata(value) {
  return validateStyleManagerMetadata(
    value,
    canonicalTextStyleProperties,
    DEFAULT_TEXT_STYLE_PROPERTIES,
  )
}

function validateDimensionStyleMetadata(value) {
  return validateStyleManagerMetadata(
    value,
    canonicalDimensionStyleProperties,
    DEFAULT_DIMENSION_STYLE_PROPERTIES,
  )
}

function validatePaperConfigMetadata(value) {
  if (!isRecord(value)) return { value: null, recovered: true }
  if (!isRecord(value.colorMap)) return { value: null, recovered: true }

  const mappings = Object.entries(value.colorMap)
  if (mappings.length > PAPER_CONFIG_METADATA_LIMITS.maxColorMappings) {
    return { value: null, recovered: true }
  }

  const colorMap = {}
  for (const [source, mapping] of mappings) {
    const safeSource = safeColor(source)
    const printColor = isRecord(mapping) ? safeColor(mapping.printColor) : null
    if (!safeSource || !printColor || Object.hasOwn(colorMap, safeSource)) continue
    colorMap[safeSource] = {
      printColor,
      enabled: typeof mapping.enabled === 'boolean' ? mapping.enabled : true,
    }
  }

  const normalized = {
    size: enumValue(value.size, PAPER_SIZES) || DEFAULT_PAPER_CONFIG.size,
    width: finiteNumber(value.width, {
      min: PAPER_CONFIG_METADATA_LIMITS.minDimension,
      max: PAPER_CONFIG_METADATA_LIMITS.maxDimension,
    }) ?? DEFAULT_PAPER_CONFIG.width,
    height: finiteNumber(value.height, {
      min: PAPER_CONFIG_METADATA_LIMITS.minDimension,
      max: PAPER_CONFIG_METADATA_LIMITS.maxDimension,
    }) ?? DEFAULT_PAPER_CONFIG.height,
    orientation: enumValue(value.orientation, PAPER_ORIENTATIONS) || DEFAULT_PAPER_CONFIG.orientation,
    unitsPerCm: finiteNumber(value.unitsPerCm, {
      min: PAPER_CONFIG_METADATA_LIMITS.minUnitsPerCm,
      max: PAPER_CONFIG_METADATA_LIMITS.maxUnitsPerCm,
    }) ?? DEFAULT_PAPER_CONFIG.unitsPerCm,
    colorMap,
  }
  return { value: normalized, recovered: !semanticEqual(value, normalized) }
}

export {
  DEFAULT_DIMENSION_STYLE_PROPERTIES,
  DEFAULT_PAPER_CONFIG,
  DEFAULT_TEXT_STYLE_PROPERTIES,
  DOCUMENT_METADATA_LIMITS,
  ELEMENT_DATA_METADATA_LIMITS,
  GEOMETRY_NODES_METADATA_LIMITS,
  MAX_DOCUMENT_BYTES,
  MAX_BLOCK_DISPLAY_NAME_LENGTH,
  NATIVE_STYLE_METADATA_LIMITS,
  PAPER_CONFIG_METADATA_LIMITS,
  assertDocumentSourceSize,
  assertXml10Characters,
  sourceExceedsByteLimit,
  validateBlockDisplayName,
  validateDimensionStyleMetadata,
  validatePaperConfigMetadata,
  validateTextStyleMetadata,
}
