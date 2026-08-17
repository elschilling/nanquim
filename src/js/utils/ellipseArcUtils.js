const TAU = Math.PI * 2

function pointOnEllipse(data, theta) {
  return {
    x: data.cx + data.rx * Math.cos(theta),
    y: data.cy + data.ry * Math.sin(theta),
  }
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
    const theta = Math.atan2((point.y - updated.cy) / updated.ry, (point.x - updated.cx) / updated.rx)
    if (vertexIndex === 1) updated.theta1 = theta
    else updated.theta2 = theta
  } else if (vertexIndex === 3) {
    updated.rx = Math.max(1e-3, Math.abs(point.x - updated.cx))
  } else if (vertexIndex === 4) {
    updated.ry = Math.max(1e-3, Math.abs(point.y - updated.cy))
  }
  return normalizeEllipseArcData(updated)
}

function renderEllipseArc(element, data) {
  const normalized = normalizeEllipseArcData(data)
  const sweep = ((normalized.theta2 - normalized.theta1) % TAU + TAU) % TAU
  const largeArcFlag = sweep > Math.PI ? 1 : 0
  element.plot(
    `M ${normalized.startPt.x} ${normalized.startPt.y} A ${normalized.rx} ${normalized.ry} 0 ${largeArcFlag} 1 ${normalized.endPt.x} ${normalized.endPt.y}`
  )
  element.data('ellipseArcData', normalized)
  return normalized
}

export { normalizeEllipseArcData, updateEllipseArcData, renderEllipseArc }
