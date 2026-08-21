import { Matrix } from '@svgdotjs/svg.js'

import { Command } from '../Command'
import {
  applyCollectionStyleToElement,
  getElementOverrides,
  setElementOverrides,
} from '../Collection'

function childIndex(element) {
  const parent = element.parent()
  return parent ? Array.from(parent.node.children).indexOf(element.node) : -1
}

function captureElementState(element) {
  return {
    attributes: Array.from(element.node.attributes, ({ name, value }) => ({ name, value })),
    element,
    index: childIndex(element),
    parent: element.parent(),
  }
}

function restoreElementAttributes({ attributes, element }) {
  Array.from(element.node.attributes).forEach(({ name }) => element.node.removeAttribute(name))
  attributes.forEach(({ name, value }) => element.node.setAttribute(name, value))
}

function restoreStates(states) {
  states.forEach(restoreElementAttributes)
  const byParent = new Map()
  states.forEach((state) => {
    if (!byParent.has(state.parent)) byParent.set(state.parent, [])
    byParent.get(state.parent).push(state)
  })
  byParent.forEach((entries) => {
    entries
      .sort((left, right) => left.index - right.index)
      .forEach(({ element, index, parent }) => {
        const reference = index >= 0 ? parent.node.children[index] || null : null
        parent.node.insertBefore(element.node, reference)
      })
  })
}

function restoreStatesTransaction(states, rollbackStates) {
  try {
    restoreStates(states)
  } catch (error) {
    try {
      restoreStates(rollbackStates)
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `${error.message} Restoring the previous Match Properties state also failed.`,
      )
    }
    throw error
  }
}

class MatchPropertiesMutation extends Command {
  constructor(editor, elements, properties) {
    super(editor)
    this.type = 'MatchPropertiesMutation'
    this.name = 'Match Properties'
    this.elements = [...elements]
    this.properties = {
      ...properties,
      overrides: { ...properties.overrides },
    }
    this.before = this.elements.map(captureElementState)
    this.after = null
    this.selectionBefore = [...editor.selected]
  }

  execute() {
    if (this.elements.length === 0) {
      throw new TypeError('Match Properties requires at least one target.')
    }

    try {
      this.elements.forEach((element) => this._applyToElement(element))
      this.after = this.elements.map(captureElementState)
    } catch (error) {
      restoreStates(this.before)
      throw error
    }
    this._notify([], `Properties applied to ${this.elements.length} element(s).`)
  }

  undo() {
    restoreStatesTransaction(this.before, this.after)
    this._notify(this.selectionBefore, `Undo: restored ${this.elements.length} element(s).`)
  }

  redo() {
    restoreStatesTransaction(this.after, this.before)
    this._notify([], `Redo: properties applied to ${this.elements.length} element(s).`)
  }

  _applyToElement(element) {
    const props = this.properties
    if (props.fill) element.css('fill', props.fill)
    if (props.stroke) element.css('stroke', props.stroke)
    if (props.strokeWidth !== undefined) element.css('stroke-width', props.strokeWidth)
    if (props.strokeDasharray === 'none') {
      element.node.style.removeProperty('stroke-dasharray')
      element.node.removeAttribute('stroke-dasharray')
    } else if (props.strokeDasharray) {
      element.css('stroke-dasharray', props.strokeDasharray)
    }
    if (props.opacity !== undefined) element.css('opacity', props.opacity)

    if (element.type === 'text') {
      if (props.fontFamily) element.font({ family: props.fontFamily })
      if (props.fontSize !== null && props.fontSize !== undefined) {
        element.font({ size: props.fontSize })
      }
    }

    if (props.rotation !== undefined && element.transform) {
      const currentRotation = element.transform().rotate || 0
      const delta = props.rotation - currentRotation
      if (delta !== 0) {
        const box = element.bbox()
        const matrix = new Matrix(element.transform())
        const globalCx = matrix.a * box.cx + matrix.c * box.cy + matrix.e
        const globalCy = matrix.b * box.cx + matrix.d * box.cy + matrix.f
        element.transform(matrix.rotate(delta, globalCx, globalCy))
      }
    }

    if (props.collectionId && this.editor.collections.has(props.collectionId)) {
      this.editor.collections.get(props.collectionId).group.add(element)
    }
    setElementOverrides(element, props.overrides)
    applyCollectionStyleToElement(this.editor, element)
  }

  _notify(selection, message) {
    this.editor.spatialIndex.markDirty()
    this.editor.fullSpatialIndex.markDirty()
    this.dispatchSignal('clearSelection')
    this.editor.selected = [...selection]
    this.dispatchSignal('updatedSelection')
    this.dispatchSignal('updatedProperties')
    this.dispatchSignal('updatedOutliner')
    this.dispatchSignal('terminalLogged', { msg: message })
  }
}

class MatchPropertiesCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'MatchPropertiesCommand'
    this.name = 'Match Properties'
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.boundOnSelection = this.onSelection.bind(this)
    this.boundOnRightClick = this.onRightClick.bind(this)
    this.boundOnTargetSelection = this.onTargetSelection.bind(this)
    this.initialSelection = [...editor.selected]
    this.state = 'waitingForSource'
    this.sourceProperties = null
    this._mutationCommitted = false
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: `${this.name.toUpperCase()} ` })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: 'Select source object (Esc to cancel)',
    })

    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = []
    document.addEventListener('keydown', this.boundOnKeyDown)
    document.addEventListener('contextmenu', this.boundOnRightClick)
    this.editor.selectSingleElement = true
    this.editor.preventSelection = true
    this.editor.signals.toogledSelect.add(this.boundOnSelection)
    this.editor.signals.commandCancelled.addOnce(this.cleanup, this)
    this.editor.isInteracting = true
  }

  onKeyDown(event) {
    if (['Escape', 'Enter', 'Space', 'NumpadEnter'].includes(event.code)) {
      event.preventDefault()
      event.stopPropagation()
      this.cleanup()
      this.editor.signals.terminalLogged.dispatch({ msg: 'Command finished.' })
    }
  }

  onSelection(element) {
    if (this.state === 'waitingForSource' && element) this.captureSourceProperties(element)
  }

  onTargetSelection() {
    if (this.state === 'waitingForTargets' && this.editor.selected.length > 0) {
      this.applyPropertiesToTargets(this.editor.selected)
    }
  }

  captureSourceProperties(element) {
    const hadHover = element.hasClass('elementHover')
    if (hadHover) element.removeClass('elementHover')
    const computedStyle = window.getComputedStyle(element.node)
    const parseNum = (value, fallback) => {
      const number = Number.parseFloat(value)
      return Number.isNaN(number) ? fallback : number
    }

    const currentFill = element.css('fill') || element.attr('fill') || 'none'
    let visualFill = computedStyle.fill && computedStyle.fill !== 'none'
      ? computedStyle.fill
      : currentFill
    if (visualFill === 'transparent' || visualFill === 'rgba(0, 0, 0, 0)') visualFill = 'none'
    const currentStroke = element.css('stroke') || element.attr('stroke') || 'none'
    let visualStroke = computedStyle.stroke && computedStyle.stroke !== 'none'
      ? computedStyle.stroke
      : currentStroke
    if (visualStroke === 'transparent' || visualStroke === 'rgba(0, 0, 0, 0)') {
      visualStroke = 'none'
    }

    this.sourceProperties = {
      collectionId: element.parent()?.attr('data-collection') === 'true'
        ? element.parent().attr('id')
        : null,
      fill: visualFill,
      fontFamily: element.type === 'text'
        ? element.font('family') || element.css('font-family') || computedStyle.fontFamily || 'monospace'
        : null,
      fontSize: element.type === 'text'
        ? parseNum(element.font('size'), parseNum(element.css('font-size'), 0.5))
        : null,
      opacity: parseNum(computedStyle.opacity, parseNum(element.attr('opacity'), 1)),
      overrides: { ...getElementOverrides(element) },
      rotation: element.transform ? element.transform().rotate || 0 : 0,
      stroke: visualStroke,
      strokeDasharray: computedStyle.strokeDasharray !== 'none'
        ? computedStyle.strokeDasharray
        : element.attr('stroke-dasharray') || 'none',
      strokeWidth: parseNum(
        computedStyle.strokeWidth,
        parseNum(element.css('stroke-width') || element.attr('stroke-width'), 1),
      ),
    }
    if (hadHover) element.addClass('elementHover')

    this.editor.signals.terminalLogged.dispatch({
      msg: `Source captured! (Stroke: ${this.sourceProperties.stroke}, Fill: ${this.sourceProperties.fill})`,
    })
    this.editor.signals.terminalLogged.dispatch({
      msg: 'Select destination objects (Rectangle selection allowed).',
    })
    this.editor.selected = []
    this.state = 'waitingForTargets'
    this.editor.isInteracting = false
    this.editor.selectSingleElement = false
    this.editor.preventSelection = false
    this.editor.signals.toogledSelect.remove(this.boundOnSelection)
    this.editor.signals.updatedSelection.add(this.boundOnTargetSelection)
  }

  applyPropertiesToTargets(elements) {
    if (!this.sourceProperties) return null
    const targets = [...new Set(elements)].filter(Boolean)
    if (targets.length === 0) return null
    const mutation = new MatchPropertiesMutation(this.editor, targets, this.sourceProperties)
    this.editor.execute(mutation)
    this._mutationCommitted = true
    return mutation
  }

  onRightClick(event) {
    event.preventDefault()
    event.stopPropagation()
    this.cleanup()
    this.editor.signals.terminalLogged.dispatch({ msg: 'Command finished.' })
  }

  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    document.removeEventListener('contextmenu', this.boundOnRightClick)
    this.editor.signals.toogledSelect.remove(this.boundOnSelection)
    this.editor.signals.updatedSelection.remove(this.boundOnTargetSelection)
    this.editor.signals.commandCancelled.remove(this.cleanup, this)
    this.editor.isInteracting = false
    this.editor.selectSingleElement = false
    this.editor.preventSelection = false
    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = this._mutationCommitted ? [] : [...this.initialSelection]
    this.editor.signals.updatedSelection.dispatch()
  }
}

function matchPropertiesCommand(editor) {
  const command = new MatchPropertiesCommand(editor)
  command.execute()
}

export { MatchPropertiesCommand, MatchPropertiesMutation, matchPropertiesCommand }
