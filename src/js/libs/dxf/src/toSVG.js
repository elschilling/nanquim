import { Box2 } from 'vecks'

import entityToPolyline from './entityToPolyline'
import denormalise from './denormalise'
import getRGBForEntity from './getRGBForEntity'
import logger from './util/logger'
import rotate from './util/rotate'
import rgbToColorAttribute from './util/rgbToColorAttribute'
import toPiecewiseBezier, { multiplicity } from './util/toPiecewiseBezier'
import transformBoundingBoxAndElement from './util/transformBoundingBoxAndElement'

const DEFAULT_DXF_VIEW_BOX = Object.freeze({ x: -5, y: -5, width: 10, height: 10 })
const MAX_DXF_COORDINATE = 1000000000
const MAX_REPORTED_ENTITY_TYPES = 12
const FULL_ROTATION = Math.PI * 2
const SVG_NUMBER_PATTERN = /[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?/gi
const DXF_UNITS_TO_CENTIMETERS = new Map([
  [1, Object.freeze({ factor: 2.54, name: 'inches' })],
  [2, Object.freeze({ factor: 30.48, name: 'feet' })],
  [4, Object.freeze({ factor: 0.1, name: 'millimeters' })],
  [5, Object.freeze({ factor: 1, name: 'centimeters' })],
  [6, Object.freeze({ factor: 100, name: 'meters' })],
  [10, Object.freeze({ factor: 91.44, name: 'yards' })],
])

function escapeXmlAttribute(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character])
}

function safeEntityType(value) {
  const normalized = String(value || '').trim().toUpperCase()
  return /^[A-Z0-9_]{1,32}$/.test(normalized) ? normalized : 'OTHER'
}

function recordSkippedEntity(report, type, count = 1) {
  if (!report || typeof report !== 'object' || !Number.isSafeInteger(count) || count < 1) return
  if (!report.skippedEntityTypes || typeof report.skippedEntityTypes !== 'object') {
    report.skippedEntityTypes = Object.create(null)
  }
  const key = safeEntityType(type)
  const keys = Object.keys(report.skippedEntityTypes)
  const target = (
    Object.prototype.hasOwnProperty.call(report.skippedEntityTypes, key)
    || keys.length < MAX_REPORTED_ENTITY_TYPES
  )
    ? key
    : 'OTHER'
  report.skippedEntityTypes[target] = (report.skippedEntityTypes[target] || 0) + count
}

function hasBoundedNumericValues(value) {
  const pending = [value]
  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Math.abs(current) > MAX_DXF_COORDINATE) return false
      continue
    }
    if (!current || typeof current !== 'object') continue
    if (Array.isArray(current)) pending.push(...current)
    else pending.push(...Object.values(current))
  }
  return true
}

function hasBoundedSvgNumbers(element) {
  SVG_NUMBER_PATTERN.lastIndex = 0
  for (const match of element.matchAll(SVG_NUMBER_PATTERN)) {
    const value = Number(match[0])
    if (!Number.isFinite(value) || Math.abs(value) > MAX_DXF_COORDINATE) return false
  }
  return !/(?:^|[^a-z0-9_.])(?:nan|[-+]?infinity)(?=$|[^a-z0-9_.])/i.test(element)
}

function hasValidEntityDimensions(entity) {
  if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
    return Number.isFinite(entity.r) && entity.r > 0
  }
  if (entity.type === 'ELLIPSE') {
    const majorRadius = Math.hypot(entity.majorX, entity.majorY)
    return Number.isFinite(majorRadius)
      && majorRadius > 0
      && Number.isFinite(entity.axisRatio)
      && entity.axisRatio > 0
  }
  return true
}

function normalizedArcAngles(startAngle, endAngle) {
  const start = ((startAngle % FULL_ROTATION) + FULL_ROTATION) % FULL_ROTATION
  const rawSweep = endAngle - startAngle
  let sweep = ((rawSweep % FULL_ROTATION) + FULL_ROTATION) % FULL_ROTATION
  if (Math.abs(sweep) < 1e-9 || Math.abs(sweep - FULL_ROTATION) < 1e-9) {
    sweep = FULL_ROTATION
  }
  return { start, end: start + sweep, full: sweep === FULL_ROTATION }
}

