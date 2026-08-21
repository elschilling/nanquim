// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

import { History } from '../src/js/History.js'
import { PaperEditor } from '../src/js/PaperEditor.js'
import { PaperViewport } from '../src/js/PaperViewport.js'
import {
  CreateViewportCommand,
  createViewportCommand,
} from '../src/js/commands/CreateViewportCommand.js'
import { EditViewportCommand } from '../src/js/commands/EditViewportCommand.js'
import { DocumentState } from '../src/js/document/DocumentState.js'

class TestSignal {
  constructor() {
    this.listeners = []
    this.dispatch = vi.fn((...args) => {
      this.listeners.slice().forEach((listener) => listener(...args))
    })
  }

  add(listener) {
    this.listeners.push(listener)
  }

  addOnce(listener) {
    const once = (...args) => {
      this.remove(once)
      listener(...args)
    }
    this.add(once)
  }

  remove(listener) {
    this.listeners = this.listeners.filter(candidate => candidate !== listener)
  }
}

function createSignals() {
  return {
    colorMapUpdated: new TestSignal(),
    commandCancelled: new TestSignal(),
    coordinateInput: new TestSignal(),
    documentStateChanged: new TestSignal(),
    editorModeChanged: new TestSignal(),
    modelContentChanged: new TestSignal(),
    paperViewportsChanged: new TestSignal(),
    terminalLogged: new TestSignal(),
    updatedCollections: new TestSignal(),
    updatedOutliner: new TestSignal(),
    updatedProperties: new TestSignal(),
    updatedSelection: new TestSignal(),
  }
}

function createFixture() {
  document.body.innerHTML = '<div id="canvas"><div class="terminal"></div></div>'
  const canvas = document.getElementById('canvas')
  const svg = SVG().addTo(canvas)
  const drawing = svg.group().attr('id', 'Collection')
  const activeCollection = drawing.group().attr({
    id: 'collection-1',
    name: 'Model',
    'data-collection': 'true',
  })
  const handlers = svg.group().attr('id', 'Handlers')
  const signals = createSignals()
  const editor = {
    activeCollection,
    canvas,
    collections: new Map([['collection-1', {
      group: activeCollection,
      locked: false,
      style: { fill: 'transparent', stroke: 'white' },
      visible: true,
    }]]),
    drawing,
    fullSpatialIndex: { markDirty: vi.fn() },
    handlers,
    isDrawing: false,
    mode: 'paper',
    modelHandlers: handlers,
    paperConfig: {
      colorMap: {},
      height: 297,
      orientation: 'portrait',
      size: 'A4',
      unitsPerCm: 1,
      width: 210,
    },
    selected: [],
    signals,
    spatialIndex: { markDirty: vi.fn() },
    svg,
  }
  editor.documentState = new DocumentState(editor, { observe: false })
  editor.history = new History(editor)
  editor.execute = (command) => editor.history.execute(command)
  editor.paperEditor = new PaperEditor(editor)
  editor.paperEditor.ensureDocumentInfrastructure()
  return { editor, signals }
}

