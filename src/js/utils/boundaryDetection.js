/**
 * Boundary detection for hatch command.
 * Given a click point, finds the enclosing closed boundary formed by
 * drawing elements (lines, arcs, circles, polygons, rects, paths).
 */

import { getDrawableElements } from '../Collection'
import { getArcGeometry } from './arcUtils'

const EPS = 1e-6
const SNAP_DIGITS = 3 // Round to 1e-3 for node merging
const SPLINE_SAMPLES_PER_SEGMENT = 8 // Line segments per Bezier curve for linearization

// ─── Cubic Bezier helpers ──────────────────────────────────────────

/** Evaluate a cubic Bezier at parameter t ∈ [0,1]. */
function evalCubicBezier(p0, p1, p2, p3, t) {
    const u = 1 - t
    const uu = u * u, uuu = uu * u
    const tt = t * t, ttt = tt * t
    return {
        x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
        y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
    }
}

/**
 * Sample a Catmull-Rom spline (same conversion as DrawSplineCommand)
 * into a polyline of points.
 */
function sampleCatmullRomSpline(points, samplesPerSeg) {
    if (points.length < 2) return points.slice()
    if (points.length === 2) return [points[0], points[1]]

    // Build extended array with virtual endpoints (mirror first/last tangent)
    const ext = []
    ext.push({
        x: 2 * points[0].x - points[1].x,
        y: 2 * points[0].y - points[1].y,
    })
    for (const p of points) ext.push(p)
    const n = points.length
    ext.push({
        x: 2 * points[n - 1].x - points[n - 2].x,
        y: 2 * points[n - 1].y - points[n - 2].y,
    })

    const result = [points[0]]
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = ext[i]
        const p1 = ext[i + 1]
        const p2 = ext[i + 2]
        const p3 = ext[i + 3]

        // Catmull-Rom to Cubic Bezier control points
        const cp1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
        const cp2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }

        for (let s = 1; s <= samplesPerSeg; s++) {
            result.push(evalCubicBezier(p1, cp1, cp2, p2, s / samplesPerSeg))
        }
    }
    return result
}

// ─── Segment extraction ────────────────────────────────────────────

/**
 * Extract line/arc segments from all drawable elements.
 * Each segment: { type: 'line'|'arc', x1, y1, x2, y2, element, ... }
 * Arc segments also carry: cx, cy, r, startAngle, endAngle, ccw
 */
