// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'

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

  test('reserved manager metadata cannot be collected or reinjected on a live output root', () => {
    const source = document.createElementNS(SVG_NS, 'g')
    source.innerHTML = [
      '<g id="spoof-root" class="scoped" data-user-note="safe"',
      ' data-geometry-nodes="true" data-gn-output="true"',
      ' data-nanquim-preserve-id="false" data-nanquim-style-scope="raw-attacker">',
      '<style>.scoped{opacity:.4}</style><rect class="scoped" width="2" height="2"/>',
      '</g>',
    ].join('')
    const adapted = new SvgGeometryAdapter().fromSource(source)

    expect(adapted.items[0].metadata).toEqual({ 'data-user-note': 'safe' })

    const crafted = new GeometrySet2D([{
      ...adapted.items[0],
      metadata: {
        ...adapted.items[0].metadata,
        'data-geometry-nodes': 'true',
        'data-gn-object-id': 'spoofed-object',
        'data-gn-output': 'true',
        'data-nanquim-preserve-id': 'false',
        'data-nanquim-style-scope': 'raw-attacker',
      },
    }])
    const svg = document.createElementNS(SVG_NS, 'svg')
    const output = document.createElementNS(SVG_NS, 'g')
    svg.appendChild(output)
    document.body.appendChild(svg)

    new SvgOutputRenderer({ elementIndex: 1 }).render(crafted, output, {
      objectId: 'canonical-object',
    })

    const liveRoot = output.firstElementChild
    const scopeToken = liveRoot.getAttribute('data-nanquim-style-scope')
    expect(liveRoot.getAttribute('data-user-note')).toBe('safe')
    expect(scopeToken).toMatch(/^gns-/)
    expect(scopeToken).not.toBe('raw-attacker')
    expect(liveRoot.querySelector('style').textContent).toContain(
      `[data-nanquim-style-scope="${scopeToken}"] .scoped`,
    )
    expect(output.querySelector('[data-geometry-nodes], [data-gn-output]')).toBeNull()
    expect(output.querySelector('[data-gn-object-id="spoofed-object"]')).toBeNull()
    expect(output.querySelectorAll('[data-gn-object-id="canonical-object"]').length).toBeGreaterThan(0)
    expect(output.querySelector('[data-nanquim-preserve-id="false"]')).toBeNull()
    expect(output.querySelector('[data-nanquim-preserve-id="true"]')).not.toBeNull()

    svg.remove()
  })

  test('preflights source item and subtree budgets before cloning or serializing', () => {
    const source = document.createElementNS(SVG_NS, 'g')
    source.innerHTML = '<g><line/><line/></g><circle r="2"/>'
    const cloneSpy = vi.spyOn(source.firstElementChild, 'cloneNode')
    const adapter = new SvgGeometryAdapter()

    expect(() => adapter.fromSource(source, {
      limits: { maxItems: 1 },
    })).toThrow(/safe item limit/)
    expect(cloneSpy).not.toHaveBeenCalled()

    const budget = {
      remainingSourceItems: 10,
      remainingSourceElements: 2,
      remainingSourceTextLength: 100,
      remainingSourceAttributeLength: 100,
      remainingSourceSerializedLength: 1000,
    }
    expect(() => adapter.fromSource(source, { budget })).toThrow(/source-element limit/)
    expect(budget.remainingSourceElements).toBe(0)
    expect(cloneSpy).not.toHaveBeenCalled()
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

  test('drops unsafe generated paint values at the final SVG render boundary', () => {
    const output = document.createElementNS(SVG_NS, 'g')
    const renderer = new SvgOutputRenderer({ elementIndex: 1 })
    const geometry = new GeometrySet2D([{
      id: 'unsafe-style',
      svg: { tag: 'rect', attrs: { width: 20, height: 10 } },
      style: {
        fill: 'url(https://example.test/paint.svg#gradient)',
        stroke: 'image-set("https://example.test/line.png" 1x)',
        onclick: 'alert(1)',
        opacity: 0.7,
      },
    }])

    renderer.render(geometry, output)

    const rect = output.firstElementChild
    expect(rect.hasAttribute('fill')).toBe(false)
    expect(rect.hasAttribute('stroke')).toBe(false)
    expect(rect.hasAttribute('onclick')).toBe(false)
    expect(rect.getAttribute('opacity')).toBe('0.7')
  })

  test('sanitizes arbitrary SVG payloads before importing them into the live output document', () => {
    const output = document.createElementNS(SVG_NS, 'g')
    const renderer = new SvgOutputRenderer({ elementIndex: 1 })
    const geometry = new GeometrySet2D([
      {
        id: 'hostile-payload',
        svg: [
          '<g>',
          '<script>window.geometryNodesPwned=true</script>',
          '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">bad</div></foreignObject>',
          '<image href="https://example.test/tracker.png" onload="alert(1)"/>',
          '<line data-test="safe-line" x1="0" y1="0" x2="10" y2="0"/>',
          '</g>',
        ].join(''),
      },
      {
        id: 'hostile-descriptor',
        svg: {
          tag: 'image',
          attrs: { href: '//example.test/descriptor.png', onerror: 'alert(2)' },
        },
      },
    ])

    renderer.render(geometry, output)

    expect(output.querySelector('[data-test="safe-line"]')).not.toBeNull()
    expect(output.querySelector('script, foreignObject')).toBeNull()
    expect(output.querySelector('[onload], [href^="http"]')).toBeNull()
    expect(Array.from(output.querySelectorAll('image')).every((image) => !image.hasAttribute('href'))).toBe(true)
  })

  test('counts Unicode XML start names before parsing generated SVG payloads', () => {
    const output = document.createElementNS(SVG_NS, 'g')
    output.innerHTML = '<line id="last-good" x1="0" y1="0" x2="1" y2="1"/>'
    const renderer = new SvgOutputRenderer({ elementIndex: 1 }, { limits: { maxElements: 2 } })
    const geometry = new GeometrySet2D([{
      id: 'unicode-element-bomb',
      svg: '<é/><路径/><g/>',
    }])
    const parseSpy = vi.spyOn(DOMParser.prototype, 'parseFromString')

    try {
      expect(() => renderer.render(geometry, output)).toThrow(/safe element limit/)
      expect(parseSpy).not.toHaveBeenCalled()
      expect(output.firstElementChild.id).toBe('last-good')
    } finally {
      parseSpy.mockRestore()
    }
  })

  test('scopes generated styles to their own rendered geometry item', () => {
    const host = document.createElementNS(SVG_NS, 'g')
    host.setAttribute('id', 'Collection')
    host.innerHTML = '<rect data-test="existing" class="shared" width="2" height="2"/>'
    const output = document.createElementNS(SVG_NS, 'g')
    host.appendChild(output)
    document.body.appendChild(document.createElementNS(SVG_NS, 'svg')).appendChild(host)
    const renderer = new SvgOutputRenderer({ elementIndex: 1 })
    const styledGeometry = new GeometrySet2D([{
      id: 'styled-item',
      svg: '<style>.shared,#styled-shape{opacity:.25}</style><rect id="styled-shape" class="shared" width="2" height="2" data-geometry-nodes="true" data-gn-instance-id="spoofed"/>',
    }])

    renderer.render(styledGeometry, output, { objectId: 'styled-object' })

    const renderedRoot = output.firstElementChild
    const renderedShape = renderedRoot.querySelector('rect.shared')
    const scopeToken = renderedRoot.getAttribute('data-nanquim-style-scope')
    const css = renderedRoot.querySelector('style').textContent
    expect(scopeToken).toMatch(/^gns-/)
    expect(css).toContain(`[data-nanquim-style-scope="${scopeToken}"] .shared`)
    expect(css).toContain(`[id="${renderedShape.id}"]`)
    expect(css).not.toContain('#styled-shape')
    expect(css).not.toContain('#Collection .shared')
    expect(host.querySelector('[data-test="existing"]').hasAttribute('data-nanquim-style-scope')).toBe(false)
    expect(renderedShape.hasAttribute('data-geometry-nodes')).toBe(false)
    expect(renderedShape.hasAttribute('data-gn-instance-id')).toBe(false)
    expect(renderedShape.getAttribute('data-gn-derived')).toBe('true')
    expect(renderedShape.matches(`[data-nanquim-style-scope="${scopeToken}"] .shared`)).toBe(true)
    expect(host.querySelector('[data-test="existing"]').matches(
      `[data-nanquim-style-scope="${scopeToken}"] .shared`,
    )).toBe(false)

    const secondOutput = document.createElementNS(SVG_NS, 'g')
    renderer.render(styledGeometry, secondOutput, { objectId: 'styled-object' })
    expect(secondOutput.firstElementChild.getAttribute('data-nanquim-style-scope')).not.toBe(scopeToken)
  })

  test('bounded staging preserves last-good output when generated geometry expands too far', () => {
    const output = document.createElementNS(SVG_NS, 'g')
    output.innerHTML = '<line id="last-good" x1="0" y1="0" x2="1" y2="1"/>'
    const editor = { elementIndex: 9 }
    const renderer = new SvgOutputRenderer(editor, {
      limits: {
        maxItems: 2,
        maxElements: 3,
        maxTextLength: 8,
        maxTotalPayloadLength: 32,
      },
    })

    expect(() => renderer.render(new GeometrySet2D([{
      id: 'too-much-text',
      svg: { tag: 'text', text: 'more than eight characters' },
    }]), output)).toThrow(/safe text limit/)
    expect(output.firstElementChild.id).toBe('last-good')
    expect(editor.elementIndex).toBe(9)

    expect(() => renderer.render(new GeometrySet2D([
      { id: 'one', svg: { tag: 'line' } },
      { id: 'two', svg: { tag: 'line' } },
      { id: 'three', svg: { tag: 'line' } },
    ]), output)).toThrow(/safe item limit/)
    expect(output.firstElementChild.id).toBe('last-good')

    expect(() => renderer.render(new GeometrySet2D([
      { id: 'payload-a', svg: '<path d="M0 0L1 1"/>' },
      { id: 'payload-b', svg: '<path d="M0 0L1 1"/>' },
    ]), output)).toThrow(/safe total SVG payload limit/)
    expect(output.firstElementChild.id).toBe('last-good')
  })

  test('rejects attribute amplification before applying styles or derived object metadata', () => {
    const output = document.createElementNS(SVG_NS, 'g')
    output.innerHTML = '<line id="last-good" x1="0" y1="0" x2="1" y2="1"/>'
    const editor = { elementIndex: 9 }
    const renderer = new SvgOutputRenderer(editor, {
      limits: { maxAttributeLength: 20, maxIdentifierLength: 16 },
    })
    const styled = new GeometrySet2D([{
      id: 'style-bomb',
      svg: {
        tag: 'g',
        children: [{ tag: 'line' }, { tag: 'line' }],
      },
      style: { stroke: '#ffffff' },
    }])

    expect(() => renderer.render(styled, output)).toThrow(/style exceeds.*attribute limit/i)
    expect(output.firstElementChild.id).toBe('last-good')
    expect(editor.elementIndex).toBe(9)

    expect(() => renderer.render(new GeometrySet2D([{
      id: 'safe-id',
      svg: { tag: 'line' },
    }]), output, { objectId: 'x'.repeat(17) })).toThrow(/object identifier.*length limit/i)
    expect(output.firstElementChild.id).toBe('last-good')
    expect(editor.elementIndex).toBe(9)
  })

  test('shares a transactional render budget across restored modifier instances', () => {
    const firstOutput = document.createElementNS(SVG_NS, 'g')
    const secondOutput = document.createElementNS(SVG_NS, 'g')
    secondOutput.innerHTML = '<circle id="cached" r="2"/>'
    const renderer = new SvgOutputRenderer({ elementIndex: 1 })
    const budget = {
      remainingItems: 2,
      remainingElements: 1,
      remainingTextLength: 100,
      remainingAttributeLength: 1000,
      remainingPayloadLength: 1000,
    }
    const line = new GeometrySet2D([{ id: 'line', svg: { tag: 'line' } }])

    renderer.render(line, firstOutput, { budget })
    expect(firstOutput.querySelector('line')).not.toBeNull()
    expect(budget.remainingElements).toBe(0)
    expect(budget.remainingItems).toBe(1)

    expect(() => renderer.render(line, secondOutput, { budget })).toThrow(/safe SVG element (?:limit|budget)/)
    expect(secondOutput.firstElementChild.id).toBe('cached')
    expect(budget.remainingElements).toBe(0)
    expect(budget.remainingItems).toBe(0)
  })

  test('charges failed SVG parsing attempts so a load batch cannot repeat them indefinitely', () => {
    const output = document.createElementNS(SVG_NS, 'g')
    output.innerHTML = '<line id="cached"/>'
    const renderer = new SvgOutputRenderer({ elementIndex: 1 })
    const invalid = new GeometrySet2D([{ id: 'invalid', svg: '<g>' }])
    const budget = {
      remainingItems: 2,
      remainingElements: 100,
      remainingTextLength: 100,
      remainingAttributeLength: 1000,
      remainingPayloadLength: 7,
    }

    expect(() => renderer.render(invalid, output, { budget })).toThrow(/Invalid SVG geometry|unexpected close tag/)
    expect(budget.remainingPayloadLength).toBe(4)
    expect(output.firstElementChild.id).toBe('cached')

    expect(() => renderer.render(invalid, output, { budget })).toThrow(/Invalid SVG geometry|unexpected close tag/)
    expect(budget.remainingPayloadLength).toBe(1)
    expect(output.firstElementChild.id).toBe('cached')

    expect(() => renderer.render(invalid, output, { budget })).toThrow(/render-item limit|payload limit/)
    expect(budget.remainingItems).toBe(0)
    expect(output.firstElementChild.id).toBe('cached')
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
