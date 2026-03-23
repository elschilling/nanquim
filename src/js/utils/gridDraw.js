/**
 * Grid and axis drawing utilities for the SVG viewport.
 */

/**
 * Updates the grid and axis overlay based on the current viewbox.
 */
export function updateGrid(editor, gridGroup, axisGroup, gridSpacing) {
  const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
  if (!activeSvg) return
  const rect = activeSvg.node.getBoundingClientRect()
  const p1 = activeSvg.point(rect.left, rect.top)
  const p2 = activeSvg.point(rect.right, rect.top)
  const p3 = activeSvg.point(rect.left, rect.bottom)
  const p4 = activeSvg.point(rect.right, rect.bottom)

  const xMin = Math.min(p1.x, p2.x, p3.x, p4.x)
  const xMax = Math.max(p1.x, p2.x, p3.x, p4.x)
  const yMin = Math.min(p1.y, p2.y, p3.y, p4.y)
  const yMax = Math.max(p1.y, p2.y, p3.y, p4.y)

  if (isNaN(xMin) || isNaN(yMin) || isNaN(xMax) || isNaN(yMax)) {
    return
  }

  const marginX = (xMax - xMin) * 0.5
  const marginY = (yMax - yMin) * 0.5

  const vb = {
    x: xMin - marginX,
    y: yMin - marginY,
    width: (xMax - xMin) + marginX * 2,
    height: (yMax - yMin) + marginY * 2
  }

  const spacing = gridSpacing

  try {
    const zoom = activeSvg.zoom()
    if (spacing * zoom < 2) {
      gridGroup.clear()
      axisGroup.clear()
      drawAxis(axisGroup, vb)
      return
    }
  } catch (e) {
    console.warn('Grid update failed: activeSvg zoom not available yet')
    return
  }

  gridGroup.clear()
  axisGroup.clear()

  drawGrid(gridGroup, vb, spacing)
  drawAxis(axisGroup, vb)
}

/**
 * Draws the X and Y axes.
 */
export function drawAxis(group, vb) {
  const { x, y, width, height } = vb
  const xMax = x + width
  const yMax = y + height

  if (y <= 0 && yMax >= 0) {
    group.line(x, 0, xMax, 0).addClass('axis x-axis')
  }
  if (x <= 0 && xMax >= 0) {
    group.line(0, y, 0, yMax).addClass('axis y-axis')
  }
}

/**
 * Draws the grid lines.
 */
export function drawGrid(group, vb, spacing) {
  const { x, y, width, height } = vb
  const xMin = x
  const xMax = x + width
  const yMin = y
  const yMax = y + height

  const startX = Math.floor(xMin / spacing) * spacing
  const startY = Math.floor(yMin / spacing) * spacing

  for (let gx = startX; gx <= xMax; gx += spacing) {
    if (Math.abs(gx) > 0.001) {
      group.line(gx, yMin, gx, yMax).addClass('axis')
    }
  }

  for (let gy = startY; gy <= yMax; gy += spacing) {
    if (Math.abs(gy) > 0.001) {
      group.line(xMin, gy, xMax, gy).addClass('axis')
    }
  }
}
