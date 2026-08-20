// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { SVG, registerWindow } from '@svgdotjs/svg.js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { Editor } from '../src/js/Editor.js'
import { PaperEditor } from '../src/js/PaperEditor.js'
import { Viewport } from '../src/js/Viewport.js'
import { GeometryNodeManager } from '../src/js/geometry-nodes/GeometryNodeManager.js'
import { DOCUMENT_SCHEMA_VERSION } from '../src/js/document/DocumentSerializer.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

class TestSignal {
  constructor() {
    this.bindings = []
    this.dispatch = vi.fn((...args) => {
      this.bindings.slice().forEach((binding) => {
        if (binding.once) this.remove(binding.listener, binding.context)
        binding.listener.apply(binding.context, args)
      })
    })
  }

  add(listener, context) {
    this.bindings.push({ listener, context, once: false })
  }

  addOnce(listener, context) {
    this.bindings.push({ listener, context, once: true })
  }

  remove(listener, context) {
    this.bindings = this.bindings.filter(
      (binding) => binding.listener !== listener || binding.context !== context,
    )
  }
}

const activeEditors = []

function nativeDocument({
  version = DOCUMENT_SCHEMA_VERSION,
  attributes = '',
  content = '<g id="collection-new" name="New" data-collection="true"><line id="10" x1="1" y1="2" x2="3" y2="4"/></g>',
} = {}) {
  return `<svg xmlns="${SVG_NS}" data-nanquim-version="${version}" ${attributes}>${content}</svg>`
}

async function fixture(name) {
  return readFile(join(process.cwd(), 'tests', 'fixtures', name), 'utf8')
}

function createEditor() {
  document.body.innerHTML = '<div id="canvas"><div class="terminal"></div></div>'
  const editor = new Editor()
  editor.geometryNodes = new GeometryNodeManager(editor)
  editor.paperEditor = new PaperEditor(editor)
  editor.spatialIndex = { markDirty: vi.fn(), rebuild: vi.fn() }
  editor.fullSpatialIndex = { markDirty: vi.fn(), rebuild: vi.fn() }
  activeEditors.push(editor)
  return editor
}

function seedOldSession(editor) {
  const oldHandle = { name: 'old.svg' }
  const oldCollection = editor.activeCollection
  const oldNode = oldCollection.line(0, 0, 20, 20).attr({ id: 'old-line', name: 'Old line' })
  const oldDocumentDefinition = document.createElementNS(SVG_NS, 'pattern')
  oldDocumentDefinition.id = 'old-session-pattern'
  oldDocumentDefinition.setAttribute('data-nanquim-document-def', 'true')
  editor.svg.defs().node.appendChild(oldDocumentDefinition)
  const oldUndo = { undo: vi.fn(), execute: vi.fn() }
  const oldRedo = { undo: vi.fn(), execute: vi.fn() }
  editor.history.undos.push(oldUndo)
  editor.history.redos.push(oldRedo)
  editor.history.idCounter = 12
  editor.selected = [oldNode]
  editor.previousSelection = [oldNode]
  const transientOverlay = editor.overlays.group().attr('data-test-transient', 'overlay')
  const transientSnap = editor.snap.circle(1).attr('data-test-transient', 'snap')
  const transientHandler = editor.handlers.rect(1, 1).attr('data-test-transient', 'handler')
  editor.isDrawing = true
  editor.isInteracting = true
  editor.isSelecting = true
  editor.selectSingleElement = true
  editor.isEditingVertex = true
  editor.editingVertices = [{ element: oldNode, vertexIndex: 0 }]
  editor.isTypingText = true
  editor.inputCoord = { x: 5, y: 6 }
  editor.inputCoordMode = 'relative'
  editor.length = 8
  editor.distance = 9
  editor.offsetDX = 1
  editor.offsetDY = 2
  editor.snapPoint = { x: 3, y: 4 }
  editor.extensionHovers = [{ point: { x: 0, y: 0 } }]
  editor.lastCommand = { execute: vi.fn() }
  editor.lastClick = { x: 7, y: 8 }
  editor.activeEditor = 'geometry-nodes'
  editor.documentState.replaceSession({ name: 'old.svg', handle: oldHandle, dirty: true })
  return {
    oldCollection,
    oldDocumentDefinition,
    oldHandle,
    oldNode,
    oldRedo,
    oldUndo,
    collections: editor.collections,
    drawingChildren: Array.from(editor.drawing.node.children),
    historyUndos: editor.history.undos,
    historyRedos: editor.history.redos,
    previousSelection: editor.previousSelection,
    paperConfig: editor.paperConfig,
    selected: editor.selected,
    spatialIndex: editor.spatialIndex,
    fullSpatialIndex: editor.fullSpatialIndex,
    transientHandler,
    transientOverlay,
    transientSnap,
  }
}

