import { getArcGeometry, isPointInArc } from './arcUtils'
import { calculateDistance } from './calculateDistance'
import { getPreferences } from '../Preferences'
import { getAllDrawingElements } from '../Collection'
import { pointOnEllipse } from './ellipseArcUtils'

/**
 * Converts a point from SVG world coordinates to screen coordinates.
 */
export function worldToScreen(worldPoint, svgCanvas, ctm) {
  const matrix = ctm || svgCanvas.screenCTM()
  const screenPoint = new SVG.Point(worldPoint).transform(matrix)
  return { x: screenPoint.x, y: screenPoint.y }
}

/**
 * Converts a point expressed in an element's coordinate system to the active
 * SVG's root (viewBox) coordinate system. Rectangles retain their local x/y
 * values when they are rotated or otherwise transformed, so their snap points
 * must be converted before they are compared with the cursor.
 */
function localPointToWorld(el, point, activeSvg, svgScreenCTM) {
  const elementCTM = el.screenCTM()
  const svgCTM = svgScreenCTM || activeSvg.screenCTM()
  if (!elementCTM || !svgCTM) return point

  const screenX = elementCTM.a * point.x + elementCTM.c * point.y + elementCTM.e
  const screenY = elementCTM.b * point.x + elementCTM.d * point.y + elementCTM.f
  const determinant = svgCTM.a * svgCTM.d - svgCTM.b * svgCTM.c
  if (Math.abs(determinant) < 1e-10) return point

  return {
    x: (svgCTM.d * (screenX - svgCTM.e) - svgCTM.c * (screenY - svgCTM.f)) / determinant,
    y: (-svgCTM.b * (screenX - svgCTM.e) + svgCTM.a * (screenY - svgCTM.f)) / determinant,
  }
}

function worldPointToLocal(el, point, activeSvg, svgScreenCTM) {
  const elementCTM = el.screenCTM()
  const svgCTM = svgScreenCTM || activeSvg.screenCTM()
  if (!elementCTM || !svgCTM) return point

  const screenX = svgCTM.a * point.x + svgCTM.c * point.y + svgCTM.e
  const screenY = svgCTM.b * point.x + svgCTM.d * point.y + svgCTM.f
  const determinant = elementCTM.a * elementCTM.d - elementCTM.b * elementCTM.c
  if (Math.abs(determinant) < 1e-10) return point

  return {
    x: (
      elementCTM.d * (screenX - elementCTM.e)
      - elementCTM.c * (screenY - elementCTM.f)
    ) / determinant,
    y: (
      -elementCTM.b * (screenX - elementCTM.e)
      + elementCTM.a * (screenY - elementCTM.f)
    ) / determinant,
  }
}

function getWorldSnapSegments(el, activeSvg, svgScreenCTM) {
  return getSnapSegments(el).map(segment => ({
    p1: localPointToWorld(el, segment.p1, activeSvg, svgScreenCTM),
    p2: localPointToWorld(el, segment.p2, activeSvg, svgScreenCTM),
  }))
}

function getWorldSnapCircles(el, activeSvg, svgScreenCTM) {
  return getSnapCircles(el).flatMap(circle => {
    const center = localPointToWorld(
      el,
      { x: circle.cx, y: circle.cy },
      activeSvg,
      svgScreenCTM,
    )
    const xRadiusPoint = localPointToWorld(
      el,
      { x: circle.cx + circle.r, y: circle.cy },
      activeSvg,
      svgScreenCTM,
    )
    const yRadiusPoint = localPointToWorld(
      el,
      { x: circle.cx, y: circle.cy + circle.r },
      activeSvg,
      svgScreenCTM,
    )
    const rx = Math.hypot(xRadiusPoint.x - center.x, xRadiusPoint.y - center.y)
    const ry = Math.hypot(yRadiusPoint.x - center.x, yRadiusPoint.y - center.y)
    const axisDot = (
      (xRadiusPoint.x - center.x) * (yRadiusPoint.x - center.x)
      + (xRadiusPoint.y - center.y) * (yRadiusPoint.y - center.y)
    )

    // A non-uniform transform turns a circle into an ellipse. The circle-only
    // intersection and tangent solvers would return unsafe targets, so leave
    // those advanced snaps disabled while direct endpoints remain available.
    if (
      Math.abs(rx - ry) > Math.max(rx, ry, 1) * 1e-6
      || Math.abs(axisDot) > Math.max(rx * ry, 1) * 1e-6
    ) return []
    return [{ cx: center.x, cy: center.y, r: (rx + ry) / 2 }]
  })
}

function getWorldArcSnapGeometry(el, activeSvg, svgScreenCTM) {
  const arc = getArcSnapGeometry(el)
  if (!arc) return null

  const center = localPointToWorld(
    el,
    { x: arc.cx, y: arc.cy },
    activeSvg,
    svgScreenCTM,
  )
  const localStart = {
    x: arc.cx + arc.r * Math.cos(arc.theta1),
    y: arc.cy + arc.r * Math.sin(arc.theta1),
  }
  const localEnd = {
    x: arc.cx + arc.r * Math.cos(arc.theta3),
    y: arc.cy + arc.r * Math.sin(arc.theta3),
  }
  const start = localPointToWorld(el, localStart, activeSvg, svgScreenCTM)
  const end = localPointToWorld(el, localEnd, activeSvg, svgScreenCTM)
  const localXAxis = localPointToWorld(
    el,
    { x: arc.cx + arc.r, y: arc.cy },
    activeSvg,
    svgScreenCTM,
  )
  const localYAxis = localPointToWorld(
    el,
    { x: arc.cx, y: arc.cy + arc.r },
    activeSvg,
    svgScreenCTM,
  )
  const xVector = { x: localXAxis.x - center.x, y: localXAxis.y - center.y }
  const yVector = { x: localYAxis.x - center.x, y: localYAxis.y - center.y }
  const rx = Math.hypot(xVector.x, xVector.y)
  const ry = Math.hypot(yVector.x, yVector.y)
  const axisDot = xVector.x * yVector.x + xVector.y * yVector.y
  if (
    Math.abs(rx - ry) > Math.max(rx, ry, 1) * 1e-6
    || Math.abs(axisDot) > Math.max(rx * ry, 1) * 1e-6
  ) return null

  const reversesOrientation = xVector.x * yVector.y - xVector.y * yVector.x < 0
  return {
    cx: center.x,
    cy: center.y,
    r: (rx + ry) / 2,
    theta1: Math.atan2(start.y - center.y, start.x - center.x),
    theta3: Math.atan2(end.y - center.y, end.x - center.x),
    ccw: reversesOrientation ? !arc.ccw : arc.ccw,
  }
}

