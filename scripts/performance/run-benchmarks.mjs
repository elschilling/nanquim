import { constants as fsConstants } from 'node:fs'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { cpus, platform, release, tmpdir, totalmem } from 'node:os'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

import {
  DEFAULT_PERFORMANCE_SAMPLES,
  DEFAULT_PERFORMANCE_WARMUPS,
  MAX_PERFORMANCE_SAMPLES,
  MIN_PERFORMANCE_SAMPLES,
  PERFORMANCE_BUDGETS_MS,
  PERFORMANCE_DATASET_SIZES,
  PERFORMANCE_METRICS,
  assertPerformanceConfiguration,
} from './config.mjs'
import { createNativeSvgDataset } from './dataset.mjs'
import { evaluateBudget, summarizeSamples } from './statistics.mjs'
import {
  assertSafeArtifactsDirectory,
  assertSafeRunDirectory,
} from '../browser/path-safety.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DEFAULT_PORT = 4174
const BROWSER_VIEWPORT = Object.freeze({ width: 1440, height: 900, deviceScaleFactor: 1 })
const ARTIFACTS_ROOT = join(ROOT, 'test-results/performance')
const cli = parseArguments(process.argv.slice(2))
const browserName = String(cli.browser || process.env.NANQUIM_PERFORMANCE_BROWSER || 'chromium')
const port = Number(cli.port || process.env.NANQUIM_PERFORMANCE_PORT || DEFAULT_PORT)
const providedBaseUrl = cli.baseUrl || process.env.NANQUIM_PERFORMANCE_BASE_URL
const baseUrl = providedBaseUrl || `http://127.0.0.1:${port}`
const samples = integerOption(cli.samples, DEFAULT_PERFORMANCE_SAMPLES, {
  label: 'samples',
  min: MIN_PERFORMANCE_SAMPLES,
  max: MAX_PERFORMANCE_SAMPLES,
})
const warmups = integerOption(cli.warmups, DEFAULT_PERFORMANCE_WARMUPS, {
  label: 'warmups',
  min: 0,
  max: 5,
})
const datasetSizes = parseDatasetSizes(cli.sizes)
const enforceBudgets = cli.reportOnly !== true
const artifactsDirectory = resolve(
  ROOT,
  cli.artifacts
    || process.env.NANQUIM_PERFORMANCE_ARTIFACTS
    || `test-results/performance/${browserName}`,
)

if (!['chromium', 'firefox'].includes(browserName)) {
  throw new TypeError(`Unsupported browser "${browserName}". Use chromium or firefox.`)
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new TypeError(`Invalid preview port "${port}".`)
}
assertPerformanceConfiguration()

const report = {
  schemaVersion: 1,
  status: 'running',
  startedAt: new Date().toISOString(),
  environment: {
    browser: browserName,
    cpu: cpus()[0]?.model || 'unknown',
    cpuCount: cpus().length,
    node: process.version,
    operatingSystem: `${platform()} ${release()}`,
    totalMemoryBytes: totalmem(),
    viewport: BROWSER_VIEWPORT,
  },
  configuration: {
    budgetsMs: Object.fromEntries(datasetSizes.map(size => [size, PERFORMANCE_BUDGETS_MS[size]])),
    datasetSizes,
    enforceBudgets,
    samples,
    warmups,
  },
  datasets: [],
  diagnostics: {
    consoleErrors: [],
    httpErrors: [],
    pageErrors: [],
    requestFailures: [],
  },
}

let browser = null
let page = null
let preview = null
let runDirectory = null
let failure = null

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

