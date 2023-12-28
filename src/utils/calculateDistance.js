export function calculateDistance(point1, point2) {
  const dx = point2.x - point1.x
  const dy = point2.y - point1.y

  return Math.sqrt(dx * dx + dy * dy)
}
// Usage:
// Assuming startPoint and endPoint are objects with x and y properties
// const distance = calculateDistance(startPoint, endPoint);
