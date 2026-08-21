// @vitest-environment jsdom

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { COMMAND_ILLUSTRATION_NAMES } from '../src/js/CommandIllustrations.js'
import { COMMAND_ICON_NAMES } from '../src/js/CommandIcons.js'
import commands, {
  commandCategories,
  executeRegisteredCommand,
  resolveRegisteredCommand,
} from '../src/js/commands/_commands.js'
import { COMMAND_LIFECYCLE_CONTRACTS } from './command-lifecycle-contracts.js'
import {
  createDeterministicEditorFixture,
  expectNoInteractionLeaks,
  installClockHarness,
  installDomListenerTracker,
  snapshotInteractionState,
} from './support/deterministic-harness.js'

const ALLOWED_CANCEL_POLICIES = new Set([
  'command-signal',
  'drawing-event',
  'immediate',
  'keyboard-escape',
  'rectangle-dimension',
])
const ALLOWED_INPUT_PATHS = new Set([
  'action',
  'coordinate',
  'dialog',
  'pointer',
  'selection',
  'text',
  'value',
])
const ALLOWED_MODES = new Set(['model', 'paper'])
const projectPath = (...parts) => join(process.cwd(), ...parts)

function terminalMessages(editor) {
  const messages = []
  editor.signals.terminalLogged.add((entry) => messages.push(String(entry?.msg || '')))
  return messages
}

function prepareInteractiveEntry(commandName, editor) {
  if (commandName === 'HELP') {
    editor.helpSession = { open: vi.fn() }
  }

  if (commandName === 'INSERT') {
    const definitionId = 'block-def-lifecycle-fixture'
    editor.svg.defs().group()
      .attr({
        id: definitionId,
        'data-base-point': JSON.stringify({ x: 0, y: 0 }),
        'data-block-def': 'true',
        'data-block-name': 'Lifecycle fixture',
      })
      .line(0, 0, 10, 0)
    editor.blockDefinitions.set('Lifecycle fixture', {
      basePoint: { x: 0, y: 0 },
      defId: definitionId,
      elementCount: 1,
    })
  }
}

function keyEvent(type, init = {}) {
  return new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    code: 'Escape',
    key: 'Escape',
    ...init,
  })
}

async function cancelActiveCommand(commandName, fixture, clock) {
  const { editor } = fixture
  const contract = COMMAND_LIFECYCLE_CONTRACTS[commandName]

  if (contract.cancel === 'immediate') return

  if (contract.cancel === 'rectangle-dimension') {
    const rectangle = editor.activeCollection.findOne('rect')
    expect(rectangle, 'RECTANGLE preview').not.toBeNull()
    rectangle.remember('_paintHandler', { startPoint: { x: 10, y: 20 } })
    fixture.fireDraw(rectangle, 'drawstart')
    document.dispatchEvent(keyEvent('keydown', { code: 'KeyD', key: 'd' }))
    expect(editor.signals.inputValue.getNumListeners()).toBe(1)
  }

  // Mirror and several selection commands own keydown cleanup. Match
  // Properties also installs a one-shot keyup guard, so reproduce both halves
  // of the browser Escape gesture before the Terminal cancellation fan-out.
  document.dispatchEvent(keyEvent('keydown'))
  document.dispatchEvent(keyEvent('keyup'))

  const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
  activeSvg.fire('cancelDrawing', {})
  editor.signals.commandCancelled.dispatch()

  await Promise.resolve()
  await Promise.resolve()
  await clock.runAll()
}

function extendedInteractionState(editor, harnesses) {
  return {
    ...snapshotInteractionState(editor, { ...harnesses, includeElementIndex: true }),
    activeGeometry: editor.activeCollection.node.childElementCount,
    blockModals: document.querySelectorAll('.block-modal-overlay').length,
    commandFlags: {
      preventSelection: Boolean(editor.preventSelection),
      suppressHandlers: Boolean(editor.suppressHandlers),
    },
    paperGeometry: editor.paperDrawing.node.childElementCount,
  }
}