function scaledBoundsAreSafe(bbox, scale) {
  if (!bbox?.valid || !Number.isFinite(scale) || scale <= 0) return false
  const minX = bbox.min.x * scale
  const minY = bbox.min.y * scale
  const maxX = bbox.max.x * scale
  const maxY = bbox.max.y * scale
  const width = (bbox.max.x - bbox.min.x) * scale
  const height = (bbox.max.y - bbox.min.y) * scale
  return [minX, minY, maxX, maxY, width, height].every(Number.isFinite)
    && [minX, minY, maxX, maxY].every(value => Math.abs(value) <= MAX_DXF_COORDINATE)
    && width >= 0
    && height >= 0
    && width <= MAX_DXF_COORDINATE
    && height <= MAX_DXF_COORDINATE
}

function combinedBounds(current, incoming) {
  const next = new Box2()
  if (current.valid) {
    next.expandByPoint(current.min)
    next.expandByPoint(current.max)
  }
  next.expandByPoint(incoming.min)
  next.expandByPoint(incoming.max)
  return next
}

function coordinateScale(parsed, report) {
  const rawCode = parsed?.header?.insUnits
  const code = Number.isSafeInteger(rawCode) ? rawCode : 0
  const profile = DXF_UNITS_TO_CENTIMETERS.get(code)
  if (profile) {
    if (report) {
      report.units = {
        code,
        factor: profile.factor,
        name: profile.name,
        status: profile.factor === 1 ? 'centimeters' : 'converted',
      }
    }
    return profile.factor
  }
  if (report) {
    report.units = {
      code,
      factor: 1,
      name: null,
      status: code === 0 ? 'unitless' : 'unsupported',
    }
  }
  return 1
}

function positiveViewBox(bounds, scale) {
  if (!bounds.valid) return { ...DEFAULT_DXF_VIEW_BOX }
  let x = bounds.min.x * scale
  let y = -bounds.max.y * scale
  let width = (bounds.max.x - bounds.min.x) * scale
  let height = (bounds.max.y - bounds.min.y) * scale
  if (
    ![x, y, width, height].every(Number.isFinite)
    || Math.abs(x) > MAX_DXF_COORDINATE
    || Math.abs(y) > MAX_DXF_COORDINATE
    || width > MAX_DXF_COORDINATE
    || height > MAX_DXF_COORDINATE
  ) return { ...DEFAULT_DXF_VIEW_BOX }
  if (width <= 0) {
    width = 1
    x = Math.min(
      MAX_DXF_COORDINATE - width,
      Math.max(-MAX_DXF_COORDINATE, x - width / 2),
    )
  }
  if (height <= 0) {
    height = 1
    y = Math.min(
      MAX_DXF_COORDINATE - height,
      Math.max(-MAX_DXF_COORDINATE, y - height / 2),
    )
  }
  return { x, y, width, height }
}

const addFlipXIfApplicable = (entity, { bbox, element }) => {
  if (entity.extrusionZ === -1) {
    return {
      bbox: new Box2()
        .expandByPoint({ x: -bbox.min.x, y: bbox.min.y })
        .expandByPoint({ x: -bbox.max.x, y: bbox.max.y }),
      element: `<g transform="matrix(-1 0 0 1 0 0)">
        ${element}
      </g>`,
    }
  } else {
    return { bbox, element }
  }
}

/**
 * Create a <line /> element for the LINE entity.
 */