try {
  if (!providedBaseUrl) preview = await startPreviewServer(port, artifactsDirectory)
  const executablePath = await resolveBrowserExecutable(browserName)
  runDirectory = await mkdtemp(join(tmpdir(), 'nanquim-browser-performance-'))
  assertSafeRunDirectory(runDirectory, { repositoryRoot: ROOT, temporaryRoot: tmpdir() })

  browser = await puppeteer.launch({
    browser: browserName === 'firefox' ? 'firefox' : 'chrome',
    executablePath,
    headless: true,
    protocol: browserName === 'firefox' ? 'webDriverBiDi' : 'cdp',
    userDataDir: join(runDirectory, 'profile'),
    defaultViewport: BROWSER_VIEWPORT,
    args: browserName === 'chromium'
      ? ['--disable-dev-shm-usage', '--no-sandbox']
      : [],
  })
  report.environment.browserVersion = await browser.version()

  page = await browser.newPage()
  page.setDefaultTimeout(Number(process.env.NANQUIM_PERFORMANCE_TIMEOUT || 180000))
  attachDiagnostics(page, report.diagnostics)
  await openApplication(page)

  for (const size of datasetSizes) {
    const dataset = createNativeSvgDataset(size)
    process.stdout.write(`\n${size.toLocaleString('en-US')} elements\n`)
    const datasetResult = createDatasetResult(dataset)
    report.datasets.push(datasetResult)
    await runDataset(page, dataset, datasetResult)
  }

  assertNoRuntimeErrors(report.diagnostics)
  const exceeded = report.datasets.flatMap(dataset => (
    Object.entries(dataset.metrics)
      .filter(([, result]) => !result.passed)
      .map(([metric, result]) => ({ count: dataset.count, metric, result }))
  ))
  report.exceededBudgets = exceeded
  if (enforceBudgets && exceeded.length > 0) {
    const labels = exceeded.map(item => `${item.count}:${item.metric}`).join(', ')
    throw new Error(`Performance budget exceeded: ${labels}`)
  }
  report.status = exceeded.length > 0 ? 'reported-with-regressions' : 'passed'
} catch (error) {
  failure = error
  report.status = 'failed'
  report.error = {
    message: String(error?.message || error),
    stack: String(error?.stack || '').slice(0, 8000),
  }
  if (page) {
    try {
      await page.screenshot({ path: join(artifactsDirectory, 'failure.png'), fullPage: true })
    } catch (_) { /* best effort */ }
  }
} finally {
  report.finishedAt = new Date().toISOString()
  if (browser) {
    try { await browser.close() } catch (_) { /* best effort */ }
  }
  if (preview) await stopPreviewServer(preview)
  if (runDirectory) await rm(runDirectory, { recursive: true, force: true })
  await writeJson(join(artifactsDirectory, 'summary.json'), report)
}

printReport(report)
if (failure) {
  process.stderr.write(`Performance benchmark failed: ${failure.stack || failure.message}\n`)
  process.stderr.write(`Evidence: ${artifactsDirectory}\n`)
  process.exitCode = 1
}

function createDatasetResult(dataset) {
  return {
    checksum: dataset.checksum,
    count: dataset.definition.count,
    definition: dataset.definition,
    sourceBytes: dataset.sourceBytes,
    metrics: {},
  }
}

