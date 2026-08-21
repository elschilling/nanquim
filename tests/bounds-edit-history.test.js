// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

import { History } from '../src/js/History.js'
import { applyCollectionStyleToElement } from '../src/js/Collection.js'
import { DocumentState } from '../src/js/document/DocumentState.js'
import { EditArcCommand } from '../src/js/commands/EditArcCommand.js'
import { EditCircleCommand } from '../src/js/commands/EditCircleCommand.js'
import { EditDimensionCommand } from '../src/js/commands/EditDimensionCommand.js'
import { EditEllipseCommand } from '../src/js/commands/EditEllipseCommand.js'
import { EditEllipseArcCommand } from '../src/js/commands/EditEllipseArcCommand.js'
import { EditPolylineCommand } from '../src/js/commands/EditPolylineCommand.js'
import { EditSplineCommand } from '../src/js/commands/EditSplineCommand.js'
import { EditTextPositionCommand } from '../src/js/commands/EditTextPositionCommand.js'
import { ExtendArcCommand } from '../src/js/commands/ExtendArcCommand.js'
import { ExtendSplineCommand } from '../src/js/commands/ExtendSplineCommand.js'
import { catmullRomToBezierPath } from '../src/js/commands/DrawSplineCommand.js'
import { LinearDimensionCommand } from '../src/js/commands/LinearDimensionCommand.js'
import { renderEllipseArc } from '../src/js/utils/ellipseArcUtils.js'

function signal() {
  return { dispatch: vi.fn() }
}

function createEditor() {
  const svg = SVG().addTo(document.body)
  const drawing = svg.group().attr('id', 'drawing')
  const collection = drawing.group().attr({
    id: 'collection-1',
    'data-collection': 'true',
  })
  const dimensionStyle = {
    id: 'Standard',
    name: 'Standard',
    properties: {
      extensionLineExtend: 0.1,
      extensionLineOffset: 0.1,
      lineColor: '#ffffff',
      lineWidth: 0.01,
      markerSize: 0.15,
      markerType: 'arrow',
      textColor: '#ffffff',
      textOffset: 0.1,
      textStyleId: 'Standard',
    },
  }
  const editor = {
    collections: new Map([['collection-1', {
      group: collection,
      locked: false,
      style: { fill: 'transparent', stroke: '#ffffff' },
      visible: true,
    }]]),
    dimensionManager: { getStyle: vi.fn(() => dimensionStyle) },
    drawing,
    fullSpatialIndex: { markDirty: vi.fn() },
    signals: {
      documentStateChanged: signal(),
      geometryNodesChanged: { add: vi.fn() },
      refreshHandlers: signal(),
      terminalLogged: signal(),
      updatedOutliner: signal(),
      updatedSelection: signal(),
    },
    spatialIndex: { markDirty: vi.fn() },
    svg,
    textStyleManager: {
      getStyle: vi.fn(() => ({ properties: {} })),
    },
  }
  editor.documentState = new DocumentState(editor, { observe: false })
  editor.history = new History(editor)
  editor.execute = command => editor.history.execute(command)
  return { collection, editor }
}

function ellipseArcData(overrides = {}) {
  return {
    ccw: true,
    cx: 3,
    cy: 4,
    rotation: 0,
    rx: 5,
    ry: 2,
    theta1: 0,
    theta2: Math.PI / 2,
    ...overrides,
  }
}

