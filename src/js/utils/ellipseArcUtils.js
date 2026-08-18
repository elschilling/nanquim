const TAU = Math.PI * 2

function pointOnEllipse(data, theta) {
  const rotation = data.rotation || 0
  const cosRotation = Math.cos(rotation)
  const sinRotation = Math.sin(rotation)
  const localX = data.rx * Math.cos(theta)
  const localY = data.ry * Math.sin(theta)
  return {
    x: data.cx + localX * cosRotation - localY * sinRotation,
    y: data.cy + localX * sinRotation + localY * cosRotation,
  }
}

function ellipseArcAngleAtPoint(data, point) {
  const rotation = data.rotation || 0
  const cosRotation = Math.cos(rotation)
  const sinRotation = Math.sin(rotation)
  const dx = point.x - data.cx
  const dy = point.y - data.cy
  const localX = dx * cosRotation + dy * sinRotation
  const localY = -dx * sinRotation + dy * cosRotation
  return Math.atan2(localY / data.ry, localX / data.rx)
}

function normalizeEllipseArcData(data) {
  const normalized = { ...data }
  normalized.startPt = pointOnEllipse(normalized, normalized.theta1)
  normalized.endPt = pointOnEllipse(normalized, normalized.theta2)
  return normalized
}

function updateEllipseArcData(data, vertexIndex, point) {
  const updated = { ...data }
  if (vertexIndex === 0) {
    updated.cx = point.x
    updated.cy = point.y
  } else if (vertexIndex === 1 || vertexIndex === 2) {
    const theta = ellipseArcAngleAtPoint(updated, point)
    if (vertexIndex === 1) updated.theta1 = theta
    else updated.theta2 = theta
  } else if (vertexIndex === 3) {
    const rotation = updated.rotation || 0
    const dx = point.x - updated.cx
    const dy = point.y - updated.cy
    updated.rx = Math.max(1e-3, Math.abs(dx * Math.cos(rotation) + dy * Math.sin(rotation)))
  } else if (vertexIndex === 4) {
    const rotation = updated.rotation || 0
    const dx = point.x - updated.cx
    const dy = point.y - updated.cy
    updated.ry = Math.max(1e-3, Math.abs(-dx * Math.sin(rotation) + dy * Math.cos(rotation)))
  }
  return normalizeEllipseArcData(updated)
}

function renderEllipseArc(element, data) {
  const normalized = normalizeEllipseArcData(data)
  const ccw = normalized.ccw !== false
  const sweep = ccw
    ? ((normalized.theta2 - normalized.theta1) % TAU + TAU) % TAU
    : ((normalized.theta1 - normalized.theta2) % TAU + TAU) % TAU
  const largeArcFlag = sweep > Math.PI ? 1 : 0
  const rotationDegrees = (normalized.rotation || 0) * 180 / Math.PI
  element.plot(
    `M ${normalized.startPt.x} ${normalized.startPt.y} A ${normalized.rx} ${normalized.ry} ${rotationDegrees} ${largeArcFlag} ${ccw ? 1 : 0} ${normalized.endPt.x} ${normalized.endPt.y}`
  )
  element.data('ellipseArcData', normalized)
  return normalized
}

export { normalizeEllipseArcData, updateEllipseArcData, renderEllipseArc, pointOnEllipse, ellipseArcAngleAtPoint }
