// @vitest-environment jsdom

import { SVG, registerWindow } from '@svgdotjs/svg.js'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  MAX_CLIPBOARD_SVG_ELEMENTS,
  PasteCommand,
  markupFitsElementBudget,
  nextPasteDanglingId,
  reserveClipboardSvgElements,
} from '../src/js/commands/PasteCommand.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

function createSignal() {
  return { dispatch: vi.fn() }
}

function createEditor() {
  const svg = SVG().addTo(document.body)
  const drawing = svg.group().attr('id', 'Collection')
  const collection = drawing.group().attr({ id: 'collection-test', 'data-collection': 'true' })
  return {
    svg,
    drawing,
    activeCollection: collection,
    elementIndex: 100,
    selected: [],
    spatialIndex: { markDirty: vi.fn() },
    signals: new Proxy({}, {
      get(target, key) {
        if (!target[key]) target[key] = createSignal()
        return target[key]
      },
    }),
    removeElement: vi.fn((element) => element.remove()),
  }
}

function mountCssProbe(css) {
  const style = document.createElement('style')
  style.setAttribute('data-paste-css-probe', 'true')
  style.textContent = css
  document.head.appendChild(style)
  return style
}

describe('secure SVG clipboard paste', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    document.head.querySelectorAll('[data-paste-css-probe]').forEach((node) => node.remove())
    registerWindow(window, document)
    globalThis.SVG = SVG
  })

  test('removes active content while preserving safe defs, geometry, styles and local references', () => {
    const editor = createEditor()
    const command = new PasteCommand(editor, {
      nanquimClipboard: true,
      elements: [{
        svg: `
          <g xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" id="clipboard-root"
             data-safe='{"ok":true}' data-unsafe='{"constructor":{"prototype":{"polluted":true}}}'
             data-geometry-nodes="true" data-gn-instance-id="spoofed-modifier"
             data-nanquim-paste-scope="spoofed-scope">
            <defs>
              <linearGradient id="paint"><stop offset="0" stop-color="#fff"/></linearGradient>
              <style>
                body, #shape, .wall, [href="#shape"] { fill:url(#paint); stroke:#123456 }
                [fill="#fff"] { opacity:.4 }
                + #Handlers { display:none }
                .remote { mask:image-set("https://example.test/mask.png" 1x) }
              </style>
            </defs>
            <rect id="shape" class="wall" width="20" height="10" fill="url(#paint)" onclick="bad()"
              data-gn-source="true" data-gn-object-id="spoofed-object"/>
            <circle id="fff" data-color-id="true" r="1"/>
            <circle id="color-probe" fill="#fff" r="1"/>
            <use id="copy" href="#shape"/>
            <use id="remote" xlink:href="https://example.test/file.svg#shape"/>
            <image id="network-image" href="//example.test/pixel.png"/>
            <foreignObject><p xmlns="http://www.w3.org/1999/xhtml">bad</p></foreignObject>
            <script>window.clipboardPwned = true</script>
          </g>
        `,
      }],
    })

    command.execute()

    expect(command.pastedElements).toHaveLength(1)
    const root = command.pastedElements[0]
    const gradient = root.node.querySelector('linearGradient')
    const shape = root.node.querySelector('rect.wall')
    const localUse = root.node.querySelector('use:not([data-remote])')
    const colorProbe = root.node.querySelector('#color-probe') || root.node.querySelector('[fill="#fff"]')
    const uses = root.node.querySelectorAll('use')
    const remoteUse = uses[1]
    const networkImage = root.node.querySelector('image')
    const style = root.node.querySelector('style').textContent
    const container = root.node.parentElement
    const scopeToken = container.getAttribute('data-nanquim-paste-scope')
    const scopeSelector = `[data-nanquim-paste-scope="${scopeToken}"]`

    expect(root.node.querySelector('script, foreignObject')).toBeNull()
    expect(root.node.querySelector('[onclick], [onload]')).toBeNull()
    expect(remoteUse.hasAttributeNS(XLINK_NS, 'href')).toBe(false)
    expect(networkImage.hasAttribute('href')).toBe(false)

    expect(shape.getAttribute('fill')).toBe(`url(#${gradient.id})`)
    expect(localUse.getAttribute('href')).toBe(`#${shape.id}`)
    expect(style).toContain(`${scopeSelector} [id="${shape.id}"]`)
    expect(style).toContain(`${scopeSelector} [href="#${shape.id}"]`)
    expect(style).toContain(`${scopeSelector} [fill="#fff"]`)
    expect(style).toContain(`fill:url(#${gradient.id})`)
    expect(style).toContain(`${scopeSelector} body`)
    expect(style).not.toMatch(/#Handlers|image-set|https?:/i)
    expect(document.querySelector(`${scopeSelector} [id="${shape.id}"]`)).toBe(shape)
    const cssProbe = mountCssProbe(style)
    expect(Array.from(cssProbe.sheet.cssRules).some((rule) => rule.selectorText.includes(`[id="${shape.id}"]`))).toBe(true)
    expect(getComputedStyle(shape).stroke).toMatch(/#123456|18\D+52\D+86/)
    expect(getComputedStyle(colorProbe).opacity).toBe('0.4')
    cssProbe.remove()

    const pastedNodes = [root.node, ...root.node.querySelectorAll('*')]
    expect(pastedNodes.some((node) => node.hasAttribute('data-geometry-nodes'))).toBe(false)
    expect(pastedNodes.some((node) => (
      Array.from(node.attributes).some((attribute) => attribute.name.toLowerCase().startsWith('data-gn-'))
    ))).toBe(false)
    expect(editor.drawing.node.querySelector('[data-geometry-nodes="true"]')).toBeNull()
    expect(scopeToken).not.toBe('spoofed-scope')

    const ids = Array.from(root.node.querySelectorAll('[id]'), (element) => element.id)
    ids.push(root.attr('id'))
    expect(ids.every((id) => /^\d+$/.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    expect(root.data('safe')).toEqual({ ok: true })
    expect(root.node.hasAttribute('data-unsafe')).toBe(false)
    expect(root.data('unsafe')).toBeUndefined()
    expect({}.polluted).toBeUndefined()
  })

  test('skips malformed and structurally oversized items but continues with a safe item', () => {
    const editor = createEditor()
    const deep = `${'<g>'.repeat(130)}<path d="M0 0L1 1"/>${'</g>'.repeat(130)}`
    const command = new PasteCommand(editor, {
      elements: [
        { svg: '<g><path></g>' },
        { svg: deep },
        { svg: `<circle xmlns="${SVG_NS}" data-test="safe-last" cx="2" cy="2" r="1"/>` },
      ],
    })

    command.execute()

    expect(command.pastedElements).toHaveLength(1)
    expect(editor.activeCollection.node.querySelector('[data-test="safe-last"]')).not.toBeNull()
    expect(editor.elementIndex).toBe(101)
  })

  test('enforces a shared SVG element budget across clipboard items', () => {
    expect(MAX_CLIPBOARD_SVG_ELEMENTS).toBe(100000)
    const parser = new DOMParser()
    const budget = { remaining: 4 }
    const first = parser.parseFromString(`<svg xmlns="${SVG_NS}"><g><path/></g></svg>`, 'image/svg+xml')
    const second = parser.parseFromString(`<svg xmlns="${SVG_NS}"><circle/></svg>`, 'image/svg+xml')
    const third = parser.parseFromString(`<svg xmlns="${SVG_NS}"/>`, 'image/svg+xml')

    expect(reserveClipboardSvgElements(first, budget, { rootIsImported: false })).toBe(true)
    expect(budget.remaining).toBe(1)
    expect(reserveClipboardSvgElements(second, budget, { rootIsImported: false })).toBe(false)
    expect(budget.remaining).toBe(1)
    expect(reserveClipboardSvgElements(third, budget, { rootIsImported: false })).toBe(true)
    expect(budget.remaining).toBe(0)

    const fullSvgBudget = { remaining: 1 }
    expect(reserveClipboardSvgElements(third, fullSvgBudget, { rootIsImported: true })).toBe(false)

    expect(markupFitsElementBudget('<g><path/><circle/></g>', 3)).toBe(true)
    expect(markupFitsElementBudget('<g><path/><circle/></g>', 2)).toBe(false)
    expect(markupFitsElementBudget('<g><é/><路径/></g>', 3)).toBe(true)
    expect(markupFitsElementBudget('<g><é/><路径/></g>', 2)).toBe(false)
  })

  test('scopes each pasted stylesheet to only its own structural container', () => {
    const editor = createEditor()
    const command = new PasteCommand(editor, {
      elements: [
        {
          svg: `<g xmlns="${SVG_NS}"><style>.shared{opacity:.25}</style><rect class="shared" data-item="one" width="2" height="2"/></g>`,
        },
        {
          svg: `<rect xmlns="${SVG_NS}" class="shared" data-item="two" width="2" height="2"/>`,
        },
      ],
    })

    command.execute()

    const first = editor.activeCollection.node.querySelector('[data-item="one"]')
    const second = editor.activeCollection.node.querySelector('[data-item="two"]')
    const firstContainer = first.closest('[data-nanquim-paste-scope]')
    const secondContainer = second.closest('[data-nanquim-paste-scope]')
    const css = firstContainer.querySelector('style').textContent
    const firstScope = firstContainer.getAttribute('data-nanquim-paste-scope')

    expect(firstContainer).not.toBe(secondContainer)
    expect(css).toContain(`[data-nanquim-paste-scope="${firstScope}"] .shared`)
    const cssProbe = mountCssProbe(css)
    expect(getComputedStyle(first).opacity).toBe('0.25')
    expect(getComputedStyle(second).opacity).not.toBe('0.25')
    cssProbe.remove()
  })

  test('redirects missing local references away from host SVG targets', () => {
    const editor = createEditor()
    const hostGradient = document.createElementNS(SVG_NS, 'linearGradient')
    hostGradient.setAttribute('id', 'host-paint')
    editor.svg.defs().node.appendChild(hostGradient)

    const collisionScope = 'collision-probe'
    const collidingHost = document.createElementNS(SVG_NS, 'g')
    collidingHost.setAttribute('id', `nanquim-unresolved-paste-${collisionScope}-0`)
    editor.svg.node.appendChild(collidingHost)
    expect(nextPasteDanglingId(document, collisionScope)).toBe(
      `nanquim-unresolved-paste-${collisionScope}-1`,
    )

    const command = new PasteCommand(editor, {
      elements: [{
        svg: `
          <g xmlns="${SVG_NS}">
            <style>.host-reference{fill:url(#host-paint);stroke:url('#Collection')}</style>
            <use data-host-use="true" href="#Collection"/>
            <rect class="host-reference" data-host-presentation="true"
              fill="url(#host-paint)" style="stroke:url(#Collection)"/>
          </g>
        `,
      }],
    })

    command.execute()

    expect(command.pastedElements).toHaveLength(1)
    const pasted = command.pastedElements[0].node
    const hostUse = pasted.querySelector('[data-host-use="true"]')
    const presentation = pasted.querySelector('[data-host-presentation="true"]')
    const danglingReference = hostUse.getAttribute('href')
    const danglingId = danglingReference.slice(1)
    const css = pasted.querySelector('style').textContent

    expect(danglingReference).toMatch(/^#nanquim-unresolved-paste-/)
    expect(document.getElementById(danglingId)).toBeNull()
    expect(presentation.getAttribute('fill')).toBe(`url(#${danglingId})`)
    expect(presentation.getAttribute('style')).toBe(`stroke:url(#${danglingId})`)
    expect(css).toContain(`fill:url(#${danglingId})`)
    expect(css).toContain(`stroke:url('#${danglingId}')`)
    expect(css).not.toMatch(/url\(\s*['"]?#(?:Collection|host-paint)/)
  })

  test('keeps rooted stylesheet selectors aligned with a retained full SVG root', () => {
    const editor = createEditor()
    const command = new PasteCommand(editor, {
      elements: [{
        svg: `<svg xmlns="${SVG_NS}"><style>svg > rect,:root > circle{opacity:.2}</style><rect data-rooted="rect" width="2" height="2"/><circle data-rooted="circle" r="1"/></svg>`,
      }],
    })

    command.execute()

    expect(command.pastedElements).toHaveLength(1)
    const pastedSvg = command.pastedElements[0].node
    const container = pastedSvg.parentElement
    const scope = `[data-nanquim-paste-scope="${container.getAttribute('data-nanquim-paste-scope')}"]`
    const css = pastedSvg.querySelector('style').textContent
    const rect = pastedSvg.querySelector('[data-rooted="rect"]')
    const circle = pastedSvg.querySelector('[data-rooted="circle"]')

    expect(css).toContain(`${scope} > svg > rect`)
    expect(css).toContain(`${scope} > svg > circle`)
    const cssProbe = mountCssProbe(css)
    expect(getComputedStyle(rect).opacity).toBe('0.2')
    expect(getComputedStyle(circle).opacity).toBe('0.2')
    cssProbe.remove()
  })

  test('undo and redo preserve the sanitized nodes and repaired references', () => {
    const editor = createEditor()
    const command = new PasteCommand(editor, {
      elements: [{
        svg: `
          <g xmlns="${SVG_NS}">
            <defs><clipPath id="clip"><rect width="5" height="5"/></clipPath></defs>
            <rect data-test="clipped" width="10" height="10" clip-path="url(#clip)"/>
          </g>
        `,
      }],
    })

    command.execute()
    const pastedNode = command.pastedElements[0].node
    const pasteContainer = pastedNode.parentNode
    const clipId = pastedNode.querySelector('clipPath').id
    expect(pastedNode.querySelector('[data-test="clipped"]').getAttribute('clip-path')).toBe(`url(#${clipId})`)

    command.undo()
    expect(editor.activeCollection.node.contains(pastedNode)).toBe(false)
    expect(editor.activeCollection.node.contains(pasteContainer)).toBe(false)

    command.redo()
    expect(editor.activeCollection.node.contains(pastedNode)).toBe(true)
    expect(pastedNode.parentNode).toBe(pasteContainer)
    expect(pastedNode.querySelector('[data-test="clipped"]').getAttribute('clip-path')).toBe(`url(#${clipId})`)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(2)
  })
})