function getWorldExtensionDirs(el, activeSvg, svgScreenCTM) {
  return [...getLineExtensionDirs(el), ...getArcExtensionDirs(el)].flatMap(({ point, direction }) => {
    const worldPoint = localPointToWorld(el, point, activeSvg, svgScreenCTM)
    const worldDirectionPoint = localPointToWorld(
      el,
      { x: point.x + direction.x, y: point.y + direction.y },
      activeSvg,
      svgScreenCTM,
    )
    const dx = worldDirectionPoint.x - worldPoint.x
    const dy = worldDirectionPoint.y - worldPoint.y
    const length = Math.hypot(dx, dy)
    if (length < 1e-10) return []
    return [{
      point: worldPoint,
      direction: { x: dx / length, y: dy / length },
    }]
  })
}

function getBlockInstanceSnapPoints(el) {
  const points = []
  const x = Number(typeof el.x === 'function' ? el.x() : el.attr('x'))
  const y = Number(typeof el.y === 'function' ? el.y() : el.attr('y'))
  if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y })

  try {
    const bbox = el.node.getBBox()
    if (bbox && [bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite)) {
      points.push(
        { x: bbox.x, y: bbox.y },
        { x: bbox.x + bbox.width, y: bbox.y },
        { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
        { x: bbox.x, y: bbox.y + bbox.height },
      )
    }
  } catch (_) {
    // A detached or unsupported <use> can lack a measurable shadow-tree bbox.
    // Its explicit insertion point remains a safe snap target.
  }

  return points.filter((point, index) => points.findIndex(candidate => (
    Math.abs(candidate.x - point.x) < 1e-10
    && Math.abs(candidate.y - point.y) < 1e-10
  )) === index)
}

const TRANSIENT_SNAP_SELECTOR = [
  '[data-nanquim-transient="true"]',
  '[data-block-ghost="true"]',
  '.ghostLine',
  '.measure-ghost',
  '.measure-ghost-group',
].join(',')

function isTransientSnapCandidate(editor, el) {
  const node = el?.node
  if (!node) return true
  if (editor.ghostNodes?.has(node)) return true
  if (typeof node.matches === 'function' && node.matches(TRANSIENT_SNAP_SELECTOR)) return true
  return typeof node.closest === 'function' && Boolean(node.closest(TRANSIENT_SNAP_SELECTOR))
}

// ---- Geometry extraction helpers ------------------------------------------------

/** Extract line segments from an element (line, rect, polygon, polyline, path) */
export function getSnapSegments(el) {
  if (el.type === 'line') {
    const pts = el.array()
    if (pts.length < 2) return []
    return [{ p1: { x: pts[0][0], y: pts[0][1] }, p2: { x: pts[1][0], y: pts[1][1] } }]
  }
  if (el.type === 'rect') {
    const rx = el.node.x.baseVal.value, ry = el.node.y.baseVal.value
    const rw = el.node.width.baseVal.value, rh = el.node.height.baseVal.value
    const c = (x, y) => ({ x, y })
    return [
      { p1: c(rx, ry),        p2: c(rx + rw, ry) },
      { p1: c(rx + rw, ry),   p2: c(rx + rw, ry + rh) },
      { p1: c(rx + rw, ry + rh), p2: c(rx, ry + rh) },
      { p1: c(rx, ry + rh),  p2: c(rx, ry) },
    ]
  }
  if (el.type === 'polygon' || el.type === 'polyline') {
    const pts = el.array()
    const segs = []
    for (let i = 0; i < pts.length - 1; i++) {
      segs.push({ p1: { x: pts[i][0], y: pts[i][1] }, p2: { x: pts[i + 1][0], y: pts[i + 1][1] } })
    }
    if (el.type === 'polygon' && pts.length > 2) {
      segs.push({ p1: { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] }, p2: { x: pts[0][0], y: pts[0][1] } })
    }
    return segs
  }
  if (el.type === 'path' && !el.data('arcData')) {
    // Extract only explicit linear segments (L, H, V, Z) for intersection detection
    const segs = []
    let cx = 0, cy = 0, subX = 0, subY = 0
    for (const seg of el.array()) {
      const cmd = seg[0]
      if (cmd === 'M') { cx = seg[1]; cy = seg[2]; subX = cx; subY = cy }
      else if (cmd === 'L') { segs.push({ p1: { x: cx, y: cy }, p2: { x: seg[1], y: seg[2] } }); cx = seg[1]; cy = seg[2] }
      else if (cmd === 'H') { segs.push({ p1: { x: cx, y: cy }, p2: { x: seg[1], y: cy } }); cx = seg[1] }
      else if (cmd === 'V') { segs.push({ p1: { x: cx, y: cy }, p2: { x: cx, y: seg[1] } }); cy = seg[1] }
      else if (cmd === 'C') { cx = seg[5]; cy = seg[6] }
      else if (cmd === 'Q') { cx = seg[3]; cy = seg[4] }
      else if (cmd === 'A') { cx = seg[6]; cy = seg[7] }
      else if (cmd === 'Z') { segs.push({ p1: { x: cx, y: cy }, p2: { x: subX, y: subY } }); cx = subX; cy = subY }
    }
    return segs
  }
  return []
}

