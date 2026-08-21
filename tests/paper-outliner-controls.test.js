// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

class TestSignal {
  constructor() {
    this.listeners = []
  }

  add(listener) {
    this.listeners.push(listener)
  }

  dispatch(...args) {
    this.listeners.slice().forEach(listener => listener(...args))
  }
}

function createEditor() {
  const svg = SVG().addTo(document.body)
  const drawing = svg.group().attr('id', 'Collection')
  const modelCollection = drawing.group().attr({
    id: 'collection-1',
    name: 'Model',
    'data-collection': 'true',
  })
  const annotations = svg.group().attr({
    id: 'paper-annotations',
    name: 'Annotations',
    'data-collection': 'true',
    'data-locked': 'true',
    'data-nanquim-paper-annotations': 'true',
  })
  annotations.line(1, 2, 3, 2)

  const signals = {
    clearSelection: new TestSignal(),
    paperViewportsChanged: new TestSignal(),
    preferencesChanged: new TestSignal(),
    refreshHandlers: new TestSignal(),
    toogledSelect: new TestSignal(),
    updatedCollections: new TestSignal(),
    updatedOutliner: new TestSignal(),
    updatedProperties: new TestSignal(),
    updatedSelection: new TestSignal(),
    zoomChanged: new TestSignal(),
  }
  const handlers = svg.group().attr('id', 'Handlers')
  const viewportGroup = svg.group().attr({
    'data-paper-viewport': 'true',
    'data-vp-id': 'vp-1',
    id: 'vp-1-group',
  })
  const viewport = {
    _group: viewportGroup,
    id: 'vp-1',
    locked: false,
    scale: 100,
    visible: true,
  }
  viewportGroup._paperVp = viewport
  viewport.setVisible = vi.fn((visible) => {
    const nextVisible = visible !== false
    if (viewport.visible === nextVisible) return false
    viewport.visible = nextVisible
    viewportGroup.attr('data-hidden', nextVisible ? null : 'true')
    signals.paperViewportsChanged.dispatch()
    return true
  })
  viewport.setLocked = vi.fn((locked) => {
    const nextLocked = locked === true
    if (viewport.locked === nextLocked) return false
    viewport.locked = nextLocked
    viewportGroup.attr('data-locked', nextLocked ? 'true' : null)
    signals.paperViewportsChanged.dispatch()
    return true
  })
  const annotationState = {
    collapsed: false,
    group: annotations,
    locked: true,
    style: {},
    visible: true,
  }
  const editor = {
    activeCollection: annotations,
    collections: new Map([
      ['collection-1', {
        group: modelCollection,
        locked: false,
        visible: true,
      }],
      ['paper-annotations', annotationState],
    ]),
    documentState: { markChanged: vi.fn() },
    drawing,
    handlers,
    mode: 'paper',
    paperAnnotations: annotations,
    paperViewports: [viewport],
    selected: [],
    signals,
    suppressHandlers: true,
    svg,
  }

  return { annotationState, annotations, editor, viewport }
}

