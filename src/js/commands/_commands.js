import { drawLineCommand } from './DrawLineCommand'
import { drawCircleCommand } from './DrawCircleCommand'
import { drawEllipseCommand } from './DrawEllipseCommand'
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
import { drawPolylineCommand } from './DrawPolylineCommand'
import { createViewportCommand } from './CreateViewportCommand'
import { linearDimensionCommand, LinearDimensionCommand } from './LinearDimensionCommand'
import { alignedDimensionCommand } from './AlignedDimensionCommand'
import { areaCommand } from './AreaCommand'
import { blockCommand } from './BlockCommand'
import { insertCommand } from './InsertCommand'
import { helpCommand } from './HelpCommand'

const commandCategories = Object.freeze([
  'General',
  'Draw',
  'Modify',
  'Organize',
  'Measure & Annotate',
  'Paper Space',
])

// Mapping commands to their respective functions
const commands = {
  HELP: {
    execute: helpCommand,
    aliases: ['help', '?'],
    category: 'General',
    description: 'Open the command and keyboard shortcut reference.',
  },
  LINE: {
    execute: drawLineCommand,
    aliases: ['l'],
    category: 'Draw',
    description: 'Draw a straight line between two points.',
  },
  CIRCLE: {
    execute: drawCircleCommand,
    aliases: ['c'],
    category: 'Draw',
    description: 'Draw a circle from a center point and radius.',
  },
  ELLIPSE: {
    execute: drawEllipseCommand,
    aliases: ['el'],
    category: 'Draw',
    description: 'Draw an ellipse from a center point and horizontal and vertical radii.',
  },
  RECTANGLE: {
    execute: drawRectangleCommand,
    aliases: ['rec'],
    category: 'Draw',
    description: 'Draw a rectangle by two corners or exact width and height.',
  },
  MOVE: {
    execute: moveCommand,
    aliases: ['m'],
    category: 'Modify',
    description: 'Move selected geometry from a base point to a destination.',
  },
  COPY: {
    execute: copyCommand,
    aliases: ['co'],
    category: 'Modify',
    description: 'Copy selected geometry from a base point to one or more destinations.',
  },
  ROTATE: {
    execute: rotateCommand,
    aliases: ['r'],
    category: 'Modify',
    description: 'Rotate selected geometry around a center by angle or reference.',
  },
  SCALE: {
    execute: scaleCommand,
    aliases: ['s'],
    category: 'Modify',
    description: 'Scale selected geometry from a base point by factor or reference.',
  },
  OFFSET: {
    execute: offsetCommand,
    aliases: ['o'],
    category: 'Modify',
    description: 'Create a parallel or concentric copy at an exact distance.',
  },
  FILLET: {
    execute: filletCommand,
    aliases: ['f'],
    category: 'Modify',
    description: 'Round the corner between two lines with a radius.',
  },
  MATCH_PROPERTIES: {
    execute: matchPropertiesCommand,
    aliases: ['ma'],
    category: 'Organize',
    description: 'Copy visual properties from a source object to target objects.',
  },
  ERASE: {
    execute: eraseCommand,
    aliases: ['e'],
    category: 'Modify',
    description: 'Delete selected geometry.',
  },
  EXTEND: {
    execute: extendCommand,
    aliases: ['ex'],
    category: 'Modify',
    description: 'Lengthen geometry to selected or automatic boundaries.',
  },
  TRIM: {
    execute: trimCommand,
    aliases: ['tr', 'trim'],
    category: 'Modify',
    description: 'Cut geometry back to selected or automatic boundaries.',
  },
  ARC: {
    execute: drawArcCommand,
    aliases: ['a'],
    category: 'Draw',
    description: 'Draw a three-point arc from start, end, and curvature.',
  },
  DIST: {
    execute: measureDistanceCommand,
    aliases: ['d', 'dist'],
    category: 'Measure & Annotate',
    description: 'Measure distance and X and Y deltas between two points.',
  },
  MIRROR: {
    execute: mirrorCommand,
    aliases: ['mi'],
    category: 'Modify',
    description: 'Reflect selected geometry across a two-point axis.',
  },
  GROUP: {
    execute: groupCommand,
    aliases: ['g', 'group'],
    category: 'Organize',
    description: 'Combine selected SVG elements into a group.',
  },
  UNGROUP: {
    execute: ungroupCommand,
    aliases: ['ug', 'ungroup'],
    category: 'Organize',
    description: 'Release the contents of selected groups.',
  },
  HATCH: {
    execute: hatchCommand,
    aliases: ['h', 'hatch'],
    category: 'Draw',
    description: 'Fill the closed region under a point with the current hatch pattern.',
  },
  TEXT: {
    execute: textCommand,
    aliases: ['t', 'text'],
    category: 'Draw',
    description: 'Place text using the active text style.',
  },
  POLYLINE: {
    execute: drawPolylineCommand,
    aliases: ['pl'],
    category: 'Draw',
    description: 'Draw connected straight segments.',
  },
  SPLINE: {
    execute: drawSplineCommand,
    aliases: ['sp'],
    category: 'Draw',
    description: 'Draw a smooth curve through multiple points.',
  },
  VIEWPORT: {
    execute: createViewportCommand,
    aliases: ['vp', 'viewport'],
    category: 'Paper Space',
    description: 'Create a scaled live model viewport in Paper Space.',
  },
  DIMLINEAR: {
    execute: linearDimensionCommand,
    aliases: ['dm', 'dimlinear'],
    category: 'Measure & Annotate',
    description: 'Create a horizontal or vertical linear dimension.',
  },
  DIMALIGNED: {
    execute: alignedDimensionCommand,
    aliases: ['da', 'dimaligned'],
    category: 'Measure & Annotate',
    description: 'Create a dimension aligned with two measured points.',
  },
  AREA: {
    execute: areaCommand,
    aliases: ['ar', 'area'],
    category: 'Measure & Annotate',
    description: 'Calculate the area of a rectangle or closed polyline.',
  },
  BLOCK: {
    execute: blockCommand,
    aliases: ['b', 'block'],
    category: 'Organize',
    description: 'Create a reusable block from selected geometry.',
  },
  INSERT: {
    execute: insertCommand,
    aliases: ['i', 'insert'],
    category: 'Organize',
    description: 'Insert one or more instances of a saved block.',
  },
  // Add more commands and functions as needed
}

export { LinearDimensionCommand, commandCategories }
export default commands
