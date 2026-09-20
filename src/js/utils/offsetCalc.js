import { getArcGeometry } from './arcUtils'

const QUALIFIED_OFFSET_TYPES = new Set(['line', 'circle', 'rect', 'path', 'polyline'])
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

function readArcOffsetGeometry(element) {
  if (element?.type !== 'path' || typeof element.data !== 'function') return null
  const source = element.data('arcData')
  if (!source || typeof source !== 'object') return null

  const points = ['p1', 'p2', 'p3'].map((key) => {
    const x = finiteNumber(source[key]?.x)
    const y = finiteNumber(source[key]?.y)
    return x === null || y === null ? null : { x, y }
  })
  if (points.includes(null)) return null

  const [p1, p2, p3] = points
  const geometry = getArcGeometry(p1, p2, p3)
  if (!geometry
    || finiteNumber(geometry.cx) === null
    || finiteNumber(geometry.cy) === null
    || finiteNumber(geometry.radius) === null
    || geometry.radius <= GEOMETRY_EPSILON) {
    return null
  }

  return { geometry, points, source }
}

function offsetGeometryError(issue, message) {
  const error = new RangeError(message)
  error.offsetIssue = issue
  return error
}

function pointsEqual(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y) <= GEOMETRY_EPSILON
}

function cross(first, second) {
  return first.x * second.y - first.y * second.x
}

function subtract(first, second) {
  return { x: first.x - second.x, y: first.y - second.y }
}

function readPolylineOffsetGeometry(element) {
  if (element?.type !== 'polyline' || typeof element.array !== 'function') return null
  const values = element.array()
  if (!values || values.length < 2) return null

  const points = values.map((value) => {
    const x = finiteNumber(value?.[0])
    const y = finiteNumber(value?.[1])
    return x === null || y === null ? null : { x, y }
  })
  if (points.includes(null)) return null

  const closed = points.length >= 4 && pointsEqual(points[0], points.at(-1))
  const vertices = closed ? points.slice(0, -1) : points
  if (vertices.length < (closed ? 3 : 2)) return null

  const segmentCount = closed ? vertices.length : vertices.length - 1
  const segments = []
  for (let index = 0; index < segmentCount; index += 1) {
    const start = vertices[index]
    const end = vertices[(index + 1) % vertices.length]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    if (length <= GEOMETRY_EPSILON) return null
    segments.push({
      direction: { x: dx / length, y: dy / length },
      end,
      normal: { x: -dy / length, y: dx / length },
      start,
    })
  }

  const cornerCount = closed ? segments.length : segments.length - 1
  for (let index = 0; index < cornerCount; index += 1) {
    const previous = segments[index]
    const next = segments[(index + 1) % segments.length]
    const parallel = Math.abs(cross(previous.direction, next.direction)) <= GEOMETRY_EPSILON
    const directionDot = previous.direction.x * next.direction.x
      + previous.direction.y * next.direction.y
    if (parallel && directionDot < 0) return null
  }

  if (hasPolylineSelfIntersection(vertices, closed)) return null
  if (closed && Math.abs(signedArea(vertices)) <= GEOMETRY_EPSILON) return null
  return { closed, segments, vertices }
}

function signedArea(points) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return area / 2
}

function pointOnSegment(point, start, end) {
  if (Math.abs(cross(subtract(point, start), subtract(end, start))) > GEOMETRY_EPSILON) {
    return false
  }
  return point.x >= Math.min(start.x, end.x) - GEOMETRY_EPSILON
    && point.x <= Math.max(start.x, end.x) + GEOMETRY_EPSILON
    && point.y >= Math.min(start.y, end.y) - GEOMETRY_EPSILON
    && point.y <= Math.max(start.y, end.y) + GEOMETRY_EPSILON
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstDirection = subtract(firstEnd, firstStart)
  const secondDirection = subtract(secondEnd, secondStart)
  const firstSideA = cross(firstDirection, subtract(secondStart, firstStart))
  const firstSideB = cross(firstDirection, subtract(secondEnd, firstStart))
  const secondSideA = cross(secondDirection, subtract(firstStart, secondStart))
  const secondSideB = cross(secondDirection, subtract(firstEnd, secondStart))

  if (((firstSideA > GEOMETRY_EPSILON && firstSideB < -GEOMETRY_EPSILON)
    || (firstSideA < -GEOMETRY_EPSILON && firstSideB > GEOMETRY_EPSILON))
    && ((secondSideA > GEOMETRY_EPSILON && secondSideB < -GEOMETRY_EPSILON)
      || (secondSideA < -GEOMETRY_EPSILON && secondSideB > GEOMETRY_EPSILON))) {
    return true
  }

  return (Math.abs(firstSideA) <= GEOMETRY_EPSILON
      && pointOnSegment(secondStart, firstStart, firstEnd))
    || (Math.abs(firstSideB) <= GEOMETRY_EPSILON
      && pointOnSegment(secondEnd, firstStart, firstEnd))
    || (Math.abs(secondSideA) <= GEOMETRY_EPSILON
      && pointOnSegment(firstStart, secondStart, secondEnd))
    || (Math.abs(secondSideB) <= GEOMETRY_EPSILON
      && pointOnSegment(firstEnd, secondStart, secondEnd))
}

