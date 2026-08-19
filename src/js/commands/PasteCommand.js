import { Command } from '../Command'
import {
  markupFitsSvgElementBudget,
  parseSafeJson,
  remapSvgIds,
  sanitizeSvgDocument,
} from '../utils/sanitizeSvg'

const MAX_CLIPBOARD_ITEMS = 1000
const MAX_CLIPBOARD_SVG_LENGTH = 16 * 1024 * 1024
const MAX_CLIPBOARD_SVG_ELEMENTS = 100000
const SVG_NS = 'http://www.w3.org/2000/svg'
let pasteScopeIndex = 0

function markupFitsElementBudget(source, maxElements) {
  return markupFitsSvgElementBudget(source, maxElements)
}

function reserveClipboardSvgElements(documentRef, budget, { rootIsImported = false } = {}) {
  // A full <svg> paste keeps its parsed root and also gains the structural CSS
  // scope wrapper. Fragment pastes discard the synthetic root, so their new
  // wrapper replaces (rather than adds to) the parsed element count.
  const count = documentRef.getElementsByTagName('*').length + (rootIsImported ? 1 : 0)
  if (count > budget.remaining) return false
  budget.remaining -= count
  return true
}

function nextPasteScope(documentRef) {
  let token
  do {
    pasteScopeIndex += 1
    token = `nanquim-paste-${pasteScopeIndex}`
  } while (documentRef.querySelector(`[data-nanquim-paste-scope="${token}"]`))
  return token
}

function nextPasteDanglingId(documentRef, scopeToken) {
  let index = 0
  let id
  do {
    id = `nanquim-unresolved-paste-${scopeToken}-${index++}`
  } while (documentRef.getElementById(id))
  return id
}

function stripPasteReservedAttributes(root) {
  const pending = [root]
  while (pending.length > 0) {
    const element = pending.pop()
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase()
      if (
        name === 'data-geometry-nodes'
        || name.startsWith('data-gn-')
        || name === 'data-nanquim-paste-scope'
      ) {
        element.removeAttributeNode(attribute)
      }
    })
    const children = Array.from(element.children)
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index])
  }
}

class PasteCommand extends Command {
  constructor(editor, data) {
    super(editor)
    this.type = 'PasteCommand'
    this.name = 'Paste'
    this.data = data
    this.pastedElements = []
    this._pasteRecords = []
    this.parent = editor.activeCollection || editor.drawing
  }

