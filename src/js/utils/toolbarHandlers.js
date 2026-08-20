/**
 * Toolbar toggle handlers and menu overlay utilities.
 * These are bound to window globals for use by pug template onclick handlers.
 */

export function initToolbarHandlers(editor) {
  let snapMenuOutsideListenerTimer = null

  function preserveToolbarButtonActivation(event) {
    if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') {
      // The CAD terminal listens on document and normally reclaims focus for
      // these keys. Keep native button activation with the focused control.
      event.stopPropagation()
    }
  }

  function setToggleButtonState(button, enabled) {
    if (!button) return
    button.classList.toggle('is-active', enabled)
    button.setAttribute('aria-pressed', String(enabled))
  }

  function toggleOverlayMenu(event) {
    event.stopPropagation()
    const menu = document.getElementById('overlay-menu')
    if (!menu) return
    const isOpen = menu.classList.contains('show-menu')
    if (isOpen) {
      menu.classList.remove('show-menu')
      window.removeEventListener('mousedown', overlayMenuOutsideClick)
    } else {
      menu.classList.add('show-menu')
      setTimeout(() => {
        window.addEventListener('mousedown', overlayMenuOutsideClick)
      }, 0)
    }
  }

  function overlayMenuOutsideClick(event) {
    const menu = document.getElementById('overlay-menu')
    if (menu && !menu.contains(event.target)) {
      menu.classList.remove('show-menu')
      window.removeEventListener('mousedown', overlayMenuOutsideClick)
    }
  }

  function handleToogleOverlay() {
    let overlayButton = document.getElementsByClassName('icon-overlay')[0]
    if (overlayButton.classList.contains('is-active')) {
      overlayButton.classList.remove('is-active')
      editor.overlays.hide()
      editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'Overlays OFF' })
    } else {
      overlayButton.classList.add('is-active')
      editor.overlays.show()
      editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'Overlays ON' })
    }
  }

  function handleToogleOrtho() {
    const orthoButton = document.getElementById('ortho-toggle')
      || document.getElementsByClassName('icon-orthomode')[0]
    editor.ortho = !Boolean(editor.ortho)
    setToggleButtonState(orthoButton, editor.ortho)
    editor.signals.terminalLogged.dispatch({ type: 'strong', msg: `Ortho ${editor.ortho ? 'ON' : 'OFF'}` })
    const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
    if (activeSvg) activeSvg.fire('orthoChange')
  }

  function handleToogleSnap() {
    const snapButton = document.getElementById('object-snap-toggle')
      || document.getElementsByClassName('icon-snap-off')[0]
    editor.isSnapping = !Boolean(editor.isSnapping)
    setToggleButtonState(snapButton, editor.isSnapping)
    editor.signals.terminalLogged.dispatch({ type: 'strong', msg: `Snap ${editor.isSnapping ? 'ON' : 'OFF'}` })
  }

  function handleTogglePolarTracking() {
    const polarButton = document.getElementById('polar-tracking-toggle')
      || document.getElementsByClassName('icon-polartrack')[0]
    editor.polarTracking = !Boolean(editor.polarTracking)
    setToggleButtonState(polarButton, editor.polarTracking)
    editor.signals.terminalLogged.dispatch({
      type: 'strong',
      msg: `Polar Tracking ${editor.polarTracking ? 'ON' : 'OFF'}`,
    })
  }

  function handleToggleGrid(enabled) {
    const grid = editor.overlays.find('.grid')
    if (enabled) grid.show()
    else grid.hide()

    const checkbox = document.querySelector('.overlay-checkbox[data-overlay="grid"]')
    if (checkbox) checkbox.checked = enabled
  }

  function handleGridOverlayShortcut(event) {
    if ((event.key !== 'F7' && event.code !== 'F7') || event.ctrlKey || event.metaKey || event.altKey) return

    event.preventDefault()
    const checkbox = document.querySelector('.overlay-checkbox[data-overlay="grid"]')
    handleToggleGrid(!(checkbox && checkbox.checked))
  }

  // Capture this shortcut before drawing commands or focused controls can stop
  // the bubbling key event.
  document.addEventListener('keydown', handleGridOverlayShortcut, true)

  function handleToggleAxis(enabled) {
    const axis = editor.overlays.find('.axis-group')
    if (enabled) axis.show()
    else axis.hide()
  }

  function handleToggleNonScalingStroke(enabled) {
    editor.svg.node.classList.toggle('non-scaling-stroke', enabled)
  }

  function toggleSnapMenu(event) {
    event?.stopPropagation()
    const menu = document.getElementById('snap-options-menu')
    if (!menu) return
    setSnapMenuOpen(!menu.classList.contains('show-menu'))
  }

  function setSnapMenuOpen(isOpen, { restoreFocus = false } = {}) {
    const menu = document.getElementById('snap-options-menu')
    const button = document.getElementById('snap-options-button')
    if (!menu) return

    if (snapMenuOutsideListenerTimer !== null) {
      window.clearTimeout(snapMenuOutsideListenerTimer)
      snapMenuOutsideListenerTimer = null
    }

    menu.classList.toggle('show-menu', isOpen)
    menu.setAttribute('aria-hidden', String(!isOpen))
    button?.setAttribute('aria-expanded', String(isOpen))

    window.removeEventListener('mousedown', snapMenuOutsideClick)
    document.removeEventListener('keydown', snapMenuKeydown)

    if (isOpen) {
      document.addEventListener('keydown', snapMenuKeydown)
      menu.querySelector('input, button, [href], [tabindex]:not([tabindex="-1"])')?.focus()
      snapMenuOutsideListenerTimer = window.setTimeout(() => {
        snapMenuOutsideListenerTimer = null
        window.addEventListener('mousedown', snapMenuOutsideClick)
      }, 0)
    } else if (restoreFocus) {
      button?.focus()
    }
  }

  function snapMenuOutsideClick(event) {
    const menu = document.getElementById('snap-options-menu')
    const button = document.getElementById('snap-options-button')
    if (menu && !menu.contains(event.target) && !button?.contains(event.target)) setSnapMenuOpen(false)
  }

  function snapMenuKeydown(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    document.addEventListener('keyup', consumeSnapMenuEscapeKeyup, { capture: true, once: true })
    setSnapMenuOpen(false, { restoreFocus: true })
  }

  function consumeSnapMenuEscapeKeyup(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  function handleSnapTypeChange(checkbox) {
    const snapType = checkbox.dataset.snap
    if (snapType && editor.snapTypes !== undefined) {
      editor.snapTypes[snapType] = checkbox.checked
    }
  }

  function setGridSnap(enabled) {
    editor.gridSnap = enabled
    editor.snapPoint = null

    const checkbox = document.querySelector('.snap-checkbox[data-snap="grid"]')
    if (checkbox) checkbox.checked = enabled

    editor.signals.terminalLogged.dispatch({
      type: 'strong',
      msg: `Grid Snap ${enabled ? 'ON' : 'OFF'}`
    })
  }

  function handleGridSnapChange(checkbox) {
    setGridSnap(checkbox.checked)
  }

  function handleSnapExcludeNonSelectableChange(checkbox) {
    editor.snapExcludeNonSelectable = checkbox.checked
    // Full index must be rebuilt whenever this toggles (element set changes)
    editor.fullSpatialIndex.markDirty()
  }

  function handleRightClick(e) {
    // The document-level CAD cancel gesture must not suppress the node
    // editor's own context menu and right-drag interactions.
    if (e.target && e.target.closest && e.target.closest('.gn-dock, .geometry-nodes-editor')) return
    e.preventDefault()
    editor.svg.fire('cancelDrawing', e)
  }

  function clearSelection(svg) {
    svg.children().each((el) => {
      if (!el.hasClass('grid') && !el.hasClass('axis')) {
        if (el.attr('selected') === 'true') {
          el.selectize(false, { deepSelect: true })
          el.attr('selected', false)
          el.removeClass('elementSelected')
        }
      }
    })
  }

  // Assign to window for pug template onclick handlers
  window.handleToogleOverlay = handleToogleOverlay
  window.handleToogleOrtho = handleToogleOrtho
  window.handleToogleSnap = handleToogleSnap
  window.handleTogglePolarTracking = handleTogglePolarTracking
  window.toggleOverlayMenu = toggleOverlayMenu
  window.handleToggleNonScalingStroke = handleToggleNonScalingStroke
  window.toggleSnapMenu = toggleSnapMenu
  window.handleSnapTypeChange = handleSnapTypeChange
  window.handleGridSnapChange = handleGridSnapChange
  window.handleSnapExcludeNonSelectableChange = handleSnapExcludeNonSelectableChange
  window.handleToggleGrid = handleToggleGrid
  window.handleToggleAxis = handleToggleAxis

  for (const id of [
    'ortho-toggle',
    'object-snap-toggle',
    'snap-options-button',
    'polar-tracking-toggle',
  ]) {
    document.getElementById(id)?.addEventListener('keydown', preserveToolbarButtonActivation)
  }

  setToggleButtonState(document.getElementById('ortho-toggle'), Boolean(editor.ortho))
  setToggleButtonState(document.getElementById('object-snap-toggle'), Boolean(editor.isSnapping))
  setToggleButtonState(document.getElementById('polar-tracking-toggle'), Boolean(editor.polarTracking))
  setSnapMenuOpen(false)

  return {
    handleRightClick,
    clearSelection,
  }
}
