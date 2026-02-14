const propertiesPanel = document.getElementById('properties-panel')

function Properties(editor) {
  const signals = editor.signals

  signals.updatedProperties.add(() => {
    if (editor.selected.length > 0) {
      const element = editor.selected[editor.selected.length - 1]
      const node = element.node

      propertiesPanel.innerHTML = ''

      // Create a container for properties
      const container = document.createElement('div')
      container.className = 'properties-content'

      // Name field
      createPropertyField(container, 'Name', element.attr('name') || node.nodeName, (value) => {
        element.attr('name', value)
        editor.signals.updatedOutliner.dispatch()
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
            // editor.signals.render.dispatch()
            signals.refreshHandlers.dispatch()
          }
        })
        createPropertyField(container, 'Y1', parseFloat(element.attr('y1')).toFixed(2), (value) => {
          const num = parseFloat(value)
          if (!isNaN(num)) {
            element.attr('y1', num)
            // editor.signals.render.dispatch()
            signals.refreshHandlers.dispatch()
          }
        })
        createPropertyField(container, 'X2', parseFloat(element.attr('x2')).toFixed(2), (value) => {
          const num = parseFloat(value)
          if (!isNaN(num)) {
            element.attr('x2', num)
            // editor.signals.render.dispatch()
            signals.refreshHandlers.dispatch()
          }
        })
        createPropertyField(container, 'Y2', parseFloat(element.attr('y2')).toFixed(2), (value) => {
          const num = parseFloat(value)
          if (!isNaN(num)) {
            element.attr('y2', num)
            // editor.signals.render.dispatch()
            signals.refreshHandlers.dispatch()
          }
        })
      } else if (node.nodeName === 'circle') {
        createPropertyField(container, 'CX', parseFloat(element.attr('cx')).toFixed(2), (value) => {
          const num = parseFloat(value)
          if (!isNaN(num)) {
            element.attr('cx', num)
            // editor.signals.render.dispatch()
            signals.refreshHandlers.dispatch()
          }
        })
        createPropertyField(container, 'CY', parseFloat(element.attr('cy')).toFixed(2), (value) => {
          const num = parseFloat(value)
          if (!isNaN(num)) {
            element.attr('cy', num)
            // editor.signals.render.dispatch()
            signals.refreshHandlers.dispatch()
          }
        })
        createPropertyField(container, 'Radius', parseFloat(element.attr('r')).toFixed(2), (value) => {
          const num = parseFloat(value)
          if (!isNaN(num) && num > 0) {
            element.attr('r', num)
            // editor.signals.render.dispatch()
            signals.refreshHandlers.dispatch()
          }
        })
      } else if (node.nodeName === 'rect') {
        createPropertyField(container, 'X', parseFloat(element.attr('x')).toFixed(2), (value) => {
          const num = parseFloat(value)
          if (!isNaN(num)) {
            element.attr('x', num)
            // editor.signals.render.dispatch()
            signals.refreshHandlers.dispatch()
          }
        })
        createPropertyField(container, 'Y', parseFloat(element.attr('y')).toFixed(2), (value) => {
          const num = parseFloat(value)
          if (!isNaN(num)) {
            element.attr('y', num)
            // editor.signals.render.dispatch()
            signals.refreshHandlers.dispatch()
          }
        })
        createPropertyField(container, 'Width', parseFloat(element.attr('width')).toFixed(2), (value) => {
          const num = parseFloat(value)
          if (!isNaN(num) && num > 0) {
            element.attr('width', num)
            // editor.signals.render.dispatch()
            signals.refreshHandlers.dispatch()
          }
        })
        createPropertyField(container, 'Height', parseFloat(element.attr('height')).toFixed(2), (value) => {
          const num = parseFloat(value)
          if (!isNaN(num) && num > 0) {
            element.attr('height', num)
            // editor.signals.render.dispatch()
            signals.refreshHandlers.dispatch()
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

      propertiesPanel.appendChild(container)
    } else {
      propertiesPanel.innerHTML = ''
      let p = document.createElement('p')
      p.textContent = 'No element selected'
      propertiesPanel.appendChild(p)
    }
  })

  // Focus management: allow editing properties when mouse is over the panel
  const propertiesPanelContainer = document.querySelector('.properties-panel-container')
  const viewport = document.querySelector('.viewport')

  if (propertiesPanelContainer) {
    propertiesPanelContainer.addEventListener('mouseenter', () => {
      // When mouse enters properties panel, allow inputs to receive focus
      editor.isEditingProperties = true
    })

    propertiesPanelContainer.addEventListener('mouseleave', () => {
      // When mouse leaves properties panel, return focus to terminal
      editor.isEditingProperties = false
      const terminalInput = document.getElementById('terminalInput')
      if (terminalInput) {
        terminalInput.focus()
      }
    })
  }

  if (viewport) {
    viewport.addEventListener('mouseenter', () => {
      // When mouse enters viewport, ensure terminal gets focus
      editor.isEditingProperties = false
      const terminalInput = document.getElementById('terminalInput')
      if (terminalInput) {
        terminalInput.focus()
      }
    })
  }
}

function createPropertyField(container, label, value, onChange, readOnly = false) {
  const row = document.createElement('div')
  row.className = 'property-row'

  const labelEl = document.createElement('label')
  labelEl.textContent = label
  labelEl.className = 'property-label'

  const input = document.createElement('input')
  input.type = 'text'
  input.value = value || ''
  input.className = 'property-input'
  input.readOnly = readOnly

  if (!readOnly && onChange) {
    input.addEventListener('change', (e) => {
      onChange(e.target.value)
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