export function extractSegments(editor) {
    const elements = getDrawableElements(editor)
    const segments = []

    for (const el of elements) {
        if (el.hasClass('grid') || el.hasClass('axis') || el.hasClass('ghostLine')) continue
        if (el.hasClass('hatch-fill')) continue

        const type = el.type
        if (type === 'line') {
            const x1 = parseFloat(el.attr('x1'))
            const y1 = parseFloat(el.attr('y1'))
            const x2 = parseFloat(el.attr('x2'))
            const y2 = parseFloat(el.attr('y2'))
            if (isFinite(x1) && isFinite(y1) && isFinite(x2) && isFinite(y2)) {
                segments.push({ type: 'line', x1, y1, x2, y2, element: el })
            }
        } else if (type === 'polyline' || type === 'polygon') {
            const pts = el.array()
            for (let i = 0; i < pts.length - 1; i++) {
                segments.push({
                    type: 'line',
                    x1: pts[i][0], y1: pts[i][1],
                    x2: pts[i + 1][0], y2: pts[i + 1][1],
                    element: el,
                })
            }
            if (type === 'polygon' && pts.length > 2) {
                const last = pts[pts.length - 1]
                const first = pts[0]
                segments.push({
                    type: 'line',
                    x1: last[0], y1: last[1],
                    x2: first[0], y2: first[1],
                    element: el,
                })
            }
        } else if (type === 'rect') {
            const x = el.x(), y = el.y(), w = el.width(), h = el.height()
            const corners = [
                [x, y], [x + w, y], [x + w, y + h], [x, y + h]
            ]
            for (let i = 0; i < 4; i++) {
                const j = (i + 1) % 4
                segments.push({
                    type: 'line',
                    x1: corners[i][0], y1: corners[i][1],
                    x2: corners[j][0], y2: corners[j][1],
                    element: el,
                })
            }
        } else if (type === 'circle') {
            const cx = el.cx(), cy = el.cy(), r = el.attr('r') || el.radius()
            segments.push({
                type: 'arc',
                x1: cx + r, y1: cy,
                x2: cx - r, y2: cy,
                cx, cy, r,
                startAngle: 0, endAngle: Math.PI,
                ccw: false,
                element: el,
            })
            segments.push({
                type: 'arc',
                x1: cx - r, y1: cy,
                x2: cx + r, y2: cy,
                cx, cy, r,
                startAngle: Math.PI, endAngle: 2 * Math.PI,
                ccw: false,
                element: el,
            })
        } else if (type === 'path') {
            const arcData = el.data('arcData')
            const splineData = el.data('splineData')
            if (arcData && arcData.p1 && arcData.p3) {
                const geom = getArcGeometry(arcData.p1, arcData.p2, arcData.p3)
                if (geom) {
                    let sa = geom.theta1
                    let ea = geom.theta3
                    if (sa < 0) sa += 2 * Math.PI
                    if (ea < 0) ea += 2 * Math.PI

                    segments.push({
                        type: 'arc',
                        x1: arcData.p1.x, y1: arcData.p1.y,
                        x2: arcData.p3.x, y2: arcData.p3.y,
                        cx: geom.cx, cy: geom.cy, r: geom.radius,
                        startAngle: sa, endAngle: ea,
                        ccw: geom.ccw,
                        sweepFlag: geom.sweepFlag,
                        largeArcFlag: geom.largeArcFlag,
                        element: el,
                    })
                }
            } else if (splineData && splineData.points && splineData.points.length >= 2) {
                // Linearize spline (Catmull-Rom → Cubic Bezier → line segments)
                const pts = splineData.points
                const sampled = sampleCatmullRomSpline(pts, SPLINE_SAMPLES_PER_SEGMENT)
                for (let i = 0; i < sampled.length - 1; i++) {
                    segments.push({
                        type: 'line',
                        x1: sampled[i].x, y1: sampled[i].y,
                        x2: sampled[i + 1].x, y2: sampled[i + 1].y,
                        element: el,
                    })
                }
            } else {
                try {
                    const arr = el.array()
                    let lastPt = null
                    for (const seg of arr) {
                        const cmd = seg[0]
                        if (cmd === 'M') {
                            lastPt = { x: seg[1], y: seg[2] }
                        } else if (cmd === 'L' && lastPt) {
                            segments.push({
                                type: 'line',
                                x1: lastPt.x, y1: lastPt.y,
                                x2: seg[1], y2: seg[2],
                                element: el,
                            })
                            lastPt = { x: seg[1], y: seg[2] }
                        } else if (cmd === 'C' && lastPt) {
                            // Cubic Bezier — linearize by sampling
                            const p0 = lastPt
                            const p1 = { x: seg[1], y: seg[2] }
                            const p2 = { x: seg[3], y: seg[4] }
                            const p3 = { x: seg[5], y: seg[6] }
                            let prev = p0
                            for (let t = 1; t <= SPLINE_SAMPLES_PER_SEGMENT; t++) {
                                const pt = evalCubicBezier(p0, p1, p2, p3, t / SPLINE_SAMPLES_PER_SEGMENT)
                                segments.push({
                                    type: 'line',
                                    x1: prev.x, y1: prev.y,
                                    x2: pt.x, y2: pt.y,
                                    element: el,
                                })
                                prev = pt
                            }
                            lastPt = { x: seg[5], y: seg[6] }
                        } else if (cmd === 'Z' && lastPt) {
                            lastPt = null
                        }
                    }
                } catch (_e) { /* skip unparseable paths */ }
            }
        }
    }
    return segments
}

// ─── Ray-segment intersection ───────────────────────────────────────

function rayLineIntersection(ox, oy, dx, dy, seg) {
    const sx = seg.x2 - seg.x1
    const sy = seg.y2 - seg.y1
    const denom = dx * sy - dy * sx
    if (Math.abs(denom) < EPS) return null

    const t = ((seg.x1 - ox) * sy - (seg.y1 - oy) * sx) / denom
    const u = ((seg.x1 - ox) * dy - (seg.y1 - oy) * dx) / denom

    if (t > EPS && u > -EPS && u < 1 + EPS) {
        return {
            t,
            x: ox + t * dx,
            y: oy + t * dy,
            segment: seg,
        }
    }
    return null
}

function rayArcIntersection(ox, oy, dx, dy, seg) {
    const { cx, cy, r } = seg
    const fx = ox - cx
    const fy = oy - cy
    const a = dx * dx + dy * dy
    const b = 2 * (fx * dx + fy * dy)
    const c = fx * fx + fy * fy - r * r
    const disc = b * b - 4 * a * c
    if (disc < 0) return null

    const sqrtDisc = Math.sqrt(disc)
    const hits = []

    for (const sign of [-1, 1]) {
        const t = (-b + sign * sqrtDisc) / (2 * a)
        if (t <= EPS) continue
        const px = ox + t * dx
        const py = oy + t * dy
        if (isPointOnArc(px, py, seg)) {
            hits.push({ t, x: px, y: py, segment: seg })
        }
    }

    if (hits.length === 0) return null
    return hits.reduce((best, h) => h.t < best.t ? h : best)
}

