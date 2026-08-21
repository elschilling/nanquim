const COMMAND_ICON_SHEET = Object.freeze({
  url: '/assets/img/nanquim-command-icons.svg',
  maskImage: "url('/assets/img/nanquim-command-icons.svg')",
  columns: 8,
  rows: 4,
  cellSize: 24,
  width: 192,
  height: 96,
  maskSize: '800% 400%',
})

// The sheet is packed by registry category so related artwork stays together.
// Palette display order must still come from the command registry, not this map.
const commandIconCells = {
  HELP: [0, 0],
  LINE: [1, 0],
  CIRCLE: [2, 0],
  ELLIPSE: [3, 0],
  RECTANGLE: [4, 0],
  ARC: [5, 0],
  HATCH: [6, 0],
  TEXT: [7, 0],
  POLYLINE: [0, 1],
  SPLINE: [1, 1],
  MOVE: [2, 1],
  COPY: [3, 1],
  ROTATE: [4, 1],
  SCALE: [5, 1],
  OFFSET: [6, 1],
  FILLET: [7, 1],
  ERASE: [0, 2],
  EXTEND: [1, 2],
  TRIM: [2, 2],
  MIRROR: [3, 2],
  MATCH_PROPERTIES: [4, 2],
  GROUP: [5, 2],
  UNGROUP: [6, 2],
  BLOCK: [7, 2],
  INSERT: [0, 3],
  DIST: [1, 3],
  DIMLINEAR: [2, 3],
  DIMALIGNED: [3, 3],
  AREA: [4, 3],
  VIEWPORT: [5, 3],
}

function percentage(index, count) {
  return `${index / (count - 1) * 100}%`
}

function iconId(commandName) {
  return `command-${commandName.toLowerCase().replace(/_/g, '-')}`
}

const COMMAND_ICON_METADATA = Object.freeze(Object.fromEntries(
  Object.entries(commandIconCells).map(([command, [column, row]]) => [
    command,
    Object.freeze({
      command,
      id: iconId(command),
      column,
      row,
      positionX: percentage(column, COMMAND_ICON_SHEET.columns),
      positionY: percentage(row, COMMAND_ICON_SHEET.rows),
    }),
  ]),
))

const COMMAND_ICON_NAMES = Object.freeze(Object.keys(COMMAND_ICON_METADATA))

function normalizeCommandIconName(commandName) {
  return String(commandName || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
}

function hasCommandIcon(commandName) {
  return Object.prototype.hasOwnProperty.call(
    COMMAND_ICON_METADATA,
    normalizeCommandIconName(commandName),
  )
}

function getCommandIconMetadata(commandName) {
  return COMMAND_ICON_METADATA[normalizeCommandIconName(commandName)] || null
}

export {
  COMMAND_ICON_METADATA,
  COMMAND_ICON_NAMES,
  COMMAND_ICON_SHEET,
  getCommandIconMetadata,
  hasCommandIcon,
  normalizeCommandIconName,
}
