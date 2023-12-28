// TODO simplify with startPoint and endPoint
export function drawLine(ctx, startX, startY, endX, endY) {
  const context = ctx()
  context.beginPath()
  context.moveTo(startX, startY)
  context.lineTo(endX, endY)
  context.closePath()
  context.stroke()
}
