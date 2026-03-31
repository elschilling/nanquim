/**
 * Boundary detection for hatch command.
 * Given a click point, finds the enclosing closed boundary formed by
 * drawing elements (lines, arcs, circles, polygons, rects, paths).
 */

import { getDrawableElements } from '../Collection'
import { getArcGeometry } from './arcUtils'

const EPS = 1e-6
const SNAP_DIGITS = 3 // Round to 1e-3 for node merging

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

    // Step 3: Find the nearest edge to the click point via ray cast
    let bestEdgeHit = null
    const rayDx = 1, rayDy = 0

    for (let si = 0; si < segments.length; si++) {
        const seg = segments[si]
        let hit
        if (seg.type === 'line') {
            hit = rayLineIntersection(clickPoint.x, clickPoint.y, rayDx, rayDy, seg)
        } else if (seg.type === 'arc') {
            hit = rayArcIntersection(clickPoint.x, clickPoint.y, rayDx, rayDy, seg)
        }
        if (hit && (!bestEdgeHit || hit.t < bestEdgeHit.t)) {
            bestEdgeHit = { ...hit, segIdx: si }
        }
    }

    if (!bestEdgeHit) {
        return null
    }

    const hitSegIdx = bestEdgeHit.segIdx
    const pts = segIntersections.get(hitSegIdx) || []
    const nodeDistances = []

    for (const p of pts) {
        const ni = getNodeIndex(p.x, p.y)
        const d = Math.hypot(nodes[ni].x - bestEdgeHit.x, nodes[ni].y - bestEdgeHit.y)
        if (!nodeDistances.some(nd => nd.ni === ni)) {
            nodeDistances.push({ ni, d })
        }
    }
    nodeDistances.sort((a, b) => a.d - b.d)

    // Try tracing from multiple start nodes
    for (const { ni: startNode } of nodeDistances.slice(0, 4)) {
        if (adj[startNode].length === 0) continue

        const incomingAngle = Math.atan2(
            nodes[startNode].y - clickPoint.y,
            nodes[startNode].x - clickPoint.x
        )

        const result = traceBoundary(nodes, adj, segments, startNode, incomingAngle)

        if (result && result.length >= 2) {
            if (verifyPointInside(clickPoint, result, segments)) {
                return result
            }
        }
    }

    return null
}

/**
 * Trace boundary using rightmost-turn algorithm.
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

            const nx = nodes[edge.node]
            const edgeAngle = Math.atan2(nx.y - nodes[currentNode].y, nx.x - nodes[currentNode].x)

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

        prevAngle = Math.atan2(
            nodes[bestNext].y - nodes[currentNode].y,
            nodes[bestNext].x - nodes[currentNode].x
        )

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
 * Verify that the click point is inside the boundary by counting
 * ray crossings in multiple directions.
 */
function verifyPointInside(clickPoint, boundaryEdges, segments) {
    // Use the boundary edges to build segment list for ray testing
    let insideCount = 0
    const testRays = 8

    for (let i = 0; i < testRays; i++) {
        const angle = (2 * Math.PI * i) / testRays + 0.1 // offset to avoid hitting nodes
        const dx = Math.cos(angle)
        const dy = Math.sin(angle)

        let crossings = 0
        for (const edge of boundaryEdges) {
            const seg = segments[edge.segIdx]
            // Build a sub-segment from edge.from to edge.to
            if (seg.type === 'line') {
                const subSeg = { type: 'line', x1: edge.from.x, y1: edge.from.y, x2: edge.to.x, y2: edge.to.y }
                const hit = rayLineIntersection(clickPoint.x, clickPoint.y, dx, dy, subSeg)
                if (hit) crossings++
            } else if (seg.type === 'arc') {
                // For arc edges, test against the full arc's circle and check angular range
                const hit = rayArcIntersectionSub(clickPoint.x, clickPoint.y, dx, dy, seg, edge.from, edge.to)
                crossings += hit
            }
        }

        if (crossings % 2 === 1) insideCount++
    }

    return insideCount >= testRays / 2
}

/**
 * Count ray crossings with an arc sub-segment (from point A to point B on the arc).
 */
function rayArcIntersectionSub(ox, oy, dx, dy, arcSeg, fromPt, toPt) {
    const { cx, cy, r } = arcSeg
    const fx = ox - cx
    const fy = oy - cy
    const a = dx * dx + dy * dy
    const b = 2 * (fx * dx + fy * dy)
    const c = fx * fx + fy * fy - r * r
    const disc = b * b - 4 * a * c
    if (disc < 0) return 0

    const sqrtDisc = Math.sqrt(disc)
    let count = 0

    // Compute angle range of the sub-arc from fromPt to toPt
    let fromAngle = Math.atan2(fromPt.y - cy, fromPt.x - cx)
    let toAngle = Math.atan2(toPt.y - cy, toPt.x - cx)
    if (fromAngle < 0) fromAngle += 2 * Math.PI
    if (toAngle < 0) toAngle += 2 * Math.PI

    for (const sign of [-1, 1]) {
        const t = (-b + sign * sqrtDisc) / (2 * a)
        if (t <= EPS) continue
        const px = ox + t * dx
        const py = oy + t * dy
        let angle = Math.atan2(py - cy, px - cx)
        if (angle < 0) angle += 2 * Math.PI

        // Check if angle is within the sub-arc range
        // Use the parent arc's ccw to determine sweep direction
        if (isAngleInRange(angle, fromAngle, toAngle, arcSeg.ccw)) {
            count++
        }
    }
    return count
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

            // Check if the boundary edge traverses the arc in the same direction
            // as the segment's original direction (x1,y1 → x2,y2) or reversed.
            // Compare edge.from to the segment's start point (x1,y1).
            const distToStart = Math.hypot(edge.from.x - seg.x1, edge.from.y - seg.y1)
            const distToEnd = Math.hypot(edge.from.x - seg.x2, edge.from.y - seg.y2)
            const isReversed = distToEnd < distToStart

            // Effective ccw for this edge direction
            const effectiveCCW = isReversed ? !seg.ccw : seg.ccw

            let fromAngle = Math.atan2(edge.from.y - seg.cy, edge.from.x - seg.cx)
            let toAngle = Math.atan2(edge.to.y - seg.cy, edge.to.x - seg.cx)
            if (fromAngle < 0) fromAngle += 2 * Math.PI
            if (toAngle < 0) toAngle += 2 * Math.PI

            // Calculate angular span following the effective direction
            let angularSpan
            if (effectiveCCW) {
                angularSpan = toAngle - fromAngle
                if (angularSpan < 0) angularSpan += 2 * Math.PI
            } else {
                angularSpan = fromAngle - toAngle
                if (angularSpan < 0) angularSpan += 2 * Math.PI
            }

            const largeArc = angularSpan > Math.PI ? 1 : 0
            // SVG sweep-flag: 1 = CW in screen coords (Y down)
            // In this app Y increases downward in SVG, so CCW math = CCW SVG
            const sweepFlag = effectiveCCW ? 1 : 0

            d += ` A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${edge.to.x} ${edge.to.y}`
        }
    }

    d += ' Z'
    return d
}
