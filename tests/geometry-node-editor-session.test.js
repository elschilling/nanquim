// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'

import { GeometryNodeEditor } from '../src/js/GeometryNodeEditor.js'

describe('GeometryNodeEditor document-session cleanup', () => {
  test('drops closure-owned interactions before a replacement document can receive pointer events', () => {
    document.body.innerHTML = `
      <div class="geometry-nodes-host is-geometry-nodes-open">
        <section id="geometry-nodes-dock" class="is-open is-collapsed" aria-hidden="false">
          <button id="geometry-nodes-resize" class="is-resizing"></button>
          <div id="geometry-nodes-stage" class="is-panning"></div>
          <div id="geometry-nodes-nodes">
            <div class="is-wire-insert-target"></div>
          </div>
          <svg id="geometry-nodes-wires"></svg>
        </section>
      </div>
    `

    const activeEditorChanged = { dispatch: vi.fn() }
    const instance = Object.create(GeometryNodeEditor.prototype)
    Object.assign(instance, {
      editor: {
        activeEditor: 'geometry-nodes',
        signals: { activeEditorChanged },
      },
      root: document.getElementById('geometry-nodes-dock'),
      host: document.querySelector('.geometry-nodes-host'),
      stage: document.getElementById('geometry-nodes-stage'),
      resizer: document.getElementById('geometry-nodes-resize'),
      nodesLayer: document.getElementById('geometry-nodes-nodes'),
      wiresLayer: document.getElementById('geometry-nodes-wires'),
      selectedNodes: new Set(['old-node']),
      selectedLinks: new Set(['old-link']),
      dragState: { pointerId: 1 },
      panState: { pointerId: 2 },
      resizeState: { pointerId: 3 },
      connecting: { pointerId: null, element: document.createElement('div') },
      spaceDown: true,
      graphId: 'old-graph',
      pan: { x: 500, y: 600 },
      zoom: 2,
      _views: new Map([['old-graph', { x: 500, y: 600, zoom: 2 }]]),
    })
    instance._activeInstance = vi.fn(() => null)
    instance._cancelAutoLayoutAnimation = vi.fn()
    instance._cancelConnection = vi.fn(() => { instance.connecting = null })
    instance._closePalette = vi.fn()
    instance._clearWireInsertionPreview = vi.fn()
    instance.render = vi.fn()

    instance._resetDocumentSession()

    expect(instance.dragState).toBeNull()
    expect(instance.panState).toBeNull()
    expect(instance.resizeState).toBeNull()
    expect(instance.connecting).toBeNull()
    expect(instance.spaceDown).toBe(false)
    expect(instance.selectedNodes.size).toBe(0)
    expect(instance.selectedLinks.size).toBe(0)
    expect(instance.graphId).toBeNull()
    expect(instance._views.size).toBe(0)
    expect(instance.pan).toEqual({ x: 80, y: 42 })
    expect(instance.zoom).toBe(1)
    expect(instance.root.classList.contains('is-open')).toBe(false)
    expect(instance.root.getAttribute('aria-hidden')).toBe('true')
    expect(instance.host.classList.contains('is-geometry-nodes-open')).toBe(false)
    expect(instance.editor.activeEditor).toBe('canvas')
    expect(activeEditorChanged.dispatch).toHaveBeenCalledWith('canvas')
    expect(instance.render).toHaveBeenCalledOnce()
  })

  test('hydrates graph.view and cannot reuse a same-id view from the previous document', () => {
    const graphId = 'shared-graph-id'
    let graph = { id: graphId, view: { x: 12, y: -7, zoom: 1.25 } }
    const instance = Object.create(GeometryNodeEditor.prototype)
    Object.assign(instance, {
      editor: {
        activeEditor: 'canvas',
        geometryNodes: { getGraph: vi.fn(() => graph) },
        signals: {},
      },
      graphId,
      pan: { x: 900, y: 800 },
      zoom: 2.5,
      _views: new Map([[graphId, { x: 900, y: 800, zoom: 2.5 }]]),
      selectedNodes: new Set(),
      selectedLinks: new Set(),
      dragState: null,
      panState: null,
      resizeState: null,
      spaceDown: false,
    })
    instance._applyTransform = vi.fn()
    instance._cancelAutoLayoutAnimation = vi.fn()
    instance._cancelConnection = vi.fn()
    instance._closePalette = vi.fn()
    instance._clearWireInsertionPreview = vi.fn()
    instance.render = vi.fn()

    instance._loadRememberedView()
    expect(instance.pan).toEqual({ x: 12, y: -7 })
    expect(instance.zoom).toBe(1.25)

    instance._resetDocumentSession()
    expect(instance._views.size).toBe(0)
    expect(instance.graphId).toBeNull()

    graph = { id: graphId, view: { x: -40, y: 31, zoom: 0.75 } }
    instance.graphId = graphId
    instance._loadRememberedView()
    expect(instance.pan).toEqual({ x: -40, y: 31 })
    expect(instance.zoom).toBe(0.75)
  })

  test('persists the latest graph pan during the gesture after its first meaningful move', () => {
    const setGraphView = vi.fn(() => true)
    const instance = Object.create(GeometryNodeEditor.prototype)
    Object.assign(instance, {
      editor: {
        geometryNodes: { setGraphView },
      },
      graphId: 'graph-pan',
      pan: { x: 80, y: 42 },
      zoom: 1,
      panState: {
        pointerId: 7,
        startX: 10,
        startY: 20,
        panX: 80,
        panY: 42,
        moved: false,
      },
    })
    instance._applyTransform = vi.fn()

    instance._updatePan({ pointerId: 7, clientX: 11, clientY: 21 })
    expect(setGraphView).not.toHaveBeenCalled()

    instance._updatePan({ pointerId: 7, clientX: 14, clientY: 23 })
    expect(setGraphView).toHaveBeenLastCalledWith('graph-pan', { x: 84, y: 45, zoom: 1 })

    instance._updatePan({ pointerId: 7, clientX: 18, clientY: 26 })
    expect(setGraphView).toHaveBeenLastCalledWith('graph-pan', { x: 88, y: 48, zoom: 1 })
    expect(instance._views.get('graph-pan')).toEqual({ x: 88, y: 48, zoom: 1 })
  })
})