async function runDataset(activePage, dataset, result) {
  const { definition, source, sourceBytes, checksum } = dataset
  if (
    result.count !== definition.count
    || result.checksum !== checksum
    || result.sourceBytes !== sourceBytes
  ) throw new TypeError('Performance dataset evidence does not match its generated source.')

  await measureMetric(result, 'load', async () => {
    return activePage.evaluate(async payload => {
      const started = performance.now()
      const loadResult = await window.editor.loader.loadSource(payload.source, {
        name: `performance-${payload.count}.svg`,
        type: 'image/svg+xml',
      })
      await new Promise(resolvePromise => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)))
      if (!loadResult?.ok) throw new Error(loadResult?.error?.message || 'Dataset load failed.')
      const collection = window.editor.activeCollection
      const loadedCount = collection?.node?.children?.length || 0
      if (loadedCount !== payload.count) {
        throw new Error(`Loaded ${loadedCount} elements; expected ${payload.count}.`)
      }
      return {
        duration: performance.now() - started,
        detail: { loadedCount },
      }
    }, { count: definition.count, source })
  })

  await measureMetric(result, 'canonicalSave', async () => {
    return activePage.evaluate(expectedCount => {
      const started = performance.now()
      const saved = window.editor.documents.serialize(window.editor)
      const duration = performance.now() - started
      const currentCount = window.editor.activeCollection?.node?.children?.length || 0
      if (currentCount !== expectedCount) throw new Error('Save changed the live dataset.')
      return {
        duration,
        detail: { serializedBytes: new TextEncoder().encode(saved).byteLength },
      }
    }, definition.count)
  })

  await measureMetric(result, 'spatialIndexRebuild', async () => {
    return activePage.evaluate(expectedCount => {
      const editor = window.editor
      editor.spatialIndex.markDirty()
      const started = performance.now()
      editor.spatialIndex.ensureFresh(editor)
      const duration = performance.now() - started
      const indexedCount = editor.spatialIndex.tree.all().length
      if (indexedCount !== expectedCount) {
        throw new Error(`Indexed ${indexedCount} elements; expected ${expectedCount}.`)
      }
      return { duration, detail: { indexedCount } }
    }, definition.count)
  })

  await measureMetric(result, 'spatialIndexQuery', async () => {
    return activePage.evaluate(fixture => {
      const editor = window.editor
      editor.spatialIndex.ensureFresh(editor)
      const queryCount = 250
      let candidateCount = 0
      const started = performance.now()
      for (let index = 0; index < queryCount; index += 1) {
        const column = (index * 17) % fixture.columns
        const row = (index * 31) % fixture.rows
        const x = column * fixture.spacing - 1
        const y = row * fixture.spacing - 1
        candidateCount += editor.spatialIndex.search({
          minX: x,
          minY: y,
          maxX: x + fixture.spacing + 2,
          maxY: y + fixture.spacing + 2,
        }).length
      }
      return {
        duration: performance.now() - started,
        detail: { candidateCount, queryCount },
      }
    }, definition)
  })

  await measureMetric(result, 'pan', () => performPan(activePage))
  await measureMetric(result, 'zoom', () => performZoom(activePage))
  await measureMetric(result, 'windowSelection', () => performWindowSelection(activePage, definition))
  await measureMetric(result, 'snap', () => performSnap(activePage, definition))

  await measureMetric(result, 'outlinerSync', async () => {
    return activePage.evaluate(async expectedCount => {
      const editor = window.editor
      editor.signals.clearSelection.dispatch()
      const collectionState = editor.collections.get(editor.activeCollection.attr('id'))
      if (!collectionState) throw new Error('Outliner benchmark collection state is missing.')
      // Large collections are collapsed automatically during ordinary load.
      // Explicitly expand this fixed fixture so the dedicated metric covers
      // full row creation and synchronization rather than only its header.
      collectionState.collapsed = false
      const started = performance.now()
      editor.signals.updatedOutliner.dispatch()
      const rows = document.querySelectorAll('#drawing-tree .collection-row').length
      await new Promise(resolvePromise => requestAnimationFrame(resolvePromise))
      if (rows < expectedCount) {
        throw new Error(`Outliner rendered ${rows} rows for ${expectedCount} elements.`)
      }
      return {
        duration: performance.now() - started,
        detail: { rows },
      }
    }, definition.count)
  })

  const geometryNodesInstance = await activePage.evaluate(() => {
    const editor = window.editor
    editor.signals.clearSelection.dispatch()
    const collectionState = editor.collections.get(editor.activeCollection.attr('id'))
    if (collectionState) collectionState.collapsed = true
    editor.signals.updatedOutliner.dispatch()
    const element = editor.activeCollection?.children?.()[0]
    if (!element) throw new Error('Geometry Nodes benchmark source is missing.')
    const instance = editor.geometryNodes.attachSelection([element], null, false)
    if (!instance) throw new Error('Could not attach the Geometry Nodes benchmark modifier.')
    return instance.id
  })

  await measureMetric(result, 'geometryNodesEvaluation', async () => {
    return activePage.evaluate(async instanceId => {
      const manager = window.editor.geometryNodes
      const instance = manager.instances.get(instanceId)
      if (!instance) throw new Error('Geometry Nodes benchmark instance was lost.')
      const started = performance.now()
      await Promise.resolve(manager.evaluateInstance(instance))
      await new Promise(resolvePromise => requestAnimationFrame(resolvePromise))
      if (instance.status !== 'ready') {
        throw new Error(`Geometry Nodes evaluation ended in ${instance.status} state.`)
      }
      return {
        duration: performance.now() - started,
        detail: { outputElements: instance.output.node.querySelectorAll('*').length },
      }
    }, geometryNodesInstance)
  })

  return result
}

