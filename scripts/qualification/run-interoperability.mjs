import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { JSDOM } from 'jsdom'

import { assertSafeArtifactsDirectory } from '../browser/path-safety.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const FIXTURE_DIRECTORY = join(ROOT, 'tests/fixtures')
const ARTIFACTS_ROOT = join(ROOT, 'test-results/interoperability')
const DEFAULT_ARTIFACTS = join(ARTIFACTS_ROOT, 'local-profile')
const TOOL_TIMEOUT_MS = 30000

function parseArguments(values) {
  return Object.fromEntries(values.map(value => {
    const normalized = value.replace(/^--/, '')
    const separator = normalized.indexOf('=')
    return separator < 0
      ? [normalized, true]
      : [normalized.slice(0, separator), normalized.slice(separator + 1)]
  }))
}

function semanticSvgInventory(source) {
  const documentRef = new JSDOM(source, { contentType: 'image/svg+xml' }).window.document
  const root = documentRef.documentElement
  if (root.localName !== 'svg' || documentRef.querySelector('parsererror')) {
    throw new TypeError('The qualified SVG is not well-formed.')
  }
  const tags = ['circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'rect', 'text', 'use']
  const counts = Object.fromEntries(tags.map(tag => [tag, root.querySelectorAll(tag).length]))
  const references = []
  root.querySelectorAll('*').forEach(element => {
    for (const name of ['href', 'xlink:href', 'fill', 'stroke', 'clip-path', 'marker-start', 'marker-mid', 'marker-end']) {
      const value = element.getAttribute(name)
      if (!value) continue
      const direct = name === 'href' || name === 'xlink:href' ? /^#(.+)$/.exec(value) : null
      const functional = /^url\(\s*["']?#([^"')\s]+)["']?\s*\)$/.exec(value)
      const id = direct?.[1] || functional?.[1]
      if (id) references.push(id)
    }
  })
  const uniqueReferences = Array.from(new Set(references)).sort()
  const missingReferences = uniqueReferences.filter(id => !documentRef.getElementById(id))
  return {
    counts,
    height: root.getAttribute('height'),
    missingReferences,
    references: uniqueReferences,
    viewBox: root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number) || [],
    width: root.getAttribute('width'),
  }
}

function parseInkscapeBounds(source) {
  const bounds = new Map()
  String(source || '').split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return
    const parts = line.split(',')
    if (parts.length !== 5) return
    const [id, ...rawValues] = parts
    const values = rawValues.map(Number)
    if (!id || !values.every(Number.isFinite)) return
    bounds.set(id, values)
  })
  return bounds
}

function compareInkscapeBounds(before, after, tolerance) {
  const missing = []
  let compared = 0
  let maxDelta = 0
  before.forEach((expected, id) => {
    const actual = after.get(id)
    if (!actual) {
      missing.push(id)
      return
    }
    expected.forEach((value, index) => {
      maxDelta = Math.max(maxDelta, Math.abs(value - actual[index]))
    })
    compared += 1
  })
  if (missing.length > 0) {
    throw new Error(`Inkscape omitted qualified geometry bounds: ${missing.join(', ')}`)
  }
  if (maxDelta > tolerance) {
    throw new Error(`Inkscape changed qualified geometry bounds by ${maxDelta} (limit ${tolerance}).`)
  }
  return { compared, maxDelta }
}

function runTool(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: options.timeout || TOOL_TIMEOUT_MS,
    env: { ...process.env, ...(options.env || {}) },
  })
  if (result.error) throw result.error
  return {
    command: [command, ...args],
    signal: result.signal,
    status: result.status,
    stderr: result.stderr?.trim() || '',
    stdout: result.stdout?.trim() || '',
  }
}

function toolVersion(command, args = ['--version']) {
  const result = runTool(command, args, { timeout: 10000 })
  if (result.status !== 0) throw new Error(`${command} version check failed: ${result.stderr || result.stdout}`)
  return (result.stdout || result.stderr).split(/\r?\n/).find(Boolean)?.trim() || 'unknown'
}

