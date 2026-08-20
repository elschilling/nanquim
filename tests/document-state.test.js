// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

import { Editor } from '../src/js/Editor.js'
import { History } from '../src/js/History.js'
import { DimensionManager } from '../src/js/DimensionManager.js'
import { TextStyleManager } from '../src/js/TextStyleManager.js'
import {
  createCollection,
  initCollections,
  rebuildCollectionsFromDOM,
  setActiveCollection,
  toggleLock,
} from '../src/js/Collection.js'
import { DocumentState } from '../src/js/document/DocumentState.js'

class TestSignal {
  constructor() {
    this.listeners = []
  }

  add(listener) {
    this.listeners.push(listener)
  }

  remove(listener) {
    this.listeners = this.listeners.filter((candidate) => candidate !== listener)
  }

  dispatch(...args) {
    this.listeners.forEach((listener) => listener(...args))
  }
}

function createStateEditor(root = document.createElement('div')) {
  return {
    currentFileHandle: null,
    currentFileName: null,
    drawing: root,
    signals: {
      documentStateChanged: { dispatch: vi.fn() },
    },
  }
}

const activeStates = []

function createState(editor, options) {
  const state = new DocumentState(editor, options)
  activeStates.push(state)
  return state
}

describe('DocumentState', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    registerWindow(window, document)
  })

  afterEach(() => {
    activeStates.splice(0).forEach((state) => state.disconnect())
    vi.restoreAllMocks()
  })

  test('uses session and revision tokens so stale saves cannot clean newer work', () => {
    const editor = createStateEditor()
    const state = createState(editor, { observe: false })

    expect(state.snapshot()).toMatchObject({
      sessionId: 1,
      revision: 0,
      savedRevision: 0,
      isDirty: false,
    })

    state.markChanged('geometry')
    const currentToken = state.createSaveToken()
    expect(state.isDirty).toBe(true)
    expect(state.markSaved(currentToken)).toBe(true)
    expect(state.isDirty).toBe(false)

    const pendingToken = state.createSaveToken()
    state.markChanged('edit-during-save')
    expect(state.markSaved(pendingToken)).toBe(false)
    expect(state.isDirty).toBe(true)

    const obsoleteSessionToken = state.createSaveToken()
    state.replaceSession({ name: 'replacement.svg', dirty: false })
    expect(state.markSaved(obsoleteSessionToken)).toBe(false)
    expect(state.isDirty).toBe(false)
  })

  test('save tokens cannot overwrite a newer file association in the same session', () => {
    const oldHandle = { name: 'old.svg' }
    const nextHandle = { name: 'next.svg' }
    const editor = createStateEditor()
    const state = createState(editor, { observe: false, name: 'old.svg', handle: oldHandle })
    state.markChanged('geometry')

    const oldAssociationToken = state.createSaveToken()
    const retargetToken = state.createSaveToken()
    expect(state.commitSave(retargetToken, { name: 'next.svg', handle: nextHandle })).toBe(true)
    expect(state.commitSave(oldAssociationToken, { name: 'old.svg', handle: oldHandle })).toBe(false)
    expect(state.snapshot()).toMatchObject({
      name: 'next.svg',
      handle: nextHandle,
      isDirty: false,
    })
  })

  test('replaces file identity atomically and can begin clean or dirty', () => {
    const oldHandle = { name: 'old.svg' }
    const nextHandle = { name: 'next.svg' }
    const editor = createStateEditor()
    const state = createState(editor, { observe: false, name: 'old.svg', handle: oldHandle })

    const clean = state.replaceSession({ name: 'next.svg', handle: nextHandle })
    expect(clean).toMatchObject({ name: 'next.svg', handle: nextHandle, isDirty: false })
    expect(editor.currentFileName).toBe('next.svg')
    expect(editor.currentFileHandle).toBe(nextHandle)

    const imported = state.replaceSession({ name: 'imported.dxf', handle: null, dirty: true })
    expect(imported).toMatchObject({
      revision: 1,
      savedRevision: 0,
      name: 'imported.dxf',
      handle: null,
      isDirty: true,
    })
    expect(editor.currentFileHandle).toBeNull()
    expect(editor.signals.documentStateChanged.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'session-replaced', isDirty: true }),
    )
  })

  test('suppresses explicit and observed changes for synchronous and asynchronous transactions', async () => {
    const root = document.createElement('div')
    const editor = createStateEditor(root)
    const state = createState(editor)

    const result = state.runWithoutTracking(() => {
      root.appendChild(document.createElement('span'))
      expect(state.markChanged('suppressed')).toBe(false)
      return 42
    })
    expect(result).toBe(42)
    expect(state.flushObservedMutations()).toBe(false)
    expect(state.isDirty).toBe(false)

    await state.runWithoutTracking(async () => {
      root.appendChild(document.createElement('i'))
      await Promise.resolve()
      root.appendChild(document.createElement('b'))
      state.markChanged('also-suppressed')
    })
    expect(state.flushObservedMutations()).toBe(false)
    expect(state.isDirty).toBe(false)

    await expect(state.runWithoutTracking(async () => {
      throw new Error('transaction failed')
    })).rejects.toThrow('transaction failed')
    expect(state.markChanged('tracking-restored')).toBe(true)
  })

  test('observes persistent DOM while ignoring selection state and transient helpers', () => {
    const root = document.createElement('div')
    const editor = createStateEditor(root)
    const state = createState(editor)

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    root.appendChild(line)
    expect(state.flushObservedMutations()).toBe(true)
    expect(state.isDirty).toBe(true)

    state.replaceSession()
    line.classList.add('elementSelected', 'elementHover')
    line.setAttribute('selected', 'true')
    line.setAttribute('data-collapsed', 'true')
    expect(state.flushObservedMutations()).toBe(false)
    expect(state.isDirty).toBe(false)

    const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    ghost.classList.add('ghostLine')
    root.appendChild(ghost)
    ghost.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'))
    ghost.setAttribute('transform', 'translate(10 10)')
    expect(state.flushObservedMutations()).toBe(false)

    line.setAttribute('x2', '25')
    expect(state.flushObservedMutations()).toBe(true)
    expect(editor.signals.documentStateChanged.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'dom', isDirty: true }),
    )
  })

  test('registers persistent roots created after initialization', () => {
    const editor = createStateEditor()
    const state = createState(editor)
    const annotations = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    editor.paperAnnotations = annotations

    state.refreshPersistentRoots()
    annotations.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'text'))

    expect(state.flushObservedMutations()).toBe(true)
    expect(state.isDirty).toBe(true)
  })

  test('flushes queued DOM edits before accepting a completed save', () => {
    const root = document.createElement('div')
    const editor = createStateEditor(root)
    const state = createState(editor)
    const token = state.createSaveToken()

    root.appendChild(document.createElement('span'))

    expect(state.markSaved(token)).toBe(false)
    expect(state.isDirty).toBe(true)
    expect(state.revision).toBe(1)
  })

  test('tracks graph-only changes and removes its signal listener on disconnect', () => {
    const geometryNodesChanged = new TestSignal()
    const editor = createStateEditor()
    editor.signals.geometryNodesChanged = geometryNodesChanged
    const state = createState(editor, { observe: false })

    geometryNodesChanged.dispatch()
    expect(state.snapshot()).toMatchObject({ revision: 1, isDirty: true })

    state.runWithoutTracking(() => geometryNodesChanged.dispatch())
    expect(state.revision).toBe(1)

    state.disconnect()
    expect(geometryNodesChanged.listeners).toHaveLength(0)
    geometryNodesChanged.dispatch()
    expect(state.revision).toBe(1)
  })

  test('does not discard an earlier persistent mutation when suppressing later DOM work', () => {
    const root = document.createElement('div')
    const editor = createStateEditor(root)
    const state = createState(editor)

    root.appendChild(document.createElement('span'))
    state.runWithoutTracking(() => root.appendChild(document.createElement('i')))

    expect(state.revision).toBe(1)
    expect(state.isDirty).toBe(true)
    expect(state.flushObservedMutations()).toBe(false)
  })
})