async function measureMetric(datasetResult, metric, operation) {
  if (!PERFORMANCE_METRICS.includes(metric)) throw new TypeError(`Unknown metric: ${metric}`)
  process.stdout.write(`- ${metric} ... `)
  const values = []
  let detail = null
  for (let index = 0; index < warmups + samples; index += 1) {
    const measurement = await operation(index)
    const duration = Number(measurement?.duration ?? measurement)
    if (!Number.isFinite(duration) || duration < 0) {
      throw new TypeError(`${metric} returned an invalid duration.`)
    }
    if (index >= warmups) values.push(duration)
    if (measurement?.detail) detail = measurement.detail
  }
  const summary = summarizeSamples(values)
  const budgetResult = evaluateBudget(summary, PERFORMANCE_BUDGETS_MS[datasetResult.count][metric])
  datasetResult.metrics[metric] = { ...summary, ...budgetResult, detail }
  process.stdout.write(`${summary.median.toFixed(1)} ms median / ${summary.p95.toFixed(1)} ms p95${budgetResult.passed ? '' : ' (over budget)'}\n`)
}

async function performPan(activePage) {
  const bounds = await canvasBounds(activePage)
  const start = { x: bounds.left + bounds.width * 0.52, y: bounds.top + bounds.height * 0.52 }
  const end = { x: start.x + 48, y: start.y + 32 }
  const before = await activePage.evaluate(() => {
    const viewBox = window.editor.svg.viewbox()
    return { started: performance.now(), x: viewBox.x, y: viewBox.y }
  })
  await activePage.mouse.move(start.x, start.y)
  await activePage.mouse.down({ button: 'middle' })
  await activePage.mouse.move(end.x, end.y, { steps: 3 })
  await activePage.mouse.up({ button: 'middle' })
  return activePage.evaluate(async previous => {
    await new Promise(resolvePromise => requestAnimationFrame(resolvePromise))
    const viewBox = window.editor.svg.viewbox()
    if (viewBox.x === previous.x && viewBox.y === previous.y) {
      throw new Error('Representative pan gesture did not change the viewBox.')
    }
    return {
      duration: performance.now() - previous.started,
      detail: { deltaX: viewBox.x - previous.x, deltaY: viewBox.y - previous.y },
    }
  }, before)
}

async function performZoom(activePage) {
  const bounds = await canvasBounds(activePage)
  const point = { x: bounds.left + bounds.width * 0.5, y: bounds.top + bounds.height * 0.5 }
  await activePage.mouse.move(point.x, point.y)
  const before = await activePage.evaluate(() => ({
    started: performance.now(),
    width: window.editor.svg.viewbox().width,
  }))
  await activePage.mouse.wheel({ deltaY: -120 })
  return activePage.evaluate(async previous => {
    await new Promise(resolvePromise => requestAnimationFrame(resolvePromise))
    const width = window.editor.svg.viewbox().width
    if (width === previous.width) throw new Error('Representative zoom gesture did not change the viewBox.')
    return {
      duration: performance.now() - previous.started,
      detail: { widthRatio: width / previous.width },
    }
  }, before)
}

async function performWindowSelection(activePage, definition) {
  await resetViewport(activePage, definition)
  const bounds = await canvasBounds(activePage)
  const start = { x: bounds.left + bounds.width * 0.01, y: bounds.top + bounds.height * 0.01 }
  const end = { x: bounds.left + bounds.width * 0.2, y: bounds.top + bounds.height * 0.2 }
  await activePage.mouse.move(start.x, start.y)
  await activePage.evaluate(() => new Promise(resolvePromise => requestAnimationFrame(resolvePromise)))
  const started = await activePage.evaluate(() => performance.now())
  // The vendored SVG draw plugin starts a rectangle on the first canvas click
  // and commits it on the next click. Use that real interaction contract rather
  // than synthesizing a generic drag that would leave the plugin active.
  await activePage.mouse.click(start.x, start.y, { button: 'left' })
  await activePage.mouse.move(end.x, end.y, { steps: 3 })
  await activePage.mouse.click(end.x, end.y, { button: 'left' })
  await activePage.waitForFunction(() => !window.editor.isDrawing && !window.editor.isSelecting)
  return activePage.evaluate(async startTime => {
    await new Promise(resolvePromise => requestAnimationFrame(resolvePromise))
    const selectedCount = window.editor.selected.length
    if (selectedCount === 0) throw new Error('Representative window selection selected no elements.')
    return {
      duration: performance.now() - startTime,
      detail: { selectedCount },
    }
  }, started)
}

