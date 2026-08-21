// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { GroupCommand } from '../src/js/commands/GroupCommand.js'
import { AddElementCommand } from '../src/js/commands/AddElementCommand.js'
import { HatchCommand } from '../src/js/commands/HatchCommand.js'
import { InsertCommand } from '../src/js/commands/InsertCommand.js'
import { PasteCommand } from '../src/js/commands/PasteCommand.js'
import { UngroupCommand } from '../src/js/commands/UngroupCommand.js'
import { EditVertexCommand } from '../src/js/commands/EditVertexCommand.js'
import { ExtendArcCommand } from '../src/js/commands/ExtendArcCommand.js'
import { FilletCommand } from '../src/js/commands/FilletCommand.js'
import { TrimLineCommand } from '../src/js/commands/TrimLineCommand.js'
import { dispatchSignalSafely } from '../src/js/Command.js'
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

function historySnapshot(editor) {
  return {
    redos: [...editor.history.redos],
    revision: editor.documentState.revision,
    undos: [...editor.history.undos],
  }
}

function expectHistory(editor, snapshot) {
  expect(editor.history.undos).toEqual(snapshot.undos)
  expect(editor.history.redos).toEqual(snapshot.redos)
  expect(editor.documentState.revision).toBe(snapshot.revision)
}

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('post-commit command boundaries', () => {
  test('safe signal delivery reports a faulty binding and continues later cleanup listeners', () => {
    const calls = []
    const report = vi.fn()
    const signal = {
      _bindings: [
        { execute: () => calls.push('cleanup'), _isOnce: false },
        { execute: () => { calls.push('broken'); throw new Error('listener failed') }, _isOnce: false },
      ],
      _shouldPropagate: true,
      active: true,
      dispatch: vi.fn(),
      memorize: false,
    }

    expect(dispatchSignalSafely(signal, ['value'], report)).toBe(true)
    expect(calls).toEqual(['broken', 'cleanup'])
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'listener failed' }))
    expect(signal.dispatch).not.toHaveBeenCalled()
  })

  test('AddElement restores its exact parent slot when removal fails during Undo', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const created = activeCollection.rect(2, 2)
    activeCollection.rect(1, 1).attr('id', 'after')
    const command = new AddElementCommand(editor, created, activeCollection)
    editor.execute(command)
    const appliedMarkup = activeCollection.node.outerHTML
    const appliedHistory = historySnapshot(editor)
    editor.removeElement = vi.fn((element) => {
      element.remove()
      throw new Error('injected add-element undo failure')
    })

    expect(() => editor.history.undo()).toThrow('injected add-element undo failure')
    expect(activeCollection.node.outerHTML).toBe(appliedMarkup)
    expect(created.parent()).toBe(activeCollection)
    expectHistory(editor, appliedHistory)
  })

  test('a faulty UI listener cannot orphan a successful mutation outside History', () => {
    const { activeCollection, editor } = createFixture()
    const first = activeCollection.rect(2, 2).attr('id', 'first')
    const second = activeCollection.rect(2, 2).attr('id', 'second')
    editor.selected = [first, second]
    editor.signals.updatedOutliner.add(() => {
      throw new Error('broken outliner listener')
    })
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})

    const command = new GroupCommand(editor)
    expect(() => editor.execute(command)).not.toThrow()

    expect(editor.history.undos).toEqual([command])
    expect(editor.documentState.revision).toBe(1)
    expect(editor.selected).toEqual([command.group])
    expect(command.group.children()).toHaveLength(2)
    expect(report).toHaveBeenCalledWith(
      '[GroupCommand] updatedOutliner listener failed:',
      expect.objectContaining({ message: 'broken outliner listener' }),
    )
  })

  test('a faulty UI listener cannot orphan a Trim replacement', () => {
    const { activeCollection, editor } = createFixture()
    const source = activeCollection.line(0, 0, 10, 0).attr('id', 'trim-source')
    const command = new TrimLineCommand(editor, source, {
      splitX1: 3,
      splitX2: 7,
      splitY1: 0,
      splitY2: 0,
      type: 'split',
    })
    editor.signals.updatedOutliner.add(() => {
      throw new Error('broken Trim outliner listener')
    })
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => editor.execute(command)).not.toThrow()

    expect(editor.history.undos).toEqual([command])
    expect(editor.documentState.revision).toBe(1)
    expect(source.array().map(([x, y]) => [Number(x), Number(y)])).toEqual([
      [0, 0],
      [3, 0],
    ])
    expect(command.newLine.array().map(([x, y]) => [Number(x), Number(y)])).toEqual([
      [7, 0],
      [10, 0],
    ])
    expect(report).toHaveBeenCalledWith(
      '[TrimLineCommand] updatedOutliner listener failed:',
      expect.objectContaining({ message: 'broken Trim outliner listener' }),
    )
  })

  test('a faulty UI listener cannot orphan Fillet arc creation', () => {
    const { activeCollection, editor } = createFixture()
    const horizontal = activeCollection.line(0, 0, 10, 0)
    const vertical = activeCollection.line(0, 0, 0, 10)
    const command = new FilletCommand(editor)
    command.selectedElements = [
      [horizontal, { x: 8, y: 0 }],
      [vertical, { x: 0, y: 8 }],
    ]
    command.storeOriginalStates()
    command.radius = 2
    command._mutationPrepared = true
    editor.signals.updatedOutliner.add(() => {
      throw new Error('broken Fillet outliner listener')
    })
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => editor.execute(command)).not.toThrow()

    expect(editor.history.undos).toEqual([command])
    expect(editor.documentState.revision).toBe(1)
    expect(command.createdElements).toHaveLength(1)
    expect(command.createdElements[0].node.parentNode).toBe(activeCollection.node)
    expect(horizontal.array().flat()).toEqual([expect.closeTo(2, 10), 0, 10, 0])
    expect(vertical.array().flat()).toEqual([0, expect.closeTo(2, 10), 0, 10])
    expect(report).toHaveBeenCalledWith(
      '[FilletCommand] updatedOutliner listener failed:',
      expect.objectContaining({ message: 'broken Fillet outliner listener' }),
    )
  })

  test.each([
    {
      create(activeCollection, editor) {
        const element = activeCollection.line(0, 0, 5, 0)
        return {
          command: new EditVertexCommand(editor, element, 1, 5, 0, 10, 0),
          element,
          expectApplied() {
            expect(element.array().map(([x, y]) => [Number(x), Number(y)])).toEqual([
              [0, 0],
              [10, 0],
            ])
          },
        }
      },
      label: 'line',
      type: 'EditVertexCommand',
    },
    {
      create(activeCollection, editor) {
        const arcData = {
          p1: { x: 0, y: 0 },
          p2: { x: 5, y: 5 },
          p3: { x: 10, y: 0 },
        }
        const element = activeCollection.path('M 0 0 A 5 5 0 0 0 10 0')
          .data('arcData', arcData)
        return {
          command: new ExtendArcCommand(editor, element, false, { x: 12, y: 0 }),
          element,
          expectApplied() {
            expect(element.data('arcData').p3).toEqual({ x: 12, y: 0 })
          },
        }
      },
      label: 'arc',
      type: 'ExtendArcCommand',
    },
  ])('a faulty UI listener cannot orphan an Extend $label mutation', ({
    create,
    type,
  }) => {
    const { activeCollection, editor } = createFixture()
    const { command, expectApplied } = create(activeCollection, editor)
    editor.signals.updatedOutliner.add(() => {
      throw new Error(`broken ${type} outliner listener`)
    })
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => editor.execute(command)).not.toThrow()

    expect(editor.history.undos).toEqual([command])
    expect(editor.documentState.revision).toBe(1)
    expectApplied()
    expect(report).toHaveBeenCalledWith(
      `[${type}] updatedOutliner listener failed:`,
      expect.objectContaining({ message: `broken ${type} outliner listener` }),
    )
  })

  test('GROUP and UNGROUP roll back a failed Undo to their exact applied states', () => {
    const grouped = createFixture()
    const groupedFirst = grouped.activeCollection.rect(2, 2).attr('id', 'first')
    const groupedSecond = grouped.activeCollection.rect(2, 2).attr('id', 'second')
    grouped.editor.selected = [groupedFirst, groupedSecond]
    const groupCommand = new GroupCommand(grouped.editor)
    grouped.editor.execute(groupCommand)
    const groupedMarkup = grouped.activeCollection.node.outerHTML
    const groupedHistory = historySnapshot(grouped.editor)
    const groupedInsert = grouped.activeCollection.node.insertBefore.bind(grouped.activeCollection.node)
    let groupedInsertions = 0
    vi.spyOn(grouped.activeCollection.node, 'insertBefore').mockImplementation((node, reference) => {
      groupedInsertions += 1
      if (groupedInsertions === 2) throw new Error('injected group undo failure')
      return groupedInsert(node, reference)
    })

    expect(() => grouped.editor.history.undo()).toThrow('injected group undo failure')
    expect(grouped.activeCollection.node.outerHTML).toBe(groupedMarkup)
    expect(grouped.editor.selected).toEqual([groupCommand.group])
    expectHistory(grouped.editor, groupedHistory)

    const ungrouped = createFixture()
    const wrapper = ungrouped.activeCollection.group().attr({
      id: 'group',
      'data-group': 'true',
    })
    wrapper.rect(2, 2).attr('id', 'first')
    wrapper.rect(2, 2).attr('id', 'second')
    ungrouped.editor.selected = [wrapper]
    const ungroupCommand = new UngroupCommand(ungrouped.editor)
    ungrouped.editor.execute(ungroupCommand)
    const ungroupedMarkup = ungrouped.activeCollection.node.outerHTML
    const ungroupedHistory = historySnapshot(ungrouped.editor)
    const ungroupedInsert = ungrouped.activeCollection.node.insertBefore.bind(
      ungrouped.activeCollection.node,
    )
    vi.spyOn(ungrouped.activeCollection.node, 'insertBefore')
      .mockImplementationOnce(() => {
        throw new Error('injected ungroup undo failure')
      })
      .mockImplementation(ungroupedInsert)

    expect(() => ungrouped.editor.history.undo()).toThrow('injected ungroup undo failure')
    expect(ungrouped.activeCollection.node.outerHTML).toBe(ungroupedMarkup)
    expect(ungrouped.editor.selected).toEqual(ungroupCommand.extracted)
    expectHistory(ungrouped.editor, ungroupedHistory)
  })

  test('INSERT restores every committed instance when a later Undo removal fails', () => {
    const { activeCollection, editor } = createFixture()
    const definition = editor.svg.defs().group().attr({ id: 'block-def-desk' })
    definition.rect(1, 1)
    editor.blockDefinitions.set('Desk', {
      basePoint: { x: 0, y: 0 },
      defId: 'block-def-desk',
      elementCount: 1,
    })
    const command = new InsertCommand(editor)
    command._onBlockSelected('Desk')
    command.onInsertionPoint({ x: 1, y: 1 })
    command.onInsertionPoint({ x: 4, y: 4 })
    command.finish()
    const appliedMarkup = activeCollection.node.outerHTML
    const appliedHistory = historySnapshot(editor)
    vi.spyOn(command.insertionRecords[1].element, 'remove').mockImplementationOnce(() => {
      throw new Error('injected insert undo failure')
    })

    expect(() => editor.history.undo()).toThrow('injected insert undo failure')
    expect(activeCollection.node.outerHTML).toBe(appliedMarkup)
    expectHistory(editor, appliedHistory)
  })

  test('HATCH restores its path when pattern removal fails during Undo', () => {
    const { activeCollection, editor } = createFixture()
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
    const appliedDrawing = activeCollection.node.outerHTML
    const appliedDefs = editor.svg.defs().node.innerHTML
    const appliedHistory = historySnapshot(editor)
    vi.spyOn(command.patternElement, 'remove').mockImplementationOnce(() => {
      throw new Error('injected hatch undo failure')
    })

    expect(() => editor.history.undo()).toThrow('injected hatch undo failure')
    expect(activeCollection.node.outerHTML).toBe(appliedDrawing)
    expect(editor.svg.defs().node.innerHTML).toBe(appliedDefs)
    expectHistory(editor, appliedHistory)
  })

  test('PASTE restores every scope wrapper when a later Undo removal fails', () => {
    const { activeCollection, editor } = createFixture()
    const command = new PasteCommand(editor, {
      elements: [
        { svg: '<rect xmlns="http://www.w3.org/2000/svg" width="3" height="2"/>' },
        { svg: '<circle xmlns="http://www.w3.org/2000/svg" r="2"/>' },
      ],
    })
    editor.execute(command)
    const appliedMarkup = activeCollection.node.outerHTML
    const appliedHistory = historySnapshot(editor)
    vi.spyOn(command._pasteRecords[1].container, 'remove').mockImplementationOnce(() => {
      throw new Error('injected paste undo failure')
    })

    expect(() => editor.history.undo()).toThrow('injected paste undo failure')
    expect(activeCollection.node.outerHTML).toBe(appliedMarkup)
    expectHistory(editor, appliedHistory)
  })
})
