// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  DeterministicSignal,
  createClipboardData,
  createDeterministicEditorFixture,
  createMemoryFileHandle,
  createSignalHarness,
  expectNoInteractionLeaks,
  installClipboardHarness,
  installClockHarness,
  installDomListenerTracker,
  installFileApiHarness,
  snapshotInteractionState,
} from './support/deterministic-harness.js'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('deterministic signals', () => {
  test('matches command-facing add, addOnce, context, detach, and snapshot semantics', () => {
    const harness = createSignalHarness()
    const context = { calls: 0 }
    const persistent = vi.fn(function () { this.calls += 1 })
    const once = vi.fn()

    const binding = harness.signals.changed.add(persistent, context)
    harness.signals.changed.addOnce(once)

    expect(harness.snapshot()).toEqual({ changed: 2 })
    harness.signals.changed.dispatch('first')
    harness.signals.changed.dispatch('second')

    expect(persistent).toHaveBeenCalledTimes(2)
    expect(context.calls).toBe(2)
    expect(once).toHaveBeenCalledOnce()
    expect(binding.isBound()).toBe(true)
    expect(binding.detach()).toBe(persistent)
    expect(binding.isBound()).toBe(false)
    expect(harness.snapshot()).toEqual({})

    harness.dispose()
  })

  test('rejects non-functions and does not duplicate a listener/context pair', () => {
    const signal = new DeterministicSignal('fixture')
    const listener = vi.fn()
    const context = {}

    expect(() => signal.add(null)).toThrow('fixture.add requires a function')
    expect(signal.add(listener, context)).toBe(signal.add(listener, context))
    expect(signal.getNumListeners()).toBe(1)
  })
})

