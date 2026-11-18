/** Local snap targets for the actual SVG rectangle outline, including fillets. */
export function rectangleSnapPoints(rectangle) {
  const node = rectangle.node
  const x = node.x.baseVal.value
  const y = node.y.baseVal.value
  const width = node.width.baseVal.value
  const height = node.height.baseVal.value
  const right = x + width
  const bottom = y + height
  const point = (x, y) => ({ x, y })
  const radius = name => {
    const raw = node.getAttribute(name)
    if (raw === null || raw === 'auto') return null
    return node[name]?.baseVal?.value ?? Number(raw)
  }
  const rawRx = radius('rx')
  const rawRy = radius('ry')
  // A missing radius takes the other radius; an explicit zero keeps corners
  // square. SVG clamps each used radius to half the corresponding dimension.
  const rx = Math.min(Math.max(0, rawRx ?? rawRy ?? 0), width / 2)
  const ry = Math.min(Math.max(0, rawRy ?? rawRx ?? 0), height / 2)
  const midpoints = [
    point(x + width / 2, y), point(right, y + height / 2),
    point(x + width / 2, bottom), point(x, y + height / 2),
  ]
  if (!rx || !ry) {
    return {
      endpoints: [point(x, y), point(right, y), point(right, bottom), point(x, bottom)],
      midpoints,
    }
  }

  const endpoints = [
    point(x + rx, y), point(right - rx, y),
    point(right, y + ry), point(right, bottom - ry),
    point(right - rx, bottom), point(x + rx, bottom),
    point(x, bottom - ry), point(x, y + ry),
  ]
  // Collapsed straight edges have no midpoint distinct from their arc joins.
  const straightMidpoints = midpoints.filter((_, index) => (
    index % 2 === 0 ? width > 2 * rx : height > 2 * ry
  ))
  if (rx === ry) {
    const offset = rx * Math.SQRT1_2
    straightMidpoints.push(
      point(right - rx + offset, y + ry - offset),
      point(right - rx + offset, bottom - ry + offset),
      point(x + rx - offset, bottom - ry + offset),
      point(x + rx - offset, y + ry - offset),
    )
  }
  return { endpoints, midpoints: straightMidpoints }
}
