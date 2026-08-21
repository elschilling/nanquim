// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { getDrawableElements } from '../src/js/Collection.js'
import { ExtendCommand } from '../src/js/commands/ExtendCommand.js'
import { TrimCommand } from '../src/js/commands/TrimCommand.js'
import {
  extractSegments,
  findEnclosingBoundary,
} from '../src/js/utils/boundaryDetection.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixture.editor.collections.get(fixture.activeCollection.attr('id')).visible = true
  fixtures.push(fixture)
  return fixture
}

function registerPaperAnnotations(editor) {
  const group = editor.paperDrawing.attr({
    id: 'paper-annotations',
    'data-collection': 'true',
    'data-nanquim-paper-annotations': 'true',
  })
  editor.paperAnnotations = group
  editor.collections.set('paper-annotations', {
    group,
    locked: false,
    visible: true,
  })
  return group
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('Model drawable isolation from Paper Space', () => {
  test('keeps registered Paper annotations out of Model boundary extraction', () => {
    const { activeCollection, editor } = createFixture()
    const modelBoundary = activeCollection.line(0, 0, 10, 0).attr('id', 'model-boundary')
    const lockedBoundary = activeCollection.line(0, 2, 10, 2).attr({
      id: 'locked-boundary',
      'data-locked': 'true',
    })
    activeCollection.line(0, 4, 10, 4).attr({
      id: 'hidden-boundary',
      'data-hidden': 'true',
    })

    const paperAnnotations = registerPaperAnnotations(editor)
    const coincidentPaperBoundary = paperAnnotations.line(0, 0, 10, 0)
      .attr('id', 'coincident-paper-boundary')

    expect(getDrawableElements(editor)).toEqual([modelBoundary, lockedBoundary])

    const segments = extractSegments(editor)
    expect(segments).toHaveLength(2)
    expect(segments.map((segment) => segment.element)).toEqual([
      modelBoundary,
      lockedBoundary,
    ])
    expect(segments.some((segment) => segment.element === coincidentPaperBoundary)).toBe(false)
  })

  test('does not let a Paper-only edge close a Model hatch boundary', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.line(0, 0, 10, 0)
    activeCollection.line(10, 10, 0, 10)
    activeCollection.line(0, 10, 0, 0)

    const paperAnnotations = registerPaperAnnotations(editor)
    paperAnnotations.line(10, 0, 10, 10)

    expect(findEnclosingBoundary(editor, { x: 5, y: 5 })).toBeNull()
  })

  test('keeps Paper boundaries out of TRIM and EXTEND automatic scans', () => {
    const { activeCollection, editor } = createFixture()
    const target = activeCollection.line(0, 0, 5, 0).attr('id', 'target')
    const modelBoundary = activeCollection.line(20, -5, 20, 5).attr('id', 'model-boundary')
    const paperAnnotations = registerPaperAnnotations(editor)
    const nearerPaperBoundary = paperAnnotations.line(10, -5, 10, 5)
      .attr('id', 'nearer-paper-boundary')
    const coincidentPaperBoundary = paperAnnotations.line(20, -5, 20, 5)
      .attr('id', 'coincident-paper-boundary')
    const nearerPaperScan = vi.spyOn(nearerPaperBoundary, 'hasClass')
    const coincidentPaperScan = vi.spyOn(coincidentPaperBoundary, 'hasClass')

    const trim = new TrimCommand(editor)
    trim.autoTrimMode = true
    expect(trim.getCandidateBoundaries(target)).toEqual([modelBoundary])
    expect(nearerPaperScan).not.toHaveBeenCalled()
    expect(coincidentPaperScan).not.toHaveBeenCalled()

    const extend = new ExtendCommand(editor)
    extend.autoExtendMode = true
    expect(extend.calculateLineExtension(target, { x: 5, y: 0 })?.newPosition).toEqual({
      x: 20,
      y: 0,
    })
    expect(nearerPaperScan).not.toHaveBeenCalled()
    expect(coincidentPaperScan).not.toHaveBeenCalled()

    expect(getDrawableElements(editor)).not.toContain(nearerPaperBoundary)
    expect(getDrawableElements(editor)).not.toContain(coincidentPaperBoundary)
  })
})
