import { setCollectionStyle, getElementOverrides, setElementOverrides, applyCollectionStyleToElement } from './Collection'
import { Matrix } from '@svgdotjs/svg.js'

const propertiesPanel = document.getElementById('properties-panel')

function Properties(editor) {
  const signals = editor.signals
  let activeTab = 'transform' // 'transform' | 'style' | 'settings' | 'dimstyles' | 'textstyles'
  const dimStylesExpanded = new Set()
  const textStylesExpanded = new Set()

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
    controls.style.cssText = 'display:flex;align-items:center;flex:1;gap:3px;min-width:0;'

    const toggleBtn = document.createElement('button')
    toggleBtn.textContent = isInherit ? 'C' : 'O'
    toggleBtn.title = isInherit ? 'Inheriting from collection — click to set fixed color' : 'Override — click to inherit from collection'
    toggleBtn.style.cssText =
      'font-size:9px;width:18px;height:18px;flex-shrink:0;border:1px solid #555;border-radius:3px;cursor:pointer;color:#ccc;padding:0;text-align:center;background:' +
      (isInherit ? 'var(--accent-color)' : '#555')

    const colorBox = document.createElement('div')
    colorBox.className = 'property-input'
    colorBox.style.cssText = 'height:20px;width:32px;padding:0;flex:none;border:1px solid #1d1d1d;border-radius:3px;'

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

    colorBox.addEventListener('click', () => {
      openColorPicker(
        currentColor,
        (newColor) => { currentColor = newColor; syncBox(false, newColor); onChange(newColor) },
        (newColor) => { currentColor = newColor; syncBox(false, newColor) },
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
    activeSelect.className = 'property-input'
    activeSelect.style.cssText = 'flex:1;min-width:0;height:24px;background:#2a2a2a;color:white;border:1px solid #1d1d1d;border-radius:3px;'
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
      accordion.style.cssText = 'border-top:1px solid #2a2a2a;margin-top:2px;'

      // Header row
      const accordionHeader = document.createElement('div')
      accordionHeader.style.cssText = 'display:flex;align-items:center;gap:4px;padding:5px 4px 5px 2px;cursor:pointer;user-select:none;'

      const collapseIcon = document.createElement('span')
      collapseIcon.className = 'icon icon-collapse' + (isExpanded ? ' on' : '')
      collapseIcon.style.cssText = 'flex-shrink:0;transition:transform 0.15s;' + (isExpanded ? '' : 'transform:rotate(-90deg);')

      const styleTitle = document.createElement('span')
      styleTitle.style.cssText = 'font-size:11px;text-transform:uppercase;opacity:0.8;flex:1;font-weight:bold;'
      styleTitle.textContent = styleObj.name

      const renameBtn = document.createElement('button')
      renameBtn.title = 'Rename'
      renameBtn.style.cssText = 'background:none;border:none;padding:1px;cursor:pointer;display:flex;align-items:center;opacity:0.6;'
      renameBtn.addEventListener('mouseenter', () => {
        renameBtn.style.opacity = '1'
      })
      renameBtn.addEventListener('mouseleave', () => {
        renameBtn.style.opacity = '0.6'
      })
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
        deleteBtn.style.cssText = 'background:none;border:none;padding:1px;cursor:pointer;display:flex;align-items:center;opacity:0.5;'
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
      tsSelect.className = 'property-input'
      tsSelect.style.cssText = 'flex:1;min-width:0;height:24px;background:#2a2a2a;color:white;border:1px solid #1d1d1d;border-radius:3px;'
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
      markerSelect.className = 'property-input'
      markerSelect.style.cssText =
        'flex:1;min-width:0;height:24px;background:#2a2a2a;color:white;border:1px solid #1d1d1d;border-radius:3px;'
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
    newBtn.style.cssText =
      'margin:10px 4px 4px;padding:4px 10px;border:1px solid #555;border-radius:3px;background:#3a3a3a;color:#ccc;cursor:pointer;font-size:11px;'
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
      'Inter':           [['400','Regular'],['500','Medium'],['600','Semi-bold']],
      'DM Sans':         [['300','Light'],['400','Regular'],['700','Bold']],
      'JetBrains Mono':  [['400','Regular'],['500','Medium']],
      'Fira Code':       [['300','Light'],['400','Regular'],['500','Medium'],['600','Semi-bold'],['700','Bold']],
      'Fira Mono':       [['400','Regular'],['500','Medium'],['700','Bold']],
      'Cascadia Code':   [['200','Extra-light'],['300','Light'],['400','Regular'],['600','Semi-bold']],
    }
    const DEFAULT_WEIGHTS = [['400','Regular'],['700','Bold']]
    const getWeights = (family) => FONT_WEIGHTS[family] || DEFAULT_WEIGHTS

    function makeDropdownRow(parentEl, label, options, currentValue, onChange) {
      const row = document.createElement('div')
      row.className = 'property-row'
      const lbl = document.createElement('label')
      lbl.className = 'property-label'
      lbl.textContent = label
      const sel = document.createElement('select')
      sel.className = 'property-input'
      sel.style.cssText = 'flex:1;min-width:0;height:24px;background:#2a2a2a;color:white;border:1px solid #1d1d1d;border-radius:3px;'
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
      colorBox.className = 'property-input'
      colorBox.style.cssText = `height:20px;width:32px;padding:0;cursor:pointer;flex:none;border:1px solid #1d1d1d;border-radius:3px;background:${currentValue || '#ffffff'};`
      colorBox.addEventListener('click', () => {
        openColorPicker(
          currentValue || '#ffffff',
          (newColor) => { colorBox.style.background = newColor; onChange(newColor) },
          (newColor) => { colorBox.style.background = newColor },
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
    activeSelect.className = 'property-input'
    activeSelect.style.cssText = 'flex:1;min-width:0;height:24px;background:#2a2a2a;color:white;border:1px solid #1d1d1d;border-radius:3px;'
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
      accordion.style.cssText = 'border-top:1px solid #2a2a2a;margin-top:2px;'

      const accordionHeader = document.createElement('div')
      accordionHeader.style.cssText = 'display:flex;align-items:center;gap:4px;padding:5px 4px 5px 2px;cursor:pointer;user-select:none;'

      const collapseIcon = document.createElement('span')
      collapseIcon.className = 'icon icon-collapse' + (isExpanded ? ' on' : '')
      collapseIcon.style.cssText = 'flex-shrink:0;transition:transform 0.15s;' + (isExpanded ? '' : 'transform:rotate(-90deg);')

      const styleTitle = document.createElement('span')
      styleTitle.style.cssText = 'font-size:11px;text-transform:uppercase;opacity:0.8;flex:1;font-weight:bold;'
      styleTitle.textContent = styleObj.name

      const renameBtn = document.createElement('button')
      renameBtn.title = 'Rename'
      renameBtn.style.cssText = 'background:none;border:none;padding:1px;cursor:pointer;display:flex;align-items:center;opacity:0.6;'
      renameBtn.addEventListener('mouseenter', () => {
        renameBtn.style.opacity = '1'
      })
      renameBtn.addEventListener('mouseleave', () => {
        renameBtn.style.opacity = '0.6'
      })
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
        deleteBtn.style.cssText = 'background:none;border:none;padding:1px;cursor:pointer;display:flex;align-items:center;opacity:0.5;'
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
      familySelect.className = 'property-input'
      familySelect.style.cssText = 'flex:1;min-width:0;height:24px;background:#2a2a2a;color:white;border:1px solid #1d1d1d;border-radius:3px;'
      CAD_FONTS.forEach(f => {
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
      weightSelect.className = 'property-input'
      weightSelect.style.cssText = 'flex:1;min-width:0;height:24px;background:#2a2a2a;color:white;border:1px solid #1d1d1d;border-radius:3px;'

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
    newBtn.style.cssText =
      'margin:10px 4px 4px;padding:4px 10px;border:1px solid #555;border-radius:3px;background:#3a3a3a;color:#ccc;cursor:pointer;font-size:11px;'
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
    header.style.cssText = 'font-weight:bold;padding:6px 8px 4px;font-size:11px;text-transform:uppercase;opacity:0.7;letter-spacing:0.5px;'
    header.textContent = 'Paper Settings'
    container.appendChild(header)

    // Paper size dropdown
    const sizeRow = document.createElement('div')
    sizeRow.className = 'property-row'
    const sizeLabel = document.createElement('label')
    sizeLabel.className = 'property-label'
    sizeLabel.textContent = 'Paper Size'
    const sizeSelect = document.createElement('select')
    sizeSelect.className = 'property-input'
    sizeSelect.style.cssText = 'flex:1;min-width:0;height:24px;background:#2a2a2a;color:white;border:1px solid #1d1d1d;border-radius:3px;'

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
    orientSelect.className = 'property-input'
    orientSelect.style.cssText = 'flex:1;min-width:0;height:24px;background:#2a2a2a;color:white;border:1px solid #1d1d1d;border-radius:3px;'
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
    divider.style.cssText = 'border:none;border-top:1px solid #333;margin:8px 0;'
    container.appendChild(divider)

    // Export buttons
    const exportHeader = document.createElement('div')
    exportHeader.style.cssText =
      'font-weight:bold;padding:4px 8px;font-size:11px;text-transform:uppercase;opacity:0.7;letter-spacing:0.5px;'
    exportHeader.textContent = 'Export'
    container.appendChild(exportHeader)

    _makeExportButton(container, '⬇ Export as SVG', '#2a6a3a', () => pe && pe.exportSVG())
    _makeExportButton(container, '⬇ Export as PDF', '#3a2a6a', () => pe && pe.exportPDF())
  }

  function _makeExportButton(container, label, bg, onClick) {
    const btn = document.createElement('button')
    btn.textContent = label
    btn.style.cssText =
      `display:block;width:calc(100% - 16px);margin:4px 8px;padding:6px;` +
      `background:${bg};color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;`
    btn.addEventListener('click', onClick)
    container.appendChild(btn)
  }

  // ── VIEWPORT PROPERTIES TAB ────────────────────────────────────────────────

  function renderViewportPropertiesTab(container, vp) {
    const header = document.createElement('div')
    header.style.cssText = 'font-weight:bold;padding:6px 8px 4px;font-size:11px;text-transform:uppercase;opacity:0.7;'
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
    deleteBtn.style.cssText =
      'display:block;width:calc(100% - 16px);margin:12px 8px 4px;padding:6px;' +
      'background:#6a2a2a;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;'
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
    header.style.cssText = 'font-weight:bold;padding:6px 8px 4px;font-size:11px;text-transform:uppercase;opacity:0.7;'
    header.textContent = 'Color Translation (Print)'
    container.appendChild(header)

    // Presets row
    const presetsRow = document.createElement('div')
    presetsRow.style.cssText = 'display:flex;gap:4px;padding:4px 8px 8px;flex-wrap:wrap;'
    ;[
      ['Color', null],
      ['Monochrome', '#000000'],
      ['Grayscale', 'grayscale'],
    ].forEach(([label, preset]) => {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.style.cssText =
        'flex:1;padding:4px;background:#333;color:white;border:1px solid #555;border-radius:3px;cursor:pointer;font-size:11px;'
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
      empty.style.cssText = 'padding:8px;opacity:0.6;font-size:12px;'
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
      srcSwatch.style.cssText = `width:20px;height:20px;border-radius:3px;border:1px solid #555;flex-shrink:0;background:${sourceColor};`
      srcSwatch.title = sourceColor

      const arrow = document.createElement('span')
      arrow.textContent = '→'
      arrow.style.opacity = '0.5'

      // Print color swatch (clickable)
      const printSwatch = document.createElement('div')
      printSwatch.style.cssText = `width:20px;height:20px;border-radius:3px;border:1px solid #555;flex-shrink:0;background:${mapping.printColor};cursor:pointer;`
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
      colorLabel.style.cssText = 'font-size:10px;opacity:0.6;font-family:monospace;'
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
    createColorProperty(container, 'Stroke', data.style.stroke || 'white', (value) => {
      setCollectionStyle(editor, id, { stroke: value })
    }, () => {})

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
    createColorProperty(container, 'Fill', data.style.fill || 'transparent', (value) => {
      setCollectionStyle(editor, id, { fill: value })
    }, () => {})
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
    // Name field
    createPropertyField(container, 'Name', element.attr('name') || node.nodeName, (value) => {
      element.attr('name', value)
      safeDispatch('updatedOutliner')
    })

    // Type field (read-only)
    createPropertyField(container, 'Type', node.nodeName, null, true)

    // ID field (read-only)
    createPropertyField(container, 'ID', element.attr('id'), null, true)

    // Collection dropdown
    let collectionAncestor = element.parent()
    while (collectionAncestor && collectionAncestor.node && collectionAncestor.node.nodeName !== 'svg') {
      if (collectionAncestor.attr('data-collection') === 'true') break
      collectionAncestor = collectionAncestor.parent()
    }
    const currentParentId =
      collectionAncestor && collectionAncestor.attr('data-collection') === 'true' ? collectionAncestor.attr('id') : null

    // Only show collection dropdown if the element is actually inside one of our collections
    if (currentParentId && editor.collections.has(currentParentId)) {
      const row = document.createElement('div')
      row.className = 'property-row'

      const labelEl = document.createElement('label')
      labelEl.textContent = 'Collection'
      labelEl.className = 'property-label'

      const select = document.createElement('select')
      select.className = 'property-input'
      select.style.cssText =
        'flex:1;min-width:0;height:24px;background-color:#2a2a2a;color:white;border:1px solid #1d1d1d;border-radius:3px;cursor:pointer;'

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
          // Move the SVG element's DOM node to the new collection's <g> group
          newCollection.group.add(element)

          // If the element was using default collection styles (not overridden),
          // we need to re-apply the new collection's styles because it moved.
          applyCollectionStyleToElement(editor, element)

          safeDispatch('updatedOutliner')
          safeDispatch('updatedProperties')
        }
      })

      row.appendChild(labelEl)
      row.appendChild(select)
      container.appendChild(row)
    }

    // Coordinates based on element type
    if (node.nodeName === 'line') {
      createPropertyField(container, 'X1', parseFloat(element.attr('x1')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          element.attr('x1', num)
          safeDispatch('refreshHandlers')
        }
      })
      createPropertyField(container, 'Y1', parseFloat(element.attr('y1')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          element.attr('y1', num)
          safeDispatch('refreshHandlers')
        }
      })
      createPropertyField(container, 'X2', parseFloat(element.attr('x2')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          element.attr('x2', num)
          safeDispatch('refreshHandlers')
        }
      })
      createPropertyField(container, 'Y2', parseFloat(element.attr('y2')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          element.attr('y2', num)
          safeDispatch('refreshHandlers')
        }
      })
    } else if (node.nodeName === 'circle') {
      createPropertyField(container, 'CX', parseFloat(element.attr('cx')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          element.attr('cx', num)
          safeDispatch('refreshHandlers')
        }
      })
      createPropertyField(container, 'CY', parseFloat(element.attr('cy')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          element.attr('cy', num)
          safeDispatch('refreshHandlers')
        }
      })
      createPropertyField(container, 'Radius', parseFloat(element.attr('r')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num) && num > 0) {
          element.attr('r', num)
          safeDispatch('refreshHandlers')
        }
      })
    } else if (node.nodeName === 'rect') {
      createPropertyField(container, 'X', parseFloat(element.attr('x')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          element.attr('x', num)
          safeDispatch('refreshHandlers')
        }
      })
      createPropertyField(container, 'Y', parseFloat(element.attr('y')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          element.attr('y', num)
          safeDispatch('refreshHandlers')
        }
      })
      createPropertyField(container, 'Width', parseFloat(element.attr('width')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num) && num > 0) {
          element.attr('width', num)
          safeDispatch('refreshHandlers')
        }
      })
      createPropertyField(container, 'Height', parseFloat(element.attr('height')).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          element.attr('height', num)
          safeDispatch('refreshHandlers')
        }
      })
    } else if (node.nodeName === 'text') {
      createPropertyField(container, 'Content', element.text(), (value) => {
        element.text(value)
        safeDispatch('refreshHandlers')
      })
      createPropertyField(container, 'X', parseFloat(element.x()).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          element.x(num)
          safeDispatch('refreshHandlers')
        }
      })
      createPropertyField(container, 'Y', parseFloat(element.y()).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          element.y(num)
          safeDispatch('refreshHandlers')
        }
      })
      const fontSize = element.font('size') || element.css('font-size') || 10
      createPropertyField(container, 'Font Size', parseFloat(fontSize).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num) && num > 0) {
          element.font({ size: num })
          safeDispatch('refreshHandlers')
        }
      })
    } else if (node.nodeName === 'path') {
      // For paths, show bounding box info (read-only for now)
      const bbox = element.bbox()
      createPropertyField(container, 'X', bbox.x.toFixed(2), null, true)
      createPropertyField(container, 'Y', bbox.y.toFixed(2), null, true)
      createPropertyField(container, 'Width', bbox.width.toFixed(2), null, true)
      createPropertyField(container, 'Height', bbox.height.toFixed(2), null, true)
    }

    // Universal Rotation Field
    if (element.transform) {
      const currentRotation = element.transform().rotate || 0
      createPropertyField(container, 'Rotation', parseFloat(currentRotation).toFixed(2), (value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          const currentRot = element.transform().rotate || 0
          const delta = num - currentRot
          if (delta !== 0) {
            const bbox = element.bbox()
            const transform = element.transform()
            const matrix = new Matrix(transform)

            // The `Matrix.rotate` method acts on the global coordinate space.
            // Map the element's local (untransformed) bounding center into global space:
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
    styleSelect.className = 'property-input'
    styleSelect.style.cssText =
      'flex:1;min-width:0;height:24px;background-color:#2a2a2a;color:white;border:1px solid #1d1d1d;border-radius:3px;cursor:pointer;'

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
      element.css('fill', p.fill)
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
      header.style.cssText =
        'font-weight:bold;padding:6px 8px 4px;font-size:11px;text-transform:uppercase;opacity:0.7;letter-spacing:0.5px;'
      header.textContent = 'Dimension Style'
      container.appendChild(header)

      const styleRow = document.createElement('div')
      styleRow.className = 'property-row'

      const styleLabel = document.createElement('label')
      styleLabel.textContent = 'Style'
      styleLabel.className = 'property-label'

      const styleSelect = document.createElement('select')
      styleSelect.className = 'property-input'
      styleSelect.style.cssText =
        'flex:1;min-width:0;height:24px;background-color:#2a2a2a;color:white;border:1px solid #1d1d1d;border-radius:3px;cursor:pointer;'

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

  function renderStyleTab(container, element, node) {
    const computedStyle = window.getComputedStyle(node)

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

    // Helper: create a style property row with optional "By Collection" toggle
    function createStylableProperty(propName, label, currentValue, applyFn, isColor, liveFn) {
      const isOverridden = !!overrides[propName]

      if (inCollection && collectionData) {
        const row = document.createElement('div')
        row.className = 'property-row'

        const labelEl = document.createElement('label')
        labelEl.textContent = label
        labelEl.className = 'property-label'

        const controls = document.createElement('div')
        controls.style.cssText = 'display:flex;align-items:center;flex:1;gap:3px;min-width:0;overflow:hidden'

        // "By Collection" toggle button
        const toggleBtn = document.createElement('button')
        toggleBtn.textContent = isOverridden ? 'O' : 'C'
        toggleBtn.title = isOverridden ? 'Own style — click to inherit from collection' : 'Collection style — click to override'
        toggleBtn.style.cssText =
          'font-size:9px;width:18px;height:18px;flex-shrink:0;border:1px solid #555;border-radius:3px;cursor:pointer;color:#ccc;padding:0;text-align:center;background:' +
          (isOverridden ? '#555' : 'var(--accent-color)')
        controls.appendChild(toggleBtn)

        if (isColor) {
          // Enable/disable checkbox
          const checkbox = document.createElement('input')
          checkbox.type = 'checkbox'
          checkbox.checked = currentValue !== 'none' && currentValue !== 'transparent'
          checkbox.style.cssText = 'flex-shrink:0;margin:0'
          checkbox.disabled = !isOverridden

          const colorBox = document.createElement('div')
          colorBox.className = 'property-input'
          colorBox.style.cssText = 'height:20px;width:32px;padding:0;cursor:pointer;flex:none;border:1px solid #1d1d1d;border-radius:3px;'

          function updateBoxColor(color) {
            if (color === 'none' || color === 'transparent') {
              colorBox.style.background = 'repeating-linear-gradient(45deg, #444 0px, #444 4px, #222 4px, #222 8px)'
            } else {
              colorBox.style.background = rgbToHex(color)
            }
          }
          updateBoxColor(currentValue)

          function syncBoxState() {
            if (!isOverridden || !checkbox.checked) {
              colorBox.style.opacity = '0.3'
              colorBox.style.pointerEvents = 'none'
            } else {
              colorBox.style.opacity = '1'
              colorBox.style.pointerEvents = 'auto'
            }
          }
          syncBoxState()

          checkbox.addEventListener('change', () => {
            syncBoxState()
            const applyVal = checkbox.checked ? rgbToHex(colorBox.style.background) || '#000000' : 'none'
            applyFn(applyVal)
          })

          colorBox.addEventListener('click', () => {
            if (!isOverridden || !checkbox.checked) return
            openColorPicker(
              colorBox.style.background,
              (newColor) => { updateBoxColor(newColor); applyFn(newColor) },
              liveFn ? (newColor) => { updateBoxColor(newColor); liveFn(newColor) } : undefined,
            )
          })

          toggleBtn.addEventListener('click', () => {
            overrides[propName] = !isOverridden
            setElementOverrides(element, overrides)
            if (!overrides[propName]) applyCollectionStyleToElement(editor, element)
            safeDispatch('updatedProperties')
          })

          controls.appendChild(checkbox)
          controls.appendChild(colorBox)
        } else {
          const textInput = document.createElement('input')
          textInput.type = 'text'
          textInput.value = currentValue
          textInput.className = 'property-input'
          textInput.style.cssText = 'flex:1;min-width:0'
          textInput.disabled = !isOverridden

          textInput.addEventListener('change', (e) => applyFn(e.target.value))
          textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              applyFn(e.target.value)
              textInput.blur()
            }
          })

          toggleBtn.addEventListener('click', () => {
            overrides[propName] = !isOverridden
            setElementOverrides(element, overrides)
            if (!overrides[propName]) applyCollectionStyleToElement(editor, element)
            safeDispatch('updatedProperties')
          })

          controls.appendChild(textInput)
        }

        row.appendChild(labelEl)
        row.appendChild(controls)
        container.appendChild(row)
      } else {
        // No collection — plain property with checkbox for colors
        if (isColor) {
          createColorProperty(container, label, currentValue, applyFn, liveFn)
        } else {
          createPropertyField(container, label, currentValue, applyFn)
        }
      }
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

    const colorBox = document.createElement('div')
    colorBox.className = 'property-input'
    colorBox.style.cssText = 'height:24px;width:32px;padding:0;cursor:pointer;flex:none;border:1px solid #1d1d1d;border-radius:3px;'

    function updateBoxColor(color) {
      if (color === 'none' || color === 'transparent') {
        colorBox.style.background = 'repeating-linear-gradient(45deg, #444 0px, #444 4px, #222 4px, #222 8px)'
      } else {
        colorBox.style.background = rgbToHex(color)
      }
    }
    updateBoxColor(value)

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
        (newColor) => { updateBoxColor(newColor); onChange(newColor) },
        onLive ? (newColor) => { updateBoxColor(newColor); onLive(newColor) } : undefined,
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
