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

const MODEL_AND_PAPER = Object.freeze(['model', 'paper'])
const MODEL_ONLY = Object.freeze(['model'])
const PAPER_ONLY = Object.freeze(['paper'])

// Mapping commands to their respective functions
const commands = {
  HELP: {
    execute: helpCommand,
    aliases: ['help', '?'],
    category: 'General',
    description: 'Open the command and keyboard shortcut reference.',
    modes: MODEL_AND_PAPER,
  },
  LINE: {
    execute: drawLineCommand,
    aliases: ['l'],
    category: 'Draw',
    description: 'Draw a straight line between two points.',
    modes: MODEL_AND_PAPER,
  },
  CIRCLE: {
    execute: drawCircleCommand,
    aliases: ['c'],
    category: 'Draw',
    description: 'Draw a circle from a center point and radius.',
    modes: MODEL_AND_PAPER,
  },
  ELLIPSE: {
    execute: drawEllipseCommand,
    aliases: ['el'],
    category: 'Draw',
    description: 'Draw an ellipse from a center point and horizontal and vertical radii.',
    modes: MODEL_AND_PAPER,
  },
  RECTANGLE: {
    execute: drawRectangleCommand,
    aliases: ['rec'],
    category: 'Draw',
    description: 'Draw a rectangle by two corners or exact width and height.',
    modes: MODEL_AND_PAPER,
  },
  MOVE: {
    execute: moveCommand,
    aliases: ['m'],
    category: 'Modify',
    description: 'Move selected geometry from a base point to a destination.',
    modes: MODEL_AND_PAPER,
  },
  COPY: {
    execute: copyCommand,
    aliases: ['co'],
    category: 'Modify',
    description: 'Copy selected geometry from a base point to one or more destinations.',
    modes: MODEL_ONLY,
  },
  ROTATE: {
    execute: rotateCommand,
    aliases: ['r'],
    category: 'Modify',
    description: 'Rotate selected geometry around a center by angle or reference.',
    modes: MODEL_ONLY,
  },
  SCALE: {
    execute: scaleCommand,
    aliases: ['s'],
    category: 'Modify',
    description: 'Scale selected geometry from a base point by factor or reference.',
    modes: MODEL_ONLY,
  },
  OFFSET: {
    execute: offsetCommand,
    aliases: ['o'],
    category: 'Modify',
    description: 'Create a parallel or concentric copy at an exact distance.',
    modes: MODEL_ONLY,
  },
  FILLET: {
    execute: filletCommand,
    aliases: ['f'],
    category: 'Modify',
    description: 'Round the corner between two lines with a radius.',
    modes: MODEL_ONLY,
  },
  MATCH_PROPERTIES: {
    execute: matchPropertiesCommand,
    aliases: ['ma'],
    category: 'Organize',
    description: 'Copy visual properties from a source object to target objects.',
    modes: MODEL_ONLY,
  },
  ERASE: {
    execute: eraseCommand,
    aliases: ['e'],
    category: 'Modify',
    description: 'Delete selected geometry.',
    modes: MODEL_ONLY,
  },
  EXTEND: {
    execute: extendCommand,
    aliases: ['ex'],
    category: 'Modify',
    description: 'Lengthen geometry to selected or automatic boundaries.',
    modes: MODEL_ONLY,
  },
  TRIM: {
    execute: trimCommand,
    aliases: ['tr', 'trim'],
    category: 'Modify',
    description: 'Cut geometry back to selected or automatic boundaries.',
    modes: MODEL_ONLY,
  },
  ARC: {
    execute: drawArcCommand,
    aliases: ['a'],
    category: 'Draw',
    description: 'Draw a three-point arc from start, end, and curvature.',
    modes: MODEL_AND_PAPER,
  },
  DIST: {
    execute: measureDistanceCommand,
    aliases: ['d', 'dist'],
    category: 'Measure & Annotate',
    description: 'Measure distance and X and Y deltas between two points.',
    modes: MODEL_ONLY,
  },
  MIRROR: {
    execute: mirrorCommand,
    aliases: ['mi'],
    category: 'Modify',
    description: 'Reflect selected geometry across a two-point axis.',
    modes: MODEL_ONLY,
  },
  GROUP: {
    execute: groupCommand,
    aliases: ['g', 'group'],
    category: 'Organize',
    description: 'Combine selected SVG elements into a group.',
    modes: MODEL_ONLY,
  },
  UNGROUP: {
    execute: ungroupCommand,
    aliases: ['ug', 'ungroup'],
    category: 'Organize',
    description: 'Release the contents of selected groups.',
    modes: MODEL_ONLY,
  },
  HATCH: {
    execute: hatchCommand,
    aliases: ['h', 'hatch'],
    category: 'Draw',
    description: 'Fill the closed region under a point with the current hatch pattern.',
    modes: MODEL_ONLY,
  },
  TEXT: {
    execute: textCommand,
    aliases: ['t', 'text'],
    category: 'Draw',
    description: 'Place text using the active text style.',
    modes: MODEL_AND_PAPER,
  },
  POLYLINE: {
    execute: drawPolylineCommand,
    aliases: ['pl'],
    category: 'Draw',
    description: 'Draw connected straight segments.',
    modes: MODEL_AND_PAPER,
  },
  SPLINE: {
    execute: drawSplineCommand,
    aliases: ['sp'],
    category: 'Draw',
    description: 'Draw a smooth curve through multiple points.',
    modes: MODEL_AND_PAPER,
  },
  VIEWPORT: {
    execute: createViewportCommand,
    aliases: ['vp', 'viewport'],
    category: 'Paper Space',
    description: 'Create a scaled live model viewport in Paper Space.',
    modes: PAPER_ONLY,
  },
  DIMLINEAR: {
    execute: linearDimensionCommand,
    aliases: ['dm', 'dimlinear'],
    category: 'Measure & Annotate',
    description: 'Create a horizontal or vertical linear dimension.',
    modes: MODEL_ONLY,
  },
  DIMALIGNED: {
    execute: alignedDimensionCommand,
    aliases: ['da', 'dimaligned'],
    category: 'Measure & Annotate',
    description: 'Create a dimension aligned with two measured points.',
    modes: MODEL_ONLY,
  },
  AREA: {
    execute: areaCommand,
    aliases: ['ar', 'area'],
    category: 'Measure & Annotate',
    description: 'Calculate the area of a rectangle or closed polyline.',
    modes: MODEL_AND_PAPER,
  },
  BLOCK: {
    execute: blockCommand,
    aliases: ['b', 'block'],
    category: 'Organize',
    description: 'Create a reusable block from selected geometry.',
    modes: MODEL_ONLY,
  },
  INSERT: {
    execute: insertCommand,
    aliases: ['i', 'insert'],
    category: 'Organize',
    description: 'Insert one or more instances of a saved block.',
    modes: MODEL_ONLY,
  },
  // Add more commands and functions as needed
}