/**
 * Check if a point (on the circle) lies within the arc's angular range.
 */
function isPointOnArc(px, py, seg) {
    const { cx, cy, startAngle, endAngle, ccw } = seg
    let angle = Math.atan2(py - cy, px - cx)
    if (angle < 0) angle += 2 * Math.PI

    let sa = startAngle
    let ea = endAngle
    if (sa < 0) sa += 2 * Math.PI
    if (ea < 0) ea += 2 * Math.PI

    if (ccw) {
        // CCW: angle increases from sa to ea
        let sweep = ea - sa
        if (sweep < 0) sweep += 2 * Math.PI
        let diff = angle - sa
        if (diff < 0) diff += 2 * Math.PI
        return diff <= sweep + 1e-4
    } else {
        // CW: angle decreases from sa to ea
        let sweep = sa - ea
        if (sweep < 0) sweep += 2 * Math.PI
        let diff = sa - angle
        if (diff < 0) diff += 2 * Math.PI
        return diff <= sweep + 1e-4
    }
}

/**
 * Parameterize a point along an arc (0 = start endpoint, 1 = end endpoint).
 */
function arcParameter(px, py, seg) {
    const { cx, cy, startAngle, endAngle, ccw } = seg
    let angle = Math.atan2(py - cy, px - cx)
    if (angle < 0) angle += 2 * Math.PI

    let sa = startAngle
    let ea = endAngle
    if (sa < 0) sa += 2 * Math.PI
    if (ea < 0) ea += 2 * Math.PI

    if (ccw) {
        let sweep = ea - sa
        if (sweep < 0) sweep += 2 * Math.PI
        let diff = angle - sa
        if (diff < 0) diff += 2 * Math.PI
        return sweep > EPS ? diff / sweep : 0
    } else {
        let sweep = sa - ea
        if (sweep < 0) sweep += 2 * Math.PI
        let diff = sa - angle
        if (diff < 0) diff += 2 * Math.PI
        return sweep > EPS ? diff / sweep : 0
    }
}

// ─── Segment-segment intersection ───────────────────────────────────

function lineLineIntersection(s1, s2) {
    const d1x = s1.x2 - s1.x1, d1y = s1.y2 - s1.y1
    const d2x = s2.x2 - s2.x1, d2y = s2.y2 - s2.y1
    const denom = d1x * d2y - d1y * d2x
    if (Math.abs(denom) < EPS) return []

    const t = ((s2.x1 - s1.x1) * d2y - (s2.y1 - s1.y1) * d2x) / denom
    const u = ((s2.x1 - s1.x1) * d1y - (s2.y1 - s1.y1) * d1x) / denom

    if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) {
        return [{ x: s1.x1 + t * d1x, y: s1.y1 + t * d1y }]
    }
    return []
}

function arcArcIntersection(arc1, arc2) {
    const dx = arc2.cx - arc1.cx
    const dy = arc2.cy - arc1.cy
    const d2 = dx * dx + dy * dy
    const d = Math.sqrt(d2)
    if (d < EPS) return [] // concentric
    if (d > arc1.r + arc2.r + EPS) return [] // too far apart
    if (d < Math.abs(arc1.r - arc2.r) - EPS) return [] // one inside the other

    const a = (arc1.r * arc1.r - arc2.r * arc2.r + d2) / (2 * d)
    const h2 = arc1.r * arc1.r - a * a
    if (h2 < 0) return []
    const h = Math.sqrt(h2)

    const mx = arc1.cx + a * dx / d
    const my = arc1.cy + a * dy / d
    const ox = h * dy / d
    const oy = h * dx / d

    const pts = [
        { x: mx + ox, y: my - oy },
        { x: mx - ox, y: my + oy },
    ]

    return pts.filter(p =>
        isPointOnArc(p.x, p.y, arc1) && isPointOnArc(p.x, p.y, arc2)
    )
}

