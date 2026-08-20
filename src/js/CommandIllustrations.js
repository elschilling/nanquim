const SVG_NS = 'http://www.w3.org/2000/svg'
const VIEW_BOX = '0 0 160 96'

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag)
  Object.entries(attributes).forEach(([name, value]) => {
    if (value !== undefined && value !== null) node.setAttribute(name, String(value))
  })
  return node
}

function addShape(parent, tag, attributes, role = 'result') {
  const node = svgNode(tag, attributes)
  node.classList.add('command-help-illustration-shape', `command-help-illustration-${role}`)
  node.dataset.illustrationRole = role
  parent.appendChild(node)
  return node
}

function drawingTools(svg) {
  const shape = (tag, attributes, role) => addShape(svg, tag, attributes, role)
  const line = (x1, y1, x2, y2, role = 'result', attributes = {}) => shape('line', {
    x1, y1, x2, y2, fill: 'none', stroke: 'currentColor', ...attributes,
  }, role)
  const rect = (x, y, width, height, role = 'result', attributes = {}) => shape('rect', {
    x, y, width, height, rx: 2, fill: 'none', stroke: 'currentColor', ...attributes,
  }, role)
  const circle = (cx, cy, r, role = 'result', attributes = {}) => shape('circle', {
    cx, cy, r, fill: 'none', stroke: 'currentColor', ...attributes,
  }, role)
  const ellipse = (cx, cy, rx, ry, role = 'result', attributes = {}) => shape('ellipse', {
    cx, cy, rx, ry, fill: 'none', stroke: 'currentColor', ...attributes,
  }, role)
  const path = (d, role = 'result', attributes = {}) => shape('path', {
    d, fill: 'none', stroke: 'currentColor', ...attributes,
  }, role)
  const polyline = (points, role = 'result', attributes = {}) => shape('polyline', {
    points, fill: 'none', stroke: 'currentColor', ...attributes,
  }, role)
  const polygon = (points, role = 'result', attributes = {}) => shape('polygon', {
    points, fill: 'none', stroke: 'currentColor', ...attributes,
  }, role)
  const point = (cx, cy, role = 'point', r = 3) => circle(cx, cy, r, role, {
    fill: 'currentColor',
  })
  const label = (x, y, value, role = 'annotation', attributes = {}) => {
    const node = shape('text', { x, y, fill: 'currentColor', stroke: 'none', ...attributes }, role)
    node.textContent = value
    return node
  }
  const arrowHead = (x, y, angle, role = 'annotation') => {
    const size = 7
    const spread = Math.PI / 6
    line(x, y, x - size * Math.cos(angle - spread), y - size * Math.sin(angle - spread), role)
    line(x, y, x - size * Math.cos(angle + spread), y - size * Math.sin(angle + spread), role)
  }
  const arrow = (x1, y1, x2, y2, role = 'annotation', bothEnds = false) => {
    line(x1, y1, x2, y2, role)
    const angle = Math.atan2(y2 - y1, x2 - x1)
    arrowHead(x2, y2, angle, role)
    if (bothEnds) arrowHead(x1, y1, angle + Math.PI, role)
  }

  return { shape, line, rect, circle, ellipse, path, polyline, polygon, point, label, arrow }
}

