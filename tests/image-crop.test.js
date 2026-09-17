// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { EditImageCommand } from '../src/js/commands/EditImageCommand.js'
import { commitVertexEditUpdates } from '../src/js/commands/VertexEditTransaction.js'
import {
  canCropImageElement,
  getImageGripPoints,
  getImageVisibleBounds,
  imageBoundsFromGrip,
  readImageGripBounds,
} from '../src/js/utils/imageGrips.js'
import { MAX_SVG_GEOMETRY_MAGNITUDE } from '../src/js/utils/svgNumericBounds.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const original = { x: 10, y: 20, width: 80, height: 40 }
const clip = 'inset(25% 20% 25% 20%) fill-box'
const cropped = { ...original, 'clip-path': clip }
const fixtures = []
const styles = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixtures.push(fixture)
  return fixture
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  while (styles.length) styles.pop().remove()
  while (fixtures.length) fixtures.pop().dispose()
  document.body.replaceChildren()
})

function addStylesheet(text) {
  const style = document.createElement('style')
  style.textContent = text
  document.head.append(style)
  styles.push(style)
  return style.sheet
}

describe('image crop geometry', () => {
  test('places all nine grips on the visible crop bounds', () => {
    expect(getImageVisibleBounds(cropped)).toEqual({ x: 26, y: 30, width: 48, height: 20 })
    expect(getImageGripPoints(cropped)).toEqual([
      { x: 26, y: 30, index: 0 }, { x: 74, y: 30, index: 1 },
      { x: 74, y: 50, index: 2 }, { x: 26, y: 50, index: 3 },
      { x: 50, y: 30, index: 4 }, { x: 74, y: 40, index: 5 },
      { x: 50, y: 50, index: 6 }, { x: 26, y: 40, index: 7 },
      { x: 50, y: 40, index: 8 },
    ])
  })

  test.each([
    [4, { x: -100, y: 30 }, 'inset(25% 0% 0% 0%) fill-box', { x: 10, y: 30, width: 80, height: 30 }],
    [5, { x: 70, y: -100 }, 'inset(0% 25% 0% 0%) fill-box', { x: 10, y: 20, width: 60, height: 40 }],
    [6, { x: -100, y: 50 }, 'inset(0% 0% 25% 0%) fill-box', { x: 10, y: 20, width: 80, height: 30 }],
    [7, { x: 30, y: -100 }, 'inset(0% 0% 0% 25%) fill-box', { x: 30, y: 20, width: 60, height: 40 }],
  ])('crops side %i without changing the full image geometry or perpendicular sides', (index, point, expected, visible) => {
    const snapshot = Object.freeze({ ...original })
    const update = imageBoundsFromGrip(snapshot, index, point)
    expect(update).toEqual({ 'clip-path': expected })
    expect(getImageVisibleBounds({ ...snapshot, ...update })).toEqual(visible)
    expect(snapshot).toEqual(original)
  })

  test.each([4, 5, 6, 7])('clamps side %i at the source bounds and leaves a positive crop when crossing the opposite side', index => {
    const inward = index === 4 || index === 7 ? Number.MAX_VALUE : -Number.MAX_VALUE
    const outward = -inward
    const collapsed = { ...cropped, ...imageBoundsFromGrip(cropped, index, { x: inward, y: inward }) }
    const visible = getImageVisibleBounds(collapsed)
    expect(visible.width).toBeGreaterThan(0)
    expect(visible.height).toBeGreaterThan(0)
    expect(visible.x).toBeGreaterThanOrEqual(original.x)
    expect(visible.y).toBeGreaterThanOrEqual(original.y)
    expect(visible.x + visible.width).toBeLessThanOrEqual(original.x + original.width)
    expect(visible.y + visible.height).toBeLessThanOrEqual(original.y + original.height)
    const expanded = { ...original, ...imageBoundsFromGrip(original, index, { x: outward, y: outward }) }
    expect(expanded['clip-path']).toBeNull()
    expect(getImageVisibleBounds(expanded)).toEqual(original)
  })

  test('restores cropped pixels by extending each side to the original source edge', () => {
    let bounds = { ...cropped }
    for (const [index, point] of [[4, { x: 50, y: 20 }], [5, { x: 90, y: 40 }],
      [6, { x: 50, y: 60 }], [7, { x: 10, y: 40 }]]) {
      bounds = { ...bounds, ...imageBoundsFromGrip(bounds, index, point) }
    }
    expect(bounds).toEqual({ ...original, 'clip-path': null })
    expect(getImageVisibleBounds(bounds)).toEqual(original)
  })

  test('keeps already tiny crops positive when crossing a side', () => {
    const tiny = { x: 0, y: 0, width: 0.0000001, height: 0.0000002, 'clip-path': clip }
    for (const index of [4, 5, 6, 7]) {
      const next = { ...tiny, ...imageBoundsFromGrip(tiny, index, { x: 1, y: 1 }) }
      expect(getImageGripPoints(next)).toHaveLength(9)
      expect(getImageVisibleBounds(next).width).toBeGreaterThan(0)
      expect(getImageVisibleBounds(next).height).toBeGreaterThan(0)
    }
  })

  test.each([0, 1, 2, 3])('resizes cropped corner %i around the opposite visible corner and retains source proportions', index => {
    const points = getImageGripPoints(cropped)
    const opposite = points[(index + 2) % 4]
    const point = points[index]
    const next = imageBoundsFromGrip(cropped, index, {
      x: opposite.x + (point.x - opposite.x) * 2,
      y: opposite.y + (point.y - opposite.y) * 2,
    })
    expect(next.width).toBeCloseTo(160)
    expect(next.height).toBeCloseTo(80)
    expect(next['clip-path']).toBe(clip)
    const nextOpposite = getImageGripPoints(next)[(index + 2) % 4]
    expect(nextOpposite.x).toBeCloseTo(opposite.x)
    expect(nextOpposite.y).toBeCloseTo(opposite.y)
  })

  test('moves an asymmetric crop by its visible center while preserving all embedded pixels', () => {
    const asymmetric = { ...original, 'clip-path': 'inset(25% 25% 0% 0%) fill-box' }
    expect(imageBoundsFromGrip(asymmetric, 8, { x: 100, y: 100 }))
      .toEqual({ x: 70, y: 75, width: 80, height: 40, 'clip-path': asymmetric['clip-path'] })
  })

  test.each([0, 1, 2, 3, 8])('keeps the full embedded image within numeric bounds during cropped edit %i', index => {
    for (const direction of [-1, 1]) {
      const next = imageBoundsFromGrip(cropped, index, {
        x: direction * Number.MAX_VALUE, y: direction * Number.MAX_VALUE,
      })
      expect(next.x).toBeGreaterThanOrEqual(-MAX_SVG_GEOMETRY_MAGNITUDE)
      expect(next.y).toBeGreaterThanOrEqual(-MAX_SVG_GEOMETRY_MAGNITUDE)
      expect(next.x + next.width).toBeLessThanOrEqual(MAX_SVG_GEOMETRY_MAGNITUDE)
      expect(next.y + next.height).toBeLessThanOrEqual(MAX_SVG_GEOMETRY_MAGNITUDE)
      expect(next.width).toBeGreaterThan(0)
      expect(next.height).toBeGreaterThan(0)
    }
  })

  test.each([
    ['inset(25%) fill-box', { x: 30, y: 30, width: 40, height: 20 }],
    ['inset(25% 20%) fill-box', { x: 26, y: 30, width: 48, height: 20 }],
    ['inset(25% 20% 0%) fill-box', { x: 26, y: 30, width: 48, height: 30 }],
    ['inset(2.5e1% +20.0% .0% 20%) fill-box', { x: 26, y: 30, width: 48, height: 30 }],
  ])('reads bounded SVG crop shorthand %s', (value, expected) => {
    expect(getImageVisibleBounds({ ...original, 'clip-path': value })).toEqual(expected)
  })

  test.each([
    'url(#existing)', 'polygon(0 0, 100% 0, 100% 100%)', 'inset(10px) fill-box',
    'inset(10%)', 'inset(10%) border-box', 'inset(10% round 5%) fill-box',
    'inset(NaN%) fill-box', 'inset(Infinity%) fill-box', 'inset(1e999%) fill-box',
    'inset(-1%) fill-box', 'inset(101%) fill-box', 'inset(100% 0% 0% 0%) fill-box',
    'inset(50%) fill-box', 'inset(0% 60% 0% 40%) fill-box',
    'inset(0% 1% 2% 3% 4%) fill-box', 'inset(calc(10%)) fill-box',
  ])('preserves unsupported clipping %s and disables only crop sides', value => {
    const bounds = { ...original, 'clip-path': value }
    expect(getImageVisibleBounds(bounds)).toEqual(original)
    expect(getImageGripPoints(bounds).map(point => point.index)).toEqual([0, 1, 2, 3, 8])
    expect(imageBoundsFromGrip(bounds, 4, { x: 50, y: 30 })).toBeNull()
    expect(imageBoundsFromGrip(bounds, 8, { x: 50, y: 40 })).toEqual(bounds)
  })
})

