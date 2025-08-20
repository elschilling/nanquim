export function applyOffsetToElement(element, dx, dy) {
  if (!element || !element.type) return
  switch (element.type) {
    case 'line': {
      const pts = element.array().map(([x, y]) => [x + dx, y + dy])
      element.plot(pts)
      break
    }
    case 'circle':
    case 'ellipse': {
      element.center(element.cx() + dx, element.cy() + dy)
      break
    }
    case 'rect': {
      element.move(element.x() + dx, element.y() + dy)
      break
    }
    case 'polygon':
    case 'polyline': {
      const pts = element.array().map(([x, y]) => [x + dx, y + dy])
      element.plot(pts)
      break
    }
    default: {
      const t = element.transform ? element.transform() : {}
      if (element.transform) element.transform(t).translate(dx, dy)
    }
  }
}

export function computeOffsetVector(element, mouse, distance) {
  const normalize = (vx, vy) => {
    const len = Math.hypot(vx, vy) || 1
    return { x: vx / len, y: vy / len }
  }
  const signForPerp = (center, perp) => {
    const toMouseX = mouse.x - center.x
    const toMouseY = mouse.y - center.y
    const proj = toMouseX * perp.x + toMouseY * perp.y
    return proj >= 0 ? 1 : -1
  }
  try {
    if (element.type === 'line') {
      const arr = element.array()
      const [x1, y1] = arr[0]
      const [x2, y2] = arr[1]
      const dir = normalize(x2 - x1, y2 - y1)
      const perp = { x: -dir.y, y: dir.x }
      const center = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }
      const s = signForPerp(center, perp)
      return { dx: perp.x * distance * s, dy: perp.y * distance * s }
    }
    if (element.type === 'rect') {
      const center = { x: element.x() + element.width() / 2, y: element.y() + element.height() / 2 }
      const dxm = mouse.x - center.x
      const dym = mouse.y - center.y
      if (Math.abs(dym) >= Math.abs(dxm)) {
        const s = dym >= 0 ? 1 : -1
        return { dx: 0, dy: distance * s }
      } else {
        const s = dxm >= 0 ? 1 : -1
        return { dx: distance * s, dy: 0 }
      }
    }
    if (element.type === 'circle' || element.type === 'ellipse') {
      const dir = normalize(mouse.x - element.cx(), mouse.y - element.cy())
      return { dx: dir.x * distance, dy: dir.y * distance }
    }
    // Default
    return { dx: 0, dy: distance }
  } catch (e) {
    return { dx: 0, dy: 0 }
  }
}