const drawIllustration = Object.freeze({
  HELP: ({ rect, line, label }) => {
    rect(20, 15, 120, 66, 'surface', { rx: 6 })
    rect(31, 25, 98, 13, 'guide', { rx: 6 })
    line(35, 48, 70, 48, 'source')
    line(35, 57, 103, 57, 'source')
    line(35, 66, 91, 66, 'source')
    label(116, 68, '?', 'result', { 'text-anchor': 'middle' })
  },

  LINE: ({ line, point }) => {
    line(24, 75, 136, 21)
    point(24, 75)
    point(136, 21)
  },

  CIRCLE: ({ circle, line, point }) => {
    circle(80, 48, 31)
    line(80, 48, 108, 34, 'guide')
    point(80, 48)
    point(108, 34)
  },

  ELLIPSE: ({ ellipse, line, point }) => {
    ellipse(80, 48, 49, 27)
    line(31, 48, 129, 48, 'guide')
    line(80, 21, 80, 75, 'guide')
    point(80, 48)
    point(129, 48)
    point(80, 21)
  },

  RECTANGLE: ({ rect, line, point }) => {
    rect(30, 20, 100, 58)
    line(30, 78, 130, 20, 'guide')
    point(30, 78)
    point(130, 20)
  },

  MOVE: ({ rect, arrow }) => {
    rect(20, 39, 40, 32, 'source')
    arrow(61, 55, 98, 55, 'guide')
    rect(100, 23, 40, 32)
  },

  COPY: ({ rect, arrow }) => {
    rect(14, 43, 32, 28, 'source')
    arrow(48, 55, 72, 39, 'guide')
    arrow(48, 59, 102, 67, 'guide')
    rect(75, 19, 32, 28)
    rect(108, 51, 32, 28)
  },

  ROTATE: ({ rect, path, line, point, arrow }) => {
    point(50, 70)
    line(50, 70, 110, 70, 'guide')
    rect(76, 55, 44, 22, 'source')
    path('M 50 70 L 79 19 L 98 30 L 69 81 Z')
    path('M 113 63 A 64 64 0 0 0 89 22', 'guide')
    arrow(97, 27, 89, 22, 'guide')
  },

  SCALE: ({ rect, line, point, arrow }) => {
    point(28, 76)
    rect(28, 44, 45, 32, 'source')
    rect(28, 16, 103, 60)
    line(28, 76, 131, 16, 'guide')
    arrow(75, 48, 116, 24, 'guide')
  },

  OFFSET: ({ path, arrow }) => {
    path('M 22 71 L 66 27 L 116 27', 'source')
    path('M 31 80 L 72 39 L 138 39')
    arrow(86, 27, 86, 39, 'annotation', true)
  },

  FILLET: ({ path, point }) => {
    path('M 22 74 H 80 V 18', 'source')
    path('M 22 74 H 63 Q 80 74 80 57 V 18')
    point(80, 74, 'guide', 2.5)
  },

  MATCH_PROPERTIES: ({ circle, rect, arrow, line }) => {
    circle(38, 48, 23, 'source', { fill: 'currentColor', 'fill-opacity': 0.18 })
    line(21, 38, 55, 58, 'source')
    arrow(65, 48, 94, 48, 'guide')
    rect(102, 26, 39, 44, 'result', { fill: 'currentColor', 'fill-opacity': 0.18 })
    line(106, 38, 137, 58, 'result')
  },

  ERASE: ({ circle, line }) => {
    circle(80, 48, 29, 'deleted')
    line(52, 20, 108, 76, 'annotation')
    line(108, 20, 52, 76, 'annotation')
  },

  EXTEND: ({ line, point }) => {
    line(128, 15, 128, 81, 'boundary')
    line(23, 58, 80, 58, 'source')
    line(80, 58, 128, 58, 'result')
    point(80, 58, 'guide', 2.5)
    point(128, 58)
  },

  TRIM: ({ line, point }) => {
    line(76, 14, 76, 82, 'boundary')
    line(20, 54, 76, 54)
    line(76, 54, 140, 54, 'deleted')
    point(76, 54)
  },

  ARC: ({ path, point, line }) => {
    path('M 27 71 Q 80 10 133 71')
    line(27, 71, 80, 33, 'guide')
    line(80, 33, 133, 71, 'guide')
    point(27, 71)
    point(80, 33)
    point(133, 71)
  },

  DIST: ({ line, point, arrow, label }) => {
    point(27, 66)
    point(133, 29)
    line(27, 66, 133, 29, 'guide')
    arrow(32, 79, 138, 42, 'annotation', true)
    label(80, 43, '112.27', 'annotation', { 'text-anchor': 'middle' })
  },

  MIRROR: ({ line, polygon, arrow }) => {
    line(80, 10, 80, 86, 'guide')
    polygon('21,70 60,70 60,27', 'source')
    arrow(65, 47, 94, 47, 'guide')
    polygon('139,70 100,70 100,27')
  },

  GROUP: ({ rect, circle, line }) => {
    rect(20, 14, 120, 68, 'group', { rx: 5 })
    circle(49, 48, 17)
    rect(76, 29, 38, 38)
    line(32, 72, 128, 22, 'result')
  },

  UNGROUP: ({ rect, circle, arrow }) => {
    rect(38, 24, 84, 48, 'source', { rx: 5 })
    circle(64, 48, 14)
    rect(84, 35, 26, 26)
    arrow(44, 76, 24, 85, 'guide')
    arrow(116, 76, 136, 85, 'guide')
  },

  HATCH: ({ polygon, line, circle }) => {
    polygon('22,76 35,23 126,16 141,70 104,82 57,81', 'boundary', {
      fill: 'currentColor', 'fill-opacity': 0.08,
    })
    ;[
      [30, 70, 65, 25], [46, 80, 92, 20], [67, 81, 116, 17],
      [89, 81, 134, 25], [111, 79, 140, 42],
    ].forEach((segment) => line(...segment, 'fill'))
    circle(91, 50, 10, 'island', { fill: 'var(--command-help-illustration-background, transparent)' })
  },

  TEXT: ({ label, line, point }) => {
    label(38, 64, 'Aa', 'result', { 'font-size': 50, 'font-weight': 600 })
    line(28, 72, 132, 72, 'guide')
    point(32, 72)
  },

  POLYLINE: ({ polyline, point }) => {
    const points = [[18, 68], [47, 29], [77, 61], [106, 23], [140, 55]]
    polyline(points.map((item) => item.join(',')).join(' '))
    points.forEach(([x, y]) => point(x, y))
  },

  SPLINE: ({ path, polyline, point }) => {
    const points = [[20, 66], [49, 25], [83, 64], [113, 22], [140, 54]]
    polyline(points.map((item) => item.join(',')).join(' '), 'guide')
    path('M 20 66 C 34 38 39 25 49 25 S 69 64 83 64 S 99 22 113 22 S 130 46 140 54')
    points.forEach(([x, y]) => point(x, y))
  },

  VIEWPORT: ({ rect, circle, line, label }) => {
    rect(21, 10, 118, 76, 'paper', { rx: 1 })
    rect(35, 22, 90, 48, 'viewport', { rx: 0 })
    circle(58, 45, 12, 'source')
    line(76, 57, 111, 30, 'source')
    label(39, 81, '1:100', 'annotation')
  },

  DIMLINEAR: ({ line, arrow, point, label }) => {
    line(35, 67, 35, 28, 'guide')
    line(125, 67, 125, 28, 'guide')
    line(35, 67, 125, 67, 'source')
    arrow(35, 22, 125, 22, 'annotation', true)
    point(35, 67)
    point(125, 67)
    label(80, 16, '90.00', 'annotation', { 'text-anchor': 'middle' })
  },

  DIMALIGNED: ({ line, arrow, point, label }) => {
    line(34, 70, 119, 38, 'source')
    line(34, 70, 25, 46, 'guide')
    line(119, 38, 110, 14, 'guide')
    arrow(25, 46, 110, 14, 'annotation', true)
    point(34, 70)
    point(119, 38)
    label(67, 22, '90.80', 'annotation', { transform: 'rotate(-21 67 22)', 'text-anchor': 'middle' })
  },

  AREA: ({ polygon, label }) => {
    polygon('27,74 38,23 121,18 139,66 93,81', 'boundary', {
      fill: 'currentColor', 'fill-opacity': 0.16,
    })
    label(82, 56, 'A', 'annotation', { 'text-anchor': 'middle', 'font-size': 28, 'font-weight': 600 })
  },

  BLOCK: ({ rect, circle, line, point, label }) => {
    rect(24, 17, 112, 65, 'group', { rx: 5 })
    circle(54, 48, 17)
    rect(82, 31, 31, 31)
    line(38, 70, 122, 24)
    point(24, 82, 'base-point')
    label(129, 77, 'B', 'annotation', { 'text-anchor': 'middle' })
  },

  INSERT: ({ rect, circle, line, arrow, point }) => {
    rect(12, 31, 45, 36, 'source', { rx: 4 })
    circle(28, 49, 9, 'source')
    line(38, 59, 50, 39, 'source')
    arrow(61, 49, 84, 49, 'guide')
    rect(90, 15, 30, 24)
    circle(101, 27, 6)
    rect(119, 55, 30, 24)
    circle(130, 67, 6)
    point(90, 39, 'base-point', 2.5)
    point(119, 79, 'base-point', 2.5)
  },
})

const COMMAND_ILLUSTRATION_NAMES = Object.freeze(Object.keys(drawIllustration))

function normalizeCommandName(commandName) {
  return String(commandName || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
}

function hasCommandIllustration(commandName) {
  return Object.prototype.hasOwnProperty.call(drawIllustration, normalizeCommandName(commandName))
}

function createCommandIllustration(commandName) {
  const normalizedName = normalizeCommandName(commandName)
  const draw = drawIllustration[normalizedName]
  if (!draw) return null

  const svg = svgNode('svg', {
    viewBox: VIEW_BOX,
    preserveAspectRatio: 'xMidYMid meet',
    'aria-hidden': 'true',
    focusable: 'false',
  })
  svg.classList.add('command-help-illustration', 'command-help-illustration-svg')
  svg.dataset.commandIllustration = normalizedName

  draw(drawingTools(svg))
  return svg
}

export { COMMAND_ILLUSTRATION_NAMES, createCommandIllustration, hasCommandIllustration }