function hasPolylineSelfIntersection(points, closed) {
  const segmentCount = closed ? points.length : points.length - 1
  for (let first = 0; first < segmentCount; first += 1) {
    const firstStart = points[first]
    const firstEnd = points[(first + 1) % points.length]
    for (let second = first + 1; second < segmentCount; second += 1) {
      if (second === first + 1) continue
      if (closed && first === 0 && second === segmentCount - 1) continue
      const secondStart = points[second]
      const secondEnd = points[(second + 1) % points.length]
      if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return true
    }
  }
  return false
}

function nearestPolylineSide(geometry, point) {
  let nearest = null
  geometry.segments.forEach((segment) => {
    const segmentVector = subtract(segment.end, segment.start)
    const lengthSquared = segmentVector.x ** 2 + segmentVector.y ** 2
    const toPoint = subtract(point, segment.start)
    const parameter = Math.max(0, Math.min(1,
      (toPoint.x * segmentVector.x + toPoint.y * segmentVector.y) / lengthSquared))
    const closest = {
      x: segment.start.x + segmentVector.x * parameter,
      y: segment.start.y + segmentVector.y * parameter,
    }
    const delta = subtract(point, closest)
    const distanceSquared = delta.x ** 2 + delta.y ** 2
    if (!nearest || distanceSquared < nearest.distanceSquared) {
      nearest = {
        distanceSquared,
        projection: delta.x * segment.normal.x + delta.y * segment.normal.y,
      }
    }
  })
  return nearest.projection >= 0 ? 1 : -1
}

function intersectOffsetSegments(vertex, previous, next, amount) {
  const previousPoint = {
    x: vertex.x + previous.normal.x * amount,
    y: vertex.y + previous.normal.y * amount,
  }
  const nextPoint = {
    x: vertex.x + next.normal.x * amount,
    y: vertex.y + next.normal.y * amount,
  }
  const determinant = cross(previous.direction, next.direction)
  if (Math.abs(determinant) <= GEOMETRY_EPSILON) {
    const directionDot = previous.direction.x * next.direction.x
      + previous.direction.y * next.direction.y
    if (directionDot < 0) {
      throw offsetGeometryError('invalid-geometry', 'Polyline offset cannot resolve a reversing corner')
    }
    return previousPoint
  }

  const parameter = cross(subtract(nextPoint, previousPoint), next.direction) / determinant
  const point = {
    x: previousPoint.x + previous.direction.x * parameter,
    y: previousPoint.y + previous.direction.y * parameter,
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw offsetGeometryError('invalid-geometry', 'Polyline offset produced non-finite geometry')
  }
  return point
}