function lineArcIntersection(lineSeg, arcSeg) {
    const { cx, cy, r } = arcSeg
    const dx = lineSeg.x2 - lineSeg.x1
    const dy = lineSeg.y2 - lineSeg.y1
    const fx = lineSeg.x1 - cx
    const fy = lineSeg.y1 - cy
    const a = dx * dx + dy * dy
    const b = 2 * (fx * dx + fy * dy)
    const c = fx * fx + fy * fy - r * r
    const disc = b * b - 4 * a * c
    if (disc < 0) return []

    const sqrtDisc = Math.sqrt(disc)
    const results = []
    for (const sign of [-1, 1]) {
        const t = (-b + sign * sqrtDisc) / (2 * a)
        if (t > EPS && t < 1 - EPS) {
            const px = lineSeg.x1 + t * dx
            const py = lineSeg.y1 + t * dy
            if (isPointOnArc(px, py, arcSeg)) {
                results.push({ x: px, y: py })
            }
        }
    }
    return results
}

// ─── Main boundary detection ────────────────────────────────────────

function castRays(clickPoint, segments, numRays = 16) {
    const hits = []
    for (let i = 0; i < numRays; i++) {
        const angle = (2 * Math.PI * i) / numRays
        const dx = Math.cos(angle)
        const dy = Math.sin(angle)

        let bestHit = null
        for (const seg of segments) {
            let hit
            if (seg.type === 'line') {
                hit = rayLineIntersection(clickPoint.x, clickPoint.y, dx, dy, seg)
            } else if (seg.type === 'arc') {
                hit = rayArcIntersection(clickPoint.x, clickPoint.y, dx, dy, seg)
            }
            if (hit && (!bestHit || hit.t < bestHit.t)) {
                bestHit = hit
            }
        }
        if (bestHit) {
            hits.push(bestHit)
        }
    }
    return hits
}

function snapKey(x, y) {
    const factor = Math.pow(10, SNAP_DIGITS)
    return `${Math.round(x * factor)},${Math.round(y * factor)}`
}

/**
 * Build a graph of segment endpoints and intersection points,
 * then find the smallest cycle enclosing the click point.
 *
 * Returns an array of edges: [{ from: {x,y}, to: {x,y}, segIdx }]
 */
function findBoundaryPath(clickPoint, segments) {
    // Step 1: Collect all intersection and endpoint nodes per segment
    const segIntersections = new Map()
    for (let i = 0; i < segments.length; i++) {
        segIntersections.set(i, [])
    }

    // Find mid-segment intersections
    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            const s1 = segments[i], s2 = segments[j]
            let ixns = []

            if (s1.type === 'line' && s2.type === 'line') {
                ixns = lineLineIntersection(s1, s2)
            } else if (s1.type === 'line' && s2.type === 'arc') {
                ixns = lineArcIntersection(s1, s2)
            } else if (s1.type === 'arc' && s2.type === 'line') {
                ixns = lineArcIntersection(s2, s1).map(p => ({ ...p }))
            } else if (s1.type === 'arc' && s2.type === 'arc') {
                ixns = arcArcIntersection(s1, s2)
            }

            for (const ix of ixns) {
                segIntersections.get(i).push({ x: ix.x, y: ix.y })
                segIntersections.get(j).push({ x: ix.x, y: ix.y })
            }
        }
    }

    // Add segment endpoints
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        segIntersections.get(i).push({ x: seg.x1, y: seg.y1 })
        segIntersections.get(i).push({ x: seg.x2, y: seg.y2 })
    }

    // Step 2: Build adjacency graph
    const nodeMap = new Map()
    const nodes = []
    const adj = [] // adj[nodeIdx] = [{node, seg}]

    function getNodeIndex(x, y) {
        const key = snapKey(x, y)
        if (nodeMap.has(key)) return nodeMap.get(key)
        const idx = nodes.length
        nodes.push({ x, y })
        adj.push([])
        nodeMap.set(key, idx)
        return idx
    }

    for (let si = 0; si < segments.length; si++) {
        const seg = segments[si]
        const pts = segIntersections.get(si)
        if (!pts || pts.length < 2) continue

        let parameterized
        if (seg.type === 'line') {
            const dx = seg.x2 - seg.x1
            const dy = seg.y2 - seg.y1
            const len2 = dx * dx + dy * dy
            if (len2 < EPS) continue
            parameterized = pts.map(p => ({
                x: p.x, y: p.y,
                t: ((p.x - seg.x1) * dx + (p.y - seg.y1) * dy) / len2,
            }))
        } else {
            parameterized = pts.map(p => ({
                x: p.x, y: p.y,
                t: arcParameter(p.x, p.y, seg),
            }))
        }

        parameterized.sort((a, b) => a.t - b.t)

        // Deduplicate
        const unique = [parameterized[0]]
        for (let i = 1; i < parameterized.length; i++) {
            const prev = unique[unique.length - 1]
            const dist = Math.hypot(parameterized[i].x - prev.x, parameterized[i].y - prev.y)
            if (dist > 0.001) {
                unique.push(parameterized[i])
            }
        }

        for (let i = 0; i < unique.length - 1; i++) {
            const n1 = getNodeIndex(unique[i].x, unique[i].y)
            const n2 = getNodeIndex(unique[i + 1].x, unique[i + 1].y)
            if (n1 !== n2) {
                if (!adj[n1].some(e => e.node === n2 && e.seg === si)) {
                    adj[n1].push({ node: n2, seg: si })
                    adj[n2].push({ node: n1, seg: si })
                }
            }
        }
    }


    if (nodes.length < 2) {
        return null
    }

    // Step 2b: Single-pass removal of degree-1 nodes (dangling endpoints that can't form a cycle).
    // A single pass avoids cascading removals that would destroy valid boundary nodes when a
    // line crosses the boundary (e.g. a line that exits a circle).
    const toRemove = []
    for (let i = 0; i < adj.length; i++) {
        if (adj[i].length === 1) toRemove.push(i)
    }
    for (const i of toRemove) {
        for (const edge of adj[i]) {
            adj[edge.node] = adj[edge.node].filter(e => e.node !== i)
        }
        adj[i] = []
    }

    // Step 3: Try every graph edge in both orientations as a seed for traceBoundary.
    // Ray-casting to find the "nearest" edge is unreliable for curved regions (e.g. crescents)
    // because the click's nearest arc crossing may not bound the desired face.
    // The graph is small (< ~20 nodes), so exhaustive seeding is fast.
    let bestResult = null
    let bestArea = Infinity

    for (let ni = 0; ni < nodes.length; ni++) {
        if (adj[ni].length === 0) continue
        for (const edge of adj[ni]) {
            if (edge.node <= ni) continue // each undirected edge once
            const n1 = ni, n2 = edge.node
            const seg = segments[edge.seg]

            // Both directed orientations of this edge → both adjacent faces
            const pairs = [
                { startNode: n1, incomingAngle: edgeDepartureAngle(n1, n2, nodes, seg) + Math.PI },
                { startNode: n2, incomingAngle: edgeDepartureAngle(n2, n1, nodes, seg) + Math.PI },
            ]
            for (const { startNode, incomingAngle } of pairs) {
                const result = traceBoundary(nodes, adj, segments, startNode, incomingAngle)
                if (result && result.length >= 2 && verifyPointInside(clickPoint, result, segments)) {
                    const area = boundaryArea(result, segments)
                    if (area < bestArea) {
                        bestArea = area
                        bestResult = result
                    }
                }
            }
        }
    }

    return bestResult
}

