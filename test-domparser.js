const { JSDOM } = require('jsdom');
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`);
global.DOMParser = dom.window.DOMParser;

const svgContentOrig = `
<svg data-element-index="4">
<g id="collection-1" data-collection="true" name="Collection 1" stroke="#ffffff" stroke-width="0.1" stroke-linecap="round" fill="transparent">
  <circle cx="10" cy="10" r="10" fill="none" class="newDrawing" data-temp-export-baked="true" stroke="#000000" stroke-width="0.1" stroke-linecap="round"></circle>
  <line x1="0" y1="0" x2="20" y2="20" stroke="#ffffff"></line>
</g>
</svg>
`;

const parser = new DOMParser()
const doc = parser.parseFromString(svgContentOrig, 'image/svg+xml')
const svgRoot = doc.documentElement

console.log("Parsed children:");
for (let i = 0; i < svgRoot.children.length; i++) {
  const g = svgRoot.children[i];
  console.log("Group id:", g.getAttribute('id'));
  for (let j = 0; j < g.children.length; j++) {
    console.log("  Child:", g.children[j].tagName);
  }
}
