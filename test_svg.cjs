const { createSVGWindow } = require('svgdom');
const window = createSVGWindow();
const document = window.document;
const { SVG, registerWindow, Matrix } = require('@svgdotjs/svg.js');
registerWindow(window, document);

const draw = SVG().addTo(document.documentElement)
const text = draw.text("Hello")

// Let's place it at 100, 100 via matrix translation (MoveCommand behavior)
text.transform({ translateX: 100, translateY: 100 })
const originalTransform = text.transform()

// We want to rotate it 90 degrees around centerPoint [100, 100]
// Since it's at 100,100, rotating around 100,100 should just spin the text in place (and slightly shift because anchor is bottom-left usually).

text.transform(originalTransform).rotate(90, 100, 100)
console.log("After object chaining rotate:", text.node.outerHTML);
console.log("Returned transform:", text.transform())

text.transform({})
text.transform(originalTransform)
// Let's use pure Matrix class
const m1 = new Matrix(text)
const m2 = m1.rotate(90, 100, 100)
text.transform(m2)
console.log("After Matrix class rotate:", text.node.outerHTML);
console.log("Returned transform:", text.transform())