/**
 * Compute enclosed area using the shoelace formula on a sampled polygon.
 */
function boundaryArea(edges, segments) {
    const pts = sampleBoundary(edges, segments)
    let sum = 0
    for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length
        sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y
    }
    return Math.abs(sum) / 2
}

/**
 * Returns true if point p lies between n1 and n2 along seg.
 * For lines: uses dot-product parameter. For arcs: uses angular containment
 * with traversal direction determined geometrically (nudge), avoiding arcParameter
 * which is broken for ccw=false arcs where endAngle > startAngle.
 */
function subEdgeContains(seg, n1, n2, p) {
    if (seg.type === 'line') {
        const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1
        const len2 = dx * dx + dy * dy
        if (len2 < EPS) return false
        const t1 = ((n1.x - seg.x1) * dx + (n1.y - seg.y1) * dy) / len2
        const t2 = ((n2.x - seg.x1) * dx + (n2.y - seg.y1) * dy) / len2
        const tp = ((p.x  - seg.x1) * dx + (p.y  - seg.y1) * dy) / len2
        const lo = Math.min(t1, t2), hi = Math.max(t1, t2)
        return tp >= lo - 1e-4 && tp <= hi + 1e-4
    }
    // Arc: determine traversal direction by sampling the CCW midpoint between n1 and n2
    // and testing if it lies on the segment. isPointOnArc is the authoritative test —
    // it uses the segment's own ccw/startAngle/endAngle, so it handles all conventions.
    // A geometric nudge fails for arcs spanning ~180° (equidistant test points).
    const { cx, cy, r } = seg
    const fa = Math.atan2(n1.y - cy, n1.x - cx)
    const ta = Math.atan2(n2.y - cy, n2.x - cx)
    const pa = Math.atan2(p.y  - cy, p.x  - cx)
    let ccwSweep = ta - fa
    if (ccwSweep <= 0) ccwSweep += 2 * Math.PI
    const midCCW = fa + ccwSweep / 2
    const midPt = { x: cx + r * Math.cos(midCCW), y: cy + r * Math.sin(midCCW) }
    const goingCCW = isPointOnArc(midPt.x, midPt.y, seg)
    return isAngleInRange(pa, fa, ta, goingCCW)
}

