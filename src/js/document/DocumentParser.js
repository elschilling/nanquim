import DxfHelper from '../libs/dxf/src/Helper'
import {
  markupFitsSvgElementBudget,
  parseSafeJson,
  sanitizeSvgDocument,
} from '../utils/sanitizeSvg'
import {
  DOCUMENT_METADATA_LIMITS,
  GEOMETRY_NODES_METADATA_LIMITS,
  MAX_DOCUMENT_BYTES,
  sourceExceedsByteLimit,
} from './DocumentMetadata'
import { DOCUMENT_SCHEMA_VERSION } from './DocumentSerializer'

const MAX_DOCUMENT_ELEMENTS = 100000
const MAX_DOCUMENT_DIAGNOSTICS = 16
const MAX_SOURCE_NAME_LENGTH = 512
const MAX_ELEMENT_INDEX = 1000000000
const SVGJS_NAMESPACE = 'http://svgjs.com/svgjs'

const JSON_METADATA = Object.freeze([
  {
    attribute: 'data-paper-config',
    field: 'paperConfig',
    diagnostic: 'invalid-paper-config',
  },
  {
    attribute: 'data-paper-viewports',
    field: 'paperViewports',
    diagnostic: 'invalid-paper-viewports',
  },
  {
    attribute: 'data-dim-styles',
    field: 'dimensionStyles',
    diagnostic: 'invalid-dimension-styles',
  },
  {
    attribute: 'data-text-styles',
    field: 'textStyles',
    diagnostic: 'invalid-text-styles',
  },
  {
    attribute: 'data-block-definitions',
    field: 'blockDefinitions',
    diagnostic: 'invalid-block-definitions',
  },
])

const DIAGNOSTIC_MESSAGES = Object.freeze({
  'schema-migrated': 'The document was migrated to the current schema and must be saved again.',
  'invalid-view-box': 'The saved viewBox was ignored because it is invalid.',
  'invalid-element-index': 'The saved element index was ignored because it is invalid.',
  'invalid-active-collection': 'The saved active collection was ignored because it is invalid.',
  'invalid-converted-strokes': 'The saved stroke-conversion marker was ignored because it is invalid.',
  'invalid-paper-config': 'Invalid Paper configuration metadata was ignored.',
  'invalid-paper-viewports': 'Invalid Paper viewport metadata was ignored.',
  'invalid-dimension-styles': 'Invalid dimension-style metadata was ignored.',
  'invalid-text-styles': 'Invalid text-style metadata was ignored.',
  'invalid-block-definitions': 'Invalid block-definition metadata was ignored.',
  'invalid-geometry-nodes': 'Invalid Geometry Nodes metadata was ignored; safe cached SVG remains available.',
  'duplicate-geometry-nodes': 'Duplicate Geometry Nodes metadata was ignored; safe cached SVG remains available.',
  'duplicate-paper-annotations': 'Duplicate Paper annotation roots were ignored; Paper annotations were reset.',
  'sanitized-content': 'Unsafe or unsupported SVG content was removed while opening the document.',
})

class DocumentOpenError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'DocumentOpenError'
    this.code = code
  }
}

function documentError(code, message, cause) {
  return new DocumentOpenError(code, message, cause === undefined ? {} : { cause })
}

function boundedSourceName(value) {
  if (typeof value !== 'string') return ''
  return value.slice(0, MAX_SOURCE_NAME_LENGTH)
}

function assertBoundedSource(source) {
  if (typeof source !== 'string') {
    throw documentError('invalid-source', 'The selected file could not be read as text.')
  }
  if (sourceExceedsByteLimit(source)) {
    throw documentError('file-too-large', 'The selected file is too large to open safely.')
  }
}

