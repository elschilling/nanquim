import { Command } from '../Command'

class OffsetCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'OffsetCommand'
    this.name = 'Offset'
    this.distance = null
    this.selectedElement = null
    this.ghostElement = null
    this.isSelectingElement = false
    this.isPositioning = false
    this.lastMousePosition = { x: 0, y: 0 }

    // Bind methods to maintain context
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.boundOnMouseMove = this.onMouseMove.bind(this)
    this.boundOnMouseClick = this.onMouseClick.bind(this)
    this.boundOnElementHover = this.onElementHover.bind(this)
    this.boundOnElementSelect = this.onElementSelect.bind(this)
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Enter a distance to offset`,
    })
    this.editor.isInteracting = true
    this.editor.signals.inputValue.addOnce(this.onDistanceInput, this)
  }

  onDistanceInput() {
    this.distance = parseFloat(this.editor.distance)
    if (this.distance && !isNaN(this.distance)) {
      this.editor.signals.terminalLogged.dispatch({
        msg: `Offset distance: ${this.distance}. Select elements to offset.`,
      })
      this.startElementSelection()
    } else {
      this.editor.signals.terminalLogged.dispatch({
        msg: 'Invalid distance. Please enter a valid number.',
      })
      this.cleanup()
    }
  }

  startElementSelection() {
    this.isSelectingElement = true
    this.editor.isInteracting = false
    this.editor.selectSingleElement = true

    // Set up event listeners
    document.addEventListener('keydown', this.boundOnKeyDown)

    // Connect to editor signals for element interaction
    this.editor.signals.toogledSelect.add(this.boundOnElementSelect)
    this.editor.signals.elementHovered?.add(this.boundOnElementHover)

    this.editor.signals.terminalLogged.dispatch({
      msg: 'Click on elements to offset them. Press Esc to exit.',
    })
  }

  onElementSelect(element) {
    if (!this.isSelectingElement) return

    this.selectedElement = element
    this.isSelectingElement = false
    this.isPositioning = true

    // Set up mouse tracking for offset direction
    document.addEventListener('mousemove', this.boundOnMouseMove)
    document.addEventListener('click', this.boundOnMouseClick)

    this.editor.signals.terminalLogged.dispatch({
      msg: 'Move mouse to set offset direction, click to confirm.',
    })
  }

  extractDOMElement(element) {
    // Handle different element wrapper formats
    if (!element) return null

    // If it's already a DOM element
    if (element.nodeType === Node.ELEMENT_NODE) {
      return element
    }

    // Check for common wrapper patterns
    if (element.node && element.node.nodeType === Node.ELEMENT_NODE) {
      return element.node
    }

    if (element.dom && element.dom.nodeType === Node.ELEMENT_NODE) {
      return element.dom
    }

    // Check for SVG.js style elements
    if (element.node && element.node.instance) {
      return element.node.instance
    }

    // If element has a reference to the actual DOM node
    if (element.element && element.element.nodeType === Node.ELEMENT_NODE) {
      return element.element
    }

    // Last resort - try to find any property that looks like a DOM element
    for (const [key, value] of Object.entries(element)) {
      if (value && value.nodeType === Node.ELEMENT_NODE) {
        return value
      }
    }

    console.warn('Could not extract DOM element from:', element)
    return null
  }

  onElementHover(element) {
    if (!this.isSelectingElement || !element) return

    // Visual feedback for hoverable elements
    this.editor.signals.elementHighlighted?.dispatch(element)
  }

  onMouseMove(event) {
    if (!this.isPositioning || !this.selectedElement) return

    // Throttle mouse movement updates to prevent excessive ghost recreation
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout)
    }

    // Convert mouse coordinates to SVG coordinates if needed
    const mousePos = this.getMousePosition(event)
    this.lastMousePosition = mousePos

    // Update ghost with slight delay to reduce flicker
    this.updateTimeout = setTimeout(() => {
      console.log('Mouse move - updating ghost at position:', mousePos)
      this.updateGhost()
    }, 16) // ~60fps throttling
  }

  getMousePosition(event) {
    // Get the SVG element that contains our selected element
    const domElement = this.extractDOMElement(this.selectedElement)
    if (!domElement) {
      return { x: event.clientX, y: event.clientY }
    }

    // Find the SVG root element
    let svgElement = domElement
    while (svgElement && svgElement.tagName && svgElement.tagName.toLowerCase() !== 'svg') {
      svgElement = svgElement.parentNode
    }

    if (svgElement && svgElement.createSVGPoint) {
      try {
        // Create a point in SVG coordinate system
        const pt = svgElement.createSVGPoint()
        pt.x = event.clientX
        pt.y = event.clientY

        // Transform from screen coordinates to SVG coordinates
        const ctm = svgElement.getScreenCTM()
        if (ctm) {
          const svgPoint = pt.matrixTransform(ctm.inverse())
          console.log(`Mouse position converted: screen(${event.clientX}, ${event.clientY}) -> SVG(${svgPoint.x}, ${svgPoint.y})`)
          return { x: svgPoint.x, y: svgPoint.y }
        }
      } catch (e) {
        console.warn('Could not convert mouse coordinates to SVG space:', e)
      }
    }

    // Fallback: try to estimate based on element position
    try {
      const rect = domElement.getBoundingClientRect()
      const bbox = domElement.getBBox()

      // Calculate approximate scale and offset
      const scaleX = bbox.width / rect.width
      const scaleY = bbox.height / rect.height

      // Convert client coordinates to approximate SVG coordinates
      const svgX = (event.clientX - rect.left) * scaleX + bbox.x
      const svgY = (event.clientY - rect.top) * scaleY + bbox.y

      console.log(`Mouse position estimated: screen(${event.clientX}, ${event.clientY}) -> SVG(${svgX}, ${svgY})`)
      return { x: svgX, y: svgY }
    } catch (e) {
      console.warn('Could not estimate SVG coordinates:', e)
    }

    // Last resort - return client coordinates (will be inaccurate)
    console.warn('Using client coordinates as fallback - may be inaccurate')
    return { x: event.clientX, y: event.clientY }
  }

  onMouseClick(event) {
    if (!this.isPositioning || !this.selectedElement) return

    event.preventDefault()
    this.confirmOffset()
  }

  updateGhost() {
    if (!this.selectedElement) return

    // Extract the actual DOM element
    const domElement = this.extractDOMElement(this.selectedElement)
    if (!domElement) {
      console.error('Could not extract DOM element for ghost creation')
      return
    }

    console.log('Updating ghost for element:', domElement)

    // Remove existing ghost
    this.removeGhost()

    // Calculate offset direction based on mouse position
    const elementBounds = this.getElementBounds(domElement)
    console.log('Element bounds:', elementBounds)

    const offsetDirection = this.calculateOffsetDirection(elementBounds, this.lastMousePosition)
    console.log('Offset direction:', offsetDirection, 'mouse:', this.lastMousePosition)

    // Create ghost element
    this.ghostElement = this.createOffsetGhost(domElement, offsetDirection)
    console.log('Created ghost element:', this.ghostElement)

    if (this.ghostElement) {
      // Add ghost to scene with visual styling
      this.styleGhostElement(this.ghostElement)

      // Find the correct SVG container
      const container = this.findSVGContainer()
      if (container) {
        container.appendChild(this.ghostElement)
        console.log('Ghost added to container:', container.tagName, container)

        // Verify the ghost was actually added and is visible
        console.log('Ghost element in DOM:', document.contains(this.ghostElement))
        console.log('Ghost element computed style:', window.getComputedStyle(this.ghostElement))
      } else {
        console.error('Could not find suitable SVG container for ghost element')
        return
      }

      // Dispatch ghost created signal
      this.editor.signals.offsetGhostCreated?.dispatch(this.ghostElement)
    }
  }

  findSVGContainer() {
    // First, try to find the actual SVG element that contains our selected element
    const domElement = this.extractDOMElement(this.selectedElement)
    if (domElement) {
      // Walk up the DOM tree to find the SVG parent
      let parent = domElement.parentNode
      while (parent) {
        if (parent.tagName && parent.tagName.toLowerCase() === 'svg') {
          console.log('Found SVG parent container:', parent)
          return parent
        }
        parent = parent.parentNode
      }

      // If no SVG parent found, try using the direct parent
      if (domElement.parentNode && domElement.parentNode.tagName) {
        console.log('Using direct parent as container:', domElement.parentNode)
        return domElement.parentNode
      }
    }

    // Try to find SVG elements in the editor
    const svgCandidates = [
      this.editor.svg,
      this.editor.scene,
      document.querySelector('svg'),
      document.querySelector('#canvas svg'),
      document.querySelector('.layout-editor svg'),
      document.querySelector('svg g'), // SVG group element
    ]

    for (const container of svgCandidates) {
      if (container && container.tagName && (container.tagName.toLowerCase() === 'svg' || container.tagName.toLowerCase() === 'g')) {
        console.log('Found SVG container:', container)
        return container
      }
    }

    // Last resort - try any container that can append children
    const fallbackCandidates = [this.editor.canvas, this.editor.workspace, document.querySelector('#canvas')]

    for (const container of fallbackCandidates) {
      if (container && container.appendChild) {
        console.log('Using fallback container (may not work for SVG):', container)
        return container
      }
    }

    console.error('No suitable container found for SVG elements')
    return null
  }

  getElementBounds(element) {
    try {
      if (element.getBBox && typeof element.getBBox === 'function') {
        // SVG element - use getBBox for local coordinates
        const bbox = element.getBBox()
        console.log('Got bbox:', bbox)

        // For SVG coordinates, we'll use the bbox directly without transformation
        // since our mouse coordinates are also in SVG space
        return {
          x: bbox.x,
          y: bbox.y,
          width: bbox.width,
          height: bbox.height,
          centerX: bbox.x + bbox.width / 2,
          centerY: bbox.y + bbox.height / 2,
        }
      } else {
        console.log('Element does not have getBBox, using attributes fallback')
        // Fallback: try to get basic dimensions
        const bounds = this.getElementBoundsFromAttributes(element)
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          centerX: bounds.x + bounds.width / 2,
          centerY: bounds.y + bounds.height / 2,
        }
      }
    } catch (error) {
      console.error('Error getting element bounds:', error)
      // Return default bounds
      return {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        centerX: 50,
        centerY: 50,
      }
    }
  }

  getElementBoundsFromAttributes(element) {
    // Try to extract bounds from element attributes
    const tagName = element.tagName ? element.tagName.toLowerCase() : ''

    switch (tagName) {
      case 'rect':
        return {
          x: parseFloat(element.getAttribute('x') || 0),
          y: parseFloat(element.getAttribute('y') || 0),
          width: parseFloat(element.getAttribute('width') || 100),
          height: parseFloat(element.getAttribute('height') || 100),
        }
      case 'circle':
        const cx = parseFloat(element.getAttribute('cx') || 0)
        const cy = parseFloat(element.getAttribute('cy') || 0)
        const r = parseFloat(element.getAttribute('r') || 50)
        return {
          x: cx - r,
          y: cy - r,
          width: r * 2,
          height: r * 2,
        }
      case 'ellipse':
        const ecx = parseFloat(element.getAttribute('cx') || 0)
        const ecy = parseFloat(element.getAttribute('cy') || 0)
        const rx = parseFloat(element.getAttribute('rx') || 50)
        const ry = parseFloat(element.getAttribute('ry') || 25)
        return {
          x: ecx - rx,
          y: ecy - ry,
          width: rx * 2,
          height: ry * 2,
        }
      case 'line':
        const x1 = parseFloat(element.getAttribute('x1') || 0)
        const y1 = parseFloat(element.getAttribute('y1') || 0)
        const x2 = parseFloat(element.getAttribute('x2') || 100)
        const y2 = parseFloat(element.getAttribute('y2') || 100)
        return {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        }
      default:
        // Default bounds
        return {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        }
    }
  }

  calculateOffsetDirection(elementBounds, mousePos, domElement) {
    console.log('calculateOffsetDirection called with:', {
      elementBounds,
      mousePos,
      domElement: domElement ? domElement.tagName : 'null',
    })

    if (!domElement) {
      console.error('No DOM element provided for offset calculation')
      return { x: 0, y: -1 } // Default direction
    }

    // Get the element's orientation to determine perpendicular direction
    const elementOrientation = this.getElementOrientation(domElement)

    // Calculate which side of the element the mouse is on
    const mouseRelativePosition = this.getMouseSideRelativeToElement(elementBounds, mousePos, elementOrientation)

    console.log('Offset calculation:')
    console.log(`  Element orientation: ${elementOrientation.type}`)
    console.log(`  Element vector: (${elementOrientation.vector.x}, ${elementOrientation.vector.y})`)
    console.log(`  Mouse side: ${mouseRelativePosition.side}`)
    console.log(`  Perpendicular direction: (${mouseRelativePosition.offsetDirection.x}, ${mouseRelativePosition.offsetDirection.y})`)

    return mouseRelativePosition.offsetDirection
  }

  getElementOrientation(element) {
    if (!element || !element.tagName) {
      console.warn('Element is null or has no tagName, using default horizontal orientation')
      return { type: 'horizontal', vector: { x: 1, y: 0 } }
    }

    const tagName = element.tagName.toLowerCase()
    console.log(`Getting orientation for element: ${tagName}`)

    switch (tagName) {
      case 'line':
        // For lines, get the direction vector
        const x1 = parseFloat(element.getAttribute('x1') || 0)
        const y1 = parseFloat(element.getAttribute('y1') || 0)
        const x2 = parseFloat(element.getAttribute('x2') || 0)
        const y2 = parseFloat(element.getAttribute('y2') || 0)

        console.log(`Line coordinates: (${x1}, ${y1}) to (${x2}, ${y2})`)

        const dx = x2 - x1
        const dy = y2 - y1
        const length = Math.sqrt(dx * dx + dy * dy)

        if (length === 0) {
          console.log('Line has zero length, using default orientation')
          return { type: 'point', vector: { x: 1, y: 0 } }
        }

        const lineVector = { x: dx / length, y: dy / length }
        console.log(`Line vector: (${lineVector.x}, ${lineVector.y})`)

        return {
          type: 'line',
          vector: lineVector,
        }

      case 'rect':
        // For rectangles, assume horizontal orientation (can be enhanced)
        const width = parseFloat(element.getAttribute('width') || 0)
        const height = parseFloat(element.getAttribute('height') || 0)

        console.log(`Rectangle dimensions: ${width} x ${height}`)

        if (width >= height) {
          return { type: 'horizontal', vector: { x: 1, y: 0 } }
        } else {
          return { type: 'vertical', vector: { x: 0, y: 1 } }
        }

      case 'circle':
      case 'ellipse':
        // For circles/ellipses, use radial offset (toward/away from center)
        console.log('Using radial orientation for circle/ellipse')
        return { type: 'radial', vector: { x: 0, y: 0 } }

      case 'path':
        // For paths, try to determine orientation from the path data
        // This is complex, so we'll use a simple heuristic
        const pathData = element.getAttribute('d') || ''
        const isHorizontalPath = this.isPathPrimarilyHorizontal(pathData)

        console.log(`Path orientation: ${isHorizontalPath ? 'horizontal' : 'vertical'}`)

        return {
          type: isHorizontalPath ? 'horizontal' : 'vertical',
          vector: isHorizontalPath ? { x: 1, y: 0 } : { x: 0, y: 1 },
        }

      default:
        // Default to horizontal
        console.log(`Unknown element type ${tagName}, using default horizontal`)
        return { type: 'horizontal', vector: { x: 1, y: 0 } }
    }
  }

  getMouseSideRelativeToElement(elementBounds, mousePos, orientation) {
    const centerX = elementBounds.centerX
    const centerY = elementBounds.centerY

    if (orientation.type === 'radial') {
      // For circles/ellipses, determine if mouse is inside or outside
      const dx = mousePos.x - centerX
      const dy = mousePos.y - centerY
      const distanceFromCenter = Math.sqrt(dx * dx + dy * dy)

      // Get the radius of the circle/ellipse
      const radius = this.getElementRadius(orientation.element)

      console.log(`Mouse distance from center: ${distanceFromCenter}, Element radius: ${radius}`)

      if (distanceFromCenter < radius) {
        // Mouse inside - create smaller circle/rectangle
        return {
          side: 'inside',
          offsetDirection: { x: 0, y: 0, inward: true },
        }
      } else {
        // Mouse outside - create larger circle/rectangle
        return {
          side: 'outside',
          offsetDirection: { x: 0, y: 0, outward: true },
        }
      }
    }

    // For linear elements (lines, paths), offset perpendicular to the element
    const perpVector = {
      x: -orientation.vector.y, // Rotate 90 degrees
      y: orientation.vector.x,
    }

    // Determine which side of the element the mouse is on
    // Project mouse-to-center vector onto perpendicular vector
    const toCenterX = mousePos.x - centerX
    const toCenterY = mousePos.y - centerY

    const projection = toCenterX * perpVector.x + toCenterY * perpVector.y

    let offsetDirection
    let side

    if (projection > 0) {
      // Mouse is on the positive perpendicular side
      offsetDirection = { x: perpVector.x, y: perpVector.y }
      side = 'positive'
    } else {
      // Mouse is on the negative perpendicular side
      offsetDirection = { x: -perpVector.x, y: -perpVector.y }
      side = 'negative'
    }

    return { side, offsetDirection }
  }

  getElementRadius(element) {
    if (!element || !element.tagName) return 50 // default radius

    const tagName = element.tagName.toLowerCase()

    switch (tagName) {
      case 'circle':
        return parseFloat(element.getAttribute('r') || 50)
      case 'ellipse':
        // For ellipse, use average of rx and ry
        const rx = parseFloat(element.getAttribute('rx') || 50)
        const ry = parseFloat(element.getAttribute('ry') || 25)
        return (rx + ry) / 2
      case 'rect':
        // For rectangle, use half the minimum dimension as "radius"
        const width = parseFloat(element.getAttribute('width') || 100)
        const height = parseFloat(element.getAttribute('height') || 100)
        return Math.min(width, height) / 2
      default:
        return 50
    }
  }

  isPathPrimarilyHorizontal(pathData) {
    // Simple heuristic: count horizontal vs vertical movements
    const horizontalCommands = (pathData.match(/[Hh]/g) || []).length
    const verticalCommands = (pathData.match(/[Vv]/g) || []).length

    // Look at line-to commands and estimate direction
    const lineCommands = pathData.match(/[Ll]\s*([+-]?\d*\.?\d+)[,\s]+([+-]?\d*\.?\d+)/g) || []

    let horizontalMovement = 0
    let verticalMovement = 0

    lineCommands.forEach((cmd) => {
      const coords = cmd.match(/([+-]?\d*\.?\d+)/g)
      if (coords && coords.length >= 2) {
        horizontalMovement += Math.abs(parseFloat(coords[0]))
        verticalMovement += Math.abs(parseFloat(coords[1]))
      }
    })

    return horizontalCommands + horizontalMovement > verticalCommands + verticalMovement
  }

  updateGhost() {
    if (!this.selectedElement) return

    // Extract the actual DOM element
    const domElement = this.extractDOMElement(this.selectedElement)
    if (!domElement) {
      console.error('Could not extract DOM element for ghost creation')
      return
    }

    console.log('updateGhost - DOM element extracted:', domElement.tagName, domElement)

    // Remove existing ghost
    this.removeGhost()

    // Calculate offset direction based on mouse position
    const elementBounds = this.getElementBounds(domElement)
    console.log('Element bounds calculated:', elementBounds)

    const offsetDirection = this.calculateOffsetDirection(elementBounds, this.lastMousePosition, domElement)
    console.log('Offset direction calculated:', offsetDirection)

    // Store current direction for consistency
    this.currentDirection = offsetDirection

    // Create ghost element with FIXED offset distance
    this.ghostElement = this.createOffsetGhost(domElement, offsetDirection)
    console.log('Created ghost element with perpendicular offset')

    if (this.ghostElement) {
      // Add ghost to scene with visual styling
      this.styleGhostElement(this.ghostElement)

      // Find the correct SVG container
      const container = this.findSVGContainer()
      if (container) {
        container.appendChild(this.ghostElement)
        console.log('Ghost added to container:', container.tagName, container)
      } else {
        console.error('Could not find suitable SVG container for ghost element')
        return
      }

      // Dispatch ghost created signal
      this.editor.signals.offsetGhostCreated?.dispatch(this.ghostElement)
    }
  }

  createOffsetGhost(originalElement, direction) {
    if (!originalElement) return null

    try {
      // Clone the original element
      const ghost = originalElement.cloneNode(true)

      // Calculate offset position using FIXED distance
      const offsetX = direction.x * this.distance
      const offsetY = direction.y * this.distance

      console.log(`Creating offset ghost:`)
      console.log(`  Distance: ${this.distance}`)
      console.log(`  Direction: (${direction.x.toFixed(3)}, ${direction.y.toFixed(3)})`)
      console.log(`  Calculated offset: (${offsetX.toFixed(3)}, ${offsetY.toFixed(3)})`)

      // Store original position for comparison
      const originalBounds = this.getElementBounds(originalElement)
      console.log(`  Original element center: (${originalBounds.centerX}, ${originalBounds.centerY})`)

      // Apply offset transformation
      this.applyOffsetToElement(ghost, offsetX, offsetY)

      // Verify the offset was applied
      const ghostBounds = this.getElementBounds(ghost)
      console.log(`  Ghost element center: (${ghostBounds.centerX}, ${ghostBounds.centerY})`)
      console.log(
        `  Actual displacement: (${(ghostBounds.centerX - originalBounds.centerX).toFixed(3)}, ${(
          ghostBounds.centerY - originalBounds.centerY
        ).toFixed(3)})`
      )

      return ghost
    } catch (error) {
      console.error('Error creating offset ghost:', error)
      return null
    }
  }

  applyOffsetToElement(element, offsetX, offsetY) {
    console.log(`Applying offset (${offsetX}, ${offsetY}) to element:`, element.tagName)

    // Handle different SVG element types
    switch (element.tagName.toLowerCase()) {
      case 'rect':
        this.offsetRectElement(element, offsetX, offsetY)
        break
      case 'circle':
        this.offsetCircleElement(element, offsetX, offsetY)
        break
      case 'ellipse':
        this.offsetEllipseElement(element, offsetX, offsetY)
        break
      case 'line':
        this.offsetLineElement(element, offsetX, offsetY)
        break
      case 'path':
        this.offsetPathElement(element, offsetX, offsetY)
        break
      case 'polygon':
      case 'polyline':
        this.offsetPolygonElement(element, offsetX, offsetY)
        break
      case 'g':
      case 'use':
      case 'image':
        this.applyTransformOffset(element, offsetX, offsetY)
        break
      default:
        console.warn(`Unsupported element type: ${element.tagName}, using transform offset`)
        this.applyTransformOffset(element, offsetX, offsetY)
    }
  }

  offsetRectElement(element, offsetX, offsetY) {
    const x = parseFloat(element.getAttribute('x') || 0) + offsetX
    const y = parseFloat(element.getAttribute('y') || 0) + offsetY

    element.setAttribute('x', x)
    element.setAttribute('y', y)
    console.log(`Rect offset to: (${x}, ${y})`)
  }

  offsetCircleElement(element, offsetX, offsetY) {
    const cx = parseFloat(element.getAttribute('cx') || 0) + offsetX
    const cy = parseFloat(element.getAttribute('cy') || 0) + offsetY

    element.setAttribute('cx', cx)
    element.setAttribute('cy', cy)
    console.log(`Circle offset to center: (${cx}, ${cy})`)
  }

  offsetEllipseElement(element, offsetX, offsetY) {
    const cx = parseFloat(element.getAttribute('cx') || 0) + offsetX
    const cy = parseFloat(element.getAttribute('cy') || 0) + offsetY

    element.setAttribute('cx', cx)
    element.setAttribute('cy', cy)
    console.log(`Ellipse offset to center: (${cx}, ${cy})`)
  }

  applyTransformOffset(element, offsetX, offsetY) {
    const currentTransform = element.getAttribute('transform') || ''
    const newTransform = `translate(${offsetX}, ${offsetY}) ${currentTransform}`.trim()
    element.setAttribute('transform', newTransform)
  }

  offsetLineElement(element, offsetX, offsetY) {
    const x1 = parseFloat(element.getAttribute('x1') || 0) + offsetX
    const y1 = parseFloat(element.getAttribute('y1') || 0) + offsetY
    const x2 = parseFloat(element.getAttribute('x2') || 0) + offsetX
    const y2 = parseFloat(element.getAttribute('y2') || 0) + offsetY

    element.setAttribute('x1', x1)
    element.setAttribute('y1', y1)
    element.setAttribute('x2', x2)
    element.setAttribute('y2', y2)
  }

  offsetPathElement(element, offsetX, offsetY) {
    // For complex path offsetting, use transform as a simple approach
    // More sophisticated path offsetting would require path parsing and geometric operations
    this.applyTransformOffset(element, offsetX, offsetY)
  }

  offsetPolygonElement(element, offsetX, offsetY) {
    const points = element.getAttribute('points') || ''
    const pointPairs = points.trim().split(/[\s,]+/)

    const offsetPoints = []
    for (let i = 0; i < pointPairs.length; i += 2) {
      const x = parseFloat(pointPairs[i]) + offsetX
      const y = parseFloat(pointPairs[i + 1]) + offsetY
      offsetPoints.push(`${x},${y}`)
    }

    element.setAttribute('points', offsetPoints.join(' '))
  }

  styleGhostElement(ghost) {
    // Apply ghost styling
    ghost.style.opacity = '0.5'
    ghost.style.strokeDasharray = '5,5'
    ghost.setAttribute('stroke', '#888')
    ghost.setAttribute('fill', 'rgba(136, 136, 136, 0.2)')

    // Add ghost class for CSS styling
    ghost.classList.add('offset-ghost')
  }

  confirmOffset() {
    if (!this.selectedElement || !this.ghostElement) return

    // Extract the actual DOM element
    const domElement = this.extractDOMElement(this.selectedElement)
    if (!domElement) {
      console.error('Could not extract DOM element for offset confirmation')
      return
    }

    try {
      // Create the actual offset element
      const offsetElement = this.ghostElement.cloneNode(true)
      console.log('Created offset element:', offsetElement)

      // Clean up ghost styling
      offsetElement.style.opacity = ''
      offsetElement.style.strokeDasharray = ''
      offsetElement.removeAttribute('stroke')
      offsetElement.removeAttribute('fill')
      offsetElement.classList.remove('offset-ghost')

      // Restore original styling or apply default
      this.restoreElementStyling(offsetElement, domElement)

      // Add to the same container as the ghost
      const container = this.findSVGContainer()
      if (container) {
        container.appendChild(offsetElement)
        console.log('Offset element added to scene')
      } else {
        console.error('Could not find container for offset element')
      }

      // Store for undo/redo
      this.storeOffsetOperation(this.selectedElement, offsetElement)

      // Log success
      this.editor.signals.terminalLogged.dispatch({
        msg: `Element offset by ${this.distance}. Select another element or press Esc to exit.`,
      })

      // Clean up current operation
      this.removeGhost()
      this.cleanupPositioning()

      // Prepare for next element selection
      this.startElementSelection()
    } catch (error) {
      console.error('Error confirming offset:', error)
      this.editor.signals.terminalLogged.dispatch({
        msg: 'Error creating offset element.',
      })
    }
  }

  restoreElementStyling(offsetElement, originalElement) {
    // Extract DOM element if wrapped
    const domOriginal = this.extractDOMElement(originalElement) || originalElement

    // Copy styling attributes from original element
    const styleAttributes = ['stroke', 'fill', 'stroke-width', 'opacity', 'class']

    styleAttributes.forEach((attr) => {
      const value = domOriginal.getAttribute && domOriginal.getAttribute(attr)
      if (value) {
        offsetElement.setAttribute(attr, value)
      }
    })
  }

  storeOffsetOperation(originalElement, offsetElement) {
    // Store operation for undo/redo system
    if (!this.offsetOperations) {
      this.offsetOperations = []
    }

    this.offsetOperations.push({
      original: originalElement,
      offset: offsetElement,
      distance: this.distance,
    })
  }

  removeGhost() {
    if (this.ghostElement && this.ghostElement.parentNode) {
      this.ghostElement.parentNode.removeChild(this.ghostElement)
      this.editor.signals.offsetGhostRemoved?.dispatch(this.ghostElement)
    }
    this.ghostElement = null
  }

  cleanupPositioning() {
    this.isPositioning = false
    this.selectedElement = null
    document.removeEventListener('mousemove', this.boundOnMouseMove)
    document.removeEventListener('click', this.boundOnMouseClick)
  }

  onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.cancelCommand()
    }
  }

  cancelCommand() {
    this.editor.signals.terminalLogged.dispatch({ msg: 'Offset command cancelled.' })
    this.cleanup()
  }

  cleanup() {
    // Clear any pending timeouts
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout)
      this.updateTimeout = null
    }

    // Remove all event listeners
    document.removeEventListener('keydown', this.boundOnKeyDown)
    document.removeEventListener('mousemove', this.boundOnMouseMove)
    document.removeEventListener('click', this.boundOnMouseClick)

    // Disconnect from editor signals
    this.editor.signals.toogledSelect.remove(this.boundOnElementSelect)
    this.editor.signals.elementHovered?.remove(this.boundOnElementHover)

    // Clean up ghost
    this.removeGhost()

    // Reset states
    this.isSelectingElement = false
    this.isPositioning = false
    this.selectedElement = null
    this.currentDirection = null
    this.editor.isInteracting = false
    this.editor.selectSingleElement = false

    // Dispatch cleanup signals
    this.editor.signals.rotateGhostingStopped?.dispatch()
    this.editor.signals.offsetCommandEnded?.dispatch()
  }

  undo() {
    if (!this.offsetOperations || this.offsetOperations.length === 0) {
      this.editor.signals.terminalLogged.dispatch({ msg: 'Nothing to undo.' })
      return
    }

    // Remove the last offset element
    const lastOperation = this.offsetOperations.pop()
    if (lastOperation.offset && lastOperation.offset.parentNode) {
      lastOperation.offset.parentNode.removeChild(lastOperation.offset)
    }

    this.editor.signals.terminalLogged.dispatch({
      msg: `Undo: Removed offset element.`,
    })
  }

  redo() {
    // Redo functionality would require storing undone operations
    this.editor.signals.terminalLogged.dispatch({
      msg: 'Redo functionality not implemented for offset operations.',
    })
  }
}

function offsetCommand(editor) {
  const offsetCmd = new OffsetCommand(editor)
  offsetCmd.execute()
  return offsetCmd
}

export { offsetCommand, OffsetCommand }
