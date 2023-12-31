import { drawLineCommand } from './DrawLineCommand'
import { drawCircleCommand } from './DrawCircleCommand'
import { drawRectangleCommand } from './DrawRectangleCommand'

// Mapping commands to their respective functions
const commands = {
  LINE: {
    execute: drawLineCommand,
    aliases: ['l'],
  },
  CIRCLE: {
    execute: drawCircleCommand,
    aliases: ['c'],
  },
  RECTANGLE: {
    execute: drawRectangleCommand,
    aliases: ['rec'],
  },
  // Add more commands and functions as needed
}

export default commands