describe('CreateViewportCommand', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    registerWindow(window, document)
    globalThis.SVG = SVG
    window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 })
  })

  afterEach(() => {
    delete globalThis.SVG
    delete window.SVGElement.prototype.getBBox
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  test('recreates the same semantic viewport with live interactions across Undo/Redo', () => {
    const { editor, signals } = createFixture()
    const selectionBefore = [editor.activeCollection]
    editor.selected = [...selectionBefore]
    const command = new CreateViewportCommand(editor, {
      h: 5,
      scale: 50,
      w: 10,
      x: 2,
      y: 3,
    })

    editor.execute(command)

    const original = command.viewport
    expect(editor.paperViewports).toEqual([original])
    expect(original).toMatchObject({
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
    })
    expect(editor.documentState.revision).toBe(1)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledOnce()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledOnce()
    expect(editor.selected).toEqual(selectionBefore)

    original._frame.node.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
    }))
    expect(editor.selected[0]._paperVp).toBe(original)

    editor.history.undo()
    expect(editor.paperViewports).toHaveLength(0)
    expect(original._group.node.isConnected).toBe(false)
    expect(original._clipRect.node.isConnected).toBe(false)
    expect(editor.documentState.revision).toBe(2)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(2)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(2)
    expect(editor.selected).toEqual(selectionBefore)

    editor.history.redo()
    const restored = command.viewport
    expect(restored).not.toBe(original)
    expect(restored).toMatchObject(command.viewportState)
    expect(restored._group.node.isConnected).toBe(true)
    expect(restored._clipRect.node.isConnected).toBe(true)
    expect(editor.documentState.revision).toBe(3)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.selected).toEqual(selectionBefore)

    restored._frame.node.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
    }))
    expect(editor.selected[0]._paperVp).toBe(restored)
    expect(signals.paperViewportsChanged.dispatch).toHaveBeenCalledTimes(3)
  })

  test('viewport grip edits invalidate both indexes through execute, Undo, and Redo', () => {
    const { editor } = createFixture()
    const viewport = editor.paperEditor.createViewport(2, 3, 10, 5, 50, { silent: true })
    const oldValues = { x: 2, y: 3, width: 10, height: 5 }
    const newValues = { x: 7, y: 8, width: 14, height: 9 }
    const command = new EditViewportCommand(editor, viewport, oldValues, newValues)

    editor.execute(command)

    expect(viewport).toMatchObject({ x: 7, y: 8, w: 14, h: 9 })
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledOnce()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledOnce()

    editor.history.undo()
    expect(viewport).toMatchObject({ x: 2, y: 3, w: 10, h: 5 })
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(2)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(2)

    editor.history.redo()
    expect(viewport).toMatchObject({ x: 7, y: 8, w: 14, h: 9 })
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
  })

  test('reports interactive viewport dimensions in physical centimetres at non-default density', async () => {
    const { editor, signals } = createFixture()
    signals.inputValue = new TestSignal()
    editor.commandSessionRevision = 1
    editor.paperConfig.unitsPerCm = 2.5
    editor.inputCoord = { x: 2.5, y: 5 }

    const completion = createViewportCommand(editor)
    signals.coordinateInput.dispatch()
    await vi.waitFor(() => expect(signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      type: 'span',
      msg: 'VP: Specify opposite corner:',
    }))

    editor.inputCoord = { x: 27.5, y: 15 }
    signals.coordinateInput.dispatch()
    await vi.waitFor(() => expect(signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      type: 'span',
      msg: 'VP: Enter scale denominator (e.g. 100 for 1:100) [100]:',
    }))
    signals.inputValue.dispatch('100')
    await completion

    expect(editor.paperViewports).toHaveLength(1)
    expect(signals.terminalLogged.dispatch).toHaveBeenLastCalledWith({
      type: 'span',
      msg: 'VP: Created viewport vp-1 (10.00×4.00 cm) at 1:100',
    })
  })

  test('failed viewport construction removes every partial Paper node and preserves id allocation', () => {
    const { editor } = createFixture()
    const paperBefore = editor.paperSvg.node.outerHTML
    vi.spyOn(PaperViewport.prototype, 'refreshTransform').mockImplementationOnce(() => {
      throw new Error('injected viewport construction failure')
    })

    expect(() => editor.execute(new CreateViewportCommand(editor, {
      h: 5,
      scale: 50,
      w: 10,
      x: 2,
      y: 3,
    }))).toThrow('injected viewport construction failure')

    expect(editor.paperSvg.node.outerHTML).toBe(paperBefore)
    expect(editor.paperViewports).toEqual([])
    expect(editor.history.undos).toEqual([])
    expect(editor.documentState.revision).toBe(0)

    const next = new CreateViewportCommand(editor, {
      h: 5,
      scale: 50,
      w: 10,
      x: 2,
      y: 3,
    })
    editor.execute(next)
    expect(next.viewport.id).toBe('vp-1')
  })

  test('failed viewport removal restores the exact applied object and History state', () => {
    const { editor } = createFixture()
    const command = new CreateViewportCommand(editor, {
      h: 5,
      scale: 50,
      w: 10,
      x: 2,
      y: 3,
    })
    editor.execute(command)
    const viewport = command.viewport
    const paperBefore = editor.paperSvg.node.outerHTML
    const revisionBefore = editor.documentState.revision
    const removeClip = viewport._clipRect.remove.bind(viewport._clipRect)
    vi.spyOn(viewport._clipRect, 'remove').mockImplementationOnce(() => {
      removeClip()
      throw new Error('injected viewport removal failure')
    })

    expect(() => editor.history.undo()).toThrow('injected viewport removal failure')

    expect(editor.paperSvg.node.outerHTML).toBe(paperBefore)
    expect(editor.paperViewports).toEqual([viewport])
    expect(viewport._group.node.isConnected).toBe(true)
    expect(viewport._clipRect.node.isConnected).toBe(true)
    expect(editor.history.undos).toEqual([command])
    expect(editor.history.redos).toEqual([])
    expect(editor.documentState.revision).toBe(revisionBefore)

    editor.selected = []
    viewport._frame.node.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
    }))
    expect(editor.selected).toEqual([viewport._group])
  })

  test('failed viewport geometry refresh restores fields, DOM, indexes, and History', () => {
    const { editor } = createFixture()
    const viewport = editor.paperEditor.createViewport(2, 3, 10, 5, 50, {
      notify: false,
      silent: true,
    })
    editor.spatialIndex.markDirty.mockClear()
    editor.fullSpatialIndex.markDirty.mockClear()
    const paperBefore = editor.paperSvg.node.outerHTML
    const refresh = viewport.refreshGeometry.bind(viewport)
    vi.spyOn(viewport, 'refreshGeometry')
      .mockImplementationOnce(() => {
        viewport._frame.move(99, 99)
        throw new Error('injected viewport refresh failure')
      })
      .mockImplementation(refresh)
    const command = new EditViewportCommand(
      editor,
      viewport,
      { x: 2, y: 3, width: 10, height: 5 },
      { x: 7, y: 8, width: 14, height: 9 },
    )

    expect(() => editor.execute(command)).toThrow('injected viewport refresh failure')

    expect(viewport).toMatchObject({ x: 2, y: 3, w: 10, h: 5 })
    expect(editor.paperSvg.node.outerHTML).toBe(paperBefore)
    expect(editor.spatialIndex.markDirty).not.toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).not.toHaveBeenCalled()
    expect(editor.history.undos).toEqual([])
    expect(editor.documentState.revision).toBe(0)
  })

  test('late async viewport cleanup cannot clobber a successor command session', async () => {
    const { editor, signals } = createFixture()
    editor.commandSessionRevision = 7
    signals.updatedOutliner.dispatch.mockClear()

    const completion = createViewportCommand(editor)
    expect(editor.isInteracting).toBe(true)

    editor.commandSessionRevision = 8
    editor.isInteracting = true
    // The point-capture promise owns the listener registered on the original
    // signal. Dispatching it simulates the runner cancelling VP before the
    // successor establishes its own interaction state.
    signals.commandCancelled.dispatch()
    await completion

    expect(editor.commandSessionRevision).toBe(8)
    expect(editor.isInteracting).toBe(true)
    expect(signals.updatedOutliner.dispatch).not.toHaveBeenCalled()
    expect(editor.history.undos).toEqual([])
    expect(editor.documentState.revision).toBe(0)
  })

  test('a stale viewport continuation cannot resurrect helpers in a successor session', async () => {
    const { editor, signals } = createFixture()
    editor.commandSessionRevision = 11
    editor.inputCoord = { x: 2, y: 3 }
    const completion = createViewportCommand(editor)
    const drawingBefore = editor.paperSvg.node.outerHTML

    signals.coordinateInput.add(() => {
      editor.commandSessionRevision = 12
      editor.isInteracting = true
      editor.selectSingleElement = true
    })
    signals.coordinateInput.dispatch()
    await completion

    expect(editor.commandSessionRevision).toBe(12)
    expect(editor.isInteracting).toBe(true)
    expect(editor.selectSingleElement).toBe(true)
    expect(editor.paperSvg.node.outerHTML).toBe(drawingBefore)
    expect(editor.paperSvg.find('[data-nanquim-transient="true"]')).toHaveLength(0)
    expect(editor.paperViewports).toEqual([])
    expect(editor.history.undos).toEqual([])
    expect(editor.documentState.revision).toBe(0)
  })
})