async function performSnap(activePage, definition) {
  await resetViewport(activePage, definition)
  const target = await activePage.evaluate(() => {
    const editor = window.editor
    const node = editor.activeCollection?.node?.querySelector('line')
    if (!node) throw new Error('Snap benchmark line is missing.')
    editor.isSnapping = true
    editor.isInteracting = true
    editor.spatialIndex.markDirty()
    editor.spatialIndex.ensureFresh(editor)
    const point = editor.svg.node.createSVGPoint()
    point.x = Number(node.getAttribute('x1'))
    point.y = Number(node.getAttribute('y1'))
    const screen = point.matrixTransform(editor.svg.node.getScreenCTM())
    return { x: screen.x, y: screen.y }
  })
  await activePage.mouse.move(target.x + 80, target.y + 80)
  await activePage.evaluate(() => new Promise(resolvePromise => requestAnimationFrame(resolvePromise)))
  const started = await activePage.evaluate(() => performance.now())
  await activePage.mouse.move(target.x, target.y)
  return activePage.evaluate(async startTime => {
    await new Promise(resolvePromise => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)))
    const editor = window.editor
    const snapPoint = editor.snapPoint && { x: editor.snapPoint.x, y: editor.snapPoint.y }
    editor.isInteracting = false
    editor.isSnapping = false
    if (!snapPoint) throw new Error('Representative pointer move produced no object snap.')
    return {
      duration: performance.now() - startTime,
      detail: { snapPoint },
    }
  }, started)
}

async function resetViewport(activePage, definition) {
  await activePage.evaluate(fixture => {
    const editor = window.editor
    editor.signals.commandCancelled.dispatch()
    editor.signals.clearSelection.dispatch()
    editor.svg.viewbox(fixture.viewBox)
    editor.isDrawing = false
    editor.isInteracting = false
    editor.isSelecting = false
    editor.isSnapping = false
  }, definition)
  await activePage.evaluate(() => new Promise(resolvePromise => requestAnimationFrame(resolvePromise)))
}

async function canvasBounds(activePage) {
  const bounds = await activePage.evaluate(() => {
    const rect = window.editor?.svg?.node?.getBoundingClientRect()
    return rect && { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  })
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('Could not locate the Model Space SVG canvas.')
  }
  return bounds
}

async function openApplication(activePage) {
  await activePage.goto(baseUrl, { waitUntil: 'networkidle0' })
  await activePage.waitForFunction(() => Boolean(window.editor?.documents && window.welcomeScreen))
  await activePage.waitForSelector('#ws-new')
  await activePage.click('#ws-new')
  await activePage.waitForFunction(() => !document.getElementById('welcome-overlay'))
  await activePage.waitForFunction(() => window.editor.documentState?.fileName === 'Untitled.svg')
}

function attachDiagnostics(activePage, diagnostics) {
  const append = (field, value) => {
    if (diagnostics[field].length < 20) diagnostics[field].push(value)
  }
  activePage.on('console', message => {
    if (message.type() === 'error') append('consoleErrors', String(message.text()).slice(0, 1000))
  })
  activePage.on('pageerror', error => append('pageErrors', String(error.message).slice(0, 1000)))
  activePage.on('requestfailed', request => append('requestFailures', {
    method: request.method(),
    url: request.url(),
    error: request.failure()?.errorText,
  }))
  activePage.on('response', response => {
    if (response.status() >= 400) append('httpErrors', { status: response.status(), url: response.url() })
  })
  activePage.on('dialog', dialog => dialog.accept())
}