/**
 * Get the departure tangent angle leaving fromNode toward toNode along seg.
 * For lines this is the chord direction. For arcs it is the true tangent at
 * fromNode — chord direction is wrong for large arcs (can point nearly backward).
 */
function edgeDepartureAngle(fromNode, toNode, nodes, seg) {
    if (seg.type !== 'arc') {
        return Math.atan2(
            nodes[toNode].y - nodes[fromNode].y,
            nodes[toNode].x - nodes[fromNode].x
        )
    }
    const { cx, cy, r } = seg
    const fx = nodes[fromNode].x, fy = nodes[fromNode].y
    const fa = Math.atan2(fy - cy, fx - cx)
    const ta = Math.atan2(nodes[toNode].y - cy, nodes[toNode].x - cx)
    // Sample CCW midpoint and test if it lies on the segment — same approach as subEdgeContains.
    let ccwSweep = ta - fa
    if (ccwSweep <= 0) ccwSweep += 2 * Math.PI
    const midCCW = fa + ccwSweep / 2
    const midPt = { x: cx + r * Math.cos(midCCW), y: cy + r * Math.sin(midCCW) }
    const goingCCW = isPointOnArc(midPt.x, midPt.y, seg)
    return goingCCW ? fa + Math.PI / 2 : fa - Math.PI / 2
}

/**
 * Trace boundary using rightmost-turn algorithm.
 * Uses arc tangents (not chords) for direction comparisons so large arcs
 * don't cause wrong face selection.
 * Returns array of edges: [{ fromNode, toNode, segIdx }]
 */
function traceBoundary(nodes, adj, segments, startNode, incomingAngle) {
    const edges = []
    let currentNode = startNode
    let prevNode = -1
    let prevSeg = -1
    let prevAngle = incomingAngle

    for (let step = 0; step < 1000; step++) {
        const neighbors = adj[currentNode]
        if (neighbors.length === 0) return null

        let bestNext = -1
        let bestSeg = -1
        let bestAngle = Infinity

        const reverseAngle = normalizeAngle(prevAngle + Math.PI)

        for (const edge of neighbors) {
            // Don't retrace the segment we just arrived on (avoids getting stuck
            // on parallel edges, e.g. the two half-arcs of a full circle)
            if (edge.node === prevNode && edge.seg === prevSeg) continue

            const seg = segments[edge.seg]
            const edgeAngle = edgeDepartureAngle(currentNode, edge.node, nodes, seg)

            let turn = normalizeAngle(edgeAngle - reverseAngle)
            if (turn < EPS) turn += 2 * Math.PI

            if (turn < bestAngle) {
                bestAngle = turn
                bestNext = edge.node
                bestSeg = edge.seg
            }
        }

        if (bestNext < 0) return null

        edges.push({
            fromNode: currentNode,
            toNode: bestNext,
            segIdx: bestSeg,
            from: nodes[currentNode],
            to: nodes[bestNext],
        })

        // Arrival angle at bestNext = tangent AT bestNext in the traversal direction.
        // For curved arcs, the tangent rotates along the arc, so we must evaluate at
        // the destination node — not the source. edgeDepartureAngle(bestNext, currentNode)
        // gives the tangent at bestNext going TOWARD currentNode; adding π reverses it to
        // give the direction we're actually traveling when we arrive at bestNext.
        prevAngle = edgeDepartureAngle(bestNext, currentNode, nodes, segments[bestSeg]) + Math.PI

        prevNode = currentNode
        prevSeg = bestSeg

        if (bestNext === startNode) {
            return edges // Closed loop
        }

        // Check for non-initial loops
        if (edges.length > 1 && edges.slice(0, -1).some(e => e.fromNode === bestNext)) {
            return null
        }

        currentNode = bestNext
    }

    return null
}

/**
 * Sample a boundary into a dense polygon, including arc curvature.
 * Returns array of {x, y} points (one point per ~22.5° for arcs).
 */