const commandLookup = new Map()

Object.entries(commands).forEach(([name, definition]) => {
  const keys = [name.toLowerCase(), ...definition.aliases.map((alias) => alias.toLowerCase())]
  keys.forEach((key) => {
    const existing = commandLookup.get(key)
    if (existing && existing !== name) {
      throw new Error(`Duplicate command name or alias: ${key}`)
    }
    commandLookup.set(key, name)
  })
})

function resolveRegisteredCommand(commandName) {
  const input = String(commandName || '').trim().toLowerCase()
  const name = commandLookup.get(input)
  if (!name) return null
  return { name, definition: commands[name] }
}

function reportCancellationError(label, error) {
  console.error(`[CommandRunner] ${label}:`, error)
}

function dispatchCommandCleanup(signal) {
  if (!signal || typeof signal.dispatch !== 'function') return
  const bindings = Array.isArray(signal._bindings) ? signal._bindings.slice() : null
  if (!bindings || signal.active === false) {
    try { signal.dispatch() } catch (error) {
      reportCancellationError('A command cleanup listener failed', error)
    }
    return
  }

  // js-signals stops dispatching when one listener throws. Cancellation is a
  // cleanup boundary, so every live command must get a chance to dispose.
  for (let index = bindings.length - 1; index >= 0; index -= 1) {
    const binding = bindings[index]
    try {
      binding.execute([])
    } catch (error) {
      reportCancellationError('A command cleanup listener failed', error)
      if (binding._isOnce) {
        try { binding.detach() } catch (detachError) {
          reportCancellationError('A faulty one-shot listener could not detach', detachError)
        }
      }
    }
  }
}

function cancelCommandSession(editor, event = null) {
  const currentRevision = Number.isSafeInteger(editor.commandSessionRevision)
    ? editor.commandSessionRevision
    : 0
  editor.commandSessionRevision = currentRevision < Number.MAX_SAFE_INTEGER
    ? currentRevision + 1
    : 1
  const activeSvgs = new Set([editor.svg, editor.paperSvg].filter(Boolean))
  activeSvgs.forEach((svg) => {
    if (typeof svg.fire !== 'function') return
    try { svg.fire('cancelDrawing', event) } catch (error) {
      reportCancellationError('A drawing cleanup listener failed', error)
    }
  })
  dispatchCommandCleanup(editor.signals?.commandCancelled)

  editor.isDrawing = false
  editor.isSelecting = false
  editor.isInteracting = false
  editor.isTypingText = false
  editor.selectSingleElement = false
  editor.suppressHandlers = false
  editor.distance = null
  editor.length = null
}

function executeRegisteredCommand(editor, commandName) {
  const resolved = resolveRegisteredCommand(commandName)
  if (!resolved) return false

  const { name, definition } = resolved
  cancelCommandSession(editor)
  const mode = editor.mode === 'paper' ? 'paper' : 'model'
  if (!definition.modes.includes(mode)) {
    editor.signals?.terminalLogged?.dispatch({
      msg: `Command not available in ${mode === 'paper' ? 'Paper' : 'Model'} Space.`,
    })
    // The input was recognized and handled even though the command cannot run
    // in this document mode. Terminal should clear it instead of repeatedly
    // submitting the same unavailable command.
    return true
  }
  editor.lastCommand = Object.freeze({
    commandName: name,
    execute: () => executeRegisteredCommand(editor, name),
  })

  try {
    definition.execute(editor)
  } catch (error) {
    cancelCommandSession(editor)
    throw error
  }
  return true
}

export {
  LinearDimensionCommand,
  cancelCommandSession,
  commandCategories,
  executeRegisteredCommand,
  resolveRegisteredCommand,
}
export default commands