describe('document mutation integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="canvas"></div>'
    registerWindow(window, document)
    globalThis.SVG = SVG
    globalThis.signals = { Signal: TestSignal }
  })

  afterEach(() => {
    activeStates.splice(0).forEach((state) => state.disconnect())
    delete globalThis.SVG
    delete globalThis.signals
    document.body.replaceChildren()
  })

  test('Editor starts clean and marks direct add/remove operations', () => {
    const editor = new Editor()
    activeStates.push(editor.documentState)
    expect(editor.documentState.isDirty).toBe(false)

    const line = editor.svg.line(0, 0, 10, 10)
    editor.addElement(line, editor.activeCollection)
    expect(editor.documentState.snapshot()).toMatchObject({ revision: 1, isDirty: true })

    expect(editor.documentState.markSaved(editor.documentState.createSaveToken())).toBe(true)
    editor.removeElement(line)
    expect(editor.documentState.snapshot()).toMatchObject({ revision: 2, isDirty: true })
  })

  test('History marks each successful execute, undo, and redo once and can be cleared', () => {
    const editor = createStateEditor()
    const state = createState(editor, { observe: false })
    editor.documentState = state
    const history = new History(editor)
    const command = {
      execute: vi.fn(() => state.markChanged('nested-command-change')),
      undo: vi.fn(() => state.markChanged('nested-command-undo')),
      redo: vi.fn(() => state.markChanged('nested-command-redo')),
    }

    history.execute(command)
    expect(state.revision).toBe(1)
    expect(command.execute).toHaveBeenCalledOnce()

    history.undo()
    expect(state.revision).toBe(2)
    expect(command.undo).toHaveBeenCalledOnce()

    history.redo()
    expect(state.revision).toBe(3)
    expect(command.redo).toHaveBeenCalledOnce()

    history.clear()
    expect(history.undos).toEqual([])
    expect(history.redos).toEqual([])
    expect(history.idCounter).toBe(0)
    expect(state.revision).toBe(3)
  })

  test('tracks persisted dimension and text style state without marking no-op updates', () => {
    const editor = createStateEditor()
    editor.drawing = { children: () => ({ each: () => {} }) }
    editor.signals.updatedProperties = { dispatch: vi.fn() }
    editor.signals.refreshHandlers = { dispatch: vi.fn() }
    editor.signals.refreshDimensions = { dispatch: vi.fn() }
    const state = createState(editor, { observe: false })
    editor.documentState = state

    const dimensions = new DimensionManager(editor)
    editor.dimensionManager = dimensions
    const text = new TextStyleManager(editor)
    state.replaceSession()

    dimensions.createStyle('Detail', 'Detail', {})
    dimensions.setActiveStyle('Detail')
    dimensions.setActiveStyle('Detail')
    dimensions.renameStyle('Detail', 'Detail')
    dimensions.renameStyle('Detail', 'Detailed')
    dimensions.updateStyle('Detail', { markerSize: 0.15 })
    dimensions.updateStyle('Detail', { markerSize: 0.25 })
    expect(state.revision).toBe(4)

    text.createStyle('Notes', 'Notes', {})
    text.setActiveStyle('Notes')
    text.setActiveStyle('Notes')
    text.renameStyle('Notes', 'Notes')
    text.renameStyle('Notes', 'Annotations')
    text.updateStyle('Notes', { fontSize: 0.15 })
    text.updateStyle('Notes', { fontSize: 0.3 })
    expect(state.revision).toBe(8)

    dimensions.deleteStyle('Detail')
    text.deleteStyle('Notes')
    expect(state.revision).toBe(10)
  })

  test('tracks collection locks and active model collection changes without dirtying no-ops', () => {
    const makeCollectionEditor = () => {
      const svg = SVG().addTo(document.body)
      return {
        drawing: svg.group(),
        signals: {
          documentStateChanged: { dispatch: vi.fn() },
          updatedCollections: { dispatch: vi.fn() },
          updatedOutliner: { dispatch: vi.fn() },
        },
        svg,
      }
    }

    const first = makeCollectionEditor()
    initCollections(first)
    const firstCollection = first.activeCollection
    const firstState = createState(first)
    first.documentState = firstState
    firstState.replaceSession()
    const secondCollection = createCollection(first, 'Second')
    firstState.flushObservedMutations()
    firstState.markSaved(firstState.createSaveToken())

    setActiveCollection(first, firstCollection.attr('id'))
    expect(firstState.snapshot()).toMatchObject({ isDirty: true })
    expect(firstState.revision).toBe(firstState.savedRevision + 1)

    setActiveCollection(first, firstCollection.attr('id'))
    expect(firstState.revision).toBe(firstState.savedRevision + 1)

    expect(firstState.markSaved(firstState.createSaveToken())).toBe(true)
    setActiveCollection(first, secondCollection.attr('id'))
    expect(firstState.snapshot()).toMatchObject({ isDirty: true })
    expect(firstState.revision).toBe(firstState.savedRevision + 1)

    toggleLock(first, secondCollection.attr('id'))
    expect(firstState.snapshot()).toMatchObject({ isDirty: true })
    expect(firstState.revision).toBe(firstState.savedRevision + 2)

    const second = makeCollectionEditor()
    initCollections(second)
    expect(second.activeCollection.attr('id')).toBe('collection-1')
    expect(createCollection(second, 'Second editor')).toHaveProperty(
      'node.id',
      'collection-2',
    )

    const loaded = second.drawing.group().attr({
      id: 'collection-8',
      'data-collection': 'true',
    })
    second.drawing.children().each((child) => {
      if (child !== loaded) child.remove()
    })
    rebuildCollectionsFromDOM(second)
    expect(createCollection(second, 'After load').attr('id')).toBe('collection-9')
  })
})
