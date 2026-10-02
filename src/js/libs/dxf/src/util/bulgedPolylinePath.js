import { Box2 } from 'vecks'

const MAX_DXF_COORDINATE = 1000000000
const TAU = Math.PI * 2

function boundedNumber(value) {
  return Number.isFinite(value) && Math.abs(value) <= MAX_DXF_COORDINATE
}

function boundedPoint(point) {
  return boundedNumber(point?.x) && boundedNumber(point?.y)
}

function positiveAngle(angle) {
  return ((angle % TAU) + TAU) % TAU
}

function circularSegment(from, to, bulge) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const chord = Math.hypot(dx, dy)
  if (!(chord > 0) || !boundedNumber(bulge)) throw new RangeError('Invalid DXF bulge segment')

  // Bulge is tan(sweep / 4). These forms avoid squaring large bulges.
  const radius = chord * (Math.abs(bulge) + 1 / Math.abs(bulge)) / 4
  const offset = chord * (1 / bulge - bulge) / 4
  const center = {
    x: from.x + dx / 2 - dy / chord * offset,
    y: from.y + dy / 2 + dx / chord * offset,
  }
  if (!boundedNumber(radius) || radius <= 0 || !boundedPoint(center)) {
    throw new RangeError('DXF bulge curve exceeds numeric bounds')
  }

  const sweep = 4 * Math.atan(Math.abs(bulge))
  const direction = Math.sign(bulge)
  const startAngle = Math.atan2(from.y - center.y, from.x - center.x)
  const extrema = [
    { angle: 0, point: { x: center.x + radius, y: center.y } },
    { angle: Math.PI / 2, point: { x: center.x, y: center.y + radius } },
    { angle: Math.PI, point: { x: center.x - radius, y: center.y } },
    { angle: Math.PI * 1.5, point: { x: center.x, y: center.y - radius } },
  ]
  const points = [from, to]
  for (const { angle, point } of extrema) {
    if (positiveAngle(direction * (angle - startAngle)) <= sweep + 1e-12) points.push(point)
  }
  if (!points.every(boundedPoint)) throw new RangeError('DXF bulge curve exceeds numeric bounds')
  return {
    points,
    command: `A${radius},${radius} 0 ${Math.abs(bulge) > 1 ? 1 : 0},${bulge > 0 ? 1 : 0} ${to.x},${to.y}`,
  }
}

// Keep circular DXF segments editable and exact instead of expanding each arc
// into a sequence of chords. No additional document metadata is required.
export default function bulgedPolylinePath(entity) {
  const vertices = entity.vertices
  if (!Array.isArray(vertices) || vertices.length < 2 || !vertices.every(boundedPoint)) {
    throw new RangeError('Invalid DXF polyline vertices')
  }
  let bbox = new Box2().expandByPoint(vertices[0])
  const commands = [`M${vertices[0].x},${vertices[0].y}`]
  const segmentCount = entity.closed ? vertices.length : vertices.length - 1

  for (let index = 0; index < segmentCount; index += 1) {
    const from = vertices[index]
    const to = vertices[(index + 1) % vertices.length]
    const bulge = from.bulge ?? 0
    if (!boundedNumber(bulge)) throw new RangeError('Invalid DXF bulge')
    if (bulge === 0) {
      bbox = bbox.expandByPoint(to)
      commands.push(`L${to.x},${to.y}`)
    } else {
      const segment = circularSegment(from, to, bulge)
      segment.points.forEach(point => { bbox = bbox.expandByPoint(point) })
      commands.push(segment.command)
    }
  }
  if (entity.closed) commands.push('Z')
  return { bbox, pathData: commands.join('') }
}