function assertNoRuntimeErrors(diagnostics) {
  const counts = Object.fromEntries(Object.entries(diagnostics).map(([name, values]) => [name, values.length]))
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  if (total > 0) throw new Error(`Browser diagnostics recorded runtime failures: ${JSON.stringify(counts)}`)
}

async function startPreviewServer(serverPort, outputDirectory) {
  await access(join(ROOT, 'dist/index.html'), fsConstants.R_OK).catch(() => {
    throw new Error('Production output is missing. Run `pnpm build` before the performance benchmark.')
  })
  const logPath = join(outputDirectory, 'preview.log')
  const chunks = []
  const child = spawn('pnpm', [
    'exec',
    'vite',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(serverPort),
    '--strictPort',
  ], {
    cwd: ROOT,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', chunk => chunks.push(chunk.toString()))
  child.stderr.on('data', chunk => chunks.push(chunk.toString()))

  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      await writeFile(logPath, chunks.join(''), 'utf8')
      throw new Error(`Vite preview exited before it became ready (code ${child.exitCode}).`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}`)
      if (response.ok) {
        await writeFile(logPath, chunks.join(''), 'utf8')
        return { child, chunks, logPath }
      }
    } catch (_) { /* server is still starting */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
  }
  child.kill('SIGTERM')
  throw new Error('Timed out waiting for the Vite preview server.')
}

async function stopPreviewServer(previewServer) {
  const { child, chunks, logPath } = previewServer
  await writeFile(logPath, chunks.join(''), 'utf8')
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise(resolvePromise => child.once('exit', resolvePromise)),
    new Promise(resolvePromise => setTimeout(resolvePromise, 3000)),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function resolveBrowserExecutable(name) {
  const configured = cli.executable || process.env.NANQUIM_PERFORMANCE_EXECUTABLE
  const candidates = configured
    ? [configured]
    : name === 'firefox'
      ? ['/usr/bin/firefox', '/usr/bin/firefox-esr', '/Applications/Firefox.app/Contents/MacOS/firefox']
      : [
          '/usr/bin/google-chrome-stable',
          '/usr/bin/google-chrome',
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ]
  for (const candidate of candidates) {
    const resolved = resolve(candidate)
    try {
      await access(resolved, fsConstants.X_OK)
      return resolved
    } catch (_) { /* try the next path */ }
  }
  throw new Error(`Could not find ${name}. Set NANQUIM_PERFORMANCE_EXECUTABLE to a runnable browser binary.`)
}

function printReport(value) {
  process.stdout.write(`\nStatus: ${value.status}\n`)
  for (const dataset of value.datasets) {
    process.stdout.write(`${dataset.count.toLocaleString('en-US')} elements (${dataset.checksum})\n`)
    for (const [metric, result] of Object.entries(dataset.metrics)) {
      process.stdout.write(`  ${metric}: ${result.median.toFixed(1)} ms median, ${result.p95.toFixed(1)} ms p95${result.passed ? '' : ' [OVER BUDGET]'}\n`)
    }
  }
  process.stdout.write(`Evidence: ${join(artifactsDirectory, 'summary.json')}\n`)
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function integerOption(value, fallback, { label, min, max }) {
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}.`)
  }
  return number
}

function parseDatasetSizes(value) {
  if (value === undefined) return [...PERFORMANCE_DATASET_SIZES]
  const parsed = String(value).split(',').map(part => Number(part.trim()))
  if (
    parsed.length === 0
    || new Set(parsed).size !== parsed.length
    || parsed.some(size => !PERFORMANCE_DATASET_SIZES.includes(size))
  ) {
    throw new RangeError('sizes must be a unique comma-separated subset of 1000,10000.')
  }
  return parsed
}

function parseArguments(argumentsList) {
  return Object.fromEntries(argumentsList.map(argument => {
    const normalized = argument.replace(/^--/, '')
    const separator = normalized.indexOf('=')
    const rawKey = separator < 0 ? normalized : normalized.slice(0, separator)
    const key = rawKey.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())
    return separator < 0
      ? [key, true]
      : [key, normalized.slice(separator + 1)]
  }))
}
