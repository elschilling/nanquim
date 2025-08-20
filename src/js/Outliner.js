const drawingTree = document.getElementById('drawing-tree')

function Outliner(editor) {
  const signals = editor.signals

  signals.updatedOutliner.add(() => {
    drawingTree.innerHTML = ''
    childElements(editor.drawing, drawingTree)
    // editor.drawing.children().each((el) => {
    //   const li = document.createElement('li')
    //   li.id = 'li' + el.node.id
    //   li.textContent = el.node.nodeName
    //   li.addEventListener('click', () => signals.toogledSelect.dispatch(el))
    //   drawingTree.appendChild(li)
    //   console.log('el', el)
    //   if ((el.type = 'g')) childElements(el, drawingTree)
    // })
  })

  signals.updatedSelection.add(() => {
    signals.clearSelection.dispatch()
    editor.selected.forEach((el) => {
      const li = document.getElementById('li' + el.node.id)
      // el.selectize({ deepSelect: true })
      el.addClass('elementSelected')
      // li.classList.add('outliner-selected')
    })
    signals.updatedProperties.dispatch()
  })

  signals.clearSelection.add(() => {
    for (let li of drawingTree.children) {
      li.classList.remove('outliner-selected')
    }
    editor.drawing.children().each((el) => {
      // el.selectize(false, { deepSelect: true })
      el.removeClass('elementSelected')
    })
  })

  signals.toogledSelect.add((el) => {
    if (!editor.selected.map((item) => item.node.id).includes(el.node.id)) {
      if (editor.selectSingleElement) {
        editor.selected = [el]
      } else {
        editor.selected.push(el)
      }
    } else {
      editor.selected = editor.selected.filter((item) => item !== el)
    }
    editor.signals.updatedSelection.dispatch()
  })
}

function childElements(group, parent) {
  // console.log('group', group)
  const ul = document.createElement('ul')
  const li = document.createElement('li')
  li.id = 'li' + group.node.id
  li.textContent = group.node.nodeName + ' ' + group.node.id
  li.addEventListener('click', () => signals.toogledSelect.dispatch(group))
  ul.appendChild(li)
  group.children().each((child) => {
    // console.log('child', child)
    if (child.type === 'g') childElements(child, ul)
    else {
      const childUl = document.createElement('ul')
      const li = document.createElement('li')
      li.id = 'li' + child.node.id
      li.textContent = child.node.nodeName
      li.addEventListener('click', () => signals.toogledSelect.dispatch(child))
      childUl.appendChild(li)
      ul.appendChild(childUl)
    }
  })
  parent.appendChild(ul)
}

export { Outliner }
