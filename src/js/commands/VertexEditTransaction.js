import { CompositeCommand } from './CompositeCommand.js'
import { EditArcCommand } from './EditArcCommand.js'
import { EditCircleCommand } from './EditCircleCommand.js'
import { EditDimensionCommand } from './EditDimensionCommand.js'
import { EditEllipseArcCommand } from './EditEllipseArcCommand.js'
import { EditEllipseCommand } from './EditEllipseCommand.js'
import { EditPolylineCommand } from './EditPolylineCommand.js'
import { EditRectangleCommand } from './EditRectangleCommand.js'
import { EditSplineCommand } from './EditSplineCommand.js'
import { EditTextPositionCommand } from './EditTextPositionCommand.js'
import { EditViewportCommand } from './EditViewportCommand.js'
import { MultiEditVertexCommand } from './MultiEditVertexCommand.js'

const UPDATE_GROUPS = [
  {
    key: 'lineUpdates',
    make: (editor, updates) => [
      new MultiEditVertexCommand(editor, updates),
    ],
  },
  {
    key: 'dimensionUpdates',
    make: (editor, updates) => [
      new EditDimensionCommand(editor, updates, { notifySelection: false }),
    ],
  },
  {
    CommandClass: EditCircleCommand,
    key: 'circleUpdates',
    makeOne: (CommandClass, editor, update) => (
      new CommandClass(editor, update.element, update.oldValues, update.newValues)
    ),
  },
  {
    CommandClass: EditEllipseCommand,
    key: 'ellipseUpdates',
    makeOne: (CommandClass, editor, update) => (
      new CommandClass(editor, update.element, update.oldValues, update.newValues)
    ),
  },
  {
    CommandClass: EditRectangleCommand,
    key: 'rectangleUpdates',
    makeOne: (CommandClass, editor, update) => (
      new CommandClass(editor, update.element, update.oldValues, update.newValues)
    ),
  },
  {
    CommandClass: EditEllipseArcCommand,
    key: 'ellipseArcUpdates',
    makeOne: (CommandClass, editor, update) => (
      new CommandClass(editor, update.element, update.oldData, update.newData)
    ),
  },
  {
    CommandClass: EditArcCommand,
    key: 'arcUpdates',
    makeOne: (CommandClass, editor, update) => (
      new CommandClass(editor, update.element, update.oldValues, update.newValues)
    ),
  },
  {
    CommandClass: EditSplineCommand,
    key: 'splineUpdates',
    makeOne: (CommandClass, editor, update) => (
      new CommandClass(editor, update.element, update.oldPoints, update.newPoints)
    ),
  },
  {
    CommandClass: EditPolylineCommand,
    key: 'polylineUpdates',
    makeOne: (CommandClass, editor, update) => (
      new CommandClass(editor, update.element, update.oldPoints, update.newPoints)
    ),
  },
  {
    CommandClass: EditViewportCommand,
    key: 'viewportUpdates',
    makeOne: (CommandClass, editor, update) => (
      new CommandClass(editor, update.viewport, update.oldValues, update.newValues)
    ),
  },
  {
    CommandClass: EditTextPositionCommand,
    key: 'textPositionUpdates',
    makeOne: (CommandClass, editor, update) => (
      new CommandClass(editor, update.element, update.oldValues, update.newValues)
    ),
  },
]

function buildVertexEditCommands(editor, updateGroups) {
  const activeGroups = UPDATE_GROUPS.filter(({ key }) => updateGroups[key]?.length > 0)
  return activeGroups.flatMap((definition) => {
    const updates = updateGroups[definition.key]
    if (definition.make) return definition.make(editor, updates)
    return updates.map((update) => (
      definition.makeOne(definition.CommandClass, editor, update)
    ))
  })
}

function commitVertexEditUpdates(editor, updateGroups) {
  const commands = buildVertexEditCommands(editor, updateGroups)
  if (commands.length === 0) return null

  let command
  command = new CompositeCommand(editor, commands, {
    name: 'Edit Vertices',
    rollbackAllOnFailure: true,
    onApplied: () => {
      editor.spatialIndex.markDirty()
      editor.fullSpatialIndex.markDirty()
      command.dispatchSignal('updatedSelection')
    },
  })
  editor.execute(command)
  return command
}

export { buildVertexEditCommands, commitVertexEditUpdates }