async function runLifecycleCycle(commandName, mode) {
  const listenerTracker = installDomListenerTracker()
  const clock = installClockHarness()
  const fixture = createDeterministicEditorFixture({ mode })
  const { editor, signalHarness } = fixture
  const messages = terminalMessages(editor)
  prepareInteractiveEntry(commandName, editor)
  const harnesses = { clock, listenerTracker, signalHarness }
  const baseline = extendedInteractionState(editor, harnesses)
  const initialHistoryLength = editor.history.undos.length

  try {
    const result = commands[commandName].execute(editor)
    const contract = COMMAND_LIFECYCLE_CONTRACTS[commandName]

    if (contract.prompt !== null) {
      expect(
        messages.join('\n').toLowerCase(),
        `${commandName} initial prompt`,
      ).toContain(contract.prompt.toLowerCase())
    }

    await cancelActiveCommand(commandName, fixture, clock)
    if (result && typeof result.then === 'function') await result

    expect(extendedInteractionState(editor, harnesses), `${commandName} ${mode} cleanup`)
      .toEqual(baseline)

    if (contract.cancel !== 'immediate') {
      expect(editor.history.undos, `${commandName} cancelled history`).toHaveLength(initialHistoryLength)
      expect(editor.documentState.isDirty, `${commandName} cancelled dirty state`).toBe(false)
      expect(editor.documentState.revision, `${commandName} cancelled revision`).toBe(0)
    }
  } finally {
    fixture.dispose()
    clock.dispose()
    listenerTracker.dispose()
  }
}

