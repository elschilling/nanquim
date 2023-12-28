import { DrawCommand } from './_DrawCommand'
import { Rectangle } from '../elements/Rectangle'

export class RectangleCommand extends DrawCommand {
  createDrawCall(startPoint, endPoint) {
    return new Rectangle(this.ctx, startPoint, endPoint)
  }
}
export function cRectangle(ctx) {
  const rectangleCommand = new RectangleCommand(ctx, true)
  rectangleCommand.start('rectangle').catch((error) => {
    console.error('An error occurred:', error)
  })
}
