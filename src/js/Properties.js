const propertiesPanel = document.getElementById('properties-panel')

function Properties(editor) {
  const signals = editor.signals

  signals.updatedProperties.add(() => {
    if (editor.selected.length > 0) {
      const active = editor.selected[editor.selected.length - 1].node
      // console.log(active)
      propertiesPanel.innerHTML = ''
      let p = document.createElement('p')
      p.textContent = 'Name: ' + active.nodeName
      propertiesPanel.appendChild(p)

      // TODO Append other info for each type of element

      // p = document.createElement('p')
      // p.textContent = 'x: ' + active.x
      // propertiesPanel.appendChild(p)
    } else {
      propertiesPanel.innerHTML = ''
      let p = document.createElement('p')
      p.textContent = 'None element selected'
      propertiesPanel.appendChild(p)
    }
  })
}

export { Properties }
