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
      el.addClass('elementSelected')
      if (li) li.classList.add('outliner-selected')
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

    // ... (rest of drawHandlers)
  }

  // ... (getCoincidentVertices helper is here, I need to skip it to reach clearSelection)
  // I will use multiple ReplaceChunks to skip the middle part if I can, but I am editing lines 20-31 and 192-203.
  // Wait, these are far apart. I should use MultiReplaceFileContent.


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
      const tolerance = 0.1
      editor.selected.forEach((s) => {
        if (s.type === 'line') {
          const sx1 = s.node.x1.baseVal.value
          const sy1 = s.node.y1.baseVal.value
          const sx2 = s.node.x2.baseVal.value
          const sy2 = s.node.y2.baseVal.value

          if (Math.abs(sx1 - x) < tolerance && Math.abs(sy1 - y) < tolerance) {
            vertices.push({ element: s, vertexIndex: 0, originalPosition: { x: sx1, y: sy1 } })
          }
          if (Math.abs(sx2 - x) < tolerance && Math.abs(sy2 - y) < tolerance) {
            vertices.push({ element: s, vertexIndex: 1, originalPosition: { x: sx2, y: sy2 } })
          }
        } else if (s.type === 'circle') {
          const cx = s.node.cx.baseVal.value
          const cy = s.node.cy.baseVal.value
          const r = s.node.r.baseVal.value

          // Check Center
          if (Math.abs(cx - x) < tolerance && Math.abs(cy - y) < tolerance) {
            vertices.push({ element: s, vertexIndex: 0, originalPosition: { cx, cy, r } })
          }
          // Check Quadrants (approximation for exact float matches might be needed, but handlers are drawn at exact calc points)
          if (Math.abs(cx - x) < tolerance && Math.abs((cy - r) - y) < tolerance) vertices.push({ element: s, vertexIndex: 1, originalPosition: { cx, cy, r } })
          if (Math.abs((cx + r) - x) < tolerance && Math.abs(cy - y) < tolerance) vertices.push({ element: s, vertexIndex: 2, originalPosition: { cx, cy, r } })
          if (Math.abs(cx - x) < tolerance && Math.abs((cy + r) - y) < tolerance) vertices.push({ element: s, vertexIndex: 3, originalPosition: { cx, cy, r } })
          if (Math.abs((cx - r) - x) < tolerance && Math.abs(cy - y) < tolerance) vertices.push({ element: s, vertexIndex: 4, originalPosition: { cx, cy, r } })
        } else if (s.type === 'rect') {
          const rx = s.node.x.baseVal.value
          const ry = s.node.y.baseVal.value
          const rw = s.node.width.baseVal.value
          const rh = s.node.height.baseVal.value

          const rectPoints = [
            { x: rx, y: ry, index: 0 },
            { x: rx + rw, y: ry, index: 1 },
            { x: rx + rw, y: ry + rh, index: 2 },
            { x: rx, y: ry + rh, index: 3 },
            { x: rx + rw / 2, y: ry, index: 4 },
            { x: rx + rw, y: ry + rh / 2, index: 5 },
            { x: rx + rw / 2, y: ry + rh, index: 6 },
            { x: rx, y: ry + rh / 2, index: 7 }
          ]

          rectPoints.forEach(p => {
            if (Math.abs(p.x - x) < tolerance && Math.abs(p.y - y) < tolerance) {
              vertices.push({ element: s, vertexIndex: p.index, originalPosition: { x: rx, y: ry, width: rw, height: rh } })
            }
          })
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
      } else if (el.type === 'rect') {
        const rx = el.node.x.baseVal.value
        const ry = el.node.y.baseVal.value
        const rw = el.node.width.baseVal.value
        const rh = el.node.height.baseVal.value

        const points = [
          { x: rx, y: ry, index: 0, isCorner: true }, // TL
          { x: rx + rw, y: ry, index: 1, isCorner: true }, // TR
          { x: rx + rw, y: ry + rh, index: 2, isCorner: true }, // BR
          { x: rx, y: ry + rh, index: 3, isCorner: true }, // BL
          { x: rx + rw / 2, y: ry, index: 4, isCorner: false }, // Top
          { x: rx + rw, y: ry + rh / 2, index: 5, isCorner: false }, // Right
          { x: rx + rw / 2, y: ry + rh, index: 6, isCorner: false }, // Bottom
          { x: rx, y: ry + rh / 2, index: 7, isCorner: false } // Left
        ]

        points.forEach((p) => {
          let width, height
          if (p.isCorner) {
            width = handlerWorldSize
            height = handlerWorldSize
          } else {
            const isHorizontal = p.index === 4 || p.index === 6 // Top or Bottom
            width = isHorizontal ? handlerWorldSize * 1.5 : handlerWorldSize
            height = isHorizontal ? handlerWorldSize : handlerWorldSize * 1.5
          }
          editor.handlers
            .rect(width, height)
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

    const selectedItems = drawingTree.querySelectorAll('.outliner-selected')
    selectedItems.forEach(li => li.classList.remove('outliner-selected'))
    editor.drawing.children().each((el) => {
      // el.selectize(false, { deepSelect: true })
      el.removeClass('elementSelected')
    })
  })

  // Redraw handlers when zoom changes
  signals.zoomChanged.add(() => {
    drawHandlers()
  })

  // Redraw handlers when properties change (without full selection update)
  signals.refreshHandlers.add(() => {
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
  function childElements(group, parent) {
    // console.log('group', group)
    const ul = document.createElement('ul')
    const li = document.createElement('li')
    li.id = 'li' + group.node.id
    const groupName = group.attr('name') || group.node.nodeName
    li.textContent = groupName + ' ' + group.node.id
    li.addEventListener('click', (e) => {
      e.stopPropagation()
      signals.toogledSelect.dispatch(group)
    })
    ul.appendChild(li)
    group.children().each((child) => {
      // console.log('child', child)
      if (child.type === 'g') childElements(child, ul)
      else {
        const childUl = document.createElement('ul')
        const li = document.createElement('li')
        li.id = 'li' + child.node.id
        const childName = child.attr('name') || child.node.nodeName
        li.textContent = childName
        li.addEventListener('click', (e) => {
          e.stopPropagation()
          signals.toogledSelect.dispatch(child)
        })
        childUl.appendChild(li)
        ul.appendChild(childUl)
      }
    })
    parent.appendChild(ul)
  }
}

export { Outliner }
