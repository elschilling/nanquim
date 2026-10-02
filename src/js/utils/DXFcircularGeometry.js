const MAX_COORDINATE = 1000000000
const MAX_PATH_SEGMENTS = 10000
const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?'
const NUMBER_PATTERN = new RegExp(`^${NUMBER}$`)
const TOKEN_PATTERN = new RegExp(`[a-zA-Z]|${NUMBER}`, 'g')

function bounded(value) {
  return Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE
}

function samePoint(left, right) {
  return left.x === right.x && left.y === right.y
}

// Convert only circular SVG arc segments to DXF bulges. In SVG coordinates a
// positive sweep becomes a negative bulge after the exporter's Y inversion.
function arcBulge(from, to, rx, ry, large, sweep) {
  if (rx <= 0 || ry <= 0 || Math.abs(rx - ry) > Math.max(rx, ry) * 1e-8) return null
  const dx = to.x - from.x
  const dy = to.y - from.y
  const chord = Math.hypot(dx, dy)
  if (!chord) return null
  // SVG expands a radius that is too small to connect the given endpoints.
  const radius = Math.max(rx, chord / 2)
  const offset = Math.sqrt(Math.max(0, radius * radius - chord * chord / 4))
    * (large === sweep ? -1 : 1)
  const cx = (from.x + to.x) / 2 - dy / chord * offset
  const cy = (from.y + to.y) / 2 + dx / chord * offset
  if (!bounded(radius) || !bounded(Math.abs(cx) + radius) || !bounded(Math.abs(cy) + radius)) return null
  const minorAngle = 2 * Math.asin(Math.min(1, chord / (2 * radius)))
  const angle = large ? Math.PI * 2 - minorAngle : minorAngle
  const bulge = (sweep ? -1 : 1) * Math.tan(angle / 4)
  return bounded(bulge) ? bulge : null
}

function circularPathVertices(pathData) {
  if (typeof pathData !== 'string' || pathData.length > 1000000 || !pathData.trim()
    || !/^[\s,0-9+\-.eEmMlLhHvVaAzZ]+$/.test(pathData)) return null
  const tokens = pathData.match(TOKEN_PATTERN)
  if (!tokens || tokens.length > MAX_PATH_SEGMENTS * 8) return null
  let index = 0
  let segmentCount = 0
  let command = null
  let current = { x: 0, y: 0 }
  let closed = false
  let hasArcs = false
  const vertices = []
  const path = []
  const read = () => {
    const token = tokens[index++]
    const value = Number(token)
    return token !== undefined && NUMBER_PATTERN.test(token) && bounded(value) ? value : null
  }
  const append = point => {
    if (!bounded(point.x) || !bounded(point.y)) return false
    if (!vertices.length || !samePoint(current, point)) {
      path.push([vertices.length ? 'L' : 'M', point.x, point.y])
      vertices.push({ ...point, bulge: 0 })
    }
    current = point
    return vertices.length <= MAX_PATH_SEGMENTS
  }

  while (index < tokens.length) {
    if (++segmentCount > MAX_PATH_SEGMENTS) return null
    if (/^[a-zA-Z]$/.test(tokens[index])) command = tokens[index++]
    if (!command || closed) return null
    const upper = command.toUpperCase()
    const relative = command !== upper
    if (!vertices.length && upper !== 'M') return null
    if (upper === 'Z') {
      closed = true
      if (index !== tokens.length) return null
      path.push(['Z'])
      break
    }
    if (upper === 'M' && vertices.length) return null
    if (upper === 'H' || upper === 'V') {
      const value = read()
      if (value === null) return null
      const point = upper === 'H'
        ? { x: value + (relative ? current.x : 0), y: current.y }
        : { x: current.x, y: value + (relative ? current.y : 0) }
      if (!append(point)) return null
      continue
    }
    if (upper === 'A') {
      const values = Array.from({ length: 7 }, read)
      if (values.includes(null)) return null
      const [rx, ry, rotation, large, sweep, x, y] = values
      if (![0, 1].includes(large) || ![0, 1].includes(sweep)) return null
      const to = { x: x + (relative ? current.x : 0), y: y + (relative ? current.y : 0) }
      if (!bounded(to.x) || !bounded(to.y)) return null
      // A zero-radius SVG arc is a line; coincident endpoints render no arc.
      if (rx < 0 || ry < 0) return null
      if (rx === 0 || ry === 0 || samePoint(current, to)) {
        if (!append(to)) return null
        continue
      }
      const bulge = arcBulge(current, to, rx, ry, large, sweep)
      if (bulge === null) return null
      vertices.at(-1).bulge = bulge
      hasArcs = true
      if (!append(to)) return null
      path[path.length - 1] = ['A', rx, ry, rotation, large, sweep, to.x, to.y]
      continue
    }
    if (upper !== 'M' && upper !== 'L') return null
    const x = read(), y = read()
    if (x === null || y === null || !append({ x: x + (relative ? current.x : 0), y: y + (relative ? current.y : 0) })) return null
    if (upper === 'M') command = relative ? 'l' : 'L'
  }

  if (vertices.length < 2) return null
  if (samePoint(vertices[0], vertices.at(-1))) {
    // Explicit return-to-start is closed only if authored with Z. An open
    // loop still requires the duplicated endpoint to retain its final arc.
    if (closed) vertices.pop()
  }
  return vertices.length >= 2 ? { vertices, closed, hasArcs, path } : null
}

function rectangleOutline(rectangle) {
  const read = name => rectangle.node.style?.getPropertyValue(name)?.trim() || rectangle.node.getAttribute(name)
  const geometry = ['x', 'y', 'width', 'height'].map(name => Number(read(name) ?? 0))
  const [x, y, width, height] = geometry
  if (!geometry.every(bounded) || width <= 0 || height <= 0
    || !bounded(x + width) || !bounded(y + height)) return { status: 'invalid' }
  const radius = name => {
    const raw = read(name)?.trim() ?? null
    if (raw === null || raw === '' || raw === 'auto') return { value: null }
    if (!NUMBER_PATTERN.test(raw)) {
      return { status: /^[-+]?(?:\d+\.?\d*|\.\d+)(?:em|ex|px|pt|pc|mm|cm|in|%)$/i.test(raw) ? 'unsupported' : 'invalid' }
    }
    const value = Number(raw)
    return bounded(value) && value >= 0 ? { value } : { status: 'invalid' }
  }
  const rawRx = radius('rx'), rawRy = radius('ry')
  if (rawRx.status || rawRy.status) return { status: rawRx.status || rawRy.status }
  const rx = Math.min(rawRx.value ?? rawRy.value ?? 0, width / 2)
  const ry = Math.min(rawRy.value ?? rawRx.value ?? 0, height / 2)
  if (rx === 0 || ry === 0) return { status: 'square' }
  if (Math.abs(rx - ry) > Math.max(rx, ry) * 1e-8) return { status: 'unsupported' }
  const right = x + width, bottom = y + height
  return {
    status: 'rounded',
    path: `M ${x + rx} ${y} L ${right - rx} ${y} A ${rx} ${ry} 0 0 1 ${right} ${y + ry}`
      + ` L ${right} ${bottom - ry} A ${rx} ${ry} 0 0 1 ${right - rx} ${bottom}`
      + ` L ${x + rx} ${bottom} A ${rx} ${ry} 0 0 1 ${x} ${bottom - ry}`
      + ` L ${x} ${y + ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`,
  }
}

export { circularPathVertices, rectangleOutline }
