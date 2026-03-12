import { createSVGWindow } from 'svgdom';
const window = createSVGWindow();
const document = window.document;
import { SVG, registerWindow } from '@svgdotjs/svg.js';
registerWindow(window, document);

const draw = SVG().addTo(document.documentElement)

// Simulate Nanquim's CSS rules
const style = document.createElement('style')
style.textContent = `
    .newDrawing { stroke: white; }
`
document.documentElement.appendChild(style)

const text = draw.text("Test").addClass("newDrawing")
text.css('stroke', 'none')

// This is what Nanquim does:
const computedStyle = window.getComputedStyle(text.node)
console.log("computedStyle.stroke ===", computedStyle.stroke)
console.log("element.attr('stroke') ===", text.attr('stroke'))
console.log("element.css('stroke') ===", text.css('stroke'))

