let fallbackCounter = 0

function normalisePrefix(prefix) {
  const value = String(prefix || 'id')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return value || 'id'
}

/**
 * Create a collision-resistant identifier without relying on the DOM.
 * `crypto.randomUUID` is used where it is available, with a small fallback for
 * older browsers and test runtimes.
 */
function createId(prefix = 'id') {
  const safePrefix = normalisePrefix(prefix)

  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `${safePrefix}-${globalThis.crypto.randomUUID()}`
  }

  fallbackCounter += 1
  const timestamp = Date.now().toString(36)
  const counter = fallbackCounter.toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `${safePrefix}-${timestamp}-${counter}-${random}`
}

function stableString(value) {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`

  return `{${Object.keys(value)
    .sort()
    .map(key => `${key}:${stableString(value[key])}`)
    .join(',')}}`
}

/**
 * Produce a compact deterministic id. This is useful for evaluated geometry:
 * the same node and source item keep the same id across evaluations.
 */
function createDeterministicId(prefix = 'id', ...parts) {
  const input = parts.map(stableString).join('\u001f')
  let hash = 0x811c9dc5

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return `${normalisePrefix(prefix)}-${(hash >>> 0).toString(36)}`
}

const generateId = createId

export {
  createDeterministicId,
  createId,
  generateId,
}

export default createId