function expectPreservedFailure(editor, seeded, result) {
  expect(result.ok).toBe(false)
  expect(Array.from(editor.drawing.node.children)).toEqual(seeded.drawingChildren)
  expect(editor.drawing.node.querySelector('#old-line')).toBe(seeded.oldNode.node)
  expect(seeded.oldNode.node.isConnected).toBe(true)
  expect(editor.svg.node.querySelector('#old-session-pattern')).toBe(seeded.oldDocumentDefinition)
  expect(seeded.oldDocumentDefinition.isConnected).toBe(true)
  expect(editor.activeCollection).toBe(seeded.oldCollection)
  expect(editor.history.undos).toBe(seeded.historyUndos)
  expect(editor.history.redos).toBe(seeded.historyRedos)
  expect(editor.history.undos).toEqual([seeded.oldUndo])
  expect(editor.history.redos).toEqual([seeded.oldRedo])
  expect(editor.history.idCounter).toBe(12)
  expect(editor.documentState.isDirty).toBe(true)
  expect(editor.currentFileName).toBe('old.svg')
  expect(editor.currentFileHandle).toBe(seeded.oldHandle)
  expect(editor.collections).toBe(seeded.collections)
  expect(editor.selected).toBe(seeded.selected)
  expect(editor.previousSelection).toBe(seeded.previousSelection)
  expect(editor.spatialIndex).toBe(seeded.spatialIndex)
  expect(editor.fullSpatialIndex).toBe(seeded.fullSpatialIndex)
  expect(editor.paperConfig).toBe(seeded.paperConfig)
  expect(seeded.transientOverlay.node.isConnected).toBe(true)
  expect(seeded.transientSnap.node.isConnected).toBe(true)
  expect(seeded.transientHandler.node.isConnected).toBe(true)
  expect(editor).toMatchObject({
    isDrawing: true,
    isInteracting: true,
    isSelecting: true,
    selectSingleElement: true,
    isEditingVertex: true,
    editingVertices: [{ element: seeded.oldNode, vertexIndex: 0 }],
    isTypingText: true,
    inputCoord: { x: 5, y: 6 },
    inputCoordMode: 'relative',
    length: 8,
    distance: 9,
    offsetDX: 1,
    offsetDY: 2,
    snapPoint: { x: 3, y: 4 },
    extensionHovers: [{ point: { x: 0, y: 0 } }],
    activeEditor: 'geometry-nodes',
    mode: 'model',
  })
}