describe('deterministic Editor and SVG fixture', () => {
  test('provides real SVG groups, command state, terminal hooks, history, and draw-plugin shim', () => {
    const fixture = createDeterministicEditorFixture({ coordinates: { x: 4, y: 7 } })
    const { editor } = fixture

    expect(editor.svg.node.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(editor.activeCollection.parent()).toBe(editor.drawing)
    expect(editor.coordinates).toEqual({ x: 4, y: 7 })
    expect(fixture.terminal.input).toBe(document.getElementById('terminalInput'))
    expect(editor.svg.point(8, 9)).toEqual({ x: 8, y: 9 })

    const text = editor.activeCollection.text('Room').font({ size: 2 }).move(3, 5)
    expect(text.bbox()).toMatchObject({ height: 2, width: 4.8 })

    const preview = editor.activeCollection.line().draw({ startPoint: { x: 1, y: 2 } })
    expect(preview.remember('_paintHandler').startPoint).toEqual({ x: 1, y: 2 })
    preview.draw('cancel')
    expect(preview.node.isConnected).toBe(false)

    const command = { execute: vi.fn(), undo: vi.fn() }
    editor.execute(command)
    expect(command.execute).toHaveBeenCalledOnce()
    expect(editor.history.undos).toEqual([command])
    expect(editor.documentState.revision).toBe(1)
    expect(editor.documentState.markChanged).toHaveBeenCalledOnce()
    expect(editor.textStyleManager.getActiveStyle()).toMatchObject({
      id: 'Standard',
      properties: { fontFamily: 'Inter' },
    })
    expect(editor.cmdParams).toEqual({ filletRadius: 0 })

    fixture.dispose()
    expect(fixture.host.isConnected).toBe(false)
  })

  test('detects signal, helper, listener, timer, and interaction-state leaks', () => {
    const fixture = createDeterministicEditorFixture()
    const listeners = installDomListenerTracker()
    const clock = installClockHarness()
    const harnesses = { clock, listenerTracker: listeners, signalHarness: fixture.signalHarness }
    const baseline = snapshotInteractionState(fixture.editor, harnesses)

    const keydown = vi.fn()
    document.addEventListener('keydown', keydown)
    fixture.editor.signals.pointCaptured.add(keydown)
    fixture.editor.overlays.circle(4)
    fixture.editor.isInteracting = true
    setTimeout(() => {}, 50)

    expect(() => expectNoInteractionLeaks(fixture.editor, baseline, harnesses)).toThrow()

    document.removeEventListener('keydown', keydown)
    fixture.editor.signals.pointCaptured.remove(keydown)
    fixture.editor.overlays.clear()
    fixture.editor.isInteracting = false
    vi.clearAllTimers()
    expectNoInteractionLeaks(fixture.editor, baseline, harnesses)

    clock.dispose()
    listeners.dispose()
    fixture.dispose()
  })

  test('can include the persistent element allocator in cancellation baselines', () => {
    const fixture = createDeterministicEditorFixture()
    const options = { includeElementIndex: true }
    const baseline = snapshotInteractionState(fixture.editor, options)

    fixture.editor.elementIndex += 1

    expect(() => expectNoInteractionLeaks(fixture.editor, baseline, options)).toThrow()
    fixture.dispose()
  })
})

describe('browser API fixtures', () => {
  test('tracks listener identity, capture, one-shot, and abort cleanup', () => {
    const tracker = installDomListenerTracker()
    const baseline = tracker.snapshot()
    const listener = vi.fn()
    const controller = new window.AbortController()

    document.addEventListener('click', listener, true)
    document.addEventListener('click', listener, true)
    expect(tracker.size).toBe(1)
    document.removeEventListener('click', listener, true)
    tracker.expectStable(baseline)

    document.addEventListener('focus', listener, { once: true })
    document.dispatchEvent(new Event('focus'))
    tracker.expectStable(baseline)

    const detachedButton = document.createElement('button')
    document.body.appendChild(detachedButton)
    detachedButton.addEventListener('click', listener)
    detachedButton.remove()
    tracker.expectStable(baseline)

    document.addEventListener('input', listener, { signal: controller.signal })
    expect(tracker.size).toBe(1)
    controller.abort()
    tracker.expectStable(baseline)

    tracker.dispose()
  })

  test('advances timers and animation frames without wall-clock waits', async () => {
    const clock = installClockHarness({ frameDuration: 20, now: 100 })
    const frame = vi.fn()

    requestAnimationFrame(frame)
    expect(clock.pendingCount).toBe(1)
    await clock.advanceFrame()
    expect(frame).toHaveBeenCalledOnce()
    expect(frame.mock.calls[0][0]).toBe(20)
    clock.expectNoPendingTimers()

    clock.dispose()
  })

  test('provides mutable Clipboard API and event clipboard data', async () => {
    const installed = installClipboardHarness({ text: 'before' })
    const eventData = createClipboardData({ 'text/plain': 'line' })

    expect(await navigator.clipboard.readText()).toBe('before')
    await navigator.clipboard.writeText('after')
    expect(installed.text).toBe('after')
    expect(eventData.getData('text/plain')).toBe('line')
    eventData.setData('application/x-nanquim', '{"safe":true}')
    expect(eventData.types).toContain('application/x-nanquim')

    installed.dispose()
    expect(navigator.clipboard).toBeUndefined()
  })

  test('commits memory-file writes only after close and wires both file pickers', async () => {
    const memory = createMemoryFileHandle({ contents: 'old', name: 'test.svg' })
    const saveMemory = createMemoryFileHandle({ name: 'saved.svg' })
    const fileApis = installFileApiHarness({
      openHandles: [memory.handle],
      saveHandle: saveMemory.handle,
    })

    expect(await window.showOpenFilePicker()).toEqual([memory.handle])
    expect(await window.showSaveFilePicker()).toBe(saveMemory.handle)

    const writable = await memory.handle.createWritable()
    await writable.write(new Blob(['new'], { type: 'image/svg+xml' }))
    expect(memory.contents).toBe('old')
    await writable.close()
    expect(memory.contents).toBe('new')
    expect(await (await memory.handle.getFile()).text()).toBe('new')

    fileApis.dispose()
    expect(window.showOpenFilePicker).toBeUndefined()
    expect(window.showSaveFilePicker).toBeUndefined()
  })

  test('models denied writes and close failures without committing a draft', async () => {
    const denied = createMemoryFileHandle({ writable: false })
    await expect(denied.handle.createWritable()).rejects.toMatchObject({ name: 'NotAllowedError' })

    const failing = createMemoryFileHandle({ contents: 'safe' })
    failing.failClose()
    const writable = await failing.handle.createWritable()
    await writable.write('unsafe draft')
    await expect(writable.close()).rejects.toMatchObject({ name: 'InvalidStateError' })
    expect(failing.contents).toBe('safe')
  })
})
