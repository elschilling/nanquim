export function calculateDistance(point1, point2) {
  const dx = point2.x - point1.x
  const dy = point2.y - point1.y

  return Math.sqrt(dx * dx + dy * dy)
}
// Usage:
// Assuming startPoint and endPoint are objects with x and y properties
// const distance = calculateDistance(startPoint, endPoint);

export function calculateDistanceFromPointToLine(point, lineStart, lineEnd) {
  const numerator = Math.abs(
    (lineEnd.y - lineStart.y) * point.x - (lineEnd.x - lineStart.x) * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x
  )
  const denominator = Math.sqrt(Math.pow(lineEnd.y - lineStart.y, 2) + Math.pow(lineEnd.x - lineStart.x, 2))
  return numerator / denominator
}

export function distanceFromPointToCircle(point, circleCenter, radius) {
  const distanceX = point.x - circleCenter.x
  const distanceY = point.y - circleCenter.y
  const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY)

  return Math.abs(distance - radius)
}
