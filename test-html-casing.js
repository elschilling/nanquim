const { JSDOM } = require('jsdom');
const dom = new JSDOM();
const parser = new dom.window.DOMParser();

const svgContentOrig = `
<svg>
  <g data-circleTrimData="123" viewBox="0 0 10 10">
    <circle cx="10" cy="10" r="10" />
  </g>
</svg>
`;

const doc = parser.parseFromString(svgContentOrig, 'image/svg+xml');
const root = doc.documentElement;
console.log(root.innerHTML);
