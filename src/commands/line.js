import { DrawCommand } from './_DrawCommand'
import { Line } from '../elements/Line'

export class LineCommand extends DrawCommand {
  createDrawCall(startPoint, endPoint) {
    return new Line(this.ctx, startPoint, endPoint)
  }
}
export function cLine(ctx) {
  const lineCommand = new LineCommand(ctx, false)
  lineCommand.start('line').catch((error) => {
    console.error('An error occurred:', error)
  })
}
