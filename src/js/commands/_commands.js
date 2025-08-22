import { drawLineCommand } from './DrawLineCommand'
import { drawCircleCommand } from './DrawCircleCommand'
import { drawRectangleCommand } from './DrawRectangleCommand'
import { moveCommand } from './MoveCommand'
import { copyCommand } from './CopyCommand'
import { rotateCommand } from './RotateCommand'
import { offsetCommand } from './OffsetCommand'
import { filletCommand } from './FilletCommand'
import { scaleCommand } from './ScaleCommand'

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
  COPY: {
    execute: copyCommand,
    aliases: ['co'],
  },
  ROTATE: {
    execute: rotateCommand,
    aliases: ['r'],
  },
  SCALE: {
    execute: scaleCommand,
    aliases: ['s'],
  },
  OFFSET: {
    execute: offsetCommand,
    aliases: ['o'],
  },
  FILLET: {
    execute: filletCommand,
    aliases: ['f'],
  },
  // Add more commands and functions as needed
}

export default commands
