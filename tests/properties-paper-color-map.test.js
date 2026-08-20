// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

import { PaperEditor } from '../src/js/PaperEditor.js'
import { DocumentState } from '../src/js/document/DocumentState.js'

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

function createSignals() {
  return {
    clearSelection: new TestSignal(),
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

describe('Paper color translation properties', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="canvas"><div class="terminal"></div></div>
      <button id="tab-transform"></button>
      <button id="tab-style"></button>
      <div id="properties-panel"></div>
    `
    registerWindow(window, document)
    globalThis.SVG = SVG
  })

  afterEach(() => {
    delete globalThis.SVG
    document.body.replaceChildren()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  test('keeps identity fallbacks ephemeral until the user edits a mapping', async () => {
    const colorContext = {
      _fillStyle: '#000000',
      get fillStyle() { return this._fillStyle },
      set fillStyle(value) { this._fillStyle = String(value).toLowerCase() },
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(colorContext)

    const canvas = document.getElementById('canvas')
    const svg = SVG().addTo(canvas)
    const drawing = svg.group()
    const collection = drawing.group().attr({
      id: 'collection-1',
      'data-collection': 'true',
    })
    collection.css({ stroke: 'none', fill: 'none' })
    collection.line(0, 0, 5, 5).css({ stroke: '#ffffff', fill: 'none' })
    const signals = createSignals()
    const editor = {
      activeCollection: collection,
      canvas,
      collections: new Map(),
      drawing,
      geometryNodeEditor: {},
      mode: 'paper',
      paperConfig: {
        size: 'A4',
        width: 210,
        height: 297,
        orientation: 'portrait',
        unitsPerCm: 1,
        colorMap: {},
      },
      selected: [],
      signals,
      svg,
    }
    editor.documentState = new DocumentState(editor, { observe: false })
    editor.paperEditor = new PaperEditor(editor)
    editor.documentState.replaceSession({ name: 'paper.svg', dirty: false })

    const { Properties } = await import('../src/js/Properties.js')
    new Properties(editor)
    document.getElementById('tab-style').click()

    const checkbox = document.querySelector('.property-row input[type="checkbox"]')
    const sourceColor = checkbox.closest('.property-row').querySelector('.prop-color-label').textContent
    expect(checkbox).not.toBeNull()
    expect(checkbox.checked).toBe(true)
    expect(editor.paperConfig.colorMap).toEqual({})
    expect(editor.documentState.isDirty).toBe(false)

    checkbox.checked = false
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))

    expect(editor.paperConfig.colorMap).toEqual({
      [sourceColor]: { printColor: sourceColor, enabled: false },
    })
    expect(editor.documentState.snapshot()).toMatchObject({ revision: 1, isDirty: true })
    editor.documentState.disconnect()
  })
})