/** Extract circles (center + radius) from an element (circle, arc path) */
export function getSnapCircles(el) {
  if (el.type === 'circle') {
    return [{ cx: el.node.cx.baseVal.value, cy: el.node.cy.baseVal.value, r: el.node.r.baseVal.value }]
  }
  if (el.type === 'path' && el.data('arcData')) {
    const ad = el.data('arcData')
    if (ad.cx !== undefined && ad.r !== undefined) {
      return [{ cx: ad.cx, cy: ad.cy, r: ad.r }]
    }
    const geo = getArcGeometry(ad.p1, ad.p2, ad.p3)
    if (geo) return [{ cx: geo.cx, cy: geo.cy, r: geo.radius }]
  }
  return []
}

// ---- Intersection geometry solvers -----------------------------------------------

/** Line-line intersection (infinite lines). Returns null if parallel. */
export function lineLineIntersectPt(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-10) return null
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom
  return { x: p1.x + t * d1x, y: p1.y + t * d1y }
}

/** Line-circle intersections (infinite line). Returns 0, 1, or 2 points. */
export function lineCircleIntersectPts(p1, p2, cx, cy, r) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y
  const fx = p1.x - cx, fy = p1.y - cy
  const a = dx * dx + dy * dy
  if (a < 1e-10) return []
  const b = 2 * (fx * dx + fy * dy)
  const c = fx * fx + fy * fy - r * r
  const disc = b * b - 4 * a * c
  if (disc < 0) return []
  const sqrtD = Math.sqrt(disc)
  const t1 = (-b - sqrtD) / (2 * a)
  const t2 = (-b + sqrtD) / (2 * a)
  const pts = [{ x: p1.x + t1 * dx, y: p1.y + t1 * dy }]
  if (sqrtD > 1e-10) pts.push({ x: p1.x + t2 * dx, y: p1.y + t2 * dy })
  return pts
}

/** Circle-circle intersections. Returns 0, 1, or 2 points. */
export function circleCircleIntersectPts(ca, cb) {
  const dx = cb.cx - ca.cx, dy = cb.cy - ca.cy
  const d = Math.hypot(dx, dy)
  if (d < 1e-10 || d > ca.r + cb.r + 1e-10 || d < Math.abs(ca.r - cb.r) - 1e-10) return []
  const a = (ca.r * ca.r - cb.r * cb.r + d * d) / (2 * d)
  const h2 = ca.r * ca.r - a * a
  if (h2 < 0) return []
  const h = Math.sqrt(h2)
  const mx = ca.cx + a * dx / d, my = ca.cy + a * dy / d
  if (h < 1e-10) return [{ x: mx, y: my }]
  return [
    { x: mx + h * dy / d, y: my - h * dx / d },
    { x: mx - h * dy / d, y: my + h * dx / d },
  ]
}

/** Tangent points from an external point to a circle. Returns 0, 1, or 2 points. */
export function tangentPtsFromPointToCircle(from, cx, cy, r) {
  const vx = from.x - cx
  const vy = from.y - cy
  const d2 = vx * vx + vy * vy
  const r2 = r * r
  if (d2 < r2 - 1e-10 || d2 < 1e-10) return []

  if (Math.abs(d2 - r2) < 1e-10) {
    return [{ x: from.x, y: from.y }]
  }

  const offsetScale = r * Math.sqrt(d2 - r2) / d2
  const baseScale = r2 / d2
  const bx = cx + baseScale * vx
  const by = cy + baseScale * vy
  const ox = -vy * offsetScale
  const oy = vx * offsetScale

  return [
    { x: bx + ox, y: by + oy },
    { x: bx - ox, y: by - oy },
  ]
}

function getArcSnapGeometry(el) {
  if (el.type !== 'path') return null

  const circleTrimData = el.data('circleTrimData')
  if (circleTrimData) {
    return {
      cx: circleTrimData.cx,
      cy: circleTrimData.cy,
      r: circleTrimData.r,
      theta1: circleTrimData.theta2,
      theta3: circleTrimData.theta1,
      ccw: true,
    }
  }

  const arcData = el.data('arcData')
  if (!arcData) return null
  const geo = getArcGeometry(arcData.p1, arcData.p2, arcData.p3)
  if (!geo) return null

  return {
    cx: arcData.cx !== undefined ? arcData.cx : geo.cx,
    cy: arcData.cx !== undefined ? arcData.cy : geo.cy,
    r: arcData.r !== undefined ? arcData.r : geo.radius,
    theta1: geo.theta1,
    theta3: geo.theta3,
    ccw: geo.ccw,
  }
}

function getEditingVertexSnapBase(editor, activeSvg, svgScreenCTM) {
  if (!editor.isEditingVertex || !editor.editingVertices || editor.editingVertices.length === 0) return null

  const lineVertex = editor.editingVertices.find(v => v.element && v.element.type === 'line')
  if (!lineVertex) return null

  const line = lineVertex.element
  if (lineVertex.vertexIndex === 0) {
    return localPointToWorld(
      line,
      { x: line.node.x2.baseVal.value, y: line.node.y2.baseVal.value },
      activeSvg,
      svgScreenCTM,
    )
  }
  if (lineVertex.vertexIndex === 1) {
    return localPointToWorld(
      line,
      { x: line.node.x1.baseVal.value, y: line.node.y1.baseVal.value },
      activeSvg,
      svgScreenCTM,
    )
  }
  return null
}

function getSnapBasePoint(editor, activeSvg, svgScreenCTM) {
  return getEditingVertexSnapBase(editor, activeSvg, svgScreenCTM) || editor.lastClick
}

// ---- Extension snap helpers -----------------------------------------------------

/** Returns extension directions for each endpoint of a line element. */
function getLineExtensionDirs(el) {
  if (el.type !== 'line') return []
  const pts = el.array()
  if (pts.length < 2) return []
  const p1 = { x: pts[0][0], y: pts[0][1] }
  const p2 = { x: pts[1][0], y: pts[1][1] }
  const dx = p2.x - p1.x, dy = p2.y - p1.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-10) return []
  return [
    { point: p1, direction: { x: -dx / len, y: -dy / len } },
    { point: p2, direction: { x:  dx / len, y:  dy / len } },
  ]
}

