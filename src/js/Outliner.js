import {
  createCollection,
  deleteCollection,
  setActiveCollection,
  toggleVisibility,
  toggleLock,
  toggleElementVisibility,
  toggleElementLock,
} from './Collection'
import { getPreferences } from './Preferences'

const drawingTree = document.getElementById('drawing-tree')

function Outliner(editor) {
  const signals = editor.signals

  // "Add Collection" button
  const addBtn = document.getElementById('btn-add-collection')
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const count = editor.collections.size + 1
      createCollection(editor, 'Collection ' + count)
    })
  }

  signals.updatedOutliner.add(() => {
    drawingTree.innerHTML = ''
    renderCollections()
  })

  signals.updatedCollections.add(() => {
    drawingTree.innerHTML = ''
    renderCollections()
  })

  function renderCollections() {
    // Iterate collections in DOM order
    editor.drawing.children().each((child) => {
      if (child.attr('data-collection') !== 'true') return

      const id = child.attr('id')
      const data = editor.collections.get(id)
      if (!data) return

      const isActive = editor.activeCollection === data.group

      // Collection container
      const collectionUl = document.createElement('ul')
      collectionUl.className = 'outliner-collection'

      // Collection row
      const collectionLi = document.createElement('li')
      collectionLi.id = 'li' + id
      collectionLi.className = 'collection-row'
      if (isActive) collectionLi.classList.add('collection-active')
      if (!data.visible) collectionLi.classList.add('collection-hidden-row')
      if (data.locked) collectionLi.classList.add('collection-locked-row')

      // Chevron toggle icon
      const toggleIcon = document.createElement('div')
      toggleIcon.className = 'icon ' + (data.collapsed ? 'icon-right' : 'icon-down')
      toggleIcon.style.marginRight = '4px'
      toggleIcon.style.cursor = 'pointer'
      toggleIcon.addEventListener('click', (e) => {
        e.stopPropagation()
        data.collapsed = !data.collapsed
        signals.updatedOutliner.dispatch()
      })

      // Collection folder icon
      const folderIcon = document.createElement('div')
      folderIcon.className = 'icon icon-collection'
      folderIcon.style.marginRight = '6px'

      // Collection name
      const nameSpan = document.createElement('span')
      nameSpan.className = 'collection-name'
      nameSpan.textContent = child.attr('name') || 'Collection'

      // Wrapper for left side of the row
      const leftSide = document.createElement('div')
      leftSide.style.display = 'flex'
      leftSide.style.alignItems = 'center'
      leftSide.style.flex = '1'

      leftSide.appendChild(toggleIcon)
      leftSide.appendChild(folderIcon)
      leftSide.appendChild(nameSpan)

      leftSide.addEventListener('click', (e) => {
        e.stopPropagation()
        setActiveCollection(editor, id)
        // Select the collection group so Properties panel shows it
        editor.selected = [data.group]
        signals.updatedSelection.dispatch()
      })
      // Right-click to open custom context menu
      leftSide.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        e.stopPropagation()

        // Remove any existing menu
        const existingMenu = document.querySelector('.collection-context-menu')
        if (existingMenu) existingMenu.remove()

        const menu = document.createElement('div')
        menu.className = 'collection-context-menu'
        menu.style.left = e.clientX + 'px'
        menu.style.top = e.clientY + 'px'

        const deleteItem = document.createElement('div')
        deleteItem.className = 'collection-context-menu-item danger'
        deleteItem.innerHTML = '<span style="margin-right:8px;">🗑️</span> Delete Collection'

        menu.appendChild(deleteItem)
        document.body.appendChild(menu)

        // Prevent menu click from closing itself immediately
        menu.addEventListener('click', (ev) => ev.stopPropagation())

        const colName = child.attr('name') || 'Collection'

        deleteItem.addEventListener('click', () => {
          menu.remove()
          if (confirm(`Are you sure you want to delete "${colName}" and all its elements?`)) {
            deleteCollection(editor, id)
          }
        })

        // Close menu function
        const closeMenu = () => {
          if (menu.parentNode) menu.remove()
          document.removeEventListener('click', closeMenu)
          document.removeEventListener('contextmenu', closeMenu)
        }

        // Delay attaching so it doesn't instantly close
        setTimeout(() => {
          document.addEventListener('click', closeMenu)
          document.addEventListener('contextmenu', closeMenu)
        }, 10)
      })
      // Double-click to rename
      nameSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        const input = document.createElement('input')
        input.type = 'text'
        input.value = child.attr('name') || 'Collection'
        input.className = 'collection-rename-input'
        nameSpan.replaceWith(input)
        input.focus()
        input.select()
        const commit = () => {
          const newName = input.value.trim() || 'Collection'
          child.attr('name', newName)
          input.replaceWith(nameSpan)
          nameSpan.textContent = newName
        }
        input.addEventListener('blur', commit)
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') commit()
          if (ev.key === 'Escape') {
            input.replaceWith(nameSpan)
          }
        })
      })

      // Icons container (right side)
      const iconsDiv = document.createElement('div')
      iconsDiv.className = 'collection-icons'

      // Visibility icon
      const eyeIcon = document.createElement('div')
      eyeIcon.className = 'icon collection-icon icon-restrict-screen'
      if (!data.visible) eyeIcon.classList.add('icon-off')
      eyeIcon.title = data.visible ? 'Hide' : 'Show'
      eyeIcon.addEventListener('click', (e) => {
        e.stopPropagation()
        toggleVisibility(editor, id)
      })

      // Lock icon
      const lockIcon = document.createElement('div')
      lockIcon.className = 'icon collection-icon icon-restrict-edit-mode'
      if (data.locked) lockIcon.classList.add('icon-on')
      else lockIcon.classList.add('icon-off')
      lockIcon.title = data.locked ? 'Unlock' : 'Lock'
      lockIcon.addEventListener('click', (e) => {
        e.stopPropagation()
        toggleLock(editor, id)
      })

      iconsDiv.appendChild(eyeIcon)
      iconsDiv.appendChild(lockIcon)

      collectionLi.appendChild(leftSide)
      collectionLi.appendChild(iconsDiv)
      collectionUl.appendChild(collectionLi)

      // Container for children
      const childrenContainer = document.createElement('div')
      childrenContainer.style.display = data.collapsed ? 'none' : 'block'

      // Render child elements
      data.group.children().each((child) => {
        if (child.hasClass && child.hasClass('ghostLine')) return
        if (child.type === 'g') childElements(child, childrenContainer)
        else {
          const childUl = document.createElement('ul')
          const li = document.createElement('li')
          li.id = 'li' + child.node.id

          const childName = child.attr('name') || child.node.nodeName

          // Element type icon
          const elTypeIcon = document.createElement('div')
          elTypeIcon.className = 'icon '
          const elType = child.type || child.node.nodeName.toLowerCase()
          if (elType === 'line') elTypeIcon.className += 'icon-element-line'
          else if (elType === 'circle') elTypeIcon.className += 'icon-element-circle'
          else if (elType === 'path') elTypeIcon.className += 'icon-element-arc'
          else if (elType === 'rect') elTypeIcon.className += 'icon-element-rect'
          else if (elType === 'polygon' || elType === 'polyline') elTypeIcon.className += 'icon-element-rect'
          else elTypeIcon.className += 'icon-element-default'
          elTypeIcon.style.marginRight = '4px'
          elTypeIcon.style.flexShrink = '0'

          const nameSpan = document.createElement('span')
          nameSpan.className = 'collection-name'
          nameSpan.textContent = childName

          // Element icons container
          const elIcons = document.createElement('div')
          elIcons.className = 'collection-icons'

          // Element eye icon
          const elEyeIcon = document.createElement('div')
          elEyeIcon.className = 'icon collection-icon icon-restrict-screen'
          const isHidden = child.attr('data-hidden') === 'true'
          if (isHidden) elEyeIcon.classList.add('icon-off')
          elEyeIcon.title = isHidden ? 'Show' : 'Hide'
          elEyeIcon.addEventListener('click', (e) => {
            e.stopPropagation()
            toggleElementVisibility(editor, child)
          })

          // Element lock icon
          const elLockIcon = document.createElement('div')
          elLockIcon.className = 'icon collection-icon icon-restrict-edit-mode'
          const isLocked = child.attr('data-locked') === 'true'
          if (isLocked) elLockIcon.classList.add('icon-on')
          else elLockIcon.classList.add('icon-off')
          elLockIcon.title = isLocked ? 'Unlock' : 'Lock'
          elLockIcon.addEventListener('click', (e) => {
            e.stopPropagation()
            toggleElementLock(editor, child)
          })

          elIcons.appendChild(elEyeIcon)
          elIcons.appendChild(elLockIcon)

          li.style.paddingLeft = '28px'

          li.appendChild(elTypeIcon)
          li.appendChild(nameSpan)
          li.appendChild(elIcons)

          li.addEventListener('click', (e) => {
            e.stopPropagation()
            if (data.locked || isLocked) return
            if (isHidden) return
            signals.toogledSelect.dispatch(child)
          })
          childUl.appendChild(li)
          childrenContainer.appendChild(childUl)
        }
      })

      collectionUl.appendChild(childrenContainer)
      drawingTree.appendChild(collectionUl)
    })
  }

  signals.updatedSelection.add(() => {
    clearSelectionVisuals()
    editor.selected.forEach((el) => {
      const li = document.getElementById('li' + el.node.id)
      if (el.attr('data-collection') !== 'true') {
        el.addClass('elementSelected')
      }
      if (li) li.classList.add('outliner-selected')
    })
    signals.updatedProperties.dispatch()
    // Draw handlers for selected elements
    if (!editor.suppressHandlers) {
      drawHandlers()
    }
  })

  function clearSelectionVisuals() {
    // Clear handlers
    editor.handlers.clear()

    const selectedItems = drawingTree.querySelectorAll('.outliner-selected')
    selectedItems.forEach(li => li.classList.remove('outliner-selected'))

    // Clear elementSelected class from all elements across all collections recursively
    const removeSelectedClass = (el) => {
      el.removeClass('elementSelected')
      if (el.type === 'g' && el.children) {
        el.children().each(child => removeSelectedClass(child))
      }
    }

    editor.collections.forEach((data) => {
      removeSelectedClass(data.group)
    })
  }


  function drawHandlers() {
    // Clear existing handlers
    editor.handlers.clear()

    // Get current zoom level
    const currentZoom = editor.svg.zoom()
    const handlerScreenSize = getPreferences().handlerSize
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
          // Check Quadrants
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
        } else if (s.type === 'path' && s.data('arcData')) {
          const arc = s.data('arcData')
          if (Math.abs(arc.p1.x - x) < tolerance && Math.abs(arc.p1.y - y) < tolerance) {
            vertices.push({ element: s, vertexIndex: 0, originalPosition: arc })
          }
          if (Math.abs(arc.p2.x - x) < tolerance && Math.abs(arc.p2.y - y) < tolerance) {
            vertices.push({ element: s, vertexIndex: 1, originalPosition: arc })
          }
          if (Math.abs(arc.p3.x - x) < tolerance && Math.abs(arc.p3.y - y) < tolerance) {
            vertices.push({ element: s, vertexIndex: 2, originalPosition: arc })
          }
        } else if (s.type === 'path' && s.data('circleTrimData')) {
          const arc = s.data('circleTrimData')
          if (Math.abs(arc.startPt.x - x) < tolerance && Math.abs(arc.startPt.y - y) < tolerance) {
            vertices.push({ element: s, vertexIndex: 0, originalPosition: { x: arc.startPt.x, y: arc.startPt.y } })
          }
          if (Math.abs(arc.endPt.x - x) < tolerance && Math.abs(arc.endPt.y - y) < tolerance) {
            vertices.push({ element: s, vertexIndex: 1, originalPosition: { x: arc.endPt.x, y: arc.endPt.y } })
          }
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
      } else if (el.type === 'path' && el.data('arcData')) {
        const arc = el.data('arcData')
        const points = [
          { x: arc.p1.x, y: arc.p1.y, index: 0 },
          { x: arc.p2.x, y: arc.p2.y, index: 1 },
          { x: arc.p3.x, y: arc.p3.y, index: 2 }
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
      } else if (el.type === 'path' && el.data('circleTrimData')) {
        const arc = el.data('circleTrimData')
        const points = [
          { x: arc.startPt.x, y: arc.startPt.y, index: 0 },
          { x: arc.endPt.x, y: arc.endPt.y, index: 1 }
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
    clearSelectionVisuals()
    editor.selected = []
  })

  // Redraw handlers when zoom changes
  signals.zoomChanged.add(() => {
    drawHandlers()
  })

  // Redraw handlers when preferences change
  signals.preferencesChanged.add(() => {
    drawHandlers()
  })

  // Redraw handlers when properties change (without full selection update)
  signals.refreshHandlers.add(() => {
    drawHandlers()
  })

  signals.toogledSelect.add((el) => {
    if (editor.preventSelection || editor.isInteracting) return

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

  function childElements(group, parent, level = 1) {
    const groupUl = document.createElement('ul')
    const groupLi = document.createElement('li')
    groupLi.id = 'li' + group.node.id

    // Group toggle icon (let's assume it's expanded for now, or just give it a folder icon)
    const folderIcon = document.createElement('div')
    folderIcon.className = 'icon icon-group' // Reuse collection icon for group
    folderIcon.style.marginRight = '4px'
    folderIcon.style.flexShrink = '0'

    const groupNameSpan = document.createElement('span')
    groupNameSpan.className = 'collection-name'
    groupNameSpan.textContent = group.attr('name') || 'Group'

    groupLi.style.paddingLeft = (18 + level * 10) + 'px'
    groupLi.appendChild(folderIcon)
    groupLi.appendChild(groupNameSpan)

    groupLi.addEventListener('click', (e) => {
      e.stopPropagation()
      signals.toogledSelect.dispatch(group)
    })

    groupUl.appendChild(groupLi)

    // Container for children
    const childrenContainer = document.createElement('div')

    group.children().each((child) => {
      if (child.hasClass && child.hasClass('ghostLine')) return
      if (child.type === 'g') {
        childElements(child, childrenContainer, level + 1)
      } else {
        const childUl = document.createElement('ul')
        const li = document.createElement('li')
        li.id = 'li' + child.node.id

        const childName = child.attr('name') || child.node.nodeName

        // Element type icon
        const elTypeIcon = document.createElement('div')
        elTypeIcon.className = 'icon '
        const elType = child.type || child.node.nodeName.toLowerCase()
        if (elType === 'line') elTypeIcon.className += 'icon-element-line'
        else if (elType === 'circle') elTypeIcon.className += 'icon-element-circle'
        else if (elType === 'path') elTypeIcon.className += 'icon-element-arc'
        else if (elType === 'rect') elTypeIcon.className += 'icon-element-rect'
        else if (elType === 'polygon' || elType === 'polyline') elTypeIcon.className += 'icon-element-rect'
        else elTypeIcon.className += 'icon-element-default'
        elTypeIcon.style.marginRight = '4px'
        elTypeIcon.style.flexShrink = '0'

        const nameSpan = document.createElement('span')
        nameSpan.className = 'collection-name'
        nameSpan.textContent = childName

        // Element icons container
        const elIcons = document.createElement('div')
        elIcons.className = 'collection-icons'

        // Element eye icon
        const elEyeIcon = document.createElement('div')
        elEyeIcon.className = 'icon collection-icon icon-restrict-screen'
        const isHidden = child.attr('data-hidden') === 'true'
        if (isHidden) elEyeIcon.classList.add('icon-off')
        elEyeIcon.title = isHidden ? 'Show' : 'Hide'
        elEyeIcon.addEventListener('click', (e) => {
          e.stopPropagation()
          toggleElementVisibility(editor, child)
        })

        // Element lock icon
        const elLockIcon = document.createElement('div')
        elLockIcon.className = 'icon collection-icon icon-restrict-edit-mode'
        const isLocked = child.attr('data-locked') === 'true'
        if (isLocked) elLockIcon.classList.add('icon-on')
        else elLockIcon.classList.add('icon-off')
        elLockIcon.title = isLocked ? 'Unlock' : 'Lock'
        elLockIcon.addEventListener('click', (e) => {
          e.stopPropagation()
          toggleElementLock(editor, child)
        })

        elIcons.appendChild(elEyeIcon)
        elIcons.appendChild(elLockIcon)

        li.style.paddingLeft = (28 + level * 10) + 'px'

        li.appendChild(elTypeIcon)
        li.appendChild(nameSpan)
        li.appendChild(elIcons)

        li.addEventListener('click', (e) => {
          e.stopPropagation()
          if (isLocked || isHidden) return
          signals.toogledSelect.dispatch(child)
        })

        childUl.appendChild(li)
        childrenContainer.appendChild(childUl)
      }
    })

    groupUl.appendChild(childrenContainer)
    parent.appendChild(groupUl)
  }
}

export { Outliner }
