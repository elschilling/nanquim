export function drawCircle(ctx, centerPoint, radius) {
  const context = ctx()
  context.beginPath()
  context.arc(centerPoint.x, centerPoint.y, radius, 0, 2 * Math.PI)
  context.closePath()
  context.stroke()
}
