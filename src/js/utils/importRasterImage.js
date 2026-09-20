import { assertXml10Characters } from '../document/DocumentMetadata.js'

export const IMAGE_FILE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 40000000

const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function cancelled() {
  return new DOMException('Image import was cancelled.', 'AbortError')
}

function invalidImage() {
  return new Error('The image is corrupt or has an unsupported format. Use PNG, JPEG, GIF, or WebP.')
}

function assertDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw invalidImage()
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new Error('Images must contain at most 40 million pixels.')
  }
}

function matches(bytes, offset, values) {
  return values.every((value, index) => bytes[offset + index] === value)
}

function matchesText(bytes, offset, value) {
  return matches(bytes, offset, Array.from(value, character => character.charCodeAt(0)))
}

// Bound decoded allocations using the file's dimensions before invoking the
// browser decoder. The decoder remains responsible for validating image data.
function inspectHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (matches(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])) {
    if (bytes.length < 24 || !matchesText(bytes, 12, 'IHDR')) throw invalidImage()
    assertDimensions(view.getUint32(16), view.getUint32(20))
    return 'image/png'
  }
  if (matchesText(bytes, 0, 'GIF87a') || matchesText(bytes, 0, 'GIF89a')) {
    if (bytes.length < 10) throw invalidImage()
    assertDimensions(view.getUint16(6, true), view.getUint16(8, true))
    return 'image/gif'
  }
  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) {
    let cursor = 2
    while (cursor < bytes.length) {
      if (bytes[cursor] !== 0xff) throw invalidImage()
      while (bytes[cursor] === 0xff) cursor += 1
      const marker = bytes[cursor++]
      if (marker === 0xda || marker === 0xd9 || cursor + 2 > bytes.length) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      const length = view.getUint16(cursor)
      if (length < 2 || cursor + length > bytes.length) throw invalidImage()
      if (JPEG_FRAME_MARKERS.has(marker)) {
        if (length < 8) throw invalidImage()
        assertDimensions(view.getUint16(cursor + 5), view.getUint16(cursor + 3))
        return 'image/jpeg'
      }
      cursor += length
    }
    throw invalidImage()
  }
  if (matchesText(bytes, 0, 'RIFF') && matchesText(bytes, 8, 'WEBP')) {
    if (bytes.length < 25) throw invalidImage()
    if (matchesText(bytes, 12, 'VP8X')) {
      if (bytes.length < 30) throw invalidImage()
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
      assertDimensions(width, height)
    } else if (matchesText(bytes, 12, 'VP8L') && bytes[20] === 0x2f) {
      const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8)
      const height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10)
      assertDimensions(width, height)
    } else if (matchesText(bytes, 12, 'VP8 ') && bytes.length >= 30 && matches(bytes, 23, [0x9d, 0x01, 0x2a])) {
      assertDimensions(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
    } else {
      throw invalidImage()
    }
    return 'image/webp'
  }
  throw invalidImage()
}

function readBytes(file, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled())
    const reader = new FileReader()
    const cleanup = () => {
      signal?.removeEventListener('abort', abort)
      reader.onload = null
      reader.onerror = null
      reader.onabort = null
    }
    const abort = () => {
      cleanup()
      if (reader.readyState === FileReader.LOADING) reader.abort()
      reject(cancelled())
    }
    reader.onload = () => {
      const result = reader.result
      cleanup()
      resolve(new Uint8Array(result))
    }
    reader.onerror = () => {
      const error = reader.error || new Error('Unable to read this image file.')
      cleanup()
      reject(error)
    }
    reader.onabort = () => {
      cleanup()
      reject(cancelled())
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      reader.readAsArrayBuffer(file)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

function dataUrl(bytes, mime) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

function decodeDimensions(href, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled())
    const image = new Image()
    const cleanup = () => {
      signal?.removeEventListener('abort', abort)
      image.onload = null
      image.onerror = null
      image.removeAttribute('src')
    }
    const abort = () => {
      cleanup()
      reject(cancelled())
    }
    image.onload = () => {
      const width = image.naturalWidth
      const height = image.naturalHeight
      cleanup()
      try {
        assertDimensions(width, height)
        resolve({ width, height })
      } catch (error) {
        reject(error)
      }
    }
    image.onerror = () => {
      cleanup()
      reject(invalidImage())
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      image.src = href
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

export async function readRasterImage(file, { signal } = {}) {
  if (signal?.aborted) throw cancelled()
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new Error('Choose a non-empty image file.')
  }
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Images must be 8 MiB or smaller.')
  const name = typeof file.name === 'string' ? file.name : 'Image'
  assertXml10Characters(name, 'Image file name')
  const bytes = await readBytes(file, signal)
  if (signal?.aborted) throw cancelled()
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw invalidImage()
  const mime = inspectHeader(bytes)
  const href = dataUrl(bytes, mime)
  const { width, height } = await decodeDimensions(href, signal)
  if (signal?.aborted) throw cancelled()
  return { href, width, height, name }
}