/** Returns extension tangent directions for each endpoint of an arc element. */
function getArcExtensionDirs(el) {
  if (el.type !== 'path' || !el.data('arcData')) return []
  const arcData = el.data('arcData')
  const p1 = arcData.p1, p3 = arcData.p3
  if (!p1 || !p3) return []

  let cx, cy, ccw
  if (arcData.cx !== undefined) {
    cx = arcData.cx; cy = arcData.cy
    const geo = getArcGeometry(arcData.p1, arcData.p2, arcData.p3)
    ccw = geo ? geo.ccw : true
  } else {
    const geo = getArcGeometry(arcData.p1, arcData.p2, arcData.p3)
    if (!geo) return []
    cx = geo.cx; cy = geo.cy; ccw = geo.ccw
  }

  const r1x = p1.x - cx, r1y = p1.y - cy
  const r3x = p3.x - cx, r3y = p3.y - cy
  const len1 = Math.hypot(r1x, r1y)
  const len3 = Math.hypot(r3x, r3y)
  if (len1 < 1e-10 || len3 < 1e-10) return []

  // Tangent extension direction: for CCW arc, rotate radius 90° CW at start,
  // 90° CCW at end. For CW arc, opposite.
  const sign = ccw ? 1 : -1
  return [
    { point: p1, direction: { x:  sign * r1y / len1, y: -sign * r1x / len1 } },
    { point: p3, direction: { x: -sign * r3y / len3, y:  sign * r3x / len3 } },
  ]
}

// ---- Main snap check function ---------------------------------------------------

/**
 * Finds snap candidates near the cursor and returns the closest tagged target.
 * @param {object} screenCoords - Cursor position in screen pixels { x, y }
 * @param {object} editor - The editor instance
 * @param {SVG.Svg} activeSvg - Active SVG canvas
 * @param {number} snapTolerance - Snap tolerance in screen pixels
 * @returns {{ worldPoint: object, snapType: string } | null}
 */