function assertPinnedToolVersion(tool, version, patternSource) {
  if (typeof patternSource !== 'string' || patternSource.length > 256) {
    throw new TypeError(`The pinned ${tool} version pattern is invalid.`)
  }
  if (!new RegExp(patternSource).test(version)) {
    throw new Error(`${tool} version ${JSON.stringify(version)} does not match the pinned profile.`)
  }
  return version
}

function detectLibreCadVersion(run = runTool) {
  const attempts = [
    ['librecad', ['--version']],
    ['rpm', ['-q', 'librecad']],
    ['dpkg-query', ['-W', '-f=${Version}', 'librecad']],
    ['brew', ['list', '--versions', 'librecad']],
  ]
  for (const [command, args] of attempts) {
    try {
      const result = run(command, args, { timeout: 10000 })
      if (result.status === 0) return result.stdout || result.stderr || 'installed (version unavailable)'
    } catch (_) {
      // Package managers and the LibreCAD binary are optional manual-gate aids.
    }
  }
  return 'not detected'
}

async function qualifyInkscape({ fixturePath, outputPath, manifest, toolHome }) {
  const result = runTool('inkscape', [
    fixturePath,
    '--export-plain-svg',
    `--export-filename=${outputPath}`,
  ], {
    env: {
      HOME: toolHome,
      XDG_CACHE_HOME: join(toolHome, 'cache'),
      XDG_CONFIG_HOME: join(toolHome, 'config'),
    },
  })
  if (result.status !== 0) {
    throw new Error(`Inkscape qualification failed: ${result.stderr || result.stdout}`)
  }
  const inventory = semanticSvgInventory(await readFile(outputPath, 'utf8'))
  if (JSON.stringify(inventory.counts) !== JSON.stringify(manifest.supportedElementCounts)) {
    throw new Error(`Inkscape changed the SVG entity inventory: ${JSON.stringify(inventory.counts)}`)
  }
  if (JSON.stringify(inventory.viewBox) !== JSON.stringify(manifest.viewBox)) {
    throw new Error(`Inkscape changed the SVG viewBox: ${inventory.viewBox.join(' ')}`)
  }
  if (inventory.width !== `${manifest.physicalSize.width}mm` || inventory.height !== `${manifest.physicalSize.height}mm`) {
    throw new Error(`Inkscape changed the physical SVG size to ${inventory.width} × ${inventory.height}.`)
  }
  if (inventory.missingReferences.length > 0) {
    throw new Error(`Inkscape left dangling local references: ${inventory.missingReferences.join(', ')}`)
  }
  const queryOptions = {
    env: {
      HOME: toolHome,
      XDG_CACHE_HOME: join(toolHome, 'cache'),
      XDG_CONFIG_HOME: join(toolHome, 'config'),
    },
  }
  const sourceQuery = runTool('inkscape', [fixturePath, '--query-all'], queryOptions)
  const outputQuery = runTool('inkscape', [outputPath, '--query-all'], queryOptions)
  if (sourceQuery.status !== 0 || outputQuery.status !== 0) {
    throw new Error('Inkscape could not inspect qualified geometry bounds.')
  }
  const bounds = compareInkscapeBounds(
    parseInkscapeBounds(sourceQuery.stdout),
    parseInkscapeBounds(outputQuery.stdout),
    manifest.tolerances.boundsAbsolute,
  )
  const version = assertPinnedToolVersion(
    'Inkscape',
    toolVersion('inkscape'),
    manifest.toolVersions.inkscape,
  )
  return {
    status: 'passed',
    version,
    bounds,
    inventory,
    stderr: result.stderr,
  }
}

function assertBlenderInventory(inventory, expected) {
  if (!inventory.result?.includes('FINISHED')) {
    throw new Error(`Blender did not finish SVG import: ${JSON.stringify(inventory)}`)
  }
  for (const property of ['objects', 'curves', 'splines']) {
    if (inventory[property] !== expected[property]) {
      throw new Error(
        `Blender changed the qualified ${property} count: ${inventory[property]} (expected ${expected[property]}).`,
      )
    }
  }
  return inventory
}

