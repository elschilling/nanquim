import { SVG, registerWindow, PathArray, Matrix } from '@svgdotjs/svg.js'
import { createSVGWindow } from 'svgdom'

const window = createSVGWindow()
const document = window.document
registerWindow(window, document)

const canvas = SVG(document.documentElement);

const group = canvas.group().transform({ a: 2, b: 0, c: 0, d: 2, e: 10, f: 10 });
const p = group.path('M10 10 L20 20');
const c = group.circle(10).center(10, 10);
const r = group.rect(10, 10).move(10, 10);

console.log('Path start:', p.attr('d'));
console.log('Circle start:', c.cx(), c.cy(), c.radius());
console.log('Rect start:', r.x(), r.y());

// Let's transform points explicitly
const matrix = new Matrix(group.transform());
try {
    const pathArr = new PathArray(p.attr('d'));
    // path array in v3 has transform? Let's check docs or methods
    console.log('Methods in PathArray:', Object.keys(pathArr.__proto__));
    if (pathArr.transform) {
        pathArr.transform(matrix);
    }
    console.log('Path baked:', pathArr.toString());
} catch (e) { console.error('Path error:', e.message); }
