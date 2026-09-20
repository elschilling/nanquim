// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

import { DimensionManager, DimensionStyle } from '../src/js/DimensionManager.js'
import { LinearDimensionCommand } from '../src/js/commands/LinearDimensionCommand.js'

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

function dimensionStyle(orientation, position = 'above') {
  return new DimensionStyle('test', 'Test', {
    orientation,
    markerSize: 0,
    position,
    textOffset: 2,
  })
}

function renderedOrientation(orientation, dimType = 'linear', position = 'above') {
  const svg = SVG().addTo(document.getElementById('canvas')).size(400, 300)
  const group = svg.group()
  LinearDimensionCommand.renderDimensionGraphics(
    group,
    { x: 0, y: 0 },
    { x: 6, y: 8 },
    { x: 12, y: 12 },
    dimensionStyle(orientation, position),
    1,
    false,
    dimType,
    {
      textStyleManager: {
        getStyle: () => ({ properties: { fontFamily: 'Inter', fontSize: 1 } }),
      },
    },
  )
  const main = group.findOne('.dim-main-line')
  const text = group.findOne('.dim-text')
  return {
    line: ['x1', 'y1', 'x2', 'y2'].map(attribute => Number(main.attr(attribute))),
    text: text.text(),
    textPoint: [Number(text.attr('x')), Number(text.attr('y'))],
    transform: text.attr('transform'),
  }
}

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

describe('dimension style orientation', () => {
  test('renders horizontal, vertical, and aligned geometry from the style', () => {
    expect(renderedOrientation('horizontal')).toMatchObject({
      line: [0, 12, 6, 12],
      text: '6.00',
    })
    expect(renderedOrientation('vertical')).toMatchObject({
      line: [12, 0, 12, 8],
      text: '8.00',
    })

    const aligned = renderedOrientation('aligned')
    expect(aligned.text).toBe('10.00')
    expect(aligned.line[0]).toBeCloseTo(1.92)
    expect(aligned.line[1]).toBeCloseTo(-1.44)
    expect(aligned.line[2]).toBeCloseTo(7.92)
    expect(aligned.line[3]).toBeCloseTo(6.56)
    expect(aligned.transform).toContain('rotate(53.13010235415598')

    // The explicit aligned command keeps its contract even when the active
    // style is otherwise configured for horizontal DIMLINEAR dimensions.
    expect(renderedOrientation('horizontal', 'aligned').text).toBe('10.00')
  })

  test('defaults and normalizes orientation in dimension style data', () => {
    expect(new DimensionStyle('default', 'Default').properties).toMatchObject({
      orientation: 'horizontal',
      position: 'above',
    })
    expect(DimensionStyle.fromJSON({
      id: 'vertical',
      name: 'Vertical',
      properties: { orientation: 'vertical' },
    }).properties.orientation).toBe('vertical')
    expect(DimensionStyle.fromJSON({
      id: 'invalid',
      name: 'Invalid',
      properties: { orientation: 'url(https://attacker.invalid)' },
    }).properties.orientation).toBe('horizontal')
  })

  test('places dimension text above or below each orientation', () => {
    const horizontalAbove = renderedOrientation('horizontal', 'linear', 'above')
    const horizontalBelow = renderedOrientation('horizontal', 'linear', 'below')
    expect(horizontalAbove.textPoint).toEqual([3, 10])
    expect(horizontalBelow.textPoint).toEqual([3, 14])

    const verticalAbove = renderedOrientation('vertical', 'linear', 'above')
    const verticalBelow = renderedOrientation('vertical', 'linear', 'below')
    expect(verticalAbove.textPoint[0]).toBeCloseTo(14)
    expect(verticalBelow.textPoint[0]).toBeCloseTo(10)

    const alignedAbove = renderedOrientation('aligned', 'linear', 'above')
    const alignedBelow = renderedOrientation('aligned', 'linear', 'below')
    const midpoint = [
      (alignedAbove.line[0] + alignedAbove.line[2]) / 2,
      (alignedAbove.line[1] + alignedAbove.line[3]) / 2,
    ]
    const belowNormal = [-0.8, 0.6]
    const signedOffset = result => (
      (result.textPoint[0] - midpoint[0]) * belowNormal[0]
      + (result.textPoint[1] - midpoint[1]) * belowNormal[1]
    )
    expect(signedOffset(alignedAbove)).toBeCloseTo(-2)
    expect(signedOffset(alignedBelow)).toBeCloseTo(2)
  })

  test('exposes the three orientation choices in the dimension style panel', async () => {
    const signals = {
      clearSelection: new TestSignal(),
      editorModeChanged: new TestSignal(),
      refreshDimensions: new TestSignal(),
      refreshHandlers: new TestSignal(),
      terminalLogged: new TestSignal(),
      updatedOutliner: new TestSignal(),
      updatedProperties: new TestSignal(),
      updatedSelection: new TestSignal(),
    }
    const editor = {
      collections: new Map(),
      drawing: SVG().addTo(document.getElementById('canvas')).group(),
      geometryNodeEditor: {},
      mode: 'model',
      selected: [],
      signals,
      textStyleManager: {
        styles: new Map([['Standard', { id: 'Standard', name: 'Standard' }]]),
      },
    }
    editor.dimensionManager = new DimensionManager(editor)

    const { Properties } = await import('../src/js/Properties.js')
    new Properties(editor)
    document.getElementById('tab-dimstyles').click()
    document.querySelector('.prop-accordion-header').click()

    const row = Array.from(document.querySelectorAll('.property-row'))
      .find(candidate => candidate.querySelector('.property-label')?.textContent === 'Orientation')
    const select = row.querySelector('select')
    expect(Array.from(select.options, option => [option.value, option.textContent])).toEqual([
      ['horizontal', 'Horizontal'],
      ['vertical', 'Vertical'],
      ['aligned', 'Aligned'],
    ])
    expect(select.value).toBe('horizontal')

    select.value = 'vertical'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(editor.dimensionManager.getStyle('Standard').properties.orientation).toBe('vertical')

    editor.dimensionManager.updateStyle('Standard', { orientation: 'diagonal' })
    expect(editor.dimensionManager.getStyle('Standard').properties.orientation).toBe('vertical')

    const positionRow = Array.from(document.querySelectorAll('.property-row'))
      .find(candidate => candidate.querySelector('.property-label')?.textContent === 'Position')
    const positionSelect = positionRow.querySelector('select')
    expect(Array.from(positionSelect.options, option => [option.value, option.textContent])).toEqual([
      ['above', 'Above'],
      ['below', 'Below'],
    ])
    positionSelect.value = 'below'
    positionSelect.dispatchEvent(new Event('change', { bubbles: true }))
    expect(editor.dimensionManager.getStyle('Standard').properties.position).toBe('below')

    editor.dimensionManager.updateStyle('Standard', { position: 'outside' })
    expect(editor.dimensionManager.getStyle('Standard').properties.position).toBe('below')
  })
})