export function checkSnap(screenCoords, editor, activeSvg, snapTolerance) {
  const vb = activeSvg.viewbox()
  const svgWidth = activeSvg.node.clientWidth || activeSvg.node.getBoundingClientRect().width || 1
  const worldPerPixel = vb.width / svgWidth
  const snapWorldRadius = snapTolerance * worldPerPixel
  const cursorWorld = activeSvg.point(screenCoords.x, screenCoords.y)
  // Cache the screen CTM once — reused by every worldToScreen call this frame
  const ctm = activeSvg.screenCTM()

  const useFullIndex = editor.snapExcludeNonSelectable === false
  const snapIndex = useFullIndex ? editor.fullSpatialIndex : editor.spatialIndex
  snapIndex.ensureFresh(editor, useFullIndex ? getAllDrawingElements : undefined)
  const nearbyCandidates = snapIndex.search({
    minX: cursorWorld.x - snapWorldRadius,
    minY: cursorWorld.y - snapWorldRadius,
    maxX: cursorWorld.x + snapWorldRadius,
    maxY: cursorWorld.y + snapWorldRadius,
  })

  let snapCandidates = nearbyCandidates
    .map(item => item.element)
    .filter(el => !isTransientSnapCandidate(editor, el))
  if (editor.isDrawing) {
    snapCandidates = snapCandidates.filter(el =>
      (el.attr('id') !== undefined && el.attr('id') !== null) || el.data('ellipseArcData')
    )
  }
  if (editor.isEditingVertex && editor.editingVertices.length > 0) {
    const editingNodes = editor.editingVertices.map(v => v.element.node)
    snapCandidates = snapCandidates.filter(el => !editingNodes.includes(el.node))
  }
  const st = editor.snapTypes || {}
  const taggedTargets = []
  const pushWorldTarget = (point, snapType) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return
    taggedTargets.push({ screenPoint: worldToScreen(point, activeSvg, ctm), snapType })
  }
  const pushLocalTarget = (el, point, snapType) => {
    pushWorldTarget(localPointToWorld(el, point, activeSvg, ctm), snapType)
  }

  snapCandidates.forEach((el) => {
    if (el.type === 'line') {
      const pts = el.array()
      if (st.endpoint) {
        pts.forEach((pointArr) => {
          pushLocalTarget(el, { x: pointArr[0], y: pointArr[1] }, 'endpoint')
        })
      }
      if (st.midpoint && pts.length >= 2) {
        const mx = (pts[0][0] + pts[1][0]) / 2
        const my = (pts[0][1] + pts[1][1]) / 2
        pushLocalTarget(el, { x: mx, y: my }, 'midpoint')
      }
      if (st.nearest && pts.length >= 2) {
        const p1 = localPointToWorld(el, { x: pts[0][0], y: pts[0][1] }, activeSvg, ctm)
        const p2 = localPointToWorld(el, { x: pts[1][0], y: pts[1][1] }, activeSvg, ctm)
        const dx = p2.x - p1.x, dy = p2.y - p1.y
        const len2 = dx * dx + dy * dy
        if (len2 > 0) {
          let t = ((cursorWorld.x - p1.x) * dx + (cursorWorld.y - p1.y) * dy) / len2
          t = Math.max(0, Math.min(1, t))
          pushWorldTarget({ x: p1.x + t * dx, y: p1.y + t * dy }, 'nearest')
        }
      }
    } else if (el.type === 'circle') {
      const cx = el.node.cx.baseVal.value
      const cy = el.node.cy.baseVal.value
      const r = el.node.r.baseVal.value
      if (st.center) {
        pushLocalTarget(el, { x: cx, y: cy }, 'center')
      }
      if (st.quadrant) {
        pushLocalTarget(el, { x: cx, y: cy - r }, 'quadrant')
        pushLocalTarget(el, { x: cx + r, y: cy }, 'quadrant')
        pushLocalTarget(el, { x: cx, y: cy + r }, 'quadrant')
        pushLocalTarget(el, { x: cx - r, y: cy }, 'quadrant')
      }
      if (st.nearest) {
        let nearestPoint = null
        let nearestDistance = Infinity
        for (let index = 0; index < 64; index += 1) {
          const theta = (index / 64) * Math.PI * 2
          const point = localPointToWorld(
            el,
            { x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r },
            activeSvg,
            ctm,
          )
          const distance = Math.hypot(point.x - cursorWorld.x, point.y - cursorWorld.y)
          if (distance < nearestDistance) {
            nearestDistance = distance
            nearestPoint = point
          }
        }
        if (nearestPoint) pushWorldTarget(nearestPoint, 'nearest')
      }
    } else if (el.type === 'ellipse') {
      const cx = el.node.cx.baseVal.value
      const cy = el.node.cy.baseVal.value
      const rx = el.node.rx.baseVal.value
      const ry = el.node.ry.baseVal.value
      if (st.center) {
        pushLocalTarget(el, { x: cx, y: cy }, 'center')
      }
      if (st.quadrant) {
        ;[
          { x: cx + rx, y: cy }, { x: cx, y: cy + ry },
          { x: cx - rx, y: cy }, { x: cx, y: cy - ry },
        ].forEach(point => {
          pushLocalTarget(el, point, 'quadrant')
        })
      }
    } else if (el.type === 'rect') {
      const rx = el.node.x.baseVal.value
      const ry = el.node.y.baseVal.value
      const rw = el.node.width.baseVal.value
      const rh = el.node.height.baseVal.value
      const rectPoints = {
        topLeft: { x: rx, y: ry },
        topRight: { x: rx + rw, y: ry },
        bottomRight: { x: rx + rw, y: ry + rh },
        bottomLeft: { x: rx, y: ry + rh },
        topMidpoint: { x: rx + rw / 2, y: ry },
        rightMidpoint: { x: rx + rw, y: ry + rh / 2 },
        bottomMidpoint: { x: rx + rw / 2, y: ry + rh },
        leftMidpoint: { x: rx, y: ry + rh / 2 },
      }
      Object.keys(rectPoints).forEach(key => {
        rectPoints[key] = localPointToWorld(el, rectPoints[key], activeSvg, ctm)
      })
      if (st.endpoint) {
        ;['topLeft', 'topRight', 'bottomRight', 'bottomLeft'].forEach(key => {
          pushWorldTarget(rectPoints[key], 'endpoint')
        })
      }
      if (st.midpoint) {
        ;['topMidpoint', 'rightMidpoint', 'bottomMidpoint', 'leftMidpoint'].forEach(key => {
          pushWorldTarget(rectPoints[key], 'midpoint')
        })
      }
    } else if (el.type === 'path' && el.data('arcData')) {
      const arcData = el.data('arcData')
      if (st.endpoint) {
        pushLocalTarget(el, arcData.p1, 'endpoint')
        pushLocalTarget(el, arcData.p3, 'endpoint')
      }
      if (st.midpoint) {
        pushLocalTarget(el, arcData.p2, 'midpoint')
      }
      if (st.center) {
        if (arcData.cx !== undefined) {
          pushLocalTarget(el, { x: arcData.cx, y: arcData.cy }, 'center')
        } else {
          const geo = getArcGeometry(arcData.p1, arcData.p2, arcData.p3)
          if (geo) pushLocalTarget(el, { x: geo.cx, y: geo.cy }, 'center')
        }
      }
    } else if (el.type === 'polygon' || el.type === 'polyline') {
      const pts = el.array()
      if (st.endpoint) {
        pts.forEach((pointArr) => {
          pushLocalTarget(el, { x: pointArr[0], y: pointArr[1] }, 'endpoint')
        })
      }
      if (st.midpoint) {
        for (let i = 0; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2
          const my = (pts[i][1] + pts[i + 1][1]) / 2
          pushLocalTarget(el, { x: mx, y: my }, 'midpoint')
        }
      }
    } else if (el.type === 'use' && el.attr('data-block-instance') === 'true') {
      if (st.endpoint) {
        // Block internals live in a referenced shadow tree and are not safe to
        // traverse as editable instance geometry. Qualify the stable insertion
        // point and the measurable instance bbox corners as endpoint targets.
        getBlockInstanceSnapPoints(el).forEach(point => {
          pushLocalTarget(el, point, 'endpoint')
        })
      }
    } else if (el.type === 'path' && !el.data('arcData')) {
      const node = el.node
      if (!node.getTotalLength) return
      const totalLength = node.getTotalLength()
      if (totalLength <= 0) return
      const ptAt = len => { const p = node.getPointAtLength(len); return { x: p.x, y: p.y } }
      const splineData = el.data('splineData')
      const ellipseArcData = el.data('ellipseArcData')

      if (ellipseArcData && st.center) {
        pushLocalTarget(el, { x: ellipseArcData.cx, y: ellipseArcData.cy }, 'center')
      }

      if (ellipseArcData && st.quadrant) {
        const arcCcw = ellipseArcData.ccw !== false
        const arcSpan = arcCcw
          ? (ellipseArcData.theta2 - ellipseArcData.theta1 + Math.PI * 2) % (Math.PI * 2)
          : (ellipseArcData.theta1 - ellipseArcData.theta2 + Math.PI * 2) % (Math.PI * 2)
        const isOnArc = (theta) => {
          const distanceFromStart = arcCcw
            ? (theta - ellipseArcData.theta1 + Math.PI * 2) % (Math.PI * 2)
            : (ellipseArcData.theta1 - theta + Math.PI * 2) % (Math.PI * 2)
          return distanceFromStart <= arcSpan + 1e-4
        }
        ;[0, Math.PI / 2, Math.PI, Math.PI * 1.5]
          .map(theta => ({ theta, ...pointOnEllipse(ellipseArcData, theta) }))
          .filter(point => isOnArc(point.theta)).forEach(point => {
          pushLocalTarget(el, point, 'quadrant')
        })
      }

      if (st.endpoint) {
        if (ellipseArcData) {
          pushLocalTarget(el, ellipseArcData.startPt, 'endpoint')
          pushLocalTarget(el, ellipseArcData.endPt, 'endpoint')
        } else if (splineData) {
          splineData.points.forEach(sp => {
            pushLocalTarget(el, sp, 'endpoint')
          })
        } else {
          pushLocalTarget(el, ptAt(0), 'endpoint')
          pushLocalTarget(el, ptAt(totalLength), 'endpoint')
        }
      }

      if (st.midpoint) {
        pushLocalTarget(el, ptAt(totalLength / 2), 'midpoint')
      }

      if (st.nearest) {
        const samples = Math.max(16, Math.ceil(totalLength / 10))
        let minDist = Infinity
        let nearestPt = null
        for (let i = 0; i <= samples; i++) {
          const pt = localPointToWorld(
            el,
            ptAt((i / samples) * totalLength),
            activeSvg,
            ctm,
          )
          const d = Math.hypot(pt.x - cursorWorld.x, pt.y - cursorWorld.y)
          if (d < snapWorldRadius && d < minDist) {
            minDist = d
            nearestPt = pt
          }
        }
        if (nearestPt) {
          pushWorldTarget(nearestPt, 'nearest')
        }
      }
    }
  })

  // ---- INTERSECTION SNAP ----
  if (st.intersection && snapCandidates.length > 1) {
    const intCandidates = snapCandidates.length > 8 ? snapCandidates.slice(0, 8) : snapCandidates
    for (let i = 0; i < intCandidates.length; i++) {
      for (let j = i + 1; j < intCandidates.length; j++) {
        const elA = intCandidates[i], elB = intCandidates[j]
        const segsA = getWorldSnapSegments(elA, activeSvg, ctm)
        const segsB = getWorldSnapSegments(elB, activeSvg, ctm)
        const cirsA = getWorldSnapCircles(elA, activeSvg, ctm)
        const cirsB = getWorldSnapCircles(elB, activeSvg, ctm)

        const pushPt = pt => {
          if (pt) pushWorldTarget(pt, 'intersection')
        }

        // line-line
        segsA.forEach(sa => segsB.forEach(sb => pushPt(lineLineIntersectPt(sa.p1, sa.p2, sb.p1, sb.p2))))

        // line-circle / line-arc
        segsA.forEach(sa => cirsB.forEach(cb => lineCircleIntersectPts(sa.p1, sa.p2, cb.cx, cb.cy, cb.r).forEach(pushPt)))
        segsB.forEach(sb => cirsA.forEach(ca => lineCircleIntersectPts(sb.p1, sb.p2, ca.cx, ca.cy, ca.r).forEach(pushPt)))

        // circle-circle / circle-arc / arc-arc
        cirsA.forEach(ca => cirsB.forEach(cb => circleCircleIntersectPts(ca, cb).forEach(pushPt)))
      }
    }
  }

  // ---- PERPENDICULAR SNAP ----
  // Requires a base point: finds the foot where a line FROM the active base TO the element is perpendicular.
  const snapBasePoint = getSnapBasePoint(editor, activeSvg, ctm)
  if (st.perpendicular && snapBasePoint) {
    const from = snapBasePoint
    const pushPerp = pt => pushWorldTarget(pt, 'perpendicular')

    snapCandidates.forEach(el => {
      if (el.type === 'line') {
        const segment = getWorldSnapSegments(el, activeSvg, ctm)[0]
        if (!segment) return
        const { p1, p2 } = segment
        const dx = p2.x - p1.x, dy = p2.y - p1.y
        const len2 = dx * dx + dy * dy
        if (len2 < 1e-10) return
        const t = ((from.x - p1.x) * dx + (from.y - p1.y) * dy) / len2
        if (t >= -0.1 && t <= 1.1) {
          pushPerp({ x: p1.x + t * dx, y: p1.y + t * dy })
        }

      } else if (el.type === 'circle') {
        getWorldSnapCircles(el, activeSvg, ctm).forEach(({ cx, cy, r }) => {
          const dx = from.x - cx, dy = from.y - cy
          const dist = Math.hypot(dx, dy)
          if (dist < 1e-10) return
          // Both intersections of the from→center line with the circle
          pushPerp({ x: cx + (dx / dist) * r, y: cy + (dy / dist) * r })
          pushPerp({ x: cx - (dx / dist) * r, y: cy - (dy / dist) * r })
        })

      } else if (el.type === 'ellipse') {
        const cx = el.node.cx.baseVal.value, cy = el.node.cy.baseVal.value
        const rx = el.node.rx.baseVal.value, ry = el.node.ry.baseVal.value
        const localFrom = worldPointToLocal(el, from, activeSvg, ctm)
        const dx = localFrom.x - cx, dy = localFrom.y - cy
        if (Math.hypot(dx, dy) > 1e-10) {
          const len = Math.hypot(dx / rx, dy / ry)
          if (len > 1e-10) {
            pushLocalTarget(el, { x: cx + (dx / rx / len) * rx, y: cy + (dy / ry / len) * ry }, 'perpendicular')
            pushLocalTarget(el, { x: cx - (dx / rx / len) * rx, y: cy - (dy / ry / len) * ry }, 'perpendicular')
          }
        }

      } else if (el.type === 'path' && el.data('arcData')) {
        const arc = getWorldArcSnapGeometry(el, activeSvg, ctm)
        if (!arc) return
        const dx = from.x - arc.cx, dy = from.y - arc.cy
        const dist = Math.hypot(dx, dy)
        if (dist < 1e-10) return
        for (const sign of [1, -1]) {
          const foot = {
            x: arc.cx + sign * (dx / dist) * arc.r,
            y: arc.cy + sign * (dy / dist) * arc.r,
          }
          if (isPointInArc(foot, arc.cx, arc.cy, arc.theta1, arc.theta3, arc.ccw)) {
            pushPerp(foot)
          }
        }

      } else if (el.type === 'rect') {
        getWorldSnapSegments(el, activeSvg, ctm).forEach(({ p1, p2 }) => {
          const dx = p2.x - p1.x, dy = p2.y - p1.y
          const len2 = dx * dx + dy * dy
          if (len2 < 1e-10) return
          const t = Math.max(0, Math.min(1, ((from.x - p1.x) * dx + (from.y - p1.y) * dy) / len2))
          pushPerp({ x: p1.x + t * dx, y: p1.y + t * dy })
        })

      } else if (el.type === 'polygon' || el.type === 'polyline') {
        getWorldSnapSegments(el, activeSvg, ctm).forEach(({ p1, p2 }) => {
          const dx = p2.x - p1.x, dy = p2.y - p1.y
          const len2 = dx * dx + dy * dy
          if (len2 < 1e-10) return
          const t = Math.max(0, Math.min(1, ((from.x - p1.x) * dx + (from.y - p1.y) * dy) / len2))
          pushPerp({ x: p1.x + t * dx, y: p1.y + t * dy })
        })
      }
    })
  }

  // ---- TANGENT SNAP ----
  // Requires a base point: finds the point(s) on a circle/arc where a line
  // FROM the active base TO the element is tangent.
  if (st.tangent && snapBasePoint) {
    const from = snapBasePoint
    const pushTangent = pt => pushWorldTarget(pt, 'tangent')

    snapCandidates.forEach(el => {
      if (el.type === 'circle') {
        getWorldSnapCircles(el, activeSvg, ctm).forEach(circle => {
          tangentPtsFromPointToCircle(from, circle.cx, circle.cy, circle.r)
            .forEach(pushTangent)
        })
      } else if (el.type === 'path' && (el.data('arcData') || el.data('circleTrimData'))) {
        const arc = getWorldArcSnapGeometry(el, activeSvg, ctm)
        if (!arc) return
        tangentPtsFromPointToCircle(from, arc.cx, arc.cy, arc.r)
          .filter(point => isPointInArc(
            point,
            arc.cx,
            arc.cy,
            arc.theta1,
            arc.theta3,
            arc.ccw,
          ))
          .forEach(pushTangent)
      }
    })
  }

  // ---- EXTENSION SNAP ----
  if (st.extension) {
    if (!editor.extensionHovers) editor.extensionHovers = []

    // Phase A: register new endpoint hovers when cursor is near an endpoint
    const extEndpointRadius = snapWorldRadius * 1.5
    snapCandidates.forEach(el => {
      const dirs = getWorldExtensionDirs(el, activeSvg, ctm)
      dirs.forEach(({ point, direction }) => {
        const d = Math.hypot(point.x - cursorWorld.x, point.y - cursorWorld.y)
        if (d < extEndpointRadius) {
          const dup = editor.extensionHovers.some(h =>
            Math.hypot(h.point.x - point.x, h.point.y - point.y) < 1 &&
            Math.hypot(h.direction.x - direction.x, h.direction.y - direction.y) < 0.01
          )
          if (!dup) {
            editor.extensionHovers.push({ point: { x: point.x, y: point.y }, direction: { x: direction.x, y: direction.y } })
          }
        }
      })
    })

    // Phase B: prune hovers where cursor has moved off the extension ray
    editor.extensionHovers = editor.extensionHovers.filter(hover => {
      const dx = cursorWorld.x - hover.point.x
      const dy = cursorWorld.y - hover.point.y
      const proj = dx * hover.direction.x + dy * hover.direction.y
      if (proj < 0) return false
      const perpX = dx - proj * hover.direction.x
      const perpY = dy - proj * hover.direction.y
      const perpDistScreen = Math.hypot(perpX, perpY) / worldPerPixel
      return perpDistScreen < snapTolerance * 2.5
    })

    // Phase C+D: snap along each active extension ray.
    // When intersection snap is also active, find where the ray crosses real elements or
    // other extension rays near the cursor's projected position and prefer those over the
    // plain projection point — intersection beats extension when both are in range.
    editor.extensionHovers.forEach(hover => {
      const dx = cursorWorld.x - hover.point.x
      const dy = cursorWorld.y - hover.point.y
      const proj = dx * hover.direction.x + dy * hover.direction.y
      if (proj <= snapWorldRadius * 0.5) return
      const snapPt = {
        x: hover.point.x + proj * hover.direction.x,
        y: hover.point.y + proj * hover.direction.y,
      }

      let hasIntersectionInRange = false

      if (st.intersection) {
        const ep1 = hover.point
        const ep2 = { x: hover.point.x + hover.direction.x, y: hover.point.y + hover.direction.y }

        const tryPushIntersection = (pt) => {
          if (!pt) return
          const projOnRay = (pt.x - hover.point.x) * hover.direction.x + (pt.y - hover.point.y) * hover.direction.y
          if (projOnRay <= snapWorldRadius * 0.5) return
          const sp = worldToScreen(pt, activeSvg, ctm)
          taggedTargets.push({ screenPoint: sp, snapType: 'intersection' })
          if (calculateDistance(screenCoords, sp) < snapTolerance) hasIntersectionInRange = true
        }

        // Search elements near the projected cursor position on the ray — wider radius
        // than the cursor search so we catch elements that cross the ray ahead of the cursor.
        const searchR = snapWorldRadius * 3
        const nearProj = snapIndex.search({
          minX: snapPt.x - searchR,
          minY: snapPt.y - searchR,
          maxX: snapPt.x + searchR,
          maxY: snapPt.y + searchR,
        }).map(item => item.element)

        nearProj.forEach(el => {
          getWorldSnapSegments(el, activeSvg, ctm)
            .forEach(seg => tryPushIntersection(lineLineIntersectPt(ep1, ep2, seg.p1, seg.p2)))
          getWorldSnapCircles(el, activeSvg, ctm)
            .forEach(cir => lineCircleIntersectPts(ep1, ep2, cir.cx, cir.cy, cir.r).forEach(tryPushIntersection))
        })

        // Extension-extension intersections (two active extension rays crossing each other)
        editor.extensionHovers.forEach(other => {
          if (other === hover) return
          const op1 = other.point
          const op2 = { x: other.point.x + other.direction.x, y: other.point.y + other.direction.y }
          const pt = lineLineIntersectPt(ep1, ep2, op1, op2)
          if (!pt) return
          const projB = (pt.x - other.point.x) * other.direction.x + (pt.y - other.point.y) * other.direction.y
          if (projB > snapWorldRadius * 0.5) tryPushIntersection(pt)
        })
      }

      // Only add the plain extension projection when no intersection snap is in range,
      // so the intersection candidate always wins when the cursor is near a crossing.
      if (!hasIntersectionInRange) {
        taggedTargets.push({ screenPoint: worldToScreen(snapPt, activeSvg, ctm), snapType: 'extension' })
      }
    })
  }

  const targetsInRange = taggedTargets.filter(item =>
    calculateDistance(screenCoords, item.screenPoint) < snapTolerance
  )

  // Nearest is a fallback snap: when another enabled snap target is available,
  // prefer that type even if the projected nearest point is slightly closer.
  const nonNearestTargets = targetsInRange.filter(item => item.snapType !== 'nearest')
  const prioritizedTargets = nonNearestTargets.length > 0 ? nonNearestTargets : targetsInRange

  let closestTagged
  let minDistance = Infinity
  for (const item of prioritizedTargets) {
    const distance = calculateDistance(screenCoords, item.screenPoint)
    if (distance < minDistance) {
      minDistance = distance
      closestTagged = item
    }
  }

  if (closestTagged) {
    const closestWorld = activeSvg.point(closestTagged.screenPoint.x, closestTagged.screenPoint.y)
    return { worldPoint: closestWorld, snapType: closestTagged.snapType }
  }
  return null
}

