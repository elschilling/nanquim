// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { Terminal } from '../src/js/Terminal.js'
import { MAX_SVG_GEOMETRY_MAGNITUDE } from '../src/js/utils/svgNumericBounds.js'
import commands, {
  cancelCommandSession,
  executeRegisteredCommand,
  resolveRegisteredCommand,
} from '../src/js/commands/_commands.js'
import {
  createDeterministicEditorFixture,
  installDomListenerTracker,
} from './support/deterministic-harness.js'

let fixture
let listenerTracker

function setup(mode, { terminal = false } = {}) {
  fixture = createDeterministicEditorFixture({ mode, coordinates: { x: 10, y: 20 } })
  const { editor } = fixture
  editor.svg.zoom = vi.fn(() => 8)
  editor.paperSvg.zoom = vi.fn(() => 2)
  editor.svg.point = vi.fn(() => ({ x: 300, y: 400 }))
  editor.paperSvg.point = vi.fn(() => ({ x: 3, y: 4 }))
  const activeSvg = mode === 'paper' ? editor.paperSvg : editor.svg
  const inactiveSvg = mode === 'paper' ? editor.svg : editor.paperSvg
  // Initialize selector bookkeeping before tracking command-owned listeners.
  activeSvg.find('.measure-overlay')
  listenerTracker = installDomListenerTracker()
  if (terminal) new Terminal(editor)
  const baseline = {
    model: editor.drawing.svg(),
    paper: editor.paperDrawing.svg(),
    listeners: listenerTracker.snapshot(),
    signals: fixture.signalHarness.snapshot(),
  }
  return { editor, activeSvg, inactiveSvg, baseline }
}

function messages(editor) {
  return editor.signals.terminalLogged.dispatch.mock.calls.map(([entry]) => entry)
}

function typedCoordinate(editor, coordinate, mode = 'absolute') {
  editor.inputCoord = coordinate
  editor.inputCoordMode = mode
  editor.signals.coordinateInput.dispatch()
}

function expectDocumentUnchanged(editor, baseline) {
  expect(editor.drawing.svg()).toBe(baseline.model)
  expect(editor.paperDrawing.svg()).toBe(baseline.paper)
  expect(editor.history.undos).toHaveLength(0)
  expect(editor.history.redos).toHaveLength(0)
  expect(editor.documentState.isDirty).toBe(false)
  expect(editor.documentState.revision).toBe(0)
  expect(editor.documentState.markChanged).not.toHaveBeenCalled()
  expect(editor.signals.modelContentChanged.dispatch).not.toHaveBeenCalled()
  expect(editor.signals.paperViewportsChanged.dispatch).not.toHaveBeenCalled()
}

function expectClean(editor, baseline) {
  expect(editor.svg.findOne('.measure-ghost-group, .measure-overlay')).toBeNull()
  expect(editor.paperSvg.findOne('.measure-ghost-group, .measure-overlay')).toBeNull()
  expect(editor.isDrawing).toBe(false)
  expect(editor.isInteracting).toBe(false)
  expect(editor.selectSingleElement).toBe(false)
  expect(editor.inputCoord).toBeNull()
  expect(editor.inputCoordMode).toBeNull()
  expect(editor.snapPoint).toBeNull()
  for (const svg of [editor.svg, editor.paperSvg]) {
    expect(svg.findOne('#Snap')?.children().length || 0).toBe(0)
    expect(svg.findOne('#ExtensionLines')?.children().length || 0).toBe(0)
  }
  expect(fixture.signalHarness.snapshot()).toEqual(baseline.signals)
  listenerTracker.expectStable(baseline.listeners)
  expectDocumentUnchanged(editor, baseline)
}

function completeByPointer(editor) {
  editor.signals.pointCaptured.dispatch({ x: 10, y: 20 })
  editor.signals.pointCaptured.dispatch({ x: 13, y: 24 })
}

