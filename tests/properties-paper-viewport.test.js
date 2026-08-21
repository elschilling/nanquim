// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

import { PaperViewport } from '../src/js/PaperViewport.js'
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
    documentStateChanged: new TestSignal(),
    editorModeChanged: new TestSignal(),
    paperViewportsChanged: new TestSignal(),
    updatedProperties: new TestSignal(),
    updatedSelection: new TestSignal(),
  }
}

function findControl(label, selector = 'input, select') {
  const row = Array.from(document.querySelectorAll('.property-row'))
    .find(candidate => candidate.querySelector('.property-label')?.textContent === label)
  return row?.querySelector(selector) || null
}

async function createFixture({
  modelBounds = { x: 100, y: 200, width: 300, height: 100 },
  scale = 37.5,
  unitsPerCm = 2.5,
} = {}) {
  const canvas = document.getElementById('canvas')
  const modelSvg = SVG().addTo(canvas)
  const drawing = modelSvg.group().attr('id', 'Collection')
  drawing.rect(300, 100).move(100, 200)
  drawing.node.getBBox = vi.fn(() => modelBounds)

  const paperSvg = SVG().addTo(canvas)
  const viewportsGroup = paperSvg.group().attr('id', 'paper-viewports')
  const signals = createSignals()
  const editor = {
    canvas,
    collections: new Map(),
    drawing,
    geometryNodeEditor: {},
    isDrawing: false,
    mode: 'paper',
    paperConfig: {
      colorMap: {},
      height: 297,
      orientation: 'portrait',
      size: 'A4',
      unitsPerCm,
      width: 210,
    },
    paperEditor: { removeViewport: vi.fn() },
    paperSvg,
    paperViewports: [],
    selected: [],
    signals,
    svg: modelSvg,
  }
  editor.documentState = new DocumentState(editor, { observe: false })
  const viewport = new PaperViewport(editor, viewportsGroup, {
    id: 'vp-properties',
    x: 2,
    y: 3,
    w: 10,
    h: 8,
    scale,
    modelOriginX: 0,
    modelOriginY: 0,
  })
  editor.paperViewports = [viewport]
  editor.selected = [viewport._group]
  editor.documentState.replaceSession({ name: 'paper.svg', dirty: false })

  const { Properties } = await import('../src/js/Properties.js')
  new Properties(editor)
  document.getElementById('tab-transform').click()

  return { editor, viewport }
}

