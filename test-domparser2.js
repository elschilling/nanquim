import { JSDOM } from 'jsdom';
const dom = new JSDOM();
const parser = new dom.window.DOMParser();

const nanquimSavedSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  viewBox="-100 -100 200 200"
  data-nanquim-version="1"
  data-element-index="2"
>
<g id="collection-1" data-collection="true" name="Collection 1" stroke="#ffffff" stroke-width="0.1" stroke-linecap="round" fill="transparent">
  <circle cx="10" cy="10" r="10" fill="none" class="newDrawing" data-temp-export-baked="true" stroke="#000000" stroke-width="0.1" stroke-linecap="round"></circle>
  <line x1="0" y1="0" x2="20" y2="20" stroke="#ffffff"></line>
</g>
</svg>`;

const doc = parser.parseFromString(nanquimSavedSvg, 'image/svg+xml');
const svgRoot = doc.documentElement;

console.log("Root element:", svgRoot.tagName);
console.log("Number of children in root:", svgRoot.children.length);

for (let i = 0; i < svgRoot.children.length; i++) {
  const g = svgRoot.children[i];
  console.log("Child", i, ":", g.tagName, "id:", g.getAttribute('id'));
  for (let j = 0; j < g.children.length; j++) {
    console.log("  Grandchild", j, ":", g.children[j].tagName);
  }
}