function sampleBoundary(edges, segments) {
    const pts = []
    for (const edge of edges) {
        pts.push(edge.from)
        const seg = segments[edge.segIdx]
        if (seg.type === 'arc') {
            const { cx, cy, r } = seg
            const fa = Math.atan2(edge.from.y - cy, edge.from.x - cx)
            const ta = Math.atan2(edge.to.y   - cy, edge.to.x   - cx)
            // Determine traversal direction using the authoritative midpoint test
            // (same approach as subEdgeContains/edgeDepartureAngle).
            let ccwSweep = ta - fa
            if (ccwSweep <= 0) ccwSweep += 2 * Math.PI
            const midCCW = fa + ccwSweep / 2
            const midPt = { x: cx + r * Math.cos(midCCW), y: cy + r * Math.sin(midCCW) }
            const goingCCW = isPointOnArc(midPt.x, midPt.y, seg)
            let span = goingCCW ? ccwSweep : (2 * Math.PI - ccwSweep)
            if (span <= 0) span += 2 * Math.PI
            const steps = Math.max(4, Math.ceil(span / (Math.PI / 8)))
            for (let i = 1; i < steps; i++) {
                const a = goingCCW
                    ? fa + (span * i / steps)
                    : fa - (span * i / steps)
                pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
            }
        }
    }
    return pts
}

/**
 * Verify that the click point is inside the boundary using a polygon-based
 * point-in-polygon test. Arcs are sampled into line segments — no arc
 * direction logic needed, eliminating a whole class of sign bugs.
 */
function verifyPointInside(clickPoint, boundaryEdges, segments) {
    const pts = sampleBoundary(boundaryEdges, segments)
    if (pts.length < 3) return false
    return pointInPolygon(clickPoint, pts)
}

/** Point-in-polygon test (even-odd ray casting). */
function pointInPolygon(point, polygon) {
    const ox = point.x, oy = point.y
    let crossings = 0
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]
        const b = polygon[(i + 1) % polygon.length]
        if ((a.y <= oy && b.y > oy) || (b.y <= oy && a.y > oy)) {
            const t = (oy - a.y) / (b.y - a.y)
            if (ox < a.x + t * (b.x - a.x)) {
                crossings++
            }
        }
    }
    return (crossings % 2) === 1
}

function isAngleInRange(angle, from, to, ccw) {
    if (ccw) {
        let sweep = to - from
        if (sweep < 0) sweep += 2 * Math.PI
        let diff = angle - from
        if (diff < 0) diff += 2 * Math.PI
        return diff <= sweep + 1e-4
    } else {
        let sweep = from - to
        if (sweep < 0) sweep += 2 * Math.PI
        let diff = from - angle
        if (diff < 0) diff += 2 * Math.PI
        return diff <= sweep + 1e-4
    }
}

function normalizeAngle(a) {
    while (a < 0) a += 2 * Math.PI
    while (a >= 2 * Math.PI) a -= 2 * Math.PI
    return a
}

// ─── Island (hole) detection ────────────────────────────────────────

/**
 * Return outline info for a closed element, or null if it isn't closed.
 * Returns { samplePoints: [{x,y}], pathD: string }
 */
function getClosedElementInfo(el) {
    if (el.type === 'circle') {
        const cx = el.cx(), cy = el.cy(), r = el.attr('r') || el.radius()
        const samplePoints = []
        for (let i = 0; i < 24; i++) {
            const a = (2 * Math.PI * i) / 24
            samplePoints.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
        }
        const pathD = `M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} Z`
        return { samplePoints, pathD }
    }

    if (el.type === 'ellipse') {
        const cx = el.cx(), cy = el.cy()
        const rx = el.attr('rx') || el.rx()
        const ry = el.attr('ry') || el.ry()
        const samplePoints = []
        for (let i = 0; i < 24; i++) {
            const a = (2 * Math.PI * i) / 24
            samplePoints.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) })
        }
        const pathD = `M ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} Z`
        return { samplePoints, pathD }
    }

    if (el.type === 'rect') {
        const x = el.x(), y = el.y(), w = el.width(), h = el.height()
        if (w < EPS || h < EPS) return null
        const x2 = x + w, y2 = y + h
        const samplePoints = [
            { x, y }, { x: x2, y }, { x: x2, y: y2 }, { x, y: y2 },
        ]
        const pathD = `M ${x} ${y} L ${x2} ${y} L ${x2} ${y2} L ${x} ${y2} Z`
        return { samplePoints, pathD }
    }

    if (el.type === 'polygon') {
        const pts = el.array()
        if (pts.length < 3) return null
        const samplePoints = pts.map(p => ({ x: p[0], y: p[1] }))
        let pathD = `M ${pts[0][0]} ${pts[0][1]}`
        for (let i = 1; i < pts.length; i++) pathD += ` L ${pts[i][0]} ${pts[i][1]}`
        pathD += ' Z'
        return { samplePoints, pathD }
    }

    if (el.type === 'polyline') {
        const pts = el.array()
        if (pts.length < 3) return null
        const first = pts[0], last = pts[pts.length - 1]
        if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 0.1) return null
        const samplePoints = pts.slice(0, -1).map(p => ({ x: p[0], y: p[1] }))
        let pathD = `M ${pts[0][0]} ${pts[0][1]}`
        for (let i = 1; i < pts.length - 1; i++) pathD += ` L ${pts[i][0]} ${pts[i][1]}`
        pathD += ' Z'
        return { samplePoints, pathD }
    }

    if (el.type === 'path') {
        const splineData = el.data('splineData')
        if (splineData && splineData.points && splineData.points.length >= 3) {
            const pts = splineData.points
            const first = pts[0], last = pts[pts.length - 1]
            if (Math.hypot(first.x - last.x, first.y - last.y) > 0.1) return null
            const sampled = sampleCatmullRomSpline(pts, SPLINE_SAMPLES_PER_SEGMENT)
            const samplePoints = sampled.slice(0, -1)
            let pathD = `M ${samplePoints[0].x} ${samplePoints[0].y}`
            for (let i = 1; i < samplePoints.length; i++) pathD += ` L ${samplePoints[i].x} ${samplePoints[i].y}`
            pathD += ' Z'
            return { samplePoints, pathD }
        }
    }

    return null
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Find the enclosing boundary for a hatch, given a click point.
 * Returns an array of edges: [{ from, to, segIdx }] or null.
 */
