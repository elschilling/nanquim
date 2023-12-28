// elements/Circle.js  Circle definition and drawing method

import { calculateDistance } from '../utils/calculateDistance'

export class Circle {
  constructor(ctx, startPoint, endPoint) {
    this.ctx = ctx
    this.startPoint = startPoint
    this.endPoint = endPoint
  }

  draw() {
    const { ctx, startPoint, endPoint } = this
    const context = ctx()
    context.beginPath()
    context.arc(startPoint.x, startPoint.y, calculateDistance(startPoint, endPoint), 0, 2 * Math.PI)
    context.closePath()
    context.stroke()
  }
}
