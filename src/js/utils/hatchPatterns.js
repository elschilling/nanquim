export const HATCH_PATTERNS = {
  SOLID:  { name: 'Solid',  label: 'Solid fill' },
  ANSI31: { name: 'ANSI31', label: 'Lines 45° (metal)' },
  ANSI32: { name: 'ANSI32', label: 'Crosshatch 45° (steel)' },
  LINE:   { name: 'Line',   label: 'Horizontal lines' },
  CROSS:  { name: 'Cross',  label: 'Grid (horiz + vert)' },
  BRICK:  { name: 'Brick',  label: 'Brick (masonry)' },
  DOTS:   { name: 'Dots',   label: 'Dot stipple' },
  EARTH:  { name: 'Earth',  label: 'Earth / soil' },
}

export function getPatternId(type, colorHex, scale) {
  const safeColor = colorHex.replace('#', '')
  return `hatch-${type.toLowerCase()}-${safeColor}-${scale}`
}

// Ensures an SVG <pattern> exists in svgRoot's <defs> and returns its id.
// Returns null for SOLID (caller handles solid fill directly).
export function ensurePattern(svgRoot, type, colorHex, scale) {
  if (type === 'SOLID') return null

  const id = getPatternId(type, colorHex, scale)
  const defs = svgRoot.defs()

  if (defs.findOne(`#${id}`)) return id

  const s = Number(scale)
  const sw = 0.5  // stroke-width for lines

  // SVG.js doesn't have a first-class .pattern() method on defs,
  // so we create the element via raw DOM and adopt it.
  const ns = 'http://www.w3.org/2000/svg'
  const pat = document.createElementNS(ns, 'pattern')
  pat.setAttribute('id', id)
  pat.setAttribute('patternUnits', 'userSpaceOnUse')

  switch (type) {
    case 'ANSI31': {
      // 45° diagonal lines
      pat.setAttribute('width', s)
      pat.setAttribute('height', s)
      pat.setAttribute('patternTransform', 'rotate(45)')
      const l = document.createElementNS(ns, 'line')
      l.setAttribute('x1', 0); l.setAttribute('y1', 0)
      l.setAttribute('x2', 0); l.setAttribute('y2', s)
      l.setAttribute('stroke', colorHex); l.setAttribute('stroke-width', sw)
      pat.appendChild(l)
      break
    }

    case 'ANSI32': {
      // 45° crosshatch (two families of lines)
      pat.setAttribute('width', s)
      pat.setAttribute('height', s)
      pat.setAttribute('patternTransform', 'rotate(45)')
      const l1 = document.createElementNS(ns, 'line')
      l1.setAttribute('x1', 0); l1.setAttribute('y1', 0)
      l1.setAttribute('x2', 0); l1.setAttribute('y2', s)
      l1.setAttribute('stroke', colorHex); l1.setAttribute('stroke-width', sw)
      const l2 = document.createElementNS(ns, 'line')
      l2.setAttribute('x1', 0); l2.setAttribute('y1', 0)
      l2.setAttribute('x2', s); l2.setAttribute('y2', 0)
      l2.setAttribute('stroke', colorHex); l2.setAttribute('stroke-width', sw)
      pat.appendChild(l1)
      pat.appendChild(l2)
      break
    }

    case 'LINE': {
      // Horizontal lines
      pat.setAttribute('width', s)
      pat.setAttribute('height', s)
      const l = document.createElementNS(ns, 'line')
      l.setAttribute('x1', 0); l.setAttribute('y1', 0)
      l.setAttribute('x2', s); l.setAttribute('y2', 0)
      l.setAttribute('stroke', colorHex); l.setAttribute('stroke-width', sw)
      pat.appendChild(l)
      break
    }

    case 'CROSS': {
      // Horizontal + vertical grid
      pat.setAttribute('width', s)
      pat.setAttribute('height', s)
      const h = document.createElementNS(ns, 'line')
      h.setAttribute('x1', 0); h.setAttribute('y1', 0)
      h.setAttribute('x2', s); h.setAttribute('y2', 0)
      h.setAttribute('stroke', colorHex); h.setAttribute('stroke-width', sw)
      const v = document.createElementNS(ns, 'line')
      v.setAttribute('x1', 0); v.setAttribute('y1', 0)
      v.setAttribute('x2', 0); v.setAttribute('y2', s)
      v.setAttribute('stroke', colorHex); v.setAttribute('stroke-width', sw)
      pat.appendChild(h)
      pat.appendChild(v)
      break
    }

    case 'BRICK': {
      // Staggered brick pattern — tile is 2s × s
      const tw = s * 2
      pat.setAttribute('width', tw)
      pat.setAttribute('height', s)
      // Outer border
      const rect = document.createElementNS(ns, 'rect')
      rect.setAttribute('x', 0); rect.setAttribute('y', 0)
      rect.setAttribute('width', tw); rect.setAttribute('height', s)
      rect.setAttribute('fill', 'none')
      rect.setAttribute('stroke', colorHex); rect.setAttribute('stroke-width', sw)
      // Vertical stagger at mid-tile, only in the top half
      const mid = document.createElementNS(ns, 'line')
      mid.setAttribute('x1', s); mid.setAttribute('y1', 0)
      mid.setAttribute('x2', s); mid.setAttribute('y2', s / 2)
      mid.setAttribute('stroke', colorHex); mid.setAttribute('stroke-width', sw)
      // Horizontal mid-line
      const hline = document.createElementNS(ns, 'line')
      hline.setAttribute('x1', 0); hline.setAttribute('y1', s / 2)
      hline.setAttribute('x2', tw); hline.setAttribute('y2', s / 2)
      hline.setAttribute('stroke', colorHex); hline.setAttribute('stroke-width', sw)
      pat.appendChild(rect)
      pat.appendChild(mid)
      pat.appendChild(hline)
      break
    }

    case 'DOTS': {
      // Dot stipple
      pat.setAttribute('width', s)
      pat.setAttribute('height', s)
      const c = document.createElementNS(ns, 'circle')
      c.setAttribute('cx', s / 2); c.setAttribute('cy', s / 2)
      c.setAttribute('r', Math.max(0.5, s * 0.06))
      c.setAttribute('fill', colorHex)
      pat.appendChild(c)
      break
    }

    case 'EARTH': {
      // Earth / soil — diagonal line + two small dots
      pat.setAttribute('width', s)
      pat.setAttribute('height', s)
      const l = document.createElementNS(ns, 'line')
      l.setAttribute('x1', 0); l.setAttribute('y1', s)
      l.setAttribute('x2', s); l.setAttribute('y2', 0)
      l.setAttribute('stroke', colorHex); l.setAttribute('stroke-width', sw)
      const r = Math.max(0.4, s * 0.05)
      const d1 = document.createElementNS(ns, 'circle')
      d1.setAttribute('cx', s * 0.2); d1.setAttribute('cy', s * 0.2)
      d1.setAttribute('r', r); d1.setAttribute('fill', colorHex)
      const d2 = document.createElementNS(ns, 'circle')
      d2.setAttribute('cx', s * 0.75); d2.setAttribute('cy', s * 0.75)
      d2.setAttribute('r', r); d2.setAttribute('fill', colorHex)
      pat.appendChild(l)
      pat.appendChild(d1)
      pat.appendChild(d2)
      break
    }

    default:
      return null
  }

  defs.node.appendChild(pat)
  return id
}