const line = (entity) => {
  const x1 = entity.start.x || 0
  const y1 = entity.start.y || 0
  const x2 = entity.end.x || 0
  const y2 = entity.end.y || 0
  const bbox = new Box2()
    .expandByPoint({ x: x1, y: y1 })
    .expandByPoint({ x: x2, y: y2 })
  const element = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`
  const { bbox: bbox0, element: element0 } = addFlipXIfApplicable(entity, { bbox, element })
  return transformBoundingBoxAndElement(bbox0, element0, entity.transforms)
}

/**
 * Create a <path /> element. Interpolates curved entities.
 */
const polyline = (entity) => {
  const vertices = entityToPolyline(entity)
  const bbox = vertices.reduce(
    (acc, [x, y]) => acc.expandByPoint({ x, y }),
    new Box2(),
  )
  const d = vertices.reduce((acc, point, i) => {
    acc += i === 0 ? 'M' : 'L'
    acc += point[0] + ',' + point[1]
    return acc
  }, '')
  // Empirically it appears that flipping horzontally does not apply to polyline
  return transformBoundingBoxAndElement(
    bbox,
    `<path d="${d}" />`,
    entity.transforms,
  )
}

/**
 * Create a <circle /> element for the CIRCLE entity.
 */
const circle = (entity) => {
  const bbox0 = new Box2()
    .expandByPoint({
      x: entity.x + entity.r,
      y: entity.y + entity.r,
    })
    .expandByPoint({
      x: entity.x - entity.r,
      y: entity.y - entity.r,
    })
  const element0 = `<circle cx="${entity.x}" cy="${entity.y}" r="${entity.r}" />`
  const { bbox, element } = addFlipXIfApplicable(entity, {
    bbox: bbox0,
    element: element0,
  })
  return transformBoundingBoxAndElement(bbox, element, entity.transforms)
}

/**
 * Create a a <path d="A..." /> or <ellipse /> element for the ARC or ELLIPSE
 * DXF entity (<ellipse /> if start and end point are the same).
 */
const ellipseOrArc = (
  cx,
  cy,
  majorX,
  majorY,
  axisRatio,
  startAngle,
  endAngle,
  flipX,
) => {
  const angles = normalizedArcAngles(startAngle, endAngle)
  startAngle = angles.start
  endAngle = angles.end
  const rx = Math.sqrt(majorX * majorX + majorY * majorY)
  const ry = axisRatio * rx
  const rotationAngle = -Math.atan2(-majorY, majorX)

  const bbox = bboxEllipseOrArc(
    cx,
    cy,
    majorX,
    majorY,
    axisRatio,
    startAngle,
    endAngle,
    flipX,
  )

  if (angles.full) {
    // Use a native <ellipse> when start and end angles are the same, and
    // arc paths with same start and end points don't render (at least on Safari)
    const element = `<g transform="rotate(${(rotationAngle / Math.PI) * 180
      } ${cx}, ${cy})">
      <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" />
    </g>`
    return { bbox, element }
  } else {
    const startOffset = rotate(
      {
        x: Math.cos(startAngle) * rx,
        y: Math.sin(startAngle) * ry,
      },
      rotationAngle,
    )
    const startPoint = {
      x: cx + startOffset.x,
      y: cy + startOffset.y,
    }
    const endOffset = rotate(
      {
        x: Math.cos(endAngle) * rx,
        y: Math.sin(endAngle) * ry,
      },
      rotationAngle,
    )
    const endPoint = {
      x: cx + endOffset.x,
      y: cy + endOffset.y,
    }
    const adjustedEndAngle = endAngle

    const midAngle = startAngle + (adjustedEndAngle - startAngle) / 2
    const midOffset = rotate(
      {
        x: Math.cos(midAngle) * rx,
        y: Math.sin(midAngle) * ry,
      },
      rotationAngle,
    )
    const midPoint = {
      x: cx + midOffset.x,
      y: cy + midOffset.y,
    }

    const largeArcFlag = adjustedEndAngle - startAngle < Math.PI ? 0 : 1
    const d = `M ${startPoint.x} ${startPoint.y} A ${rx} ${ry} ${(rotationAngle / Math.PI) * 180
      } ${largeArcFlag} 1 ${endPoint.x} ${endPoint.y}`

    const arcDataStr = JSON.stringify({ p1: startPoint, p2: midPoint, p3: endPoint }).replace(/"/g, '&quot;')
    const element = `<path d="${d}" data-arc-data="${arcDataStr}" />`

    return { bbox, element }
  }
}

/**
 * Compute the bounding box of an elliptical arc, given the DXF entity parameters
 */
const bboxEllipseOrArc = (
  cx,
  cy,
  majorX,
  majorY,
  axisRatio,
  startAngle,
  endAngle,
  flipX,
) => {
  // The bounding box will be defined by the starting point of the ellipse, and ending point,
  // and any extrema on the ellipse that are between startAngle and endAngle.
  // The extrema are found by setting either the x or y component of the ellipse's
  // tangent vector to zero and solving for the angle.

  // When rotated, the extrema of the ellipse will be found at these angles
  const angles = []

  if (Math.abs(majorX) < 1e-12 || Math.abs(majorY) < 1e-12) {
    // Special case for majorX or majorY = 0
    for (let i = 0; i < 4; i++) {
      angles.push((i / 2) * Math.PI)
    }
  } else {
    // reference https://github.com/bjnortier/dxf/issues/47#issuecomment-545915042
    angles[0] = Math.atan((-majorY * axisRatio) / majorX) - Math.PI // Ensure angles < 0
    angles[1] = Math.atan((majorX * axisRatio) / majorY) - Math.PI
    angles[2] = angles[0] - Math.PI
    angles[3] = angles[1] - Math.PI
  }

  // Remove angles not falling between start and end
  for (let i = angles.length - 1; i >= 0; i--) {
    while (angles[i] < startAngle) angles[i] += FULL_ROTATION
    if (angles[i] > endAngle) {
      angles.splice(i, 1)
    }
  }

  // Also to consider are the starting and ending points:
  angles.push(startAngle)
  angles.push(endAngle)

  // Compute points lying on the unit circle at these angles
  const pts = angles.map((a) => ({
    x: Math.cos(a),
    y: Math.sin(a),
  }))

  // Transformation matrix, formed by the major and minor axes
  const M = [
    [majorX, -majorY * axisRatio],
    [majorY, majorX * axisRatio],
  ]

  // Rotate, scale, and translate points
  const rotatedPts = pts.map((p) => ({
    x: p.x * M[0][0] + p.y * M[0][1] + cx,
    y: p.x * M[1][0] + p.y * M[1][1] + cy,
  }))

  // Compute extents of bounding box
  const bbox = rotatedPts.reduce((acc, p) => {
    acc.expandByPoint(p)
    return acc
  }, new Box2())

  return bbox
}

/**
 * An ELLIPSE is defined by the major axis, convert to X and Y radius with
 * a rotation angle
 */
const ellipse = (entity) => {
  const { bbox: bbox0, element: element0 } = ellipseOrArc(
    entity.x,
    entity.y,
    entity.majorX,
    entity.majorY,
    entity.axisRatio,
    entity.startAngle,
    entity.endAngle,
  )
  const { bbox, element } = addFlipXIfApplicable(entity, {
    bbox: bbox0,
    element: element0,
  })
  return transformBoundingBoxAndElement(bbox, element, entity.transforms)
}

/**
 * An ARC is an ellipse with equal radii
 */
const arc = (entity) => {
  const { bbox: bbox0, element: element0 } = ellipseOrArc(
    entity.x,
    entity.y,
    entity.r,
    0,
    1,
    entity.startAngle,
    entity.endAngle,
    entity.extrusionZ === -1,
  )
  const { bbox, element } = addFlipXIfApplicable(entity, {
    bbox: bbox0,
    element: element0,
  })
  return transformBoundingBoxAndElement(bbox, element, entity.transforms)
}

export const piecewiseToPaths = (k, knots, controlPoints) => {
  const paths = []
  let controlPointIndex = 0
  let knotIndex = k
  while (knotIndex < knots.length - k + 1) {
    const m = multiplicity(knots, knotIndex)
    const cp = controlPoints.slice(controlPointIndex, controlPointIndex + k)
    if (k === 4) {
      paths.push(
        `<path d="M ${cp[0].x} ${cp[0].y} C ${cp[1].x} ${cp[1].y} ${cp[2].x} ${cp[2].y} ${cp[3].x} ${cp[3].y}" />`,
      )
    } else if (k === 3) {
      paths.push(
        `<path d="M ${cp[0].x} ${cp[0].y} Q ${cp[1].x} ${cp[1].y} ${cp[2].x} ${cp[2].y}" />`,
      )
    }
    controlPointIndex += m
    knotIndex += m
  }
  return paths
}

const bezier = (entity) => {
  let bbox = new Box2()
  entity.controlPoints.forEach((p) => {
    bbox = bbox.expandByPoint(p)
  })
  const k = entity.degree + 1
  const piecewise = toPiecewiseBezier(k, entity.controlPoints, entity.knots)
  const paths = piecewiseToPaths(k, piecewise.knots, piecewise.controlPoints)
  const element = `<g>${paths.join('')}</g>`
  return transformBoundingBoxAndElement(bbox, element, entity.transforms)
}

/**
 * Switcth the appropriate function on entity type. CIRCLE, ARC and ELLIPSE
 * produce native SVG elements, the rest produce interpolated polylines.
 */
const entityToBoundsAndElement = (entity, report) => {
  switch (entity.type) {
    case 'CIRCLE':
      return circle(entity)
    case 'ELLIPSE':
      return ellipse(entity)
    case 'ARC':
      return arc(entity)
    case 'SPLINE': {
      const hasWeights = entity.weights && entity.weights.some((w) => w !== 1)
      if ((entity.degree === 2 || entity.degree === 3) && !hasWeights) {
        try {
          return bezier(entity)
        } catch (err) {
          return polyline(entity)
        }
      } else {
        return polyline(entity)
      }
    }
    case 'LINE':
      return line(entity)
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      return polyline(entity)
    }
    default:
      logger.warn('entity type not supported in SVG rendering:', entity.type)
      recordSkippedEntity(report, entity.type)
      return null
  }
}

export default (parsed, options = {}) => {
  const report = options.report && typeof options.report === 'object' ? options.report : null
  const unitScale = coordinateScale(parsed, report)
  const parserSkipped = parsed?.diagnostics?.unsupportedEntityTypes
  if (parserSkipped && typeof parserSkipped === 'object') {
    Object.entries(parserSkipped).forEach(([type, count]) => recordSkippedEntity(report, type, count))
  }
  const entities = denormalise(parsed, {
    ...(options.limits || {}),
    report,
  })
  const layerTable = parsed?.tables?.layers || Object.create(null)

  // Group entities by layer
  const groupedEntities = entities.reduce((groups, entity) => {
    const layer = entity.layer || 'Default'
    if (!groups.has(layer)) groups.set(layer, [])
    groups.get(layer).push(entity)
    return groups
  }, new Map())

  let globalBbox = new Box2()
  const layerGroups = []
  let collectionIndex = 1

  // Process each layer
  groupedEntities.forEach((layerEntities, layerName) => {
    const layerElements = []

    // Find layer attributes from the header tables if available
    let layerColor = '#ffffff'
    const layerData = Object.prototype.hasOwnProperty.call(layerTable, layerName)
      ? layerTable[layerName]
      : null
    if (layerData) {
      layerColor = rgbToColorAttribute(getRGBForEntity(layerTable, { layer: layerName, colorNumber: layerData.colorNumber }))
    }
    const layerFlags = Number.isInteger(layerData?.flags) ? layerData.flags : 0
    const hidden = Number(layerData?.colorNumber) < 0 || (layerFlags & 1) !== 0
    const locked = (layerFlags & 4) !== 0

    const insertGroups = new Map()

    layerEntities.forEach((entity) => {
      const rgb = getRGBForEntity(layerTable, entity)
      if (!hasBoundedNumericValues(entity) || !hasValidEntityDimensions(entity)) {
        recordSkippedEntity(report, entity.type)
        return
      }

      let boundsAndElement
      try {
        boundsAndElement = entityToBoundsAndElement(entity, report)
      } catch (error) {
        logger.warn('invalid entity skipped in SVG rendering:', safeEntityType(entity.type))
        recordSkippedEntity(report, entity.type)
        return
      }

      if (boundsAndElement) {
        const { bbox, element } = boundsAndElement
        if (!hasBoundedSvgNumbers(element) || !scaledBoundsAreSafe(bbox, unitScale)) {
          recordSkippedEntity(report, entity.type)
          return
        }
        const nextGlobalBbox = combinedBounds(globalBbox, bbox)
        if (!scaledBoundsAreSafe(nextGlobalBbox, unitScale)) {
          recordSkippedEntity(report, entity.type)
          return
        }
        globalBbox = nextGlobalBbox

        // Entity inherits layer color by default, unless it specifies its own
        const strokeColor = rgbToColorAttribute(rgb)
        const entityHidden = entity.visible === false
        const svgString = `<g stroke="${strokeColor}"${entityHidden ? ' data-hidden="true" style="display:none"' : ''}>${element}</g>`

        if (entity.insertGroup) {
          if (!insertGroups.has(entity.insertGroup)) {
            insertGroups.set(entity.insertGroup, { name: entity.insertName, elements: [] })
          }
          insertGroups.get(entity.insertGroup).elements.push(svgString)
        } else {
          layerElements.push(svgString)
        }
      }
    })

    // Add block insert groups to the layer
    insertGroups.forEach((groupData, groupId) => {
      const sanitizedName = escapeXmlAttribute(groupData.name || 'Block')
      layerElements.push(`
        <g id="${String(groupId).replace(/[^a-zA-Z0-9_\-]/g, '_')}" data-group="true" name="${sanitizedName}">
          ${groupData.elements.join('\n')}
        </g>
      `)
    })

    if (layerElements.length > 0) {
      // Build the nanquim-compatible collection group wrapper
      // Apply the DXF Y-inversion matrix directly to the collection group so they remain root-level layers
      layerGroups.push(`
        <g
          id="collection-dxf-${collectionIndex++}"
          data-collection="true"
          data-hidden="${hidden ? 'true' : 'false'}"
          data-locked="${locked ? 'true' : 'false'}"
          name="${escapeXmlAttribute(layerName)}"
          stroke="${layerColor}"
          stroke-width="0.1"
          stroke-linecap="round"
          fill="transparent"
          ${hidden ? 'style="display:none"' : ''}
          transform="matrix(${unitScale},0,0,${-unitScale},0,0)"
        >
          ${layerElements.join('\n')}
        </g>
      `)
    }
  })

  const viewBox = positiveViewBox(globalBbox, unitScale)

  return `<?xml version="1.0"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  preserveAspectRatio="xMinYMin meet"
  viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"
  width="100%" height="100%"
>
${layerGroups.join('\n')}
</svg>`
}
