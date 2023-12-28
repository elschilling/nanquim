export class Line {
  constructor(ctx, startPoint, endPoint) {
    this.ctx = ctx
    this.startPoint = startPoint
    this.endPoint = endPoint
  }

  draw() {
    const { ctx, startPoint, endPoint } = this
    const context = ctx()
    context.beginPath()
    context.moveTo(startPoint.x, startPoint.y)
    context.lineTo(endPoint.x, endPoint.y)
    context.closePath()
    context.stroke()
  }
}
