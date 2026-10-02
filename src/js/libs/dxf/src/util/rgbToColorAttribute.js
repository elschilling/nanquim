/**
 * Preserve the DXF RGB color when converting it to an SVG paint.
 */
export default rgb => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
