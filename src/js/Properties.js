import { setCollectionStyle, getElementOverrides, setElementOverrides, applyCollectionStyleToElement } from './Collection'

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

  function renderCollectionStyleTab(container, element) {
    const id = element.attr('id')
    const data = editor.collections.get(id)
    if (!data) return

    // Default stroke color
    createColorProperty(container, 'Stroke', data.style.stroke || 'white', (value) => {
      setCollectionStyle(editor, id, { stroke: value })
    })

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
    const currentParentId = (collectionAncestor && collectionAncestor.attr('data-collection') === 'true') ? collectionAncestor.attr('id') : null

    // Only show collection dropdown if the element is actually inside one of our collections
    if (currentParentId && editor.collections.has(currentParentId)) {
      const row = document.createElement('div')
      row.className = 'property-row'

      const labelEl = document.createElement('label')
      labelEl.textContent = 'Collection'
      labelEl.className = 'property-label'

      const select = document.createElement('select')
      select.className = 'property-input'
      select.style.cssText = 'flex:1;min-width:0;height:24px;background-color:#2a2a2a;color:white;border:1px solid #1d1d1d;border-radius:3px;cursor:pointer;'

      editor.collections.forEach((data, colId) => {
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
  }

  function renderStyleTab(container, element, node) {
    const computedStyle = window.getComputedStyle(node)

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
    function createStylableProperty(propName, label, currentValue, applyFn, isColor) {
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
        toggleBtn.style.cssText = 'font-size:9px;width:18px;height:18px;flex-shrink:0;border:1px solid #555;border-radius:3px;cursor:pointer;color:#ccc;padding:0;text-align:center;background:' + (isOverridden ? '#555' : 'var(--accent-color)')
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
            const applyVal = checkbox.checked ? (rgbToHex(colorBox.style.background) || '#000000') : 'none'
            applyFn(applyVal)
          })

          colorBox.addEventListener('click', () => {
            if (!isOverridden || !checkbox.checked) return
            openColorPicker(colorBox.style.background, (newColor) => {
              updateBoxColor(newColor)
              applyFn(newColor)
            })
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
            if (e.key === 'Enter') { applyFn(e.target.value); textInput.blur() }
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
          createColorProperty(container, label, currentValue, applyFn)
        } else {
          createPropertyField(container, label, currentValue, applyFn)
        }
      }
    }

    // Fill Color (only for closed shapes or paths or text)
    if (['circle', 'rect', 'path', 'polygon', 'text'].includes(node.nodeName)) {
      const currentFill = element.css('fill') || element.attr('fill')
      let visualFill = computedStyle.fill !== 'none' ? computedStyle.fill : (currentFill || '#ffffff')
      if (visualFill === 'transparent' || visualFill === 'rgba(0, 0, 0, 0)') visualFill = 'none'

      createStylableProperty('fill', 'Fill', visualFill, (value) => {
        element.css('fill', value)
        safeDispatch('refreshHandlers')
      }, true)
    }

    // Stroke Color
    const currentStroke = element.css('stroke') || element.attr('stroke')
    let visualStroke = computedStyle.stroke !== 'none' ? computedStyle.stroke : (currentStroke || '#000000')
    if (visualStroke === 'transparent' || visualStroke === 'rgba(0, 0, 0, 0)') visualStroke = 'none'

    createStylableProperty('stroke', 'Stroke', visualStroke, (value) => {
      element.css('stroke', value)
      safeDispatch('refreshHandlers')
    }, true)

    // Stroke Width
    const currentWidth = parseFloat(element.css('stroke-width') || element.attr('stroke-width')) || parseFloat(computedStyle.strokeWidth) || 1

    createStylableProperty('stroke-width', 'Stroke Width', currentWidth, (value) => {
      const num = parseFloat(value)
      if (!isNaN(num) && num >= 0) {
        element.css('stroke-width', num)
        safeDispatch('refreshHandlers')
      }
    }, false)

    // Stroke Dasharray
    const currentDasharray = element.css('stroke-dasharray') || element.attr('stroke-dasharray') || computedStyle.strokeDasharray || 'none'
    const visualDasharray = (currentDasharray === 'none' || currentDasharray === '') ? '' : currentDasharray

    createStylableProperty('stroke-dasharray', 'Dash Array', visualDasharray, (value) => {
      const val = value.trim()
      if (val === '') {
        element.node.style.removeProperty('stroke-dasharray')
        element.node.removeAttribute('stroke-dasharray')
      } else {
        element.css('stroke-dasharray', val)
      }
      safeDispatch('refreshHandlers')
    }, false)

    if (node.nodeName === 'text') {
      const currentFamily = element.font('family') || element.css('font-family') || computedStyle.fontFamily || 'sans-serif'
      createStylableProperty('font-family', 'Font Family', currentFamily, (value) => {
        if (value.trim() !== '') {
          element.font({ family: value })
          safeDispatch('refreshHandlers')
        }
      }, false)
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
    if (!color || color === 'none' || color === 'transparent') return '#000000';
    if (color.startsWith('#')) {
      if (color.length === 4) {
        return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
      }
      return color;
    }
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = color;
    return ctx.fillStyle;
  }

  let hiddenColorPicker = null;

  function openColorPicker(initialColor, onUpdate) {
    if (!hiddenColorPicker) {
      hiddenColorPicker = document.createElement('input');
      hiddenColorPicker.type = 'color';
      hiddenColorPicker.style.position = 'fixed';
      hiddenColorPicker.style.left = '40%';
      hiddenColorPicker.style.top = '40%';
      hiddenColorPicker.style.opacity = '0';
      hiddenColorPicker.style.pointerEvents = 'none';
      hiddenColorPicker.style.zIndex = '-9999';
      document.body.appendChild(hiddenColorPicker);
    }

    // Refresh listeners by replacing node
    const newPicker = hiddenColorPicker.cloneNode(true);
    hiddenColorPicker.replaceWith(newPicker);
    hiddenColorPicker = newPicker;

    hiddenColorPicker.value = rgbToHex(initialColor);

    hiddenColorPicker.addEventListener('input', (e) => {
      onUpdate(e.target.value);
    });
    hiddenColorPicker.addEventListener('change', (e) => {
      onUpdate(e.target.value);
    });

    hiddenColorPicker.click();
  }

  function createColorProperty(container, label, value, onChange) {
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
      openColorPicker(colorBox.style.background, (newColor) => {
        updateBoxColor(newColor)
        onChange(newColor)
      })
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
