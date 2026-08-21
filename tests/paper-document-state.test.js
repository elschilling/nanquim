// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

import { PaperEditor } from '../src/js/PaperEditor.js'
import { DocumentState } from '../src/js/document/DocumentState.js'
import { buildPaperSVGString } from '../src/js/utils/ExportPaper.js'

class TestSignal {
  constructor() {
    this.listeners = []
    this.dispatch = vi.fn((...args) => {
      this.listeners.slice().forEach(listener => listener(...args))
    })
  }

  add(listener) {
    this.listeners.push(listener)
  }
}

function createSignals() {
  return {
    colorMapUpdated: new TestSignal(),
    documentStateChanged: new TestSignal(),
    editorModeChanged: new TestSignal(),
    modelContentChanged: new TestSignal(),
    paperViewportsChanged: new TestSignal(),
    updatedCollections: new TestSignal(),
    updatedOutliner: new TestSignal(),
    updatedProperties: new TestSignal(),
    updatedSelection: new TestSignal(),
  }
}

function createFixture({ observe = false } = {}) {
  document.body.innerHTML = '<div id="canvas"><div class="terminal"></div></div>'
  const canvas = document.getElementById('canvas')
  const svg = SVG().addTo(canvas)
  const drawing = svg.group().attr('id', 'Collection')
  const modelCollection = drawing.group().attr({
    id: 'collection-1',
    name: 'Model',
    'data-collection': 'true',
  })
  const modelHandlers = svg.group().attr('id', 'Handlers')
  const signals = createSignals()
  const editor = {
    activeCollection: modelCollection,
    canvas,
    collections: new Map([
      ['collection-1', {
        group: modelCollection,
        visible: true,
        locked: false,
        style: { stroke: 'white', fill: 'transparent' },
      }],
    ]),
    drawing,
    handlers: modelHandlers,
    isDrawing: false,
    mode: 'model',
    modelHandlers,
    paperConfig: {
      size: 'A4',
      width: 210,
      height: 297,
      orientation: 'portrait',
      unitsPerCm: 1,
      colorMap: {},
    },
    selected: [],
    spatialIndex: { markDirty: vi.fn() },
    fullSpatialIndex: { markDirty: vi.fn() },
    signals,
    svg,
  }
  editor.documentState = new DocumentState(editor, { observe })
  editor.paperEditor = new PaperEditor(editor)
  return { editor, modelCollection, modelHandlers, paperEditor: editor.paperEditor }
}

function annotationSource(markup) {
  return new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
}

