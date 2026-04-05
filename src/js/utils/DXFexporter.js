import { getArcGeometry } from './arcUtils'

// ─── ACI colour helpers ────────────────────────────────────────────────────

// Standard AutoCAD Color Index palette (index → [r, g, b])
// Covers the nine "primary" ACI slots plus common 10-249 values.
const ACI_PALETTE = [
    [255, 0, 0, 1],
    [255, 255, 0, 2],
    [0, 255, 0, 3],
    [0, 255, 255, 4],
    [0, 0, 255, 5],
    [255, 0, 255, 6],
    [255, 255, 255, 7],
    [128, 128, 128, 8],
    [192, 192, 192, 9],
    [255, 0, 0, 10],
    [255, 127, 127, 11],
    [165, 0, 0, 12],
    [165, 82, 82, 13],
    [127, 0, 0, 14],
    [255, 63, 0, 30],
    [255, 191, 0, 40],
    [127, 255, 0, 70],
    [0, 255, 63, 90],
    [0, 255, 127, 100],
    [0, 127, 255, 150],
    [0, 63, 255, 160],
    [127, 0, 255, 170],
    [255, 0, 127, 210],
    [255, 0, 63, 220],
]

function parseColor(color) {
    if (!color) return [255, 255, 255]
    const s = color.trim().toLowerCase()
    // Named colors
    const named = { white: [255,255,255], black: [0,0,0], red: [255,0,0],
        green: [0,128,0], lime: [0,255,0], blue: [0,0,255], yellow: [255,255,0],
        cyan: [0,255,255], aqua: [0,255,255], magenta: [255,0,255],
        fuchsia: [255,0,255], gray: [128,128,128], grey: [128,128,128],
        silver: [192,192,192], orange: [255,165,0], purple: [128,0,128] }
    if (named[s]) return named[s]
    // #rrggbb
    let m = s.match(/^#([0-9a-f]{6})$/)
    if (m) {
        const v = parseInt(m[1], 16)
        return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
    }
    // #rgb
    m = s.match(/^#([0-9a-f]{3})$/)
    if (m) {
        return [
            parseInt(m[1][0] + m[1][0], 16),
            parseInt(m[1][1] + m[1][1], 16),
            parseInt(m[1][2] + m[1][2], 16),
        ]
    }
    // rgb(r,g,b)
    m = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/)
    if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]
    return [255, 255, 255]
}

function hexToAci(color) {
    const [r, g, b] = parseColor(color)
    let best = 7, bestDist = Infinity
    for (const [pr, pg, pb, idx] of ACI_PALETTE) {
        const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
        if (dist < bestDist) { bestDist = dist; best = idx }
    }
    return best
}

// ─── Catmull-Rom sampler (for spline → LWPOLYLINE fallback) ────────────────

