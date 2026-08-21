// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

import { Command } from '../src/js/Command.js'
import { History } from '../src/js/History.js'
import { AddElementCommand } from '../src/js/commands/AddElementCommand.js'
import { DocumentState } from '../src/js/document/DocumentState.js'
import {
  applyCollectionStyleToElement,
  createCollection,
  deleteCollection,
  findSelectableAncestor,
  getAllDrawingElements,
  getDrawableElements,
  getElementOverrides,
  getSelectableElements,
  initCollections,
  isDerivedGeometry,
  isElementHidden,
  isElementLocked,
  migrateOrphanElements,
  rebuildCollectionsFromDOM,
  setActiveCollection,
  setCollectionStyle,
  setElementOverrides,
  toggleElementLock,
  toggleElementVisibility,
  toggleLock,
  toggleVisibility,
} from '../src/js/Collection.js'

function createSignals() {
  return {
    updatedCollections: { dispatch: vi.fn() },
    updatedOutliner: { dispatch: vi.fn() },
  }
}

function createEditor() {
  const svg = SVG().addTo(document.body)
  const drawing = svg.group().attr('id', 'drawing')

  return {
    activeCollection: null,
    collections: new Map(),
    drawing,
    mode: 'model',
    selected: [],
    signals: createSignals(),
    svg,
  }
}

function elementIds(elements) {
  return elements.map((element) => element.attr('id')).sort()
}

