// import { calculateDistanceFromPointToLine } from '../utils/calculateDistance'
// import { store } from '../store'

export class Line {
  constructor(canvas, startPoint, endPoint) {
    this.canvas = canvas
    this.startPoint = startPoint
    this.endPoint = endPoint
  }

  draw(mouseCoord) {
    const { canvas, startPoint, endPoint } = this
    const context = ctx()
    // if (!store.isDrawing) {
    //   if (this.checkHover(mouseCoord)) {
    //     context.strokeStyle = store.hoverStyle
    //     context.lineWidth = store.hoverLineWidth
    //   } else {
    //     context.strokeStyle = store.drawStyle
    //     context.lineWidth = store.drawLineWidth
    //   }
    // }
    console.log('draw line')
    canvas.line(startPoint.x, startPoint.y, 10, 10).stroke({ color: 'white' })
    // context.beginPath()
    // context.moveTo(startPoint.x, startPoint.y)
    // context.lineTo(endPoint.x, endPoint.y)
    // context.closePath()
    // context.stroke()
  }

  // checkHover(mouseCoord) {
  //   const { startPoint, endPoint } = this
  //   const distance = calculateDistanceFromPointToLine(mouseCoord, startPoint, endPoint)
  //   return distance <= store.hoverThreshold
  // }
}
