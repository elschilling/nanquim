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
    // Draw handlers for selected elements
    drawHandlers()
  })

  function drawHandlers() {
    // Clear existing handlers
    editor.handlers.clear()

    // Get current zoom level
    const currentZoom = editor.svg.zoom()
    const handlerScreenSize = 16 // pixels on screen
    const handlerWorldSize = handlerScreenSize / currentZoom

    // Helper to find all selected vertices at a given position
    function getCoincidentVertices(x, y) {
      const vertices = []
      editor.selected.forEach((s) => {
        if (s.type === 'line') {
          const sx1 = s.node.x1.baseVal.value
          const sy1 = s.node.y1.baseVal.value
          const sx2 = s.node.x2.baseVal.value
          const sy2 = s.node.y2.baseVal.value

          if (Math.abs(sx1 - x) < 0.001 && Math.abs(sy1 - y) < 0.001) {
            vertices.push({ element: s, vertexIndex: 0, originalPosition: { x: sx1, y: sy1 } })
          }
          if (Math.abs(sx2 - x) < 0.001 && Math.abs(sy2 - y) < 0.001) {
            vertices.push({ element: s, vertexIndex: 1, originalPosition: { x: sx2, y: sy2 } })
          }
        } else if (s.type === 'circle') {
          const cx = s.node.cx.baseVal.value
          const cy = s.node.cy.baseVal.value
          const r = s.node.r.baseVal.value

          // Check Center
          if (Math.abs(cx - x) < 0.001 && Math.abs(cy - y) < 0.001) {
            vertices.push({ element: s, vertexIndex: 0, originalPosition: { cx, cy, r } })
          }
          // Check Quadrants (approximation for exact float matches might be needed, but handlers are drawn at exact calc points)
          if (Math.abs(cx - x) < 0.001 && Math.abs((cy - r) - y) < 0.001) vertices.push({ element: s, vertexIndex: 1, originalPosition: { cx, cy, r } })
          if (Math.abs((cx + r) - x) < 0.001 && Math.abs(cy - y) < 0.001) vertices.push({ element: s, vertexIndex: 2, originalPosition: { cx, cy, r } })
          if (Math.abs(cx - x) < 0.001 && Math.abs((cy + r) - y) < 0.001) vertices.push({ element: s, vertexIndex: 3, originalPosition: { cx, cy, r } })
          if (Math.abs((cx - r) - x) < 0.001 && Math.abs(cy - y) < 0.001) vertices.push({ element: s, vertexIndex: 4, originalPosition: { cx, cy, r } })
        }
      })
      return vertices
    }

    // Draw handlers for each selected element
    editor.selected.forEach((el) => {
      if (el.type === 'line') {
        const x1 = el.node.x1.baseVal.value
        const y1 = el.node.y1.baseVal.value
        const x2 = el.node.x2.baseVal.value
        const y2 = el.node.y2.baseVal.value

        // Draw handler at first vertex
        editor.handlers
          .rect(handlerWorldSize, handlerWorldSize)
          .center(x1, y1)
          .addClass('selection-handler')
          .mousedown((e) => {
            e.stopPropagation()
            signals.vertexEditStarted.dispatch(getCoincidentVertices(x1, y1))
          })

        // Draw handler at second vertex
        editor.handlers
          .rect(handlerWorldSize, handlerWorldSize)
          .center(x2, y2)
          .addClass('selection-handler')
          .mousedown((e) => {
            e.stopPropagation()
            signals.vertexEditStarted.dispatch(getCoincidentVertices(x2, y2))
          })

      } else if (el.type === 'circle') {
        const cx = el.node.cx.baseVal.value
        const cy = el.node.cy.baseVal.value
        const r = el.node.r.baseVal.value

        const points = [
          { x: cx, y: cy, index: 0 }, // Center
          { x: cx, y: cy - r, index: 1 }, // Top
          { x: cx + r, y: cy, index: 2 }, // Right
          { x: cx, y: cy + r, index: 3 }, // Bottom
          { x: cx - r, y: cy, index: 4 }, // Left
        ]

        points.forEach((p) => {
          editor.handlers
            .rect(handlerWorldSize, handlerWorldSize)
            .center(p.x, p.y)
            .addClass('selection-handler')
            .mousedown((e) => {
              e.stopPropagation()
              signals.vertexEditStarted.dispatch(getCoincidentVertices(p.x, p.y))
            })
        })
      }
    })
  }


  signals.clearSelection.add(() => {
    // Clear handlers
    editor.handlers.clear()

    for (let li of drawingTree.children) {
      li.classList.remove('outliner-selected')
    }
    editor.drawing.children().each((el) => {
      // el.selectize(false, { deepSelect: true })
      el.removeClass('elementSelected')
    })
  })

  // Redraw handlers when zoom changes
  signals.zoomChanged.add(() => {
    drawHandlers()
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