// ---- Snap icon drawing ----------------------------------------------------------

/**
 * Draws a type-specific snap indicator icon at the given world point.
 */
export function drawSnap(point, zoom, svgInstance, snapType) {
  let snapGroup = svgInstance.findOne('#Snap') || svgInstance.findOne('.snap-group')
  if (!snapGroup) {
    snapGroup = svgInstance.group().attr('id', 'Snap').addClass('snap-group')
  }

  const prefs = getPreferences()
  const screenSize = prefs.snapIconSize || 15
  const currentZoom = zoom || 1
  const s = screenSize / currentZoom
  const h = s / 2
  const sw = 3 / currentZoom
  const color = 'hsl(217, 47%, 55%)'
  const cx = point.x, cy = point.y

  snapGroup.clear()

  if (snapType === 'midpoint') {
    const pts = `${cx},${cy - s} ${cx + s},${cy + h} ${cx - s},${cy + h}`
    snapGroup.polygon(pts).fill('none').stroke({ color, width: sw })

  } else if (snapType === 'center') {
    snapGroup.circle(s * 2).center(cx, cy).fill('none').stroke({ color, width: sw })

  } else if (snapType === 'quadrant') {
    const pts = `${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`
    snapGroup.polygon(pts).fill('none').stroke({ color, width: sw })

  } else if (snapType === 'intersection') {
    snapGroup.line(cx - s, cy - s, cx + s, cy + s).stroke({ color, width: sw })
    snapGroup.line(cx + s, cy - s, cx - s, cy + s).stroke({ color, width: sw })

  } else if (snapType === 'nearest') {
    snapGroup.line(cx - s, cy - s, cx + s, cy + s).stroke({ color, width: sw })
    snapGroup.line(cx + s, cy - s, cx - s, cy + s).stroke({ color, width: sw })
    snapGroup.line(cx - s, cy - s, cx + s, cy - s).stroke({ color, width: sw })
    snapGroup.line(cx - s, cy + s, cx + s, cy + s).stroke({ color, width: sw })

  } else if (snapType === 'perpendicular') {
    // L-shape with filled square in the inner corner (right-angle marker)
    const corner = { x: cx - s * 0.5, y: cy + s * 0.5 }
    const sq = s * 0.42
    snapGroup.line(corner.x, corner.y, corner.x + s, corner.y).stroke({ color, width: sw })
    snapGroup.line(corner.x, corner.y, corner.x, corner.y - s).stroke({ color, width: sw })
    snapGroup.rect(sq, sq).move(corner.x, corner.y - sq).fill(color).stroke('none')

  } else if (snapType === 'tangent') {
    snapGroup.circle(s * 1.4).center(cx, cy).fill('none').stroke({ color, width: sw })
    snapGroup.line(cx - s, cy + s * 0.7, cx + s, cy + s * 0.7).stroke({ color, width: sw })

  } else if (snapType === 'extension') {
    // Small cross for extension snap point
    snapGroup.line(cx - s, cy, cx + s, cy).stroke({ color, width: sw })
    snapGroup.line(cx, cy - s, cx, cy + s).stroke({ color, width: sw })

  } else if (snapType === 'grid') {
    // Grid intersections are shown as a small four-point marker.
    const r = sw * 0.75
    ;[
      [cx - h, cy - h], [cx + h, cy - h],
      [cx - h, cy + h], [cx + h, cy + h],
    ].forEach(([x, y]) => snapGroup.circle(r * 2).center(x, y).fill(color).stroke('none'))

  } else {
    // Default: endpoint — square
    snapGroup.rect(s * 2, s * 2).center(cx, cy).fill('none').stroke({ color, width: sw })
  }
}