  execute() {
    this.pastedElements = []
    this._pasteRecords = []

    const items = Array.isArray(this.data && this.data.elements)
      ? this.data.elements.slice(0, MAX_CLIPBOARD_ITEMS)
      : []
    let remainingLength = MAX_CLIPBOARD_SVG_LENGTH
    const elementBudget = { remaining: MAX_CLIPBOARD_SVG_ELEMENTS }

    items.forEach(item => {
      if (!item || typeof item.svg !== 'string' || item.svg.length > remainingLength) return
      remainingLength -= item.svg.length
      const original = item.svg.trim()
      if (!original || /<!DOCTYPE\b/i.test(original)) return
      // Bound likely element starts before DOMParser materializes the tree.
      // The extra structural scope wrapper consumes one element from the
      // command-wide budget for both full SVGs and fragments.
      if (!markupFitsElementBudget(original, elementBudget.remaining - 1)) return

      const wrappedFragment = !/^<svg(?:\s|>)/i.test(original)
      const svgStr = wrappedFragment
        ? `<svg xmlns="${SVG_NS}">${original}</svg>`
        : original
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgStr, 'image/svg+xml')
      if (doc.documentElement.nodeName === 'parsererror' || doc.querySelector('parsererror')) return
      if (!reserveClipboardSvgElements(doc, elementBudget, { rootIsImported: !wrappedFragment })) return

      let sourceRoot
      const hostDocument = this.parent.node.ownerDocument
      const scopeToken = nextPasteScope(hostDocument)
      const scopeSelector = `[data-nanquim-paste-scope="${scopeToken}"]`
      try {
        sourceRoot = sanitizeSvgDocument(doc, {
          scopeSelector,
          // Fragment pastes discard their synthetic <svg>, so the scope
          // wrapper replaces that stylesheet root. A full SVG retains its root
          // one level below the wrapper and rooted selectors must keep it.
          stylesheetRootSelector: wrappedFragment ? scopeSelector : `${scopeSelector} > svg`,
        })
      } catch (error) {
        return
      }
      stripPasteReservedAttributes(sourceRoot)

      const candidates = wrappedFragment
        ? Array.from(sourceRoot.children)
        : [doc.documentElement]
      if (candidates.length === 0) return

      // Allocate all IDs in one pass before adoption, so references can cross
      // sibling fragment roots (for example a <defs> followed by a <rect>).
      // References missing from the pasted forest must not fall through to a
      // same-named target in the host drawing or its app-owned definitions.
      const danglingId = nextPasteDanglingId(hostDocument, scopeToken)
      remapSvgIds(candidates, () => this.editor.elementIndex++, { danglingId })

      // A dedicated structural wrapper makes imported CSS incapable of
      // styling earlier/later paste operations while remaining transparent to
      // Nanquim's selection traversal (it is not an explicit data-group).
      const container = document.createElementNS(SVG_NS, 'g')
      container.setAttribute('data-nanquim-paste-scope', scopeToken)
      const record = { container, elements: [] }
      const adoptedNodes = candidates.map((rawNode) => document.adoptNode(rawNode))
      adoptedNodes.forEach((node) => container.appendChild(node))
      // SVG.js needs a retained nested <svg> to have a live SVG ancestor while
      // it creates the wrapper instance. Markup is already fully sanitized,
      // scoped and ID-remapped before this insertion.
      this.parent.node.appendChild(container)

      try {
        const hydrateTree = (rootElement) => {
          const pending = [rootElement]
          while (pending.length > 0) {
            const current = pending.pop()
            const currentId = current.attr('id')
            if (!current.attr('name')) {
              const currentName = current.node.nodeName
              const typeName = currentName.charAt(0).toUpperCase() + currentName.slice(1)
              current.attr('name', `${typeName} ${currentId}`)
            }
            Array.from(current.node.attributes).forEach(attr => {
              if (!attr.name.startsWith('data-')) return
              const key = attr.name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
              const value = parseSafeJson(attr.value, { maxLength: 1024 * 1024, maxDepth: 32, maxNodes: 50000 })
              if (value !== null) current.data(key, value)
              else if (/^\s*[{[]/.test(attr.value)) current.node.removeAttribute(attr.name)
              else current.data(key, attr.value)
            })
            if (current.children) {
              const children = Array.from(current.children())
              for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index])
            }
          }
        }
        adoptedNodes.forEach((node) => {
          const el = SVG(node)
          hydrateTree(el)
          record.elements.push(el)
        })
      } catch (error) {
        container.remove()
        return
      }

      this.pastedElements.push(...record.elements)
      this._pasteRecords.push(record)
    })

    if (this.pastedElements.length > 0) {
      this.editor.spatialIndex.markDirty()
      this.editor.signals.clearSelection.dispatch()
      this.editor.selected = this.pastedElements.slice()
      this.editor.signals.updatedSelection.dispatch()
      this.editor.signals.updatedOutliner.dispatch()
      this.editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Pasted ${this.pastedElements.length} element(s).` })
    }
  }

  undo() {
    this.pastedElements.forEach(el => this.editor.removeElement(el))
    this._pasteRecords.forEach(({ container }) => container.remove())
    this.editor.signals.clearSelection.dispatch()
    this.editor.signals.updatedOutliner.dispatch()
    this.editor.signals.terminalLogged.dispatch({ type: 'span', msg: 'Undo: Paste removed.' })
  }

  redo() {
    this._pasteRecords.forEach(({ container, elements }) => {
      this.parent.node.appendChild(container)
      elements.forEach((element) => container.appendChild(element.node))
    })
    this.editor.spatialIndex.markDirty()
    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = this.pastedElements.slice()
    this.editor.signals.updatedSelection.dispatch()
    this.editor.signals.updatedOutliner.dispatch()
    this.editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Redo: Pasted ${this.pastedElements.length} element(s).` })
  }
}

export {
  MAX_CLIPBOARD_SVG_ELEMENTS,
  PasteCommand,
  markupFitsElementBudget,
  nextPasteDanglingId,
  reserveClipboardSvgElements,
}
