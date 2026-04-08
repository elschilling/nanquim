import { setCollectionStyle, getElementOverrides, setElementOverrides, applyCollectionStyleToElement } from './Collection'
import { Matrix } from '@svgdotjs/svg.js'
import { HATCH_PATTERNS, ensurePattern } from './utils/hatchPatterns'

const propertiesPanel = document.getElementById('properties-panel')

// ── Color Copy/Paste (Blender-style) ────────────────────────────────────────
// A single module-level clipboard so color can be carried across any color box.
let _colorClipboard = null
let _hoveredColorBox = null  // { getColor, setColor, el } — whichever box the mouse is over

document.addEventListener('keydown', (e) => {
  if (!_hoveredColorBox) return
  if (!e.ctrlKey && !e.metaKey) return
  if (e.key === 'c' || e.key === 'C') {
    const color = _hoveredColorBox.getColor()
    if (!color) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    _colorClipboard = color
    _showColorToast(_hoveredColorBox.el, 'Copied')
  } else if (e.key === 'v' || e.key === 'V') {
    if (!_colorClipboard) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    _hoveredColorBox.setColor(_colorClipboard)
    _showColorToast(_hoveredColorBox.el, 'Pasted')
  }
})

function _showColorToast(el, text) {
  const old = el.querySelector('._color-toast')
  if (old) old.remove()
  const toast = document.createElement('span')
  toast.className = '_color-toast'
  toast.textContent = text
  Object.assign(toast.style, {
    position: 'absolute', inset: '0',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '9px', fontWeight: '600', color: '#fff',
    textShadow: '0 1px 2px #000',
    background: 'rgba(0,0,0,0.45)',
    borderRadius: 'inherit',
    pointerEvents: 'none',
    opacity: '1',
    transition: 'opacity 0.4s',
    zIndex: '1',
  })
  // el must be position:relative for inset:0 to work
  el.style.position = 'relative'
  el.appendChild(toast)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { toast.style.opacity = '0' })
  })
  setTimeout(() => toast.remove(), 500)
}

