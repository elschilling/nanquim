/**
 * Toolbar toggle handlers and menu overlay utilities.
 * These are bound to window globals for use by pug template onclick handlers.
 */

export function initToolbarHandlers(editor) {

  function menuOverlay() {
    let overlayMenu = document.getElementsByClassName('overlay-menu')[0]
    overlayMenu.classList.toggle('show-menu')
    setTimeout(() => checkMouseOverMenu(), 1000)
    function checkMouseOverMenu() {
      window.addEventListener('mousemove', mouseMoveListener)
    }

    function mouseMoveListener(event) {
      if (event.target != overlayMenu) {
        overlayMenu.classList.remove('show-menu')
        window.removeEventListener('mousemove', mouseMoveListener)
      }
    }
  }

  function handleToogleOverlay() {
    let overlayButton = document.getElementsByClassName('icon-overlay')[0]
    if (overlayButton.classList.contains('is-active')) {
      overlayButton.classList.remove('is-active')
      editor.overlays.hide()
    } else {
      overlayButton.classList.add('is-active')
      editor.overlays.show()
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

  function handleToggleNonScalingStroke(enabled) {
    const svgEl = document.getElementById('canvas').querySelector('svg')
    if (enabled) {
      svgEl.classList.add('non-scaling-stroke')
    } else {
      svgEl.classList.remove('non-scaling-stroke')
    }
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
  window.menuOverlay = menuOverlay
  window.handleToggleNonScalingStroke = handleToggleNonScalingStroke
  window.toggleSnapMenu = toggleSnapMenu
  window.handleSnapTypeChange = handleSnapTypeChange

  return {
    handleRightClick,
    clearSelection,
  }
}
