const svgContentOrig = `
<g id="collection-1" data-collection="true" name="Collection 1" stroke="#ffffff" stroke-width="0.1" stroke-linecap="round" fill="transparent">
  <circle cx="10" cy="10" r="10" fill="none" class="newDrawing" data-temp-export-baked="true" stroke="#000000" stroke-width="0.1" stroke-linecap="round"></circle>
  <line x1="0" y1="0" x2="20" y2="20" stroke="#ffffff"></line>
</g>
`;

let svgContent = svgContentOrig;

// Apply black conversion (Save SVG behavior)
svgContent = svgContent.replace(/stroke\s*=\s*["'](?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|var\(--editor-text-color\))["']/gi, 'stroke="#000000"');
svgContent = svgContent.replace(/stroke\s*:\s*(?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|var\(--editor-text-color\))/gi, 'stroke: #000000');
console.log("--- SAVED SVG ---");
console.log(svgContent);

// Apply white reversion (Load SVG behavior)
let reloadedSvg = svgContent;
reloadedSvg = reloadedSvg.replace(/stroke\s*=\s*(["'])#000000\1/gi, 'stroke=$1#ffffff$1');
reloadedSvg = reloadedSvg.replace(/stroke\s*:\s*#000000/gi, 'stroke: #ffffff');
console.log("\n--- RELOADED SVG ---");
console.log(reloadedSvg);