describe('image crop ownership and mutations', () => {
  test('allows image crop when no authored CSS owns the clip property', () => {
    const { activeCollection } = createFixture()
    const image = activeCollection.image().attr(original)
    addStylesheet('image { opacity: .8 } rect { clip-path: none }')
    expect(canCropImageElement(image)).toBe(true)
    expect(canCropImageElement(null)).toBe(false)
  })

  test.each(['none', 'inset(25% 20%) fill-box', 'initial', 'inherit', 'unset'])('blocks authored clip-path %s even when computed clipping equals the attribute', value => {
    const { activeCollection } = createFixture()
    const image = activeCollection.image().attr(value.includes('inset') ? cropped : original)
    addStylesheet(`image { clip-path: ${value} }`)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ clipPath: value.includes('inset') ? value : 'none' })
    expect(canCropImageElement(image)).toBe(false)
    expect(image.node.getAttribute('clip-path')).toBe(value.includes('inset') ? clip : null)
  })

  test('blocks inline and stylesheet all resets that would override later presentation attribute crop edits', () => {
    const { activeCollection } = createFixture()
    const image = activeCollection.image().attr({ ...original, style: 'all: initial' })
    expect(canCropImageElement(image)).toBe(false)
    image.attr('style', null)
    addStylesheet('image { all: unset }')
    expect(canCropImageElement(image)).toBe(false)
  })

  test.each([true, false])('respects active=%s media rules that own clipping', active => {
    const { activeCollection } = createFixture()
    const image = activeCollection.image().attr(original)
    addStylesheet('@media (min-width: 600px) { image { clip-path: none } }')
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: active })))
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ clipPath: 'none' })
    expect(canCropImageElement(image)).toBe(!active)
  })

  test('conservatively blocks crop when a stylesheet cannot be inspected', () => {
    const { activeCollection } = createFixture()
    const image = activeCollection.image().attr(original)
    vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([{
      get cssRules() { throw new DOMException('Cross-origin stylesheet', 'SecurityError') },
    }])
    expect(canCropImageElement(image)).toBe(false)
  })

  test('ignores disabled or inactive inaccessible stylesheets', () => {
    const { activeCollection } = createFixture()
    const image = activeCollection.image().attr(original)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([
      { disabled: true, get cssRules() { throw new Error('Disabled') } },
      { media: { mediaText: 'print' }, get cssRules() { throw new Error('Inactive') } },
    ])
    expect(canCropImageElement(image)).toBe(true)
  })

  test('reads computed shorthand without confusing it with a CSS override', () => {
    const { activeCollection } = createFixture()
    const image = activeCollection.image().attr(cropped)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ clipPath: 'inset(25% 20%) fill-box' })
    const snapshot = readImageGripBounds(image)
    expect(snapshot.cropEditable).toBeUndefined()
    expect(snapshot.attributes['clip-path']).toBe(clip)
    expect(getImageGripPoints(snapshot)).toHaveLength(9)
  })

  test('allows browser rounding of fractional crop percentages without disabling subsequent crop edits', () => {
    const { activeCollection } = createFixture()
    const image = activeCollection.image().attr({
      ...original, 'clip-path': 'inset(12.345678912345% 23.45678912345% 0% 0%) fill-box',
    })
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ clipPath: 'inset(12.3457% 23.4568% 0% 0%) fill-box' })
    const snapshot = readImageGripBounds(image)
    expect(snapshot.cropEditable).toBeUndefined()
    expect(getImageGripPoints(snapshot)).toHaveLength(9)
    expect(imageBoundsFromGrip(snapshot, 7, { x: 30, y: 40 })).not.toBeNull()
  })

  test.each(['none', 'url(#css-clip)', 'inset(10%) fill-box'])('keeps a stylesheet clip override %s intact', clipPath => {
    const { activeCollection } = createFixture()
    const image = activeCollection.image().attr(cropped)
    image.node.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ clipPath })
    const snapshot = readImageGripBounds(image)
    expect(snapshot.cropEditable).toBe(false)
    expect(getImageGripPoints(snapshot)).toHaveLength(5)
    expect(imageBoundsFromGrip(snapshot, 4, { x: 50, y: 30 })).toBeNull()
    expect(image.attr('clip-path')).toBe(clip)
  })

  test.each(['none', 'url(#inline-clip)', 'inset(25% 20%) fill-box'])('keeps inline clip ownership for %s', value => {
    const { activeCollection } = createFixture()
    const image = activeCollection.image().attr({ ...cropped, style: `clip-path: ${value}` })
    const snapshot = readImageGripBounds(image)
    expect(snapshot.cropEditable).toBe(false)
    expect(getImageGripPoints(snapshot)).toHaveLength(5)
    expect(image.attr('style')).toBe(`clip-path: ${value}`)
  })

  test('crops without rewriting href, SVG lengths, transforms, or ownership and restores missing clip on Undo', () => {
    const { activeCollection, editor } = createFixture()
    const image = activeCollection.image().attr({
      x: '10px', y: '20px', width: '80px', height: '40px',
      href: 'data:image/png;base64,original', transform: 'rotate(20 50 40)',
      'data-reference-name': 'A & B', preserveAspectRatio: 'xMidYMid meet',
    })
    for (const name of ['x', 'y', 'width', 'height']) {
      Object.defineProperty(image.node, name, { configurable: true, value: { baseVal: { value: original[name] } } })
    }
    const attributes = Array.from(image.node.attributes, attr => [attr.name, attr.value])
    const oldValues = readImageGripBounds(image)
    const next = imageBoundsFromGrip(oldValues, 4, { x: 50, y: 30 })
    const transaction = commitVertexEditUpdates(editor, {
      imageUpdates: [{ element: image, oldValues, newValues: next }],
    })
    expect(image.attr('clip-path')).toBe('inset(25% 0% 0% 0%) fill-box')
    for (const [name, value] of attributes) expect(image.node.getAttribute(name)).toBe(value)
    expect(image.parent()).toBe(activeCollection)
    expect(editor.history.undos).toEqual([transaction])
    expect(editor.documentState.revision).toBe(1)
    editor.history.undo()
    expect(image.node.hasAttribute('clip-path')).toBe(false)
    for (const [name, value] of attributes) expect(image.node.getAttribute(name)).toBe(value)
    editor.history.redo()
    expect(image.attr('clip-path')).toBe(next['clip-path'])
    expect(editor.spatialIndex.markDirty).toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalled()
  })

  test('restores exact original clip spelling after a second crop and snapshots partial changes', () => {
    const { activeCollection, editor } = createFixture()
    const previousClip = 'inset(25% 20%) fill-box'
    const image = activeCollection.image().attr({ ...original, 'clip-path': previousClip })
    const oldValues = readImageGripBounds(image)
    const next = imageBoundsFromGrip(oldValues, 5, { x: 58, y: 40 })
    const command = new EditImageCommand(editor, image, oldValues, next)
    oldValues.attributes['clip-path'] = 'changed'
    next['clip-path'] = 'changed'
    command.execute()
    expect(image.attr('clip-path')).toBe('inset(25% 40% 25% 20%) fill-box')
    command.undo()
    expect(image.attr('clip-path')).toBe(previousClip)
  })

  test('rolls a crop back without adding history when a later geometry mutation fails', () => {
    const { activeCollection, editor } = createFixture()
    const image = activeCollection.image().attr(original)
    const text = activeCollection.text('Reference').attr({ x: 1, y: 2 })
    const oldValues = readImageGripBounds(image)
    const next = imageBoundsFromGrip(oldValues, 4, { x: 50, y: 30 })
    image.attr(next)
    vi.spyOn(text, 'rebuild').mockImplementationOnce(() => { throw new Error('crop transaction failed') })
    expect(() => commitVertexEditUpdates(editor, {
      imageUpdates: [{ element: image, oldValues, newValues: next }],
      textPositionUpdates: [{ element: text, oldValues: { x: 1, y: 2 }, newValues: { x: 10, y: 20 } }],
    })).toThrow('crop transaction failed')
    expect(image.node.hasAttribute('clip-path')).toBe(false)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
  })
})