const commandCases = [
  {
    name: 'ExtendArcCommand',
    create({ collection, editor }) {
      const element = collection.path('M 0 0 A 5 5 0 0 0 10 0')
      element.data('arcData', {
        p1: { x: 0, y: 0 },
        p2: { x: 5, y: 5 },
        p3: { x: 10, y: 0 },
      })
      return {
        command: new ExtendArcCommand(editor, element, false, { x: 12, y: 0 }),
        element,
      }
    },
  },
  {
    name: 'ExtendSplineCommand',
    create({ collection, editor }) {
      const points = [{ x: 0, y: 0 }, { x: 2, y: 3 }, { x: 4, y: 2 }, { x: 6, y: 0 }]
      const element = collection.path(catmullRomToBezierPath(points))
      element.data('splineData', { points })
      return {
        command: new ExtendSplineCommand(editor, element, false, { x: 8, y: 1 }),
        element,
      }
    },
  },
  {
    name: 'EditArcCommand',
    create({ collection, editor }) {
      const oldValues = {
        p1: { x: 0, y: 0 },
        p2: { x: 5, y: 5 },
        p3: { x: 10, y: 0 },
      }
      const newValues = { ...oldValues, p2: { x: 5, y: 7 } }
      const element = collection.path('M 0 0 A 5 5 0 0 0 10 0').data('arcData', oldValues)
      return { command: new EditArcCommand(editor, element, oldValues, newValues), element }
    },
  },
  {
    name: 'EditCircleCommand',
    create({ collection, editor }) {
      const element = collection.circle(4).center(2, 3)
      return {
        command: new EditCircleCommand(
          editor,
          element,
          { cx: 2, cy: 3, r: 2 },
          { cx: 7, cy: 8, r: 4 },
        ),
        element,
      }
    },
  },
  {
    name: 'EditEllipseCommand',
    create({ collection, editor }) {
      const element = collection.ellipse(8, 4).center(2, 3)
      return {
        command: new EditEllipseCommand(
          editor,
          element,
          { cx: 2, cy: 3, rx: 4, ry: 2 },
          { cx: 7, cy: 8, rx: 6, ry: 3 },
        ),
        element,
      }
    },
  },
  {
    name: 'EditEllipseArcCommand',
    create({ collection, editor }) {
      const oldData = ellipseArcData()
      const newData = ellipseArcData({ cx: 8, theta2: Math.PI })
      const element = collection.path()
      renderEllipseArc(element, oldData)
      return { command: new EditEllipseArcCommand(editor, element, oldData, newData), element }
    },
  },
  {
    name: 'EditPolylineCommand',
    create({ collection, editor }) {
      const oldPoints = [[0, 0], [4, 0], [4, 3]]
      const newPoints = [[0, 0], [6, 1], [4, 3]]
      const element = collection.polyline(oldPoints)
      return { command: new EditPolylineCommand(editor, element, oldPoints, newPoints), element }
    },
  },
  {
    name: 'EditSplineCommand',
    create({ collection, editor }) {
      const oldPoints = [{ x: 0, y: 0 }, { x: 2, y: 3 }, { x: 4, y: 2 }, { x: 6, y: 0 }]
      const newPoints = oldPoints.map((point, index) => index === 1 ? { x: 2, y: 5 } : point)
      const element = collection.path(catmullRomToBezierPath(oldPoints)).data('splineData', { points: oldPoints })
      return { command: new EditSplineCommand(editor, element, oldPoints, newPoints), element }
    },
  },
  {
    name: 'EditTextPositionCommand',
    create({ collection, editor }) {
      const element = collection.text('Nanquim').attr({ x: 2, y: 3 })
      return {
        command: new EditTextPositionCommand(editor, element, { x: 2, y: 3 }, { x: 8, y: 9 }),
        element,
      }
    },
  },
]