describe('History', () => {
  test('executes commands with monotonic ids and invalidates a redo branch', () => {
    const history = new History({})
    const first = { execute: vi.fn(), undo: vi.fn() }
    const second = { execute: vi.fn(), undo: vi.fn(), redo: vi.fn() }
    const replacement = { execute: vi.fn(), undo: vi.fn() }

    history.execute(first)
    history.execute(second)

    expect(first.id).toBe(1)
    expect(second.id).toBe(2)
    expect(first.execute).toHaveBeenCalledOnce()
    expect(second.execute).toHaveBeenCalledOnce()
    expect(history.undos).toEqual([first, second])

    expect(history.undo()).toBe(second)
    expect(second.undo).toHaveBeenCalledOnce()
    expect(history.redos).toEqual([second])

    history.execute(replacement)

    expect(replacement.id).toBe(3)
    expect(history.undos).toEqual([first, replacement])
    expect(history.redos).toEqual([])
  })

  test('undoes and redoes in LIFO order, preferring a dedicated redo method', () => {
    const history = new History({})
    const legacy = { execute: vi.fn(), undo: vi.fn() }
    const modern = { execute: vi.fn(), undo: vi.fn(), redo: vi.fn() }

    expect(history.undo()).toBeUndefined()
    expect(history.redo()).toBeUndefined()

    history.execute(legacy)
    history.execute(modern)

    expect(history.undo()).toBe(modern)
    expect(history.undo()).toBe(legacy)
    expect(history.undos).toEqual([])
    expect(history.redos).toEqual([modern, legacy])

    expect(history.redo()).toBe(legacy)
    expect(legacy.execute).toHaveBeenCalledTimes(2)
    expect(history.redo()).toBe(modern)
    expect(modern.redo).toHaveBeenCalledOnce()
    expect(modern.execute).toHaveBeenCalledOnce()
    expect(history.undos).toEqual([legacy, modern])
  })

  test('does not record a command or discard redo when execute fails', () => {
    const documentState = {
      markChanged: vi.fn(),
      runWithoutTracking: vi.fn((callback) => callback()),
    }
    const history = new History({ documentState })
    const existing = { execute: vi.fn(), undo: vi.fn() }
    const redo = { execute: vi.fn(), undo: vi.fn() }
    const failure = new Error('mutation failed')
    const broken = { execute: vi.fn(() => { throw failure }), undo: vi.fn() }

    history.execute(existing)
    history.redos.push(redo)
    const undos = history.undos
    const redos = history.redos
    documentState.markChanged.mockClear()

    expect(() => history.execute(broken)).toThrow(failure)
    expect(history.undos).toBe(undos)
    expect(history.redos).toBe(redos)
    expect(history.undos).toEqual([existing])
    expect(history.redos).toEqual([redo])
    expect(history.idCounter).toBe(1)
    expect(broken).not.toHaveProperty('id')
    expect(documentState.markChanged).not.toHaveBeenCalled()

    broken.id = 99
    expect(() => history.execute(broken)).toThrow(failure)
    expect(broken.id).toBe(99)
    expect(history.idCounter).toBe(1)
  })

  test('rejects values that are not executable commands', () => {
    const history = new History({})

    expect(() => history.execute(null)).toThrow('History commands must implement execute() and undo()')
    expect(() => history.execute({})).toThrow('History commands must implement execute() and undo()')
    expect(() => history.execute({ execute: vi.fn() })).toThrow(
      'History commands must implement execute() and undo()',
    )
    expect(history.undos).toEqual([])
    expect(history.idCounter).toBe(0)
  })

  test('keeps commands on their original stack when undo or redo fails', () => {
    const history = new History({})
    const undoFailure = new Error('undo failed')
    const redoFailure = new Error('redo failed')
    const brokenUndo = {
      execute: vi.fn(),
      undo: vi.fn(() => { throw undoFailure }),
    }
    const brokenRedo = {
      execute: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(() => { throw redoFailure }),
    }

    history.execute(brokenUndo)
    expect(() => history.undo()).toThrow(undoFailure)
    expect(history.undos).toEqual([brokenUndo])
    expect(history.redos).toEqual([])

    brokenUndo.undo.mockImplementation(() => {})
    history.undo()
    history.execute(brokenRedo)
    history.undo()
    expect(() => history.redo()).toThrow(redoFailure)
    expect(history.undos).toEqual([])
    expect(history.redos).toEqual([brokenRedo])
  })

  test('clear preserves stack identities for lifecycle observers', () => {
    const history = new History({})
    const undos = history.undos
    const redos = history.redos

    history.execute({ execute: vi.fn(), undo: vi.fn() })
    history.redos.push({ execute: vi.fn(), undo: vi.fn() })
    history.clear()

    expect(history.undos).toBe(undos)
    expect(history.redos).toBe(redos)
    expect(history.undos).toEqual([])
    expect(history.redos).toEqual([])
    expect(history.idCounter).toBe(0)
  })

  test('commits a pre-attached element as one tracked mutation', () => {
    document.body.replaceChildren()
    registerWindow(window, document)
    const svg = SVG().addTo(document.body)
    const drawing = svg.group().attr('id', 'drawing')
    const editor = {
      drawing,
      signals: {},
      svg,
      spatialIndex: { markDirty: vi.fn() },
      fullSpatialIndex: { markDirty: vi.fn() },
    }
    editor.documentState = new DocumentState(editor)
    editor.history = new History(editor)
    editor.addElement = (element, parent) => {
      editor.documentState.runWithoutTracking(() => element.putIn(parent))
      editor.spatialIndex.markDirty()
      editor.fullSpatialIndex.markDirty()
      editor.documentState.markChanged('element-added')
    }
    editor.removeElement = (element) => {
      editor.documentState.runWithoutTracking(() => element.remove())
      editor.spatialIndex.markDirty()
      editor.fullSpatialIndex.markDirty()
      editor.documentState.markChanged('element-removed')
    }

    const rectangle = drawing.rect(20, 10)
    const command = new AddElementCommand(editor, rectangle)
    expect(rectangle.attr('data-nanquim-transient')).toBe('true')

    editor.history.execute(command)
    editor.documentState.flushObservedMutations()
    expect(editor.documentState.revision).toBe(1)
    expect(rectangle.attr('data-nanquim-transient')).toBeUndefined()
    expect(editor.history.undos).toEqual([command])

    editor.history.undo()
    editor.history.redo()
    expect(editor.documentState.revision).toBe(3)
    expect(rectangle.node.isConnected).toBe(true)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
    editor.documentState.disconnect()
  })
})

describe('Command', () => {
  test('resolves the drawing destination lazily and announces outliner changes', () => {
    const firstCollection = { id: 'first' }
    const secondCollection = { id: 'second' }
    const drawing = { id: 'drawing' }
    const dispatch = vi.fn()
    const editor = {
      activeCollection: firstCollection,
      drawing,
      signals: { updatedOutliner: { dispatch } },
    }
    const command = new Command(editor)

    expect(command.type).toBe('')
    expect(command.name).toBe('')
    expect(command.editor).toBe(editor)
    expect(command.signals).toBe(editor.signals)
    expect(command.isDrawing).toBe(true)
    expect(command.drawing).toBe(firstCollection)

    command.drawing = { id: 'stale-constructor-value' }
    editor.activeCollection = secondCollection
    expect(command.drawing).toBe(secondCollection)

    editor.activeCollection = null
    expect(command.drawing).toBe(drawing)

    command.updatedOutliner()
    expect(dispatch).toHaveBeenCalledOnce()
  })
})