describe('Paper viewport properties', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="canvas"></div>
      <button id="tab-transform"></button>
      <button id="tab-style"></button>
      <button id="tab-settings"></button>
      <button id="tab-dimstyles"></button>
      <button id="tab-textstyles"></button>
      <button id="tab-modifiers"></button>
      <div id="properties-panel"></div>
    `
    registerWindow(window, document)
    globalThis.SVG = SVG
    Object.defineProperty(window.SVGElement.prototype, 'getBBox', {
      configurable: true,
      writable: true,
      value: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    })
  })

  afterEach(() => {
    delete globalThis.SVG
    delete window.SVGElement.prototype.getBBox
    document.body.replaceChildren()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  test('keeps common metric presets synchronized with the custom denominator', async () => {
    const { editor, viewport } = await createFixture()
    const expectedOptions = ['1:1', '1:2', '1:5', '1:10', '1:20', '1:25', '1:50', '1:100', '1:200', '1:500', 'Custom (1:N)']

    let preset = findControl('Scale preset', 'select')
    expect(preset).not.toBeNull()
    expect(document.querySelector(`label[for="${preset.id}"]`)?.textContent).toBe('Scale preset')
    expect(preset.getAttribute('aria-describedby')).toBe('paper-viewport-scale-help')
    expect(Array.from(preset.options, option => option.textContent)).toEqual(expectedOptions)
    expect(preset.value).toBe('custom')
    expect(findControl('Scale (1:N)').value).toBe('37.5')

    preset.value = '100'
    preset.dispatchEvent(new Event('change', { bubbles: true }))
    expect(viewport.scale).toBe(100)
    expect(findControl('Scale preset', 'select').value).toBe('100')
    expect(findControl('Scale (1:N)').value).toBe('100')

    let customScale = findControl('Scale (1:N)')
    customScale.value = '25'
    customScale.dispatchEvent(new Event('change', { bubbles: true }))
    expect(viewport.scale).toBe(25)
    expect(findControl('Scale preset', 'select').value).toBe('25')

    customScale = findControl('Scale (1:N)')
    customScale.value = '37.5'
    customScale.dispatchEvent(new Event('change', { bubbles: true }))
    expect(viewport.scale).toBe(37.5)
    expect(findControl('Scale preset', 'select').value).toBe('custom')
    expect(editor.documentState.snapshot()).toMatchObject({ revision: 3, isDirty: true })
  })

  test('shows centimetres and converts all viewport geometry edits at U=2.5', async () => {
    const { editor, viewport } = await createFixture({ unitsPerCm: 2.5 })

    expect(findControl('X (cm)').value).toBe('0.800')
    expect(findControl('Y (cm)').value).toBe('1.200')
    expect(findControl('Width (cm)').value).toBe('4.000')
    expect(findControl('Height (cm)').value).toBe('3.200')

    for (const [label, inputValue, property, expected] of [
      ['X (cm)', '1.5', 'x', 3.75],
      ['Y (cm)', '-2', 'y', -5],
      ['Width (cm)', '6', 'w', 15],
      ['Height (cm)', '7.5', 'h', 18.75],
    ]) {
      const input = findControl(label)
      input.value = inputValue
      input.dispatchEvent(new Event('change', { bubbles: true }))
      expect(viewport[property]).toBe(expected)
      expect(findControl(label).value).toBe(Number(inputValue).toFixed(3))
    }

    expect(editor.documentState.snapshot()).toMatchObject({ revision: 4, isDirty: true })
  })

  test('centers current model bounds with the configured units per centimetre', async () => {
    const { editor, viewport } = await createFixture({ scale: 50, unitsPerCm: 2.5 })
    const button = document.querySelector('.prop-center-model-btn')

    expect(button.type).toBe('button')
    expect(button.textContent).toBe('Center Model in Viewport')
    expect(button.title).toBe('Center the current model bounds in this viewport')
    button.click()

    expect(viewport).toMatchObject({ modelOriginX: 150, modelOriginY: 170 })
    expect(viewport._useEl.matrixify()).toMatchObject({
      a: 0.05,
      d: 0.05,
      e: -5.5,
      f: -5.5,
    })
    expect(findControl('Model Origin X').value).toBe('150.000')
    expect(findControl('Model Origin Y').value).toBe('170.000')
    expect(editor.documentState.snapshot()).toMatchObject({ revision: 1, isDirty: true })
  })

  test('rejects invalid scale and unavailable model bounds without dirtying', async () => {
    const { editor, viewport } = await createFixture({ modelBounds: null })
    editor._drawingBBox = null

    const customScale = findControl('Scale (1:N)')
    customScale.value = '0'
    customScale.dispatchEvent(new Event('change', { bubbles: true }))
    document.querySelector('.prop-center-model-btn').click()

    expect(viewport).toMatchObject({
      scale: 37.5,
      modelOriginX: 0,
      modelOriginY: 0,
    })
    expect(editor.documentState.snapshot()).toMatchObject({ revision: 0, isDirty: false })

    editor._drawingBBox = { x: Number.NaN, y: 0, width: 10, height: 10 }
    expect(viewport.centerOnModelBounds()).toBe(false)
    expect(editor.documentState.snapshot()).toMatchObject({ revision: 0, isDirty: false })
  })

  test('rejects serializer-incompatible geometry entered through Properties without dirtying', async () => {
    const { editor, viewport } = await createFixture()
    const original = { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h }

    for (const [label, value] of [
      ['X (cm)', '1000000.001'],
      ['Y (cm)', '-1000000.001'],
      ['Width (cm)', '1000000.001'],
      ['Height (cm)', '0.0000001'],
    ]) {
      const input = findControl(label)
      input.value = value
      input.dispatchEvent(new Event('change', { bubbles: true }))
      expect(viewport).toMatchObject(original)
      expect(editor.documentState.snapshot()).toMatchObject({ revision: 0, isDirty: false })
    }
  })
})
