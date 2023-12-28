import { cLine } from './line'
import { cCircle } from './circle'
import { cRectangle } from './rectangle'

// Mapping commands to their respective functions
const commands = {
  LINE: {
    execute: cLine,
    aliases: ['l'],
  },
  CIRCLE: {
    execute: cCircle,
    aliases: ['c'],
  },
  RECTANGLE: {
    execute: cRectangle,
    aliases: ['rec'],
  },
  // Add more commands and functions as needed
}

export default commands