describe('Collection document state', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
    registerWindow(window, document)
  })

  test('manages collection lifecycle, active state, visibility, and locking', () => {
    localStorage.setItem('nanquim-preferences', JSON.stringify({ defaultStrokeWidth: 0.35 }))
    const editor = createEditor()

    initCollections(editor)

    const first = editor.activeCollection
    const firstId = first.attr('id')
    expect(editor.collections.size).toBe(1)
    expect(first.attr('name')).toBe('Collection 1')
    expect(first.attr('data-collection')).toBe('true')
    expect(first.css('stroke')).toBe('white')
    expect(first.css('stroke-width')).toBe('0.35')

    const second = createCollection(editor, 'Details')
    const secondId = second.attr('id')
    expect(editor.activeCollection).toBe(second)

    setActiveCollection(editor, firstId)
    expect(editor.activeCollection).toBe(first)
    setActiveCollection(editor, 'missing')
    expect(editor.activeCollection).toBe(first)

    toggleVisibility(editor, firstId)
    expect(editor.collections.get(firstId).visible).toBe(false)
    expect(first.css('display')).toBe('none')
    toggleVisibility(editor, firstId)
    expect(editor.collections.get(firstId).visible).toBe(true)
    expect(first.css('display')).not.toBe('none')

    toggleLock(editor, firstId)
    expect(editor.collections.get(firstId).locked).toBe(true)
    expect(first.attr('data-locked')).toBe('true')
    toggleLock(editor, firstId)
    expect(editor.collections.get(firstId).locked).toBe(false)
    expect(first.attr('data-locked')).toBe('false')

    deleteCollection(editor, firstId)
    expect(first.node.isConnected).toBe(false)
    expect(editor.activeCollection).toBe(second)

    deleteCollection(editor, secondId)
    expect(editor.collections.size).toBe(1)
    expect(editor.activeCollection.attr('name')).toBe('Default')
    expect(editor.signals.updatedCollections.dispatch).toHaveBeenCalled()
    expect(editor.signals.updatedOutliner.dispatch).toHaveBeenCalled()
  })

  test('propagates collection styles while preserving explicit overrides', () => {
    const editor = createEditor()
    initCollections(editor)
    const collection = editor.activeCollection
    const collectionId = collection.attr('id')
    const nested = collection.group().attr('id', 'nested')
    const normal = nested.rect(10, 10).attr('id', 'normal')
    const overridden = nested.circle(10).attr('id', 'overridden')

    overridden.css('stroke', 'orange')
    setElementOverrides(overridden, {
      fill: false,
      opacity: 0,
      stroke: true,
    })

    expect(getElementOverrides(overridden)).toEqual({ stroke: true })

    setCollectionStyle(editor, collectionId, {
      fill: 'royalblue',
      stroke: 'crimson',
      'stroke-width': 2,
    })

    expect(collection.css('fill')).toBe('royalblue')
    expect(nested.css('stroke')).toBe('crimson')
    expect(normal.css('stroke')).toBe('crimson')
    expect(normal.css('fill')).toBe('royalblue')
    expect(overridden.css('stroke')).toBe('orange')
    expect(overridden.css('fill')).toBe('royalblue')

    normal.attr('data-style-overrides', '{invalid json')
    expect(getElementOverrides(normal)).toEqual({})

    setElementOverrides(overridden, { stroke: false })
    expect(overridden.attr('data-style-overrides')).not.toBe('true')
    expect(getElementOverrides(overridden)).toEqual({})
  })

  test('applies inherited styles to nested groups without erasing child overrides', () => {
    const editor = createEditor()
    initCollections(editor)
    const collection = editor.activeCollection
    const nested = collection.group().attr('id', 'nested')
    const inheritingChild = nested.rect(10, 10).attr('id', 'inheriting')
    const overriddenChild = nested.circle(10).attr('id', 'overridden')

    editor.collections.get(collection.attr('id')).style = {
      fill: 'gold',
      stroke: 'navy',
    }
    inheritingChild.css('fill', 'pink')
    inheritingChild.css('stroke', 'lime')
    overriddenChild.css('fill', 'purple')
    setElementOverrides(overriddenChild, { fill: true })

    applyCollectionStyleToElement(editor, nested)

    expect(nested.css('fill')).toBe('gold')
    expect(nested.css('stroke')).toBe('navy')
    expect(inheritingChild.node.style.getPropertyValue('fill')).toBe('')
    expect(inheritingChild.node.style.getPropertyValue('stroke')).toBe('')
    expect(overriddenChild.css('fill')).toBe('purple')

    const detached = editor.svg.rect(5, 5)
    detached.css('stroke', 'black')
    applyCollectionStyleToElement(editor, detached)
    expect(detached.css('stroke')).toBe('black')
  })

  test('filters drawable, selectable, and snapping geometry by document state', () => {
    const editor = createEditor()
    initCollections(editor)
    const visible = editor.activeCollection

    const base = visible.rect(10, 10).attr('id', 'base')
    const nested = visible.group().attr('id', 'nested')
    const nestedLeaf = nested.circle(10).attr('id', 'nested-leaf')
    const hiddenLeaf = visible.line(0, 0, 5, 5).attr({ id: 'hidden-leaf', 'data-hidden': 'true' })
    const lockedLeaf = visible.line(0, 0, 6, 6).attr({ id: 'locked-leaf', 'data-locked': 'true' })
    const sourceLeaf = visible.line(0, 0, 7, 7).attr({ id: 'source-leaf', 'data-gn-source': 'true' })

    const hiddenCollection = createCollection(editor, 'Hidden')
    const hiddenCollectionLeaf = hiddenCollection.rect(4, 4).attr('id', 'hidden-collection-leaf')
    toggleVisibility(editor, hiddenCollection.attr('id'))

    const lockedCollection = createCollection(editor, 'Locked')
    const lockedCollectionLeaf = lockedCollection.rect(3, 3).attr('id', 'locked-collection-leaf')
    toggleLock(editor, lockedCollection.attr('id'))

    const paperAnnotations = editor.svg.group().attr({
      id: 'paper-annotations',
      'data-collection': 'true',
      'data-nanquim-paper-annotations': 'true',
    })
    const paperLeaf = paperAnnotations.line(0, 0, 6, 6).attr('id', 'paper-leaf')
    editor.paperAnnotations = paperAnnotations
    editor.collections.set('paper-annotations', {
      group: paperAnnotations,
      locked: false,
      visible: true,
    })

    expect(elementIds(getDrawableElements(editor))).toEqual([
      'base',
      'locked-collection-leaf',
      'locked-leaf',
      'nested-leaf',
      'source-leaf',
    ])
    expect(elementIds(getSelectableElements(editor))).toEqual([
      'base',
      'nested-leaf',
      'source-leaf',
    ])
    expect(elementIds(getAllDrawingElements(editor))).toEqual([
      'base',
      'hidden-collection-leaf',
      'locked-collection-leaf',
      'locked-leaf',
      'nested-leaf',
    ])

    expect(isElementHidden(editor, base)).toBe(false)
    expect(isElementHidden(editor, hiddenLeaf)).toBe(true)
    expect(isElementHidden(editor, hiddenCollectionLeaf)).toBe(true)
    expect(isElementLocked(editor, base)).toBe(false)
    expect(isElementLocked(editor, lockedLeaf)).toBe(true)
    expect(isElementLocked(editor, lockedCollectionLeaf)).toBe(true)

    expect(nestedLeaf.parent()).toBe(nested)
    expect(sourceLeaf.attr('data-gn-source')).toBe('true')
    expect(paperLeaf.parent()).toBe(paperAnnotations)
  })

  test('includes paper geometry and limits block editing to the edit group', () => {
    const editor = createEditor()
    initCollections(editor)
    editor.activeCollection.rect(10, 10).attr('id', 'model-element')
    editor.mode = 'paper'
    editor.paperViewportsGroup = editor.svg.group()
    const paperViewport = editor.paperViewportsGroup.group().attr('data-paper-viewport', 'true')
    paperViewport.rect(10, 10).attr('id', 'viewport-element')
    editor.paperAnnotations = editor.svg.group().attr('id', 'paper-annotations')
    editor.paperAnnotations.circle(5).attr('id', 'annotation-element')
    const annotationsState = {
      group: editor.paperAnnotations,
      locked: false,
      visible: true,
    }
    editor.collections.set('paper-annotations', annotationsState)

    expect(elementIds(getSelectableElements(editor))).toEqual([
      'annotation-element',
      'viewport-element',
    ])
    expect(elementIds(getAllDrawingElements(editor))).toEqual([
      'annotation-element',
      'viewport-element',
    ])

    annotationsState.locked = true
    expect(elementIds(getSelectableElements(editor))).toEqual(['viewport-element'])
    expect(elementIds(getAllDrawingElements(editor))).toEqual([
      'annotation-element',
      'viewport-element',
    ])

    annotationsState.locked = false
    annotationsState.visible = false
    expect(elementIds(getSelectableElements(editor))).toEqual(['viewport-element'])
    expect(elementIds(getAllDrawingElements(editor))).toEqual(['viewport-element'])

    annotationsState.visible = true
    paperViewport.attr('data-locked', 'true')
    expect(elementIds(getSelectableElements(editor))).toEqual(['annotation-element'])
    expect(elementIds(getAllDrawingElements(editor))).toEqual([
      'annotation-element',
      'viewport-element',
    ])

    paperViewport.attr({ 'data-hidden': 'true', 'data-locked': null })
    expect(elementIds(getSelectableElements(editor))).toEqual(['annotation-element'])
    expect(elementIds(getAllDrawingElements(editor))).toEqual(['annotation-element'])
    paperViewport.attr('data-hidden', null)

    editor.mode = 'model'
    expect(elementIds(getSelectableElements(editor))).toEqual(['model-element'])
    editor.mode = 'paper'

    const editGroup = editor.svg.group()
    editGroup.rect(3, 3).attr('id', 'edit-element')
    editGroup.rect(3, 3).attr({ id: 'hidden-edit-element', 'data-hidden': 'true' })
    editor.editingBlock = { editGroup }

    expect(elementIds(getSelectableElements(editor))).toEqual(['edit-element'])
  })

  test('resolves grouped selection, paper viewports, and derived geometry ancestors', () => {
    const editor = createEditor()
    initCollections(editor)
    const outer = editor.activeCollection.group().attr({ id: 'outer', 'data-group': 'true' })
    const inner = outer.group().attr({ id: 'inner', 'data-group': 'true' })
    const leaf = inner.rect(10, 10).attr('id', 'leaf')

    expect(findSelectableAncestor(leaf)).toBe(outer)
    expect(isDerivedGeometry(leaf)).toBe(false)

    inner.attr('data-gn-derived', 'true')
    expect(isDerivedGeometry(leaf)).toBe(true)
    inner.attr('data-gn-derived', null)
    outer.attr('data-gn-output', 'true')
    expect(isDerivedGeometry(leaf)).toBe(true)

    const viewport = editor.svg.group().attr('data-paper-viewport', 'true')
    const viewportGroup = viewport.group().attr('data-group', 'true')
    const viewportLeaf = viewportGroup.circle(5)
    expect(findSelectableAncestor(viewportLeaf)).toBe(viewport)

    const ungrouped = editor.activeCollection.circle(5)
    expect(findSelectableAncestor(ungrouped)).toBe(ungrouped)
  })

  test('toggles individual element state and migrates orphan geometry', () => {
    const editor = createEditor()
    initCollections(editor)
    const element = editor.activeCollection.rect(10, 10)
    const other = editor.activeCollection.circle(5)
    editor.selected = [element, other]

    toggleElementVisibility(editor, element)
    expect(element.attr('data-hidden')).toBe('true')
    expect(element.css('display')).toBe('none')
    expect(editor.selected).toEqual([other])

    toggleElementVisibility(editor, element)
    expect(element.attr('data-hidden')).not.toBe('true')
    expect(element.css('display')).not.toBe('none')

    editor.selected = [element, other]
    toggleElementLock(editor, element)
    expect(element.attr('data-locked')).toBe('true')
    expect(editor.selected).toEqual([other])
    toggleElementLock(editor, element)
    expect(element.attr('data-locked')).not.toBe('true')

    const orphan = editor.drawing.rect(6, 6).attr('id', 'orphan')
    migrateOrphanElements(editor)
    expect(orphan.parent()).toBe(editor.activeCollection)
    expect(editor.signals.updatedOutliner.dispatch).toHaveBeenCalled()
  })

  test('rebuilds collection metadata from loaded SVG groups', () => {
    const editor = createEditor()
    const loaded = editor.drawing.group().attr({
      id: 'loaded-collection',
      'data-collection': 'true',
      'data-locked': 'true',
      opacity: 0.4,
    })
    loaded.css('fill', 'beige')
    loaded.css('stroke', 'teal')
    loaded.css('stroke-linecap', 'square')
    loaded.css('stroke-width', 0.75)
    loaded.css('opacity', 0.4)
    loaded.hide()
    editor.collections.set('stale', { group: null })

    rebuildCollectionsFromDOM(editor)

    const data = editor.collections.get('loaded-collection')
    expect(editor.collections.size).toBe(1)
    expect(editor.activeCollection).toBe(loaded)
    expect(data.visible).toBe(false)
    expect(data.locked).toBe(true)
    expect(data.style).toEqual({
      fill: 'beige',
      opacity: 0.4,
      stroke: 'teal',
      'stroke-linecap': 'square',
      'stroke-width': 0.75,
    })

    const next = createCollection(editor, 'After Load')
    expect(next.attr('id')).toBe('collection-2')
    expect(editor.signals.updatedCollections.dispatch).toHaveBeenCalled()
    expect(editor.signals.updatedOutliner.dispatch).toHaveBeenCalled()
  })
})
