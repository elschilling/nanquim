import { getArcGeometry, isPointInArc } from './arcUtils'
import { calculateDistance } from './calculateDistance'
import { getPreferences } from '../Preferences'
import { getAllDrawingElements } from '../Collection'

/**
 * Converts a point from SVG world coordinates to screen coordinates.
 */
export function worldToScreen(worldPoint, svgCanvas) {
  const matrix = svgCanvas.screenCTM()
  const screenPoint = new SVG.Point(worldPoint).transform(matrix)
  return { x: screenPoint.x, y: screenPoint.y }
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

  const useFullIndex = editor.snapExcludeNonSelectable === false
  const snapIndex = useFullIndex ? editor.fullSpatialIndex : editor.spatialIndex
  snapIndex.ensureFresh(editor, useFullIndex ? getAllDrawingElements : undefined)
  const nearbyCandidates = snapIndex.search({
    minX: cursorWorld.x - snapWorldRadius,
    minY: cursorWorld.y - snapWorldRadius,
    maxX: cursorWorld.x + snapWorldRadius,
    maxY: cursorWorld.y + snapWorldRadius,
  })

  let snapCandidates = nearbyCandidates.map(item => item.element)
  if (editor.isDrawing) {
    snapCandidates = snapCandidates.filter(el => el.attr('id') !== undefined && el.attr('id') !== null)
  }
  if (editor.isEditingVertex && editor.editingVertices.length > 0) {
    const editingNodes = editor.editingVertices.map(v => v.element.node)
    snapCandidates = snapCandidates.filter(el => !editingNodes.includes(el.node))
  }

  const st = editor.snapTypes || {}
  const taggedTargets = []

  snapCandidates.forEach((el) => {
    if (el.type === 'line') {
      const pts = el.array()
      if (st.endpoint) {
        pts.forEach((pointArr) => {
          taggedTargets.push({ screenPoint: worldToScreen({ x: pointArr[0], y: pointArr[1] }, activeSvg), snapType: 'endpoint' })
        })
      }
      if (st.midpoint && pts.length >= 2) {
        const mx = (pts[0][0] + pts[1][0]) / 2
        const my = (pts[0][1] + pts[1][1]) / 2
        taggedTargets.push({ screenPoint: worldToScreen({ x: mx, y: my }, activeSvg), snapType: 'midpoint' })
      }
      if (st.nearest && pts.length >= 2) {
        const p1 = { x: pts[0][0], y: pts[0][1] }
        const p2 = { x: pts[1][0], y: pts[1][1] }
        const dx = p2.x - p1.x, dy = p2.y - p1.y
        const len2 = dx * dx + dy * dy
        if (len2 > 0) {
          let t = ((cursorWorld.x - p1.x) * dx + (cursorWorld.y - p1.y) * dy) / len2
          t = Math.max(0, Math.min(1, t))
          taggedTargets.push({ screenPoint: worldToScreen({ x: p1.x + t * dx, y: p1.y + t * dy }, activeSvg), snapType: 'nearest' })
        }
      }
    } else if (el.type === 'circle') {
      const cx = el.node.cx.baseVal.value
      const cy = el.node.cy.baseVal.value
      const r = el.node.r.baseVal.value
      if (st.center) {
        taggedTargets.push({ screenPoint: worldToScreen({ x: cx, y: cy }, activeSvg), snapType: 'center' })
      }
      if (st.quadrant) {
        taggedTargets.push({ screenPoint: worldToScreen({ x: cx, y: cy - r }, activeSvg), snapType: 'quadrant' })
        taggedTargets.push({ screenPoint: worldToScreen({ x: cx + r, y: cy }, activeSvg), snapType: 'quadrant' })
        taggedTargets.push({ screenPoint: worldToScreen({ x: cx, y: cy + r }, activeSvg), snapType: 'quadrant' })
        taggedTargets.push({ screenPoint: worldToScreen({ x: cx - r, y: cy }, activeSvg), snapType: 'quadrant' })
      }
      if (st.nearest) {
        const dx = cursorWorld.x - cx, dy = cursorWorld.y - cy
        const dist = Math.hypot(dx, dy)
        if (dist > 0) {
          taggedTargets.push({ screenPoint: worldToScreen({ x: cx + (dx / dist) * r, y: cy + (dy / dist) * r }, activeSvg), snapType: 'nearest' })
        }
      }
    } else if (el.type === 'rect') {
      const rx = el.node.x.baseVal.value
      const ry = el.node.y.baseVal.value
      const rw = el.node.width.baseVal.value
      const rh = el.node.height.baseVal.value
      if (st.endpoint) {
        taggedTargets.push({ screenPoint: worldToScreen({ x: rx, y: ry }, activeSvg), snapType: 'endpoint' })
        taggedTargets.push({ screenPoint: worldToScreen({ x: rx + rw, y: ry }, activeSvg), snapType: 'endpoint' })
        taggedTargets.push({ screenPoint: worldToScreen({ x: rx + rw, y: ry + rh }, activeSvg), snapType: 'endpoint' })
        taggedTargets.push({ screenPoint: worldToScreen({ x: rx, y: ry + rh }, activeSvg), snapType: 'endpoint' })
      }
      if (st.midpoint) {
        taggedTargets.push({ screenPoint: worldToScreen({ x: rx + rw / 2, y: ry }, activeSvg), snapType: 'midpoint' })
        taggedTargets.push({ screenPoint: worldToScreen({ x: rx + rw, y: ry + rh / 2 }, activeSvg), snapType: 'midpoint' })
        taggedTargets.push({ screenPoint: worldToScreen({ x: rx + rw / 2, y: ry + rh }, activeSvg), snapType: 'midpoint' })
        taggedTargets.push({ screenPoint: worldToScreen({ x: rx, y: ry + rh / 2 }, activeSvg), snapType: 'midpoint' })
      }
    } else if (el.type === 'path' && el.data('arcData')) {
      const arcData = el.data('arcData')
      if (st.endpoint) {
        taggedTargets.push({ screenPoint: worldToScreen({ x: arcData.p1.x, y: arcData.p1.y }, activeSvg), snapType: 'endpoint' })
        taggedTargets.push({ screenPoint: worldToScreen({ x: arcData.p3.x, y: arcData.p3.y }, activeSvg), snapType: 'endpoint' })
      }
      if (st.midpoint) {
        taggedTargets.push({ screenPoint: worldToScreen({ x: arcData.p2.x, y: arcData.p2.y }, activeSvg), snapType: 'midpoint' })
      }
      if (st.center) {
        if (arcData.cx !== undefined) {
          taggedTargets.push({ screenPoint: worldToScreen({ x: arcData.cx, y: arcData.cy }, activeSvg), snapType: 'center' })
        } else {
          const geo = getArcGeometry(arcData.p1, arcData.p2, arcData.p3)
          if (geo) taggedTargets.push({ screenPoint: worldToScreen({ x: geo.cx, y: geo.cy }, activeSvg), snapType: 'center' })
        }
      }
    } else if (el.type === 'polygon' || el.type === 'polyline') {
      const pts = el.array()
      if (st.endpoint) {
        pts.forEach((pointArr) => {
          taggedTargets.push({ screenPoint: worldToScreen({ x: pointArr[0], y: pointArr[1] }, activeSvg), snapType: 'endpoint' })
        })
      }
      if (st.midpoint) {
        for (let i = 0; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2
          const my = (pts[i][1] + pts[i + 1][1]) / 2
          taggedTargets.push({ screenPoint: worldToScreen({ x: mx, y: my }, activeSvg), snapType: 'midpoint' })
        }
      }
    } else if (el.type === 'path' && !el.data('arcData')) {
      const node = el.node
      if (!node.getTotalLength) return
      const totalLength = node.getTotalLength()
      if (totalLength <= 0) return
      const ptAt = len => { const p = node.getPointAtLength(len); return { x: p.x, y: p.y } }
      const splineData = el.data('splineData')

      if (st.endpoint) {
        if (splineData) {
          splineData.points.forEach(sp => {
            taggedTargets.push({ screenPoint: worldToScreen(sp, activeSvg), snapType: 'endpoint' })
          })
        } else {
          taggedTargets.push({ screenPoint: worldToScreen(ptAt(0), activeSvg), snapType: 'endpoint' })
          taggedTargets.push({ screenPoint: worldToScreen(ptAt(totalLength), activeSvg), snapType: 'endpoint' })
        }
      }

      if (st.midpoint) {
        taggedTargets.push({ screenPoint: worldToScreen(ptAt(totalLength / 2), activeSvg), snapType: 'midpoint' })
      }

      if (st.nearest) {
        const samples = Math.max(32, Math.ceil(totalLength / 5))
        let minDist = Infinity
        let nearestPt = null
        for (let i = 0; i <= samples; i++) {
          const pt = ptAt((i / samples) * totalLength)
          const d = Math.hypot(pt.x - cursorWorld.x, pt.y - cursorWorld.y)
          if (d < snapWorldRadius && d < minDist) {
            minDist = d
            nearestPt = pt
          }
        }
        if (nearestPt) {
          taggedTargets.push({ screenPoint: worldToScreen(nearestPt, activeSvg), snapType: 'nearest' })
        }
      }
    }
  })

  // ---- INTERSECTION SNAP ----
  if (st.intersection && snapCandidates.length > 1) {
    for (let i = 0; i < snapCandidates.length; i++) {
      for (let j = i + 1; j < snapCandidates.length; j++) {
        const elA = snapCandidates[i], elB = snapCandidates[j]
        const segsA = getSnapSegments(elA), segsB = getSnapSegments(elB)
        const cirsA = getSnapCircles(elA), cirsB = getSnapCircles(elB)

        const pushPt = pt => {
          if (pt) taggedTargets.push({ screenPoint: worldToScreen(pt, activeSvg), snapType: 'intersection' })
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
  // Requires a base point: finds the foot where a line FROM lastClick TO the element is perpendicular.
  if (st.perpendicular && editor.lastClick) {
    const from = editor.lastClick
    const pushPerp = pt => taggedTargets.push({ screenPoint: worldToScreen(pt, activeSvg), snapType: 'perpendicular' })

    snapCandidates.forEach(el => {
      if (el.type === 'line') {
        const pts = el.array()
        if (pts.length < 2) return
        const p1 = { x: pts[0][0], y: pts[0][1] }, p2 = { x: pts[1][0], y: pts[1][1] }
        const dx = p2.x - p1.x, dy = p2.y - p1.y
        const len2 = dx * dx + dy * dy
        if (len2 < 1e-10) return
        const t = ((from.x - p1.x) * dx + (from.y - p1.y) * dy) / len2
        if (t >= -0.1 && t <= 1.1) {
          pushPerp({ x: p1.x + t * dx, y: p1.y + t * dy })
        }

      } else if (el.type === 'circle') {
        const cx = el.node.cx.baseVal.value, cy = el.node.cy.baseVal.value
        const r = el.node.r.baseVal.value
        const dx = from.x - cx, dy = from.y - cy
        const dist = Math.hypot(dx, dy)
        if (dist < 1e-10) return
        // Both intersections of the from→center line with the circle
        pushPerp({ x: cx + (dx / dist) * r, y: cy + (dy / dist) * r })
        pushPerp({ x: cx - (dx / dist) * r, y: cy - (dy / dist) * r })

      } else if (el.type === 'ellipse') {
        const cx = el.node.cx.baseVal.value, cy = el.node.cy.baseVal.value
        const rx = el.node.rx.baseVal.value, ry = el.node.ry.baseVal.value
        const dx = from.x - cx, dy = from.y - cy
        if (Math.hypot(dx, dy) > 1e-10) {
          const len = Math.hypot(dx / rx, dy / ry)
          if (len > 1e-10) {
            pushPerp({ x: cx + (dx / rx / len) * rx, y: cy + (dy / ry / len) * ry })
            pushPerp({ x: cx - (dx / rx / len) * rx, y: cy - (dy / ry / len) * ry })
          }
        }

      } else if (el.type === 'path' && el.data('arcData')) {
        const arcData = el.data('arcData')
        const geo = getArcGeometry(arcData.p1, arcData.p2, arcData.p3)
        if (!geo) return
        const cx = arcData.cx !== undefined ? arcData.cx : geo.cx
        const cy = arcData.cx !== undefined ? arcData.cy : geo.cy
        const dx = from.x - cx, dy = from.y - cy
        const dist = Math.hypot(dx, dy)
        if (dist < 1e-10) return
        for (const sign of [1, -1]) {
          const foot = { x: cx + sign * (dx / dist) * geo.radius, y: cy + sign * (dy / dist) * geo.radius }
          if (isPointInArc(foot, cx, cy, geo.theta1, geo.theta3, geo.ccw)) {
            pushPerp(foot)
          }
        }

      } else if (el.type === 'rect') {
        const rx = el.node.x.baseVal.value, ry = el.node.y.baseVal.value
        const rw = el.node.width.baseVal.value, rh = el.node.height.baseVal.value
        const edges = [
          [{ x: rx,      y: ry      }, { x: rx + rw, y: ry      }],
          [{ x: rx + rw, y: ry      }, { x: rx + rw, y: ry + rh }],
          [{ x: rx + rw, y: ry + rh }, { x: rx,      y: ry + rh }],
          [{ x: rx,      y: ry + rh }, { x: rx,      y: ry      }],
        ]
        edges.forEach(([p1, p2]) => {
          const dx = p2.x - p1.x, dy = p2.y - p1.y
          const len2 = dx * dx + dy * dy
          if (len2 < 1e-10) return
          const t = Math.max(0, Math.min(1, ((from.x - p1.x) * dx + (from.y - p1.y) * dy) / len2))
          pushPerp({ x: p1.x + t * dx, y: p1.y + t * dy })
        })

      } else if (el.type === 'polygon' || el.type === 'polyline') {
        const pts = el.array()
        const count = el.type === 'polygon' ? pts.length : pts.length - 1
        for (let i = 0; i < count; i++) {
          const p1 = { x: pts[i][0], y: pts[i][1] }
          const p2 = { x: pts[(i + 1) % pts.length][0], y: pts[(i + 1) % pts.length][1] }
          const dx = p2.x - p1.x, dy = p2.y - p1.y
          const len2 = dx * dx + dy * dy
          if (len2 < 1e-10) continue
          const t = Math.max(0, Math.min(1, ((from.x - p1.x) * dx + (from.y - p1.y) * dy) / len2))
          pushPerp({ x: p1.x + t * dx, y: p1.y + t * dy })
        }
      }
    })
  }

  // ---- EXTENSION SNAP ----
  if (st.extension) {
    if (!editor.extensionHovers) editor.extensionHovers = []

    // Phase A: register new endpoint hovers when cursor is near an endpoint
    const extEndpointRadius = snapWorldRadius * 1.5
    snapCandidates.forEach(el => {
      const dirs = [...getLineExtensionDirs(el), ...getArcExtensionDirs(el)]
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

    // Phase C: generate snap candidates along each active extension ray
    editor.extensionHovers.forEach(hover => {
      const dx = cursorWorld.x - hover.point.x
      const dy = cursorWorld.y - hover.point.y
      const proj = dx * hover.direction.x + dy * hover.direction.y
      if (proj <= snapWorldRadius * 0.5) return
      const snapPt = {
        x: hover.point.x + proj * hover.direction.x,
        y: hover.point.y + proj * hover.direction.y,
      }
      taggedTargets.push({ screenPoint: worldToScreen(snapPt, activeSvg), snapType: 'extension' })
    })
  }

  let closestTagged
  let minDistance = Infinity
  for (let item of taggedTargets) {
    const distance = calculateDistance(screenCoords, item.screenPoint)
    if (distance < snapTolerance && distance < minDistance) {
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

  } else if (snapType === 'extension') {
    // Small cross for extension snap point
    snapGroup.line(cx - s, cy, cx + s, cy).stroke({ color, width: sw })
    snapGroup.line(cx, cy - s, cx, cy + s).stroke({ color, width: sw })

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
