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
    updatedSelection: new TestSignal(),
    zoomChanged: new TestSignal(),
  }
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
    mode: 'paper',
    paperAnnotations: annotations,
    paperViewports: [],
    selected: [],
    signals,
    svg,
  }

  return { annotationState, annotations, editor }
}

describe('Paper annotation Outliner controls', () => {
  beforeEach(() => {
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
})
