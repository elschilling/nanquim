const propertiesPanel = document.getElementById('properties-panel')

function Properties(editor) {
  const signals = editor.signals
  let activeTab = 'transform' // 'transform' or 'style'

  // Side Icon Navigation
  const transformTabBtn = document.getElementById('tab-transform')
  const styleTabBtn = document.getElementById('tab-style')

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

  function updateTabUI() {
    if (activeTab === 'transform') {
      if (transformTabBtn) transformTabBtn.classList.add('active')
      if (styleTabBtn) styleTabBtn.classList.remove('active')
    } else {
      if (transformTabBtn) transformTabBtn.classList.remove('active')
      if (styleTabBtn) styleTabBtn.classList.add('active')
    }
  }

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

  function render() {
    propertiesPanel.innerHTML = ''

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
      renderTransformTab(content, element, node)
    } else if (activeTab === 'style') {
      renderStyleTab(content, element, node)
    }
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
    } else if (node.nodeName === 'path') {
      // For paths, show bounding box info (read-only for now)
      const bbox = element.bbox()
      createPropertyField(container, 'X', bbox.x.toFixed(2), null, true)
      createPropertyField(container, 'Y', bbox.y.toFixed(2), null, true)
      createPropertyField(container, 'Width', bbox.width.toFixed(2), null, true)
      createPropertyField(container, 'Height', bbox.height.toFixed(2), null, true)
    }
  }

  function renderStyleTab(container, element, node) {
    // Fill Color (only for closed shapes or paths)
    if (['circle', 'rect', 'path', 'polygon'].includes(node.nodeName)) {
      const currentFill = element.attr('fill')
      // If 'none', use white as placeholder or handle 'none' explicitly
      // Here we allow picking a color.
      createPropertyField(container, 'Fill', currentFill === 'none' ? '#ffffff' : currentFill, (value) => {
        element.attr('fill', value)
        safeDispatch('render')
        // Force refresh if needed
      }, false, 'color')
    }

    // Stroke Color
    const currentStroke = element.attr('stroke')
    createPropertyField(container, 'Stroke', currentStroke === 'none' ? '#000000' : currentStroke, (value) => {
      element.attr('stroke', value)
      safeDispatch('render')
    }, false, 'color')

    // Stroke Width
    createPropertyField(container, 'Stroke Width', parseFloat(element.attr('stroke-width')) || 1, (value) => {
      const num = parseFloat(value)
      if (!isNaN(num) && num >= 0) {
        element.attr('stroke-width', num)
        // safeDispatch('refreshHandlers') // Handlers might need update if bbox changes?
      }
    })

    // Opacity
    createPropertyField(container, 'Opacity', parseFloat(element.attr('opacity')) || 1, (value) => {
      const num = parseFloat(value)
      if (!isNaN(num) && num >= 0 && num <= 1) {
        element.attr('opacity', num)
      }
    })
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