describe('registry-driven command lifecycle contracts', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('keeps lifecycle, Help, illustration, icon, and registry metadata in exact parity', () => {
    const commandNames = Object.keys(commands)
    const aliases = []

    expect(Object.keys(COMMAND_LIFECYCLE_CONTRACTS)).toEqual(commandNames)
    expect([...COMMAND_ILLUSTRATION_NAMES].sort()).toEqual([...commandNames].sort())
    expect([...COMMAND_ICON_NAMES].sort()).toEqual([...commandNames].sort())

    for (const [name, definition] of Object.entries(commands)) {
      const contract = COMMAND_LIFECYCLE_CONTRACTS[name]
      expect(definition.execute, `${name} execute`).toBeTypeOf('function')
      expect(definition.aliases, `${name} aliases`).toEqual(expect.any(Array))
      expect(definition.aliases.length, `${name} aliases`).toBeGreaterThan(0)
      expect(commandCategories, `${name} category`).toContain(definition.category)
      expect(definition.description.trim().length, `${name} description`).toBeGreaterThan(12)
      expect(ALLOWED_CANCEL_POLICIES.has(contract.cancel), `${name} cancel policy`).toBe(true)
      expect(contract.input.length, `${name} input paths`).toBeGreaterThan(0)
      expect(new Set(contract.input).size, `${name} unique input paths`).toBe(contract.input.length)
      contract.input.forEach((path) => {
        expect(ALLOWED_INPUT_PATHS.has(path), `${name} input path ${path}`).toBe(true)
      })
      expect(contract.modes.length, `${name} modes`).toBeGreaterThan(0)
      expect(new Set(contract.modes).size, `${name} unique modes`).toBe(contract.modes.length)
      expect(definition.modes, `${name} registry modes`).toEqual(contract.modes)
      contract.modes.forEach((mode) => {
        expect(ALLOWED_MODES.has(mode), `${name} mode ${mode}`).toBe(true)
      })

      expect(resolveRegisteredCommand(name)).toMatchObject({ name, definition })

      definition.aliases.forEach((alias) => {
        expect(alias, `${name} normalized alias`).toBe(alias.trim().toLowerCase())
        expect(resolveRegisteredCommand(alias)).toMatchObject({ name, definition })
        aliases.push(alias)
      })
    }

    expect(new Set(aliases).size).toBe(aliases.length)
  })

  const supportedEntries = Object.entries(COMMAND_LIFECYCLE_CONTRACTS)
    .flatMap(([commandName, contract]) => (
      contract.modes.map((mode) => [commandName, mode])
    ))

  test.each(supportedEntries)(
    '%s has a stable %s invocation and cancellation lifecycle',
    async (commandName, mode) => {
      await runLifecycleCycle(commandName, mode)
      await runLifecycleCycle(commandName, mode)
    },
  )

  test.each([
    ['ROTATE', 'paper', 'Command not available in Paper Space.'],
    ['SCALE', 'paper', 'Command not available in Paper Space.'],
    ['VIEWPORT', 'model', 'VP command only available in Paper Space.'],
  ])('%s rejects unsupported %s entry without starting a session', async (commandName, mode, message) => {
    const listenerTracker = installDomListenerTracker()
    const clock = installClockHarness()
    const fixture = createDeterministicEditorFixture({ mode })
    const { editor, signalHarness } = fixture
    const messages = terminalMessages(editor)
    const harnesses = { clock, listenerTracker, signalHarness }
    const baseline = snapshotInteractionState(editor, harnesses)

    try {
      await commands[commandName].execute(editor)
      expect(messages.join('\n')).toContain(message)
      expectNoInteractionLeaks(editor, baseline, harnesses)
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.documentState.isDirty).toBe(false)
      expect(editor.documentState.revision).toBe(0)
    } finally {
      fixture.dispose()
      clock.dispose()
      listenerTracker.dispose()
    }
  })

  const unsupportedEntries = Object.entries(COMMAND_LIFECYCLE_CONTRACTS)
    .flatMap(([commandName, contract]) => (
      [...ALLOWED_MODES]
        .filter((mode) => !contract.modes.includes(mode))
        .map((mode) => [commandName, mode])
    ))

  test.each(unsupportedEntries)(
    '%s is centrally rejected in unsupported %s mode without side effects',
    async (commandName, mode) => {
      const listenerTracker = installDomListenerTracker()
      const clock = installClockHarness()
      const fixture = createDeterministicEditorFixture({ mode })
      const { editor, signalHarness } = fixture
      const messages = terminalMessages(editor)
      const harnesses = { clock, listenerTracker, signalHarness }
      const baseline = snapshotInteractionState(editor, harnesses)

      try {
        executeRegisteredCommand(editor, commandName)
        expect(messages).toContain(
          `Command not available in ${mode === 'paper' ? 'Paper' : 'Model'} Space.`,
        )
        await clock.runAll()
        expectNoInteractionLeaks(editor, baseline, harnesses)
        expect(editor.history.undos).toHaveLength(0)
        expect(editor.documentState.isDirty).toBe(false)
        expect(editor.documentState.revision).toBe(0)
      } finally {
        fixture.dispose()
        clock.dispose()
        listenerTracker.dispose()
      }
    },
  )

  test('AREA measures Paper annotation geometry without creating document history', () => {
    const listenerTracker = installDomListenerTracker()
    const clock = installClockHarness()
    const fixture = createDeterministicEditorFixture({ mode: 'paper' })
    const { editor, signalHarness } = fixture
    const messages = terminalMessages(editor)
    const annotation = editor.paperDrawing.rect(12, 8).move(4, 6)
    const harnesses = { clock, listenerTracker, signalHarness }
    const baseline = extendedInteractionState(editor, harnesses)

    try {
      expect(executeRegisteredCommand(editor, 'AREA')).toBe(true)
      editor.signals.toogledSelect.dispatch(annotation)

      expect(messages).toContain('Area = 96.0000')
      expect(extendedInteractionState(editor, harnesses)).toEqual(baseline)
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.documentState.revision).toBe(0)
    } finally {
      fixture.dispose()
      clock.dispose()
      listenerTracker.dispose()
    }
  })

  test.each(['OFFSET', 'FILLET', 'EXTEND', 'TRIM'])(
    '%s survives repeated high-risk start/cancel cycles without helper or listener growth',
    async (commandName) => {
      const listenerTracker = installDomListenerTracker()
      const clock = installClockHarness()
      const fixture = createDeterministicEditorFixture()
      const { editor, signalHarness } = fixture
      terminalMessages(editor)
      const harnesses = { clock, listenerTracker, signalHarness }
      const baseline = extendedInteractionState(editor, harnesses)

      try {
        for (let cycle = 0; cycle < 8; cycle += 1) {
          commands[commandName].execute(editor)
          if (commandName === 'EXTEND' || commandName === 'TRIM') {
            document.dispatchEvent(keyEvent('keydown', { code: 'Enter', key: 'Enter' }))
          }
          await cancelActiveCommand(commandName, fixture, clock)
          expect(extendedInteractionState(editor, harnesses), `${commandName} cycle ${cycle + 1}`)
            .toEqual(baseline)
        }

        expect(editor.history.undos).toHaveLength(0)
        expect(editor.documentState.isDirty).toBe(false)
        expect(editor.documentState.revision).toBe(0)
      } finally {
        fixture.dispose()
        clock.dispose()
        listenerTracker.dispose()
      }
    },
  )

  test('FILLET commits a line-line radius once and round-trips geometry and indexes', async () => {
    const listenerTracker = installDomListenerTracker()
    const clock = installClockHarness()
    const fixture = createDeterministicEditorFixture()
    const { editor, signalHarness } = fixture
    terminalMessages(editor)
    const horizontal = editor.activeCollection.line(0, 0, 10, 0)
    const vertical = editor.activeCollection.line(0, 0, 0, 10)
    editor.cmdParams.filletRadius = 2
    const harnesses = { clock, listenerTracker, signalHarness }
    const baseline = snapshotInteractionState(editor, harnesses)

    try {
      commands.FILLET.execute(editor)
      editor.lastClick = { x: 8, y: 0 }
      editor.signals.toogledSelect.dispatch(horizontal)
      editor.lastClick = { x: 0, y: 8 }
      editor.signals.toogledSelect.dispatch(vertical)
      await clock.runAll()

      expectNoInteractionLeaks(editor, baseline, harnesses)
      expect(editor.history.undos).toHaveLength(1)
      expect(editor.history.undos[0].type).toBe('FilletCommand')
      expect(editor.documentState.revision).toBe(1)
      expect(horizontal.array().flat()).toEqual([
        expect.closeTo(2, 10), 0, 10, 0,
      ])
      expect(vertical.array().flat()).toEqual([
        0, expect.closeTo(2, 10), 0, 10,
      ])

      let arc = editor.activeCollection.findOne('path')
      expect(arc).not.toBeNull()
      expect(arc.attr('name')).toBe('Arc')
      const arcId = arc.attr('id')
      expect(arc.data('arcData').p1.x).toBeCloseTo(2)
      expect(arc.data('arcData').p1.y).toBeCloseTo(0)
      expect(arc.data('arcData').p3.x).toBeCloseTo(0)
      expect(arc.data('arcData').p3.y).toBeCloseTo(2)

      editor.history.undo()
      expect(horizontal.array().flat()).toEqual([0, 0, 10, 0])
      expect(vertical.array().flat()).toEqual([0, 0, 0, 10])
      expect(arc.node.isConnected).toBe(false)
      expect(editor.documentState.revision).toBe(2)

      editor.history.redo()
      const restoredArc = editor.activeCollection.findOne('path')
      expect(horizontal.array().flat()).toEqual([
        expect.closeTo(2, 10), 0, 10, 0,
      ])
      expect(vertical.array().flat()).toEqual([
        0, expect.closeTo(2, 10), 0, 10,
      ])
      expect(restoredArc).toBe(arc)
      expect(restoredArc.attr('id')).toBe(arcId)
      expect(editor.documentState.revision).toBe(3)
      expect(editor.spatialIndex.markDirty).toHaveBeenCalled()
      expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalled()
    } finally {
      fixture.dispose()
      clock.dispose()
      listenerTracker.dispose()
    }
  })

  test('FILLET restores geometry and its ID allocator when first apply fails after arc creation', () => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const horizontal = editor.activeCollection.line(0, 0, 10, 0)
    const vertical = editor.activeCollection.line(0, 0, 0, 10)
    const initialElementIndex = editor.elementIndex
    const historyExecute = editor.execute

    editor.cmdParams.filletRadius = 2
    editor.execute = (command) => {
      command.trimConnectedLineToPoint = vi.fn(() => {
        throw new Error('injected fillet failure')
      })
      return historyExecute(command)
    }

    try {
      commands.FILLET.execute(editor)
      editor.lastClick = { x: 8, y: 0 }
      editor.signals.toogledSelect.dispatch(horizontal)
      editor.lastClick = { x: 0, y: 8 }
      editor.signals.toogledSelect.dispatch(vertical)

      expect(horizontal.array().flat()).toEqual([0, 0, 10, 0])
      expect(vertical.array().flat()).toEqual([0, 0, 0, 10])
      expect(editor.activeCollection.findOne('path')).toBeNull()
      expect(editor.elementIndex).toBe(initialElementIndex)
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.history.redos).toHaveLength(0)
      expect(editor.documentState.revision).toBe(0)
    } finally {
      fixture.dispose()
    }
  })

  test.each([
    {
      expected: 'Fillet only works with line elements.',
      prepare(editor) {
        return [
          editor.activeCollection.line(0, 0, 10, 0),
          editor.activeCollection.circle(10).center(0, 0),
        ]
      },
      radius: 2,
      title: 'unsupported geometry',
    },
    {
      expected: 'Fillet radius must be a finite number greater than or equal to zero.',
      input: 'not-a-radius',
      prepare() {
        return []
      },
      radius: 2,
      title: 'invalid radius',
    },
  ])('FILLET rejects $title without history or leaked interaction state', async ({ expected, input, prepare, radius }) => {
    const listenerTracker = installDomListenerTracker()
    const clock = installClockHarness()
    const fixture = createDeterministicEditorFixture()
    const { editor, signalHarness } = fixture
    const messages = terminalMessages(editor)
    const elements = prepare(editor)
    editor.cmdParams.filletRadius = radius
    const harnesses = { clock, listenerTracker, signalHarness }
    const baseline = snapshotInteractionState(editor, harnesses)

    try {
      commands.FILLET.execute(editor)
      if (input !== undefined) {
        editor.signals.inputValue.dispatch(input)
      } else {
        editor.lastClick = { x: 8, y: 0 }
        editor.signals.toogledSelect.dispatch(elements[0])
        editor.lastClick = { x: 0, y: 5 }
        editor.signals.toogledSelect.dispatch(elements[1])
      }
      await clock.runAll()

      expect(messages).toContain(expected)
      expectNoInteractionLeaks(editor, baseline, harnesses)
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.documentState.isDirty).toBe(false)
      expect(editor.documentState.revision).toBe(0)
    } finally {
      fixture.dispose()
      clock.dispose()
      listenerTracker.dispose()
    }
  })

  test('TRIM shortens a crossing line and round-trips geometry and indexes', async () => {
    const listenerTracker = installDomListenerTracker()
    const clock = installClockHarness()
    const fixture = createDeterministicEditorFixture()
    const { editor, signalHarness } = fixture
    terminalMessages(editor)
    const boundary = editor.activeCollection.line(5, -5, 5, 5)
    const target = editor.activeCollection.line(0, 0, 10, 0)
    const harnesses = { clock, listenerTracker, signalHarness }
    const baseline = snapshotInteractionState(editor, harnesses)

    try {
      commands.TRIM.execute(editor)
      editor.signals.toogledSelect.dispatch(boundary)
      document.dispatchEvent(keyEvent('keydown', { code: 'Enter', key: 'Enter' }))
      editor.lastClick = { x: 8, y: 0 }
      editor.signals.toogledSelect.dispatch(target)
      await cancelActiveCommand('TRIM', fixture, clock)

      expectNoInteractionLeaks(editor, baseline, harnesses)
      expect(editor.history.undos).toHaveLength(1)
      expect(editor.history.undos[0].type).toBe('TrimLineCommand')
      expect(target.array().flat()).toEqual([0, 0, 5, 0])
      expect(editor.documentState.revision).toBe(1)

      editor.history.undo()
      expect(target.array().flat()).toEqual([0, 0, 10, 0])
      expect(editor.documentState.revision).toBe(2)
      editor.history.redo()
      expect(target.array().flat()).toEqual([0, 0, 5, 0])
      expect(editor.documentState.revision).toBe(3)
      expect(editor.spatialIndex.markDirty).toHaveBeenCalled()
      expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalled()
    } finally {
      fixture.dispose()
      clock.dispose()
      listenerTracker.dispose()
    }
  })

  test('TRIM reports unsupported geometry without mutation', async () => {
    const listenerTracker = installDomListenerTracker()
    const clock = installClockHarness()
    const fixture = createDeterministicEditorFixture()
    const { editor, signalHarness } = fixture
    const messages = terminalMessages(editor)
    const boundary = editor.activeCollection.line(5, -5, 5, 5)
    const unsupported = editor.activeCollection.group()
    const harnesses = { clock, listenerTracker, signalHarness }
    const baseline = snapshotInteractionState(editor, harnesses)

    try {
      commands.TRIM.execute(editor)
      editor.signals.toogledSelect.dispatch(boundary)
      document.dispatchEvent(keyEvent('keydown', { code: 'Enter', key: 'Enter' }))
      editor.lastClick = { x: 0, y: 0 }
      editor.signals.toogledSelect.dispatch(unsupported)
      await cancelActiveCommand('TRIM', fixture, clock)

      expect(messages).toContain(
        'Only lines, rectangles, polygons, circles/arcs, ellipses, splines, and polylines can be trimmed.',
      )
      expectNoInteractionLeaks(editor, baseline, harnesses)
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.documentState.revision).toBe(0)
    } finally {
      fixture.dispose()
      clock.dispose()
      listenerTracker.dispose()
    }
  })

  test('EXTEND lengthens a line to a boundary and round-trips geometry and indexes', async () => {
    const listenerTracker = installDomListenerTracker()
    const clock = installClockHarness()
    const fixture = createDeterministicEditorFixture()
    const { editor, signalHarness } = fixture
    terminalMessages(editor)
    const boundary = editor.activeCollection.line(10, -5, 10, 5)
    const target = editor.activeCollection.line(0, 0, 5, 0)
    const harnesses = { clock, listenerTracker, signalHarness }
    const baseline = snapshotInteractionState(editor, harnesses)

    try {
      commands.EXTEND.execute(editor)
      editor.signals.toogledSelect.dispatch(boundary)
      document.dispatchEvent(keyEvent('keydown', { code: 'Enter', key: 'Enter' }))
      editor.lastClick = { x: 5, y: 0 }
      editor.signals.toogledSelect.dispatch(target)
      await cancelActiveCommand('EXTEND', fixture, clock)

      expectNoInteractionLeaks(editor, baseline, harnesses)
      expect(editor.history.undos).toHaveLength(1)
      expect(editor.history.undos[0].type).toBe('EditVertexCommand')
      expect(target.array().flat()).toEqual([0, 0, 10, 0])
      expect(editor.documentState.revision).toBe(1)

      editor.history.undo()
      expect(target.array().flat()).toEqual([0, 0, 5, 0])
      expect(editor.documentState.revision).toBe(2)
      editor.history.redo()
      expect(target.array().flat()).toEqual([0, 0, 10, 0])
      expect(editor.documentState.revision).toBe(3)
      expect(editor.spatialIndex.markDirty).toHaveBeenCalled()
      expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalled()
    } finally {
      fixture.dispose()
      clock.dispose()
      listenerTracker.dispose()
    }
  })

  test('EXTEND reports unsupported geometry without mutation', async () => {
    const listenerTracker = installDomListenerTracker()
    const clock = installClockHarness()
    const fixture = createDeterministicEditorFixture()
    const { editor, signalHarness } = fixture
    const messages = terminalMessages(editor)
    const boundary = editor.activeCollection.line(10, -5, 10, 5)
    const unsupported = editor.activeCollection.circle(4).center(0, 0)
    const harnesses = { clock, listenerTracker, signalHarness }
    const baseline = snapshotInteractionState(editor, harnesses)

    try {
      commands.EXTEND.execute(editor)
      editor.signals.toogledSelect.dispatch(boundary)
      document.dispatchEvent(keyEvent('keydown', { code: 'Enter', key: 'Enter' }))
      editor.lastClick = { x: 0, y: 0 }
      editor.signals.toogledSelect.dispatch(unsupported)
      await cancelActiveCommand('EXTEND', fixture, clock)

      expect(messages).toContain('Only lines, arcs, splines, and polylines can be extended.')
      expectNoInteractionLeaks(editor, baseline, harnesses)
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.documentState.revision).toBe(0)
    } finally {
      fixture.dispose()
      clock.dispose()
      listenerTracker.dispose()
    }
  })

  test('OFFSET rejects invalid typed distance transactionally', async () => {
    const listenerTracker = installDomListenerTracker()
    const clock = installClockHarness()
    const fixture = createDeterministicEditorFixture()
    const { editor, signalHarness } = fixture
    const messages = terminalMessages(editor)
    const harnesses = { clock, listenerTracker, signalHarness }
    const baseline = extendedInteractionState(editor, harnesses)

    try {
      commands.OFFSET.execute(editor)
      editor.signals.inputValue.dispatch('not-a-distance')
      await clock.runAll()

      expect(messages).toContain('Invalid distance. Command cancelled.')
      expect(extendedInteractionState(editor, harnesses)).toEqual(baseline)
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.documentState.isDirty).toBe(false)
      expect(editor.documentState.revision).toBe(0)
    } finally {
      fixture.dispose()
      clock.dispose()
      listenerTracker.dispose()
    }
  })

  test('OFFSET commits the chosen line side once and round-trips through Undo/Redo', async () => {
    const listenerTracker = installDomListenerTracker()
    const clock = installClockHarness()
    const fixture = createDeterministicEditorFixture()
    const { editor, signalHarness } = fixture
    terminalMessages(editor)
    const original = editor.activeCollection.line(0, 0, 10, 0)
      .attr({ id: 'source-line', name: 'Source line' })
      .css({ stroke: '#ffffff', 'stroke-width': 0.25 })
    const harnesses = { clock, listenerTracker, signalHarness }
    const baseline = snapshotInteractionState(editor, harnesses)

    try {
      commands.OFFSET.execute(editor)
      editor.signals.inputValue.dispatch('2')
      editor.signals.toogledSelect.dispatch(original)
      editor.signals.pointCaptured.dispatch({ x: 5, y: 5 })
      await cancelActiveCommand('OFFSET', fixture, clock)

      expectNoInteractionLeaks(editor, baseline, harnesses)
      expect(editor.history.undos).toHaveLength(1)
      expect(editor.documentState.revision).toBe(1)

      const offset = editor.activeCollection.findOne('[id="1"]')
      expect(offset).not.toBeNull()
      expect(offset.array().map(([x, y]) => [x, y])).toEqual([[0, 2], [10, 2]])
      expect(offset.attr('name')).toBe('Source line')
      expect(offset.attr('data-nanquim-transient')).toBeUndefined()
      expect(offset.node.parentNode).toBe(editor.activeCollection.node)

      editor.history.undo()
      expect(offset.node.isConnected).toBe(false)
      expect(editor.documentState.revision).toBe(2)

      editor.history.redo()
      expect(offset.node.parentNode).toBe(editor.activeCollection.node)
      expect(offset.array().map(([x, y]) => [x, y])).toEqual([[0, 2], [10, 2]])
      expect(editor.documentState.revision).toBe(3)
    } finally {
      fixture.dispose()
      clock.dispose()
      listenerTracker.dispose()
    }
  })

  test('VIEWPORT keeps async capture outside one deterministic Paper Undo/Redo transaction', async () => {
    const listenerTracker = installDomListenerTracker()
    const clock = installClockHarness()
    const fixture = createDeterministicEditorFixture({ mode: 'paper' })
    const { editor, signalHarness } = fixture
    terminalMessages(editor)
    let viewportCounter = 0
    const viewports = []
    editor.paperViewports = viewports
    editor.paperEditor = {
      createViewport: vi.fn((x, y, w, h, scale, options = {}) => {
        const id = options.id || `vp-${++viewportCounter}`
        const viewport = {
          h,
          id,
          locked: options.locked === true,
          modelOriginX: options.modelOriginX ?? 0,
          modelOriginY: options.modelOriginY ?? 0,
          scale,
          visible: options.visible !== false,
          w,
          x,
          y,
        }
        viewports.push(viewport)
        return viewport
      }),
      removeViewport: vi.fn((id) => {
        const index = viewports.findIndex((viewport) => viewport.id === id)
        if (index < 0) return false
        viewports.splice(index, 1)
        return true
      }),
    }
    const harnesses = { clock, listenerTracker, signalHarness }
    const baseline = snapshotInteractionState(editor, harnesses)

    try {
      const completion = commands.VIEWPORT.execute(editor)
      await Promise.resolve()
      editor.inputCoord = { x: 2, y: 3 }
      editor.signals.coordinateInput.dispatch()
      await Promise.resolve()
      await Promise.resolve()
      editor.inputCoord = { x: 12, y: 8 }
      editor.signals.coordinateInput.dispatch()
      await Promise.resolve()
      await Promise.resolve()
      editor.signals.inputValue.dispatch('50')
      await completion
      await clock.runAll()

      expectNoInteractionLeaks(editor, baseline, harnesses)
      expect(editor.history.undos).toHaveLength(1)
      expect(editor.history.undos[0].type).toBe('CreateViewportCommand')
      expect(editor.documentState.revision).toBe(1)
      expect(viewports).toEqual([{
        h: 5,
        id: 'vp-1',
        locked: false,
        modelOriginX: 0,
        modelOriginY: 0,
        scale: 50,
        visible: true,
        w: 10,
        x: 2,
        y: 3,
      }])

      editor.history.undo()
      expect(viewports).toHaveLength(0)
      expect(editor.documentState.revision).toBe(2)

      editor.history.redo()
      expect(viewports).toEqual([expect.objectContaining({
        h: 5,
        id: 'vp-1',
        scale: 50,
        w: 10,
        x: 2,
        y: 3,
      })])
      expect(editor.documentState.revision).toBe(3)
      expect(editor.paperEditor.createViewport).toHaveBeenLastCalledWith(
        2,
        3,
        10,
        5,
        50,
        expect.objectContaining({ id: 'vp-1', silent: true }),
      )
    } finally {
      fixture.dispose()
      clock.dispose()
      listenerTracker.dispose()
    }
  })

  test.each(['opposite corner', 'scale'])(
    'VIEWPORT cancellation during %s removes helpers and never enters History',
    async (stage) => {
      const listenerTracker = installDomListenerTracker()
      const clock = installClockHarness()
      const fixture = createDeterministicEditorFixture({ mode: 'paper' })
      const { editor, signalHarness } = fixture
      terminalMessages(editor)
      const harnesses = { clock, listenerTracker, signalHarness }
      const baseline = snapshotInteractionState(editor, harnesses)

      try {
        const completion = commands.VIEWPORT.execute(editor)
        await Promise.resolve()
        editor.inputCoord = { x: 2, y: 3 }
        editor.signals.coordinateInput.dispatch()
        await Promise.resolve()
        await Promise.resolve()

        if (stage === 'scale') {
          editor.inputCoord = { x: 12, y: 8 }
          editor.signals.coordinateInput.dispatch()
          await Promise.resolve()
          await Promise.resolve()
        }

        editor.signals.commandCancelled.dispatch()
        await completion
        await clock.runAll()

        expectNoInteractionLeaks(editor, baseline, harnesses)
        expect(editor.paperEditor.createViewport).not.toHaveBeenCalled()
        expect(editor.history.undos).toHaveLength(0)
        expect(editor.documentState.isDirty).toBe(false)
        expect(editor.documentState.revision).toBe(0)
      } finally {
        fixture.dispose()
        clock.dispose()
        listenerTracker.dispose()
      }
    },
  )

  test('typed ELLIPSE completion has clean listeners and normalized Undo/Redo geometry', async () => {
    const listenerTracker = installDomListenerTracker()
    const clock = installClockHarness()
    const fixture = createDeterministicEditorFixture()
    const { editor, signalHarness } = fixture
    terminalMessages(editor)
    const harnesses = { clock, listenerTracker, signalHarness }
    const baseline = snapshotInteractionState(editor, harnesses)

    try {
      commands.ELLIPSE.execute(editor)
      editor.signals.pointCaptured.dispatch({ x: 10, y: 20 })
      editor.signals.inputValue.dispatch('5')
      await Promise.resolve()
      editor.signals.inputValue.dispatch('3')
      await clock.runAll()

      expectNoInteractionLeaks(editor, baseline, harnesses)
      expect(editor.history.undos).toHaveLength(1)
      expect(editor.history.redos).toHaveLength(0)
      expect(editor.documentState.isDirty).toBe(true)
      expect(editor.documentState.revision).toBe(1)

      const ellipse = editor.activeCollection.findOne('ellipse')
      expect(ellipse).not.toBeNull()
      expect(ellipse.attr()).toMatchObject({
        cx: 10,
        cy: 20,
        id: 1,
        name: 'Ellipse',
        rx: 5,
        ry: 3,
      })
      expect(ellipse.attr('data-nanquim-transient')).toBeUndefined()
      expect(ellipse.node.parentNode).toBe(editor.activeCollection.node)

      editor.history.undo()
      expect(ellipse.node.isConnected).toBe(false)
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.history.redos).toHaveLength(1)
      expect(editor.documentState.revision).toBe(2)

      editor.history.redo()
      expect(ellipse.node.parentNode).toBe(editor.activeCollection.node)
      expect(ellipse.attr()).toMatchObject({ cx: 10, cy: 20, rx: 5, ry: 3 })
      expect(editor.history.undos).toHaveLength(1)
      expect(editor.history.redos).toHaveLength(0)
      expect(editor.documentState.revision).toBe(3)
      expect(editor.spatialIndex.markDirty).toHaveBeenCalled()
      expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalled()
    } finally {
      fixture.dispose()
      clock.dispose()
      listenerTracker.dispose()
    }
  })

  test('typed TEXT completion clears delayed callbacks and supports Undo/Redo', async () => {
    const listenerTracker = installDomListenerTracker()
    const clock = installClockHarness()
    const fixture = createDeterministicEditorFixture()
    const { editor, signalHarness, terminal } = fixture
    terminalMessages(editor)
    const harnesses = { clock, listenerTracker, signalHarness }
    const baseline = snapshotInteractionState(editor, harnesses)
    const previousTerminalInput = globalThis.terminalInput
    globalThis.terminalInput = terminal.input

    try {
      commands.TEXT.execute(editor)
      editor.signals.pointCaptured.dispatch({ x: 4, y: 7 })
      editor.signals.inputValue.dispatch('Room A')
      await clock.runAll()

      expectNoInteractionLeaks(editor, baseline, harnesses)
      expect(editor.history.undos).toHaveLength(1)
      expect(editor.documentState.revision).toBe(1)
      const textElement = editor.activeCollection.findOne('text')
      expect(textElement.text()).toBe('Room A')
      expect(textElement.attr('data-nanquim-transient')).toBeUndefined()

      editor.history.undo()
      expect(textElement.node.isConnected).toBe(false)
      expect(editor.documentState.revision).toBe(2)
      editor.history.redo()
      expect(textElement.node.parentNode).toBe(editor.activeCollection.node)
      expect(textElement.text()).toBe('Room A')
      expect(editor.documentState.revision).toBe(3)
    } finally {
      if (previousTerminalInput === undefined) delete globalThis.terminalInput
      else globalThis.terminalInput = previousTerminalInput
      fixture.dispose()
      clock.dispose()
      listenerTracker.dispose()
    }
  })
})

describe('command history policy', () => {
  test('forbids direct undo/redo stack mutation in command modules', async () => {
    const commandsDirectory = projectPath('src', 'js', 'commands')
    const filenames = (await readdir(commandsDirectory))
      .filter((filename) => filename.endsWith('.js'))
      .sort()

    for (const filename of filenames) {
      const source = await readFile(join(commandsDirectory, filename), 'utf8')
      expect(source, filename).not.toMatch(/history\.(?:undos|redos)\s*\.(?:push|pop|shift|unshift|splice)\s*\(/)
      expect(source, filename).not.toMatch(/history\.(?:undos|redos)\s*=/)
      if (filename !== '_commands.js') {
        expect(source, filename).not.toMatch(/editor\.lastCommand\s*=/)
      }
    }
  })
})
