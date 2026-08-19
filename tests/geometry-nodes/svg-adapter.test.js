// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'

import { GeometrySet2D } from '../../src/js/geometry-nodes/core/GeometrySet2D.js'
import { SvgGeometryAdapter } from '../../src/js/geometry-nodes/SvgGeometryAdapter.js'
import { SvgOutputRenderer } from '../../src/js/geometry-nodes/SvgOutputRenderer.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

describe('SVG Geometry Nodes boundary', () => {
  test('source extraction preserves semantic ids but removes interaction classes', () => {
    const source = document.createElementNS(SVG_NS, 'g')
    source.innerHTML = '<g id="27" class="room elementSelected"><line id="28" class="wall elementHover" x1="0" y1="0" x2="10" y2="0"/></g>'

    const geometry = new SvgGeometryAdapter().fromSource(source)

    expect(geometry.size).toBe(1)
    expect(geometry.items[0].svg).toContain('id="27"')
    expect(geometry.items[0].svg).toContain('id="28"')
    expect(geometry.items[0].svg).not.toContain('elementSelected')
    expect(geometry.items[0].svg).not.toContain('elementHover')
    expect(geometry.items[0].svg).toContain('class="room"')
    expect(geometry.items[0].svg).toContain('class="wall"')
  })

  test('transactional rendering emits selectable SVG leaves and affine wrappers', () => {
    const output = document.createElementNS(SVG_NS, 'g')
    const editor = { elementIndex: 40 }
    const renderer = new SvgOutputRenderer(editor)
    const geometry = new GeometrySet2D([{
      id: 'generated',
      svg: { tag: 'circle', attrs: { cx: 2, cy: 3, r: 4 } },
      matrix: [1, 0, 0, 1, 15, -2],
      style: { stroke: '#ffffff', fill: 'none' },
    }])

    renderer.render(geometry, output, { objectId: 'object-1' })

    const matrixGroup = output.firstElementChild
    const circle = matrixGroup.firstElementChild
    expect(matrixGroup.getAttribute('transform')).toBe('matrix(1 0 0 1 15 -2)')
    expect(circle.localName).toBe('circle')
    expect(circle.getAttribute('stroke')).toBe('#ffffff')
    expect(circle.getAttribute('data-gn-derived')).toBe('true')
    expect(circle.getAttribute('data-gn-object-id')).toBe('object-1')
    expect(Number(circle.id)).toBeGreaterThanOrEqual(40)
  })

  test('text descriptors render special characters as literal SVG text content', () => {
    const output = document.createElementNS(SVG_NS, 'g')
    const renderer = new SvgOutputRenderer({ elementIndex: 1 })
    const content = '<Nanquim & SVG>  desenho'
    const geometry = new GeometrySet2D([{
      id: 'generated-text',
      svg: {
        tag: 'text',
        attrs: { x: 12, y: 34, 'font-size': 18, 'text-anchor': 'middle' },
        text: content,
      },
      matrix: [1, 0, 0, 1, 0, 0],
      style: { fill: '#12abef', opacity: 0.8 },
    }])

    renderer.render(geometry, output, { objectId: 'object-text' })

    const text = output.firstElementChild
    expect(text.localName).toBe('text')
    expect(text.textContent).toBe(content)
    expect(text.children).toHaveLength(0)
    expect(text.getAttribute('fill')).toBe('#12abef')
    expect(text.getAttribute('data-gn-derived')).toBe('true')
  })

  test('a failed staged render preserves last-good output', () => {
    const output = document.createElementNS(SVG_NS, 'g')
    output.innerHTML = '<line id="existing" x1="0" y1="0" x2="1" y2="1"/>'
    const editor = { elementIndex: 7 }
    const renderer = new SvgOutputRenderer(editor)

    expect(() => renderer.render(new GeometrySet2D([{
      id: 'bad',
      svg: null,
      matrix: [1, 0, 0, 1, 0, 0],
    }]), output)).toThrow()
    expect(output.firstElementChild.id).toBe('existing')
    expect(editor.elementIndex).toBe(7)
  })

  test('each generated copy gets a unique internal id namespace', () => {
    const output = document.createElementNS(SVG_NS, 'g')
    const renderer = new SvgOutputRenderer({ elementIndex: 1 })
    const payload = [
      '<g id="shape">',
      '  <defs><clipPath id="clip"><rect id="clip-rect" width="10" height="10"/></clipPath></defs>',
      '  <rect id="visible" width="20" height="20" clip-path="url(#clip)"/>',
      '</g>',
    ].join('')
    const geometry = new GeometrySet2D([
      { id: 'copy-a', svg: payload, matrix: [1, 0, 0, 1, 0, 0] },
      { id: 'copy-b', svg: payload, matrix: [1, 0, 0, 1, 25, 0] },
    ])

    renderer.render(geometry, output, { objectId: 'object-refs' })

    const roots = Array.from(output.children)
    const clipIds = roots.map((root) => root.querySelector('clipPath').id)
    const references = roots.map((root) => root.querySelector('rect[clip-path]').getAttribute('clip-path'))
    expect(new Set(clipIds).size).toBe(2)
    expect(references).toEqual(clipIds.map((id) => `url(#${id})`))
    expect(output.querySelectorAll('[data-nanquim-preserve-id="true"]').length).toBeGreaterThan(0)
  })
})
