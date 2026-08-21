import { describe, expect, test } from 'vitest'

import denormalise, {
  DxfExpansionError,
} from '../src/js/libs/dxf/src/denormalise.js'

function line(x = 0) {
  return {
    type: 'LINE',
    layer: '0',
    start: { x, y: 0 },
    end: { x: x + 1, y: 1 },
  }
}

function insert(block, overrides = {}) {
  return {
    type: 'INSERT',
    block,
    layer: '0',
    x: 0,
    y: 0,
    ...overrides,
  }
}

function parsed({ blocks = [], entities = [] } = {}) {
  return { blocks, entities }
}

function block(name, entities) {
  return { name, x: 0, y: 0, entities }
}

function expectExpansionError(action, code) {
  expect(action).toThrow(expect.objectContaining({
    name: 'DxfExpansionError',
    code,
  }))
}

describe('bounded DXF INSERT expansion', () => {
  test('rejects direct and indirect block cycles', () => {
    expectExpansionError(() => denormalise(parsed({
      blocks: [block('A', [insert('A')])],
      entities: [insert('A')],
    })), 'insert-cycle')

    expectExpansionError(() => denormalise(parsed({
      blocks: [
        block('A', [insert('B')]),
        block('B', [insert('A')]),
      ],
      entities: [insert('A')],
    })), 'insert-cycle')
  })

  test('rejects nesting deeper than the configured limit', () => {
    expectExpansionError(() => denormalise(parsed({
      blocks: [
        block('A', [insert('B')]),
        block('B', [insert('C')]),
        block('C', [line()]),
      ],
      entities: [insert('A')],
    }), { maxInsertDepth: 2 }), 'insert-depth-limit')
  })

  test('rejects oversized and invalid rectangular INSERT arrays before expanding them', () => {
    const source = parsed({
      blocks: [block('A', [line()])],
      entities: [insert('A', { rowCount: 2, columnCount: 2 })],
    })
    expectExpansionError(
      () => denormalise(source, { maxInsertInstances: 3 }),
      'insert-instance-limit',
    )

    expectExpansionError(() => denormalise(parsed({
      blocks: [block('A', [line()])],
      entities: [insert('A', { rowCount: 0 })],
    })), 'invalid-insert-array')
  })

  test.each([
    ['non-finite insertion point', { x: Infinity }],
    ['over-bound array spacing', { rowCount: 2, rowSpacing: 1e308 }],
    ['non-finite rotation', { rotation: -Infinity }],
    ['zero X scale', { scaleX: 0 }],
  ])('rejects a present invalid %s instead of silently substituting a default', (_label, overrides) => {
    expectExpansionError(() => denormalise(parsed({
      blocks: [block('A', [line()])],
      entities: [insert('A', overrides)],
    })), 'invalid-insert-transform')
  })

  test('rejects an invalid block base point and an array coordinate that exceeds the bound', () => {
    expectExpansionError(() => denormalise(parsed({
      blocks: [{ name: 'A', x: Infinity, y: 0, entities: [line()] }],
      entities: [insert('A')],
    })), 'invalid-insert-transform')

    expectExpansionError(() => denormalise(parsed({
      blocks: [block('A', [line()])],
      entities: [insert('A', {
        columnCount: 3,
        columnSpacing: 500000001,
      })],
    })), 'invalid-insert-transform')
  })

  test('enforces the expanded entity limit independently of the INSERT limit', () => {
    expectExpansionError(() => denormalise(parsed({
      blocks: [block('A', [line(0), line(2), line(4)])],
      entities: [insert('A')],
    }), {
      maxExpandedEntities: 2,
      maxInsertInstances: 10,
    }), 'expanded-entity-limit')
  })

  test('uses deterministic insert group ids and bounded aggregate reporting', () => {
    const source = parsed({
      blocks: [block('A', [line()])],
      entities: [insert('missing'), insert('A', { rowCount: 2, rowSpacing: 3 })],
    })
    const firstReport = {}
    const secondReport = {}
    const first = denormalise(source, { report: firstReport })
    const second = denormalise(source, { report: secondReport })

    expect(first.map((entity) => entity.insertGroup)).toEqual(['A-1', 'A-2'])
    expect(second.map((entity) => entity.insertGroup)).toEqual(['A-1', 'A-2'])
    expect(firstReport).toEqual({
      missingBlockInserts: 1,
      expandedEntities: 2,
      insertInstances: 2,
    })
    expect(secondReport).toEqual(firstReport)
  })

  test('resolves nested INSERT coordinates relative to each block base point', () => {
    const source = parsed({
      blocks: [
        { name: 'Inner', x: 100, y: 25, entities: [line(100)] },
        {
          name: 'Outer',
          x: 50,
          y: 10,
          entities: [insert('Inner', { x: 70, y: 15 })],
        },
      ],
      entities: [insert('Outer', { x: 200, y: 40 })],
    })

    const [expanded] = denormalise(source)

    expect(expanded.start).toEqual({ x: 0, y: -25 })
    expect(expanded.end).toEqual({ x: 1, y: -24 })
    expect(expanded.transforms.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 20, y: 5 },
      { x: 200, y: 40 },
    ])
  })

  test('exposes typed expansion failures to conversion callers', () => {
    const error = new DxfExpansionError('test-limit', 'bounded failure')
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({ name: 'DxfExpansionError', code: 'test-limit' })
  })
})