function sampleCatmullRom(points, samplesPerSegment = 20) {
    if (points.length < 2) return points
    const ext = [
        { x: 2 * points[0].x - points[1].x, y: 2 * points[0].y - points[1].y },
        ...points,
    ]
    const n = points.length
    ext.push({ x: 2 * points[n - 1].x - points[n - 2].x, y: 2 * points[n - 1].y - points[n - 2].y })

    const result = []
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = ext[i], p1 = ext[i + 1], p2 = ext[i + 2], p3 = ext[i + 3]
        for (let s = 0; s < samplesPerSegment; s++) {
            const t = s / samplesPerSegment
            const t2 = t * t, t3 = t2 * t
            result.push({
                x: 0.5 * ((2*p1.x) + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
                y: 0.5 * ((2*p1.y) + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
            })
        }
    }
    result.push(points[n - 1])
    return result
}

// ─── Sanitise a string for use as a DXF layer name ─────────────────────────

function sanitizeLayerName(name) {
    return (name || '0').replace(/[<>/\\:;?*|=`]/g, '_').substring(0, 255) || '0'
}

// ─── DXFExporter ──────────────────────────────────────────────────────────

function DXFExporter(editor) {
    this.saveFile = function (filename = 'drawing.dxf') {
        const lines = []
        let handleCounter = 1
        const nextHandle = () => (handleCounter++).toString(16).toUpperCase().padStart(2, '0')

        // Emit one DXF group-code/value pair
        function emit(code, value) {
            lines.push(String(code))
            lines.push(String(value))
        }

        // ── coordinate helpers ──────────────────────────────────────────────
        function fy(y) { return -y } // SVG Y-down → DXF Y-up
        function toDeg(rad) { return rad * 180 / Math.PI }
        function normAngle(deg) { deg %= 360; return deg < 0 ? deg + 360 : deg }

        // ── entity helpers ──────────────────────────────────────────────────
        function beginEntity(type, layerName) {
            emit(0, type)
            emit(5, nextHandle())
            emit(100, 'AcDbEntity')
            emit(8, layerName)
        }

        // ── layer name for an element (walks up to collection) ──────────────
        function layerOf(el) {
            let cur = el.parent()
            while (cur && cur.node && cur.node.nodeName !== 'svg') {
                if (cur.attr('data-collection') === 'true') {
                    return sanitizeLayerName(cur.attr('name') || cur.attr('id'))
                }
                cur = cur.parent()
            }
            return '0'
        }

        // ── collect layer info from collections ─────────────────────────────
        const layers = []
        editor.collections.forEach((data, id) => {
            layers.push({
                name: sanitizeLayerName(data.group.attr('name') || id),
                aci:  hexToAci(data.style.stroke || 'white'),
            })
        })

        // ════════════════════════════════════════════════════════════════════
        // HEADER
        // ════════════════════════════════════════════════════════════════════
        emit(0, 'SECTION')
        emit(2, 'HEADER')
        emit(9, '$ACADVER')
        emit(1, 'AC1015')
        emit(9, '$INSUNITS')
        emit(70, 5)   // centimetres
        emit(9, '$MEASUREMENT')
        emit(70, 1)   // metric
        emit(0, 'ENDSEC')

        // ════════════════════════════════════════════════════════════════════
        // TABLES
        // ════════════════════════════════════════════════════════════════════
        emit(0, 'SECTION')
        emit(2, 'TABLES')

        // LTYPE table — only "Continuous" needed
        emit(0, 'TABLE')
        emit(2, 'LTYPE')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTable')
        emit(70, 1)
        emit(0, 'LTYPE')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTableRecord')
        emit(100, 'AcDbLinetypeTableRecord')
        emit(2, 'Continuous')
        emit(70, 0)
        emit(3, 'Solid line')
        emit(72, 65)
        emit(73, 0)
        emit(40, 0.0)
        emit(0, 'ENDTAB')

        // LAYER table
        emit(0, 'TABLE')
        emit(2, 'LAYER')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTable')
        emit(70, layers.length)
        layers.forEach(layer => {
            emit(0, 'LAYER')
            emit(5, nextHandle())
            emit(100, 'AcDbSymbolTableRecord')
            emit(100, 'AcDbLayerTableRecord')
            emit(2, layer.name)
            emit(70, 0)
            emit(62, layer.aci)
            emit(6, 'Continuous')
        })
        emit(0, 'ENDTAB')

        // STYLE table — minimal Standard style for TEXT entities
        emit(0, 'TABLE')
        emit(2, 'STYLE')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTable')
        emit(70, 1)
        emit(0, 'STYLE')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTableRecord')
        emit(100, 'AcDbTextStyleTableRecord')
        emit(2, 'Standard')
        emit(70, 0)
        emit(40, 0.0)
        emit(41, 1.0)
        emit(50, 0.0)
        emit(71, 0)
        emit(42, 2.5)
        emit(3, 'txt')
        emit(4, '')
        emit(0, 'ENDTAB')

        emit(0, 'ENDSEC')

        // ════════════════════════════════════════════════════════════════════
        // BLOCKS — required stub for *Model_Space
        // ════════════════════════════════════════════════════════════════════
        emit(0, 'SECTION')
        emit(2, 'BLOCKS')
        const blockHandle = nextHandle()
        emit(0, 'BLOCK')
        emit(5, blockHandle)
        emit(100, 'AcDbEntity')
        emit(8, '0')
        emit(100, 'AcDbBlockBegin')
        emit(2, '*Model_Space')
        emit(70, 0)
        emit(10, 0.0); emit(20, 0.0); emit(30, 0.0)
        emit(3, '*Model_Space')
        emit(1, '')
        emit(0, 'ENDBLK')
        emit(5, nextHandle())
        emit(100, 'AcDbEntity')
        emit(8, '0')
        emit(100, 'AcDbBlockEnd')
        emit(0, 'ENDSEC')

        // ════════════════════════════════════════════════════════════════════
        // ENTITIES
        // ════════════════════════════════════════════════════════════════════
        emit(0, 'SECTION')
        emit(2, 'ENTITIES')

        editor.collections.forEach((data) => {
            const layerName = sanitizeLayerName(data.group.attr('name') || data.group.attr('id'))
            walkGroup(data.group, layerName)
        })

        emit(0, 'ENDSEC')
        emit(0, 'EOF')

        // ── download ────────────────────────────────────────────────────────
        const content = lines.join('\r\n') + '\r\n'
        const blob = new Blob([content], { type: 'application/dxf' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        editor.signals.terminalLogged.dispatch({ type: 'span', msg: 'DXF exported: ' + filename })

        // ════════════════════════════════════════════════════════════════════
        // Entity emitters
        // ════════════════════════════════════════════════════════════════════

        function walkGroup(parent, layerName) {
            parent.children().each(el => {
                if (el.type === 'g') {
                    walkGroup(el, layerName)
                } else {
                    emitElement(el, layerName)
                }
            })
        }

        function emitElement(el, layerName) {
            switch (el.type) {
                case 'line':     return emitLine(el, layerName)
                case 'circle':   return emitCircle(el, layerName)
                case 'ellipse':  return emitEllipse(el, layerName)
                case 'rect':     return emitRect(el, layerName)
                case 'polyline':
                case 'polygon':  return emitPolyline(el, layerName, el.type === 'polygon')
                case 'path':     return emitPath(el, layerName)
                case 'text':     return emitText(el, layerName)
                default: break
            }
        }

        function emitLine(el, layerName) {
            beginEntity('LINE', layerName)
            emit(100, 'AcDbLine')
            emit(10, el.attr('x1')); emit(20, fy(el.attr('y1'))); emit(30, 0)
            emit(11, el.attr('x2')); emit(21, fy(el.attr('y2'))); emit(31, 0)
        }

        function emitCircle(el, layerName) {
            beginEntity('CIRCLE', layerName)
            emit(100, 'AcDbCircle')
            emit(10, el.cx()); emit(20, fy(el.cy())); emit(30, 0)
            emit(40, el.radius())
        }

        function emitEllipse(el, layerName) {
            const cx = el.cx(), cy = el.cy()
            const rx = el.rx(), ry = el.ry()
            beginEntity('ELLIPSE', layerName)
            emit(100, 'AcDbEllipse')
            emit(10, cx); emit(20, fy(cy)); emit(30, 0)
            if (rx >= ry) {
                emit(11, rx); emit(21, 0); emit(31, 0)
                emit(40, rx > 0 ? ry / rx : 1)
            } else {
                emit(11, 0); emit(21, ry); emit(31, 0)
                emit(40, ry > 0 ? rx / ry : 1)
            }
            emit(41, 0.0)
            emit(42, 6.283185307179586)
        }

        function emitRect(el, layerName) {
            const x = el.x(), y = el.y(), w = el.width(), h = el.height()
            const verts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
            beginEntity('LWPOLYLINE', layerName)
            emit(100, 'AcDbPolyline')
            emit(90, 4)
            emit(70, 1)  // closed
            emit(43, 0)
            verts.forEach(([px, py]) => { emit(10, px); emit(20, fy(py)) })
        }

        function emitPolyline(el, layerName, closed) {
            const pts = el.array()
            beginEntity('LWPOLYLINE', layerName)
            emit(100, 'AcDbPolyline')
            emit(90, pts.length)
            emit(70, closed ? 1 : 0)
            emit(43, 0)
            pts.forEach(p => { emit(10, p[0]); emit(20, fy(p[1])) })
        }

        function emitPath(el, layerName) {
            if (el.data('arcData')) {
                emitArc(el, layerName)
            } else if (el.data('splineData')) {
                emitSplinePath(el, layerName)
            }
            // Other path types (circleTrimData, dimension geometry, hatches) skipped
        }

        function emitArc(el, layerName) {
            const ad = el.data('arcData')
            const geo = getArcGeometry(ad.p1, ad.p2, ad.p3)
            if (!geo) return

            const { cx, cy, radius, theta1, theta3, ccw } = geo

            // Y-flip maps SVG angle θ → DXF angle -θ.
            // DXF always draws arcs CCW from startAngle to endAngle.
            // A CCW arc in SVG (Y-down) becomes CW in DXF (Y-up), so swap endpoints.
            let startDeg, endDeg
            if (ccw) {
                startDeg = normAngle(toDeg(-theta3))
                endDeg   = normAngle(toDeg(-theta1))
            } else {
                startDeg = normAngle(toDeg(-theta1))
                endDeg   = normAngle(toDeg(-theta3))
            }

            beginEntity('ARC', layerName)
            emit(100, 'AcDbCircle')
            emit(10, cx); emit(20, fy(cy)); emit(30, 0)
            emit(40, radius)
            emit(100, 'AcDbArc')
            emit(50, startDeg)
            emit(51, endDeg)
        }

        function emitSplinePath(el, layerName) {
            const sd = el.data('splineData')
            if (!sd || !sd.points || sd.points.length < 2) return

            // Sample the Catmull-Rom curve and emit as LWPOLYLINE — this preserves
            // the exact visual shape without any B-spline knot vector arithmetic.
            const sampled = sampleCatmullRom(sd.points)
            beginEntity('LWPOLYLINE', layerName)
            emit(100, 'AcDbPolyline')
            emit(90, sampled.length)
            emit(70, 0)  // open
            emit(43, 0)
            sampled.forEach(p => { emit(10, p.x); emit(20, fy(p.y)) })
        }

        function emitText(el, layerName) {
            const node = el.node
            // SVG.js places text using move(x,y) which sets the x/y attributes
            const x = parseFloat(node.getAttribute('x')) || 0
            const y = parseFloat(node.getAttribute('y')) || 0
            const raw = node.textContent || ''
            // SVG.js wraps text in <tspan> children; flatten to plain string
            const content = raw.replace(/\s+/g, ' ').trim()
            const fontSize = parseFloat(el.css('font-size')) || 2.5

            // Extract rotation from transform="rotate(deg cx cy)" if present
            let rotation = 0
            const xform = node.getAttribute('transform') || ''
            const rm = xform.match(/rotate\(\s*([-\d.]+)/)
            if (rm) rotation = -parseFloat(rm[1]) // negate: SVG CW → DXF CCW

            beginEntity('TEXT', layerName)
            emit(100, 'AcDbText')
            emit(10, x); emit(20, fy(y)); emit(30, 0)
            emit(40, fontSize)
            emit(1, content)
            if (rotation !== 0) emit(50, normAngle(rotation))
            // Text anchor → DXF horizontal justification (72)
            const anchor = node.getAttribute('text-anchor') || 'start'
            if (anchor === 'middle') { emit(72, 1); emit(11, x); emit(21, fy(y)); emit(31, 0) }
            else if (anchor === 'end') { emit(72, 2); emit(11, x); emit(21, fy(y)); emit(31, 0) }
            emit(100, 'AcDbText')
        }
    }
}

export { DXFExporter }
