function sqr(x) {
  return x * x
}
function dist2(v, w) {
  return sqr(v.x - w.x) + sqr(v.y - w.y)
}
function distToSegmentSquared(p, v, w) {
  var l2 = dist2(v, w)
  if (l2 == 0) return dist2(p, v)
  var t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2
  t = Math.max(0, Math.min(1, t))
  return dist2(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) })
}

export function calculateDistance(point1, point2) {
  const dx = point2.x - point1.x
  const dy = point2.y - point1.y

  return Math.sqrt(dx * dx + dy * dy)
}
// Usage:
// Assuming startPoint and endPoint are objects with x and y properties
// const distance = calculateDistance(startPoint, endPoint);

export function distanceFromPointToLine(point, lineStart, lineEnd) {
  // const numerator = Math.abs(
  //   (lineEnd.y - lineStart.y) * point.x - (lineEnd.x - lineStart.x) * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x
  // )
  // const denominator = Math.sqrt(Math.pow(lineEnd.y - lineStart.y, 2) + Math.pow(lineEnd.x - lineStart.x, 2))
  // return numerator / denominator
  return Math.sqrt(distToSegmentSquared(point, lineStart, lineEnd))
}

export function distanceFromPointToCircle(point, circleCenter, radius) {
  const distanceX = point.x - circleCenter.x
  const distanceY = point.y - circleCenter.y
  const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY)

  return Math.abs(distance - radius)
}

export function distancePointToRectangleStroke(point, rect) {
  // Transform values coming from svg node
  let _rect = {}
  _rect.x = rect.x.baseVal.value
  _rect.y = rect.y.baseVal.value
  _rect.width = rect.width.baseVal.value
  _rect.height = rect.height.baseVal.value

  const dx1 = distanceFromPointToLine(point, { x: _rect.x, y: _rect.y }, { x: _rect.x + _rect.width, y: _rect.y })
  const dx2 = distanceFromPointToLine(
    point,
    { x: _rect.x, y: _rect.y + _rect.height },
    { x: _rect.x + _rect.width, y: _rect.y + _rect.height }
  )
  const dy1 = distanceFromPointToLine(point, { x: _rect.x, y: _rect.y }, { x: _rect.x, y: _rect.y + _rect.height })
  const dy2 = distanceFromPointToLine(
    point,
    { x: _rect.x + _rect.width, y: _rect.y },
    { x: _rect.x + _rect.width, y: _rect.y + _rect.height }
  )

  return Math.min(dx1, dx2, dy1, dy2)
}

// Example usage:
// const point = { x: 5, y: 5 }
// const rectangle = { x: 2, y: 2, width: 8, height: 6 }

// const distance = distancePointToRectangleStroke(point, rectangle)
// console.log('Distance to rectangle stroke:', distance)