export function getOffsetSupportIssue(element, drawing) {
  if (!element?.node || !QUALIFIED_OFFSET_TYPES.has(element.type)) {
    return 'unsupported-type'
  }

  if (element.type === 'path' && !element.data?.('arcData')) {
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

    if (element.type === 'path') {
      return readArcOffsetGeometry(element) ? null : 'invalid-geometry'
    }

    if (element.type === 'polyline') {
      return readPolylineOffsetGeometry(element) ? null : 'invalid-geometry'
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

  if (element.type === 'path') {
    const arc = readArcOffsetGeometry(element)
    if (!arc) return 'invalid-geometry'
    const { cx, cy, radius } = arc.geometry
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

  if (element.type === 'polyline') {
    try {
      computePolylineOffsetGeometry(element, { x: pointX, y: pointY }, offsetDistance)
    } catch (error) {
      return error?.offsetIssue || 'invalid-geometry'
    }
  }

  return null
}

export function computePolylineOffsetGeometry(element, point, distance) {
  const geometry = readPolylineOffsetGeometry(element)
  const pointX = finiteNumber(point?.x)
  const pointY = finiteNumber(point?.y)
  const offsetDistance = finiteNumber(distance)
  if (!geometry || pointX === null || pointY === null
    || offsetDistance === null || offsetDistance <= 0) {
    throw offsetGeometryError(
      'invalid-geometry',
      'Polyline offset requires finite, non-degenerate geometry',
    )
  }

  const side = nearestPolylineSide(geometry, { x: pointX, y: pointY })
  const amount = offsetDistance * side
  const points = geometry.vertices.map((vertex, index) => {
    if (!geometry.closed && index === 0) {
      const normal = geometry.segments[0].normal
      return { x: vertex.x + normal.x * amount, y: vertex.y + normal.y * amount }
    }
    if (!geometry.closed && index === geometry.vertices.length - 1) {
      const normal = geometry.segments.at(-1).normal
      return { x: vertex.x + normal.x * amount, y: vertex.y + normal.y * amount }
    }

    const previousIndex = (index - 1 + geometry.segments.length) % geometry.segments.length
    return intersectOffsetSegments(
      vertex,
      geometry.segments[previousIndex],
      geometry.segments[index],
      amount,
    )
  })

  const sourceArea = geometry.closed ? signedArea(geometry.vertices) : 0
  const inward = geometry.closed && side * Math.sign(sourceArea) > 0
  const resultSegmentCount = geometry.closed ? points.length : points.length - 1
  for (let index = 0; index < resultSegmentCount; index += 1) {
    const start = points[index]
    const end = points[(index + 1) % points.length]
    const resultDirection = subtract(end, start)
    const forwardLength = resultDirection.x * geometry.segments[index].direction.x
      + resultDirection.y * geometry.segments[index].direction.y
    if (forwardLength <= GEOMETRY_EPSILON) {
      throw offsetGeometryError(
        inward ? 'inward-distance' : 'invalid-geometry',
        'Polyline offset collapsed or reversed a segment',
      )
    }
  }
  if (hasPolylineSelfIntersection(points, geometry.closed)) {
    throw offsetGeometryError(
      inward ? 'inward-distance' : 'invalid-geometry',
      'Polyline offset produced self-intersecting geometry',
    )
  }

  if (geometry.closed) {
    const resultArea = signedArea(points)
    if (Math.abs(resultArea) <= GEOMETRY_EPSILON
      || Math.sign(resultArea) !== Math.sign(sourceArea)) {
      throw offsetGeometryError(
        inward ? 'inward-distance' : 'invalid-geometry',
        'Polyline offset collapsed or inverted the closed boundary',
      )
    }
    points.push({ ...points[0] })
  }

  return {
    closed: geometry.closed,
    points: points.map(({ x, y }) => [x, y]),
    side,
  }
}

export function applyPolylineOffsetToElement(element, result) {
  if (element?.type !== 'polyline' || !Array.isArray(result?.points)) {
    throw new TypeError('Polyline offset can only be applied to polyline geometry')
  }
  element.plot(result.points)
}

export function computeArcOffsetGeometry(element, point, distance) {
  const arc = readArcOffsetGeometry(element)
  const pointX = finiteNumber(point?.x)
  const pointY = finiteNumber(point?.y)
  const offsetDistance = finiteNumber(distance)
  if (!arc || pointX === null || pointY === null
    || offsetDistance === null || offsetDistance <= 0) {
    throw new TypeError('Arc offset requires finite three-point arc geometry')
  }

  const { geometry, points, source } = arc
  const inward = Math.hypot(pointX - geometry.cx, pointY - geometry.cy) < geometry.radius
  const radius = geometry.radius + (inward ? -offsetDistance : offsetDistance)
  if (radius <= GEOMETRY_EPSILON) {
    throw new RangeError('Arc offset distance must leave a positive radius')
  }

  const scale = radius / geometry.radius
  const offsetPoint = ({ x, y }) => ({
    x: geometry.cx + (x - geometry.cx) * scale,
    y: geometry.cy + (y - geometry.cy) * scale,
  })
  const [p1, p2, p3] = points.map(offsetPoint)
  const offsetGeometry = getArcGeometry(p1, p2, p3)
  if (!offsetGeometry) throw new TypeError('Arc offset produced invalid geometry')

  const arcData = { ...source, p1, p2, p3 }
  if (Object.hasOwn(source, 'cx')) arcData.cx = geometry.cx
  if (Object.hasOwn(source, 'cy')) arcData.cy = geometry.cy
  if (Object.hasOwn(source, 'r')) arcData.r = radius

  const sourceCircleTrimData = element.data('circleTrimData')
  let circleTrimData = null
  if (sourceCircleTrimData && typeof sourceCircleTrimData === 'object') {
    circleTrimData = {
      ...sourceCircleTrimData,
      cx: geometry.cx,
      cy: geometry.cy,
      r: radius,
      startPt: p1,
      midPt: p2,
      endPt: p3,
    }
    if (Object.hasOwn(sourceCircleTrimData, 'radius')) circleTrimData.radius = radius
  }

  return {
    arcData,
    circleTrimData,
    path: `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${offsetGeometry.largeArcFlag} ${offsetGeometry.sweepFlag} ${p3.x} ${p3.y}`,
    radius,
  }
}

export function applyArcOffsetToElement(element, result) {
  if (element?.type !== 'path' || !result?.arcData || typeof result.path !== 'string') {
    throw new TypeError('Arc offset can only be applied to an arc path')
  }
  element.plot(result.path)
  element.data('arcData', result.arcData)
  if (result.circleTrimData) element.data('circleTrimData', result.circleTrimData)
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