describe('bounds-edit History commands', () => {
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

  test.each(commandCases)('$name applies synchronously and dirties both indexes on execute/undo/redo', ({ create }) => {
    const fixture = createEditor()
    const { command, element } = create(fixture)
    const originalMarkup = element.node.outerHTML

    fixture.editor.execute(command)

    const editedMarkup = element.node.outerHTML
    expect(editedMarkup).not.toBe(originalMarkup)
    expect(fixture.editor.spatialIndex.markDirty).toHaveBeenCalledTimes(1)
    expect(fixture.editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(1)

    fixture.editor.history.undo()
    expect(element.node.outerHTML).toBe(originalMarkup)
    expect(fixture.editor.spatialIndex.markDirty).toHaveBeenCalledTimes(2)
    expect(fixture.editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(2)

    fixture.editor.history.redo()
    expect(element.node.outerHTML).toBe(editedMarkup)
    expect(fixture.editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(fixture.editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
  })

  test('EditDimension redraws synchronously and round-trips semantic geometry', () => {
    const { collection, editor } = createEditor()
    const oldData = {
      dimType: 'linear',
      p1: { x: 0, y: 0 },
      p2: { x: 10, y: 0 },
      p3: { x: 0, y: 2 },
      styleId: 'Standard',
    }
    const newData = { ...oldData, p3: { x: 0, y: 5 }, textPosition: { x: 1, y: 0.5 } }
    const element = collection.group().attr({
      'data-dim-data': JSON.stringify(oldData),
      'data-element-type': 'dimension',
    })
    LinearDimensionCommand.renderDimensionGraphics(
      element,
      oldData.p1,
      oldData.p2,
      oldData.p3,
      editor.dimensionManager.getStyle('Standard'),
      1,
      false,
      oldData.dimType,
      editor,
    )
    applyCollectionStyleToElement(editor, element)
    const originalMarkup = element.node.outerHTML

    editor.execute(new EditDimensionCommand(editor, [{ element, oldData, newData }]))

    const editedMarkup = element.node.outerHTML
    expect(JSON.parse(element.attr('data-dim-data'))).toEqual(newData)
    expect(editedMarkup).not.toBe(originalMarkup)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledOnce()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledOnce()

    editor.history.undo()
    expect(element.node.outerHTML).toBe(originalMarkup)

    editor.history.redo()
    expect(element.node.outerHTML).toBe(editedMarkup)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
  })

  test('EditDimension rolls back every group when a synchronous multi-update redraw fails', () => {
    const { collection, editor } = createEditor()
    const oldData = {
      dimType: 'linear',
      p1: { x: 0, y: 0 },
      p2: { x: 10, y: 0 },
      p3: { x: 0, y: 2 },
      styleId: 'Standard',
    }
    const elements = [0, 20].map(offset => {
      const data = {
        ...oldData,
        p1: { x: offset, y: 0 },
        p2: { x: offset + 10, y: 0 },
        p3: { x: offset, y: 2 },
      }
      const element = collection.group().attr({
        'data-dim-data': JSON.stringify(data),
        'data-element-type': 'dimension',
      })
      LinearDimensionCommand.renderDimensionGraphics(
        element,
        data.p1,
        data.p2,
        data.p3,
        editor.dimensionManager.getStyle('Standard'),
        1,
        false,
        data.dimType,
        editor,
      )
      applyCollectionStyleToElement(editor, element)
      return { data, element }
    })
    const originalMarkup = elements.map(({ element }) => element.node.outerHTML)
    const originalRender = LinearDimensionCommand.renderDimensionGraphics
    const failure = new Error('second dimension redraw failed')
    vi.spyOn(LinearDimensionCommand, 'renderDimensionGraphics')
      .mockImplementationOnce((...args) => originalRender(...args))
      .mockImplementationOnce(() => { throw failure })
    const command = new EditDimensionCommand(editor, elements.map(({ data, element }) => ({
      element,
      oldData: data,
      newData: { ...data, p3: { x: data.p3.x, y: 6 } },
    })))
    const existingRedo = { execute: vi.fn(), undo: vi.fn() }
    editor.history.redos.push(existingRedo)

    expect(() => editor.execute(command)).toThrow(failure)
    expect(elements.map(({ element }) => element.node.outerHTML)).toEqual(originalMarkup)
    expect(editor.history.undos).toEqual([])
    expect(editor.history.redos).toEqual([existingRedo])
    expect(editor.history.idCounter).toBe(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.spatialIndex.markDirty).not.toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).not.toHaveBeenCalled()
  })
})
