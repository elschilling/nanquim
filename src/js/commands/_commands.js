import { drawLineCommand } from './DrawLineCommand'
import { drawCircleCommand } from './DrawCircleCommand'
import { drawRectangleCommand } from './DrawRectangleCommand'
import { moveCommand } from './MoveCommand'
import { rotateCommand } from './RotateCommand'

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
  MOVE: {
    execute: moveCommand,
    aliases: ['m'],
  },
  ROTATE: {
    execute: rotateCommand,
    aliases: ['r'],
  },
  // Add more commands and functions as needed
}

export default commands