describe('Paper annotation Outliner controls', () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = '<div id="drawing-tree"></div>'
    registerWindow(window, document)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  test('unlocks and reveals persisted annotations with accessible controls', async () => {
    const { annotationState, annotations, editor } = createEditor()
    const { Outliner } = await import('../src/js/Outliner.js')
    new Outliner(editor)
    editor.signals.updatedOutliner.dispatch()

    const lockControl = document.querySelector('[data-paper-annotations-action="lock"]')
    expect(lockControl).not.toBeNull()
    expect(lockControl).toBeInstanceOf(HTMLButtonElement)
    expect(lockControl.type).toBe('button')
    expect(lockControl.getAttribute('aria-label')).toBe('Unlock annotations')
    expect(lockControl.tabIndex).toBe(0)
    lockControl.focus()
    expect(document.activeElement).toBe(lockControl)

    lockControl.click()

    expect(annotationState.locked).toBe(false)
    expect(annotations.attr('data-locked')).toBe('false')
    expect(editor.documentState.markChanged).toHaveBeenCalledWith('collection-lock-changed')
    expect(document.querySelector('[data-paper-annotations-action="lock"]')?.getAttribute('aria-label'))
      .toBe('Lock annotations')

    const visibilityControl = document.querySelector('[data-paper-annotations-action="visibility"]')
    expect(visibilityControl).toBeInstanceOf(HTMLButtonElement)
    expect(visibilityControl.type).toBe('button')
    expect(visibilityControl?.getAttribute('aria-label')).toBe('Hide annotations')
    visibilityControl.click()

    expect(annotationState.visible).toBe(false)
    expect(annotations.css('display')).toBe('none')
    expect(document.querySelector('[data-paper-annotations-action="visibility"]')?.getAttribute('aria-label'))
      .toBe('Show annotations')
  })

  test('hides a selected viewport once and restores keyboard focus to its control', async () => {
    const { editor, viewport } = createEditor()
    const clearSelection = vi.spyOn(editor.signals.clearSelection, 'dispatch')
    const viewportChanges = vi.spyOn(editor.signals.paperViewportsChanged, 'dispatch')
    const selectionChanges = vi.spyOn(editor.signals.updatedSelection, 'dispatch')
    const { Outliner } = await import('../src/js/Outliner.js')
    new Outliner(editor)
    editor.signals.updatedOutliner.dispatch()

    const visibility = document.querySelector(
      '[data-paper-viewport-id="vp-1"][data-paper-viewport-action="visibility"]',
    )
    expect(visibility).toBeInstanceOf(HTMLButtonElement)
    expect(visibility.type).toBe('button')
    expect(visibility.title).toBe('Hide viewport vp-1')
    expect(visibility.getAttribute('aria-label')).toBe('Hide viewport vp-1')
    expect(visibility.getAttribute('aria-pressed')).toBe('true')

    editor.selected = [{ _paperVp: viewport }]
    editor.handlers.rect(1, 1).addClass('selection-handler')
    visibility.focus()
    visibility.click()

    expect(viewport.setVisible).toHaveBeenCalledOnce()
    expect(viewport.setVisible).toHaveBeenCalledWith(false)
    expect(viewport.visible).toBe(false)
    expect(editor.selected).toEqual([])
    expect(editor.handlers.children()).toHaveLength(0)
    expect(clearSelection).toHaveBeenCalledOnce()
    expect(selectionChanges).toHaveBeenCalledOnce()
    expect(viewportChanges).toHaveBeenCalledOnce()

    const show = document.querySelector(
      '[data-paper-viewport-id="vp-1"][data-paper-viewport-action="visibility"]',
    )
    expect(show.title).toBe('Show viewport vp-1')
    expect(show.getAttribute('aria-label')).toBe('Show viewport vp-1')
    expect(show.getAttribute('aria-pressed')).toBe('false')
    expect(show.classList.contains('icon-off')).toBe(true)
    expect(show.closest('li').classList.contains('collection-hidden-row')).toBe(true)
    expect(document.activeElement).toBe(show)

    show.click()
    expect(viewport.setVisible).toHaveBeenLastCalledWith(true)
    expect(clearSelection).toHaveBeenCalledOnce()
    expect(viewportChanges).toHaveBeenCalledTimes(2)
  })

  test('locks a selected viewport once and exposes the durable lock state', async () => {
    const { editor, viewport } = createEditor()
    const clearSelection = vi.spyOn(editor.signals.clearSelection, 'dispatch')
    const viewportChanges = vi.spyOn(editor.signals.paperViewportsChanged, 'dispatch')
    const { Outliner } = await import('../src/js/Outliner.js')
    new Outliner(editor)
    editor.signals.updatedOutliner.dispatch()

    const lock = document.querySelector(
      '[data-paper-viewport-id="vp-1"][data-paper-viewport-action="lock"]',
    )
    expect(lock).toBeInstanceOf(HTMLButtonElement)
    expect(lock.type).toBe('button')
    expect(lock.title).toBe('Lock viewport vp-1')
    expect(lock.getAttribute('aria-label')).toBe('Lock viewport vp-1')
    expect(lock.getAttribute('aria-pressed')).toBe('false')

    editor.selected = [viewport._group]
    lock.focus()
    lock.click()

    expect(viewport.setLocked).toHaveBeenCalledOnce()
    expect(viewport.setLocked).toHaveBeenCalledWith(true)
    expect(viewport.locked).toBe(true)
    expect(editor.selected).toEqual([])
    expect(clearSelection).toHaveBeenCalledOnce()
    expect(viewportChanges).toHaveBeenCalledOnce()

    const unlock = document.querySelector(
      '[data-paper-viewport-id="vp-1"][data-paper-viewport-action="lock"]',
    )
    expect(unlock.title).toBe('Unlock viewport vp-1')
    expect(unlock.getAttribute('aria-label')).toBe('Unlock viewport vp-1')
    expect(unlock.getAttribute('aria-pressed')).toBe('true')
    expect(unlock.classList.contains('icon-on')).toBe(true)
    expect(unlock.closest('li').classList.contains('collection-locked-row')).toBe(true)
    expect(document.activeElement).toBe(unlock)

    unlock.click()
    expect(viewport.setLocked).toHaveBeenLastCalledWith(false)
    expect(clearSelection).toHaveBeenCalledOnce()
    expect(viewportChanges).toHaveBeenCalledTimes(2)
  })
})
