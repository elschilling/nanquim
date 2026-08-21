// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { createBlockDefinition } from '../src/js/BlockManager.js'
import { BlockCommand } from '../src/js/commands/BlockCommand.js'
import { GroupCommand, groupCommand } from '../src/js/commands/GroupCommand.js'
import { HatchCommand } from '../src/js/commands/HatchCommand.js'
import { InsertCommand } from '../src/js/commands/InsertCommand.js'
import {
  MatchPropertiesCommand,
  MatchPropertiesMutation,
} from '../src/js/commands/MatchPropertiesCommand.js'
import { PasteCommand } from '../src/js/commands/PasteCommand.js'
import { UngroupCommand, ungroupCommand } from '../src/js/commands/UngroupCommand.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  if (!globalThis.CSS) globalThis.CSS = {}
  if (!globalThis.CSS.escape) {
    globalThis.CSS.escape = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&')
  }
  const fixture = createDeterministicEditorFixture()
  fixtures.push(fixture)
  return fixture
}

function childIds(parent) {
  return Array.from(parent.node.children, (node) => node.getAttribute('id'))
}

function placement(element) {
  return {
    element,
    index: Array.from(element.parent().node.children).indexOf(element.node),
    parent: element.parent(),
  }
}

function expectHistory(editor, undos, revision) {
  expect(editor.history.undos).toHaveLength(undos)
  expect(editor.history.redos).toHaveLength(0)
  expect(editor.documentState.revision).toBe(revision)
}

function historySnapshot(editor) {
  return {
    redos: [...editor.history.redos],
    revision: editor.documentState.revision,
    undos: [...editor.history.undos],
  }
}