/**
 * Clears the snap indicator and extension lines from the viewport.
 */
export function clearSnap(editor, activeSvg) {
  if (editor.snap) {
    editor.snap.clear()
  }
  if (activeSvg) {
    const snapGroup = activeSvg.findOne('#Snap')
    if (snapGroup) snapGroup.clear()
    const extGroup = activeSvg.findOne('#ExtensionLines')
    if (extGroup) extGroup.clear()
  }
}

/**
 * Draws dashed extension lines from each active hover endpoint toward the cursor.
 */
export function drawExtensionLines(hovers, cursorWorld, zoom, activeSvg) {
  let extGroup = activeSvg.findOne('#ExtensionLines')
  if (!extGroup) {
    extGroup = activeSvg.group().attr('id', 'ExtensionLines')
  }
  extGroup.clear()
  if (!hovers || hovers.length === 0) return

  const currentZoom = zoom || 1
  const sw = 1.5 / currentZoom
  const color = 'hsl(217, 47%, 55%)'
  const dash = `${8 / currentZoom},${5 / currentZoom}`

  hovers.forEach(hover => {
    const dx = cursorWorld.x - hover.point.x
    const dy = cursorWorld.y - hover.point.y
    const proj = dx * hover.direction.x + dy * hover.direction.y
    if (proj <= 0) return
    const endX = hover.point.x + proj * hover.direction.x
    const endY = hover.point.y + proj * hover.direction.y
    extGroup.line(hover.point.x, hover.point.y, endX, endY)
      .stroke({ color, width: sw, dasharray: dash })
      .fill('none')
  })
}