function move(svg, x, y) {
  svg.node.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }))
}

function seedSnapFeedback(svg, { extensions = true } = {}) {
  const snap = svg.findOne('#Snap') || svg.group().id('Snap')
  snap.circle(2).center(100, 100)
  if (extensions) {
    const group = svg.findOne('#ExtensionLines') || svg.group().id('ExtensionLines')
    group.line(0, 0, 100, 100)
  }
  return snap
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  fixture?.editor.signals.commandCancelled.dispatch()
  fixture?.dispose()
  listenerTracker?.dispose()
  vi.restoreAllMocks()
  fixture = null
  listenerTracker = null
  document.body.replaceChildren()
})

describe.each(['model', 'paper'])('DIST in %s Space', (mode) => {
  test('discards a shared snap from the previous space before measuring in the active SVG', () => {
    const { editor, activeSvg, baseline } = setup(mode)
    editor.snapPoint = { x: 999, y: 999 }
    seedSnapFeedback(activeSvg)
    commands.DIST.execute(editor)
    expect(editor.snapPoint).toBeNull()
    editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
    move(activeSvg, 11, 12)

    const expectedPoint = mode === 'paper' ? [3, 4] : [300, 400]
    expect(activeSvg.findOne('.measure-ghost').array()).toEqual([[0, 0], expectedPoint])
    cancelCommandSession(editor)
    expectClean(editor, baseline)
  })

  test('refreshes snap feedback only on the active SVG when the interaction starts', () => {
    const { editor, activeSvg, inactiveSvg, baseline } = setup(mode)
    const refresh = vi.fn(() => {
      expect(editor.snapPoint).toBeNull()
      editor.snapPoint = { x: 6, y: 8 }
    })
    const inactiveRefresh = vi.fn()
    activeSvg.on('snapChange', refresh)
    inactiveSvg.on('snapChange', inactiveRefresh)
    editor.snapPoint = { x: 999, y: 999 }

    commands.DIST.execute(editor)
    expect(refresh).toHaveBeenCalledOnce()
    expect(inactiveRefresh).not.toHaveBeenCalled()
    editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
    move(activeSvg, 11, 12)
    expect(activeSvg.findOne('.measure-ghost').array()).toEqual([[0, 0], [6, 8]])
    expect(activeSvg.point).not.toHaveBeenCalled()

    activeSvg.off('snapChange', refresh)
    inactiveSvg.off('snapChange', inactiveRefresh)
    cancelCommandSession(editor)
    expectClean(editor, baseline)
  })

  test('places transient feedback in the active SVG and uses its point conversion and zoom', () => {
    const { editor, activeSvg, inactiveSvg, baseline } = setup(mode)
    editor.overlays.hide()
    commands.DIST.execute(editor)
    editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })

    const ghost = activeSvg.findOne('.measure-ghost-group')
    expect(ghost).not.toBeNull()
    expect(ghost.node.parentNode).toBe(activeSvg.node)
    expect(ghost.attr('data-nanquim-transient')).toBe('true')
    expect(ghost.attr('pointer-events')).toBe('none')
    expect(ghost.attr('aria-hidden')).toBe('true')
    expect(inactiveSvg.findOne('.measure-ghost-group')).toBeNull()

    move(inactiveSvg, 11, 12)
    expect(inactiveSvg.point).not.toHaveBeenCalled()
    move(activeSvg, 11, 12)
    const expectedPoint = mode === 'paper' ? [3, 4] : [300, 400]
    const expectedDistance = mode === 'paper' ? '5.0000' : '500.0000'
    expect(ghost.findOne('.measure-ghost').array()).toEqual([[0, 0], expectedPoint])
    expect(ghost.findOne('.measure-text').text()).toBe(expectedDistance)
    expect(Number(ghost.findOne('.measure-text').attr('font-size')))
      .toBe(14 / (mode === 'paper' ? 2 : 8))
    expect(activeSvg.point).toHaveBeenCalledWith(11, 12)
    expect(inactiveSvg.zoom).not.toHaveBeenCalled()

    editor.snapPoint = { x: 6, y: 8 }
    activeSvg.point.mockClear()
    move(activeSvg, 100, 200)
    expect(ghost.findOne('.measure-ghost').array()).toEqual([[0, 0], [6, 8]])
    expect(ghost.findOne('.measure-text').text()).toBe('10.0000')
    expect(activeSvg.point).not.toHaveBeenCalled()
    editor.snapPoint = { x: MAX_SVG_GEOMETRY_MAGNITUDE + 1, y: 8 }
    move(activeSvg, 100, 200)
    expect(ghost.findOne('.measure-ghost').array()).toEqual([[0, 0], [6, 8]])
    expect(ghost.findOne('.measure-text').text()).toBe('10.0000')
    expectDocumentUnchanged(editor, baseline)

    cancelCommandSession(editor)
    expectClean(editor, baseline)
  })

  test('reports pointer distance and deltas while retaining a transient completed annotation', () => {
    const { editor, activeSvg, inactiveSvg, baseline } = setup(mode)
    commands.DIST.execute(editor)
    editor.snapPoint = { x: 10, y: 20 }
    seedSnapFeedback(activeSvg)
    completeByPointer(editor)

    expect(messages(editor).map((entry) => entry.msg)).toContain('Distance = 5.0000')
    expect(messages(editor).map((entry) => entry.msg)).toContain('Delta X = 3.0000, Delta Y = 4.0000')
    const result = activeSvg.findOne('.measure-overlay')
    expect(result).not.toBeNull()
    expect(result.node.parentNode).toBe(activeSvg.node)
    expect(result.attr('data-nanquim-transient')).toBe('true')
    expect(result.attr('pointer-events')).toBe('none')
    expect(result.find('.measure-line')).toHaveLength(5)
    expect(result.findOne('.measure-text').text()).toBe('5.0000')
    expect(Number(result.findOne('.measure-text').attr('font-size')))
      .toBe(14 / (mode === 'paper' ? 2 : 8))
    expect(inactiveSvg.findOne('.measure-overlay')).toBeNull()
    expect(activeSvg.findOne('.measure-ghost-group')).toBeNull()
    expect(editor.isInteracting).toBe(false)
    expect(editor.selectSingleElement).toBe(false)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expect(editor.signals.coordinateInput.getNumListeners()).toBe(0)
    expect(editor.snapPoint).toBeNull()
    expect(activeSvg.findOne('#Snap').children()).toHaveLength(0)
    expect(activeSvg.findOne('#ExtensionLines').children()).toHaveLength(0)
    listenerTracker.expectStable(baseline.listeners)
    expectDocumentUnchanged(editor, baseline)

    cancelCommandSession(editor)
    expectClean(editor, baseline)
  })

  test.each([
    { inputMode: 'relative', first: { x: 2, y: 3 }, second: { x: 3, y: 4 }, start: [12, 23], end: [15, 27], distance: '5.0000' },
    { inputMode: 'absolute', first: { x: 2, y: 3 }, second: { x: 5, y: 7 }, start: [2, 3], end: [5, 7], distance: '5.0000' },
  ])('accepts $inputMode typed coordinates and records both prompts', ({ inputMode, first, second, start, end, distance }) => {
    const { editor, activeSvg, baseline } = setup(mode)
    commands.DIST.execute(editor)
    typedCoordinate(editor, first, inputMode)
    typedCoordinate(editor, second, inputMode)

    const result = activeSvg.findOne('.measure-overlay')
    expect(result).not.toBeNull()
    expect(result.findOne('.measure-line').array()).toEqual([start, end])
    expect(result.findOne('.measure-text').text()).toBe(distance)
    const prompts = messages(editor).filter((entry) => /^Specify (first|second) point:/.test(entry.msg))
    expect(prompts).toHaveLength(2)
    expect(prompts.every((entry) => entry.recordInput === true)).toBe(true)
    expect(editor.inputCoord).toBeNull()
    expect(editor.inputCoordMode).toBeNull()

    cancelCommandSession(editor)
    expectClean(editor, baseline)
  })

  test('accepts #absolute and @relative terminal input, records it, and clears the result on Escape', () => {
    const { editor, activeSvg, baseline } = setup(mode, { terminal: true })
    const submit = (value) => {
      fixture.terminal.input.value = value
      fixture.terminal.input.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
      }))
    }
    fixture.terminal.input.focus()
    submit('dist')
    submit('#2,3')
    submit('@3,4')

    const result = activeSvg.findOne('.measure-overlay')
    expect(result).not.toBeNull()
    expect(result.findOne('.measure-line').array()).toEqual([[2, 3], [5, 7]])
    expect(result.findOne('.measure-text').text()).toBe('5.0000')
    expect(fixture.terminal.log.textContent).toContain('Specify first point: #2,3')
    expect(fixture.terminal.log.textContent).toContain('Specify second point: @3,4')
    expect(fixture.terminal.input.value).toBe('')
    expectDocumentUnchanged(editor, baseline)

    fixture.terminal.input.dispatchEvent(new KeyboardEvent('keyup', {
      bubbles: true,
      key: 'Escape',
      code: 'Escape',
    }))
    expectClean(editor, baseline)
  })

  test.each(['first', 'second'])('rejects invalid %s points without losing the point prompt', (stage) => {
    const { editor, activeSvg, baseline } = setup(mode)
    commands.DIST.execute(editor)
    if (stage === 'second') editor.signals.pointCaptured.dispatch({ x: 10, y: 20 })

    expect(() => typedCoordinate(editor, null)).not.toThrow()
    expect(() => editor.signals.pointCaptured.dispatch({ x: NaN, y: 2 })).not.toThrow()
    expect(() => typedCoordinate(editor, { x: 2, y: Infinity })).not.toThrow()
    expect(() => editor.signals.pointCaptured.dispatch({ x: MAX_SVG_GEOMETRY_MAGNITUDE + 1, y: 2 })).not.toThrow()
    expect(() => typedCoordinate(editor, { x: 2, y: -MAX_SVG_GEOMETRY_MAGNITUDE - 1 })).not.toThrow()
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(1)
    expect(editor.signals.coordinateInput.getNumListeners()).toBe(1)
    expect(editor.isInteracting).toBe(true)
    expect(activeSvg.findOne('.measure-overlay')).toBeNull()
    expectDocumentUnchanged(editor, baseline)

    if (stage === 'first') editor.signals.pointCaptured.dispatch({ x: 10, y: 20 })
    typedCoordinate(editor, { x: 13, y: 24 })
    expect(activeSvg.findOne('.measure-overlay .measure-text').text()).toBe('5.0000')
    cancelCommandSession(editor)
    expectClean(editor, baseline)
  })

  test('accepts a point at the geometry bound and retries a relative coordinate that would exceed it', () => {
    const { editor, activeSvg, baseline } = setup(mode)
    commands.DIST.execute(editor)
    typedCoordinate(editor, { x: MAX_SVG_GEOMETRY_MAGNITUDE, y: 0 })

    typedCoordinate(editor, { x: 1, y: 0 }, 'relative')
    expect(activeSvg.findOne('.measure-overlay')).toBeNull()
    expect(editor.isInteracting).toBe(true)
    expect(editor.signals.coordinateInput.getNumListeners()).toBe(1)
    typedCoordinate(editor, { x: -1, y: 0 }, 'relative')
    expect(activeSvg.findOne('.measure-overlay .measure-line').array())
      .toEqual([[MAX_SVG_GEOMETRY_MAGNITUDE, 0], [MAX_SVG_GEOMETRY_MAGNITUDE - 1, 0]])
    expect(activeSvg.findOne('.measure-overlay .measure-text').text()).toBe('1.0000')
    expect(editor.inputCoord).toBeNull()
    expect(editor.inputCoordMode).toBeNull()
    cancelCommandSession(editor)
    expectClean(editor, baseline)
  })

  test('retains the captured first point when the shared snap point changes', () => {
    const { editor, activeSvg, baseline } = setup(mode)
    commands.DIST.execute(editor)
    editor.snapPoint = { x: 10, y: 20 }
    editor.signals.pointCaptured.dispatch(editor.snapPoint)

    Object.assign(editor.snapPoint, { x: 13, y: 24 })
    move(activeSvg, 100, 200)
    const ghost = activeSvg.findOne('.measure-ghost-group')
    expect(ghost.findOne('.measure-ghost').array()).toEqual([[10, 20], [13, 24]])
    expect(ghost.findOne('.measure-text').text()).toBe('5.0000')

    typedCoordinate(editor, { x: 3, y: 4 }, 'relative')
    expect(activeSvg.findOne('.measure-overlay .measure-line').array()).toEqual([[10, 20], [13, 24]])
    expect(activeSvg.findOne('.measure-overlay .measure-text').text()).toBe('5.0000')
    cancelCommandSession(editor)
    expectClean(editor, baseline)
  })

  test.each(['before first point', 'after first point', 'after completion'])('Escape cancels %s without changing the document', (stage) => {
    const { editor, baseline } = setup(mode)
    commands.DIST.execute(editor)
    if (stage === 'before first point') typedCoordinate(editor, null, 'relative')
    else typedCoordinate(editor, { x: 10, y: 20 })
    if (stage === 'after completion') typedCoordinate(editor, { x: 3, y: 4 }, 'relative')

    cancelCommandSession(editor, new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))
    expectClean(editor, baseline)
  })

  test.each(['before first point', 'after first point', 'after completion'])('switching spaces clears feedback and listeners %s', (stage) => {
    const { editor, activeSvg, inactiveSvg, baseline } = setup(mode)
    commands.DIST.execute(editor)
    if (stage === 'before first point') typedCoordinate(editor, null, 'relative')
    else typedCoordinate(editor, { x: 10, y: 20 })
    if (stage === 'after completion') typedCoordinate(editor, { x: 3, y: 4 }, 'relative')

    seedSnapFeedback(activeSvg)
    editor.snap = seedSnapFeedback(inactiveSvg, { extensions: false })
    // PaperEditor updates the active snap group before announcing the mode.
    editor.snapPoint = { x: 999, y: 999 }
    editor.mode = mode === 'paper' ? 'model' : 'paper'
    editor.signals.editorModeChanged.dispatch(editor.mode)
    expectClean(editor, baseline)
  })

  test('canonical entry, aliases, and repeat run the same interaction and clear the previous result', () => {
    const { editor, activeSvg, baseline } = setup(mode)
    expect(commands.DIST.modes).toContain(mode)
    for (const entry of ['DIST', 'dist', 'd']) {
      expect(resolveRegisteredCommand(entry).name).toBe('DIST')
      expect(executeRegisteredCommand(editor, entry)).toBe(true)
      expect(editor.isInteracting).toBe(true)
      expect(activeSvg.findOne('.measure-overlay')).toBeNull()
      completeByPointer(editor)
      expect(activeSvg.findOne('.measure-overlay .measure-text').text()).toBe('5.0000')
    }

    expect(editor.lastCommand.commandName).toBe('DIST')
    expect(editor.lastCommand.execute()).toBe(true)
    expect(activeSvg.findOne('.measure-overlay')).toBeNull()
    completeByPointer(editor)
    expect(activeSvg.findOne('.measure-overlay .measure-text').text()).toBe('5.0000')
    cancelCommandSession(editor)
    expectClean(editor, baseline)
  })
})
