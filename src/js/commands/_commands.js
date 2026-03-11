import { drawLineCommand } from './DrawLineCommand'
import { drawCircleCommand } from './DrawCircleCommand'
import { drawRectangleCommand } from './DrawRectangleCommand'
import { moveCommand } from './MoveCommand'
import { copyCommand } from './CopyCommand'
import { rotateCommand } from './RotateCommand'
import { offsetCommand } from './OffsetCommand'
import { filletCommand } from './FilletCommand'
import { scaleCommand } from './ScaleCommand'
import { matchPropertiesCommand } from './MatchPropertiesCommand'
import { eraseCommand } from './EraseCommand'
import { extendCommand } from './ExtendCommand'
import { trimCommand } from './TrimCommand'
import { drawArcCommand } from './DrawArcCommand'
import { measureDistanceCommand } from './MeasureDistanceCommand'
import { mirrorCommand } from './MirrorCommand'
import { groupCommand } from './GroupCommand'
import { ungroupCommand } from './UngroupCommand'
import { hatchCommand } from './HatchCommand'
import { textCommand } from './TextCommand'
import { drawSplineCommand } from './DrawSplineCommand'

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
  MATCH_PROPERTIES: {
    execute: matchPropertiesCommand,
    aliases: ['ma'],
  },
  ERASE: {
    execute: eraseCommand,
    aliases: ['e'],
  },
  EXTEND: {
    execute: extendCommand,
    aliases: ['ex'],
  },
  TRIM: {
    execute: trimCommand,
    aliases: ['tr', 'trim'],
  },
  ARC: {
    execute: drawArcCommand,
    aliases: ['a'],
  },
  DIST: {
    execute: measureDistanceCommand,
    aliases: ['d', 'dist'],
  },
  MIRROR: {
    execute: mirrorCommand,
    aliases: ['mi'],
  },
  GROUP: {
    execute: groupCommand,
    aliases: ['g', 'group'],
  },
  UNGROUP: {
    execute: ungroupCommand,
    aliases: ['ug', 'ungroup'],
  },
  HATCH: {
    execute: hatchCommand,
    aliases: ['h', 'hatch'],
  },
  TEXT: {
    execute: textCommand,
    aliases: ['t', 'text'],
  },
  SPLINE: {
    execute: drawSplineCommand,
    aliases: ['sp'],
  },
  // Add more commands and functions as needed
}

export default commands
