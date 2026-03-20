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

  signals.paperViewportsChanged.add(() => {
    drawingTree.innerHTML = ''
    renderCollections()
  })

  function renderCollections() {
    if (editor.mode === 'paper') {
      renderPaperModeOutliner()
    } else {
      renderModelModeCollections()
    }
  }

  // ── Paper-mode outliner ────────────────────────────────────────────────────

  function renderPaperModeOutliner() {
    // 1. Viewports pseudo-collection (at top)
    renderViewportsPseudoCollection()

    // 2. Annotations pseudo-collection
    renderAnnotationsPseudoCollection()

    // 3. Model collections (locked, visibility-only)
    editor.drawing.children().each((child) => {
      if (child.attr('data-collection') !== 'true') return
      const id = child.attr('id')
      const data = editor.collections.get(id)
      if (!data) return
      renderLockedModelCollection(child, data, id)
    })
  }

  function renderViewportsPseudoCollection() {
    const vps = editor.paperViewports || []

    const collectionUl = document.createElement('ul')
    collectionUl.className = 'outliner-collection outliner-paper-collection'

    const collectionLi = document.createElement('li')
    collectionLi.className = 'collection-row'

    const leftSide = document.createElement('div')
    leftSide.style.cssText = 'display:flex;align-items:center;flex:1;'

    const folderIcon = document.createElement('div')
    folderIcon.className = 'icon icon-collection'
    folderIcon.style.marginRight = '6px'
    folderIcon.style.color = '#8888ff'

    const nameSpan = document.createElement('span')
    nameSpan.className = 'collection-name'
    nameSpan.textContent = `Viewports (${vps.length})`
    nameSpan.style.color = '#aaaaff'

    leftSide.appendChild(folderIcon)
    leftSide.appendChild(nameSpan)
    collectionLi.appendChild(leftSide)
    collectionUl.appendChild(collectionLi)

    // Children: each viewport
    const childrenDiv = document.createElement('div')
    vps.forEach((vp) => {
      const vpUl = document.createElement('ul')
      const vpLi = document.createElement('li')
      vpLi.className = 'collection-row'

      const vpLeft = document.createElement('div')
      vpLeft.style.cssText = 'display:flex;align-items:center;flex:1;padding-left:20px;cursor:pointer;'

      const vpIcon = document.createElement('div')
      vpIcon.className = 'icon icon-element-rect'
      vpIcon.style.margin = '0 6px 0 0'
      vpIcon.style.color = '#8888ff'

      const vpName = document.createElement('span')
      vpName.className = 'collection-name'
      vpName.textContent = `${vp.id} — 1:${vp.scale}`

      vpLeft.appendChild(vpIcon)
      vpLeft.appendChild(vpName)

      // Click: select the viewport to show its properties
      vpLeft.addEventListener('click', (e) => {
        e.stopPropagation()
        editor.selected = [{ _paperVp: vp }]
        editor.signals.updatedProperties.dispatch()
      })

      // Visibility
      const iconsDiv = document.createElement('div')
      iconsDiv.className = 'collection-icons'
      const eyeIcon = document.createElement('div')
      eyeIcon.className = 'icon collection-icon icon-restrict-screen' + (vp.visible ? '' : ' icon-off')
      eyeIcon.addEventListener('click', (e) => {
        e.stopPropagation()
        vp.setVisible(!vp.visible)
        editor.signals.paperViewportsChanged.dispatch()
      })
      iconsDiv.appendChild(eyeIcon)

      vpLi.appendChild(vpLeft)
      vpLi.appendChild(iconsDiv)
      vpUl.appendChild(vpLi)
      childrenDiv.appendChild(vpUl)
    })

    collectionUl.appendChild(childrenDiv)
    drawingTree.appendChild(collectionUl)
  }

  function renderAnnotationsPseudoCollection() {
    const data = editor.collections.get('paper-annotations')
    if (!data) return

    const collectionUl = document.createElement('ul')
    collectionUl.className = 'outliner-collection outliner-paper-collection'

    const collectionLi = document.createElement('li')
    collectionLi.className = 'collection-row'
    if (editor.activeCollection === data.group) collectionLi.classList.add('collection-active')

    const leftSide = document.createElement('div')
    leftSide.style.cssText = 'display:flex;align-items:center;flex:1;'

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

    const folderIcon = document.createElement('div')
    folderIcon.className = 'icon icon-collection'
    folderIcon.style.marginRight = '6px'
    folderIcon.style.color = '#88cc88'

    const nameSpan = document.createElement('span')
    nameSpan.className = 'collection-name'
    nameSpan.textContent = 'Annotations'
    nameSpan.style.color = '#88cc88'

    leftSide.appendChild(toggleIcon)
    leftSide.appendChild(folderIcon)
    leftSide.appendChild(nameSpan)
    collectionLi.appendChild(leftSide)
    collectionUl.appendChild(collectionLi)

    // Container for children
    const childrenContainer = document.createElement('div')
    childrenContainer.style.display = data.collapsed ? 'none' : 'block'

    if (!data.collapsed) {
      childElements(data.group, childrenContainer, 1)
    }

    collectionUl.appendChild(childrenContainer)
    drawingTree.appendChild(collectionUl)
  }

  function renderLockedModelCollection(child, data, id) {
    const collectionUl = document.createElement('ul')
    collectionUl.className = 'outliner-collection outliner-model-collection-locked'

    const collectionLi = document.createElement('li')
    collectionLi.className = 'collection-row collection-locked-row'
    if (!data.visible) collectionLi.classList.add('collection-hidden-row')

    const leftSide = document.createElement('div')
    leftSide.style.cssText = 'display:flex;align-items:center;flex:1;'

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

    const folderIcon = document.createElement('div')
    folderIcon.className = 'icon icon-collection'
    folderIcon.style.marginRight = '6px'
    folderIcon.style.opacity = '0.5'

    const nameSpan = document.createElement('span')
    nameSpan.className = 'collection-name'
    nameSpan.textContent = (child.attr('name') || 'Collection')
    nameSpan.style.opacity = '0.6'

    leftSide.appendChild(toggleIcon)
    leftSide.appendChild(folderIcon)
    leftSide.appendChild(nameSpan)

    // Right side: only visibility toggle
    const iconsDiv = document.createElement('div')
    iconsDiv.className = 'collection-icons'

    const eyeIcon = document.createElement('div')
    eyeIcon.className = 'icon collection-icon icon-restrict-screen'
    if (!data.visible) eyeIcon.classList.add('icon-off')
    eyeIcon.title = data.visible ? 'Hide' : 'Show'
    eyeIcon.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleVisibility(editor, id)
    })

    // Lock icon (always locked, informational only)
    const lockIcon = document.createElement('div')
    lockIcon.className = 'icon collection-icon icon-restrict-edit-mode icon-on'
    lockIcon.title = 'Locked in Paper mode'

    iconsDiv.appendChild(eyeIcon)
    iconsDiv.appendChild(lockIcon)

    collectionLi.appendChild(leftSide)
    collectionLi.appendChild(iconsDiv)
    collectionUl.appendChild(collectionLi)

    // Container for children
    const childrenContainer = document.createElement('div')
    childrenContainer.style.display = data.collapsed ? 'none' : 'block'

    // Render children if not collapsed
    if (!data.collapsed) {
      childElements(data.dataGroup || data.group, childrenContainer, 1)
    }

    collectionUl.appendChild(childrenContainer)
    drawingTree.appendChild(collectionUl)
  }

  // ── Model-mode outliner (original) ─────────────────────────────────────────

  function renderModelModeCollections() {
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

      // Auto-collapse large collections (> 200 children) on first render
      if (data.collapsed === undefined && data.group.children().length > 200) {
        data.collapsed = true
      }

      // Container for children
      const childrenContainer = document.createElement('div')
      childrenContainer.style.display = data.collapsed ? 'none' : 'block'

      // Only render child DOM nodes if not collapsed (avoid thousands of DOM nodes)
      if (!data.collapsed) {
        childElements(data.group, childrenContainer, 1)
      } // end if (!data.collapsed)

      collectionUl.appendChild(childrenContainer)
      drawingTree.appendChild(collectionUl)
    })
  }

  signals.updatedSelection.add(() => {
    clearSelectionVisuals()
    editor.selected.forEach((el) => {
      if (el._paperVp) return // Viewports don't have Outliner rows or elementSelected class
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

    // Only remove elementSelected from previously-selected elements (O(k) not O(n))
    const removeSelectedRecursive = (el) => {
      if (!el.removeClass) return // Viewport wrappers don't have removeClass
      el.removeClass('elementSelected')
      if (el.type === 'g' && el.children) {
        el.children().each(child => removeSelectedRecursive(child))
      }
    }
    editor.selected.forEach(el => removeSelectedRecursive(el))
  }


  function drawHandlers() {
    // Clear existing handlers
    editor.handlers.clear()

    // Get current SVG and zoom level based on mode
    const isPaper = editor.mode === 'paper'
    const activeSvg = isPaper ? editor.paperSvg : editor.svg
    if (!activeSvg) return

    const currentZoom = activeSvg.zoom()
    const handlerScreenSize = getPreferences().handlerSize
    const handlerWorldSize = handlerScreenSize / currentZoom

    const svgNode = activeSvg.node

    // Helper to transform a local element point to world coordinates
    const localToWorld = (element, x, y) => {
      const pt = svgNode.createSVGPoint()
      pt.x = x
      pt.y = y
      let elementCTM
      if (element.node) {
        elementCTM = element.node.getCTM()
      } else {
        // Fallback for mock objects like paper viewports
        elementCTM = svgNode.getCTM()
      }
      const svgCTM = svgNode.getCTM()
      if (!elementCTM || !svgCTM) return { x, y }

      // We want the point relative to the SVG root drawing area, not the screen
      const screenPt = pt.matrixTransform(elementCTM)

      // Invert the SVG root's CTM (which handles pan/zoom) to get world coords
      const invSvgCTM = svgCTM.inverse()
      const worldPt = screenPt.matrixTransform(invSvgCTM)

      return { x: worldPt.x, y: worldPt.y }
    }

    // Helper to find all selected vertices at a given position
    function getCoincidentVertices(x, y) {
      const vertices = []
      const tolerance = 0.1
      editor.selected.forEach((s) => {
        if (s.type === 'line') {
          const pt1 = localToWorld(s, s.node.x1.baseVal.value, s.node.y1.baseVal.value)
          const pt2 = localToWorld(s, s.node.x2.baseVal.value, s.node.y2.baseVal.value)

          if (Math.abs(pt1.x - x) < tolerance && Math.abs(pt1.y - y) < tolerance) {
            vertices.push({ element: s, vertexIndex: 0, originalPosition: { x: s.node.x1.baseVal.value, y: s.node.y1.baseVal.value } })
          }
          if (Math.abs(pt2.x - x) < tolerance && Math.abs(pt2.y - y) < tolerance) {
            vertices.push({ element: s, vertexIndex: 1, originalPosition: { x: s.node.x2.baseVal.value, y: s.node.y2.baseVal.value } })
          }
        } else if (s.type === 'circle') {
          const cx = s.node.cx.baseVal.value
          const cy = s.node.cy.baseVal.value
          const r = s.node.r.baseVal.value

          const pCenter = localToWorld(s, cx, cy)
          const pTop = localToWorld(s, cx, cy - r)
          const pRight = localToWorld(s, cx + r, cy)
          const pBottom = localToWorld(s, cx, cy + r)
          const pLeft = localToWorld(s, cx - r, cy)

          // Check Center
          if (Math.abs(pCenter.x - x) < tolerance && Math.abs(pCenter.y - y) < tolerance) vertices.push({ element: s, vertexIndex: 0, originalPosition: { cx, cy, r } })
          // Check Quadrants
          if (Math.abs(pTop.x - x) < tolerance && Math.abs(pTop.y - y) < tolerance) vertices.push({ element: s, vertexIndex: 1, originalPosition: { cx, cy, r } })
          if (Math.abs(pRight.x - x) < tolerance && Math.abs(pRight.y - y) < tolerance) vertices.push({ element: s, vertexIndex: 2, originalPosition: { cx, cy, r } })
          if (Math.abs(pBottom.x - x) < tolerance && Math.abs(pBottom.y - y) < tolerance) vertices.push({ element: s, vertexIndex: 3, originalPosition: { cx, cy, r } })
          if (Math.abs(pLeft.x - x) < tolerance && Math.abs(pLeft.y - y) < tolerance) vertices.push({ element: s, vertexIndex: 4, originalPosition: { cx, cy, r } })
        } else if (s.type === 'rect') {
          const rx = s.node.x.baseVal.value
          const ry = s.node.y.baseVal.value
          const rw = s.node.width.baseVal.value
          const rh = s.node.height.baseVal.value

          const rectPoints = [
            { pt: localToWorld(s, rx, ry), index: 0 },
            { pt: localToWorld(s, rx + rw, ry), index: 1 },
            { pt: localToWorld(s, rx + rw, ry + rh), index: 2 },
            { pt: localToWorld(s, rx, ry + rh), index: 3 },
            { pt: localToWorld(s, rx + rw / 2, ry), index: 4 },
            { pt: localToWorld(s, rx + rw, ry + rh / 2), index: 5 },
            { pt: localToWorld(s, rx + rw / 2, ry + rh), index: 6 },
            { pt: localToWorld(s, rx, ry + rh / 2), index: 7 }
          ]

          rectPoints.forEach(p => {
            if (Math.abs(p.pt.x - x) < tolerance && Math.abs(p.pt.y - y) < tolerance) {
              vertices.push({ element: s, vertexIndex: p.index, originalPosition: { x: rx, y: ry, width: rw, height: rh } })
            }
          })
        } else if (s.type === 'path' && s.data('arcData')) {
          const arc = s.data('arcData')
          const pt1 = localToWorld(s, arc.p1.x, arc.p1.y)
          const pt2 = localToWorld(s, arc.p2.x, arc.p2.y)
          const pt3 = localToWorld(s, arc.p3.x, arc.p3.y)

          if (Math.abs(pt1.x - x) < tolerance && Math.abs(pt1.y - y) < tolerance) vertices.push({ element: s, vertexIndex: 0, originalPosition: arc })
          if (Math.abs(pt2.x - x) < tolerance && Math.abs(pt2.y - y) < tolerance) vertices.push({ element: s, vertexIndex: 1, originalPosition: arc })
          if (Math.abs(pt3.x - x) < tolerance && Math.abs(pt3.y - y) < tolerance) vertices.push({ element: s, vertexIndex: 2, originalPosition: arc })
        } else if (s.type === 'path' && s.data('circleTrimData')) {
          const arc = s.data('circleTrimData')
          const pt1 = localToWorld(s, arc.startPt.x, arc.startPt.y)
          const pt2 = localToWorld(s, arc.endPt.x, arc.endPt.y)

          if (Math.abs(pt1.x - x) < tolerance && Math.abs(pt1.y - y) < tolerance) vertices.push({ element: s, vertexIndex: 0, originalPosition: { x: arc.startPt.x, y: arc.startPt.y } })
          if (Math.abs(pt2.x - x) < tolerance && Math.abs(pt2.y - y) < tolerance) vertices.push({ element: s, vertexIndex: 1, originalPosition: { x: arc.endPt.x, y: arc.endPt.y } })
        } else if (s.type === 'path' && s.data('splineData')) {
          const spline = s.data('splineData')
          spline.points.forEach((sp, idx) => {
            const wPt = localToWorld(s, sp.x, sp.y)
            if (Math.abs(wPt.x - x) < tolerance && Math.abs(wPt.y - y) < tolerance) {
              vertices.push({ element: s, vertexIndex: idx, originalPosition: { points: spline.points.map(p => ({ x: p.x, y: p.y })) } })
            }
          })
        } else if (s.type === 'g' && s.attr('data-element-type') === 'dimension') {
          try {
            const dimData = JSON.parse(s.attr('data-dim-data'))
            const textCenter = s.attr('data-dim-text-center') ? JSON.parse(s.attr('data-dim-text-center')) : null
            
            // p1, p2, p3, text
            const pts = [
                { idx: 0, pt: localToWorld(s, dimData.p1.x, dimData.p1.y) },
                { idx: 1, pt: localToWorld(s, dimData.p2.x, dimData.p2.y) },
                { idx: 2, pt: localToWorld(s, dimData.p3.x, dimData.p3.y) }
            ]
            if (textCenter) {
                pts.push({ idx: 3, pt: localToWorld(s, textCenter.x, textCenter.y) })
            }
            
            pts.forEach((p) => {
                if (Math.abs(p.pt.x - x) < tolerance && Math.abs(p.pt.y - y) < tolerance) {
                    vertices.push({ element: s, vertexIndex: p.idx, originalPosition: dimData })
                }
            })
          } catch(e) {}
        }
      })
      return vertices
    }

    // Draw handlers for each selected element
    editor.selected.forEach((el) => {
      if (el.type === 'g' && el.attr('data-element-type') === 'dimension') {
        try {
            const dimData = JSON.parse(el.attr('data-dim-data'))
            const textCenter = el.attr('data-dim-text-center') ? JSON.parse(el.attr('data-dim-text-center')) : null
            
            const points = [
                { pt: localToWorld(el, dimData.p1.x, dimData.p1.y) },
                { pt: localToWorld(el, dimData.p2.x, dimData.p2.y) },
                { pt: localToWorld(el, dimData.p3.x, dimData.p3.y) }
            ]
            if (textCenter) {
                points.push({ pt: localToWorld(el, textCenter.x, textCenter.y) })
            }
            
            points.forEach((p) => {
                editor.handlers
                    .rect(handlerWorldSize, handlerWorldSize)
                    .center(p.pt.x, p.pt.y)
                    .addClass('selection-handler')
                    .mousedown((e) => {
                        e.stopPropagation()
                        signals.vertexEditStarted.dispatch(getCoincidentVertices(p.pt.x, p.pt.y))
                    })
            })
        } catch(e) {}
        return
      }

      // NOTE: We only draw handlers for atomic elements, not for group elements directly
      if (el.type === 'g' && el.attr('data-group') === 'true') {
        // Optionally, a future update could draw a bounding-box handler for the entire group here
        return
      }

      if (el.type === 'line') {
        const pt1 = localToWorld(el, el.node.x1.baseVal.value, el.node.y1.baseVal.value)
        const pt2 = localToWorld(el, el.node.x2.baseVal.value, el.node.y2.baseVal.value)

        // Draw handler at first vertex
        editor.handlers
          .rect(handlerWorldSize, handlerWorldSize)
          .center(pt1.x, pt1.y)
          .addClass('selection-handler')
          .mousedown((e) => {
            e.stopPropagation()
            signals.vertexEditStarted.dispatch(getCoincidentVertices(pt1.x, pt1.y))
          })

        // Draw handler at second vertex
        editor.handlers
          .rect(handlerWorldSize, handlerWorldSize)
          .center(pt2.x, pt2.y)
          .addClass('selection-handler')
          .mousedown((e) => {
            e.stopPropagation()
            signals.vertexEditStarted.dispatch(getCoincidentVertices(pt2.x, pt2.y))
          })

      } else if (el.type === 'circle') {
        const cx = el.node.cx.baseVal.value
        const cy = el.node.cy.baseVal.value
        const r = el.node.r.baseVal.value

        const points = [
          { pt: localToWorld(el, cx, cy), index: 0 }, // Center
          { pt: localToWorld(el, cx, cy - r), index: 1 }, // Top
          { pt: localToWorld(el, cx + r, cy), index: 2 }, // Right
          { pt: localToWorld(el, cx, cy + r), index: 3 }, // Bottom
          { pt: localToWorld(el, cx - r, cy), index: 4 }, // Left
        ]

        points.forEach((p) => {
          editor.handlers
            .rect(handlerWorldSize, handlerWorldSize)
            .center(p.pt.x, p.pt.y)
            .addClass('selection-handler-circle')
            .mousedown((e) => {
              e.stopPropagation()
              signals.vertexEditStarted.dispatch(getCoincidentVertices(p.pt.x, p.pt.y))
            })
        })
      } else if (el.type === 'rect' || el._paperVp) {

        let rx, ry, rw, rh, s
        if (el._paperVp) {
          const vp = el._paperVp
          rx = vp.x
          ry = vp.y
          rw = vp.w
          rh = vp.h
          s = editor.paperSvg // use paper SVG as the space reference
        } else {
          rx = el.node.x.baseVal.value
          ry = el.node.y.baseVal.value
          rw = el.node.width.baseVal.value
          rh = el.node.height.baseVal.value
          s = el
        }

        const points = [
          { pt: localToWorld(s, rx, ry), index: 0, isCorner: true, _vpOriginal: { x: rx, y: ry, width: rw, height: rh } },
          { pt: localToWorld(s, rx + rw, ry), index: 1, isCorner: true, _vpOriginal: { x: rx, y: ry, width: rw, height: rh } },
          { pt: localToWorld(s, rx + rw, ry + rh), index: 2, isCorner: true, _vpOriginal: { x: rx, y: ry, width: rw, height: rh } },
          { pt: localToWorld(s, rx, ry + rh), index: 3, isCorner: true, _vpOriginal: { x: rx, y: ry, width: rw, height: rh } },
          { pt: localToWorld(s, rx + rw / 2, ry), index: 4, isCorner: false, _vpOriginal: { x: rx, y: ry, width: rw, height: rh } },
          { pt: localToWorld(s, rx + rw, ry + rh / 2), index: 5, isCorner: false, _vpOriginal: { x: rx, y: ry, width: rw, height: rh } },
          { pt: localToWorld(s, rx + rw / 2, ry + rh), index: 6, isCorner: false, _vpOriginal: { x: rx, y: ry, width: rw, height: rh } },
          { pt: localToWorld(s, rx, ry + rh / 2), index: 7, isCorner: false, _vpOriginal: { x: rx, y: ry, width: rw, height: rh } }
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
            .center(p.pt.x, p.pt.y)
            .addClass('selection-handler')
            .mousedown((e) => {
              e.stopPropagation()
              if (el._paperVp) {
                signals.vertexEditStarted.dispatch([{ element: el, vertexIndex: p.index, originalPosition: p._vpOriginal }])
              } else {
                signals.vertexEditStarted.dispatch(getCoincidentVertices(p.pt.x, p.pt.y))
              }
            })
        })
      } else if (el.type === 'path' && el.data('arcData')) {
        const arc = el.data('arcData')
        const points = [
          { pt: localToWorld(el, arc.p1.x, arc.p1.y) },
          { pt: localToWorld(el, arc.p2.x, arc.p2.y) },
          { pt: localToWorld(el, arc.p3.x, arc.p3.y) }
        ]

        points.forEach((p) => {
          editor.handlers
            .rect(handlerWorldSize, handlerWorldSize)
            .center(p.pt.x, p.pt.y)
            .addClass('selection-handler')
            .mousedown((e) => {
              e.stopPropagation()
              signals.vertexEditStarted.dispatch(getCoincidentVertices(p.pt.x, p.pt.y))
            })
        })
      } else if (el.type === 'path' && el.data('circleTrimData')) {
        const arc = el.data('circleTrimData')
        const points = [
          { pt: localToWorld(el, arc.startPt.x, arc.startPt.y) },
          { pt: localToWorld(el, arc.endPt.x, arc.endPt.y) }
        ]

        points.forEach((p) => {
          editor.handlers
            .rect(handlerWorldSize, handlerWorldSize)
            .center(p.pt.x, p.pt.y)
            .addClass('selection-handler')
            .mousedown((e) => {
              e.stopPropagation()
              signals.vertexEditStarted.dispatch(getCoincidentVertices(p.pt.x, p.pt.y))
            })
        })
      } else if (el.type === 'path' && el.data('splineData')) {
        const spline = el.data('splineData')
        spline.points.forEach((sp) => {
          const wPt = localToWorld(el, sp.x, sp.y)
          editor.handlers
            .rect(handlerWorldSize, handlerWorldSize)
            .center(wPt.x, wPt.y)
            .addClass('selection-handler')
            .mousedown((e) => {
              e.stopPropagation()
              signals.vertexEditStarted.dispatch(getCoincidentVertices(wPt.x, wPt.y))
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

    const isElementSelected = editor.selected.some(item => {
      if (item._paperVp) return false
      return item.node.id === el.node.id
    })

    if (!isElementSelected) {
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
    let childrenContainer = parent
    let nextLevel = level

    const isExplicitGroup = group.attr('data-group') === 'true'

    if (isExplicitGroup) {
      const groupUl = document.createElement('ul')
      const groupLi = document.createElement('li')
      groupLi.id = 'li' + group.node.id
      groupLi.className = 'collection-row' // Use same class for layout

      const isHidden = group.attr('data-hidden') === 'true'
      const isLocked = group.attr('data-locked') === 'true'
      const isCollapsed = group.attr('data-collapsed') === 'true'

      if (isHidden) groupLi.classList.add('collection-hidden-row')
      if (isLocked) groupLi.classList.add('collection-locked-row')

      // Left side wrapper
      const leftSide = document.createElement('div')
      leftSide.style.display = 'flex'
      leftSide.style.alignItems = 'center'
      leftSide.style.flex = '1'
      leftSide.style.paddingLeft = (level * 10) + 'px'

      // Chevron toggle icon
      const toggleIcon = document.createElement('div')
      toggleIcon.className = 'icon ' + (isCollapsed ? 'icon-right' : 'icon-down')
      toggleIcon.style.marginRight = '4px'
      toggleIcon.style.cursor = 'pointer'
      toggleIcon.addEventListener('click', (e) => {
        e.stopPropagation()
        if (isCollapsed) group.attr('data-collapsed', null)
        else group.attr('data-collapsed', 'true')
        signals.updatedOutliner.dispatch()
      })

      // Group icon
      const folderIcon = document.createElement('div')
      folderIcon.className = 'icon icon-group'
      folderIcon.style.marginRight = '4px'
      folderIcon.style.flexShrink = '0'

      const groupNameSpan = document.createElement('span')
      groupNameSpan.className = 'collection-name'
      groupNameSpan.textContent = group.attr('name') || 'Group'

      leftSide.appendChild(toggleIcon)
      leftSide.appendChild(folderIcon)
      leftSide.appendChild(groupNameSpan)

      leftSide.addEventListener('click', (e) => {
        e.stopPropagation()
        signals.toogledSelect.dispatch(group)
      })

      // Icons container (right side)
      const iconsDiv = document.createElement('div')
      iconsDiv.className = 'collection-icons'

      // Group eye icon
      const elEyeIcon = document.createElement('div')
      elEyeIcon.className = 'icon collection-icon icon-restrict-screen'
      if (isHidden) elEyeIcon.classList.add('icon-off')
      elEyeIcon.title = isHidden ? 'Show' : 'Hide'
      elEyeIcon.addEventListener('click', (e) => {
        e.stopPropagation()
        toggleElementVisibility(editor, group)
      })

      // Group lock icon
      const elLockIcon = document.createElement('div')
      elLockIcon.className = 'icon collection-icon icon-restrict-edit-mode'
      if (isLocked) elLockIcon.classList.add('icon-on')
      else elLockIcon.classList.add('icon-off')
      elLockIcon.title = isLocked ? 'Unlock' : 'Lock'
      elLockIcon.addEventListener('click', (e) => {
        e.stopPropagation()
        toggleElementLock(editor, group)
      })

      iconsDiv.appendChild(elEyeIcon)
      iconsDiv.appendChild(elLockIcon)

      groupLi.appendChild(leftSide)
      groupLi.appendChild(iconsDiv)
      groupUl.appendChild(groupLi)

      // Container for children
      childrenContainer = document.createElement('div')
      childrenContainer.style.display = isCollapsed ? 'none' : 'block'
      groupUl.appendChild(childrenContainer)
      parent.appendChild(groupUl)

      if (isCollapsed) return // Don't render children if collapsed

      nextLevel = level + 1
    }

    // Render children into the appropriate container
    group.children().each((child) => {
      if (child.hasClass && child.hasClass('ghostLine')) return
      if (child.type === 'g') {
        childElements(child, childrenContainer, nextLevel)
      } else {
        const childUl = document.createElement('ul')
        const li = document.createElement('li')
        li.id = 'li' + child.node.id
        li.className = 'collection-row' // consistent layout

        const childName = child.attr('name') || child.node.nodeName
        const isHidden = child.attr('data-hidden') === 'true'
        const isLocked = child.attr('data-locked') === 'true'

        if (isHidden) li.classList.add('collection-hidden-row')
        if (isLocked) li.classList.add('collection-locked-row')

        // Left side wrapper for children
        const leftSide = document.createElement('div')
        leftSide.style.display = 'flex'
        leftSide.style.alignItems = 'center'
        leftSide.style.flex = '1'
        leftSide.style.paddingLeft = (20 + level * 10) + 'px'

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

        leftSide.appendChild(elTypeIcon)
        leftSide.appendChild(nameSpan)

        leftSide.addEventListener('click', (e) => {
          e.stopPropagation()
          if (isLocked || isHidden) return
          signals.toogledSelect.dispatch(child)
        })

        // Element icons container
        const elIcons = document.createElement('div')
        elIcons.className = 'collection-icons'

        // Element eye icon
        const elEyeIcon = document.createElement('div')
        elEyeIcon.className = 'icon collection-icon icon-restrict-screen'
        if (isHidden) elEyeIcon.classList.add('icon-off')
        elEyeIcon.title = isHidden ? 'Show' : 'Hide'
        elEyeIcon.addEventListener('click', (e) => {
          e.stopPropagation()
          toggleElementVisibility(editor, child)
        })

        // Element lock icon
        const elLockIcon = document.createElement('div')
        elLockIcon.className = 'icon collection-icon icon-restrict-edit-mode'
        if (isLocked) elLockIcon.classList.add('icon-on')
        else elLockIcon.classList.add('icon-off')
        elLockIcon.title = isLocked ? 'Unlock' : 'Lock'
        elLockIcon.addEventListener('click', (e) => {
          e.stopPropagation()
          toggleElementLock(editor, child)
        })

        elIcons.appendChild(elEyeIcon)
        elIcons.appendChild(elLockIcon)

        li.appendChild(leftSide)
        li.appendChild(elIcons)

        childUl.appendChild(li)
        childrenContainer.appendChild(childUl)
      }
    })
  }
}

export { Outliner }