async function qualifyBlender({ fixturePath, expectedInventory, versionPattern }) {
  const expression = [
    'import bpy,json,os',
    `result=bpy.ops.import_curve.svg(filepath=${JSON.stringify(fixturePath)})`,
    'objects=list(bpy.context.scene.objects)',
    "payload={'result':sorted(list(result)),'objects':len(objects),'curves':sum(1 for o in objects if o.type=='CURVE'),'splines':sum(len(o.data.splines) for o in objects if o.type=='CURVE')}",
    "print('NANQUIM_INTEROP='+json.dumps(payload,sort_keys=True),flush=True)",
    'os._exit(0)',
  ].join(';')
  const result = runTool('blender', [
    '-noaudio',
    '--background',
    '--factory-startup',
    '--python-expr',
    expression,
  ])
  if (result.status !== 0) {
    throw new Error(`Blender qualification failed: ${result.stderr || result.stdout}`)
  }
  const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('NANQUIM_INTEROP='))
  if (!line) throw new Error('Blender did not report SVG import results.')
  const inventory = assertBlenderInventory(
    JSON.parse(line.slice('NANQUIM_INTEROP='.length)),
    expectedInventory,
  )
  const version = assertPinnedToolVersion(
    'Blender',
    toolVersion('blender', ['--version']),
    versionPattern,
  )
  return {
    status: 'passed',
    version,
    inventory,
  }
}

async function runInteroperabilityQualification(options = {}) {
  const artifactsDirectory = resolve(options.artifacts || DEFAULT_ARTIFACTS)
  await assertSafeArtifactsDirectory(artifactsDirectory, {
    artifactsRoot: ARTIFACTS_ROOT,
    repositoryRoot: ROOT,
  })
  await mkdir(ARTIFACTS_ROOT, { recursive: true })
  await assertSafeArtifactsDirectory(artifactsDirectory, {
    artifactsRoot: ARTIFACTS_ROOT,
    repositoryRoot: ROOT,
  })
  await rm(artifactsDirectory, { recursive: true, force: true })
  await mkdir(artifactsDirectory, { recursive: true })

  const toolHome = await mkdtemp(join(tmpdir(), 'nanquim-interop-tools-'))
  const fixturePath = join(FIXTURE_DIRECTORY, 'interoperability-profile.svg')
  const manifest = JSON.parse(await readFile(
    join(FIXTURE_DIRECTORY, 'interoperability-profile.expected.json'),
    'utf8',
  ))
  const outputPath = join(artifactsDirectory, 'inkscape-plain.svg')
  const startedAt = new Date().toISOString()
  try {
    const sourceInventory = semanticSvgInventory(await readFile(fixturePath, 'utf8'))
    const [inkscape, blender] = await Promise.all([
      qualifyInkscape({ fixturePath, outputPath, manifest, toolHome }),
      qualifyBlender({
        fixturePath,
        expectedInventory: manifest.blenderImport,
        versionPattern: manifest.toolVersions.blender,
      }),
    ])
    const libreCadVersion = detectLibreCadVersion()
    const summary = {
      profile: manifest.profile,
      status: 'passed-with-manual-gate',
      startedAt,
      finishedAt: new Date().toISOString(),
      source: sourceInventory,
      tools: {
        inkscape,
        blender,
        librecad: {
          status: 'manual-required',
          version: libreCadVersion,
          reason: 'LibreCAD 2.2 has no supported headless semantic inspection interface; use the recorded manual checklist.',
        },
      },
    }
    await writeFile(join(artifactsDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
    return summary
  } finally {
    await rm(toolHome, { recursive: true, force: true })
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedDirectly) {
  const cli = parseArguments(process.argv.slice(2))
  try {
    await access(join(FIXTURE_DIRECTORY, 'interoperability-profile.svg'))
    const summary = await runInteroperabilityQualification({ artifacts: cli.artifacts })
    process.stdout.write(`Interoperability qualification passed: ${summary.tools.inkscape.version}; ${summary.tools.blender.version}.\n`)
    process.stdout.write(`LibreCAD gate: ${summary.tools.librecad.status} (${summary.tools.librecad.version}).\n`)
  } catch (error) {
    process.stderr.write(`Interoperability qualification failed: ${error.stack || error.message}\n`)
    process.exitCode = 1
  }
}

export {
  assertBlenderInventory,
  assertPinnedToolVersion,
  compareInkscapeBounds,
  detectLibreCadVersion,
  parseInkscapeBounds,
  runInteroperabilityQualification,
  semanticSvgInventory,
}