function expectHistorySnapshot(editor, snapshot) {
  expect(editor.history.undos).toEqual(snapshot.undos)
  expect(editor.history.redos).toEqual(snapshot.redos)
  expect(editor.documentState.revision).toBe(snapshot.revision)
}

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('remaining transactional mutation boundaries', () => {
  test('GROUP is one reversible edit with stable identity and exact order', () => {
    const { activeCollection, editor } = createFixture()
    const before = activeCollection.rect(1, 1).attr('id', 'before')
    const first = activeCollection.rect(2, 2).attr('id', 'first')
    const second = activeCollection.circle(2).attr('id', 'second')
    const after = activeCollection.rect(1, 1).attr('id', 'after')
    editor.selected = [first, second]
    editor.elementIndex = 40

    const command = new GroupCommand(editor)
    editor.execute(command)

    expectHistory(editor, 1, 1)
    expect(childIds(activeCollection)).toEqual(['before', '40', 'after'])
    expect(Array.from(command.group.node.children)).toEqual([first.node, second.node])
    expect(editor.selected).toEqual([command.group])
    expect(editor.elementIndex).toBe(41)

    editor.history.undo()
    expect(childIds(activeCollection)).toEqual(['before', 'first', 'second', 'after'])
    expect(editor.selected).toEqual([first, second])
    expect(editor.documentState.revision).toBe(2)

    editor.history.redo()
    expect(childIds(activeCollection)).toEqual(['before', '40', 'after'])
    expect(editor.selected).toEqual([command.group])
    expect(command.group.attr('id')).toBe(40)
    expect(editor.documentState.revision).toBe(3)
    expect(before.parent()).toBe(activeCollection)
    expect(after.parent()).toBe(activeCollection)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
  })

  test('GROUP invalid and injected mid-apply failure leave exact state and counters', () => {
    const { activeCollection, editor } = createFixture()
    expect(groupCommand(editor)).toBeNull()
    expectHistory(editor, 0, 0)

    const first = activeCollection.rect(1, 1).attr('id', 'first')
    const second = activeCollection.rect(1, 1).attr('id', 'second')
    editor.selected = [first, second]
    editor.elementIndex = 70
    const command = new GroupCommand(editor)
    const originalGroup = activeCollection.group.bind(activeCollection)
    vi.spyOn(activeCollection, 'group').mockImplementation(() => {
      const group = originalGroup()
      const originalAdd = group.add.bind(group)
      let addCount = 0
      vi.spyOn(group, 'add').mockImplementation((element) => {
        addCount += 1
        if (addCount === 2) throw new Error('injected group failure')
        return originalAdd(element)
      })
      return group
    })

    expect(() => editor.execute(command)).toThrow('injected group failure')
    expectHistory(editor, 0, 0)
    expect(editor.elementIndex).toBe(70)
    expect(childIds(activeCollection)).toEqual(['first', 'second'])
    expect(first.parent()).toBe(activeCollection)
    expect(second.parent()).toBe(activeCollection)
    expect(activeCollection.find('[data-group="true"]')).toHaveLength(0)
  })

  test('GROUP inserts at the earliest selected sibling and rejects mixed parents', () => {
    const { activeCollection, editor } = createFixture()
    const first = activeCollection.rect(1, 1).attr('id', 'first')
    activeCollection.rect(1, 1).attr('id', 'intervening')
    const second = activeCollection.rect(1, 1).attr('id', 'second')
    activeCollection.rect(1, 1).attr('id', 'after')
    editor.selected = [second, first]

    const command = groupCommand(editor)
    expect(childIds(activeCollection)).toEqual([
      command.group.attr('id').toString(),
      'intervening',
      'after',
    ])
    expect(childIds(command.group)).toEqual(['first', 'second'])

    editor.history.undo()
    expect(childIds(activeCollection)).toEqual(['first', 'intervening', 'second', 'after'])

    const otherParent = editor.drawing.group().attr({
      id: 'other-collection',
      'data-collection': 'true',
    })
    const mixed = otherParent.rect(1, 1).attr('id', 'mixed')
    editor.selected = [first, mixed]
    const revisionBefore = editor.documentState.revision
    const historyBefore = editor.history.undos.length

    expect(groupCommand(editor)).toBeNull()
    expect(editor.documentState.revision).toBe(revisionBefore)
    expect(editor.history.undos).toHaveLength(historyBefore)
    expect(first.parent()).toBe(activeCollection)
    expect(mixed.parent()).toBe(otherParent)
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenLastCalledWith({
      msg: 'Selected elements must share the same parent before they can be grouped.',
    })
  })

  test('UNGROUP restores wrapper identity, child order, and selection', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const group = activeCollection.group().attr({
      id: 'group',
      'data-group': 'true',
    })
    const first = group.rect(1, 1).attr('id', 'first')
    const second = group.circle(1).attr('id', 'second')
    activeCollection.rect(1, 1).attr('id', 'after')
    editor.selected = [group]

    const command = ungroupCommand(editor)
    expect(command).toBeInstanceOf(UngroupCommand)
    expectHistory(editor, 1, 1)
    expect(childIds(activeCollection)).toEqual(['before', 'first', 'second', 'after'])
    expect(editor.selected).toEqual([first, second])

    editor.history.undo()
    expect(childIds(activeCollection)).toEqual(['before', 'group', 'after'])
    expect(Array.from(group.node.children)).toEqual([first.node, second.node])
    expect(editor.selected).toEqual([group])

    editor.history.redo()
    expect(childIds(activeCollection)).toEqual(['before', 'first', 'second', 'after'])
    expect(editor.selected).toEqual([first, second])
    expect(editor.documentState.revision).toBe(3)
  })

  test('UNGROUP rolls back every extracted child after a later insertion failure', () => {
    const { activeCollection, editor } = createFixture()
    const group = activeCollection.group().attr({
      id: 'group',
      'data-group': 'true',
    })
    group.rect(1, 1).attr('id', 'first')
    group.rect(1, 1).attr('id', 'second')
    editor.selected = [group]
    const before = activeCollection.node.outerHTML
    const originalInsertBefore = activeCollection.node.insertBefore.bind(activeCollection.node)
    let insertionCount = 0
    vi.spyOn(activeCollection.node, 'insertBefore').mockImplementation((node, reference) => {
      insertionCount += 1
      if (insertionCount === 2) throw new Error('injected ungroup failure')
      return originalInsertBefore(node, reference)
    })

    expect(() => editor.execute(new UngroupCommand(editor))).toThrow('injected ungroup failure')
    expect(activeCollection.node.outerHTML).toBe(before)
    expectHistory(editor, 0, 0)
  })

  test.each([
    ['transformed', (group) => group.transform({ translateX: 5, translateY: 2 })],
    ['styled', (group) => group.css({ opacity: 0.5, stroke: '#ff0000' })],
    ['class-styled', (group) => group.addClass('presentation-from-stylesheet')],
  ])('UNGROUP rejects %s wrappers without flattening semantics', (_label, decorate) => {
    const { activeCollection, editor } = createFixture()
    const group = activeCollection.group().attr({
      id: 'group',
      'data-group': 'true',
    })
    group.rect(1, 1).attr('id', 'child')
    decorate(group)
    editor.selected = [group]
    const before = activeCollection.node.outerHTML

    expect(ungroupCommand(editor)).toBeNull()
    expect(activeCollection.node.outerHTML).toBe(before)
    expectHistory(editor, 0, 0)
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenLastCalledWith({
      msg: 'Transformed or styled groups cannot be ungrouped without flattening their appearance.',
    })
  })

  test('BLOCK rejects mixed-parent selections before opening its modal or entering History', () => {
    const { activeCollection, editor } = createFixture()
    const first = activeCollection.rect(1, 1).attr('id', 'first')
    const otherParent = activeCollection.group().attr('id', 'other-parent')
    const second = otherParent.rect(1, 1).attr('id', 'second')
    editor.selected = [first, second]
    const before = editor.drawing.node.outerHTML

    const command = new BlockCommand(editor)
    command.onSelectionConfirmed()

    expect(editor.drawing.node.outerHTML).toBe(before)
    expect(document.querySelector('.block-modal-overlay')).toBeNull()
    expect(command.originalElements).toEqual([])
    expectHistory(editor, 0, 0)
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenLastCalledWith({
      msg: 'BLOCK requires selected elements to share the same parent.',
    })
  })

  test.each([
    ['selected geometry', (parent) => [parent.rect(1, 1).translate(5, 2)]],
    ['an ancestor', (parent) => {
      const wrapper = parent.group().translate(5, 2)
      return [wrapper.rect(1, 1), wrapper.circle(1)]
    }],
    ['a descendant', (parent) => {
      const wrapper = parent.group()
      wrapper.rect(1, 1).translate(5, 2)
      return [wrapper]
    }],
  ])('BLOCK rejects a non-identity transform on %s before modal or History', (_label, setup) => {
    const { activeCollection, editor } = createFixture()
    editor.selected = setup(activeCollection)
    const before = editor.drawing.node.outerHTML

    const command = new BlockCommand(editor)
    command.onSelectionConfirmed()

    expect(editor.drawing.node.outerHTML).toBe(before)
    expect(document.querySelector('.block-modal-overlay')).toBeNull()
    expect(command.originalElements).toEqual([])
    expectHistory(editor, 0, 0)
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenLastCalledWith({
      msg: 'BLOCK does not support transformed selections, ancestors, or descendants.',
    })
  })

  test('BLOCK commits definition, source replacement, and instance atomically', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const first = activeCollection.rect(2, 2).move(2, 3).attr('id', 'first')
    const second = activeCollection.circle(2).center(5, 5).attr('id', 'second')
    activeCollection.rect(1, 1).attr('id', 'after')
    editor.selected = [first, second]
    editor.elementIndex = 100
    const command = new BlockCommand(editor)
    command.originalElements = [first, second]
    command.originalParents = [activeCollection, activeCollection]
    command.originalPlacements = [placement(first), placement(second)]
    command.selectionBefore = [first, second]
    command.blockName = 'Door'

    command._finalize({ x: 2, y: 3 })

    expectHistory(editor, 1, 1)
    expect(editor.blockDefinitions.get('Door')).toEqual({
      basePoint: { x: 2, y: 3 },
      defId: 'block-def-100',
      elementCount: 2,
    })
    expect(command.defGroup.parent()).toBe(editor.svg.defs())
    expect(command.instance.parent()).toBe(activeCollection)
    expect(command.instance.attr('id')).toBe(101)
    expect(editor.selected).toEqual([command.instance])

    editor.history.undo()
    expect(editor.blockDefinitions.has('Door')).toBe(false)
    expect(childIds(activeCollection)).toEqual(['before', 'first', 'second', 'after'])
    expect(editor.selected).toEqual([first, second])

    editor.history.redo()
    expect(editor.blockDefinitions.get('Door').defId).toBe('block-def-100')
    expect(command.instance.attr('id')).toBe(101)
    expect(editor.selected).toEqual([command.instance])
    expect(editor.documentState.revision).toBe(3)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
  })

  test('BLOCK follows sibling order, replaces at the earliest slot, and preserves selection order', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const first = activeCollection.rect(2, 2).move(2, 3).attr({
      id: 'first',
      'data-source-order': 'first',
    })
    activeCollection.rect(1, 1).attr('id', 'intervening')
    const second = activeCollection.circle(2).center(5, 5).attr({
      id: 'second',
      'data-source-order': 'second',
    })
    activeCollection.rect(1, 1).attr('id', 'after')
    editor.selected = [second, first]
    editor.elementIndex = 150
    const command = new BlockCommand(editor)
    command.onSelectionConfirmed()

    expect(command.originalElements).toEqual([first, second])
    expect(command.selectionBefore).toEqual([second, first])
    command._closeModal()
    command.blockName = 'Ordered Door'

    command._finalize({ x: 2, y: 3 })

    const instanceNode = command.instance.node
    const definitionNode = command.defGroup.node
    expect(childIds(activeCollection)).toEqual([
      'before',
      command.instance.attr('id').toString(),
      'intervening',
      'after',
    ])
    expect(Array.from(command.defGroup.node.children, (node) => (
      node.getAttribute('data-source-order')
    ))).toEqual(['first', 'second'])

    editor.history.undo()
    expect(childIds(activeCollection)).toEqual([
      'before',
      'first',
      'intervening',
      'second',
      'after',
    ])
    expect(editor.selected).toEqual([second, first])

    editor.history.redo()
    expect(command.instance.node).toBe(instanceNode)
    expect(command.defGroup.node).toBe(definitionNode)
    expect(childIds(activeCollection)).toEqual([
      'before',
      command.instance.attr('id').toString(),
      'intervening',
      'after',
    ])
    expect(Array.from(command.defGroup.node.children, (node) => (
      node.getAttribute('data-source-order')
    ))).toEqual(['first', 'second'])
  })

  test('BLOCK rolls back a failed earliest-slot insertion without reordering sources', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const first = activeCollection.rect(1, 1).attr('id', 'first')
    activeCollection.rect(1, 1).attr('id', 'intervening')
    const second = activeCollection.rect(1, 1).attr('id', 'second')
    activeCollection.rect(1, 1).attr('id', 'after')
    editor.selected = [second, first]
    editor.elementIndex = 180
    const command = new BlockCommand(editor)
    command.originalElements = [second, first]
    command.originalParents = [activeCollection, activeCollection]
    command.originalPlacements = [placement(second), placement(first)]
    command.selectionBefore = [second, first]
    command.blockName = 'Failed Ordered Door'
    const collectionBefore = activeCollection.node.outerHTML
    const definitionsBefore = editor.svg.defs().node.innerHTML
    const selectionBefore = editor.selected
    const insertBefore = activeCollection.node.insertBefore.bind(activeCollection.node)
    vi.spyOn(activeCollection.node, 'insertBefore')
      .mockImplementationOnce(() => {
        throw new Error('injected block placement failure')
      })
      .mockImplementation((node, reference) => insertBefore(node, reference))

    expect(() => command._finalize({ x: 0, y: 0 }))
      .toThrow('injected block placement failure')

    expect(activeCollection.node.outerHTML).toBe(collectionBefore)
    expect(editor.svg.defs().node.innerHTML).toBe(definitionsBefore)
    expect(first.parent()).toBe(activeCollection)
    expect(second.parent()).toBe(activeCollection)
    expect(editor.selected).toBe(selectionBefore)
    expect(editor.selected).toEqual([second, first])
    expect(editor.elementIndex).toBe(180)
    expect(editor.blockDefinitions.has(command.blockName)).toBe(false)
    expect(editor.svg.defs().find('[data-block-def="true"]')).toHaveLength(0)
    expectHistory(editor, 0, 0)
  })

  test('BLOCK rolls back partial definition creation on a clone failure', () => {
    const { activeCollection, editor } = createFixture()
    const first = activeCollection.rect(1, 1).attr('id', 'first')
    const second = activeCollection.rect(1, 1).attr('id', 'second')
    editor.selected = [first, second]
    editor.elementIndex = 200
    const command = new BlockCommand(editor)
    command.originalElements = [first, second]
    command.originalParents = [activeCollection, activeCollection]
    command.originalPlacements = [placement(first), placement(second)]
    command.selectionBefore = [first, second]
    command.blockName = 'Broken'
    vi.spyOn(second, 'clone').mockImplementation(() => {
      throw new Error('injected clone failure')
    })

    expect(() => command._finalize({ x: 0, y: 0 })).toThrow('injected clone failure')
    expectHistory(editor, 0, 0)
    expect(editor.elementIndex).toBe(200)
    expect(editor.blockDefinitions.has('Broken')).toBe(false)
    expect(editor.svg.defs().find('[data-block-def="true"]')).toHaveLength(0)
    expect(childIds(activeCollection)).toEqual(['first', 'second'])
  })

  test.each([
    ['instance removal', ({ command }) => {
      const remove = command.instance.remove.bind(command.instance)
      vi.spyOn(command.instance, 'remove').mockImplementationOnce(() => {
        remove()
        throw new Error('injected instance removal failure')
      })
    }],
    ['definition removal', ({ command }) => {
      const remove = command.defGroup.remove.bind(command.defGroup)
      vi.spyOn(command.defGroup, 'remove').mockImplementationOnce(() => {
        remove()
        throw new Error('injected definition removal failure')
      })
    }],
    ['definition map removal', ({ editor }) => {
      const remove = editor.blockDefinitions.delete.bind(editor.blockDefinitions)
      vi.spyOn(editor.blockDefinitions, 'delete').mockImplementationOnce((name) => {
        remove(name)
        throw new Error('injected definition map failure')
      })
    }],
    ['source restoration', ({ activeCollection }) => {
      const insertBefore = activeCollection.node.insertBefore.bind(activeCollection.node)
      let insertionCount = 0
      vi.spyOn(activeCollection.node, 'insertBefore').mockImplementation((node, reference) => {
        insertionCount += 1
        if (insertionCount === 2) throw new Error('injected source restoration failure')
        return insertBefore(node, reference)
      })
    }],
  ])('BLOCK failed Undo at %s restores the exact applied block state', (_label, injectFailure) => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const first = activeCollection.rect(2, 2).attr('id', 'first')
    const second = activeCollection.circle(2).attr('id', 'second')
    activeCollection.rect(1, 1).attr('id', 'after')
    editor.selected = [first, second]
    editor.elementIndex = 240
    const command = new BlockCommand(editor)
    command.originalElements = [first, second]
    command.originalParents = [activeCollection, activeCollection]
    command.originalPlacements = [placement(first), placement(second)]
    command.selectionBefore = [first, second]
    command.blockName = 'Atomic Door'
    command._finalize({ x: 0, y: 0 })

    const collectionMarkup = activeCollection.node.outerHTML
    const definitionsMarkup = editor.svg.defs().node.innerHTML
    const metadata = editor.blockDefinitions.get(command.blockName)
    const instanceNode = command.instance.node
    const definitionNode = command.defGroup.node
    const elementIndex = editor.elementIndex
    const selected = editor.selected
    const undoStack = editor.history.undos
    const redoStack = editor.history.redos
    const undoEntries = [...undoStack]
    const redoEntries = [...redoStack]
    const revision = editor.documentState.revision
    const spatialInvalidations = editor.spatialIndex.markDirty.mock.calls.length
    const fullSpatialInvalidations = editor.fullSpatialIndex.markDirty.mock.calls.length
    injectFailure({ activeCollection, command, editor })

    expect(() => editor.history.undo()).toThrow('injected')

    expect(activeCollection.node.outerHTML).toBe(collectionMarkup)
    expect(editor.svg.defs().node.innerHTML).toBe(definitionsMarkup)
    expect(editor.blockDefinitions.get(command.blockName)).toBe(metadata)
    expect(command.instance.node).toBe(instanceNode)
    expect(command.instance.parent()).toBe(activeCollection)
    expect(command.defGroup.node).toBe(definitionNode)
    expect(command.defGroup.parent()).toBe(editor.svg.defs())
    expect(first.node.isConnected).toBe(false)
    expect(second.node.isConnected).toBe(false)
    expect(editor.elementIndex).toBe(elementIndex)
    expect(editor.selected).toBe(selected)
    expect(editor.selected).toEqual([command.instance])
    expect(editor.history.undos).toBe(undoStack)
    expect(editor.history.redos).toBe(redoStack)
    expect(editor.history.undos).toEqual(undoEntries)
    expect(editor.history.redos).toEqual(redoEntries)
    expect(editor.documentState.revision).toBe(revision)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(spatialInvalidations)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(fullSpatialInvalidations)
  })

  test('HATCH applies only inside history and preserves path and pattern identity', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(4, 4).attr('id', 'boundary')
    editor.elementIndex = 300
    const command = new HatchCommand(editor)
    command.patternType = 'ANSI31'
    command.hatchScale = 8
    command.pendingHatch = {
      boundaryCount: 4,
      fillColor: '#aabbcc',
      parent: activeCollection,
      pathD: 'M 0 0 L 4 0 L 4 4 L 0 4 Z',
      point: { x: 2, y: 2 },
    }
    command.interactiveExecutionDone = true

    editor.execute(command)
    const hatchNode = command.hatchElement.node
    const patternNode = command.patternElement.node
    expectHistory(editor, 1, 1)
    expect(command.hatchElement.attr('id')).toBe(300)
    expect(activeCollection.node.firstElementChild).toBe(hatchNode)
    expect(patternNode.isConnected).toBe(true)

    editor.history.undo()
    expect(hatchNode.isConnected).toBe(false)
    expect(patternNode.isConnected).toBe(false)

    editor.history.redo()
    expect(command.hatchElement.node).toBe(hatchNode)
    expect(command.patternElement.node).toBe(patternNode)
    expect(activeCollection.node.firstElementChild).toBe(hatchNode)
    expect(editor.documentState.revision).toBe(3)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
  })

  test('invalid HATCH preparation does not enter history or dirty the document', () => {
    const { activeCollection, editor } = createFixture()
    const before = activeCollection.node.outerHTML
    const command = new HatchCommand(editor)
    command.interactiveExecutionDone = true

    expect(() => editor.execute(command)).toThrow('requires a detected boundary')
    expectHistory(editor, 0, 0)
    expect(activeCollection.node.outerHTML).toBe(before)
  })

  test('HATCH removes a partially created pattern and path when apply fails', () => {
    const { activeCollection, editor } = createFixture()
    const before = activeCollection.node.outerHTML
    const defsBefore = editor.svg.defs().node.innerHTML
    const elementIndexBefore = editor.elementIndex
    const command = new HatchCommand(editor)
    command.patternType = 'ANSI31'
    command.pendingHatch = {
      boundaryCount: 4,
      fillColor: '#aabbcc',
      parent: activeCollection,
      pathD: 'M 0 0 L 4 0 L 4 4 Z',
      point: { x: 1, y: 1 },
    }
    command.interactiveExecutionDone = true
    const originalPath = activeCollection.path.bind(activeCollection)
    vi.spyOn(activeCollection, 'path').mockImplementation((pathData) => {
      const path = originalPath(pathData)
      vi.spyOn(path, 'attr').mockImplementationOnce(() => {
        throw new Error('injected hatch failure')
      })
      return path
    })

    expect(() => editor.execute(command)).toThrow('injected hatch failure')
    expect(activeCollection.node.outerHTML).toBe(before)
    expect(editor.svg.defs().node.innerHTML).toBe(defsBefore)
    expect(editor.elementIndex).toBe(elementIndexBefore)
    expectHistory(editor, 0, 0)
  })

  test('INSERT keeps previews transient, then commits one stable reversible batch', () => {
    const { activeCollection, editor } = createFixture()
    const { overlays } = editor
    const selectedBefore = activeCollection.rect(1, 1).attr('id', 'selected-before')
    editor.selected = [selectedBefore]
    const definition = editor.svg.defs().group().attr({
      id: 'block-def-chair',
      'data-block-def': 'true',
      'data-block-name': 'Chair',
    })
    definition.rect(2, 2)
    editor.blockDefinitions.set('Chair', {
      basePoint: { x: 0, y: 0 },
      defId: 'block-def-chair',
      elementCount: 1,
    })
    editor.elementIndex = 400
    const drawingBefore = activeCollection.node.outerHTML
    const command = new InsertCommand(editor)
    command._onBlockSelected('Chair')
    command.onInsertionPoint({ x: 5, y: 6 })

    expect(activeCollection.node.outerHTML).toBe(drawingBefore)
    expect(command.allInsertedInstances[0].parent()).toBe(overlays)
    expect(command.allInsertedInstances[0].attr('data-nanquim-transient')).toBe('true')
    expectHistory(editor, 0, 0)
    expect(editor.elementIndex).toBe(400)

    command.finish()
    const instance = command.allInsertedInstances[0]
    expectHistory(editor, 1, 1)
    expect(instance.parent()).toBe(activeCollection)
    expect(instance.attr('id')).toBe(400)
    expect(instance.attr('data-nanquim-transient')).toBeUndefined()
    expect(overlays.node.childElementCount).toBe(0)

    editor.history.undo()
    expect(instance.node.isConnected).toBe(false)
    expect(editor.selected).toEqual([selectedBefore])

    editor.history.redo()
    expect(instance.parent()).toBe(activeCollection)
    expect(instance.attr('id')).toBe(400)
    expect(editor.selected).toEqual([])
    expect(editor.documentState.revision).toBe(3)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
  })

  test('cancelling INSERT after placements discards previews without document state', () => {
    const { activeCollection, editor } = createFixture()
    const { overlays } = editor
    const definition = editor.svg.defs().group().attr({ id: 'block-def-table' })
    definition.rect(1, 1)
    editor.blockDefinitions.set('Table', {
      basePoint: { x: 0, y: 0 },
      defId: 'block-def-table',
      elementCount: 1,
    })
    const drawingBefore = activeCollection.node.outerHTML
    const elementIndexBefore = editor.elementIndex
    const command = new InsertCommand(editor)
    command._onBlockSelected('Table')
    command.onInsertionPoint({ x: 2, y: 2 })
    command.cancel()

    expect(activeCollection.node.outerHTML).toBe(drawingBefore)
    expect(overlays.node.childElementCount).toBe(0)
    expect(editor.elementIndex).toBe(elementIndexBefore)
    expectHistory(editor, 0, 0)
  })

  test('INSERT rolls back an earlier placement when a later placement cannot attach', () => {
    const { activeCollection, editor } = createFixture()
    const definition = editor.svg.defs().group().attr({ id: 'block-def-desk' })
    definition.rect(1, 1)
    editor.blockDefinitions.set('Desk', {
      basePoint: { x: 0, y: 0 },
      defId: 'block-def-desk',
      elementCount: 1,
    })
    editor.elementIndex = 500
    const drawingBefore = activeCollection.node.outerHTML
    const command = new InsertCommand(editor)
    command._onBlockSelected('Desk')
    command.onInsertionPoint({ x: 1, y: 1 })
    command.onInsertionPoint({ x: 3, y: 3 })
    const originalAdd = activeCollection.add.bind(activeCollection)
    let addCount = 0
    vi.spyOn(activeCollection, 'add').mockImplementation((element) => {
      addCount += 1
      if (addCount === 2) throw new Error('injected insert failure')
      return originalAdd(element)
    })

    expect(() => command.finish()).toThrow('injected insert failure')
    expect(activeCollection.node.outerHTML).toBe(drawingBefore)
    expect(editor.overlays.node.childElementCount).toBe(0)
    expect(editor.elementIndex).toBe(500)
    expectHistory(editor, 0, 0)
  })

  test('MATCHPROPERTIES is one reversible style, metadata, and collection edit', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.attr('name', 'Target collection')
    const sourceCollection = editor.drawing.group().attr({
      id: 'source-collection',
      'data-collection': 'true',
    })
    editor.collections.set('source-collection', {
      group: sourceCollection,
      style: {
        fill: '#cc5544',
        opacity: 0.75,
        stroke: '#ddaa88',
        'stroke-width': 2,
      },
    })
    const source = sourceCollection.rect(3, 2).attr({
      'data-style-overrides': JSON.stringify({
        fill: true,
        opacity: true,
        stroke: true,
        'stroke-width': true,
      }),
    }).css({
      fill: '#cc5544',
      opacity: 0.75,
      stroke: '#ddaa88',
      'stroke-width': 2,
    })
    activeCollection.rect(1, 1).attr('id', 'before')
    const target = activeCollection.rect(2, 2).attr({
      id: 'target',
      'data-custom': 'preserve-me',
    }).css({ fill: '#111111', stroke: '#222222' })
    activeCollection.rect(1, 1).attr('id', 'after')
    const beforeMarkup = activeCollection.node.outerHTML
    const command = new MatchPropertiesCommand(editor)
    command.execute()
    command.captureSourceProperties(source)
    editor.selected = [target]

    const mutation = command.applyPropertiesToTargets([target])
    expect(mutation).toBeInstanceOf(MatchPropertiesMutation)
    expectHistory(editor, 1, 1)
    expect(target.parent()).toBe(sourceCollection)
    expect(target.attr('data-custom')).toBe('preserve-me')
    const appliedMarkup = target.node.outerHTML
    command.cleanup()

    editor.history.undo()
    expect(activeCollection.node.outerHTML).toBe(beforeMarkup)
    expect(target.parent()).toBe(activeCollection)
    expect(editor.selected).toEqual([target])

    editor.history.redo()
    expect(target.parent()).toBe(sourceCollection)
    expect(target.node.outerHTML).toBe(appliedMarkup)
    expect(editor.selected).toEqual([])
    expect(editor.documentState.revision).toBe(3)
  })

  test('MATCHPROPERTIES rolls back every target when a later target fails', () => {
    const { activeCollection, editor } = createFixture()
    const first = activeCollection.rect(1, 1).attr('id', 'first')
    const second = activeCollection.rect(1, 1).attr('id', 'second')
    editor.selected = [first, second]
    const before = activeCollection.node.outerHTML
    const mutation = new MatchPropertiesMutation(editor, [first, second], {
      fill: '#abcdef',
      opacity: 0.5,
      overrides: { fill: true },
      rotation: 0,
      stroke: '#123456',
      strokeDasharray: 'none',
      strokeWidth: 3,
    })
    vi.spyOn(second, 'css').mockImplementationOnce(() => {
      throw new Error('injected style failure')
    })

    expect(() => editor.execute(mutation)).toThrow('injected style failure')
    expect(activeCollection.node.outerHTML).toBe(before)
    expectHistory(editor, 0, 0)
  })

  test('MATCHPROPERTIES restores the exact opposite state when Undo or Redo fails', () => {
    const { activeCollection, editor } = createFixture()
    const targetCollection = editor.drawing.group().attr({
      id: 'matched-collection',
      'data-collection': 'true',
    })
    editor.collections.set('matched-collection', {
      group: targetCollection,
      style: { fill: '#abcdef', stroke: '#123456' },
    })
    activeCollection.rect(1, 1).attr('id', 'before')
    const first = activeCollection.rect(1, 1).attr('id', 'first')
    activeCollection.rect(1, 1).attr('id', 'between')
    const second = activeCollection.rect(1, 1).attr('id', 'second')
    activeCollection.rect(1, 1).attr('id', 'after')
    editor.selected = [first, second]
    const mutation = new MatchPropertiesMutation(editor, [first, second], {
      collectionId: 'matched-collection',
      fill: '#abcdef',
      opacity: 0.5,
      overrides: { fill: true },
      rotation: 0,
      stroke: '#123456',
      strokeDasharray: 'none',
      strokeWidth: 3,
    })
    editor.execute(mutation)
    const appliedDrawing = editor.drawing.node.outerHTML
    const appliedHistory = historySnapshot(editor)
    const originalModelInsert = activeCollection.node.insertBefore.bind(activeCollection.node)
    let undoInsertions = 0
    vi.spyOn(activeCollection.node, 'insertBefore').mockImplementation((node, reference) => {
      undoInsertions += 1
      if (undoInsertions === 2) throw new Error('injected match-properties undo failure')
      return originalModelInsert(node, reference)
    })

    expect(() => editor.history.undo()).toThrow('injected match-properties undo failure')
    expect(editor.drawing.node.outerHTML).toBe(appliedDrawing)
    expect(editor.selected).toEqual([])
    expectHistorySnapshot(editor, appliedHistory)

    vi.restoreAllMocks()
    editor.history.undo()
    const undoneDrawing = editor.drawing.node.outerHTML
    const undoneHistory = historySnapshot(editor)
    const originalTargetInsert = targetCollection.node.insertBefore.bind(targetCollection.node)
    let redoInsertions = 0
    vi.spyOn(targetCollection.node, 'insertBefore').mockImplementation((node, reference) => {
      redoInsertions += 1
      if (redoInsertions === 2) throw new Error('injected match-properties redo failure')
      return originalTargetInsert(node, reference)
    })

    expect(() => editor.history.redo()).toThrow('injected match-properties redo failure')
    expect(editor.drawing.node.outerHTML).toBe(undoneDrawing)
    expect(editor.selected).toEqual([first, second])
    expectHistorySnapshot(editor, undoneHistory)
  })

  test('PASTE invalid input is a no-op and valid paste invalidates both indexes', () => {
    const { activeCollection, editor } = createFixture()
    const invalidBefore = activeCollection.node.outerHTML
    const elementIndexBefore = editor.elementIndex
    expect(() => editor.execute(new PasteCommand(editor, {
      elements: [{ svg: '<g><path></g>' }],
    }))).toThrow('did not contain any supported safe SVG elements')
    expect(activeCollection.node.outerHTML).toBe(invalidBefore)
    expect(editor.elementIndex).toBe(elementIndexBefore)
    expectHistory(editor, 0, 0)

    const command = new PasteCommand(editor, {
      elements: [{ svg: '<rect xmlns="http://www.w3.org/2000/svg" width="3" height="2"/>' }],
    })
    const pasteElementIndex = editor.elementIndex
    editor.execute(command)
    const pasted = command.pastedElements[0]
    const container = pasted.node.parentElement
    expectHistory(editor, 1, 1)
    expect(editor.selected).toEqual([pasted])
    expect(pasted.node.getAttribute('id')).toBe(String(pasteElementIndex))
    expect(container.getAttribute('id')).toBe(String(pasteElementIndex + 1))
    expect(container.getAttribute('name')).toBe(`G ${pasteElementIndex + 1}`)
    expect(editor.elementIndex).toBe(pasteElementIndex + 2)

    editor.history.undo()
    expect(pasted.node.isConnected).toBe(false)
    editor.history.redo()
    expect(command.pastedElements[0]).toBe(pasted)
    expect(pasted.node.parentElement).toBe(container)
    expect(container.getAttribute('id')).toBe(String(pasteElementIndex + 1))
    expect(pasted.node.isConnected).toBe(true)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.documentState.revision).toBe(3)
  })
})