export function findEnclosingBoundary(editor, clickPoint) {
    const segments = extractSegments(editor)
    if (segments.length === 0) return null

    const testHits = castRays(clickPoint, segments, 8)
    if (testHits.length < 3) return null

    return findBoundaryPath(clickPoint, segments)
}

/**
 * Convert boundary edges to an SVG path 'd' attribute string.
 * Handles both line and arc edges properly.
 */
export function boundaryToPathD(boundaryEdges, segments) {
    if (!boundaryEdges || boundaryEdges.length < 2) return null

    const first = boundaryEdges[0]
    let d = `M ${first.from.x} ${first.from.y}`

    for (const edge of boundaryEdges) {
        const seg = segments[edge.segIdx]

        if (seg.type === 'line') {
            d += ` L ${edge.to.x} ${edge.to.y}`
        } else if (seg.type === 'arc') {
            // SVG arc: A rx ry x-rotation large-arc-flag sweep-flag x y
            const r = seg.r

            // Determine traversal direction using the same midpoint test
            // as sampleBoundary / edgeDepartureAngle — the endpoint-distance
            // heuristic is unreliable for sub-arcs in the middle of a semicircle.
            const { cx, cy } = seg
            const fa = Math.atan2(edge.from.y - cy, edge.from.x - cx)
            const ta = Math.atan2(edge.to.y - cy, edge.to.x - cx)
            let ccwSweep = ta - fa
            if (ccwSweep <= 0) ccwSweep += 2 * Math.PI
            const midCCW = fa + ccwSweep / 2
            const midPt = { x: cx + r * Math.cos(midCCW), y: cy + r * Math.sin(midCCW) }
            const goingCCW = isPointOnArc(midPt.x, midPt.y, seg)

            const angularSpan = goingCCW ? ccwSweep : (2 * Math.PI - ccwSweep)
            const largeArc = angularSpan > Math.PI ? 1 : 0
            const sweepFlag = goingCCW ? 1 : 0

            d += ` A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${edge.to.x} ${edge.to.y}`
        }
    }

    d += ' Z'
    return d
}

/**
 * Find closed elements (islands) inside the outer boundary that should
 * become holes in the hatch. Returns an array of SVG sub-path strings.
 */
export function findIslands(editor, outerBoundary, segments, clickPoint) {
    const outerPoly = sampleBoundary(outerBoundary, segments)
    if (outerPoly.length < 3) return []

    // Elements that form the outer boundary should not be treated as islands
    const boundaryElements = new Set()
    for (const edge of outerBoundary) {
        boundaryElements.add(segments[edge.segIdx].element)
    }

    const islands = []
    const elements = getDrawableElements(editor)

    for (const el of elements) {
        if (el.hasClass('grid') || el.hasClass('axis') || el.hasClass('ghostLine')) continue
        if (el.hasClass('hatch-fill')) continue
        if (boundaryElements.has(el)) continue

        const info = getClosedElementInfo(el)
        if (!info) continue

        const { samplePoints, pathD } = info

        // All perimeter points must be inside the outer boundary
        if (!samplePoints.every(p => pointInPolygon(p, outerPoly))) continue

        // The click point must NOT be inside this island
        if (pointInPolygon(clickPoint, samplePoints)) continue

        islands.push(pathD)
    }

    return islands
}
