function circularMidpoint(from, to, segment) {
  const [, rx, ry, , large, sweep] = segment
  const dx = to.x - from.x
  const dy = to.y - from.y
  const chord = Math.hypot(dx, dy)
  if (chord === 0) return null
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  // SVG renders a zero-radius arc as a straight segment.
  if (rx === 0 || ry === 0) return midpoint
  if (Math.abs(rx - ry) > Math.max(rx, ry) * 1e-8) return null

  // SVG expands an undersized radius to fit the chord. Circular arc rotation
  // does not affect its geometry. The sagitta selects the half-arc point,
  // including major arcs, rather than the midpoint of the straight chord.
  const radius = Math.max(Math.abs(rx), chord / 2)
  const offset = Math.sqrt(Math.max(0, radius * radius - chord * chord / 4))
  const sagitta = large ? radius + offset : chord * chord / (4 * (radius + offset))
  const signedSagitta = sweep ? -sagitta : sagitta
  return {
    x: midpoint.x - dy / chord * signedSagitta,
    y: midpoint.y + dx / chord * signedSagitta,
  }
}

/**
 * Extract exact local targets from SVG.js's absolute path commands. DXF
 * polylines use paths for both straight edges and circular bulges. Other curve
 * types return null so their existing semantic/path-length snapping is kept.
 */
export function polylinePathSnapPoints(segments) {
  if (!segments.length) return null
  const endpoints = []
  const midpoints = []
  let current = null
  let start = null

  for (const segment of segments) {
    const command = segment[0]
    let next
    if (command === 'M') {
      current = { x: segment[1], y: segment[2] }
      start = current
      endpoints.push(current)
      continue
    }
    if (!current) return null
    if (command === 'L') next = { x: segment[1], y: segment[2] }
    else if (command === 'H') next = { x: segment[1], y: current.y }
    else if (command === 'V') next = { x: current.x, y: segment[1] }
    else if (command === 'A') next = { x: segment[6], y: segment[7] }
    else if (command === 'Z') next = start
    else return null

    if (current.x !== next.x || current.y !== next.y) {
      const midpoint = command === 'A'
        ? circularMidpoint(current, next, segment)
        : { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 }
      if (!midpoint) return null
      midpoints.push(midpoint)
      endpoints.push(next)
    }
    current = next
  }
  return { endpoints, midpoints }
}
