const { DOMParser, XMLSerializer } = require('xmldom');

let data = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
<text svgjs:data="some-data" x="10" y="10">Hello</text>
</svg>`;

try {
  const parser = new DOMParser();
  const doc = parser.parseFromString(data, 'image/svg+xml');
  console.log(doc.documentElement.nodeName);
  
  if (doc.getElementsByTagName("parsererror").length > 0) {
      console.log("Found parsererror");
  }
} catch (e) {
  console.log("Error:", e.message);
}
