function applyMatrix(matrix, point) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  }
}

function applyInverseMatrix(matrix, point) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  if (Math.abs(determinant) < 1e-10) return null

  return {
    x: (
      matrix.d * (point.x - matrix.e)
      - matrix.c * (point.y - matrix.f)
    ) / determinant,
    y: (
      -matrix.b * (point.x - matrix.e)
      + matrix.a * (point.y - matrix.f)
    ) / determinant,
  }
}

function getScreenMatrix(target) {
  try {
    return target?.screenCTM?.() || null
  } catch (_error) {
    return null
  }
}

/**
 * Convert a point in the active SVG root/viewBox to an element's local space.
 * Paper viewport geometry is already stored in the Paper root, rather than in
 * the SVG wrapper element used for selection, so it deliberately stays root-
 * relative.
 */
function rootPointToElementLocal(point, element, activeSvg) {
  if (element?._paperVp) return { x: point.x, y: point.y }

  const rootMatrix = getScreenMatrix(activeSvg)
  const elementMatrix = getScreenMatrix(element)
  if (!rootMatrix || !elementMatrix) return { x: point.x, y: point.y }

  const local = applyInverseMatrix(elementMatrix, applyMatrix(rootMatrix, point))
  return local || { x: point.x, y: point.y }
}

function elementLocalPointToRoot(point, element, activeSvg) {
  if (element?._paperVp) return { x: point.x, y: point.y }

  const rootMatrix = getScreenMatrix(activeSvg)
  const elementMatrix = getScreenMatrix(element)
  if (!rootMatrix || !elementMatrix) return { x: point.x, y: point.y }

  const root = applyInverseMatrix(rootMatrix, applyMatrix(elementMatrix, point))
  return root || { x: point.x, y: point.y }
}

function getRectGripPoint(original, vertexIndex) {
  const { x, y, width, height } = original
  const points = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
    { x: x + width / 2, y },
    { x: x + width, y: y + height / 2 },
    { x: x + width / 2, y: y + height },
    { x, y: y + height / 2 },
  ]
  return points[vertexIndex] || null
}

function getVertexLocalAnchor(vertexData) {
  const { element, originalPosition, vertexIndex } = vertexData
  if (!element || !originalPosition) return null

  if (element.type === 'line') {
    return { x: originalPosition.x, y: originalPosition.y }
  }
  if (element.type === 'circle') {
    const { cx, cy, r } = originalPosition
    return [
      { x: cx, y: cy },
      { x: cx, y: cy - r },
      { x: cx + r, y: cy },
      { x: cx, y: cy + r },
      { x: cx - r, y: cy },
    ][vertexIndex] || null
  }
  if (element.type === 'rect' || element._paperVp) {
    return getRectGripPoint(originalPosition, vertexIndex)
  }
  if (element.type === 'ellipse') {
    return { x: originalPosition.cx, y: originalPosition.cy }
  }
  if (element.type === 'path' && element.data?.('ellipseArcData')) {
    if (vertexIndex !== 0) return null
    return { x: originalPosition.cx, y: originalPosition.cy }
  }
  if (element.type === 'path' && element.data?.('arcData')) {
    const point = originalPosition[`p${vertexIndex + 1}`]
    return point ? { x: point.x, y: point.y } : null
  }
  if (element.type === 'path' && element.data?.('splineData')) {
    const point = originalPosition.points?.[vertexIndex]
    return point ? { x: point.x, y: point.y } : null
  }
  if (element.type === 'polyline') {
    const point = originalPosition.points?.[vertexIndex]
    return point ? { x: point[0], y: point[1] } : null
  }
  if (element.type === 'text') {
    return { x: originalPosition.x, y: originalPosition.y }
  }
  if (element.type === 'g' && element.attr?.('data-element-type') === 'dimension') {
    if (vertexIndex <= 2) {
      const point = originalPosition[`p${vertexIndex + 1}`]
      return point ? { x: point.x, y: point.y } : null
    }
    try {
      const point = JSON.parse(element.attr('data-dim-text-center'))
      return Number.isFinite(point?.x) && Number.isFinite(point?.y)
        ? { x: point.x, y: point.y }
        : null
    } catch (_error) {
      return null
    }
  }
  return null
}

/**
 * Apply ortho in the active root, where the cursor and visible handler live.
 * The constrained result can then be independently mapped into every
 * coincident element's local coordinate system.
 */
function constrainVertexPointInRoot(point, vertexData, activeSvg) {
  const localAnchor = getVertexLocalAnchor(vertexData)
  if (!localAnchor) return { x: point.x, y: point.y }

  const anchor = elementLocalPointToRoot(localAnchor, vertexData.element, activeSvg)
  const dx = point.x - anchor.x
  const dy = point.y - anchor.y
  return Math.abs(dx) > Math.abs(dy)
    ? { x: point.x, y: anchor.y }
    : { x: anchor.x, y: point.y }
}

export {
  constrainVertexPointInRoot,
  elementLocalPointToRoot,
  getVertexLocalAnchor,
  rootPointToElementLocal,
}