async function readFileText(file) {
  if (!file || typeof file !== 'object') {
    throw documentError('invalid-file', 'Select an SVG or DXF file to open.')
  }
  if (Number.isFinite(file.size) && (file.size < 0 || file.size > MAX_DOCUMENT_BYTES)) {
    throw documentError('file-too-large', 'The selected file is too large to open safely.')
  }

  let source
  try {
    if (typeof file.text === 'function') {
      source = await file.text()
    } else if (typeof FileReader === 'function') {
      source = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error || new Error('FileReader failed.'))
        reader.onabort = () => reject(new DOMException('The file read was cancelled.', 'AbortError'))
        reader.readAsText(file)
      })
    } else {
      throw new TypeError('No text file reader is available.')
    }
  } catch (error) {
    if (error instanceof DocumentOpenError) throw error
    throw documentError('file-read-failed', 'The selected file could not be read.', error)
  }

  assertBoundedSource(source)
  return source
}

function inferSourceFormat(options = {}) {
  const requested = typeof options.format === 'string' ? options.format.toLowerCase() : ''
  if (requested) {
    if (requested === 'svg' || requested === 'dxf') return requested
    throw documentError('unsupported-format', 'Only SVG and DXF files can be opened.')
  }

  const name = String(options.name || options.fileName || '').toLowerCase()
  const type = String(options.type || options.mimeType || '').toLowerCase()
  if (/\.dxf$/.test(name) || ['image/vnd.dxf', 'image/x-dxf', 'application/dxf', 'application/x-dxf'].includes(type)) {
    return 'dxf'
  }
  if (/\.svg$/.test(name) || type === 'image/svg+xml' || (!name && !type)) return 'svg'
  throw documentError('unsupported-format', 'Only SVG and DXF files can be opened.')
}

function convertDxfToSvg(source) {
  try {
    const converted = new DxfHelper(source).toSVG()
    assertBoundedSource(converted)
    return converted
  } catch (error) {
    if (error instanceof DocumentOpenError) throw error
    throw documentError('invalid-dxf', 'The DXF file is corrupted or unsupported.', error)
  }
}

function repairLegacySvgjsNamespace(source) {
  if (!/\bsvgjs:/.test(source) || /\bxmlns:svgjs\s*=/.test(source)) return source
  return source.replace(/<svg(?=[\s>])/i, `<svg xmlns:svgjs="${SVGJS_NAMESPACE}"`)
}

function parseSvgDocument(source) {
  if (/<!DOCTYPE\b/i.test(source)) {
    throw documentError('doctype-not-supported', 'DOCTYPE declarations are not supported.')
  }
  if (!markupFitsSvgElementBudget(source, MAX_DOCUMENT_ELEMENTS)) {
    throw documentError(
      'svg-complexity-limit',
      'The SVG is malformed or contains too many elements to open safely.',
    )
  }

  const parser = new DOMParser()
  const documentRef = parser.parseFromString(source, 'image/svg+xml')
  const rawRoot = documentRef.documentElement
  if (
    !rawRoot
    || rawRoot.localName?.toLowerCase() === 'parsererror'
    || documentRef.getElementsByTagName('parsererror').length > 0
  ) {
    throw documentError('invalid-svg', 'The SVG file is corrupted or invalid.')
  }

  // Remember only marker presence before sanitization. An oversized marker is
  // removed by the sanitizer and must fail closed instead of becoming a
  // markerless foreign import.
  const hadSchemaMarker = rawRoot.hasAttribute('data-nanquim-version')
  const rawMetadataAttributes = new Set(
    JSON_METADATA
      .map(({ attribute }) => attribute)
      .filter(attribute => rawRoot.hasAttribute(attribute)),
  )
  const sanitization = {}
  let root
  try {
    root = sanitizeSvgDocument(documentRef, {
      deferStyleScoping: true,
      maxElements: MAX_DOCUMENT_ELEMENTS,
      report: sanitization,
    })
  } catch (error) {
    throw documentError('unsafe-svg', 'The SVG file uses an unsafe or unsupported structure.', error)
  }

  if (hadSchemaMarker && !root.hasAttribute('data-nanquim-version')) {
    throw documentError('invalid-schema-version', 'The document schema version is invalid.')
  }
  return { rawMetadataAttributes, root, sanitization }
}