function Properties(editor) {
  const signals = editor.signals
  let activeTab = 'transform' // 'transform' | 'style' | 'settings' | 'dimstyles' | 'textstyles'
  const dimStylesExpanded = new Set()
  const textStylesExpanded = new Set()
  const transformAccordionsExpanded = new Set(['general', 'transform'])

  // Side Icon Navigation
  const transformTabBtn = document.getElementById('tab-transform')
  const styleTabBtn = document.getElementById('tab-style')
  const settingsTabBtn = document.getElementById('tab-settings')
  const dimStylesTabBtn = document.getElementById('tab-dimstyles')
  const textStylesTabBtn = document.getElementById('tab-textstyles')

  if (transformTabBtn && styleTabBtn) {
    transformTabBtn.addEventListener('click', () => {
      activeTab = 'transform'
      updateTabUI()
      render()
    })

    styleTabBtn.addEventListener('click', () => {
      activeTab = 'style'
      updateTabUI()
      render()
    })
  }

  if (settingsTabBtn) {
    settingsTabBtn.addEventListener('click', () => {
      activeTab = 'settings'
      updateTabUI()
      render()
    })
  }

  if (dimStylesTabBtn) {
    dimStylesTabBtn.addEventListener('click', () => {
      activeTab = 'dimstyles'
      updateTabUI()
      render()
    })
  }

  if (textStylesTabBtn) {
    textStylesTabBtn.addEventListener('click', () => {
      activeTab = 'textstyles'
      updateTabUI()
      render()
    })
  }

  function updateTabUI() {
    ;[transformTabBtn, styleTabBtn, settingsTabBtn, dimStylesTabBtn, textStylesTabBtn].forEach((btn) => {
      if (btn) btn.classList.remove('active')
    })
    if (activeTab === 'transform' && transformTabBtn) transformTabBtn.classList.add('active')
    else if (activeTab === 'style' && styleTabBtn) styleTabBtn.classList.add('active')
    else if (activeTab === 'settings' && settingsTabBtn) settingsTabBtn.classList.add('active')
    else if (activeTab === 'dimstyles' && dimStylesTabBtn) dimStylesTabBtn.classList.add('active')
    else if (activeTab === 'textstyles' && textStylesTabBtn) textStylesTabBtn.classList.add('active')
  }

  // Show/hide the Settings tab icon based on editor mode
  function updateModeUI() {
    const isPaper = editor.mode === 'paper'
    if (settingsTabBtn) settingsTabBtn.style.display = isPaper ? '' : 'none'
    // If we were on settings tab and switched to model mode, revert to transform
    if (!isPaper && activeTab === 'settings') {
      activeTab = 'transform'
      updateTabUI()
    }
  }

  signals.editorModeChanged.add(() => {
    updateModeUI()
    render()
  })

  // Safe dispatch helper
  const safeDispatch = (signalName) => {
    if (editor.signals[signalName]) {
      editor.signals[signalName].dispatch()
    } else {
      console.warn(`Signal '${signalName}' missing! Available signals:`, Object.keys(editor.signals))
    }
  }

  signals.updatedProperties.add(() => {
    render()
  })

  signals.clearSelection.add(() => {
    render()
  })

  function render() {
    propertiesPanel.innerHTML = ''

    // ── DIMENSION STYLES TAB (available in all modes, independent of selection) ──
    if (activeTab === 'dimstyles') {
      const content = document.createElement('div')
      content.className = 'properties-content'
      propertiesPanel.appendChild(content)
      renderDimStylesTab(content)
      return
    }

    // ── TEXT STYLES TAB ──
    if (activeTab === 'textstyles') {
      const content = document.createElement('div')
      content.className = 'properties-content'
      propertiesPanel.appendChild(content)
      renderTextStylesTab(content)
      return
    }

    // ── PAPER MODE ──────────────────────────────────────────────────────────
    if (editor.mode === 'paper') {
      const content = document.createElement('div')
      content.className = 'properties-content'
      propertiesPanel.appendChild(content)

      // Settings tab
      if (activeTab === 'settings') {
        renderPaperSettingsTab(content)
        return
      }

      // Style tab in paper mode: show color translation
      if (activeTab === 'style') {
        renderColorTranslationTab(content)
        return
      }

      const sel = editor.selected[editor.selected.length - 1]

      // Check if a paper viewport is selected
      if (sel && sel._paperVp) {
        renderViewportPropertiesTab(content, sel._paperVp)
        return
      }

      // Support selecting annotation elements in paper mode
      if (sel && sel.node) {
        if (activeTab === 'transform') {
          renderTransformTab(content, sel, sel.node)
        } else if (activeTab === 'style') {
          renderStyleTab(content, sel, sel.node)
        }
        return
      }

      // Transform tab in paper mode: nothing selected
      const p = document.createElement('p')
      p.textContent = 'Select a viewport or annotation element'
      p.style.padding = '8px'
      p.style.opacity = '0.6'
      content.appendChild(p)
      return
    }

    // ── MODEL MODE ──────────────────────────────────────────────────────────
    if (editor.selected.length === 0) {
      let p = document.createElement('p')
      p.textContent = 'No element selected'
      propertiesPanel.appendChild(p)
      return
    }

    const element = editor.selected[editor.selected.length - 1]
    const node = element.node

    // Content Container
    const content = document.createElement('div')
    content.className = 'properties-content'
    propertiesPanel.appendChild(content)

    if (activeTab === 'transform') {
      if (element.attr && element.attr('data-collection') === 'true') {
        renderCollectionTransformTab(content, element)
      } else {
        renderTransformTab(content, element, node)
      }
    } else if (activeTab === 'style') {
      // Check if this is a collection group
      if (element.attr && element.attr('data-collection') === 'true') {
        renderCollectionStyleTab(content, element)
      } else {
        renderStyleTab(content, element, node)
      }
    }
  }

  // ── DIMENSION STYLES TAB ────────────────────────────────────────────────────

  function createDimColorRow(container, label, value, onChange) {
    const isInherit = value === 'inherit'
    const row = document.createElement('div')
    row.className = 'property-row'

    const labelEl = document.createElement('label')
    labelEl.textContent = label
    labelEl.className = 'property-label'

    const controls = document.createElement('div')
    controls.className = 'prop-controls'

    const toggleBtn = document.createElement('button')
    toggleBtn.textContent = isInherit ? 'C' : 'O'
    toggleBtn.title = isInherit ? 'Inheriting from collection — click to set fixed color' : 'Override — click to inherit from collection'
    toggleBtn.className = 'prop-inherit-toggle'
    toggleBtn.style.background = isInherit ? 'var(--accent-color)' : '#555'

    const colorBox = document.createElement('div')
    colorBox.className = 'prop-color-box'

    function syncBox(inherit, color) {
      if (inherit) {
        colorBox.style.background = 'repeating-linear-gradient(45deg,#444 0px,#444 4px,#222 4px,#222 8px)'
        colorBox.style.opacity = '0.4'
        colorBox.style.cursor = 'default'
        colorBox.style.pointerEvents = 'none'
      } else {
        colorBox.style.background = color || '#ffffff'
        colorBox.style.opacity = '1'
        colorBox.style.cursor = 'pointer'
        colorBox.style.pointerEvents = 'auto'
      }
    }
    syncBox(isInherit, value)

    let currentColor = isInherit ? '#ffffff' : value || '#ffffff'

    attachColorCopyPaste(
      colorBox,
      () => (isInherit ? null : currentColor),
      (hex) => { currentColor = hex; syncBox(false, hex); onChange(hex) }
    )

    colorBox.addEventListener('click', () => {
      openColorPicker(
        currentColor,
        (newColor) => {
          currentColor = newColor
          syncBox(false, newColor)
          onChange(newColor)
        },
        (newColor) => {
          currentColor = newColor
          syncBox(false, newColor)
        },
      )
    })

    toggleBtn.addEventListener('click', () => {
      const nowInherit = toggleBtn.textContent !== 'C'
      if (nowInherit) {
        toggleBtn.textContent = 'C'
        toggleBtn.title = 'Inheriting from collection — click to set fixed color'
        toggleBtn.style.background = 'var(--accent-color)'
        syncBox(true, null)
        onChange('inherit')
      } else {
        toggleBtn.textContent = 'O'
        toggleBtn.title = 'Override — click to inherit from collection'
        toggleBtn.style.background = '#555'
        syncBox(false, currentColor)
        onChange(currentColor)
      }
    })

    controls.appendChild(toggleBtn)
    controls.appendChild(colorBox)
    row.appendChild(labelEl)
    row.appendChild(controls)
    container.appendChild(row)
  }

  function renderDimStylesTab(container) {
    const dm = editor.dimensionManager

    // Active style picker
    const activeRow = document.createElement('div')
    activeRow.className = 'property-row'
    activeRow.style.marginBottom = '4px'
    const activeLabel = document.createElement('label')
    activeLabel.className = 'property-label'
    activeLabel.textContent = 'Active Style'
    const activeSelect = document.createElement('select')
    activeSelect.className = 'property-input property-select'
    dm.styles.forEach((styleObj, sId) => {
      const opt = document.createElement('option')
      opt.value = sId
      opt.textContent = styleObj.name
      if (sId === dm.activeStyleId) opt.selected = true
      activeSelect.appendChild(opt)
    })
    activeSelect.addEventListener('change', (e) => {
      dm.setActiveStyle(e.target.value)
    })
    activeRow.appendChild(activeLabel)
    activeRow.appendChild(activeSelect)
    container.appendChild(activeRow)

    // Per-style accordions
    dm.styles.forEach((styleObj, sId) => {
      const props = styleObj.properties
      const isExpanded = dimStylesExpanded.has(sId)

      // Accordion wrapper
      const accordion = document.createElement('div')
      accordion.className = 'prop-accordion'

      // Header row
      const accordionHeader = document.createElement('div')
      accordionHeader.className = 'prop-accordion-header'

      const collapseIcon = document.createElement('span')
      collapseIcon.className = 'icon icon-collapse prop-collapse-icon' + (isExpanded ? ' on' : '')
      if (!isExpanded) collapseIcon.style.transform = 'rotate(-90deg)'

      const styleTitle = document.createElement('span')
      styleTitle.className = 'prop-section-title'
      styleTitle.textContent = styleObj.name

      const renameBtn = document.createElement('button')
      renameBtn.title = 'Rename'
      renameBtn.className = 'prop-icon-btn'
      const renameIcon = document.createElement('span')
      renameIcon.className = 'icon icon-rename'
      renameBtn.appendChild(renameIcon)
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const newName = prompt('Rename style:', styleObj.name)
        if (newName && newName.trim()) dm.renameStyle(sId, newName.trim())
      })

      accordionHeader.appendChild(collapseIcon)
      accordionHeader.appendChild(styleTitle)
      accordionHeader.appendChild(renameBtn)

      if (sId !== 'Standard') {
        const deleteBtn = document.createElement('button')
        deleteBtn.title = 'Delete style'
        deleteBtn.className = 'prop-icon-btn'
        deleteBtn.style.opacity = '0.5'
        deleteBtn.addEventListener('mouseenter', () => {
          deleteBtn.style.opacity = '1'
        })
        deleteBtn.addEventListener('mouseleave', () => {
          deleteBtn.style.opacity = '0.5'
        })
        const deleteIcon = document.createElement('span')
        deleteIcon.className = 'icon icon-trash'
        deleteBtn.appendChild(deleteIcon)
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          if (confirm(`Delete style "${styleObj.name}"?`)) dm.deleteStyle(sId)
        })
        accordionHeader.appendChild(deleteBtn)
      }

      // Body (property fields)
      const accordionBody = document.createElement('div')
      accordionBody.className = 'dim-style-body'
      accordionBody.style.display = isExpanded ? 'flex' : 'none'

      accordionHeader.addEventListener('click', () => {
        const open = accordionBody.style.display === 'none'
        accordionBody.style.display = open ? 'flex' : 'none'
        collapseIcon.style.transform = open ? '' : 'rotate(-90deg)'
        if (open) dimStylesExpanded.add(sId)
        else dimStylesExpanded.delete(sId)
      })

      const tsRow = document.createElement('div')
      tsRow.className = 'property-row'
      const tsLabel = document.createElement('label')
      tsLabel.className = 'property-label'
      tsLabel.textContent = 'Text Style'
      const tsSelect = document.createElement('select')
      tsSelect.className = 'property-input property-select'
      editor.textStyleManager.styles.forEach((tsObj, tsId) => {
        const opt = document.createElement('option')
        opt.value = tsId
        opt.textContent = tsObj.name
        if (tsId === (props.textStyleId || 'Standard')) opt.selected = true
        tsSelect.appendChild(opt)
      })
      tsSelect.addEventListener('change', (e) => {
        dm.updateStyle(sId, { textStyleId: e.target.value })
      })
      tsRow.appendChild(tsLabel)
      tsRow.appendChild(tsSelect)
      accordionBody.appendChild(tsRow)
      // Marker type dropdown
      const markerRow = document.createElement('div')
      markerRow.className = 'property-row'
      const markerLabel = document.createElement('label')
      markerLabel.className = 'property-label'
      markerLabel.textContent = 'Marker'
      const markerSelect = document.createElement('select')
      markerSelect.className = 'property-input property-select'
      ;['arrow', 'tick', 'bullet'].forEach((type) => {
        const opt = document.createElement('option')
        opt.value = type
        opt.textContent = type.charAt(0).toUpperCase() + type.slice(1)
        if (type === (props.markerType || 'arrow')) opt.selected = true
        markerSelect.appendChild(opt)
      })
      markerSelect.addEventListener('change', (e) => {
        dm.updateStyle(sId, { markerType: e.target.value })
      })
      markerRow.appendChild(markerLabel)
      markerRow.appendChild(markerSelect)
      accordionBody.appendChild(markerRow)

      createPropertyField(accordionBody, 'Marker Size', props.markerSize ?? 0.15, (val) => {
        const num = parseFloat(val)
        if (!isNaN(num) && num >= 0) dm.updateStyle(sId, { markerSize: num })
      })
      createPropertyField(accordionBody, 'Text Offset', props.textOffset, (val) => {
        const num = parseFloat(val)
        if (!isNaN(num)) dm.updateStyle(sId, { textOffset: num })
      })
      createPropertyField(accordionBody, 'Ext Line Offset', props.extensionLineOffset, (val) => {
        const num = parseFloat(val)
        if (!isNaN(num)) dm.updateStyle(sId, { extensionLineOffset: num })
      })
      createPropertyField(accordionBody, 'Ext Line Extend', props.extensionLineExtend, (val) => {
        const num = parseFloat(val)
        if (!isNaN(num)) dm.updateStyle(sId, { extensionLineExtend: num })
      })
      createPropertyField(accordionBody, 'Line Width', props.lineWidth, (val) => {
        const num = parseFloat(val)
        if (!isNaN(num) && num > 0) dm.updateStyle(sId, { lineWidth: num })
      })
      createDimColorRow(accordionBody, 'Text Color', props.textColor, (color) => {
        dm.updateStyle(sId, { textColor: color })
      })
      createDimColorRow(accordionBody, 'Line Color', props.lineColor, (color) => {
        dm.updateStyle(sId, { lineColor: color })
      })

      accordion.appendChild(accordionHeader)
      accordion.appendChild(accordionBody)
      container.appendChild(accordion)
    })

    // New style button
    const newBtn = document.createElement('button')
    newBtn.textContent = '+ New Style'
    newBtn.className = 'prop-new-style-btn'
    newBtn.addEventListener('click', () => {
      const name = prompt('New style name:')
      if (name && name.trim()) {
        const trimmed = name.trim()
        dm.createStyle(trimmed.replace(/\s+/g, '_'), trimmed, {})
        safeDispatch('updatedProperties')
      }
    })
    container.appendChild(newBtn)
  }

  // ── TEXT STYLES TAB ─────────────────────────────────────────────────────────

  function renderTextStylesTab(container) {
    const tm = editor.textStyleManager
    const CAD_FONTS = [
      'Arial',
      'Cascadia Code',
      'Courier New',
      'DM Sans',
      'Fira Code',
      'Fira Mono',
      'Georgia',
      'Helvetica',
      'Inter',
      'JetBrains Mono',
      'Times New Roman',
    ]
    // Weights available per font (Google Fonts loaded weights + sensible system font subsets)
    const FONT_WEIGHTS = {
      Inter: [
        ['400', 'Regular'],
        ['500', 'Medium'],
        ['600', 'Semi-bold'],
      ],
      'DM Sans': [
        ['300', 'Light'],
        ['400', 'Regular'],
        ['700', 'Bold'],
      ],
      'JetBrains Mono': [
        ['400', 'Regular'],
        ['500', 'Medium'],
      ],
      'Fira Code': [
        ['300', 'Light'],
        ['400', 'Regular'],
        ['500', 'Medium'],
        ['600', 'Semi-bold'],
        ['700', 'Bold'],
      ],
      'Fira Mono': [
        ['400', 'Regular'],
        ['500', 'Medium'],
        ['700', 'Bold'],
      ],
      'Cascadia Code': [
        ['200', 'Extra-light'],
        ['300', 'Light'],
        ['400', 'Regular'],
        ['600', 'Semi-bold'],
      ],
    }
    const DEFAULT_WEIGHTS = [
      ['400', 'Regular'],
      ['700', 'Bold'],
    ]
    const getWeights = (family) => FONT_WEIGHTS[family] || DEFAULT_WEIGHTS

    function makeDropdownRow(parentEl, label, options, currentValue, onChange) {
      const row = document.createElement('div')
      row.className = 'property-row'
      const lbl = document.createElement('label')
      lbl.className = 'property-label'
      lbl.textContent = label
      const sel = document.createElement('select')
      sel.className = 'property-input property-select'
      options.forEach(([val, text]) => {
        const opt = document.createElement('option')
        opt.value = val
        opt.textContent = text || val
        if (val === currentValue) opt.selected = true
        sel.appendChild(opt)
      })
      sel.addEventListener('change', (e) => onChange(e.target.value))
      row.appendChild(lbl)
      row.appendChild(sel)
      parentEl.appendChild(row)
    }

    function makeColorRow(parentEl, label, currentValue, onChange) {
      const row = document.createElement('div')
      row.className = 'property-row'
      const lbl = document.createElement('label')
      lbl.className = 'property-label'
      lbl.textContent = label
      const colorBox = document.createElement('div')
      colorBox.className = 'property-input prop-color-box'
      colorBox.style.cursor = 'pointer'
      colorBox.style.background = currentValue || '#ffffff'

      attachColorCopyPaste(
        colorBox,
        () => rgbToHex(colorBox.style.background),
        (hex) => { colorBox.style.background = hex; currentValue = hex; onChange(hex) }
      )

      colorBox.addEventListener('click', () => {
        openColorPicker(
          currentValue || '#ffffff',
          (newColor) => {
            currentValue = newColor
            colorBox.style.background = newColor
            onChange(newColor)
          },
          (newColor) => {
            colorBox.style.background = newColor
          },
        )
      })
      row.appendChild(lbl)
      row.appendChild(colorBox)
      parentEl.appendChild(row)
    }

    // Active style picker
    const activeRow = document.createElement('div')
    activeRow.className = 'property-row'
    activeRow.style.marginBottom = '4px'
    const activeLabel = document.createElement('label')
    activeLabel.className = 'property-label'
    activeLabel.textContent = 'Active Style'
    const activeSelect = document.createElement('select')
    activeSelect.className = 'property-input property-select'
    tm.styles.forEach((styleObj, sId) => {
      const opt = document.createElement('option')
      opt.value = sId
      opt.textContent = styleObj.name
      if (sId === tm.activeStyleId) opt.selected = true
      activeSelect.appendChild(opt)
    })
    activeSelect.addEventListener('change', (e) => tm.setActiveStyle(e.target.value))
    activeRow.appendChild(activeLabel)
    activeRow.appendChild(activeSelect)
    container.appendChild(activeRow)

    // Per-style accordions
    tm.styles.forEach((styleObj, sId) => {
      const props = styleObj.properties
      const isExpanded = textStylesExpanded.has(sId)

      const accordion = document.createElement('div')
      accordion.className = 'prop-accordion'

      const accordionHeader = document.createElement('div')
      accordionHeader.className = 'prop-accordion-header'

      const collapseIcon = document.createElement('span')
      collapseIcon.className = 'icon icon-collapse prop-collapse-icon' + (isExpanded ? ' on' : '')
      if (!isExpanded) collapseIcon.style.transform = 'rotate(-90deg)'

      const styleTitle = document.createElement('span')
      styleTitle.className = 'prop-section-title'
      styleTitle.textContent = styleObj.name

      const renameBtn = document.createElement('button')
      renameBtn.title = 'Rename'
      renameBtn.className = 'prop-icon-btn'
      const renameIcon = document.createElement('span')
      renameIcon.className = 'icon icon-rename'
      renameBtn.appendChild(renameIcon)
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const newName = prompt('Rename style:', styleObj.name)
        if (newName && newName.trim()) tm.renameStyle(sId, newName.trim())
      })

      accordionHeader.appendChild(collapseIcon)
      accordionHeader.appendChild(styleTitle)
      accordionHeader.appendChild(renameBtn)

      if (sId !== 'Standard') {
        const deleteBtn = document.createElement('button')
        deleteBtn.title = 'Delete style'
        deleteBtn.className = 'prop-icon-btn'
        deleteBtn.style.opacity = '0.5'
        deleteBtn.addEventListener('mouseenter', () => {
          deleteBtn.style.opacity = '1'
        })
        deleteBtn.addEventListener('mouseleave', () => {
          deleteBtn.style.opacity = '0.5'
        })
        const deleteIcon = document.createElement('span')
        deleteIcon.className = 'icon icon-trash'
        deleteBtn.appendChild(deleteIcon)
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          if (confirm(`Delete style "${styleObj.name}"?`)) tm.deleteStyle(sId)
        })
        accordionHeader.appendChild(deleteBtn)
      }

      const accordionBody = document.createElement('div')
      accordionBody.className = 'dim-style-body'
      accordionBody.style.display = isExpanded ? 'flex' : 'none'

      accordionHeader.addEventListener('click', () => {
        const open = accordionBody.style.display === 'none'
        accordionBody.style.display = open ? 'flex' : 'none'
        collapseIcon.style.transform = open ? '' : 'rotate(-90deg)'
        if (open) textStylesExpanded.add(sId)
        else textStylesExpanded.delete(sId)
      })

      // Font Family row (linked to weight dropdown)
      const familyRow = document.createElement('div')
      familyRow.className = 'property-row'
      const familyLabel = document.createElement('label')
      familyLabel.className = 'property-label'
      familyLabel.textContent = 'Font Family'
      const familySelect = document.createElement('select')
      familySelect.className = 'property-input property-select'
      CAD_FONTS.forEach((f) => {
        const opt = document.createElement('option')
        opt.value = f
        opt.textContent = f
        if (f === (props.fontFamily || 'Inter')) opt.selected = true
        familySelect.appendChild(opt)
      })
      familyRow.appendChild(familyLabel)
      familyRow.appendChild(familySelect)
      accordionBody.appendChild(familyRow)

      createPropertyField(accordionBody, 'Font Size', props.fontSize, (val) => {
        const num = parseFloat(val)
        if (!isNaN(num) && num > 0) tm.updateStyle(sId, { fontSize: num })
      })

      // Font Weight row (options driven by selected family)
      const weightRow = document.createElement('div')
      weightRow.className = 'property-row'
      const weightLabel = document.createElement('label')
      weightLabel.className = 'property-label'
      weightLabel.textContent = 'Font Weight'
      const weightSelect = document.createElement('select')
      weightSelect.className = 'property-input property-select'

      function populateWeights(family, currentWeight) {
        weightSelect.innerHTML = ''
        getWeights(family).forEach(([val, text]) => {
          const opt = document.createElement('option')
          opt.value = val
          opt.textContent = text
          if (val === currentWeight) opt.selected = true
          weightSelect.appendChild(opt)
        })
        // If saved weight isn't in the list, default to first option
        if (!weightSelect.value) weightSelect.selectedIndex = 0
      }
      populateWeights(props.fontFamily || 'Inter', props.fontWeight || '400')

      familySelect.addEventListener('change', (e) => {
        const newFamily = e.target.value
        populateWeights(newFamily, weightSelect.value)
        tm.updateStyle(sId, { fontFamily: newFamily, fontWeight: weightSelect.value })
      })
      weightSelect.addEventListener('change', (e) => tm.updateStyle(sId, { fontWeight: e.target.value }))

      weightRow.appendChild(weightLabel)
      weightRow.appendChild(weightSelect)
      accordionBody.appendChild(weightRow)
      makeDropdownRow(
        accordionBody,
        'Font Style',
        [
          ['normal', 'Normal'],
          ['italic', 'Italic'],
        ],
        props.fontStyle || 'normal',
        (val) => tm.updateStyle(sId, { fontStyle: val }),
      )
      makeDropdownRow(
        accordionBody,
        'Text Anchor',
        [
          ['start', 'Start'],
          ['middle', 'Middle'],
          ['end', 'End'],
        ],
        props.textAnchor || 'start',
        (val) => tm.updateStyle(sId, { textAnchor: val }),
      )
      makeDropdownRow(
        accordionBody,
        'Baseline',
        [
          ['auto', 'Auto'],
          ['middle', 'Middle'],
          ['central', 'Central'],
          ['hanging', 'Hanging'],
        ],
        props.dominantBaseline || 'auto',
        (val) => tm.updateStyle(sId, { dominantBaseline: val }),
      )
      createPropertyField(accordionBody, 'Letter Spacing', props.letterSpacing ?? 0, (val) => {
        const num = parseFloat(val)
        if (!isNaN(num)) tm.updateStyle(sId, { letterSpacing: num })
      })
      makeDropdownRow(
        accordionBody,
        'Decoration',
        [
          ['none', 'None'],
          ['underline', 'Underline'],
          ['overline', 'Overline'],
          ['line-through', 'Line-through'],
        ],
        props.textDecoration || 'none',
        (val) => tm.updateStyle(sId, { textDecoration: val }),
      )
      makeColorRow(accordionBody, 'Fill', props.fill || '#ffffff', (color) => tm.updateStyle(sId, { fill: color }))

      accordion.appendChild(accordionHeader)
      accordion.appendChild(accordionBody)
      container.appendChild(accordion)
    })

    const newBtn = document.createElement('button')
    newBtn.textContent = '+ New Style'
    newBtn.className = 'prop-new-style-btn'
    newBtn.addEventListener('click', () => {
      const name = prompt('New style name:')
      if (name && name.trim()) {
        const trimmed = name.trim()
        tm.createStyle(trimmed.replace(/\s+/g, '_'), trimmed, {})
        safeDispatch('updatedProperties')
      }
    })
    container.appendChild(newBtn)
  }

  // ── PAPER SETTINGS TAB ──────────────────────────────────────────────────────

  function renderPaperSettingsTab(container) {
    const cfg = editor.paperConfig
    const pe = editor.paperEditor

    // Section header
    const header = document.createElement('div')
    header.className = 'prop-section-header'
    header.textContent = 'Paper Settings'
    container.appendChild(header)

    // Paper size dropdown
    const sizeRow = document.createElement('div')
    sizeRow.className = 'property-row'
    const sizeLabel = document.createElement('label')
    sizeLabel.className = 'property-label'
    sizeLabel.textContent = 'Paper Size'
    const sizeSelect = document.createElement('select')
    sizeSelect.className = 'property-input property-select'

    const sizes = ['A0', 'A1', 'A2', 'A3', 'A4', 'custom']
    sizes.forEach((s) => {
      const opt = document.createElement('option')
      opt.value = s
      opt.textContent = s === 'custom' ? 'Custom' : s
      if (s === cfg.size) opt.selected = true
      sizeSelect.appendChild(opt)
    })
    sizeSelect.addEventListener('change', () => {
      pe.setPaperSize(sizeSelect.value)
      render()
    })
    sizeRow.appendChild(sizeLabel)
    sizeRow.appendChild(sizeSelect)
    container.appendChild(sizeRow)

    // Custom width/height (shown only for custom)
    if (cfg.size === 'custom') {
      createPropertyField(container, 'Width (mm)', cfg.width, (val) => {
        const n = parseFloat(val)
        if (!isNaN(n) && n > 0) pe.setPaperSize('custom', n, cfg.height)
      })
      createPropertyField(container, 'Height (mm)', cfg.height, (val) => {
        const n = parseFloat(val)
        if (!isNaN(n) && n > 0) pe.setPaperSize('custom', cfg.width, n)
      })
    } else {
      createPropertyField(container, 'Width (mm)', cfg.width, null, true)
      createPropertyField(container, 'Height (mm)', cfg.height, null, true)
    }

    // Orientation
    const orientRow = document.createElement('div')
    orientRow.className = 'property-row'
    const orientLabel = document.createElement('label')
    orientLabel.className = 'property-label'
    orientLabel.textContent = 'Orientation'
    const orientSelect = document.createElement('select')
    orientSelect.className = 'property-input property-select'
    ;['portrait', 'landscape'].forEach((o) => {
      const opt = document.createElement('option')
      opt.value = o
      opt.textContent = o.charAt(0).toUpperCase() + o.slice(1)
      if (o === cfg.orientation) opt.selected = true
      orientSelect.appendChild(opt)
    })
    orientSelect.addEventListener('change', () => {
      pe.setOrientation(orientSelect.value)
      render()
    })
    orientRow.appendChild(orientLabel)
    orientRow.appendChild(orientSelect)
    container.appendChild(orientRow)

    // Units per cm (coordinate scale)
    createPropertyField(container, 'Scale (units/cm)', cfg.unitsPerCm, (val) => {
      const n = parseFloat(val)
      if (!isNaN(n) && n > 0) {
        cfg.unitsPerCm = n
        if (pe) pe.activate()
      }
    })

    // Divider
    const divider = document.createElement('hr')
    divider.className = 'prop-divider'
    container.appendChild(divider)

    // Export buttons
    const exportHeader = document.createElement('div')
    exportHeader.className = 'prop-export-header'
    exportHeader.textContent = 'Export'
    container.appendChild(exportHeader)

    _makeExportButton(container, '⬇ Export as SVG', '#2a6a3a', () => pe && pe.exportSVG())
    _makeExportButton(container, '⬇ Export as PDF', '#3a2a6a', () => pe && pe.exportPDF())
  }

  function _makeExportButton(container, label, bg, onClick) {
    const btn = document.createElement('button')
    btn.textContent = label
    btn.className = 'prop-action-btn'
    btn.style.background = bg
    btn.addEventListener('click', onClick)
    container.appendChild(btn)
  }

  // ── VIEWPORT PROPERTIES TAB ────────────────────────────────────────────────

  function renderViewportPropertiesTab(container, vp) {
    const header = document.createElement('div')
    header.className = 'prop-section-header'
    header.textContent = 'Viewport Properties'
    container.appendChild(header)

    createPropertyField(container, 'ID', vp.id, null, true)

    createPropertyField(container, 'X (cm)', vp.x.toFixed(3), (val) => {
      const n = parseFloat(val)
      if (!isNaN(n)) {
        vp.x = n
        vp.refreshGeometry()
      }
    })
    createPropertyField(container, 'Y (cm)', vp.y.toFixed(3), (val) => {
      const n = parseFloat(val)
      if (!isNaN(n)) {
        vp.y = n
        vp.refreshGeometry()
      }
    })
    createPropertyField(container, 'Width (cm)', vp.w.toFixed(3), (val) => {
      const n = parseFloat(val)
      if (!isNaN(n) && n > 0) {
        vp.w = n
        vp.refreshGeometry()
      }
    })
    createPropertyField(container, 'Height (cm)', vp.h.toFixed(3), (val) => {
      const n = parseFloat(val)
      if (!isNaN(n) && n > 0) {
        vp.h = n
        vp.refreshGeometry()
      }
    })
    createPropertyField(container, 'Scale (1:N)', vp.scale, (val) => {
      const n = parseFloat(val)
      if (!isNaN(n) && n > 0) vp.setScale(n)
    })
    createPropertyField(container, 'Model Origin X', vp.modelOriginX.toFixed(3), (val) => {
      const n = parseFloat(val)
      if (!isNaN(n)) vp.setModelOrigin(n, vp.modelOriginY)
    })
    createPropertyField(container, 'Model Origin Y', vp.modelOriginY.toFixed(3), (val) => {
      const n = parseFloat(val)
      if (!isNaN(n)) vp.setModelOrigin(vp.modelOriginX, n)
    })

    // Delete button
    const deleteBtn = document.createElement('button')
    deleteBtn.textContent = '🗑 Delete Viewport'
    deleteBtn.className = 'prop-delete-vp-btn'
    deleteBtn.addEventListener('click', () => {
      if (editor.paperEditor) editor.paperEditor.removeViewport(vp.id)
      editor.selected = []
      safeDispatch('updatedProperties')
    })
    container.appendChild(deleteBtn)
  }

  // ── COLOR TRANSLATION TAB ───────────────────────────────────────────────────

  function renderColorTranslationTab(container) {
    const pe = editor.paperEditor
    const cfg = editor.paperConfig

    const header = document.createElement('div')
    header.className = 'prop-section-header'
    header.textContent = 'Color Translation (Print)'
    container.appendChild(header)

    // Presets row
    const presetsRow = document.createElement('div')
    presetsRow.className = 'prop-presets-row'
    ;[
      ['Color', null],
      ['Monochrome', '#000000'],
      ['Grayscale', 'grayscale'],
    ].forEach(([label, preset]) => {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.className = 'prop-preset-btn'
      btn.addEventListener('click', () => {
        const colors = pe ? pe.getUsedColors() : []
        colors.forEach((c) => {
          if (!cfg.colorMap[c]) cfg.colorMap[c] = { printColor: c, enabled: true }
          if (preset === null) {
            cfg.colorMap[c].printColor = c // pass-through
          } else if (preset === 'grayscale') {
            cfg.colorMap[c].printColor = _toGrayscale(c)
          } else {
            cfg.colorMap[c].printColor = preset
          }
        })
        editor.signals.colorMapUpdated.dispatch()
        render()
      })
      presetsRow.appendChild(btn)
    })
    container.appendChild(presetsRow)

    // Color rows
    const colors = pe ? pe.getUsedColors() : []
    if (colors.length === 0) {
      const empty = document.createElement('p')
      empty.textContent = 'No colors found in model drawing'
      empty.className = 'prop-empty-msg'
      container.appendChild(empty)
      return
    }

    colors.forEach((sourceColor) => {
      if (!cfg.colorMap[sourceColor]) {
        cfg.colorMap[sourceColor] = { printColor: sourceColor, enabled: true }
      }
      const mapping = cfg.colorMap[sourceColor]

      const row = document.createElement('div')
      row.className = 'property-row'
      row.style.gap = '6px'

      // Enable checkbox
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = mapping.enabled
      cb.style.flexShrink = '0'
      cb.addEventListener('change', () => {
        mapping.enabled = cb.checked
        editor.signals.colorMapUpdated.dispatch()
      })

      // Source color swatch
      const srcSwatch = document.createElement('div')
      srcSwatch.className = 'prop-color-swatch'
      srcSwatch.style.background = sourceColor
      srcSwatch.title = sourceColor

      const arrow = document.createElement('span')
      arrow.textContent = '→'
      arrow.style.opacity = '0.5'

      // Print color swatch (clickable)
      const printSwatch = document.createElement('div')
      printSwatch.className = 'prop-color-swatch'
      printSwatch.style.background = mapping.printColor
      printSwatch.style.cursor = 'pointer'
      printSwatch.title = `Print: ${mapping.printColor}`
      printSwatch.addEventListener('click', () => {
        openColorPicker(mapping.printColor, (newColor) => {
          mapping.printColor = newColor
          printSwatch.style.background = newColor
          printSwatch.title = `Print: ${newColor}`
          editor.signals.colorMapUpdated.dispatch()
        })
      })

      const colorLabel = document.createElement('span')
      colorLabel.className = 'prop-color-label'
      colorLabel.textContent = sourceColor

      row.appendChild(cb)
      row.appendChild(srcSwatch)
      row.appendChild(arrow)
      row.appendChild(printSwatch)
      row.appendChild(colorLabel)
      container.appendChild(row)
    })
  }

  function _toGrayscale(hexColor) {
    const r = parseInt(hexColor.slice(1, 3), 16)
    const g = parseInt(hexColor.slice(3, 5), 16)
    const b = parseInt(hexColor.slice(5, 7), 16)
    const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
    const h = lum.toString(16).padStart(2, '0')
    return `#${h}${h}${h}`
  }

  function renderCollectionStyleTab(container, element) {
    const id = element.attr('id')
    const data = editor.collections.get(id)
    if (!data) return

    // Default stroke color
    createColorProperty(
      container,
      'Stroke',
      data.style.stroke || 'white',
      (value) => {
        setCollectionStyle(editor, id, { stroke: value })
      },
      () => {},
    )

    // Default stroke width
    createPropertyField(container, 'Stroke Width', data.style['stroke-width'] || 0.1, (value) => {
      const num = parseFloat(value)
      if (!isNaN(num) && num >= 0) {
        setCollectionStyle(editor, id, { 'stroke-width': num })
      }
    })

    // Default stroke dasharray
    createPropertyField(container, 'Dash Array', data.style['stroke-dasharray'] || 'none', (value) => {
      const val = value.trim()
      setCollectionStyle(editor, id, { 'stroke-dasharray': val === '' ? 'none' : val })
    })

    // Default fill
    createColorProperty(
      container,
      'Fill',
      data.style.fill || 'transparent',
      (value) => {
        setCollectionStyle(editor, id, { fill: value })
      },
      () => {},
    )

    // Default opacity
    createPropertyField(container, 'Opacity', data.style.opacity ?? 1, (value) => {
      const num = parseFloat(value)
      if (!isNaN(num) && num >= 0 && num <= 1) {
        setCollectionStyle(editor, id, { opacity: num })
      }
    })
  }

  function renderCollectionTransformTab(container, element) {
    const id = element.attr('id')
    const data = editor.collections.get(id)
    if (!data) return

    // Collection name (editable)
    createPropertyField(container, 'Name', element.attr('name') || 'Collection', (value) => {
      element.attr('name', value)
      safeDispatch('updatedOutliner')
    })

    // Type (read-only)
    createPropertyField(container, 'Type', 'Collection', null, true)

    // Element count (read-only)
    const childCount = data.group.children().length
    createPropertyField(container, 'Elements', childCount, null, true)

    // Visibility (read-only)
    createPropertyField(container, 'Visible', data.visible ? 'Yes' : 'No', null, true)

    // Locked (read-only)
    createPropertyField(container, 'Locked', data.locked ? 'Yes' : 'No', null, true)
  }

  function renderTransformTab(container, element, node) {
    function makeAccordion(title, key) {
      const isExpanded = transformAccordionsExpanded.has(key)
      const accordion = document.createElement('div')
      accordion.className = 'prop-accordion'

      const header = document.createElement('div')
      header.className = 'prop-accordion-header'

      const collapseIcon = document.createElement('span')
      collapseIcon.className = 'icon icon-collapse prop-collapse-icon' + (isExpanded ? ' on' : '')
      if (!isExpanded) collapseIcon.style.transform = 'rotate(-90deg)'

      const titleEl = document.createElement('span')
      titleEl.className = 'prop-section-title'
      titleEl.textContent = title

      header.appendChild(collapseIcon)
      header.appendChild(titleEl)

      const body = document.createElement('div')
      body.className = 'prop-accordion-body'
      body.style.display = isExpanded ? 'flex' : 'none'

      header.addEventListener('click', () => {
        const open = body.style.display === 'none'
        body.style.display = open ? 'flex' : 'none'
        collapseIcon.style.transform = open ? '' : 'rotate(-90deg)'
        collapseIcon.classList.toggle('on', open)
        if (open) transformAccordionsExpanded.add(key)
        else transformAccordionsExpanded.delete(key)
      })

      accordion.appendChild(header)
      accordion.appendChild(body)
      container.appendChild(accordion)
      return body
    }

    // ── General ──────────────────────────────────────────────────────────────
    const generalBody = makeAccordion('General', 'general')

    createPropertyField(generalBody, 'Name', element.attr('name') || node.nodeName, (value) => {
      element.attr('name', value)
      safeDispatch('updatedOutliner')
    })
    createPropertyField(generalBody, 'Type', node.nodeName, null, true)
    createPropertyField(generalBody, 'ID', element.attr('id'), null, true)

    // Text content goes in General
    if (node.nodeName === 'text') {
      createPropertyField(generalBody, 'Content', element.text(), (value) => {
        element.text(value)
        safeDispatch('refreshHandlers')
      })
    }

    // Collection dropdown
    let collectionAncestor = element.parent()
    while (collectionAncestor && collectionAncestor.node && collectionAncestor.node.nodeName !== 'svg') {
      if (collectionAncestor.attr('data-collection') === 'true') break
      collectionAncestor = collectionAncestor.parent()
    }
    const currentParentId =
      collectionAncestor && collectionAncestor.attr('data-collection') === 'true' ? collectionAncestor.attr('id') : null

    if (currentParentId && editor.collections.has(currentParentId)) {
      const row = document.createElement('div')
      row.className = 'property-row'
      const labelEl = document.createElement('label')
      labelEl.textContent = 'Collection'
      labelEl.className = 'property-label'
      const select = document.createElement('select')
      select.className = 'property-input property-select'
      editor.collections.forEach((data, colId) => {
        if (colId === 'paper-annotations') return
        const option = document.createElement('option')
        option.value = colId
        option.textContent = data.group.attr('name') || 'Collection'
        if (colId === currentParentId) option.selected = true
        select.appendChild(option)
      })
      select.addEventListener('change', (e) => {
        const newColId = e.target.value
        const newCollection = editor.collections.get(newColId)
        if (newCollection && newCollection.group) {
          newCollection.group.add(element)
          if (element.attr('data-element-type') === 'dimension') {
            try {
              const dimData = JSON.parse(element.attr('data-dim-data'))
              editor.signals.refreshDimensions.dispatch({ element, data: dimData })
            } catch (_) { applyCollectionStyleToElement(editor, element) }
          } else {
            applyCollectionStyleToElement(editor, element)
          }
          safeDispatch('updatedOutliner')
          safeDispatch('updatedProperties')
        }
      })
      row.appendChild(labelEl)
      row.appendChild(select)
      generalBody.appendChild(row)
    }

    // ── Transform ─────────────────────────────────────────────────────────────
    const transformBody = makeAccordion('Transform', 'transform')

    if (node.nodeName === 'line') {
      createPropertyField(transformBody, 'X1', parseFloat(element.attr('x1')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) { element.attr('x1', num); safeDispatch('refreshHandlers') }
      })
      createPropertyField(transformBody, 'Y1', parseFloat(element.attr('y1')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) { element.attr('y1', num); safeDispatch('refreshHandlers') }
      })
      createPropertyField(transformBody, 'X2', parseFloat(element.attr('x2')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) { element.attr('x2', num); safeDispatch('refreshHandlers') }
      })
      createPropertyField(transformBody, 'Y2', parseFloat(element.attr('y2')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) { element.attr('y2', num); safeDispatch('refreshHandlers') }
      })
    } else if (node.nodeName === 'circle') {
      createPropertyField(transformBody, 'CX', parseFloat(element.attr('cx')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) { element.attr('cx', num); safeDispatch('refreshHandlers') }
      })
      createPropertyField(transformBody, 'CY', parseFloat(element.attr('cy')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) { element.attr('cy', num); safeDispatch('refreshHandlers') }
      })
      createPropertyField(transformBody, 'Radius', parseFloat(element.attr('r')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num) && num > 0) { element.attr('r', num); safeDispatch('refreshHandlers') }
      })
    } else if (node.nodeName === 'rect') {
      createPropertyField(transformBody, 'X', parseFloat(element.attr('x')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) { element.attr('x', num); safeDispatch('refreshHandlers') }
      })
      createPropertyField(transformBody, 'Y', parseFloat(element.attr('y')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) { element.attr('y', num); safeDispatch('refreshHandlers') }
      })
      createPropertyField(transformBody, 'Width', parseFloat(element.attr('width')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num) && num > 0) { element.attr('width', num); safeDispatch('refreshHandlers') }
      })
      createPropertyField(transformBody, 'Height', parseFloat(element.attr('height')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) { element.attr('height', num); safeDispatch('refreshHandlers') }
      })
    } else if (node.nodeName === 'text') {
      createPropertyField(transformBody, 'X', parseFloat(element.x()).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) { element.x(num); safeDispatch('refreshHandlers') }
      })
      createPropertyField(transformBody, 'Y', parseFloat(element.y()).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) { element.y(num); safeDispatch('refreshHandlers') }
      })
      const fontSize = element.font('size') || element.css('font-size') || 10
      createPropertyField(transformBody, 'Font Size', parseFloat(fontSize).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num) && num > 0) { element.font({ size: num }); safeDispatch('refreshHandlers') }
      })
    } else if (node.nodeName === 'path') {
      const bbox = element.bbox()
      createPropertyField(transformBody, 'X', bbox.x.toFixed(2), null, true)
      createPropertyField(transformBody, 'Y', bbox.y.toFixed(2), null, true)
      createPropertyField(transformBody, 'Width', bbox.width.toFixed(2), null, true)
      createPropertyField(transformBody, 'Height', bbox.height.toFixed(2), null, true)
    } else if (node.nodeName === 'use' && element.attr('data-block-instance') === 'true') {
      createPropertyField(transformBody, 'Block', element.attr('data-block-name') || '', null, true)
      createPropertyField(transformBody, 'X', parseFloat(element.x()).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) { element.x(num); editor.spatialIndex.markDirty(); editor.fullSpatialIndex.markDirty(); safeDispatch('refreshHandlers') }
      })
      createPropertyField(transformBody, 'Y', parseFloat(element.y()).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) { element.y(num); editor.spatialIndex.markDirty(); editor.fullSpatialIndex.markDirty(); safeDispatch('refreshHandlers') }
      })
    }

    if (element.transform) {
      const currentRotation = element.transform().rotate || 0
      createPropertyField(transformBody, 'Rotation', parseFloat(currentRotation).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          const currentRot = element.transform().rotate || 0
          const delta = num - currentRot
          if (delta !== 0) {
            const bbox = element.bbox()
            const transform = element.transform()
            const matrix = new Matrix(transform)
            // Map the element's local bounding center into global space
            const globalCx = matrix.a * bbox.cx + matrix.c * bbox.cy + matrix.e
            const globalCy = matrix.b * bbox.cx + matrix.d * bbox.cy + matrix.f
            element.transform(matrix.rotate(delta, globalCx, globalCy))
            safeDispatch('refreshHandlers')
            safeDispatch('updatedProperties')
          }
        }
      })
    }
  }

  function renderTextStylePicker(container, element) {
    const styleId = element.attr('data-text-style-id') || 'Standard'

    const header = document.createElement('div')
    header.style.cssText = 'font-weight:bold;padding:6px 8px 4px;font-size:11px;text-transform:uppercase;opacity:0.7;letter-spacing:0.5px;'
    header.textContent = 'Text Style'
    container.appendChild(header)

    const styleRow = document.createElement('div')
    styleRow.className = 'property-row'

    const styleLabel = document.createElement('label')
    styleLabel.textContent = 'Style'
    styleLabel.className = 'property-label'

    const styleSelect = document.createElement('select')
    styleSelect.className = 'property-input property-select'

    editor.textStyleManager.styles.forEach((styleObj, sId) => {
      const opt = document.createElement('option')
      opt.value = sId
      opt.textContent = styleObj.name
      if (sId === styleId) opt.selected = true
      styleSelect.appendChild(opt)
    })

    styleSelect.addEventListener('change', (e) => {
      const newId = e.target.value
      element.attr('data-text-style-id', newId)
      const p = editor.textStyleManager.getStyle(newId).properties
      element.font({ family: p.fontFamily, size: p.fontSize, weight: p.fontWeight, style: p.fontStyle })
      element.attr({
        'text-anchor': p.textAnchor,
        'dominant-baseline': p.dominantBaseline !== 'auto' ? p.dominantBaseline : null,
        'letter-spacing': p.letterSpacing !== 0 ? p.letterSpacing : null,
        'text-decoration': p.textDecoration !== 'none' ? p.textDecoration : null,
      })
      if ((element.attr('data-fill-source') || 'textstyle') === 'textstyle') {
        element.css('fill', p.fill)
      }
      safeDispatch('updatedProperties')
    })

    styleRow.appendChild(styleLabel)
    styleRow.appendChild(styleSelect)
    container.appendChild(styleRow)
  }

  function renderDimStylePicker(container, element) {
    const dimDataRaw = element.attr('data-dim-data')
    if (!dimDataRaw) return
    try {
      const dimData = JSON.parse(dimDataRaw)
      const styleId = dimData.styleId || 'Standard'

      const header = document.createElement('div')
      header.className = 'prop-section-header'
      header.textContent = 'Dimension Style'
      container.appendChild(header)

      const styleRow = document.createElement('div')
      styleRow.className = 'property-row'

      const styleLabel = document.createElement('label')
      styleLabel.textContent = 'Style'
      styleLabel.className = 'property-label'

      const styleSelect = document.createElement('select')
      styleSelect.className = 'property-input property-select'

      editor.dimensionManager.styles.forEach((styleObj, sId) => {
        const opt = document.createElement('option')
        opt.value = sId
        opt.textContent = styleObj.name
        if (sId === styleId) opt.selected = true
        styleSelect.appendChild(opt)
      })

      styleSelect.addEventListener('change', (e) => {
        const newStyleId = e.target.value
        dimData.styleId = newStyleId
        element.attr('data-dim-data', JSON.stringify(dimData))
        editor.signals.refreshDimensions.dispatch({ element: element, data: dimData })
        safeDispatch('updatedProperties')
      })

      styleRow.appendChild(styleLabel)
      styleRow.appendChild(styleSelect)
      container.appendChild(styleRow)
    } catch (e) {
      console.warn('Failed to parse dimension data', e)
    }
  }

  function renderHatchProperties(container, element) {
    const hd = element.data('hatchData')
    if (!hd) return

    const section = document.createElement('div')
    section.className = 'properties-content'
    container.appendChild(section)

    // Pattern selector
    const patRow = document.createElement('div')
    patRow.className = 'property-row'
    const patLabel = document.createElement('label')
    patLabel.textContent = 'Pattern'
    patLabel.className = 'property-label'
    const patSelect = document.createElement('select')
    patSelect.className = 'property-input'
    patSelect.style.flex = '1'
    Object.entries(HATCH_PATTERNS).forEach(([key, def]) => {
      const opt = document.createElement('option')
      opt.value = key
      opt.textContent = def.label
      if (key === (hd.patternType || 'ANSI31')) opt.selected = true
      patSelect.appendChild(opt)
    })
    patRow.appendChild(patLabel)
    patRow.appendChild(patSelect)
    section.appendChild(patRow)

    // Color picker
    let currentColor = hd.fillColor || '#888888'
    const colorRow = document.createElement('div')
    colorRow.className = 'property-row'
    const colorLabel = document.createElement('label')
    colorLabel.textContent = 'Color'
    colorLabel.className = 'property-label'
    const colorBox = document.createElement('div')
    colorBox.className = 'property-input prop-color-box'
    colorBox.style.cursor = 'pointer'
    colorBox.style.background = currentColor
    attachColorCopyPaste(
      colorBox,
      () => currentColor,
      (hex) => { currentColor = hex; colorBox.style.background = hex; applyFill() }
    )
    colorBox.addEventListener('click', () => {
      openColorPicker(
        currentColor,
        (newColor) => { currentColor = newColor; colorBox.style.background = newColor; applyFill() },
        (newColor) => { colorBox.style.background = newColor }
      )
    })
    colorRow.appendChild(colorLabel)
    colorRow.appendChild(colorBox)
    section.appendChild(colorRow)

    // Scale
    const scaleRow = document.createElement('div')
    scaleRow.className = 'property-row'
    const scaleLabel = document.createElement('label')
    scaleLabel.textContent = 'Scale'
    scaleLabel.className = 'property-label'
    const scaleInput = document.createElement('input')
    scaleInput.type = 'number'
    scaleInput.className = 'property-input'
    scaleInput.style.flex = '1'
    scaleInput.min = 1
    scaleInput.max = 500
    scaleInput.value = hd.hatchScale || 10
    scaleRow.appendChild(scaleLabel)
    scaleRow.appendChild(scaleInput)
    section.appendChild(scaleRow)

    // Opacity (SOLID only)
    const opacityRow = document.createElement('div')
    opacityRow.className = 'property-row'
    const opacityLabel = document.createElement('label')
    opacityLabel.textContent = 'Opacity'
    opacityLabel.className = 'property-label'
    const opacityInput = document.createElement('input')
    opacityInput.type = 'text'
    opacityInput.className = 'property-input'
    opacityInput.style.flex = '1'
    opacityInput.value = (hd.opacity ?? 0.3).toFixed(2)
    opacityRow.appendChild(opacityLabel)
    opacityRow.appendChild(opacityInput)
    opacityRow.style.display = (hd.patternType || 'ANSI31') === 'SOLID' ? '' : 'none'
    section.appendChild(opacityRow)

    function applyFill() {
      const type = patSelect.value
      const color = currentColor
      const scale = Number(scaleInput.value) || 10
      const opacity = parseFloat(opacityInput.value)
      const safeOpacity = isNaN(opacity) ? 0.3 : Math.min(1, Math.max(0, opacity))

      let fillValue
      if (type === 'SOLID') {
        fillValue = { color, opacity: safeOpacity }
      } else {
        const patternId = ensurePattern(editor.svg, type, color, scale)
        fillValue = patternId ? `url(#${patternId})` : { color, opacity: 0.3 }
      }

      element.fill(fillValue)
      element.data('hatchData', { ...hd, patternType: type, fillColor: color, hatchScale: scale, opacity: safeOpacity })
      opacityRow.style.display = type === 'SOLID' ? '' : 'none'
      safeDispatch('refreshHandlers')
    }

    patSelect.addEventListener('change', applyFill)
    scaleInput.addEventListener('change', applyFill)
    opacityInput.addEventListener('change', applyFill)
  }

  function renderStyleTab(container, element, node) {
    const computedStyle = window.getComputedStyle(node)

    // Hatch elements get their own dedicated property controls
    if (element.data && element.data('hatchData')) {
      renderHatchProperties(container, element)
      return
    }

    // If this is a dimension element, show the dimension style picker first
    if (node.nodeName === 'g' && element.attr('data-element-type') === 'dimension') {
      renderDimStylePicker(container, element)
    }

    // If this is a text element, show the text style picker first
    if (node.nodeName === 'text') {
      renderTextStylePicker(container, element)
    }

    // Check if element is inside a collection
    let collectionAncestor = element.parent ? element.parent() : null
    while (collectionAncestor && collectionAncestor.node && collectionAncestor.node.nodeName !== 'svg') {
      if (collectionAncestor.attr && collectionAncestor.attr('data-collection') === 'true') break
      collectionAncestor = collectionAncestor.parent()
    }
    const inCollection = collectionAncestor && collectionAncestor.attr && collectionAncestor.attr('data-collection') === 'true'
    let collectionData = null
    if (inCollection) {
      collectionData = editor.collections.get(collectionAncestor.attr('id'))
    }
    const overrides = inCollection ? getElementOverrides(element) : {}

    // Helper: create a style property row with consistent 3-slot controls layout:
    // [label] [override-slot] [enable-slot] [input]
    // Slots use spacers when not applicable, ensuring all rows align.
    function createStylableProperty(propName, label, currentValue, applyFn, isColor, liveFn) {
      const isOverridden = !!overrides[propName]

      const row = document.createElement('div')
      row.className = 'property-row'

      const labelEl = document.createElement('label')
      labelEl.textContent = label
      labelEl.className = 'property-label'

      const controls = document.createElement('div')
      controls.className = 'prop-controls'
      controls.style.gap = '4px'
      controls.style.overflow = 'hidden'

      // Slot 1: Override toggle (O/C) or fixed-width spacer
      if (inCollection && collectionData) {
        const toggleBtn = document.createElement('button')
        toggleBtn.textContent = isOverridden ? 'O' : 'C'
        toggleBtn.title = isOverridden ? 'Own style — click to inherit from collection' : 'Collection style — click to override'
        toggleBtn.className = 'prop-style-toggle'
        toggleBtn.style.background = isOverridden ? '#555' : 'var(--accent-color)'
        toggleBtn.addEventListener('click', () => {
          overrides[propName] = !isOverridden
          setElementOverrides(element, overrides)
          if (!overrides[propName]) applyCollectionStyleToElement(editor, element)
          safeDispatch('updatedProperties')
        })
        controls.appendChild(toggleBtn)
      } else {
        const spacer = document.createElement('div')
        spacer.style.width = '20px'
        spacer.style.flexShrink = '0'
        controls.appendChild(spacer)
      }

      // Slot 2 + 3: Enable checkbox + color box, or spacer + text input
      if (isColor) {
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.checked = currentValue !== 'none' && currentValue !== 'transparent'
        checkbox.className = 'prop-checkbox-sm'
        if (inCollection && collectionData) checkbox.disabled = !isOverridden

        const colorBox = document.createElement('div')
        colorBox.className = 'property-input prop-color-box-wide'

        function updateBoxColor(color) {
          if (color === 'none' || color === 'transparent') {
            colorBox.style.background = 'repeating-linear-gradient(45deg, #444 0px, #444 4px, #222 4px, #222 8px)'
          } else {
            colorBox.style.background = rgbToHex(color)
          }
        }
        updateBoxColor(currentValue)

        attachColorCopyPaste(
          colorBox,
          () => (currentValue === 'none' || currentValue === 'transparent') ? null : rgbToHex(currentValue),
          (hex) => { currentValue = hex; updateBoxColor(hex); applyFn(hex); checkbox.checked = true; syncBoxState() }
        )

        function syncBoxState() {
          const overrideBlocked = inCollection && collectionData && !isOverridden
          const disabled = overrideBlocked || !checkbox.checked
          colorBox.style.opacity = disabled ? '0.3' : '1'
          colorBox.style.pointerEvents = disabled ? 'none' : 'auto'
        }
        syncBoxState()

        checkbox.addEventListener('change', () => {
          syncBoxState()
          const applyVal = checkbox.checked ? rgbToHex(colorBox.style.background) || '#000000' : 'none'
          applyFn(applyVal)
        })

        colorBox.addEventListener('click', () => {
          if ((inCollection && collectionData && !isOverridden) || !checkbox.checked) return
          openColorPicker(
            colorBox.style.background,
            (newColor) => {
              updateBoxColor(newColor)
              applyFn(newColor)
            },
            liveFn
              ? (newColor) => {
                  updateBoxColor(newColor)
                  liveFn(newColor)
                }
              : undefined,
          )
        })

        controls.appendChild(checkbox)
        controls.appendChild(colorBox)
      } else {
        const spacer = document.createElement('div')
        spacer.style.width = '14px'
        spacer.style.flexShrink = '0'
        controls.appendChild(spacer)

        const textInput = document.createElement('input')
        textInput.type = 'text'
        textInput.value = currentValue
        textInput.className = 'property-input'
        if (inCollection && collectionData) textInput.disabled = !isOverridden

        textInput.addEventListener('change', (e) => applyFn(e.target.value))
        textInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            applyFn(e.target.value)
            textInput.blur()
          }
        })

        controls.appendChild(textInput)
      }

      row.appendChild(labelEl)
      row.appendChild(controls)
      container.appendChild(row)
    }

    // Helper function to apply a style to an element, and if it's a group,
    // strip that inline style from its children so they inherit properly.
    const applyPropAndInherit = (el, prop, val) => {
      el.css(prop, val)
      if (el.type === 'g') {
        const stripFromChildren = (parent) => {
          parent.children().each((child) => {
            const overrides = getElementOverrides(child)
            if (!overrides[prop]) {
              child.node.style.removeProperty(prop)
              child.node.removeAttribute(prop)
            }
            if (child.type === 'g') stripFromChildren(child)
          })
        }
        stripFromChildren(el)
      }
    }

    // Fill Color (only for closed shapes or paths or text or generic groups)
    if (['circle', 'rect', 'path', 'polygon', 'text', 'g'].includes(node.nodeName)) {
      if (node.nodeName === 'text') {
        // Text fill: 3-way source — textstyle | collection | custom
        const fillSource = element.attr('data-fill-source') || 'textstyle'
        const styleId = element.attr('data-text-style-id') || 'Standard'
        const tsProps = editor.textStyleManager.getStyle(styleId)?.properties
        const textStyleFill = tsProps?.fill || '#ffffff'

        let swatchColor
        if (fillSource === 'textstyle') {
          swatchColor = textStyleFill
        } else if (fillSource === 'collection') {
          swatchColor = collectionData?.style?.fill || '#888888'
        } else {
          const raw = element.css('fill') || element.attr('fill')
          swatchColor = computedStyle.fill && computedStyle.fill !== 'none' ? computedStyle.fill : raw || '#ffffff'
          if (swatchColor === 'transparent' || swatchColor === 'rgba(0, 0, 0, 0)') swatchColor = '#ffffff'
        }

        const row = document.createElement('div')
        row.className = 'property-row'
        const labelEl = document.createElement('label')
        labelEl.textContent = 'Fill'
        labelEl.className = 'property-label'

        const controls = document.createElement('div')
        controls.className = 'prop-controls'
        controls.style.gap = '4px'
        controls.style.overflow = 'hidden'

        const modeSelect = document.createElement('select')
        modeSelect.className = 'property-input property-select'
        modeSelect.style.flex = '1'
        modeSelect.style.minWidth = '0'
        ;[
          { value: 'textstyle', label: 'Text Style' },
          { value: 'collection', label: 'Collection' },
          { value: 'custom', label: 'Custom' },
        ].forEach(({ value, label }) => {
          const opt = document.createElement('option')
          opt.value = value
          opt.textContent = label
          if (value === fillSource) opt.selected = true
          if (value === 'collection' && !inCollection) opt.disabled = true
          modeSelect.appendChild(opt)
        })

        const colorBox = document.createElement('div')
        colorBox.className = 'property-input prop-color-box-wide'
        colorBox.style.background = swatchColor
        colorBox.style.cursor = fillSource === 'custom' ? 'pointer' : 'default'
        colorBox.style.opacity = fillSource === 'custom' ? '1' : '0.5'

        attachColorCopyPaste(
          colorBox,
          () => modeSelect.value === 'custom' ? rgbToHex(colorBox.style.background) : null,
          (hex) => {
            if (modeSelect.value !== 'custom') return
            element.css('fill', hex)
            colorBox.style.background = hex
            safeDispatch('refreshHandlers')
          }
        )

        colorBox.addEventListener('click', () => {
          if (modeSelect.value !== 'custom') return
          openColorPicker(
            colorBox.style.background,
            (newColor) => {
              element.css('fill', newColor)
              colorBox.style.background = newColor
              safeDispatch('refreshHandlers')
            },
            (liveColor) => {
              element.css('fill', liveColor)
              colorBox.style.background = liveColor
            },
          )
        })

        modeSelect.addEventListener('change', (e) => {
          const mode = e.target.value
          element.attr('data-fill-source', mode)
          if (mode === 'textstyle') {
            element.css('fill', textStyleFill)
            colorBox.style.background = textStyleFill
            colorBox.style.cursor = 'default'
            colorBox.style.opacity = '0.5'
            if (inCollection) { overrides.fill = true; setElementOverrides(element, overrides) }
          } else if (mode === 'collection') {
            element.node.style.removeProperty('fill')
            element.node.removeAttribute('fill')
            if (inCollection) {
              overrides.fill = false
              setElementOverrides(element, overrides)
              applyCollectionStyleToElement(editor, element)
            }
            const colFill = collectionData?.style?.fill || '#888888'
            colorBox.style.background = colFill
            colorBox.style.cursor = 'default'
            colorBox.style.opacity = '0.5'
          } else {
            colorBox.style.cursor = 'pointer'
            colorBox.style.opacity = '1'
            if (inCollection) { overrides.fill = true; setElementOverrides(element, overrides) }
          }
          safeDispatch('refreshHandlers')
        })

        controls.appendChild(modeSelect)
        controls.appendChild(colorBox)
        row.appendChild(labelEl)
        row.appendChild(controls)
        container.appendChild(row)
      } else {
        const currentFill = element.css('fill') || element.attr('fill')
        let visualFill = computedStyle.fill !== 'none' ? computedStyle.fill : currentFill || '#ffffff'
        if (visualFill === 'transparent' || visualFill === 'rgba(0, 0, 0, 0)') visualFill = 'none'

        createStylableProperty(
          'fill',
          'Fill',
          visualFill,
          (value) => {
            applyPropAndInherit(element, 'fill', value)
            safeDispatch('refreshHandlers')
          },
          true,
          (value) => element.css('fill', value),
        )
      }
    }

    // Stroke Color
    const currentStroke = element.css('stroke') || element.attr('stroke')
    let visualStroke = computedStyle.stroke !== 'none' ? computedStyle.stroke : currentStroke || '#000000'
    if (visualStroke === 'transparent' || visualStroke === 'rgba(0, 0, 0, 0)') visualStroke = 'none'

    createStylableProperty(
      'stroke',
      'Stroke',
      visualStroke,
      (value) => {
        applyPropAndInherit(element, 'stroke', value)
        safeDispatch('refreshHandlers')
      },
      true,
      (value) => element.css('stroke', value),
    )

    // Stroke Width
    const currentWidth =
      parseFloat(element.css('stroke-width') || element.attr('stroke-width')) || parseFloat(computedStyle.strokeWidth) || 1

    createStylableProperty(
      'stroke-width',
      'Stroke Width',
      currentWidth,
      (value) => {
        const num = parseFloat(value)
        if (!isNaN(num) && num >= 0) {
          applyPropAndInherit(element, 'stroke-width', num)
          safeDispatch('refreshHandlers')
        }
      },
      false,
    )

    // Stroke Dasharray
    const currentDasharray = element.css('stroke-dasharray') || element.attr('stroke-dasharray') || computedStyle.strokeDasharray || 'none'
    const visualDasharray = currentDasharray === 'none' || currentDasharray === '' ? '' : currentDasharray

    createStylableProperty(
      'stroke-dasharray',
      'Dash Array',
      visualDasharray,
      (value) => {
        const val = value.trim()
        if (val === '') {
          element.node.style.removeProperty('stroke-dasharray')
          element.node.removeAttribute('stroke-dasharray')
          if (element.type === 'g') applyPropAndInherit(element, 'stroke-dasharray', null) // clear children too
        } else {
          applyPropAndInherit(element, 'stroke-dasharray', val)
        }
        safeDispatch('refreshHandlers')
      },
      false,
    )

    if (node.nodeName === 'text') {
      const currentFamily = element.font('family') || element.css('font-family') || computedStyle.fontFamily || 'sans-serif'
      createStylableProperty(
        'font-family',
        'Font Family',
        currentFamily,
        (value) => {
          if (value.trim() !== '') {
            element.font({ family: value })
            safeDispatch('refreshHandlers')
          }
        },
        false,
      )
    }

    // Opacity (always element-level, no collection inheritance)
    createPropertyField(container, 'Opacity', parseFloat(element.css('opacity') || element.attr('opacity')) || 1, (value) => {
      const num = parseFloat(value)
      if (!isNaN(num) && num >= 0 && num <= 1) {
        element.css('opacity', num)
      }
    })
  }

  // Helper to convert any valid CSS color to #rrggbb
  function rgbToHex(color) {
    if (!color || color === 'none' || color === 'transparent') return '#000000'
    if (color.startsWith('#')) {
      if (color.length === 4) {
        return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3]
      }
      return color
    }
    const ctx = document.createElement('canvas').getContext('2d')
    ctx.fillStyle = color
    return ctx.fillStyle
  }

  let hiddenColorPicker = null

  /**
   * Wire Blender-style Ctrl+C / Ctrl+V color copy-paste to a color swatch div.
   * @param {HTMLElement} el       - The color box element
   * @param {() => string} getColor - Returns the current hex color of the box
   * @param {(hex: string) => void} setColor - Applies a new hex color to the box and fires the onChange
   */
  function attachColorCopyPaste(el, getColor, setColor) {
    el.addEventListener('mouseenter', () => { _hoveredColorBox = { el, getColor, setColor } })
    el.addEventListener('mouseleave', () => { if (_hoveredColorBox && _hoveredColorBox.el === el) _hoveredColorBox = null })
  }

  function openColorPicker(initialColor, onUpdate, onLiveUpdate) {
    if (!hiddenColorPicker) {
      hiddenColorPicker = document.createElement('input')
      hiddenColorPicker.type = 'color'
      hiddenColorPicker.style.position = 'fixed'
      hiddenColorPicker.style.left = '40%'
      hiddenColorPicker.style.top = '40%'
      hiddenColorPicker.style.opacity = '0'
      hiddenColorPicker.style.pointerEvents = 'none'
      hiddenColorPicker.style.zIndex = '-9999'
      document.body.appendChild(hiddenColorPicker)
    }

    // Refresh listeners by replacing node
    const newPicker = hiddenColorPicker.cloneNode(true)
    hiddenColorPicker.replaceWith(newPicker)
    hiddenColorPicker = newPicker

    hiddenColorPicker.value = rgbToHex(initialColor)

    let rafPending = false
    hiddenColorPicker.addEventListener('input', (e) => {
      if (rafPending) return
      rafPending = true
      const color = e.target.value
      requestAnimationFrame(() => {
        rafPending = false
        ;(onLiveUpdate || onUpdate)(color)
      })
    })
    hiddenColorPicker.addEventListener('change', (e) => {
      rafPending = false
      onUpdate(e.target.value)
    })

    hiddenColorPicker.click()
  }

  function createColorProperty(container, label, value, onChange, onLive) {
    const row = document.createElement('div')
    row.className = 'property-row'

    const labelEl = document.createElement('label')
    labelEl.textContent = label
    labelEl.className = 'property-label'

    const controls = document.createElement('div')
    controls.style.display = 'flex'
    controls.style.alignItems = 'center'
    controls.style.flex = '1'
    controls.style.gap = '5px'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = value !== 'none' && value !== 'transparent'
    checkbox.className = 'prop-checkbox-sm'

    const colorBox = document.createElement('div')
    colorBox.className = 'property-input prop-color-box-wide'

    function updateBoxColor(color) {
      if (color === 'none' || color === 'transparent') {
        colorBox.style.background = 'repeating-linear-gradient(45deg, #444 0px, #444 4px, #222 4px, #222 8px)'
      } else {
        colorBox.style.background = rgbToHex(color)
      }
    }
    updateBoxColor(value)

    attachColorCopyPaste(
      colorBox,
      () => (value === 'none' || value === 'transparent') ? null : rgbToHex(value),
      (hex) => { value = hex; updateBoxColor(hex); onChange(hex); checkbox.checked = true; colorBox.style.opacity = '1'; colorBox.style.pointerEvents = 'auto' }
    )

    if (!checkbox.checked) {
      colorBox.style.opacity = '0.3'
      colorBox.style.pointerEvents = 'none'
    }

    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        colorBox.style.opacity = '1'
        colorBox.style.pointerEvents = 'auto'
        onChange(rgbToHex(colorBox.style.background) || '#000000') // trigger an update
      } else {
        colorBox.style.opacity = '0.3'
        colorBox.style.pointerEvents = 'none'
        onChange('none')
      }
    })

    colorBox.addEventListener('click', () => {
      if (!checkbox.checked) return
      openColorPicker(
        colorBox.style.background,
        (newColor) => {
          updateBoxColor(newColor)
          onChange(newColor)
        },
        onLive
          ? (newColor) => {
              updateBoxColor(newColor)
              onLive(newColor)
            }
          : undefined,
      )
    })

    controls.appendChild(checkbox)
    controls.appendChild(colorBox)
    row.appendChild(labelEl)
    row.appendChild(controls)
    container.appendChild(row)
  }

  // Initial tab UI setup
  updateTabUI()

  // Focus management
  const propertiesPanelContainer = document.querySelector('.properties-panel-container')
  const viewport = document.querySelector('.viewport')

  if (propertiesPanelContainer) {
    propertiesPanelContainer.addEventListener('mouseenter', () => {
      editor.isEditingProperties = true
    })
    propertiesPanelContainer.addEventListener('mouseleave', () => {
      editor.isEditingProperties = false
      const terminalInput = document.getElementById('terminalInput')
      if (terminalInput) terminalInput.focus()
    })
  }

  if (viewport) {
    viewport.addEventListener('mouseenter', () => {
      editor.isEditingProperties = false
      const terminalInput = document.getElementById('terminalInput')
      if (terminalInput) terminalInput.focus()
    })
  }
}

function createPropertyField(container, label, value, onChange, readOnly = false, type = 'text') {
  const row = document.createElement('div')
  row.className = 'property-row'

  const labelEl = document.createElement('label')
  labelEl.textContent = label
  labelEl.className = 'property-label'

  const input = document.createElement('input')
  input.type = type
  input.value = value || ''
  input.className = 'property-input'
  input.readOnly = readOnly

  // Specific styling for color inputs to match theme
  if (type === 'color') {
    input.style.height = '24px'
    input.style.padding = '0 2px'
    input.style.cursor = 'pointer'
  }

  if (!readOnly && onChange) {
    input.addEventListener('change', (e) => {
      onChange(e.target.value)
    })
    input.addEventListener('input', (e) => {
      // Real-time update for color pickers
      if (type === 'color') {
        onChange(e.target.value)
      }
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        onChange(e.target.value)
        input.blur()
      }
    })
  }

  row.appendChild(labelEl)
  row.appendChild(input)
  container.appendChild(row)
}

export { Properties }
