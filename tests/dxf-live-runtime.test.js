import { describe, expect, test } from 'vitest'

import { adoptLiveCollectionState } from '../src/js/utils/DXFloader.js'

function group(id, methods = {}) {
  return {
    ...methods,
    attr(name) {
      if (name === 'id') return id
      if (name === 'data-collection') return 'true'
      return undefined
    },
  }
}

describe('document collection runtime adoption', () => {
  test('replaces detached staging wrappers with wrappers owned by the live SVG registry', () => {
    const stagedPrimary = group('collection-primary')
    const stagedSecondary = group('collection-secondary')
    const livePrimary = group('collection-primary', { draw: () => 'live draw plugin' })
    const liveSecondary = group('collection-secondary', { draw: () => 'live draw plugin' })
    const stage = {
      activeCollection: stagedPrimary,
      collectionIndex: 8,
      collections: new Map([
        ['collection-primary', {
          group: stagedPrimary,
          visible: true,
          locked: false,
          style: { stroke: '#ffffff' },
        }],
        ['collection-secondary', {
          group: stagedSecondary,
          visible: true,
          locked: false,
          style: { stroke: '#abcdef' },
        }],
      ]),
    }
    const editor = {
      drawing: {
        children: () => ({
          each(callback) {
            callback(livePrimary)
            callback(liveSecondary)
          },
        }),
      },
    }

    const adopted = adoptLiveCollectionState(editor, stage, 'collection-secondary')

    expect(adopted.collectionIndex).toBe(8)
    expect(adopted.activeCollection).toBe(liveSecondary)
    expect(adopted.collections.get('collection-primary')).toEqual({
      group: livePrimary,
      visible: true,
      locked: false,
      style: { stroke: '#ffffff' },
    })
    expect(adopted.collections.get('collection-primary').group.draw()).toBe('live draw plugin')
    expect(adopted.collections.get('collection-primary').style)
      .not.toBe(stage.collections.get('collection-primary').style)
  })

  test('rejects an incomplete live adoption instead of retaining a staging wrapper', () => {
    const staged = group('collection-stage')
    const stage = {
      activeCollection: staged,
      collectionIndex: 1,
      collections: new Map([['collection-stage', { group: staged, style: {} }]]),
    }
    const editor = {
      drawing: {
        children: () => ({ each() {} }),
      },
    }

    expect(() => adoptLiveCollectionState(editor, stage)).toThrow(
      'Prepared collection state does not match the adopted drawing.',
    )
  })
})