function addDiagnostic(diagnostics, code) {
  if (diagnostics.length >= MAX_DOCUMENT_DIAGNOSTICS) return
  const message = DIAGNOSTIC_MESSAGES[code]
  if (!message) return
  diagnostics.push(Object.freeze({ level: 'warning', code, message }))
}

function classifySchema(root, format, diagnostics) {
  if (format === 'dxf') {
    return {
      kind: 'dxf',
      isNative: false,
      sourceSchemaVersion: null,
      schemaVersion: null,
      migratedFrom: null,
      requiresSave: true,
    }
  }

  const rawVersion = root.getAttribute('data-nanquim-version')
  if (rawVersion === null) {
    return {
      kind: 'foreign-svg',
      isNative: false,
      sourceSchemaVersion: null,
      schemaVersion: null,
      migratedFrom: null,
      requiresSave: true,
    }
  }

  const normalized = rawVersion.trim()
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw documentError('invalid-schema-version', 'The document schema version is invalid.')
  }
  const sourceSchemaVersion = Number(normalized)
  if (!Number.isSafeInteger(sourceSchemaVersion)) {
    throw documentError('invalid-schema-version', 'The document schema version is invalid.')
  }
  if (sourceSchemaVersion > DOCUMENT_SCHEMA_VERSION) {
    throw documentError(
      'future-schema-version',
      'This document was created by a newer version of Nanquim and cannot be opened safely.',
    )
  }
  if (sourceSchemaVersion !== DOCUMENT_SCHEMA_VERSION && sourceSchemaVersion !== 1 && sourceSchemaVersion !== 2) {
    throw documentError('unsupported-schema-version', 'This document schema version is not supported.')
  }

  const migratedFrom = sourceSchemaVersion === DOCUMENT_SCHEMA_VERSION ? null : sourceSchemaVersion
  if (migratedFrom !== null) {
    root.setAttribute('data-nanquim-version', String(DOCUMENT_SCHEMA_VERSION))
    addDiagnostic(diagnostics, 'schema-migrated')
  }
  return {
    kind: 'native',
    isNative: true,
    sourceSchemaVersion,
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    migratedFrom,
    requiresSave: migratedFrom !== null,
  }
}

function parseViewBox(root, diagnostics) {
  const raw = root.getAttribute('viewBox')
  if (raw === null) return null
  const values = raw.trim().split(/[\s,]+/).map(Number)
  if (
    values.length !== 4
    || values.some((value) => !Number.isFinite(value) || Math.abs(value) > 1000000000)
    || values[2] < 0
    || values[3] < 0
  ) {
    addDiagnostic(diagnostics, 'invalid-view-box')
    return null
  }
  return { x: values[0], y: values[1], width: values[2], height: values[3] }
}

function parseElementIndex(root, diagnostics) {
  const raw = root.getAttribute('data-element-index')
  if (raw === null) return null
  if (!/^\d+$/.test(raw.trim())) {
    addDiagnostic(diagnostics, 'invalid-element-index')
    return null
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ELEMENT_INDEX) {
    addDiagnostic(diagnostics, 'invalid-element-index')
    return null
  }
  return value
}

function parseActiveCollectionId(root, diagnostics) {
  const raw = root.getAttribute('data-active-collection-id')
  if (raw === null) return null
  const value = raw.trim()
  if (!value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    addDiagnostic(diagnostics, 'invalid-active-collection')
    return null
  }
  return value
}

function parseConvertedStrokes(root, diagnostics) {
  const raw = root.getAttribute('data-nanquim-converted-strokes')
  if (raw === null || raw === 'false') return false
  if (raw === 'true') return true
  addDiagnostic(diagnostics, 'invalid-converted-strokes')
  return false
}

