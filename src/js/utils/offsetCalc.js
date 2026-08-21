const QUALIFIED_OFFSET_TYPES = new Set(['line', 'circle', 'rect'])
const GEOMETRY_EPSILON = 1e-9

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function hasVisualTransform(node) {
  const attribute = node.getAttribute?.('transform')
  if (attribute && attribute.trim() !== '') return true

  const inline = node.style?.transform
  if (inline && inline !== 'none') return true

  const view = node.ownerDocument?.defaultView
  const computed = view?.getComputedStyle?.(node)?.transform
  return Boolean(computed && computed !== 'none')
}

function transformSupportIssue(element, drawing) {
  const boundary = drawing?.node || null
  let node = element.node

  while (node && node !== boundary) {
    if (hasVisualTransform(node)) return 'transformed'
    node = node.parentNode
  }

  if (boundary && node !== boundary) return 'outside-drawing'
  return null
}

export function getOffsetSupportIssue(element, drawing) {
  if (!element?.node || !QUALIFIED_OFFSET_TYPES.has(element.type)) {
    return 'unsupported-type'
  }

  const transformIssue = transformSupportIssue(element, drawing)
  if (transformIssue) return transformIssue

  try {
    if (element.type === 'line') {
      const points = element.array()
      if (!points || points.length !== 2) return 'invalid-geometry'
      const [first, second] = points
      const x1 = finiteNumber(first?.[0])
      const y1 = finiteNumber(first?.[1])
      const x2 = finiteNumber(second?.[0])
      const y2 = finiteNumber(second?.[1])
      if ([x1, y1, x2, y2].includes(null)) return 'invalid-geometry'
      if (Math.hypot(x2 - x1, y2 - y1) <= GEOMETRY_EPSILON) {
        return 'invalid-geometry'
      }
      return null
    }

    if (element.type === 'circle') {
      const cx = finiteNumber(element.cx())
      const cy = finiteNumber(element.cy())
      const radius = finiteNumber(element.radius?.() ?? element.attr('r'))
      if ([cx, cy, radius].includes(null) || radius <= GEOMETRY_EPSILON) {
        return 'invalid-geometry'
      }
      return null
    }

    const x = finiteNumber(element.x())
    const y = finiteNumber(element.y())
    const width = finiteNumber(element.width())
    const height = finiteNumber(element.height())
    if ([x, y, width, height].includes(null)
      || width <= GEOMETRY_EPSILON
      || height <= GEOMETRY_EPSILON) {
      return 'invalid-geometry'
    }

    for (const attribute of ['rx', 'ry']) {
      const rawValue = element.attr(attribute)
      if (rawValue == null || rawValue === '') continue
      const radius = finiteNumber(rawValue)
      if (radius === null) return 'invalid-geometry'
      if (Math.abs(radius) > GEOMETRY_EPSILON) return 'rounded-rectangle'
    }
    return null
  } catch (_error) {
    return 'invalid-geometry'
  }
}

export function getOffsetResultIssue(element, point, distance) {
  const pointX = finiteNumber(point?.x)
  const pointY = finiteNumber(point?.y)
  const offsetDistance = finiteNumber(distance)
  if (pointX === null || pointY === null
    || offsetDistance === null || offsetDistance <= 0) {
    return 'invalid-geometry'
  }

  if (element.type === 'circle') {
    const cx = element.cx()
    const cy = element.cy()
    const radius = element.radius?.() ?? Number(element.attr('r'))
    const inward = Math.hypot(pointX - cx, pointY - cy) < radius
    if (inward && offsetDistance >= radius - GEOMETRY_EPSILON) {
      return 'inward-distance'
    }
  }

  if (element.type === 'rect') {
    const x = element.x()
    const y = element.y()
    const width = element.width()
    const height = element.height()
    const inside = pointX >= x && pointX <= x + width
      && pointY >= y && pointY <= y + height
    if (inside && (width - 2 * offsetDistance <= GEOMETRY_EPSILON
      || height - 2 * offsetDistance <= GEOMETRY_EPSILON)) {
      return 'inward-distance'
    }
  }

  return null
}

export function applyOffsetToElement(element, dx, dy) {
  if (element?.type !== 'line') {
    throw new TypeError('Only line geometry has a qualified vector offset')
  }
  const offsetX = finiteNumber(dx)
  const offsetY = finiteNumber(dy)
  if (offsetX === null || offsetY === null) {
    throw new TypeError('Offset vector must contain finite coordinates')
  }

  const points = element.array().map(([x, y]) => [x + offsetX, y + offsetY])
  element.plot(points)
}

export function computeOffsetVector(element, mouse, distance) {
  const normalize = (vx, vy) => {
    const len = Math.hypot(vx, vy) || 1
    return { x: vx / len, y: vy / len }
  }
  const signForPerp = (center, perp) => {
    const toMouseX = mouse.x - center.x
    const toMouseY = mouse.y - center.y
    const proj = toMouseX * perp.x + toMouseY * perp.y
    return proj >= 0 ? 1 : -1
  }
  if (element?.type !== 'line') {
    throw new TypeError('Offset direction is qualified only for line geometry')
  }
  const offsetDistance = finiteNumber(distance)
  const mouseX = finiteNumber(mouse?.x)
  const mouseY = finiteNumber(mouse?.y)
  if (offsetDistance === null || offsetDistance <= 0 || mouseX === null || mouseY === null) {
    throw new TypeError('Offset input must contain finite coordinates and a positive distance')
  }

  const points = element.array()
  const [x1, y1] = points[0]
  const [x2, y2] = points[1]
  const dir = normalize(x2 - x1, y2 - y1)
  const perp = { x: -dir.y, y: dir.x }
  const center = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }
  const sign = signForPerp(center, perp)
  return { dx: perp.x * offsetDistance * sign, dy: perp.y * offsetDistance * sign }
}
