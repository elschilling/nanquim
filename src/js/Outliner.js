const drawingTree = document.getElementById('drawing-tree')

function Outliner(editor) {
  const signals = editor.signals

  signals.updatedOutliner.add(() => {
    drawingTree.innerHTML = ''
    editor.drawing.children().each((el) => {
      const li = document.createElement('li')
      li.id = 'li' + el.node.id
      li.textContent = el.node.nodeName
      li.addEventListener('click', () => signals.toogledSelect.dispatch(el))
      drawingTree.appendChild(li)
    })
  })

  signals.updatedSelection.add(() => {
    signals.clearSelection.dispatch()
    editor.selected.forEach((el) => {
      const li = document.getElementById('li' + el.node.id)
      el.selectize({ deepSelect: true })
      el.addClass('elementSelected')
      li.classList.add('outliner-selected')
    })
  })

  signals.clearSelection.add(() => {
    for (let li of drawingTree.children) {
      li.classList.remove('outliner-selected')
    }
    editor.drawing.children().each((el) => {
      el.selectize(false, { deepSelect: true })
      el.removeClass('elementSelected')
    })
  })

  signals.toogledSelect.add((el) => {
    if (!editor.selected.map((item) => item.node.id).includes(el.node.id)) {
      editor.selected.push(el)
    } else {
      editor.selected = editor.selected.filter((item) => item !== el)
    }
    editor.signals.updatedSelection.dispatch()
  })
}

export { Outliner }