function parseJsonMetadata(root, diagnostics, rawMetadataAttributes = new Set()) {
  const metadata = {}
  JSON_METADATA.forEach((descriptor) => {
    const raw = root.getAttribute(descriptor.attribute)
    if (raw === null) {
      if (rawMetadataAttributes.has(descriptor.attribute)) {
        addDiagnostic(diagnostics, descriptor.diagnostic)
      }
      metadata[descriptor.field] = null
      return
    }
    const value = parseSafeJson(raw, DOCUMENT_METADATA_LIMITS[descriptor.attribute])
    if (value === null) addDiagnostic(diagnostics, descriptor.diagnostic)
    metadata[descriptor.field] = value
  })
  return metadata
}

function parseGeometryNodes(root, diagnostics) {
  const nodes = Array.from(root.children).filter(
    (child) => child.localName.toLowerCase() === 'metadata'
      && child.getAttribute('id') === 'nanquim-geometry-nodes',
  )
  if (nodes.length === 0) return null
  if (nodes.length !== 1) {
    addDiagnostic(diagnostics, 'duplicate-geometry-nodes')
    return null
  }
  const value = parseSafeJson(nodes[0].textContent, GEOMETRY_NODES_METADATA_LIMITS)
  if (value === null) addDiagnostic(diagnostics, 'invalid-geometry-nodes')
  return value
}

function parsePaperAnnotations(root, diagnostics) {
  const annotations = Array.from(root.children).filter(
    (child) => child.getAttribute('data-nanquim-paper-annotations') === 'true',
  )
  if (annotations.length === 0) return null
  if (annotations.length !== 1) {
    addDiagnostic(diagnostics, 'duplicate-paper-annotations')
    return null
  }
  return annotations[0]
}

function prepareDocumentSource(source, options = {}) {
  assertBoundedSource(source)
  const format = inferSourceFormat(options)
  const svgSource = format === 'dxf' ? convertDxfToSvg(source) : repairLegacySvgjsNamespace(source)
  const parsed = parseSvgDocument(svgSource)
  const { rawMetadataAttributes, root, sanitization } = parsed
  const diagnostics = []
  if (sanitization.changed) addDiagnostic(diagnostics, 'sanitized-content')
  const schema = classifySchema(root, format, diagnostics)
  const jsonMetadata = parseJsonMetadata(root, diagnostics, rawMetadataAttributes)
  const paperAnnotations = parsePaperAnnotations(root, diagnostics)

  const metadata = Object.freeze({
    viewBox: parseViewBox(root, diagnostics),
    elementIndex: parseElementIndex(root, diagnostics),
    activeCollectionId: parseActiveCollectionId(root, diagnostics),
    convertedStrokes: parseConvertedStrokes(root, diagnostics),
    paperConfig: jsonMetadata.paperConfig,
    paperViewports: jsonMetadata.paperViewports,
    dimensionStyles: jsonMetadata.dimensionStyles,
    textStyles: jsonMetadata.textStyles,
    blockDefinitions: jsonMetadata.blockDefinitions,
    geometryNodes: parseGeometryNodes(root, diagnostics),
  })

  return Object.freeze({
    ...schema,
    requiresSave: schema.requiresSave || diagnostics.length > 0,
    format,
    sourceName: boundedSourceName(options.name || options.fileName),
    root,
    metadata,
    paperAnnotations,
    diagnostics: Object.freeze(diagnostics.slice(0, MAX_DOCUMENT_DIAGNOSTICS)),
  })
}

async function prepareDocumentFile(file) {
  const source = await readFileText(file)
  return prepareDocumentSource(source, {
    name: file.name,
    type: file.type,
  })
}

export {
  DOCUMENT_METADATA_LIMITS,
  DocumentOpenError,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_DIAGNOSTICS,
  MAX_DOCUMENT_ELEMENTS,
  prepareDocumentFile,
  prepareDocumentSource,
  readFileText,
}