describe('transactional document lifecycle', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    registerWindow(window, document)
    globalThis.SVG = SVG
    globalThis.signals = { Signal: TestSignal }
    window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    activeEditors.splice(0).forEach((editor) => editor.documentState.disconnect())
    vi.restoreAllMocks()
    delete globalThis.SVG
    delete globalThis.signals
    delete window.SVGElement.prototype.getBBox
    document.body.replaceChildren()
  })

  test('commits a current native document and resets cross-document session state', async () => {
    const editor = createEditor()
    const seeded = seedOldSession(editor)
    const nextHandle = { name: 'current.svg' }
    vi.spyOn(editor.history, 'clear').mockImplementation(() => {
      throw new Error('History.clear must not run inside Open')
    })
    editor.spatialIndex.rebuild.mockImplementation(() => {
      throw new Error('selectable index rebuild must remain lazy')
    })
    editor.fullSpatialIndex.rebuild.mockImplementation(() => {
      throw new Error('full index rebuild must remain lazy')
    })

    const result = await editor.loader.loadSource(nativeDocument({
      attributes: 'viewBox="-10 -20 120 80" data-element-index="25"',
    }), { name: 'current.svg', handle: nextHandle })

    expect(result).toMatchObject({ ok: true, kind: 'native', dirty: false, diagnostics: [] })
    expect(editor.drawing.node.querySelector('#old-line')).toBeNull()
    expect(seeded.oldNode.node.isConnected).toBe(false)
    expect(editor.drawing.node.querySelector('[id="10"]')).not.toBeNull()
    expect(editor.history.undos).toEqual([])
    expect(editor.history.redos).toEqual([])
    expect(editor.history.idCounter).toBe(0)
    expect(editor.history.clear).not.toHaveBeenCalled()
    expect(editor.selected).toEqual([])
    expect(editor.previousSelection).toEqual([])
    expect(editor.overlays.children().length).toBe(0)
    expect(editor.snap.children().length).toBe(0)
    expect(editor.handlers.children().length).toBe(0)
    expect(editor).toMatchObject({
      isDrawing: false,
      isInteracting: false,
      isSelecting: false,
      selectSingleElement: false,
      isEditingVertex: false,
      editingVertices: [],
      isTypingText: false,
      inputCoord: null,
      inputCoordMode: null,
      length: null,
      distance: null,
      offsetDX: null,
      offsetDY: null,
      snapPoint: null,
      extensionHovers: [],
      lastCommand: null,
      lastClick: null,
      activeEditor: 'canvas',
      mode: 'model',
    })
    expect(editor.currentFileName).toBe('current.svg')
    expect(editor.currentFileHandle).toBe(nextHandle)
    expect(editor.documentState.isDirty).toBe(false)
    expect(editor.svg.viewbox()).toMatchObject({ x: -10, y: -20, width: 120, height: 80 })
    expect(editor.spatialIndex.markDirty).toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalled()
    expect(editor.spatialIndex.rebuild).not.toHaveBeenCalled()
    expect(editor.fullSpatialIndex.rebuild).not.toHaveBeenCalled()
  })

  test('finishes every post-commit cleanup when one listener and subsystem throw', async () => {
    const editor = createEditor()
    seedOldSession(editor)
    const completedCleanup = vi.fn()
    const detachFaultyCleanup = vi.fn()
    editor.signals.commandCancelled = {
      active: true,
      dispatch: vi.fn(),
      _bindings: [
        { execute: completedCleanup, _isOnce: false },
        {
          execute: vi.fn(() => { throw new Error('faulty command cleanup') }),
          _isOnce: true,
          detach: detachFaultyCleanup,
        },
      ],
    }
    const editGroup = { remove: vi.fn(() => { throw new Error('faulty block cleanup') }) }
    const useElement = { show: vi.fn() }
    editor.editingBlock = { editGroup, useElement, savedActiveCollection: editor.activeCollection }
    editor.svg.node.classList.add('block-edit-mode')
    editor.paperEditor.ensureDocumentInfrastructure()
    document.getElementById('paper-canvas').style.display = 'flex'
    editor.svg.node.style.display = 'none'
    editor.mode = 'paper'
    vi.spyOn(editor.paperEditor, 'deactivate').mockImplementation(() => {
      throw new Error('faulty Paper cleanup')
    })

    const result = await editor.loader.loadSource(nativeDocument(), { name: 'clean.svg' })

    expect(result).toMatchObject({ ok: true, kind: 'native' })
    expect(completedCleanup).toHaveBeenCalledTimes(1)
    expect(detachFaultyCleanup).toHaveBeenCalledTimes(1)
    expect(editor.editingBlock).toBeNull()
    expect(editor.svg.node.classList.contains('block-edit-mode')).toBe(false)
    expect(useElement.show).toHaveBeenCalled()
    expect(editor.mode).toBe('model')
    expect(editor.svg.node.style.display).toBe('')
    expect(document.getElementById('paper-canvas').style.display).toBe('none')
    expect(editor.handlers).toBe(editor.modelHandlers)
  })

  test('preserves Viewport-owned grid and axis overlay roots while clearing transient helpers', async () => {
    const editor = createEditor()
    seedOldSession(editor)
    const documentListeners = []
    const addDocumentListener = document.addEventListener.bind(document)
    const removeDocumentListener = document.removeEventListener.bind(document)
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
      documentListeners.push({ type, listener, options })
      addDocumentListener(type, listener, options)
    })
    editor.svg.panZoom = () => editor.svg
    editor.svg.point = (x, y) => ({ x, y })
    editor.svg.zoom = () => 10
    vi.spyOn(editor.svg.node, 'getBoundingClientRect').mockReturnValue({
      left: -5,
      top: -5,
      right: 5,
      bottom: 5,
      width: 10,
      height: 10,
      x: -5,
      y: -5,
      toJSON() {},
    })

    try {
      new Viewport(editor)
      const grid = editor.overlays.findOne('.grid')
      const axes = editor.overlays.findOne('.axis-group')
      const polar = editor.overlays.findOne('.polar-guides')
      expect(grid.children().length).toBeGreaterThan(0)
      expect(axes.children().length).toBeGreaterThan(0)

      const result = await editor.loader.loadSource(nativeDocument(), {
        name: 'viewport.svg',
        handle: { name: 'viewport.svg' },
      })

      expect(result.ok, result.error?.stack).toBe(true)
      expect(editor.overlays.findOne('.grid').node).toBe(grid.node)
      expect(editor.overlays.findOne('.axis-group').node).toBe(axes.node)
      expect(editor.overlays.findOne('.polar-guides').node).toBe(polar.node)
      expect(grid.node.isConnected).toBe(true)
      expect(axes.node.isConnected).toBe(true)
      expect(grid.children().length).toBeGreaterThan(0)
      expect(axes.children().length).toBeGreaterThan(0)
      expect(editor.overlays.findOne('[data-test-transient="overlay"]')).toBeNull()
    } finally {
      documentListeners.forEach(({ type, listener, options }) => {
        removeDocumentListener(type, listener, options)
      })
    }
  })

  test('dirties persisted model viewBox navigation while Paper canvas navigation stays clean', () => {
    const editor = createEditor()
    const documentListeners = []
    const addDocumentListener = document.addEventListener.bind(document)
    const removeDocumentListener = document.removeEventListener.bind(document)
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
      documentListeners.push({ type, listener, options })
      addDocumentListener(type, listener, options)
    })
    editor.svg.panZoom = () => editor.svg
    editor.svg.point = (x, y) => ({ x, y })
    editor.svg.zoom = () => 10
    vi.spyOn(editor.svg.node, 'getBoundingClientRect').mockReturnValue({
      left: -5,
      top: -5,
      right: 5,
      bottom: 5,
      width: 10,
      height: 10,
      x: -5,
      y: -5,
      toJSON() {},
    })

    try {
      new Viewport(editor)
      editor.documentState.replaceSession({ dirty: false })
      editor.svg.dispatch('zoom')
      expect(editor.documentState.isDirty).toBe(true)

      editor.documentState.replaceSession({ dirty: false })
      editor.svg.dispatch('panning')
      expect(editor.documentState.isDirty).toBe(true)
      const firstPanToken = editor.documentState.createSaveToken()
      editor.svg.dispatch('panning')
      expect(editor.documentState.commitSave(firstPanToken)).toBe(false)

      const animate = vi.spyOn(editor.svg, 'animate')
      vi.spyOn(editor.drawing, 'bbox').mockReturnValue({ x: 0, y: 0, width: 10, height: 10 })
      editor.documentState.replaceSession({ dirty: false })
      editor.svg.node.dispatchEvent(new MouseEvent('mousedown', {
        button: 1,
        detail: 2,
        bubbles: true,
        cancelable: true,
      }))
      expect(editor.documentState.isDirty).toBe(true)
      expect(editor.svg.viewbox()).toMatchObject({ x: -1, y: -1, width: 12, height: 12 })
      expect(animate).not.toHaveBeenCalled()

      const panEnded = vi.fn()
      document.addEventListener('mouseup', panEnded)
      editor.svg.dispatch('panStart')
      editor.signals.documentSessionReset.dispatch()
      expect(panEnded).toHaveBeenCalledOnce()

      vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        fillStyle: '#000000',
      })
      editor.paperEditor.ensureDocumentInfrastructure()
      editor.paperSvg.panZoom = () => editor.paperSvg
      editor.mode = 'paper'
      editor.signals.editorModeChanged.dispatch('paper')
      editor.documentState.replaceSession({ dirty: false })
      editor.paperSvg.dispatch('zoom')
      editor.paperSvg.dispatch('panning')
      editor.paperSvg.node.dispatchEvent(new MouseEvent('mousedown', {
        button: 1,
        detail: 2,
        bubbles: true,
        cancelable: true,
      }))
      expect(editor.documentState.isDirty).toBe(false)
    } finally {
      documentListeners.forEach(({ type, listener, options }) => {
        removeDocumentListener(type, listener, options)
      })
    }
  })

  test.each([
    ['native-v1.svg', 1],
    ['native-v2.svg', 2],
  ])('migrates %s into a dirty native session with its requested handle', async (name, version) => {
    const editor = createEditor()
    seedOldSession(editor)
    const handle = { name }

    const result = await editor.loader.loadSource(await fixture(name), { name, handle })

    expect(result.ok, result.error?.stack).toBe(true)
    expect(result).toMatchObject({ kind: 'native', dirty: true })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'schema-migrated',
    }))
    expect(editor.documentState.isDirty).toBe(true)
    expect(editor.currentFileName).toBe(name)
    expect(editor.currentFileHandle).toBe(handle)
    expect(editor.drawing.node.querySelector('[data-collection="true"]')).not.toBeNull()
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      msg: expect.stringContaining(`schema`),
    }))
    expect(result.diagnostics[0].message).not.toContain(String(version + 1000))
  })

  test.each([
    [
      'future schema',
      () => nativeDocument({ version: DOCUMENT_SCHEMA_VERSION + 1 }),
      'future-schema-version',
    ],
    [
      'malformed XML',
      () => `<svg xmlns="${SVG_NS}"><g></svg>`,
      'invalid-svg',
    ],
    [
      'unsafe root',
      () => '<svg xmlns="https://attacker.invalid/svg"><path/></svg>',
      'unsafe-svg',
    ],
  ])('preserves exact live state when %s fails during preparation', async (_label, source, code) => {
    const editor = createEditor()
    const seeded = seedOldSession(editor)
    const result = await editor.loader.loadSource(source(), {
      name: 'rejected.svg',
      handle: { name: 'rejected.svg' },
    })

    expectPreservedFailure(editor, seeded, result)
    expect(result.error).toMatchObject({ code })
    expect(editor.spatialIndex.rebuild).not.toHaveBeenCalled()
    expect(editor.fullSpatialIndex.rebuild).not.toHaveBeenCalled()
  })

  test('checks the controller commit guard after staging and before any live mutation', async () => {
    const editor = createEditor()
    const seeded = seedOldSession(editor)
    const commitGuard = vi.fn(() => false)

    const result = await editor.loader.loadSource(nativeDocument(), {
      name: 'stale-open.svg',
      handle: { name: 'stale-open.svg' },
      commitGuard,
    })

    expectPreservedFailure(editor, seeded, result)
    expect(result).toMatchObject({ cancelled: true, stale: true, kind: 'native' })
    expect(commitGuard).toHaveBeenCalledTimes(1)
    expect(editor.spatialIndex.markDirty).not.toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).not.toHaveBeenCalled()
  })

  test('degrades an invalid Paper viewport id before commit without creating Paper infrastructure', async () => {
    const editor = createEditor()
    seedOldSession(editor)
    const paperViewports = JSON.stringify([{
      id: 'bad id',
      x: 1,
      y: 2,
      w: 8,
      h: 6,
      scale: 100,
      modelOriginX: 0,
      modelOriginY: 0,
    }]).replace(/&/g, '&amp;').replace(/"/g, '&quot;')

    const result = await editor.loader.loadSource(nativeDocument({
      attributes: `data-paper-viewports="${paperViewports}"`,
    }), { name: 'recovered.svg', handle: { name: 'recovered.svg' } })

    expect(result).toMatchObject({ ok: true, kind: 'native', dirty: true })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'invalid-paper-viewports',
    }))
    expect(document.getElementById('paper-canvas')).toBeNull()
    expect(editor.paperSvg).toBeUndefined()
    expect(editor.paperAnnotations).toBeUndefined()
    expect(editor.paperViewports).toBeUndefined()
    expect(editor.collections.has('paper-annotations')).toBe(false)
  })

  test('removes invalid element metadata with a bounded warning and opens dirty', async () => {
    const editor = createEditor()
    const oversizedMetadata = JSON.stringify({
      payload: 'x'.repeat(1024 * 1024),
    }).replace(/&/g, '&amp;').replace(/"/g, '&quot;')

    const result = await editor.loader.loadSource(nativeDocument({
      content: `<g id="collection-new" name="New" data-collection="true">
        <path id="10" d="M0 0L1 1" data-arc-data="${oversizedMetadata}"/>
      </g>`,
    }), { name: 'recovered-metadata.svg', handle: { name: 'recovered-metadata.svg' } })

    expect(result).toMatchObject({ ok: true, kind: 'native', dirty: true })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'invalid-element-metadata',
    }))
    expect(editor.drawing.node.querySelector('[id="10"]').hasAttribute('data-arc-data')).toBe(false)
    expect(editor.documentState.isDirty).toBe(true)
  })

  test('recovers an invalid native block display name visibly instead of opening clean', async () => {
    const editor = createEditor()
    const invalidName = 'B'.repeat(257)
    const result = await editor.loader.loadSource(nativeDocument({
      content: `<defs>
        <g id="block-invalid" data-block-def="true" data-block-name="${invalidName}"
          data-base-point="{&quot;x&quot;:0,&quot;y&quot;:0}"><line x2="1" y2="1"/></g>
      </defs>
      <g id="collection-new" name="New" data-collection="true">
        <use id="10" href="#block-invalid" data-block-instance="true" data-block-name="${invalidName}"/>
      </g>`,
    }), { name: 'recovered-block.svg', handle: { name: 'recovered-block.svg' } })

    expect(result).toMatchObject({ ok: true, kind: 'native', dirty: true })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid-block-name' }))
    expect(Array.from(editor.blockDefinitions.keys())).toEqual(['imported-1'])
    expect(editor.drawing.node.querySelector('use').getAttribute('data-block-name')).toBe('imported-1')
  })

  test('a late Paper adoption failure restores exact viewport and selection identities', async () => {
    const editor = createEditor()
    const seeded = seedOldSession(editor)
    editor.paperEditor.ensureDocumentInfrastructure()
    const oldAnnotation = editor.paperAnnotations.text('Old annotation').attr('id', 'old-paper-note')
    const oldViewport = editor.paperEditor.createViewport(2, 3, 10, 7, 50, {
      id: 'vp-old',
      modelOriginX: 4,
      modelOriginY: 5,
      silent: true,
      notify: false,
    })
    const selection = [{ _paperVp: oldViewport }]
    const previousSelection = [...selection]
    editor.selected = selection
    editor.previousSelection = previousSelection
    seeded.selected = selection
    seeded.previousSelection = previousSelection
    oldViewport.activate()
    const oldPaperState = {
      activeCollection: editor.activeCollection,
      annotations: editor.paperAnnotations,
      canvas: document.getElementById('paper-canvas'),
      clip: oldViewport._clipRect.node,
      collection: editor.collections.get('paper-annotations'),
      config: editor.paperConfig,
      group: oldViewport._group.node,
      handlers: editor.handlers,
      onDblClick: oldViewport._onDblClick,
      onMouseDown: oldViewport._onMouseDown,
      svg: editor.paperSvg,
      viewports: editor.paperViewports,
    }
    const paperViewports = JSON.stringify([{
      id: 'vp-new',
      x: 1,
      y: 2,
      w: 8,
      h: 6,
      scale: 100,
      modelOriginX: 0,
      modelOriginY: 0,
    }]).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    vi.spyOn(editor.documentState, 'refreshPersistentRoots').mockImplementationOnce(() => {
      throw new Error('injected late Paper failure')
    })

    try {
      const result = await editor.loader.loadSource(nativeDocument({
        attributes: `data-paper-viewports="${paperViewports}"`,
      }), { name: 'failed.svg', handle: { name: 'failed.svg' } })

      expectPreservedFailure(editor, seeded, result)
      expect(result.error).toMatchObject({ message: 'injected late Paper failure' })
      expect(document.getElementById('paper-canvas')).toBe(oldPaperState.canvas)
      expect(editor.paperSvg).toBe(oldPaperState.svg)
      expect(editor.paperAnnotations).toBe(oldPaperState.annotations)
      expect(editor.paperAnnotations.findOne('#old-paper-note').node).toBe(oldAnnotation.node)
      expect(oldAnnotation.node.isConnected).toBe(true)
      expect(editor.paperViewports).toBe(oldPaperState.viewports)
      expect(editor.paperViewports).toEqual([oldViewport])
      expect(editor.paperViewports[0]).toBe(oldViewport)
      expect(oldViewport._group.node).toBe(oldPaperState.group)
      expect(oldViewport._clipRect.node).toBe(oldPaperState.clip)
      expect(oldViewport._onDblClick).toBe(oldPaperState.onDblClick)
      expect(oldViewport._onMouseDown).toBe(oldPaperState.onMouseDown)
      expect(oldPaperState.group.isConnected).toBe(true)
      expect(oldPaperState.clip.isConnected).toBe(true)
      expect(oldViewport.activeForPanning).toBe(true)
      expect(editor.selected).toBe(selection)
      expect(editor.selected[0]._paperVp).toBe(oldViewport)
      expect(editor.previousSelection).toBe(previousSelection)
      expect(editor.activeCollection).toBe(oldPaperState.activeCollection)
      expect(editor.handlers).toBe(oldPaperState.handlers)
      expect(editor.paperConfig).toBe(oldPaperState.config)
      expect(editor.collections.get('paper-annotations')).toBe(oldPaperState.collection)
      expect(document.getElementById('vp-new-group')).toBeNull()
      expect(document.getElementById('vp-new-clip')).toBeNull()
      expect(editor.spatialIndex.rebuild).not.toHaveBeenCalled()
      expect(editor.fullSpatialIndex.rebuild).not.toHaveBeenCalled()
      expect(editor.spatialIndex.markDirty).not.toHaveBeenCalled()
      expect(editor.fullSpatialIndex.markDirty).not.toHaveBeenCalled()
    } finally {
      oldViewport.deactivate()
    }
  })

  test('a fallback native Open clears a stale direct-write handle only after success', async () => {
    const editor = createEditor()
    const seeded = seedOldSession(editor)

    const result = await editor.loader.loadSource(nativeDocument(), { name: 'fallback.svg' })

    expect(result).toMatchObject({ ok: true, kind: 'native', dirty: false })
    expect(editor.currentFileName).toBe('fallback.svg')
    expect(editor.currentFileHandle).toBeNull()
    expect(editor.currentFileHandle).not.toBe(seeded.oldHandle)
  })

  test('foreign SVG and DXF imports are dirty and cannot inherit or adopt a direct-write handle', async () => {
    const svgEditor = createEditor()
    seedOldSession(svgEditor)
    const requestedSvgHandle = { name: 'foreign.svg' }
    const svgResult = await svgEditor.loader.loadSource(`
      <svg xmlns="${SVG_NS}" viewBox="0 0 20 20">
        <g data-collection="true"><rect id="foreign" width="10" height="10"/></g>
      </svg>
    `, { name: 'foreign.svg', handle: requestedSvgHandle })

    expect(svgResult).toMatchObject({ ok: true, kind: 'foreign-svg', dirty: true })
    expect(svgEditor.currentFileName).toBe('foreign.svg')
    expect(svgEditor.currentFileHandle).toBeNull()
    expect(svgEditor.documentState.isDirty).toBe(true)
    expect(svgEditor.drawing.node.querySelector('[data-nanquim-import-root="true"]')).not.toBeNull()

    const dxfEditor = createEditor()
    seedOldSession(dxfEditor)
    const requestedDxfHandle = { name: 'fixture.dxf' }
    const dxfResult = await dxfEditor.loader.loadSource(await fixture('basic-entities-r2000.dxf'), {
      name: 'fixture.dxf',
      type: 'image/vnd.dxf',
      handle: requestedDxfHandle,
    })

    expect(dxfResult).toMatchObject({ ok: true, kind: 'dxf', dirty: true })
    expect(dxfEditor.currentFileName).toBe('fixture.dxf')
    expect(dxfEditor.currentFileHandle).toBeNull()
    expect(dxfEditor.documentState.isDirty).toBe(true)
    expect(dxfEditor.drawing.node.querySelector('line')).not.toBeNull()
  })

  test('replaces only document-owned definitions and preserves app-owned definitions by identity', async () => {
    const editor = createEditor()
    seedOldSession(editor)
    const defs = editor.svg.defs().node
    const appOwned = document.createElementNS(SVG_NS, 'marker')
    appOwned.id = 'app-owned-marker'
    const oldImported = document.createElementNS(SVG_NS, 'g')
    oldImported.setAttribute('data-nanquim-import-assets', 'true')
    oldImported.appendChild(document.createElementNS(SVG_NS, 'linearGradient')).id = 'old-gradient'
    const oldBlock = document.createElementNS(SVG_NS, 'g')
    oldBlock.id = 'block-Old'
    oldBlock.setAttribute('data-block-def', 'true')
    const oldDocumentDef = document.createElementNS(SVG_NS, 'pattern')
    oldDocumentDef.id = 'old-document-pattern'
    oldDocumentDef.setAttribute('data-nanquim-document-def', 'true')
    defs.append(appOwned, oldImported, oldBlock, oldDocumentDef)
    editor.documentState.replaceSession({ name: 'old.svg', handle: { name: 'old.svg' }, dirty: true })

    const result = await editor.loader.loadSource(nativeDocument({
      content: `
        <defs>
          <linearGradient id="new-gradient"><stop offset="0" stop-color="#fff"/></linearGradient>
          <g id="block-New" data-block-def="true" data-block-name="New"><rect width="2" height="2"/></g>
        </defs>
        <g id="collection-new" data-collection="true"><rect id="20" width="5" height="5" fill="url(#new-gradient)"/></g>
      `,
    }), { name: 'new.svg', handle: { name: 'new.svg' } })

    expect(result.ok).toBe(true)
    expect(editor.svg.node.querySelector('#app-owned-marker')).toBe(appOwned)
    expect(appOwned.isConnected).toBe(true)
    expect(oldImported.isConnected).toBe(false)
    expect(oldBlock.isConnected).toBe(false)
    expect(oldDocumentDef.isConnected).toBe(false)
    const importedAssets = defs.querySelector('[data-nanquim-import-assets="true"]')
    expect(importedAssets).not.toBeNull()
    expect(importedAssets.querySelector('#new-gradient')).not.toBeNull()
    expect(importedAssets.querySelector('[data-block-def="true"]')).not.toBeNull()
    expect(defs.querySelectorAll('[data-nanquim-import-assets="true"]')).toHaveLength(1)
  })

  test('rejects an out-of-range persisted Geometry Nodes graph view during current-document staging', async () => {
    const editor = createEditor()
    const geometryNodes = {
      version: 1,
      graphs: [{
        schemaVersion: 1,
        id: 'invalid-view-graph',
        name: 'Invalid view',
        nodes: [],
        links: [],
        view: { x: 10, y: 20, zoom: 2.6 },
      }],
      instances: [],
    }
    const result = await editor.loader.loadSource(nativeDocument({
      content: `
        <metadata id="nanquim-geometry-nodes">${JSON.stringify(geometryNodes)}</metadata>
        <g id="collection-new" data-collection="true"><line id="30" x2="1" y2="1"/></g>
      `,
    }), { name: 'invalid-graph-view.svg', handle: { name: 'invalid-graph-view.svg' } })

    expect(result).toMatchObject({ ok: true, kind: 'native', dirty: true })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'invalid-geometry-nodes',
    }))
    expect(editor.geometryNodes.graphs.size).toBe(0)
    expect(editor.documentState.isDirty).toBe(true)
  })

  test('restores Paper annotations, viewport identity and configuration through the Paper document API', async () => {
    const editor = createEditor()
    seedOldSession(editor)
    editor.paperEditor.ensureDocumentInfrastructure()
    editor.paperEditor.createViewport(1, 1, 2, 2, 100, { id: 'old-vp' })

    const paperConfig = JSON.stringify({
      size: 'A3',
      width: 420,
      height: 297,
      orientation: 'landscape',
      unitsPerCm: 2,
      colorMap: { '#ffffff': { printColor: '#000000', enabled: true } },
    }).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    const paperViewports = JSON.stringify([{
      id: 'vp-7',
      x: 1,
      y: 2,
      w: 8,
      h: 6,
      scale: 50,
      modelOriginX: -20,
      modelOriginY: 30,
      visible: false,
      locked: true,
    }]).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    const result = await editor.loader.loadSource(nativeDocument({
      attributes: `data-paper-config="${paperConfig}" data-paper-viewports="${paperViewports}"`,
      content: `
        <g id="saved-paper" name="Notes &amp; labels"
          data-nanquim-paper-annotations="true" data-collection="true"
          data-locked="true" style="display:none;stroke:#c0ffee;stroke-width:0.25;fill:transparent">
          <text id="paper-note">A &amp; B</text>
        </g>
        <g id="collection-new" data-collection="true"><line id="30" x2="1" y2="1"/></g>
      `,
    }), { name: 'paper.svg', handle: { name: 'paper.svg' } })

    expect(result.ok).toBe(true)
    expect(editor.paperConfig).toMatchObject({
      size: 'A3',
      width: 420,
      height: 297,
      orientation: 'landscape',
      unitsPerCm: 2,
    })
    expect(editor.paperAnnotations.attr('name')).toBe('Notes & labels')
    expect(editor.paperAnnotations.findOne('#paper-note').text()).toBe('A & B')
    expect(editor.collections.get('paper-annotations')).toMatchObject({
      visible: false,
      locked: true,
    })
    expect(editor.paperViewports).toHaveLength(1)
    expect(editor.paperViewports[0]).toMatchObject({
      id: 'vp-7',
      x: 1,
      y: 2,
      w: 8,
      h: 6,
      scale: 50,
      modelOriginX: -20,
      modelOriginY: 30,
      visible: false,
      locked: true,
    })
    expect(editor.mode).toBe('model')
  })

  test('opening from Paper Space cannot revive the previous document active collection', async () => {
    const colorContext = {
      _fillStyle: '#000000',
      get fillStyle() { return this._fillStyle },
      set fillStyle(value) { this._fillStyle = String(value).toLowerCase() },
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(colorContext)
    const editor = createEditor()
    const previousCollection = editor.activeCollection
    editor.mode = 'paper'
    editor.paperEditor.activate()
    expect(editor.activeCollection).toBe(editor.paperAnnotations)

    const result = await editor.loader.loadSource(nativeDocument({
      attributes: 'data-active-collection-id="collection-new"',
    }), { name: 'paper-to-model.svg', handle: { name: 'paper-to-model.svg' } })

    expect(result).toMatchObject({ ok: true, kind: 'native' })
    expect(editor.mode).toBe('model')
    expect(editor.activeCollection.attr('id')).toBe('collection-new')
    expect(editor.activeCollection).not.toBe(previousCollection)

    // Loader notifications can dispatch Model mode after cleanup. A repeated
    // deactivation must not restore the stale pre-Open collection pointer.
    editor.signals.editorModeChanged.dispatch('model')
    expect(editor.activeCollection.attr('id')).toBe('collection-new')
  })
})
