import { calculateDistance, distanceFromPointToCircle } from '../utils/calculateDistance'
import { store } from '../store'

// TODO store the radius as this.radius end not endPoint

export class Circle {
  constructor(ctx, startPoint, endPoint) {
    this.ctx = ctx
    this.startPoint = startPoint
    this.endPoint = endPoint
  }

  draw(mouseCoord) {
    const { ctx, startPoint, endPoint } = this
    const radius = calculateDistance(startPoint, endPoint)
    const context = ctx()
    if (!store.isDrawing) {
      if (this.checkHover(mouseCoord, radius)) {
        context.strokeStyle = store.hoverStyle
        context.lineWidth = store.hoverLineWidth
      } else {
        context.strokeStyle = store.drawStyle
        context.lineWidth = store.drawLineWidth
      }
    }
    context.beginPath()
    context.arc(startPoint.x, startPoint.y, radius, 0, 2 * Math.PI)
    context.closePath()
    context.stroke()
  }

  checkHover(mouseCoord, radius) {
    const { startPoint, endPoint } = this
    const distance = distanceFromPointToCircle(mouseCoord, startPoint, radius)
    return distance <= store.hoverThreshold
  }
}
