import { getDrawableElements } from '../Collection'
import { hasUnsupportedGeometryTransform } from './geometryTransformQualification'

const HATCH_TRANSFORM_DIAGNOSTIC = 'HATCH does not support transformed boundaries near the selected region.'
const HATCH_BOUNDARY_TYPES = new Set([
  'circle',
  'ellipse',
  'line',
  'path',
  'polygon',
  'polyline',
  'rect',
])
const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0]
const BOUNDS_EPSILON = 1e-6

// Boundary detection currently consumes element-local coordinates. Until it
// is fully transform-aware, transformed leaves are excluded from that graph.
// Their root-space bounds are grouped by transform scope so HATCH can reject
// only a clicked/candidate region they may affect; unreadable bounds fail safe.

function matrixValues(matrix) {
  const values = [matrix?.a, matrix?.b, matrix?.c, matrix?.d, matrix?.e, matrix?.f]
    .map(Number)
  return values.every(Number.isFinite) ? values : null
}

function multiplyMatrices(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

function invertMatrix(matrix) {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2]
  if (Math.abs(determinant) < Number.EPSILON) return null
  return [
    matrix[3] / determinant,
    -matrix[1] / determinant,
    -matrix[2] / determinant,
    matrix[0] / determinant,
    (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
    (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant,
  ]
}

function transformPoint(matrix, point) {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  }
}

function hasCssTransform(node) {
  const inline = node?.style?.transform
  if (inline && inline !== 'none') return true
  if (node?.getAttribute?.('transform')) return false

  const computed = node?.ownerDocument?.defaultView?.getComputedStyle?.(node)?.transform
  return Boolean(computed && computed !== 'none')
}

function matrixFromScreenCoordinates(element, drawing) {
  if (typeof element?.node?.getScreenCTM !== 'function'
    || typeof drawing?.node?.getScreenCTM !== 'function') return null
  try {
    const elementMatrix = matrixValues(element.screenCTM())
    const drawingMatrix = matrixValues(drawing.screenCTM())
    if (!elementMatrix || !drawingMatrix) return null
    const inverseDrawing = invertMatrix(drawingMatrix)
    return inverseDrawing ? multiplyMatrices(inverseDrawing, elementMatrix) : null
  } catch (_error) {
    return null
  }
}

function matrixFromSvgTransforms(element, drawing) {
  let current = element
  let matrix = IDENTITY_MATRIX

  while (current?.node && current.node !== drawing?.node) {
    if (hasCssTransform(current.node)) return null
    let local
    try {
      local = matrixValues(current.matrixify())
    } catch (_error) {
      return null
    }
    if (!local) return null
    matrix = multiplyMatrices(local, matrix)
    current = current.parent()
  }

  return current?.node === drawing?.node ? matrix : null
}

function matrixToDrawing(element, drawing) {
  // Prefer the rendered CTM so stylesheet transforms are included. SVG
  // attributes remain composable without a rendered browser (important for
  // deterministic tests and detached candidates).
  return matrixFromScreenCoordinates(element, drawing)
    || matrixFromSvgTransforms(element, drawing)
}

function boundsFromPoints(points) {
  if (!points.length) return null
  let maxX = -Infinity
  let maxY = -Infinity
  let minX = Infinity
  let minY = Infinity
  for (const { x, y } of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
  }
  return { maxX, maxY, minX, minY }
}

function elementLocalBounds(element) {
  if (element.type === 'line') {
    return boundsFromPoints([
      { x: Number(element.attr('x1')), y: Number(element.attr('y1')) },
      { x: Number(element.attr('x2')), y: Number(element.attr('y2')) },
    ])
  }

  if (element.type === 'polyline' || element.type === 'polygon') {
    return boundsFromPoints(element.array().map(([x, y]) => ({ x: Number(x), y: Number(y) })))
  }

  if (element.type === 'circle' || element.type === 'ellipse') {
    const cx = Number(element.cx())
    const cy = Number(element.cy())
    const rx = element.type === 'circle' ? Number(element.attr('r')) : Number(element.attr('rx'))
    const ry = element.type === 'circle' ? rx : Number(element.attr('ry'))
    if (![cx, cy, rx, ry].every(Number.isFinite)) return null
    return { minX: cx - rx, maxX: cx + rx, minY: cy - ry, maxY: cy + ry }
  }

  if (element.type === 'rect') {
    const x = Number(element.x())
    const y = Number(element.y())
    const width = Number(element.width())
    const height = Number(element.height())
    if (![x, y, width, height].every(Number.isFinite)) return null
    return boundsFromPoints([
      { x, y },
      { x: x + width, y: y + height },
    ])
  }

  try {
    const box = element.bbox()
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null
    if (box.width === 0 && box.height === 0) return null
    return boundsFromPoints([
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
    ])
  } catch (_error) {
    return null
  }
}

function transformBounds(bounds, matrix) {
  return boundsFromPoints([
    transformPoint(matrix, { x: bounds.minX, y: bounds.minY }),
    transformPoint(matrix, { x: bounds.maxX, y: bounds.minY }),
    transformPoint(matrix, { x: bounds.maxX, y: bounds.maxY }),
    transformPoint(matrix, { x: bounds.minX, y: bounds.maxY }),
  ])
}

function mergeBounds(first, second) {
  if (!first) return second
  return {
    maxX: Math.max(first.maxX, second.maxX),
    maxY: Math.max(first.maxY, second.maxY),
    minX: Math.min(first.minX, second.minX),
    minY: Math.min(first.minY, second.minY),
  }
}

function nodeHasTransform(node) {
  const attribute = node?.getAttribute?.('transform')
  return Boolean(attribute?.trim()) || hasCssTransform(node)
}

function transformedScopeNode(element, drawing) {
  let current = element
  let scope = element.node
  while (current?.node && current.node !== drawing?.node) {
    if (nodeHasTransform(current.node)) scope = current.node
    current = current.parent()
  }
  return scope
}

function isBoundaryCandidate(element) {
  if (!HATCH_BOUNDARY_TYPES.has(element.type)) return false
  return !element.hasClass('grid')
    && !element.hasClass('axis')
    && !element.hasClass('ghostLine')
    && !element.hasClass('hatch-fill')
}

function qualifyHatchGeometry(editor) {
  const safeElements = []
  const transformedScopes = new Map()
  let hasUnknownBounds = false

  getDrawableElements(editor).forEach((element) => {
    try {
      if (!isBoundaryCandidate(element)
        || !hasUnsupportedGeometryTransform(element, editor.drawing)) {
        safeElements.push(element)
        return
      }

      const localBounds = elementLocalBounds(element)
      const matrix = matrixToDrawing(element, editor.drawing)
      const rootBounds = localBounds && matrix ? transformBounds(localBounds, matrix) : null
      if (!rootBounds) {
        hasUnknownBounds = true
        return
      }

      const scope = transformedScopeNode(element, editor.drawing)
      transformedScopes.set(scope, mergeBounds(transformedScopes.get(scope), rootBounds))
    } catch (_error) {
      // An unreadable transformed candidate cannot be proved unrelated. Keep
      // it out of local-space tracing and use the conservative fixed warning.
      hasUnknownBounds = true
    }
  })

  return {
    hasUnknownBounds,
    safeElements,
    transformedBounds: [...transformedScopes.values()],
  }
}

function boundsContainPoint(bounds, point) {
  return point.x >= bounds.minX - BOUNDS_EPSILON
    && point.x <= bounds.maxX + BOUNDS_EPSILON
    && point.y >= bounds.minY - BOUNDS_EPSILON
    && point.y <= bounds.maxY + BOUNDS_EPSILON
}

function boundsIntersect(first, second) {
  return first.minX <= second.maxX + BOUNDS_EPSILON
    && first.maxX >= second.minX - BOUNDS_EPSILON
    && first.minY <= second.maxY + BOUNDS_EPSILON
    && first.maxY >= second.minY - BOUNDS_EPSILON
}

function boundaryBounds(boundaryEdges, segments) {
  let bounds = null
  boundaryEdges.forEach((edge) => {
    bounds = mergeBounds(bounds, boundsFromPoints([edge.from, edge.to]))
    const segment = segments[edge.segIdx]
    if (segment?.type === 'arc') {
      bounds = mergeBounds(bounds, {
        maxX: segment.cx + segment.r,
        maxY: segment.cy + segment.r,
        minX: segment.cx - segment.r,
        minY: segment.cy - segment.r,
      })
    }
  })
  return bounds
}

function transformedGeometryContainsPoint(qualification, point) {
  return qualification.hasUnknownBounds
    || qualification.transformedBounds.some(bounds => boundsContainPoint(bounds, point))
}

function transformedGeometryIntersectsBoundary(qualification, boundaryEdges, segments) {
  const detectedBounds = boundaryBounds(boundaryEdges, segments)
  return Boolean(detectedBounds && qualification.transformedBounds.some(
    bounds => boundsIntersect(bounds, detectedBounds),
  ))
}

export {
  HATCH_TRANSFORM_DIAGNOSTIC,
  qualifyHatchGeometry,
  transformedGeometryContainsPoint,
  transformedGeometryIntersectsBoundary,
}
