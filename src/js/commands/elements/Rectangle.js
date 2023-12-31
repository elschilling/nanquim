export class Rectangle {
  constructor(ctx, startPoint, endPoint) {
    this.ctx = ctx
    this.startPoint = startPoint
    this.endPoint = endPoint
  }

  draw() {
    const { ctx, startPoint, endPoint } = this
    const context = ctx()
    context.beginPath()
    context.strokeRect(startPoint.x, startPoint.y, endPoint.x - startPoint.x, endPoint.y - startPoint.y)
    context.stroke()
    context.closePath()
    context.stroke()
  }
}
