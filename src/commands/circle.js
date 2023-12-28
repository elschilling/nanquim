// circle.js Circle command creation

import { DrawCommand } from './_DrawCommand'
import { Circle } from '../elements/Circle'

export class CircleCommand extends DrawCommand {
  createDrawCall(startPoint, endPoint) {
    return new Circle(this.ctx, startPoint, endPoint)
  }
}
export function cCircle(ctx) {
  const circleCommand = new CircleCommand(ctx, true)
  circleCommand.start('circle').catch((error) => {
    console.error('An error occurred:', error)
  })
}
