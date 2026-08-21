import { getArcGeometry } from './arcUtils'
import { bakeTransforms } from './transformGeometry'

const MAX_DXF_COORDINATE = 1000000000

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
    return String(name || '0')
        .replace(/[\u0000-\u001f\u007f<>/\\:;?*|=`]/g, '_')
        .trim()
        .substring(0, 255) || '0'
}

function directModelCollections(editor) {
    const collections = []
    editor.drawing?.children?.().each(group => {
        if (group.type !== 'g' || group.attr('data-collection') !== 'true') return
        if (group.attr('data-block-edit') === 'true' || group.attr('data-nanquim-paper-annotations') === 'true') return
        const id = group.attr('id')
        const state = editor.collections?.get(id)
        collections.push({
            group,
            id,
            locked: state?.locked === true || group.attr('data-locked') === 'true',
            style: { ...(state?.style || {}) },
            visible: state?.visible !== false
                && group.attr('data-hidden') !== 'true'
                && group.css('display') !== 'none',
        })
    })
    return collections
}

function straightPathPoints(pathData) {
    if (typeof pathData !== 'string' || !pathData.trim()) return null
    if (!/^[\s,0-9+\-.eEmMlLhHvVzZ]+$/.test(pathData)) return null
    const tokens = pathData.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
    if (!tokens) return null

    const points = []
    let command = null
    let current = { x: 0, y: 0 }
    let start = null
    let closed = false
    let index = 0
    const readNumber = () => {
        const token = tokens[index++]
        const number = Number(token)
        return token !== undefined && Number.isFinite(number) ? number : null
    }
    const addPoint = (x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false
        current = { x, y }
        points.push(current)
        if (!start) start = current
        return true
    }

    while (index < tokens.length) {
        if (/^[a-zA-Z]$/.test(tokens[index])) command = tokens[index++]
        if (!command || !/[mMlLhHvVzZ]/.test(command)) return null
        const relative = command === command.toLowerCase()
        const upper = command.toUpperCase()
        if (upper === 'M' && points.length > 0) return null
        if (upper === 'Z') {
            closed = true
            current = start || current
            command = null
            continue
        }
        if (upper === 'H') {
            const value = readNumber()
            if (value === null || !addPoint(relative ? current.x + value : value, current.y)) return null
            continue
        }
        if (upper === 'V') {
            const value = readNumber()
            if (value === null || !addPoint(current.x, relative ? current.y + value : value)) return null
            continue
        }
        const x = readNumber()
        const y = readNumber()
        if (x === null || y === null) return null
        if (!addPoint(relative ? current.x + x : x, relative ? current.y + y : y)) return null
        if (upper === 'M') command = relative ? 'l' : 'L'
    }

    if (points.length < 2) return null
    const last = points[points.length - 1]
    if (start && last.x === start.x && last.y === start.y) {
        closed = true
        points.pop()
    }
    return points.length >= 2 ? { points, closed } : null
}

function exportDiagnostic(code, message, count = 1) {
    return Object.freeze({ code, message, count })
}

function multiplyAffine(parent, local) {
    if (!parent) return local
    return {
        a: parent.a * local.a + parent.c * local.b,
        b: parent.b * local.a + parent.d * local.b,
        c: parent.a * local.c + parent.c * local.d,
        d: parent.b * local.c + parent.d * local.d,
        e: parent.a * local.e + parent.c * local.f + parent.e,
        f: parent.b * local.e + parent.d * local.f + parent.f,
    }
}

function isSimilarityTransform(matrix, epsilon = 1e-8) {
    const scaleX = Math.hypot(matrix.a, matrix.b)
    const scaleY = Math.hypot(matrix.c, matrix.d)
    const scale = Math.max(scaleX, scaleY, 1)
    const dot = matrix.a * matrix.c + matrix.b * matrix.d
    return Number.isFinite(scaleX)
        && Number.isFinite(scaleY)
        && scaleX > epsilon
        && scaleY > epsilon
        && Math.abs(scaleX - scaleY) <= epsilon * scale
        && Math.abs(dot) <= epsilon * scaleX * scaleY
}

function isAxisAlignedTransform(matrix, epsilon = 1e-8) {
    const scale = Math.max(
        Math.abs(matrix.a),
        Math.abs(matrix.b),
        Math.abs(matrix.c),
        Math.abs(matrix.d),
        1,
    )
    return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite)
        && Math.abs(matrix.b) <= epsilon * scale
        && Math.abs(matrix.c) <= epsilon * scale
        && Math.abs(matrix.a) > epsilon
        && Math.abs(matrix.d) > epsilon
}

function findUnsupportedDxfTransforms(element, parentMatrix = null, unsupported = new WeakSet()) {
    const accumulated = multiplyAffine(parentMatrix, element.matrix())
    if (element.type === 'g') {
        element.children().each(child => findUnsupportedDxfTransforms(child, accumulated, unsupported))
        return unsupported
    }

    const isCircularArc = element.type === 'path' && Boolean(element.data('arcData'))
    if ((element.type === 'circle' || isCircularArc) && !isSimilarityTransform(accumulated)) {
        unsupported.add(element.node)
    } else if (element.type === 'ellipse') {
        const isCircularEllipse = Math.abs(element.rx() - element.ry()) <= 1e-8
        const supported = isCircularEllipse
            ? isSimilarityTransform(accumulated)
            : isAxisAlignedTransform(accumulated)
        if (!supported) unsupported.add(element.node)
    }
    return unsupported
}

function validDxfNumber(value, { positive = false, nonNegative = false } = {}) {
    const number = Number(value)
    if (!Number.isFinite(number) || Math.abs(number) > MAX_DXF_COORDINATE) return false
    if (positive && number <= 0) return false
    if (nonNegative && number < 0) return false
    return true
}

function validDxfPoint(point) {
    return point && validDxfNumber(point.x) && validDxfNumber(point.y)
}

function validDxfPoints(points) {
    return Array.isArray(points) && points.length > 0 && points.every(point => (
        Array.isArray(point)
            ? validDxfNumber(point[0]) && validDxfNumber(point[1])
            : validDxfPoint(point)
    ))
}

function validDxfRadialBounds(cx, cy, rx, ry = rx) {
    const values = [cx, cy, rx, ry].map(Number)
    if (
        !validDxfNumber(values[0])
        || !validDxfNumber(values[1])
        || !validDxfNumber(values[2], { positive: true })
        || !validDxfNumber(values[3], { positive: true })
    ) return false
    return Math.abs(values[0]) + values[2] <= MAX_DXF_COORDINATE
        && Math.abs(values[1]) + values[3] <= MAX_DXF_COORDINATE
}

// ─── DXFExporter ──────────────────────────────────────────────────────────

function buildDXFDocument(editor) {
        const lines = []
        const diagnosticCounts = new Map()
        const unsupportedTransformNodes = new WeakSet()
        const counts = {
            emitted: Object.create(null),
            input: 0,
            layers: 0,
            skipped: 0,
            approximated: 0,
        }
        let handleCounter = 1
        const nextHandle = () => (handleCounter++).toString(16).toUpperCase().padStart(2, '0')

        const diagnose = (code, message, amount = 1) => {
            const existing = diagnosticCounts.get(code)
            if (existing) {
                existing.count += amount
            } else if (diagnosticCounts.size < 16) {
                diagnosticCounts.set(code, { code, message, count: amount })
            }
        }

        const rejectInvalidGeometry = () => {
            diagnose(
                'invalid-numeric-geometry',
                'Geometry with invalid or out-of-range numeric values was skipped during DXF export.',
            )
            return false
        }

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
        function beginEntity(type, layerName, el) {
            emit(0, type)
            emit(5, nextHandle())
            emit(100, 'AcDbEntity')
            emit(8, layerName)
            const presentationValue = (property) => {
                const inline = el?.node?.style?.getPropertyValue(property)?.trim()
                return inline || el?.attr?.(property)
            }
            const paint = [presentationValue('stroke'), presentationValue('fill')]
                .find(value => value && value !== 'none' && value !== 'transparent' && !value.startsWith('url('))
            if (paint) {
                emit(62, hexToAci(paint))
            }
            counts.emitted[type] = (counts.emitted[type] || 0) + 1
        }

        // ── layer name for an element (walks up to collection) ──────────────
        const usedLayerNames = new Set(['0'])
        const layers = directModelCollections(editor).map((data, index) => {
            const originalName = data.group.attr('name') || data.id || `Layer ${index + 1}`
            const baseName = sanitizeLayerName(originalName)
            let name = baseName
            let suffix = 2
            while (usedLayerNames.has(name.toLowerCase())) {
                const suffixText = `_${suffix++}`
                name = `${baseName.slice(0, 255 - suffixText.length)}${suffixText}`
            }
            usedLayerNames.add(name.toLowerCase())
            if (name !== originalName) {
                diagnose('layer-name-normalized', 'One or more layer names were normalized for DXF compatibility.')
            }
            return {
                ...data,
                name,
                aci: hexToAci(data.style.stroke || data.group.attr('stroke') || 'white'),
            }
        })
        counts.layers = layers.length

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
        // TABLES  (full R2000-required set; QCad validates every table)
        // ════════════════════════════════════════════════════════════════════
        emit(0, 'SECTION')
        emit(2, 'TABLES')

        // VPORT — empty but required
        emit(0, 'TABLE')
        emit(2, 'VPORT')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTable')
        emit(70, 0)
        emit(0, 'ENDTAB')

        // LTYPE — ByLayer, ByBlock, Continuous (QCad expects all three)
        emit(0, 'TABLE')
        emit(2, 'LTYPE')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTable')
        emit(70, 3)
        for (const [name, desc] of [['ByLayer',''], ['ByBlock',''], ['Continuous','Solid line']]) {
            emit(0, 'LTYPE')
            emit(5, nextHandle())
            emit(100, 'AcDbSymbolTableRecord')
            emit(100, 'AcDbLinetypeTableRecord')
            emit(2, name)
            emit(70, 0)
            emit(3, desc)
            emit(72, 65)
            emit(73, 0)
            emit(40, 0.0)
        }
        emit(0, 'ENDTAB')

        // LAYER — layer 0 is mandatory; then one entry per collection
        emit(0, 'TABLE')
        emit(2, 'LAYER')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTable')
        emit(70, layers.length + 1)  // +1 for layer 0
        // layer 0 (mandatory)
        emit(0, 'LAYER')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTableRecord')
        emit(100, 'AcDbLayerTableRecord')
        emit(2, '0')
        emit(70, 0)
        emit(62, 7)
        emit(6, 'Continuous')
        // collection layers
        layers.forEach(layer => {
            emit(0, 'LAYER')
            emit(5, nextHandle())
            emit(100, 'AcDbSymbolTableRecord')
            emit(100, 'AcDbLayerTableRecord')
            emit(2, layer.name)
            emit(70, (layer.visible ? 0 : 1) | (layer.locked ? 4 : 0))
            emit(62, layer.visible ? layer.aci : -layer.aci)
            emit(6, 'Continuous')
        })
        emit(0, 'ENDTAB')

        // STYLE — Standard text style
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

        // VIEW — empty but required
        emit(0, 'TABLE')
        emit(2, 'VIEW')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTable')
        emit(70, 0)
        emit(0, 'ENDTAB')

        // UCS — empty but required
        emit(0, 'TABLE')
        emit(2, 'UCS')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTable')
        emit(70, 0)
        emit(0, 'ENDTAB')

        // APPID — QCad requires ACAD entry
        emit(0, 'TABLE')
        emit(2, 'APPID')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTable')
        emit(70, 1)
        emit(0, 'APPID')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTableRecord')
        emit(100, 'AcDbRegAppTableRecord')
        emit(2, 'ACAD')
        emit(70, 0)
        emit(0, 'ENDTAB')

        // DIMSTYLE — Standard entry required by QCad
        emit(0, 'TABLE')
        emit(2, 'DIMSTYLE')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTable')
        emit(70, 1)
        emit(0, 'DIMSTYLE')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTableRecord')
        emit(100, 'AcDbDimStyleTableRecord')
        emit(2, 'Standard')
        emit(70, 0)
        emit(0, 'ENDTAB')

        // BLOCK_RECORD — required in R2000; must list *Model_Space & *Paper_Space
        emit(0, 'TABLE')
        emit(2, 'BLOCK_RECORD')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTable')
        emit(70, 2)
        emit(0, 'BLOCK_RECORD')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTableRecord')
        emit(100, 'AcDbBlockTableRecord')
        emit(2, '*Model_Space')
        emit(0, 'BLOCK_RECORD')
        emit(5, nextHandle())
        emit(100, 'AcDbSymbolTableRecord')
        emit(100, 'AcDbBlockTableRecord')
        emit(2, '*Paper_Space')
        emit(0, 'ENDTAB')

        emit(0, 'ENDSEC')

        // ════════════════════════════════════════════════════════════════════
        // BLOCKS — *Model_Space + *Paper_Space stubs (both required)
        // ════════════════════════════════════════════════════════════════════
        emit(0, 'SECTION')
        emit(2, 'BLOCKS')

        // Helper to emit a block stub
        function emitBlockStub(name) {
            emit(0, 'BLOCK')
            emit(5, nextHandle())
            emit(100, 'AcDbEntity')
            emit(8, '0')
            emit(100, 'AcDbBlockBegin')
            emit(2, name)
            emit(70, 0)
            emit(10, 0.0); emit(20, 0.0); emit(30, 0.0)
            emit(3, name)
            emit(1, '')
            emit(0, 'ENDBLK')
            emit(5, nextHandle())
            emit(100, 'AcDbEntity')
            emit(8, '0')
            emit(100, 'AcDbBlockEnd')
        }

        emitBlockStub('*Model_Space')
        emitBlockStub('*Paper_Space')

        emit(0, 'ENDSEC')

        // ════════════════════════════════════════════════════════════════════
        // ENTITIES
        // ════════════════════════════════════════════════════════════════════
        emit(0, 'SECTION')
        emit(2, 'ENTITIES')

        layers.forEach((data) => {
            const layerName = data.name
            // DXF has no nested SVG transform stack. Bake a detached clone so
            // procedural array/transform nodes export at their evaluated world
            // positions without mutating the live document.
            const exportGroup = data.group.clone(true, false)
            try {
                exportGroup.find('line').each(line => {
                    for (const attribute of ['x1', 'y1', 'x2', 'y2']) {
                        if (line.attr(attribute) == null) line.attr(attribute, 0)
                    }
                })
                exportGroup.find('rect').each(rect => {
                    const rawGeometryIsValid = validDxfNumber(rect.x())
                        && validDxfNumber(rect.y())
                        && validDxfNumber(rect.width(), { positive: true })
                        && validDxfNumber(rect.height(), { positive: true })
                    rect.attr('data-dxf-rectangle-source', rawGeometryIsValid ? 'true' : 'invalid')
                })
                findUnsupportedDxfTransforms(exportGroup, null, unsupportedTransformNodes)
                bakeTransforms(exportGroup)
                walkGroup(exportGroup, layerName)
            } catch (_error) {
                counts.skipped++
                diagnose('transform-export-failed', 'Some transformed geometry could not be converted to DXF.')
            } finally {
                try { exportGroup.remove() } catch (_error) { /* detached clone */ }
            }
        })

        emit(0, 'ENDSEC')
        emit(0, 'EOF')

        // ── download ────────────────────────────────────────────────────────
        const source = lines.join('\r\n') + '\r\n'

        // ════════════════════════════════════════════════════════════════════
        // Entity emitters
        // ════════════════════════════════════════════════════════════════════

        function walkGroup(parent, layerName) {
            parent.children().each(el => {
                // Geometry-node sources are canonical, hidden inputs. Exporting
                // them alongside the evaluated cache would duplicate objects in
                // DXF consumers, which do not honor SVG display semantics.
                if (el.attr('data-hidden') === 'true' ||
                    el.attr('data-gn-source') === 'true' ||
                    el.css('display') === 'none') {
                    return
                }
                if (el.type === 'g') {
                    if (el.attr('data-dimension') === 'true' || el.attr('data-dimension-type')) {
                        counts.approximated++
                        diagnose('dimension-exploded', 'Dimensions were exported as ordinary DXF geometry and text.')
                    }
                    walkGroup(el, layerName)
                } else {
                    counts.input++
                    if (!emitElement(el, layerName)) {
                        counts.skipped++
                    }
                }
            })
        }

        function emitElement(el, layerName) {
            if (unsupportedTransformNodes.has(el.node)) {
                diagnose(
                    'unsupported-affine-transform',
                    'Non-uniform or sheared circles/arcs and rotated or sheared ellipses were skipped during DXF export.',
                )
                return false
            }
            switch (el.type) {
                case 'line':     return emitLine(el, layerName)
                case 'circle':   return emitCircle(el, layerName)
                case 'ellipse':  return emitEllipse(el, layerName)
                case 'rect':     return emitRect(el, layerName)
                case 'polyline':
                case 'polygon':  return emitPolyline(el, layerName, el.type === 'polygon')
                case 'path':     return emitPath(el, layerName)
                case 'text':     return emitText(el, layerName)
                default:
                    diagnose('unsupported-entity', 'Some SVG entities are not supported by the DXF export profile.')
                    return false
            }
        }

        function emitLine(el, layerName) {
            const x1 = Number(el.attr('x1') ?? 0)
            const y1 = Number(el.attr('y1') ?? 0)
            const x2 = Number(el.attr('x2') ?? 0)
            const y2 = Number(el.attr('y2') ?? 0)
            if (![x1, y1, x2, y2].every(value => validDxfNumber(value))) return rejectInvalidGeometry()
            beginEntity('LINE', layerName, el)
            emit(100, 'AcDbLine')
            emit(10, x1); emit(20, fy(y1)); emit(30, 0)
            emit(11, x2); emit(21, fy(y2)); emit(31, 0)
            return true
        }

        function emitCircle(el, layerName) {
            const cx = Number(el.cx())
            const cy = Number(el.cy())
            const radius = Number(el.radius())
            if (!validDxfRadialBounds(cx, cy, radius)) return rejectInvalidGeometry()
            beginEntity('CIRCLE', layerName, el)
            emit(100, 'AcDbCircle')
            emit(10, cx); emit(20, fy(cy)); emit(30, 0)
            emit(40, radius)
            return true
        }

        function emitEllipse(el, layerName) {
            const cx = Number(el.cx()), cy = Number(el.cy())
            const rx = Number(el.rx()), ry = Number(el.ry())
            if (!validDxfRadialBounds(cx, cy, rx, ry)) return rejectInvalidGeometry()
            beginEntity('ELLIPSE', layerName, el)
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
            return true
        }

        function emitRect(el, layerName) {
            const x = Number(el.x()), y = Number(el.y())
            const w = Number(el.width()), h = Number(el.height())
            const verts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
            if (
                !validDxfNumber(w, { positive: true })
                || !validDxfNumber(h, { positive: true })
                || !validDxfPoints(verts)
            ) return rejectInvalidGeometry()
            beginEntity('LWPOLYLINE', layerName, el)
            counts.approximated++
            diagnose('rectangle-as-polyline', 'Rectangles were exported as closed DXF polylines.')
            emit(100, 'AcDbPolyline')
            emit(90, 4)
            emit(70, 1)  // closed
            emit(43, 0)
            verts.forEach(([px, py]) => { emit(10, px); emit(20, fy(py)) })
            return true
        }

        function emitPolyline(el, layerName, closed) {
            const pts = el.array()
            const rectangleSource = el.attr('data-dxf-rectangle-source')
            if (
                rectangleSource === 'invalid'
                || pts.length < 2
                || !validDxfPoints(pts)
            ) return rejectInvalidGeometry()
            if (rectangleSource === 'true') {
                counts.approximated++
                diagnose('rectangle-as-polyline', 'Rectangles were exported as closed DXF polylines.')
            }
            beginEntity('LWPOLYLINE', layerName, el)
            emit(100, 'AcDbPolyline')
            emit(90, pts.length)
            emit(70, closed ? 1 : 0)
            emit(43, 0)
            pts.forEach(p => { emit(10, p[0]); emit(20, fy(p[1])) })
            return true
        }

        function emitPath(el, layerName) {
            if (el.data('arcData')) {
                return emitArc(el, layerName)
            } else if (el.data('splineData')) {
                return emitSplinePath(el, layerName)
            }
            const straight = straightPathPoints(el.attr('d'))
            if (straight) {
                if (!validDxfPoints(straight.points)) return rejectInvalidGeometry()
                if (el.data('hatchData')) {
                    counts.approximated++
                    diagnose(
                        'hatch-outline-only',
                        'Hatches were exported as boundary polylines without their SVG fill pattern.',
                    )
                }
                beginEntity('LWPOLYLINE', layerName, el)
                emit(100, 'AcDbPolyline')
                emit(90, straight.points.length)
                emit(70, straight.closed ? 1 : 0)
                emit(43, 0)
                straight.points.forEach(point => { emit(10, point.x); emit(20, fy(point.y)) })
                return true
            }
            diagnose('unsupported-path', 'Some curved or filled SVG paths could not be represented in DXF and were skipped.')
            return false
        }

        function emitArc(el, layerName) {
            const ad = el.data('arcData')
            if (!ad || !validDxfPoint(ad.p1) || !validDxfPoint(ad.p2) || !validDxfPoint(ad.p3)) {
                return rejectInvalidGeometry()
            }
            const geo = getArcGeometry(ad.p1, ad.p2, ad.p3)
            if (!geo) {
                diagnose('invalid-arc', 'An invalid arc could not be exported to DXF.')
                return false
            }

            const { cx, cy, radius, theta1, theta3, ccw } = geo
            if (
                !validDxfRadialBounds(cx, cy, radius)
                || !validDxfNumber(theta1)
                || !validDxfNumber(theta3)
            ) return rejectInvalidGeometry()

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

            beginEntity('ARC', layerName, el)
            emit(100, 'AcDbCircle')
            emit(10, cx); emit(20, fy(cy)); emit(30, 0)
            emit(40, radius)
            emit(100, 'AcDbArc')
            emit(50, startDeg)
            emit(51, endDeg)
            return true
        }

        function emitSplinePath(el, layerName) {
            const sd = el.data('splineData')
            if (!sd || !sd.points || sd.points.length < 2) {
                diagnose('invalid-spline', 'An invalid spline could not be exported to DXF.')
                return false
            }
            if (!validDxfPoints(sd.points)) return rejectInvalidGeometry()

            // Sample the Catmull-Rom curve and emit as LWPOLYLINE — this preserves
            // the exact visual shape without any B-spline knot vector arithmetic.
            const sampled = sampleCatmullRom(sd.points)
            if (!validDxfPoints(sampled)) return rejectInvalidGeometry()
            beginEntity('LWPOLYLINE', layerName, el)
            counts.approximated++
            diagnose('spline-sampled', 'Splines were sampled as DXF polylines.')
            emit(100, 'AcDbPolyline')
            emit(90, sampled.length)
            emit(70, 0)  // open
            emit(43, 0)
            sampled.forEach(p => { emit(10, p.x); emit(20, fy(p.y)) })
            return true
        }

        function emitText(el, layerName) {
            const node = el.node
            // Text keeps its matrix when geometry transforms are baked. Map
            // its insertion point and the representable rotation/scale into
            // DXF instead of silently discarding a matrix transform.
            const rawX = node.getAttribute('x')
            const rawY = node.getAttribute('y')
            const localX = rawX === null || rawX === '' ? 0 : Number(rawX)
            const localY = rawY === null || rawY === '' ? 0 : Number(rawY)
            const matrix = el.matrix()
            const x = matrix.a * localX + matrix.c * localY + matrix.e
            const y = matrix.b * localX + matrix.d * localY + matrix.f
            const raw = node.textContent || ''
            // SVG.js wraps text in <tspan> children; flatten to plain string
            let content = raw
                .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '�')
                .replace(/\s+/g, ' ')
                .trim()
            if (content.length > 255) {
                content = content.slice(0, 255)
                counts.approximated++
                diagnose('text-truncated', 'DXF TEXT content longer than 255 characters was truncated.')
            }
            const scaleX = Math.hypot(matrix.a, matrix.b)
            const scaleY = Math.hypot(matrix.c, matrix.d)
            const orthogonality = matrix.a * matrix.c + matrix.b * matrix.d
            const rawFontSize = el.css('font-size')
            const baseFontSize = rawFontSize ? Number.parseFloat(rawFontSize) : 2.5
            const fontSize = baseFontSize * scaleY
            const rotation = normAngle(-toDeg(Math.atan2(matrix.b, matrix.a)))
            if (
                !validDxfNumber(localX)
                || !validDxfNumber(localY)
                || ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
                    .every(value => validDxfNumber(value))
                || !validDxfNumber(x)
                || !validDxfNumber(y)
                || !validDxfNumber(scaleX, { positive: true })
                || !validDxfNumber(scaleY, { positive: true })
                || !validDxfNumber(fontSize, { positive: true })
                || !validDxfNumber(rotation)
                || !validDxfNumber(orthogonality)
            ) return rejectInvalidGeometry()
            if (Math.abs(scaleX - scaleY) > 1e-8 || Math.abs(orthogonality) > 1e-8) {
                counts.approximated++
                diagnose('text-transform-approximated', 'Sheared or non-uniformly scaled text was approximated in DXF.')
            }

            beginEntity('TEXT', layerName, el)
            emit(100, 'AcDbText')
            emit(10, x); emit(20, fy(y)); emit(30, 0)
            emit(40, fontSize)
            emit(1, content)
            if (rotation !== 0) emit(50, rotation)
            // Text anchor → DXF horizontal justification (72)
            const anchor = node.getAttribute('text-anchor') || 'start'
            if (anchor === 'middle') { emit(72, 1); emit(11, x); emit(21, fy(y)); emit(31, 0) }
            else if (anchor === 'end') { emit(72, 2); emit(11, x); emit(21, fy(y)); emit(31, 0) }
            emit(100, 'AcDbText')
            return true
        }

        const diagnostics = Object.freeze(Array.from(
            diagnosticCounts.values(),
            diagnostic => exportDiagnostic(diagnostic.code, diagnostic.message, diagnostic.count),
        ))
        const frozenCounts = Object.freeze({
            ...counts,
            emitted: Object.freeze({ ...counts.emitted }),
        })
        return Object.freeze({ source, diagnostics, counts: frozenCounts })
}

function terminalExportMessage(editor, filename, result) {
    const emitted = Object.values(result.counts.emitted).reduce((sum, count) => sum + count, 0)
    const details = [`${emitted} ${emitted === 1 ? 'entity' : 'entities'}`]
    if (result.counts.approximated) details.push(`${result.counts.approximated} approximated`)
    if (result.counts.skipped) details.push(`${result.counts.skipped} skipped`)
    const warning = result.diagnostics.length
        ? ` ${result.diagnostics.map(diagnostic => diagnostic.message).join(' ')}`
        : ''
    return `DXF exported: ${filename} — ${details.join(', ')}.${warning}`
}

function DXFExporter(editor) {
    this.build = function () {
        return buildDXFDocument(editor)
    }

    this.saveFile = function (filename = 'drawing.dxf') {
        const result = buildDXFDocument(editor)
        const blob = new Blob([result.source], { type: 'application/dxf' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        try {
            anchor.click()
        } finally {
            anchor.remove()
            URL.revokeObjectURL(url)
        }

        const message = terminalExportMessage(editor, filename, result)
        try {
            editor.signals.terminalLogged.dispatch({ type: 'span', msg: message })
        } catch (error) {
            try { console.error('[DXFExporter] A terminal listener failed:', error) } catch (_reportError) {}
        }
        return { ...result, filename, message }
    }
}

export {
    DXFExporter,
    buildDXFDocument,
    findUnsupportedDxfTransforms,
    isAxisAlignedTransform,
    isSimilarityTransform,
    sanitizeLayerName,
    straightPathPoints,
}
