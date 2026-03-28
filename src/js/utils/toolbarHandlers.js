/**
 * Toolbar toggle handlers and menu overlay utilities.
 * These are bound to window globals for use by pug template onclick handlers.
 */

export function initToolbarHandlers(editor) {

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
    let orthoButton = document.getElementsByClassName('icon-orthomode')[0]
    if (orthoButton.classList.contains('is-active')) {
      orthoButton.classList.remove('is-active')
      editor.ortho = false
      editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'Ortho OFF' })
    } else {
      orthoButton.classList.add('is-active')
      editor.ortho = true
      editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'Ortho ON' })
    }
    const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
    if (activeSvg) activeSvg.fire('orthoChange')
  }

  function handleToogleSnap() {
    let snapButton = document.getElementsByClassName('icon-snap-off')[0]
    if (snapButton.classList.contains('is-active')) {
      snapButton.classList.remove('is-active')
      editor.isSnapping = false
      editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'Snap OFF' })
    } else {
      snapButton.classList.add('is-active')
      editor.isSnapping = true
      editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'Snap ON' })
    }
  }

  function handleTogglePolarTracking() {
    const btn = document.getElementsByClassName('icon-polartrack')[0]
    if (btn.classList.contains('is-active')) {
      btn.classList.remove('is-active')
      editor.polarTracking = false
      editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'Polar Tracking OFF' })
    } else {
      btn.classList.add('is-active')
      editor.polarTracking = true
      editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'Polar Tracking ON' })
    }
  }

  function handleToggleGrid(enabled) {
    const grid = editor.overlays.find('.grid')
    if (enabled) grid.show()
    else grid.hide()
  }

  function handleToggleAxis(enabled) {
    const axis = editor.overlays.find('.axis-group')
    if (enabled) axis.show()
    else axis.hide()
  }

  function handleToggleNonScalingStroke(enabled) {
    editor.svg.node.classList.toggle('non-scaling-stroke', enabled)
  }

  function toggleSnapMenu(event) {
    event.stopPropagation()
    const menu = document.getElementById('snap-options-menu')
    if (!menu) return
    const isOpen = menu.classList.contains('show-menu')
    if (isOpen) {
      menu.classList.remove('show-menu')
      window.removeEventListener('mousedown', snapMenuOutsideClick)
    } else {
      menu.classList.add('show-menu')
      setTimeout(() => {
        window.addEventListener('mousedown', snapMenuOutsideClick)
      }, 0)
    }
  }

  function snapMenuOutsideClick(event) {
    const menu = document.getElementById('snap-options-menu')
    if (menu && !menu.contains(event.target)) {
      menu.classList.remove('show-menu')
      window.removeEventListener('mousedown', snapMenuOutsideClick)
    }
  }

  function handleSnapTypeChange(checkbox) {
    const snapType = checkbox.dataset.snap
    if (snapType && editor.snapTypes !== undefined) {
      editor.snapTypes[snapType] = checkbox.checked
    }
  }

  function handleSnapExcludeNonSelectableChange(checkbox) {
    editor.snapExcludeNonSelectable = checkbox.checked
    // Full index must be rebuilt whenever this toggles (element set changes)
    editor.fullSpatialIndex.markDirty()
  }

  function handleRightClick(e) {
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
  window.handleSnapExcludeNonSelectableChange = handleSnapExcludeNonSelectableChange
  window.handleToggleGrid = handleToggleGrid
  window.handleToggleAxis = handleToggleAxis

  return {
    handleRightClick,
    clearSelection,
  }
}
