// @vitest-environment jsdom

import { Matrix } from '@svgdotjs/svg.js'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { applyCollectionStyleToElement } from '../src/js/Collection.js'
import { ReorderTreeCommand, canReorderTreeElement, planTreeMove } from '../src/js/commands/ReorderTreeCommand.js'
import { getParentToRootMatrix } from '../src/js/utils/rootSpaceTransform.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function fixture() {
  const result = createDeterministicEditorFixture()
  Object.assign(result.editor.collections.get(result.activeCollection.attr('id')), { visible: true, locked: false })
  fixtures.push(result)
  return result
}

function collection(editor, id, style = {}) {
  const group = editor.drawing.group().attr({ id, 'data-collection': 'true', name: id })
  const inherited = { ...editor.collections.get(editor.activeCollection.attr('id')).style, ...style }
  group.css(inherited)
  editor.collections.set(id, { group, visible: true, locked: false, style: inherited })
  return group
}

function ids(parent) {
  return Array.from(parent.node.children).map(node => node.id)
}

function matrixInRoot(element, root) {
  return new Matrix(getParentToRootMatrix(element, root)).multiply(element.matrixify())
}

function expectMatrix(actual, expected) {
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) expect(actual[key]).toBeCloseTo(expected[key], 8)
}

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('Outliner tree movement', () => {
  test('collection styling materializes inherited properties and preserves explicit overrides', () => {
    const { editor, activeCollection } = fixture()
    const element = activeCollection.rect(20, 10).attr('data-style-overrides', '{"stroke":true}').css('stroke', '#123456')
    applyCollectionStyleToElement(editor, element)
    expect(element.css('stroke')).toBe('rgb(18, 52, 86)')
    expect(element.css('stroke-width')).toBe('0.25')
  })

  test('reorders multiple siblings in drawing order with exact Undo/Redo and one history entry', () => {
    const { editor, activeCollection } = fixture()
    const elements = ['a', 'b', 'c', 'd'].map(id => activeCollection.rect(10, 10).attr('id', id))
    editor.selected = [elements[2], elements[0]]
    const before = activeCollection.node.outerHTML
    editor.execute(new ReorderTreeCommand(editor, editor.selected, elements[3], 'after'))
    expect(ids(activeCollection)).toEqual(['b', 'd', 'a', 'c'])
    expect(editor.selected).toEqual([elements[0], elements[2]])
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.documentState.revision).toBe(1)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledOnce()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledOnce()
    const after = activeCollection.node.outerHTML
    editor.history.undo()
    expect(activeCollection.node.outerHTML).toBe(before)
    expect(editor.selected).toEqual([elements[2], elements[0]])
    editor.history.redo()
    expect(activeCollection.node.outerHTML).toBe(after)
  })

  test('moves across transformed collections without shifting world geometry and restores raw SVG attributes', () => {
    const { editor, activeCollection } = fixture()
    activeCollection.attr('transform', 'translate(120 30) rotate(25)')
    const destination = collection(editor, 'destination', { stroke: '#ff8800', 'stroke-width': 2 })
      .attr('transform', 'translate(-20 40) scale(2 3)')
    const image = activeCollection.image().attr({
      id: 'image', x: '10px', y: '20', width: 40, height: 20,
      href: 'data:image/png;base64,c2FmZQ==',
      transform: 'rotate(-15 30 30)',
      'data-style-overrides': '{"opacity":true}',
      'data-metadata': '{"name":"A & B"}',
    }).css('opacity', 0.7)
    applyCollectionStyleToElement(editor, image)
    const original = image.node.outerHTML
    const matrix = matrixInRoot(image, editor.drawing)
    editor.execute(new ReorderTreeCommand(editor, [image], destination))
    expect(image.parent().node).toBe(destination.node)
    expectMatrix(matrixInRoot(image, editor.drawing), matrix)
    expect(image.css('stroke')).toBe('rgb(255, 136, 0)')
    expect(image.css('stroke-width')).toBe('2')
    expect(image.css('opacity')).toBe('0.7')
    expect(image.attr('href')).toBe('data:image/png;base64,c2FmZQ==')
    expect(image.attr('data-metadata')).toBe('{"name":"A & B"}')
    expect(editor.activeCollection).toBe(activeCollection)
    const moved = image.node.outerHTML
    editor.history.undo()
    expect(image.parent().node).toBe(activeCollection.node)
    expect(image.node.outerHTML).toBe(original)
    editor.history.redo()
    expect(image.node.outerHTML).toBe(moved)
    expectMatrix(matrixInRoot(image, editor.drawing), matrix)
  })

  test('moves into and out of ordinary nested groups while preserving group membership and local geometry', () => {
    const { editor, activeCollection } = fixture()
    const group = activeCollection.group().attr({ id: 'group', 'data-group': 'true', transform: 'translate(10 20) rotate(45)' })
    const element = activeCollection.path('M 0 0 L 30 10').attr({ id: 'path', transform: 'scale(2)' })
    const expected = matrixInRoot(element, editor.drawing)
    editor.execute(new ReorderTreeCommand(editor, [element], group))
    expect(element.parent().node).toBe(group.node)
    expect(element.attr('d')).toBe('M 0 0 L 30 10')
    expectMatrix(matrixInRoot(element, editor.drawing), expected)
    editor.execute(new ReorderTreeCommand(editor, [element], group, 'before'))
    expect(element.parent().node).toBe(activeCollection.node)
    expect(ids(activeCollection)).toEqual(['path', 'group'])
    expectMatrix(matrixInRoot(element, editor.drawing), expected)
    editor.history.undo()
    expect(element.parent().node).toBe(group.node)
    editor.history.undo()
    expect(element.attr('transform')).toBe('scale(2)')
  })

  test.each([null, 'translate(5, 8) rotate(15)'])('retains raw transform %s when source and destination matrices match', transform => {
    const { editor, activeCollection } = fixture()
    activeCollection.attr('transform', 'translate(12 34)')
    const destination = collection(editor, 'destination').attr('transform', 'matrix(1 0 0 1 12 34)')
    const element = activeCollection.rect(10, 10).attr('transform', transform)
    editor.execute(new ReorderTreeCommand(editor, [element], destination))
    expect(element.node.getAttribute('transform')).toBe(transform)
    editor.history.undo()
    expect(element.node.getAttribute('transform')).toBe(transform)
  })

  test('permits sibling ordering inside an imported styling wrapper without exposing it as a destination', () => {
    const { editor, activeCollection } = fixture()
    const wrapper = activeCollection.group().attr({ transform: 'rotate(25)', opacity: 0.5 })
    const first = wrapper.line(0, 0, 10, 0)
    const last = wrapper.line(0, 5, 10, 5)
    const outsider = activeCollection.rect(10, 10)
    expect(planTreeMove(editor, [first], last, 'after').valid).toBe(true)
    expect(planTreeMove(editor, [outsider], last, 'after').valid).toBe(false)
    editor.execute(new ReorderTreeCommand(editor, [first], last, 'after'))
    expect(last.node.nextSibling).toBe(first.node)
    expect(first.node.hasAttribute('transform')).toBe(false)
  })

  test('moving into a hidden collection clears invisible selection and Undo restores it', () => {
    const { editor, activeCollection } = fixture()
    const destination = collection(editor, 'destination')
    editor.collections.get('destination').visible = false
    destination.hide()
    const element = activeCollection.rect(10, 10)
    editor.selected = [element]
    editor.execute(new ReorderTreeCommand(editor, [element], destination))
    expect(editor.selected).toEqual([])
    editor.history.undo()
    expect(editor.selected).toEqual([element])
    editor.history.redo()
    expect(editor.selected).toEqual([])
  })

  test('moving selected group roots deduplicates selected descendants and preserves nested overrides through Undo', () => {
    const { editor, activeCollection } = fixture()
    const group = activeCollection.group().attr({ id: 'group', 'data-group': 'true' })
    const inherited = group.line(0, 0, 20, 0).css('stroke', '#ffffff')
    const overridden = group.circle(5).attr('data-style-overrides', '{"stroke":true}').css('stroke', '#123456')
    const destination = collection(editor, 'destination', { stroke: '#aa00aa' })
    const original = group.node.outerHTML
    const plan = planTreeMove(editor, [inherited, group, overridden], destination)
    expect(plan.valid).toBe(true)
    expect(plan.elements).toEqual([group])
    editor.execute(new ReorderTreeCommand(editor, [inherited, group, overridden], destination))
    expect(group.css('stroke')).toBe('rgb(170, 0, 170)')
    expect(inherited.node.style.getPropertyValue('stroke')).toBe('')
    expect(overridden.css('stroke')).toBe('rgb(18, 52, 86)')
    expect(overridden.parent().node).toBe(group.node)
    editor.history.undo()
    expect(group.node.outerHTML).toBe(original)
  })

  test('reorders registered root collections and their Map order without moving contents or active destination', () => {
    const { editor, activeCollection } = fixture()
    const middle = collection(editor, 'middle')
    const last = collection(editor, 'last')
    const child = activeCollection.line(0, 0, 1, 1)
    const before = editor.drawing.node.outerHTML
    const entries = Array.from(editor.collections)
    editor.execute(new ReorderTreeCommand(editor, [last], activeCollection, 'before'))
    expect(ids(editor.drawing)).toEqual(['last', activeCollection.attr('id'), 'middle'])
    expect(Array.from(editor.collections.keys())).toEqual(ids(editor.drawing))
    expect(child.parent().node).toBe(activeCollection.node)
    expect(editor.activeCollection).toBe(activeCollection)
    editor.history.undo()
    expect(editor.drawing.node.outerHTML).toBe(before)
    expect(Array.from(editor.collections)).toEqual(entries)
    editor.history.redo()
    expect(last.node.nextSibling).toBe(activeCollection.node)
    expect(middle.parent().node).toBe(editor.drawing.node)
  })

  test('rejects no-op drops without a mutation or history entry', () => {
    const { editor, activeCollection } = fixture()
    const first = activeCollection.rect(10, 10)
    const last = activeCollection.rect(10, 10)
    const original = activeCollection.node.outerHTML
    for (const [elements, target, position] of [
      [[first], last, 'before'], [[last], first, 'after'], [[first, last], activeCollection, 'inside'],
    ]) {
      expect(planTreeMove(editor, elements, target, position)).toMatchObject({ valid: false, noop: true })
      expect(() => editor.execute(new ReorderTreeCommand(editor, elements, target, position))).toThrow(/already/)
    }
    expect(activeCollection.node.outerHTML).toBe(original)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
  })

  test('rejects cycles, collection nesting, mixing collections with elements, and model root or primitive destinations', () => {
    const { editor, activeCollection } = fixture()
    const destination = collection(editor, 'destination')
    const group = activeCollection.group().attr('data-group', 'true')
    const nested = group.group().attr('data-group', 'true')
    const leaf = group.rect(10, 10)
    for (const [elements, target, position] of [
      [[group], nested, 'inside'], [[group], leaf, 'after'], [[group], group, 'before'],
      [[activeCollection], destination, 'inside'], [[activeCollection, leaf], destination, 'before'],
      [[leaf], editor.drawing, 'inside'], [[leaf], activeCollection, 'before'], [[nested], leaf, 'inside'],
    ]) expect(planTreeMove(editor, elements, target, position).valid).toBe(false)
    expect(editor.history.undos).toHaveLength(0)
  })

  test('honors inherited collection and element locks both at drag planning and commit', () => {
    const { editor, activeCollection } = fixture()
    const target = collection(editor, 'target')
    const group = activeCollection.group().attr({ 'data-group': 'true', 'data-locked': 'true' })
    const leaf = group.rect(10, 10)
    expect(canReorderTreeElement(editor, leaf)).toBe(false)
    group.attr('data-locked', null)
    expect(planTreeMove(editor, [leaf], target).valid).toBe(true)
    const command = new ReorderTreeCommand(editor, [leaf], target)
    editor.collections.get(target.attr('id')).locked = true
    expect(() => editor.execute(command)).toThrow(/Locked/)
    expect(leaf.parent().node).toBe(group.node)
    editor.collections.get(target.attr('id')).locked = false
    editor.collections.get(activeCollection.attr('id')).locked = true
    expect(canReorderTreeElement(editor, leaf)).toBe(false)
  })

  test('allows procedural wrappers and block instances, protects their internal content and destinations', () => {
    const { editor, activeCollection } = fixture()
    const target = collection(editor, 'target')
    const wrapper = activeCollection.group().attr({ 'data-group': 'true', 'data-geometry-nodes': 'true', 'data-gn-graph': 'graph-1' })
    const output = wrapper.group().attr('data-gn-output', 'true')
    const derived = output.path('M 0 0 L 2 2').attr('data-gn-derived', 'true')
    const source = wrapper.rect(3, 4).attr('data-gn-source', 'true')
    const instance = activeCollection.use('block-chair').attr({ 'data-block-instance': 'true', 'data-block-name': 'chair' })
    const block = editor.svg.defs().group().attr('data-block-def', 'true')
    const blockLeaf = block.rect(5, 5)
    expect(canReorderTreeElement(editor, wrapper)).toBe(true)
    expect(canReorderTreeElement(editor, instance)).toBe(true)
    for (const internal of [output, derived, source, blockLeaf]) expect(canReorderTreeElement(editor, internal)).toBe(false)
    expect(planTreeMove(editor, [instance], wrapper).valid).toBe(false)
    editor.execute(new ReorderTreeCommand(editor, [wrapper, instance], target))
    expect(wrapper.attr('data-gn-graph')).toBe('graph-1')
    expect(derived.parent().node).toBe(output.node)
    expect(instance.attr('href')).toBe('#block-chair')
    expect(instance.attr('data-block-name')).toBe('chair')
  })

  test('restricts Paper moves to annotation groups and keeps history valid after switching modes', () => {
    const { editor, activeCollection } = fixture()
    editor.paperAnnotations = editor.paperDrawing.attr({ id: 'paper-annotations', 'data-collection': 'true' })
    editor.collections.set('paper-annotations', { group: editor.paperAnnotations, visible: true, locked: false, style: {} })
    const group = editor.paperAnnotations.group().attr('data-group', 'true')
    const annotation = editor.paperAnnotations.rect(10, 10)
    const model = activeCollection.rect(10, 10)
    expect(planTreeMove(editor, [model], group).valid).toBe(false)
    editor.mode = 'paper'
    expect(planTreeMove(editor, [model], group).valid).toBe(false)
    expect(planTreeMove(editor, [annotation], activeCollection).valid).toBe(false)
    editor.execute(new ReorderTreeCommand(editor, [annotation], group))
    expect(annotation.parent().node).toBe(group.node)
    editor.mode = 'model'
    editor.history.undo()
    expect(annotation.parent().node).toBe(editor.paperAnnotations.node)
    editor.history.redo()
    expect(annotation.parent().node).toBe(group.node)
  })

  test('rejects block edit mode, detached elements and changed document roots', () => {
    const { editor, activeCollection } = fixture()
    const target = collection(editor, 'target')
    const element = activeCollection.rect(10, 10)
    const command = new ReorderTreeCommand(editor, [element], target)
    editor.editingBlock = { editGroup: activeCollection }
    expect(canReorderTreeElement(editor, element)).toBe(false)
    expect(planTreeMove(editor, [element], target).valid).toBe(false)
    editor.editingBlock = null
    element.remove()
    expect(planTreeMove(editor, [element], target).valid).toBe(false)
    activeCollection.add(element)
    editor.drawing = editor.svg.group()
    expect(() => editor.execute(command)).toThrow(/document changed/)
    expect(element.parent().node).toBe(activeCollection.node)
  })

  test.each(['scale(0)', 'matrix(1e20 0 0 1 0 0)'])('rejects unsafe destination %s before changing any element', transform => {
    const { editor, activeCollection } = fixture()
    const target = collection(editor, 'target').attr('transform', transform)
    const element = activeCollection.rect(10, 10)
    // A huge inverse compensation is unsupported too.
    if (transform.includes('1e20')) target.attr('transform', 'matrix(1e-10 0 0 1e10 0 0)')
    const original = editor.drawing.node.outerHTML
    expect(() => editor.execute(new ReorderTreeCommand(editor, [element], target))).toThrow(/transform|Transform/)
    expect(editor.drawing.node.outerHTML).toBe(original)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
  })

  test('rejects a selected CSS transform for reparenting but allows sibling reordering', () => {
    const { editor, activeCollection } = fixture()
    const target = collection(editor, 'target')
    const element = activeCollection.rect(10, 10).css('transform', 'rotate(10deg)')
    const sibling = activeCollection.rect(5, 5)
    expect(() => editor.execute(new ReorderTreeCommand(editor, [element], target))).toThrow(/CSS transform/)
    expect(element.parent().node).toBe(activeCollection.node)
    editor.execute(new ReorderTreeCommand(editor, [element], sibling, 'after'))
    expect(element.node.previousSibling).toBe(sibling.node)
    expect(element.css('transform')).toBe('rotate(10deg)')
  })

  test('rolls back earlier elements and collection styles when a later insertion fails', () => {
    const { editor, activeCollection } = fixture()
    const target = collection(editor, 'target', { stroke: '#ff0000' })
    const first = activeCollection.rect(10, 10)
    const second = activeCollection.circle(5)
    applyCollectionStyleToElement(editor, first)
    const original = editor.drawing.node.outerHTML
    const insert = target.node.insertBefore.bind(target.node)
    vi.spyOn(target.node, 'insertBefore').mockImplementationOnce(insert).mockImplementationOnce(() => { throw new Error('insertion failed') })
    expect(() => editor.execute(new ReorderTreeCommand(editor, [first, second], target))).toThrow('insertion failed')
    expect(editor.drawing.node.outerHTML).toBe(original)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.spatialIndex.markDirty).not.toHaveBeenCalled()
  })

  test('failed Undo and Redo restore the current tree and leave history stacks and document revision untouched', () => {
    const { editor, activeCollection } = fixture()
    const target = collection(editor, 'target')
    const elements = [activeCollection.rect(10, 10), activeCollection.circle(5)]
    editor.execute(new ReorderTreeCommand(editor, elements, target))
    const after = editor.drawing.node.outerHTML
    const originalInsert = activeCollection.node.insertBefore.bind(activeCollection.node)
    vi.spyOn(activeCollection.node, 'insertBefore').mockImplementationOnce(originalInsert).mockImplementationOnce(() => { throw new Error('undo failed') }).mockImplementation(originalInsert)
    expect(() => editor.history.undo()).toThrow('undo failed')
    expect(editor.drawing.node.outerHTML).toBe(after)
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.history.redos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(1)
    editor.history.undo()
    const before = editor.drawing.node.outerHTML
    const targetInsert = target.node.insertBefore.bind(target.node)
    vi.spyOn(target.node, 'insertBefore').mockImplementationOnce(targetInsert).mockImplementationOnce(() => { throw new Error('redo failed') }).mockImplementation(targetInsert)
    expect(() => editor.history.redo()).toThrow('redo failed')
    expect(editor.drawing.node.outerHTML).toBe(before)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.history.redos).toHaveLength(1)
    expect(editor.documentState.revision).toBe(2)
  })
})
