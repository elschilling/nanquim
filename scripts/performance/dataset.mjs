const SVG_NS = 'http://www.w3.org/2000/svg'
const DOCUMENT_SCHEMA_VERSION = 3
const DATASET_SPACING = 12
const DATASET_PADDING = 24
const SUPPORTED_DATASET_SIZES = new Set([1000, 10000])

function assertDatasetSize(size) {
  if (!Number.isSafeInteger(size) || !SUPPORTED_DATASET_SIZES.has(size)) {
    throw new RangeError('Performance dataset size must be exactly 1,000 or 10,000 elements.')
  }
  return size
}

function createDatasetDefinition(size) {
  assertDatasetSize(size)
  const columns = Math.ceil(Math.sqrt(size))
  const rows = Math.ceil(size / columns)
  const contentWidth = (columns - 1) * DATASET_SPACING + 8
  const contentHeight = (rows - 1) * DATASET_SPACING + 8
  return Object.freeze({
    columns,
    count: size,
    padding: DATASET_PADDING,
    rows,
    spacing: DATASET_SPACING,
    viewBox: Object.freeze({
      x: -DATASET_PADDING,
      y: -DATASET_PADDING,
      width: contentWidth + DATASET_PADDING * 2,
      height: contentHeight + DATASET_PADDING * 2,
    }),
  })
}

function elementDescriptorAt(index, definitionOrSize) {
  const definition = typeof definitionOrSize === 'number'
    ? createDatasetDefinition(definitionOrSize)
    : definitionOrSize
  if (
    !definition
    || !Number.isSafeInteger(index)
    || index < 0
    || index >= definition.count
  ) {
    throw new RangeError('Performance element index is outside the dataset.')
  }

  const x = (index % definition.columns) * definition.spacing
  const y = Math.floor(index / definition.columns) * definition.spacing
  const id = String(index + 1)
  switch (index % 4) {
    case 0:
      return Object.freeze({ id, type: 'line', x1: x, y1: y, x2: x + 8, y2: y + 4 })
    case 1:
      return Object.freeze({ id, type: 'rect', x, y, width: 8, height: 6 })
    case 2:
      return Object.freeze({ id, type: 'circle', cx: x + 4, cy: y + 4, r: 3 })
    default:
      return Object.freeze({
        id,
        type: 'polyline',
        points: Object.freeze([[x, y], [x + 4, y + 7], [x + 8, y + 2]]),
      })
  }
}

function * iterateElementDescriptors(definitionOrSize) {
  const definition = typeof definitionOrSize === 'number'
    ? createDatasetDefinition(definitionOrSize)
    : definitionOrSize
  assertDatasetSize(definition?.count)
  for (let index = 0; index < definition.count; index += 1) {
    yield elementDescriptorAt(index, definition)
  }
}

function descriptorMarkup(descriptor) {
  if (descriptor.type === 'line') {
    return `<line id="${descriptor.id}" x1="${descriptor.x1}" y1="${descriptor.y1}" x2="${descriptor.x2}" y2="${descriptor.y2}"/>`
  }
  if (descriptor.type === 'rect') {
    return `<rect id="${descriptor.id}" x="${descriptor.x}" y="${descriptor.y}" width="${descriptor.width}" height="${descriptor.height}"/>`
  }
  if (descriptor.type === 'circle') {
    return `<circle id="${descriptor.id}" cx="${descriptor.cx}" cy="${descriptor.cy}" r="${descriptor.r}"/>`
  }
  const points = descriptor.points.map(point => point.join(',')).join(' ')
  return `<polyline id="${descriptor.id}" points="${points}"/>`
}

function fnv1a(value) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function createNativeSvgDataset(size) {
  const definition = createDatasetDefinition(size)
  const { viewBox } = definition
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="${SVG_NS}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}" data-nanquim-version="${DOCUMENT_SCHEMA_VERSION}" data-element-index="${size + 1}" data-active-collection-id="collection-performance" data-nanquim-converted-strokes="false">`,
    '<g id="collection-performance" name="Performance fixture" data-collection="true" data-locked="false" style="stroke:#ffffff;stroke-width:0.1;stroke-linecap:round;fill:transparent;opacity:1">',
  ]
  for (const descriptor of iterateElementDescriptors(definition)) {
    parts.push(descriptorMarkup(descriptor))
  }
  parts.push('</g>', '</svg>', '')
  const source = parts.join('\n')
  return Object.freeze({
    checksum: `fnv1a-${fnv1a(source)}`,
    definition,
    source,
    sourceBytes: Buffer.byteLength(source, 'utf8'),
  })
}

export {
  createDatasetDefinition,
  createNativeSvgDataset,
  elementDescriptorAt,
  iterateElementDescriptors,
}
