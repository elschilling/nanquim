const { JSDOM } = require("jsdom");

const dataOld = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
<text svgjs:data="some-data" x="10" y="10">Hello</text>
</svg>`;

const dataNew = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svgjs="http://svgjs.com/svgjs" viewBox="0 0 100 100">
<text svgjs:data="some-data" x="10" y="10">Hello</text>
</svg>`;

const dom = new JSDOM();
const parser = new dom.window.DOMParser();

const docOld = parser.parseFromString(dataOld, 'image/svg+xml');
console.log("OLD ROOT:", docOld.documentElement.nodeName);
if (docOld.documentElement.nodeName === 'parsererror' || docOld.getElementsByTagName('parsererror').length > 0) {
    console.log("OLD has parsererror:", docOld.documentElement.outerHTML || docOld.documentElement.textContent);
} else {
    console.log("OLD loaded correctly");
}

const docNew = parser.parseFromString(dataNew, 'image/svg+xml');
console.log("NEW ROOT:", docNew.documentElement.nodeName);
if (docNew.documentElement.nodeName === 'parsererror' || docNew.getElementsByTagName('parsererror').length > 0) {
    console.log("NEW has parsererror:", docNew.documentElement.outerHTML || docNew.documentElement.textContent);
} else {
    console.log("NEW loaded correctly");
}