describe('Paper document state', () => {
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

  test('ensures hidden Paper infrastructure without switching editor state', () => {
    const { editor, modelCollection, modelHandlers, paperEditor } = createFixture()

    const infrastructure = paperEditor.ensureDocumentInfrastructure()
    editor.documentState.flushObservedMutations()

    expect(editor.mode).toBe('model')
    expect(editor.svg.node.style.display).toBe('')
    expect(document.getElementById('paper-canvas').style.display).toBe('none')
    expect(editor.handlers).toBe(modelHandlers)
    expect(editor.activeCollection).toBe(modelCollection)
    expect(infrastructure.annotations).toBe(editor.paperAnnotations)
    expect(editor.collections.get('paper-annotations').group).toBe(editor.paperAnnotations)
    expect(editor.documentState.revision).toBe(0)

    editor.collections.get('paper-annotations').locked = true
    editor.signals.updatedCollections.dispatch()

    editor.collections.clear()
    editor.signals.updatedCollections.dispatch()
    expect(editor.collections.get('paper-annotations')).toMatchObject({
      group: editor.paperAnnotations,
      locked: true,
    })
  })

  test('destroys Paper infrastructure completely for transactional rollback', () => {
    const { editor, modelCollection, modelHandlers, paperEditor } = createFixture()
    paperEditor.ensureDocumentInfrastructure()
    const viewport = paperEditor.createViewport(1, 2, 3, 4, 50, { silent: true })
    const staleCanvas = document.getElementById('paper-canvas')
    const partialGroup = editor.paperSvg.group().attr('data-partial-viewport', 'true')
    editor.paperSvg.defs().clip().attr('data-partial-viewport-clip', 'true')
    const revision = editor.documentState.revision

    expect(paperEditor.destroyDocumentInfrastructure({ silent: true, notify: false })).toBe(true)

    expect(staleCanvas.isConnected).toBe(false)
    expect(partialGroup.node.isConnected).toBe(false)
    expect(viewport._group.node.isConnected).toBe(false)
    expect(document.getElementById('paper-canvas')).toBeNull()
    expect(editor.paperSvg).toBeUndefined()
    expect(editor.paperAnnotations).toBeUndefined()
    expect(editor.paperViewportsGroup).toBeUndefined()
    expect(editor.paperViewports).toBeUndefined()
    expect(editor.collections.has('paper-annotations')).toBe(false)
    expect(editor.activeCollection).toBe(modelCollection)
    expect(editor.handlers).toBe(modelHandlers)
    expect(editor.documentState.revision).toBe(revision)
    expect(paperEditor.destroyDocumentInfrastructure({ silent: true, notify: false })).toBe(false)

    paperEditor.ensureDocumentInfrastructure()
    const recreated = paperEditor.createViewport(2, 3, 4, 5, 100, { silent: true })
    expect(recreated.id).toBe('vp-1')
    expect(editor.collections.get('paper-annotations').group).toBe(editor.paperAnnotations)
  })

  test('tracks persisted color-map and geometry changes but not live Paper paint', async () => {
    const { editor, modelCollection, paperEditor } = createFixture({ observe: true })
    const colorContext = {
      _fillStyle: '#000000',
      get fillStyle() { return this._fillStyle },
      set fillStyle(value) {
        const source = String(value).toLowerCase().replaceAll(' ', '')
        this._fillStyle = ({
          white: '#ffffff',
          'rgb(0,0,0)': '#000000',
        })[source] || source
      },
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(colorContext)
    let colorLine
    editor.documentState.runWithoutTracking(() => {
      colorLine = modelCollection.line(0, 0, 5, 5).attr('stroke', '#ffffff')
      editor.paperConfig.colorMap.white = {
        printColor: 'rgb(0, 0, 0)',
        enabled: true,
      }
    })
    editor.documentState.replaceSession({ name: 'paper.svg', dirty: false })

    editor.mode = 'paper'
    paperEditor.activate()
    await Promise.resolve()
    editor.documentState.flushObservedMutations()
    expect(editor.documentState.isDirty).toBe(false)
    expect(colorLine.node.style.stroke).toBe('rgb(0, 0, 0)')

    editor.mode = 'model'
    paperEditor.deactivate()
    await Promise.resolve()
    editor.documentState.flushObservedMutations()
    expect(editor.documentState.isDirty).toBe(false)
    expect(colorLine.node.style.stroke).toBe('')

    editor.paperConfig.colorMap.white.enabled = false
    editor.signals.colorMapUpdated.dispatch()
    expect(editor.documentState.isDirty).toBe(true)

    editor.documentState.replaceSession({ name: 'paper.svg', dirty: false })
    editor.spatialIndex.markDirty.mockClear()
    editor.fullSpatialIndex.markDirty.mockClear()
    expect(paperEditor.setUnitsPerCm(2)).toBe(true)
    expect(editor.paperConfig.unitsPerCm).toBe(2)
    expect(editor.documentState.isDirty).toBe(true)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledOnce()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledOnce()
    expect(paperEditor.setUnitsPerCm(2)).toBe(false)
    expect(paperEditor.setUnitsPerCm(Number.POSITIVE_INFINITY)).toBe(false)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledOnce()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledOnce()

    editor.documentState.replaceSession({ name: 'paper.svg', dirty: false })
    const viewport = paperEditor.createViewport(1, 2, 3, 4, 50, { silent: true })
    editor.documentState.replaceSession({ name: 'paper.svg', dirty: false })
    expect(viewport.setGeometry({ x: 6, w: 8 })).toBe(true)
    expect(viewport).toMatchObject({ x: 6, y: 2, w: 8, h: 4 })
    expect(editor.documentState.isDirty).toBe(true)
    editor.documentState.disconnect()
  })

  test('keeps class and block paint sources stable through live preview and detached export', async () => {
    const { editor, modelCollection, paperEditor } = createFixture({ observe: true })
    const colorContext = {
      _fillStyle: '#000000',
      get fillStyle() { return this._fillStyle },
      set fillStyle(value) {
        const source = String(value).toLowerCase().replaceAll(' ', '')
        this._fillStyle = ({
          'rgb(17,34,51)': '#112233',
          'rgb(51,68,85)': '#334455',
          'rgb(68,85,102)': '#445566',
          'rgb(102,119,136)': '#667788',
        })[source] || source
      },
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(colorContext)

    let inheritedGroup
    let blockLine
    editor.documentState.runWithoutTracking(() => {
      const defs = editor.svg.defs().node
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
      style.textContent = [
        '.live-inherited-paint { stroke: rgb(17, 34, 51); fill: none; }',
        '.live-block-paint { stroke: rgb(68, 85, 102); fill: none; }',
      ].join('\n')
      defs.appendChild(style)
      const browserStyle = document.createElement('style')
      browserStyle.textContent = style.textContent
      document.body.appendChild(browserStyle)
      inheritedGroup = modelCollection.group().addClass('live-inherited-paint')
      inheritedGroup.line(0, 0, 5, 0).attr('id', 'live-inherited-line')
      const block = document.createElementNS('http://www.w3.org/2000/svg', 'symbol')
      block.setAttribute('id', 'live-class-block')
      block.setAttribute('data-block-def', 'true')
      blockLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      blockLine.setAttribute('id', 'live-class-block-line')
      blockLine.setAttribute('class', 'live-block-paint')
      blockLine.setAttribute('x2', '5')
      block.appendChild(blockLine)
      defs.appendChild(block)
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
      use.setAttribute('href', '#live-class-block')
      modelCollection.node.appendChild(use)
      editor.paperConfig.colorMap = {
        '#112233': { enabled: true, printColor: '#334455' },
        '#445566': { enabled: true, printColor: '#667788' },
      }
    })
    const sourceDrawingMarkup = editor.drawing.node.outerHTML
    const sourceDefinitionsMarkup = editor.svg.node.querySelector('defs').outerHTML
    editor.documentState.replaceSession({ name: 'paper.svg', dirty: false })

    expect(paperEditor.getUsedColors()).toEqual(expect.arrayContaining(['#112233', '#445566']))
    editor.mode = 'paper'
    paperEditor.activate()
    await Promise.resolve()
    editor.documentState.flushObservedMutations()

    expect(inheritedGroup.node.style.stroke.replaceAll(' ', '')).toBe('rgb(51,68,85)')
    expect(blockLine.style.stroke.replaceAll(' ', '')).toBe('rgb(102,119,136)')
    expect(paperEditor.getUsedColors()).toEqual(expect.arrayContaining(['#112233', '#445566']))
    expect(editor.documentState.isDirty).toBe(false)
    const activeMarkup = editor.svg.node.outerHTML

    const output = buildPaperSVGString(editor, editor.paperViewports)
    const parsed = new DOMParser().parseFromString(output, 'image/svg+xml')
    expect(parsed.querySelector('defs #Collection .live-inherited-paint').style.stroke.replaceAll(' ', ''))
      .toBe('rgb(51,68,85)')
    expect(parsed.querySelector('defs #live-class-block-line').style.stroke.replaceAll(' ', ''))
      .toBe('rgb(102,119,136)')
    expect(editor.svg.node.outerHTML).toBe(activeMarkup)
    expect(editor.documentState.isDirty).toBe(false)

    editor.mode = 'model'
    paperEditor.deactivate()
    await Promise.resolve()
    editor.documentState.flushObservedMutations()
    expect(editor.drawing.node.outerHTML).toBe(sourceDrawingMarkup)
    expect(editor.svg.node.querySelector('defs').outerHTML).toBe(sourceDefinitionsMarkup)
    expect(editor.documentState.isDirty).toBe(false)
    editor.documentState.disconnect()
  })

  test('rejects serializer-incompatible viewport bounds without dirtying', () => {
    const { editor, paperEditor } = createFixture()
    paperEditor.ensureDocumentInfrastructure()
    const viewport = paperEditor.createViewport(1, 2, 3, 4, 50, { silent: true })
    editor.documentState.replaceSession({ name: 'paper.svg', dirty: false })
    const original = {
      x: viewport.x,
      y: viewport.y,
      w: viewport.w,
      h: viewport.h,
    }

    for (const geometry of [
      { x: 1000000.000001 },
      { y: -1000000.000001 },
      { w: 1000000.000001 },
      { h: 0.0000001 },
    ]) {
      expect(viewport.setGeometry(geometry)).toBe(false)
      expect(viewport).toMatchObject(original)
      expect(editor.documentState.snapshot()).toMatchObject({ revision: 0, isDirty: false })
    }

    const count = editor.paperViewports.length
    expect(() => paperEditor.createViewport(1000001, 0, 1, 1, 1, { silent: true }))
      .toThrow(/viewport 2 x/i)
    expect(() => paperEditor.replaceDocumentState({
      annotations: null,
      viewports: [{
        id: 'too-wide',
        x: 0,
        y: 0,
        w: 1000001,
        h: 1,
        scale: 1,
        modelOriginX: 0,
        modelOriginY: 0,
      }],
    })).toThrow(/viewport 1 width/i)
    expect(editor.paperViewports).toHaveLength(count)
    expect(editor.documentState.snapshot()).toMatchObject({ revision: 0, isDirty: false })
  })

  test('destroying a viewport cancels an in-flight document-level pan without dirtying a new session', () => {
    const { editor, paperEditor } = createFixture()
    paperEditor.ensureDocumentInfrastructure()
    const viewport = paperEditor.createViewport(1, 2, 3, 4, 50, { silent: true })
    editor.mode = 'paper'
    editor.paperSvg.screenCTM = () => ({ a: 1, d: 1 })
    viewport.activate()

    viewport._frame.node.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 1,
      clientX: 10,
      clientY: 10,
    }))
    expect(viewport._panState).not.toBeNull()

    viewport.destroy()
    editor.documentState.replaceSession({ name: 'replacement.svg', dirty: false })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 25 }))
    document.dispatchEvent(new MouseEvent('mouseup'))

    expect(viewport._panState).toBeNull()
    expect(editor.documentState.isDirty).toBe(false)
  })

  test('dirties a viewport pan on its first move and invalidates an in-flight save token', () => {
    const { editor, paperEditor } = createFixture()
    paperEditor.ensureDocumentInfrastructure()
    const viewport = paperEditor.createViewport(1, 2, 3, 4, 50, { silent: true })
    editor.mode = 'paper'
    editor.paperSvg.screenCTM = () => ({ a: 1, d: 1 })
    viewport.activate()
    editor.documentState.replaceSession({ name: 'paper.svg', dirty: false })

    viewport._frame.node.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 1,
      clientX: 10,
      clientY: 10,
    }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 15 }))

    expect(viewport).toMatchObject({ modelOriginX: -500, modelOriginY: -250 })
    expect(editor.documentState.snapshot()).toMatchObject({ revision: 1, isDirty: true })
    const saveToken = editor.documentState.createSaveToken()

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 20 }))
    expect(editor.documentState.revision).toBe(2)
    expect(editor.documentState.markSaved(saveToken)).toBe(false)

    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(viewport._panState).toBeNull()
    expect(editor.documentState.revision).toBe(2)
    editor.documentState.disconnect()
  })

  test('replaces annotations and restores exact viewport state without dirtying a load', () => {
    const { editor, paperEditor } = createFixture()
    const annotations = annotationSource(`
      <g xmlns="http://www.w3.org/2000/svg"
        id="saved-paper"
        name="Notes &amp; labels"
        data-collection="true"
        data-locked="true"
        style="display:none;stroke:#c0ffee;stroke-width:0.25;fill:transparent">
        <text id="note">A &amp; B</text>
      </g>
    `)

    paperEditor.replaceDocumentState({
      annotations,
      viewports: [{
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
      }],
    }, { silent: true })
    editor.documentState.flushObservedMutations()

    expect(editor.documentState.revision).toBe(0)
    expect(editor.paperAnnotations.attr('id')).toBe('paper-annotations')
    expect(editor.paperAnnotations.attr('name')).toBe('Notes & labels')
    expect(editor.paperAnnotations.findOne('#note').text()).toBe('A & B')
    expect(editor.collections.get('paper-annotations')).toMatchObject({
      visible: false,
      locked: true,
    })
    expect(editor.paperAnnotations.attr('data-locked')).toBe('true')
    expect(editor.paperAnnotations.css('display')).toBe('none')
    expect(editor.collections.get('paper-annotations').style.stroke)
      .toBe(editor.paperAnnotations.css('stroke'))
    expect(editor.paperViewports).toHaveLength(1)
    expect(editor.paperViewports[0]).toMatchObject({
      id: 'vp-7',
      modelOriginX: -20,
      modelOriginY: 30,
      visible: false,
      locked: true,
    })
    expect(editor.paperViewports[0]._group.css('display')).toBe('none')
    expect(editor.paperViewports[0]._group.attr('data-hidden')).toBe('true')
    expect(editor.paperViewports[0]._group.attr('data-locked')).toBe('true')

    const next = paperEditor.createViewport(2, 3, 4, 5, 100)
    expect(next.id).toBe('vp-8')
    expect(editor.documentState.revision).toBe(1)
    expect(paperEditor.removeViewport(next.id)).toBe(true)
    expect(editor.documentState.revision).toBe(2)
    expect(paperEditor.removeViewport('missing')).toBe(false)
    expect(editor.documentState.revision).toBe(2)
  })

  test('marks each persisted Paper mutation once and supports silent restoration', () => {
    const { editor, paperEditor } = createFixture()

    paperEditor.replaceDocumentState({
      viewports: [{
        id: 'sheet-view',
        x: 1,
        y: 1,
        w: 10,
        h: 8,
        scale: 100,
        modelOriginX: 0,
        modelOriginY: 0,
        visible: true,
        locked: false,
      }],
    })
    expect(editor.documentState.revision).toBe(1)

    const viewport = editor.paperViewports[0]
    expect(viewport.setModelOrigin(10, 20)).toBe(true)
    expect(editor.documentState.revision).toBe(2)
    expect(viewport.setScale(25)).toBe(true)
    expect(editor.documentState.revision).toBe(3)
    expect(viewport.setVisible(false)).toBe(true)
    expect(editor.documentState.revision).toBe(4)
    expect(viewport.setLocked(true)).toBe(true)
    expect(editor.documentState.revision).toBe(5)

    expect(viewport.setLocked(true)).toBe(false)
    viewport.setModelOrigin(30, 40, { silent: true })
    expect(editor.documentState.revision).toBe(5)

    expect(paperEditor.setPaperSize('A3')).toBe(true)
    expect(editor.documentState.revision).toBe(6)
    expect(paperEditor.setPaperSize('A3')).toBe(false)
    expect(editor.documentState.revision).toBe(6)
    expect(paperEditor.setOrientation('landscape')).toBe(true)
    expect(editor.documentState.revision).toBe(7)

    paperEditor.resetDocumentState()
    editor.documentState.flushObservedMutations()
    expect(editor.documentState.revision).toBe(8)
    expect(editor.paperViewports).toEqual([])
    expect(editor.paperAnnotations.children().length).toBe(0)
    expect(editor.collections.get('paper-annotations')).toMatchObject({
      visible: true,
      locked: false,
    })
  })

  test('exports every ISO preset at its physical portrait and landscape size', () => {
    const { editor, paperEditor } = createFixture()
    const sizes = {
      A0: [841, 1189],
      A1: [594, 841],
      A2: [420, 594],
      A3: [297, 420],
      A4: [210, 297],
    }
    paperEditor.ensureDocumentInfrastructure()

    for (const unitsPerCm of [1, 2.5]) {
      paperEditor.setUnitsPerCm(unitsPerCm, { silent: true })
      for (const [size, [portraitWidth, portraitHeight]] of Object.entries(sizes)) {
        paperEditor.setOrientation('portrait', { silent: true })
        paperEditor.setPaperSize(size, undefined, undefined, { silent: true })
        for (const [orientation, width, height] of [
          ['portrait', portraitWidth, portraitHeight],
          ['landscape', portraitHeight, portraitWidth],
        ]) {
          paperEditor.setOrientation(orientation, { silent: true })
          const output = buildPaperSVGString(editor, editor.paperViewports)
          const root = new DOMParser().parseFromString(output, 'image/svg+xml').documentElement
          const viewBox = root.getAttribute('viewBox').split(/\s+/).map(Number)

          expect(root.getAttribute('width')).toBe(`${width}mm`)
          expect(root.getAttribute('height')).toBe(`${height}mm`)
          expect(viewBox.slice(0, 2)).toEqual([0, 0])
          expect(viewBox[2]).toBeCloseTo(width * unitsPerCm / 10, 10)
          expect(viewBox[3]).toBeCloseTo(height * unitsPerCm / 10, 10)
        }
      }
    }
  })

  test('centers new viewports with units-aware origins and rejects invalid custom sizes', () => {
    const { editor, paperEditor } = createFixture()
    editor.paperConfig.unitsPerCm = 2.5
    editor._drawingBBox = { x: 0, y: 0, width: 100, height: 60 }

    const viewport = paperEditor.createViewport(1, 1, 10, 8, 100, { silent: true })
    expect(viewport).toMatchObject({ modelOriginX: -150, modelOriginY: -130 })

    const viewportCount = editor.paperViewports.length
    expect(() => paperEditor.createViewport(1, 1, 10, 8, 0, { silent: true }))
      .toThrow(/scale/)
    expect(() => paperEditor.createViewport(1, 1, 10, 8, 100, {
      modelOriginX: 1000000001,
      modelOriginY: 0,
      silent: true,
    })).toThrow(/origin/)
    expect(editor.paperViewports).toHaveLength(viewportCount)

    const before = { ...editor.paperConfig }
    const revision = editor.documentState.revision
    expect(paperEditor.setPaperSize('custom', Number.POSITIVE_INFINITY, 297)).toBe(false)
    expect(paperEditor.setPaperSize('custom', 0.09, 297)).toBe(false)
    expect(paperEditor.setPaperSize('custom', 210, 10001)).toBe(false)
    expect(editor.paperConfig).toMatchObject(before)
    expect(editor.documentState.revision).toBe(revision)

    expect(paperEditor.setPaperSize('custom', 420.5, 297.25)).toBe(true)
    expect(editor.paperConfig).toMatchObject({
      size: 'custom',
      width: 420.5,
      height: 297.25,
    })
  })

  test('validates a replacement before changing the live Paper document', () => {
    const { editor, paperEditor } = createFixture()
    const existing = paperEditor.createViewport(1, 1, 4, 4, 100)
    const revision = editor.documentState.revision

    expect(() => paperEditor.replaceDocumentState({
      viewports: [
        {
          id: 'duplicate',
          x: 1,
          y: 1,
          w: 2,
          h: 2,
          scale: 100,
          modelOriginX: 0,
          modelOriginY: 0,
        },
        {
          id: 'duplicate',
          x: 2,
          y: 2,
          w: 2,
          h: 2,
          scale: 100,
          modelOriginX: 0,
          modelOriginY: 0,
        },
      ],
    })).toThrow(/duplicated/)

    expect(editor.paperViewports).toEqual([existing])
    expect(editor.documentState.revision).toBe(revision)
  })
})
