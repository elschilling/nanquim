import { Command } from '../Command.js'

function cloneData(value) {
  if (value === undefined) return undefined
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

class GraphSnapshotCommand extends Command {
  constructor(manager, graphId, before, after, name = 'Edit Geometry Nodes') {
    super(manager.editor)
    this.type = 'GeometryNodeGraphCommand'
    this.name = name
    this.manager = manager
    this.graphId = graphId
    this.before = cloneData(before)
    this.after = cloneData(after)
  }

  execute() {
    this.manager._restoreGraphSnapshot(this.graphId, cloneData(this.after))
  }

  undo() {
    this.manager._restoreGraphSnapshot(this.graphId, cloneData(this.before))
  }
}

class AttachGeometryNodesCommand extends Command {
  constructor(manager, elements, graphId) {
    super(manager.editor)
    this.type = 'AttachGeometryNodesCommand'
    this.name = 'Add Geometry Nodes Modifier'
    this.manager = manager
    this.elements = [...elements]
    this.graphId = graphId
    this.state = null
  }

  execute() {
    if (this.state) this.manager._redoAttachNow(this.state)
    else this.state = this.manager._attachSelectionNow(this.elements, this.graphId)
  }

  undo() {
    if (this.state) this.manager._undoAttachNow(this.state)
  }

  get instance() {
    return this.state && this.state.instance
  }
}

class SetGeometryNodesEnabledCommand extends Command {
  constructor(manager, instanceId, enabled) {
    super(manager.editor)
    this.type = 'SetGeometryNodesEnabledCommand'
    this.name = enabled ? 'Enable Geometry Nodes' : 'Disable Geometry Nodes'
    this.manager = manager
    this.instanceId = instanceId
    this.enabled = Boolean(enabled)
    this.previous = Boolean(manager.instances.get(instanceId).enabled)
  }

  execute() {
    this.manager._setEnabledNow(this.instanceId, this.enabled)
  }

  undo() {
    this.manager._setEnabledNow(this.instanceId, this.previous)
  }
}

class RemoveGeometryNodesCommand extends Command {
  constructor(manager, instanceId) {
    super(manager.editor)
    this.type = 'RemoveGeometryNodesCommand'
    this.name = 'Remove Geometry Nodes Modifier'
    this.manager = manager
    this.instanceId = instanceId
    this.state = null
  }

  execute() {
    if (this.state) this.manager._redoRemoveNow(this.state)
    else this.state = this.manager._removeModifierNow(this.instanceId)
  }

  undo() {
    if (this.state) this.manager._undoRemoveNow(this.state)
  }
}

class ApplyGeometryNodesCommand extends Command {
  constructor(manager, instanceId) {
    super(manager.editor)
    this.type = 'ApplyGeometryNodesCommand'
    this.name = 'Apply Geometry Nodes Modifier'
    this.manager = manager
    this.instanceId = instanceId
    this.state = null
  }

  execute() {
    if (this.state) this.manager._redoApplyNow(this.state)
    else this.state = this.manager._applyModifierNow(this.instanceId)
  }

  undo() {
    if (this.state) this.manager._undoApplyNow(this.state)
  }
}

export {
  ApplyGeometryNodesCommand,
  AttachGeometryNodesCommand,
  GraphSnapshotCommand,
  RemoveGeometryNodesCommand,
  SetGeometryNodesEnabledCommand,
  cloneData,
}
