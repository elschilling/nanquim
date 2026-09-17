// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  IMAGE_FILE_ACCEPT,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  readRasterImage,
} from '../src/js/utils/importRasterImage.js'

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), value => value.charCodeAt(0))
const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), value => value.charCodeAt(0))
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x08, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01,
])

function webp(chunk = 'VP8X') {
  const bytes = new Uint8Array(30)
  const write = (offset, text) => bytes.set(Array.from(text, value => value.charCodeAt(0)), offset)
  write(0, 'RIFF')
  bytes[4] = 22
  write(8, 'WEBP')
  write(12, chunk)
  bytes[16] = 10
  if (chunk === 'VP8L') bytes[20] = 0x2f
  if (chunk === 'VP8 ') {
    bytes.set([0x9d, 0x01, 0x2a], 23)
    bytes[26] = 1
    bytes[28] = 1
  }
  return bytes
}

let images
let decoding
let naturalWidth
let naturalHeight

beforeEach(() => {
  images = []
  decoding = 'load'
  naturalWidth = 1
  naturalHeight = 1
  vi.stubGlobal('Image', class {
    constructor() {
      this.naturalWidth = naturalWidth
      this.naturalHeight = naturalHeight
      this.removeAttribute = vi.fn()
      images.push(this)
    }

    set src(value) {
      this.href = value
      queueMicrotask(() => {
        if (decoding === 'load') this.onload?.()
        if (decoding === 'error') this.onerror?.()
      })
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('local raster image validation', () => {
  test.each([
    ['PNG', PNG, 'image/png'],
    ['GIF', GIF, 'image/gif'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['extended WebP', webp(), 'image/webp'],
    ['lossless WebP', webp('VP8L'), 'image/webp'],
    ['lossy WebP', webp('VP8 '), 'image/webp'],
  ])('preserves %s bytes and derives the MIME type from the signature', async (_format, bytes, mime) => {
    const name = 'mislabelled.svg'
    const result = await readRasterImage(new File([bytes], name, { type: 'image/svg+xml' }))

    expect(result).toEqual({
      href: `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`,
      width: 1,
      height: 1,
      name,
    })
    expect(images).toHaveLength(1)
    expect(images[0].removeAttribute).toHaveBeenCalledWith('src')
    expect(images[0].onload).toBeNull()
    expect(images[0].onerror).toBeNull()
  })

  test('offers only the supported raster formats in the file picker', () => {
    expect(IMAGE_FILE_ACCEPT.split(',')).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
  })

  test('preserves XML special characters in an ordinary file name', async () => {
    const name = 'reference & <detail> "quote" \'apostrophe\'.png'
    await expect(readRasterImage(new File([PNG], name))).resolves.toMatchObject({ name })
  })

  test.each(['reference\u0000.png', 'reference\u0001.png', 'reference\u000b.png', 'reference\ufffe.png'])('rejects file names that cannot be persisted as XML', async name => {
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer')
    await expect(readRasterImage(new File([PNG], name))).rejects.toThrow('Image file name contains an invalid XML character.')
    expect(read).not.toHaveBeenCalled()
  })

  test.each([
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><image href="https://example.com/pixel"/></svg>',
    'https://example.com/pixel.png',
    'data:image/png;base64,AAAA',
    '<html><script>alert(1)</script></html>',
  ])('rejects hostile or non-binary content even when labelled PNG', async source => {
    await expect(readRasterImage(new File([source], 'image.png', { type: 'image/png' }))).rejects.toThrow(/unsupported format/)
    expect(images).toHaveLength(0)
  })

  test.each([undefined, new File([], 'empty.png'), { size: -1 }, { size: NaN }])('rejects missing or empty files before reading', async file => {
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer')
    await expect(readRasterImage(file)).rejects.toThrow(/non-empty/)
    expect(read).not.toHaveBeenCalled()
    expect(images).toHaveLength(0)
  })

  test('rejects oversized files before allocating a reader', async () => {
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer')
    expect(MAX_IMAGE_BYTES).toBe(8 * 1024 * 1024)
    await expect(readRasterImage({ size: MAX_IMAGE_BYTES + 1 })).rejects.toThrow(/8 MiB/)
    expect(read).not.toHaveBeenCalled()
  })

  test.each([
    PNG.slice(0, 8),
    GIF.slice(0, 6),
    JPEG.slice(0, 9),
    webp().slice(0, 20),
    new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]),
    new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0xff]),
    webp('JUNK'),
  ])('rejects truncated or malformed headers', async bytes => {
    await expect(readRasterImage(new File([bytes], 'broken.png'))).rejects.toThrow(/corrupt/)
    expect(images).toHaveLength(0)
  })

  test.each(['PNG', 'GIF', 'JPEG', 'WebP'])('bounds declared %s dimensions before decoding', async format => {
    let bytes
    if (format === 'PNG') {
      bytes = PNG.slice()
      const view = new DataView(bytes.buffer)
      view.setUint32(16, 10000)
      view.setUint32(20, 10000)
    } else if (format === 'GIF') {
      bytes = GIF.slice()
      const view = new DataView(bytes.buffer)
      view.setUint16(6, 10000, true)
      view.setUint16(8, 10000, true)
    } else if (format === 'JPEG') {
      bytes = JPEG.slice()
      const view = new DataView(bytes.buffer)
      view.setUint16(13, 10000)
      view.setUint16(15, 10000)
    } else {
      bytes = webp()
      bytes.set([0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 24)
    }
    await expect(readRasterImage(new File([bytes], 'huge.png'))).rejects.toThrow(/40 million pixels/)
    expect(images).toHaveLength(0)
  })

  test('rejects an image the browser cannot decode and releases handlers', async () => {
    decoding = 'error'
    await expect(readRasterImage(new File([PNG], 'broken.png'))).rejects.toThrow(/corrupt/)
    expect(images[0].onload).toBeNull()
    expect(images[0].onerror).toBeNull()
    expect(images[0].removeAttribute).toHaveBeenCalledWith('src')
  })

  test.each([[0, 1], [1, 0], [NaN, 1], [Infinity, 1], [1.5, 1], [10000, 10000]])('rejects decoded dimensions %s × %s', async (width, height) => {
    naturalWidth = width
    naturalHeight = height
    await expect(readRasterImage(new File([PNG], 'broken.png'))).rejects.toThrow()
    expect(images[0].removeAttribute).toHaveBeenCalledWith('src')
  })

  test('accepts the pixel limit and returns the browser dimensions', async () => {
    const bytes = PNG.slice()
    naturalWidth = 8000
    naturalHeight = MAX_IMAGE_PIXELS / naturalWidth
    const view = new DataView(bytes.buffer)
    view.setUint32(16, naturalWidth)
    view.setUint32(20, naturalHeight)
    await expect(readRasterImage(new File([bytes], 'large.png'))).resolves.toMatchObject({ width: 8000, height: 5000 })
  })

  test('surfaces a read error and releases the abort listener', async () => {
    const failure = new Error('Disk read failed')
    let reader
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(function () {
      reader = this
      Object.defineProperty(this, 'error', { value: failure })
      queueMicrotask(() => this.onerror?.())
    })
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    await expect(readRasterImage(new File([PNG], 'broken.png'), { signal: controller.signal })).rejects.toThrow('Disk read failed')
    expect(reader.onload).toBeNull()
    expect(reader.onerror).toBeNull()
    expect(reader.onabort).toBeNull()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(images).toHaveLength(0)
  })
})

describe('raster image cancellation', () => {
  test('does not start reading when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer')
    await expect(readRasterImage(new File([PNG], 'image.png'), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(read).not.toHaveBeenCalled()
  })

  test('aborts an in-flight reader and removes its handlers', async () => {
    const controller = new AbortController()
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer')
    const abort = vi.spyOn(FileReader.prototype, 'abort')
    const pending = readRasterImage(new File([PNG], 'image.png'), { signal: controller.signal })
    const reader = read.mock.contexts[0]
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(abort).toHaveBeenCalledOnce()
    expect(reader.onload).toBeNull()
    expect(reader.onerror).toBeNull()
    expect(reader.onabort).toBeNull()
    expect(images).toHaveLength(0)
  })

  test('aborts decoding, clears the image source and detaches listeners', async () => {
    decoding = 'pending'
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = readRasterImage(new File([PNG], 'image.png'), { signal: controller.signal })
    await vi.waitFor(() => expect(images).toHaveLength(1))
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(images[0].onload).toBeNull()
    expect(images[0].onerror).toBeNull()
    expect(images[0].removeAttribute).toHaveBeenCalledWith('src')
    expect(remove).toHaveBeenCalledTimes(2)
  })

  test('releases both abort listeners after successful import', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    await readRasterImage(new File([PNG], 'image.png'), { signal: controller.signal })
    expect(remove).toHaveBeenCalledTimes(2)
    controller.abort()
    expect(images[0].removeAttribute).toHaveBeenCalledOnce()
  })
})
