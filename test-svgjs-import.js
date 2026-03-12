import { SVG, registerWindow } from '@svgdotjs/svg.js';
import { createSVGWindow } from 'svgdom';

const window = createSVGWindow();
const document = window.document;
registerWindow(window, document);

const canvas = SVG(document.documentElement);
const drawing = canvas.group();

const nanquimSavedSvg = `
<g id="collection-1" data-collection="true" name="Collection 1" stroke="#ffffff" stroke-width="0.1" stroke-linecap="round" fill="transparent">
  <circle cx="10" cy="10" r="10" fill="none" class="newDrawing" data-temp-export-baked="true" stroke="#000000" stroke-width="0.1" stroke-linecap="round"></circle>
  <line x1="0" y1="0" x2="20" y2="20" stroke="#ffffff"></line>
</g>
`;

drawing.svg(nanquimSavedSvg);
console.log("SVG.js imported children count:", drawing.children().length);
drawing.children().each(group => {
  console.log("Group id:", group.attr('id'));
  console.log("Group children:", group.children().length);
  group.children().each(child => {
    console.log("  Child:", child.type, child.attr('stroke'));
  })
});
