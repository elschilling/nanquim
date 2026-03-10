import { createSVGWindow } from 'svgdom';
const window = createSVGWindow();
const document = window.document;
import { SVG, registerWindow, Matrix } from '@svgdotjs/svg.js';
registerWindow(window, document);

const draw = SVG().addTo(document.documentElement)
const text = draw.text("Hello")

text.transform({ translateX: 100, translateY: 100 })
const originalTransform = text.transform()

// Using Matrix class
const m1 = new Matrix(originalTransform)
const m2 = m1.rotate(90, 100, 100)
text.transform(m2)
console.log("After Matrix rotate:", text.node.outerHTML)
