import { constants as fsConstants } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

import {
  assertSafeArtifactsDirectory,
  assertSafeRunDirectory,
} from './path-safety.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DEFAULT_PORT = 4173
const BROWSER_VIEWPORT = Object.freeze({ width: 1280, height: 800, deviceScaleFactor: 1 })
const TEST_RECTANGLE_WIDTH = 2
const TEST_RECTANGLE_HEIGHT = 1.5
const TEST_MOVE_DELTA = Object.freeze({ x: 1, y: 0.5 })
const FIXTURE_PATH = join(ROOT, 'tests/fixtures/native-v3.svg')
const SVG_PROFILE_FIXTURE_PATH = join(ROOT, 'tests/fixtures/interoperability-profile.svg')
const SVG_UNSUPPORTED_FIXTURE_PATH = join(ROOT, 'tests/fixtures/interoperability-unsupported.svg')
const DXF_FIXTURE_PATH = join(ROOT, 'tests/fixtures/dxf-layers-units-r2000.dxf')
const ARTIFACTS_ROOT = join(ROOT, 'test-results/browser')
const cli = parseArguments(process.argv.slice(2))
const browserName = cli.browser || process.env.NANQUIM_BROWSER || 'chromium'
const port = Number(cli.port || process.env.NANQUIM_BROWSER_PORT || DEFAULT_PORT)
const providedBaseUrl = cli.baseUrl || process.env.NANQUIM_BROWSER_BASE_URL
const baseUrl = providedBaseUrl || `http://127.0.0.1:${port}`
const artifactsDirectory = resolve(
  ROOT,
  cli.artifacts || process.env.NANQUIM_BROWSER_ARTIFACTS || `test-results/browser/${browserName}`,
)
const actionTrace = []
const consoleEntries = []
const pageErrors = []
const requestFailures = []
const httpErrors = []
let previewProcess = null
let browser = null
let page = null
let devtoolsTraceStarted = false
let failure = null
let runDirectory = null

if (!['chromium', 'firefox'].includes(browserName)) {
  throw new TypeError(`Unsupported browser "${browserName}". Use chromium or firefox.`)
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new TypeError(`Invalid preview port "${port}".`)
}

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
  if (!providedBaseUrl) previewProcess = await startPreviewServer(port, artifactsDirectory)

  const executablePath = await resolveBrowserExecutable(browserName)
  runDirectory = await mkdtemp(join(tmpdir(), 'nanquim-browser-'))
  assertSafeRunDirectory(runDirectory, { repositoryRoot: ROOT, temporaryRoot: tmpdir() })
  const downloadsDirectory = join(runDirectory, 'downloads')
  await mkdir(downloadsDirectory)
  browser = await puppeteer.launch({
    browser: browserName === 'firefox' ? 'firefox' : 'chrome',
    executablePath,
    headless: true,
    protocol: browserName === 'firefox' ? 'webDriverBiDi' : 'cdp',
    userDataDir: join(runDirectory, 'profile'),
    downloadBehavior: {
      policy: 'allow',
      downloadPath: downloadsDirectory,
    },
    // Apply the viewport while Puppeteer creates the BiDi browsing context.
    // Firefox ESR lacks emulation.setScreenOrientationOverride; Puppeteer
    // tolerates that optional command at this boundary while still applying
    // browsingContext.setViewport.
    defaultViewport: BROWSER_VIEWPORT,
    args: browserName === 'chromium'
      ? ['--disable-dev-shm-usage', '--no-sandbox']
      : [],
  })

  page = await browser.newPage()
  page.setDefaultTimeout(Number(process.env.NANQUIM_BROWSER_TIMEOUT || 15000))
  attachDiagnostics(page)

  if (browserName === 'chromium') {
    await page.tracing.start({
      path: join(artifactsDirectory, 'devtools-trace.json'),
      screenshots: true,
    })
    devtoolsTraceStarted = true
  }

  const metadata = {
    browser: browserName,
    browserVersion: await browser.version(),
    executablePath,
    baseUrl,
    runDirectory,
    startedAt: new Date().toISOString(),
  }
  trace('metadata', metadata)
  process.stdout.write(`Browser: ${metadata.browserVersion}\nExecutable: ${executablePath}\n`)

  await runWorkflows(page)
  await assertNoRuntimeErrors()

  metadata.finishedAt = new Date().toISOString()
  metadata.status = 'passed'
  metadata.steps = actionTrace.filter(entry => entry.kind === 'step' && entry.status === 'passed').length
  await writeJson(join(artifactsDirectory, 'summary.json'), metadata)
  process.stdout.write(`Browser workflows passed (${metadata.steps} steps).\n`)
} catch (error) {
  failure = error
  trace('failure', { message: error?.message, stack: error?.stack })
  if (page) {
    try {
      await page.screenshot({
        path: join(artifactsDirectory, 'failure.png'),
        fullPage: true,
      })
    } catch (screenshotError) {
      trace('artifact-error', { artifact: 'failure.png', message: screenshotError.message })
    }
  }
} finally {
  if (devtoolsTraceStarted && page) {
    try {
      await page.tracing.stop()
      if (!failure) await rm(join(artifactsDirectory, 'devtools-trace.json'), { force: true })
    } catch (traceError) {
      trace('artifact-error', { artifact: 'devtools-trace.json', message: traceError.message })
    }
  }

  await Promise.all([
    writeJson(join(artifactsDirectory, 'workflow-trace.json'), actionTrace),
    writeJson(join(artifactsDirectory, 'console.json'), consoleEntries),
    writeJson(join(artifactsDirectory, 'runtime-errors.json'), {
      pageErrors,
      requestFailures,
      httpErrors,
    }),
  ])

  if (browser) {
    try { await browser.close() } catch (_) { /* best effort */ }
  }
  if (previewProcess) await stopPreviewServer(previewProcess)
  if (runDirectory) await rm(runDirectory, { recursive: true, force: true })
}

if (failure) {
  process.stderr.write(`Browser workflows failed: ${failure.stack || failure.message}\n`)
  process.stderr.write(`Artifacts: ${artifactsDirectory}\n`)
  process.exitCode = 1
}

async function runWorkflows(activePage) {
  await step('load a clean application session', async () => {
    await activePage.goto(baseUrl, { waitUntil: 'networkidle0' })
    const viewport = await activePage.evaluate(() => ({
      height: window.innerHeight,
      width: window.innerWidth,
    }))
    assert(
      viewport.width === BROWSER_VIEWPORT.width && viewport.height === BROWSER_VIEWPORT.height,
      `Expected a ${BROWSER_VIEWPORT.width}x${BROWSER_VIEWPORT.height} viewport, got ${viewport.width}x${viewport.height}.`,
    )
    await activePage.waitForFunction(() => Boolean(window.editor?.documents && window.welcomeScreen))
    await activePage.waitForSelector('#ws-new')
    await activePage.click('#ws-new')
    await activePage.waitForFunction(() => !document.getElementById('welcome-overlay'))
    await activePage.waitForFunction(() => window.editor.documentState?.fileName === 'Untitled.svg')
    await installDeterministicBrowserCapabilities(activePage)
  })

  await step('create a rectangle from typed dimensions', async () => {
    await runTerminalCommand(activePage, 'rec')
    const canvasPoint = await canvasScreenPoint(activePage, 0.56, 0.48)
    await activePage.mouse.click(canvasPoint.x, canvasPoint.y)
    await activePage.keyboard.press('KeyD')
    await waitForTerminalText(activePage, 'Width:')
    await typeTerminalValue(activePage, String(TEST_RECTANGLE_WIDTH))
    await waitForTerminalText(activePage, 'Height:')
    await typeTerminalValue(activePage, String(TEST_RECTANGLE_HEIGHT))
    await waitForTerminalText(activePage, 'type @x,y / #x,y')
    await typeTerminalValue(activePage, '@1,1')
    await activePage.waitForFunction(({ expectedHeight, expectedWidth }) => (
      Array.from(document.querySelectorAll('#Collection rect')).some(rect => (
        Number(rect.getAttribute('width')) === expectedWidth
        && Number(rect.getAttribute('height')) === expectedHeight
      ))
    ), {}, {
      expectedHeight: TEST_RECTANGLE_HEIGHT,
      expectedWidth: TEST_RECTANGLE_WIDTH,
    })
  })

  await step('select, Move, Undo, and Redo the rectangle', async () => {
    const original = await selectDimensionedRectangle(activePage)
    await runTerminalCommand(activePage, 'm')
    await typeTerminalValue(activePage, '#0,0')
    await typeTerminalValue(activePage, `@${TEST_MOVE_DELTA.x},${TEST_MOVE_DELTA.y}`)
    await activePage.waitForFunction(({ deltaX, deltaY, width, x, y }) => {
      const rect = Array.from(document.querySelectorAll('#Collection rect'))
        .find(candidate => Number(candidate.getAttribute('width')) === width)
      return rect
        && Number(rect.getAttribute('x')) === x + deltaX
        && Number(rect.getAttribute('y')) === y + deltaY
    }, {}, {
      ...original,
      deltaX: TEST_MOVE_DELTA.x,
      deltaY: TEST_MOVE_DELTA.y,
      width: TEST_RECTANGLE_WIDTH,
    })
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    await waitForRectanglePosition(activePage, original.x, original.y)
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    await waitForRectanglePosition(
      activePage,
      original.x + TEST_MOVE_DELTA.x,
      original.y + TEST_MOVE_DELTA.y,
    )
    const transformAttribute = await activePage.evaluate((expectedWidth) => {
      const rect = Array.from(document.querySelectorAll('#Collection rect'))
        .find(candidate => Number(candidate.getAttribute('width')) === expectedWidth)
      return rect?.getAttribute('transform') ?? null
    }, TEST_RECTANGLE_WIDTH)
    assert(transformAttribute === null, 'MOVE left an identity transform on the rectangle.')
  })

  await step('rotate the moved rectangle in Model space and undo the rotation', async () => {
    await selectDimensionedRectangle(activePage)
    const original = await activePage.evaluate((expectedWidth) => {
      const rect = Array.from(document.querySelectorAll('#Collection rect'))
        .find(candidate => Number(candidate.getAttribute('width')) === expectedWidth)
      if (!rect) return null
      const bounds = rect.getBoundingClientRect()
      return {
        centerX: bounds.left + bounds.width / 2,
        centerY: bounds.top + bounds.height / 2,
        height: bounds.height,
        historyDepth: window.editor.history.undos.length,
        id: rect.id,
        markup: rect.outerHTML,
        revision: window.editor.documentState.revision,
        transform: rect.getAttribute('transform'),
        width: bounds.width,
        x: Number(rect.getAttribute('x')),
        y: Number(rect.getAttribute('y')),
      }
    }, TEST_RECTANGLE_WIDTH)
    assert(original, 'Could not capture the moved rectangle before ROTATE.')

    // Exercise the reference-point preview and cancellation path first. Preview
    // transforms must not leak into persistent geometry or dirty DocumentState.
    await runTerminalCommand(activePage, 'r')
    await waitForTerminalText(activePage, 'Specify center point.')
    await activePage.mouse.click(original.centerX, original.centerY)
    await waitForTerminalText(activePage, 'Specify reference point or an angle to rotate.')
    await activePage.mouse.click(original.centerX + 40, original.centerY)
    await waitForTerminalText(activePage, 'Specify the target point.')
    await activePage.mouse.move(original.centerX, original.centerY + 40)
    await activePage.waitForFunction(({ id, transform }) => (
      document.getElementById(id)?.getAttribute('transform') !== transform
    ), {}, original)
    const previewState = await activePage.evaluate(() => ({
      historyDepth: window.editor.history.undos.length,
      observedMutation: window.editor.documentState.flushObservedMutations(),
      revision: window.editor.documentState.revision,
    }))
    assert(previewState.observedMutation === false, 'ROTATE preview queued a persistent mutation.')
    assert(previewState.revision === original.revision, 'ROTATE preview dirtied DocumentState.')
    assert(
      previewState.historyDepth === original.historyDepth,
      'ROTATE preview entered History before commit.',
    )
    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(({ historyDepth, id, revision, transform }) => {
      const rect = document.getElementById(id)
      return rect?.getAttribute('transform') === transform
        && window.editor.documentState.revision === revision
        && window.editor.history.undos.length === historyDepth
        && !window.editor.isInteracting
    }, {}, original)

    await selectDimensionedRectangle(activePage)
    await runTerminalCommand(activePage, 'r')
    await waitForTerminalText(activePage, 'Specify center point.')
    await activePage.mouse.click(original.centerX, original.centerY)
    await waitForTerminalText(activePage, 'Specify reference point or an angle to rotate.')
    await typeTerminalValue(activePage, '')
    await waitForTerminalText(activePage, 'Enter a valid rotation angle.')
    await typeTerminalValue(activePage, '90')
    await activePage.waitForFunction(id => {
      const rotated = document.getElementById(id)
      return rotated?.localName === 'polygon'
        && document.getElementById('terminalLog')?.textContent?.includes(
          'Elements rotated by 90.00 degrees.',
        )
        && !window.editor.isInteracting
        && !window.editor.suppressHandlers
        && !window.editor.selectSingleElement
    }, {}, original.id)

    const rotated = await activePage.evaluate((id) => {
      const element = document.getElementById(id)
      if (!element) return null
      const bounds = element.getBoundingClientRect()
      const coordinates = (element.getAttribute('points') || '')
        .trim()
        .split(/[\s,]+/)
        .map(Number)
      const xs = coordinates.filter((_value, index) => index % 2 === 0)
      const ys = coordinates.filter((_value, index) => index % 2 === 1)
      return {
        centerX: bounds.left + bounds.width / 2,
        centerY: bounds.top + bounds.height / 2,
        geometryHeight: Math.max(...ys) - Math.min(...ys),
        geometryWidth: Math.max(...xs) - Math.min(...xs),
        height: bounds.height,
        markup: element.outerHTML,
        terminal: document.getElementById('terminalLog')?.textContent || '',
        width: bounds.width,
      }
    }, original.id)
    assert(rotated, 'ROTATE removed the moved rectangle without a replacement.')
    trace('move-rotate', { original, rotated })
    assert(rotated.markup !== original.markup, 'ROTATE did not change the rectangle geometry.')
    assert(
      !rotated.terminal.includes(
        'ROTATE does not support transformed primitive geometry or geometry inside transformed groups.',
      ),
      'ROTATE reported the retired transformed-primitive rejection.',
    )
    const geometryTolerance = 1e-8
    assert(
      Math.abs(rotated.geometryWidth - TEST_RECTANGLE_HEIGHT) <= geometryTolerance
        && Math.abs(rotated.geometryHeight - TEST_RECTANGLE_WIDTH) <= geometryTolerance,
      'ROTATE did not swap the moved rectangle geometry bounds at 90 degrees.',
    )
    const pixelTolerance = 2
    assert(
      Math.abs(rotated.centerX - original.centerX) <= pixelTolerance
        && Math.abs(rotated.centerY - original.centerY) <= pixelTolerance,
      'ROTATE did not preserve the selected rectangle center.',
    )
    const transients = await transientCounts(activePage)
    assert(transients.previews === 0, `ROTATE left ${transients.previews} preview helper(s).`)

    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    await activePage.waitForFunction(({ id, x, y }) => {
      const rect = document.getElementById(id)
      return rect?.localName === 'rect'
        && Number(rect.getAttribute('x')) === x
        && Number(rect.getAttribute('y')) === y
        && !rect.hasAttribute('transform')
        && !rect.hasAttribute('selected')
        && !rect.classList.contains('elementHover')
        && !rect.classList.contains('elementSelected')
    }, {}, original)

    // A non-identity authored SVG transform exercises computed-style matrix
    // rounding in the real engine. It must rotate, round-trip, and never be
    // mistaken for an overriding CSS transform.
    const authored = await activePage.evaluate((id) => {
      const element = window.editor.drawing.findOne(`[id="${id}"]`)
      const rect = element?.node
      if (!element || !rect) return null
      const cx = Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2
      const cy = Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2
      const transform = `rotate(37 ${cx} ${cy})`
      window.editor.documentState.runWithoutTracking(() => element.attr('transform', transform))
      const ctm = rect.getScreenCTM()
      const center = new DOMPoint(cx, cy).matrixTransform(ctm)
      window.editor.selected = [element]
      return {
        centerX: center.x,
        centerY: center.y,
        historyDepth: window.editor.history.undos.length,
        revision: window.editor.documentState.revision,
        transform,
      }
    }, original.id)
    assert(authored, 'Could not prepare the authored affine ROTATE browser check.')

    await runTerminalCommand(activePage, 'r')
    await waitForTerminalText(activePage, 'Specify center point.')
    await activePage.mouse.click(authored.centerX, authored.centerY)
    await waitForTerminalText(activePage, 'Specify reference point or an angle to rotate.')
    await typeTerminalValue(activePage, '13')
    await activePage.waitForFunction(({ historyDepth, id, revision, transform }) => {
      const rect = document.getElementById(id)
      return rect?.localName === 'rect'
        && rect.getAttribute('transform') !== transform
        && window.editor.history.undos.length === historyDepth + 1
        && window.editor.documentState.revision === revision + 1
        && document.getElementById('terminalLog')?.textContent?.includes(
          'Elements rotated by 13.00 degrees.',
        )
    }, {}, { ...authored, id: original.id })

    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    await activePage.waitForFunction(({ id, transform }) => (
      document.getElementById(id)?.getAttribute('transform') === transform
    ), {}, { ...authored, id: original.id })
    const authoredCleanupRevision = await activePage.evaluate((id) => {
      const element = window.editor.drawing.findOne(`[id="${id}"]`)
      window.editor.documentState.runWithoutTracking(() => element.node.removeAttribute('transform'))
      window.editor.documentState.flushObservedMutations()
      return window.editor.documentState.revision
    }, original.id)
    assert(
      authoredCleanupRevision === authored.revision + 2,
      'Authored-transform browser cleanup changed DocumentState outside History.',
    )

    // ROTATE stores the prior selection for the normal Previous-selection UI.
    // Reapply and clear it so later pointer-selection steps start from a clean state.
    await runTerminalCommand(activePage, 'p')
    await activePage.keyboard.press('Escape')
  })

  await step('cancel repeated active commands without helpers', async () => {
    const baseline = await transientCounts(activePage)
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await runTerminalCommand(activePage, 'l')
      const start = await canvasScreenPoint(activePage, 0.42, 0.42)
      const end = await canvasScreenPoint(activePage, 0.48, 0.46)
      await activePage.mouse.click(start.x, start.y)
      await activePage.mouse.move(end.x, end.y, { steps: 3 })
      await activePage.waitForFunction(() => {
        const line = document.querySelector('#Collection line[data-nanquim-transient]')
        if (!line) return false
        return Number(line.getAttribute('x1')) !== Number(line.getAttribute('x2'))
          || Number(line.getAttribute('y1')) !== Number(line.getAttribute('y2'))
      })
      const active = await transientCounts(activePage)
      assert(active.previews > baseline.previews, 'LINE did not expose a visible transient preview before cancellation.')
      await activePage.keyboard.press('Escape')
      await activePage.waitForFunction(() => (
        !window.editor.isDrawing
        && !window.editor.isInteracting
        && !window.editor.selectSingleElement
      ))
    }
    const transients = await transientCounts(activePage)
    assert(
      transients.overlays === baseline.overlays,
      `Overlay helper count changed from ${baseline.overlays} to ${transients.overlays}.`,
    )
    assert(
      transients.snap === baseline.snap,
      `Snap helper count changed from ${baseline.snap} to ${transients.snap}.`,
    )
    assert(
      transients.handlers === baseline.handlers,
      `Handler count changed from ${baseline.handlers} to ${transients.handlers}.`,
    )
    assert(transients.previews === 0, `Expected no command previews, found ${transients.previews}.`)
  })

  await step('copy and paste sanitized SVG geometry', async () => {
    await selectDimensionedRectangle(activePage)
    const before = await drawingElementCount(activePage)
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyC')
    await activePage.keyboard.up(controlKey())
    await activePage.waitForFunction(() => window.__nanquimBrowserClipboard?.length > 0)
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyV')
    await activePage.keyboard.up(controlKey())
    await activePage.waitForFunction(expected => (
      document.querySelectorAll('#Collection > [data-collection] > *').length > expected
    ), {}, before)
    const unsafe = await activePage.evaluate(() => (
      document.querySelector('#Collection script, #Collection foreignObject, #Collection [onload], #Collection [onclick]')
    ))
    assert(!unsafe, 'Sanitized paste introduced an unsafe SVG node or event attribute.')
  })

  await step('save with the portable fallback and reopen the exact SVG', async () => {
    const result = await activePage.evaluate(async () => {
      const snapshotGeometry = () => Array.from(
        document.querySelectorAll('#Collection > [data-collection="true"]'),
      ).map(collection => ({
        id: collection.id,
        name: collection.getAttribute('name'),
        children: Array.from(collection.querySelectorAll('*')).map(node => ({
          tag: node.localName,
          id: node.id,
          parent: node.parentElement?.id || null,
          geometry: [
            'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height',
            'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform',
            'data-arc-data', 'data-circle-trim-data', 'data-ellipse-arc-data',
            'data-spline-data', 'data-hatch-data',
          ].reduce((attributes, name) => {
            if (node.hasAttribute(name)) attributes[name] = node.getAttribute(name)
            return attributes
          }, {}),
        })),
      }))

      const before = snapshotGeometry()
      const saved = await window.editor.documents.saveAs({ suggestedName: 'browser-roundtrip.svg' })
      const download = window.__nanquimBrowserDownloads.at(-1)
      if (!download) return { saved, reopened: null }
      const source = await download.blob.text()
      const file = new File([source], download.name, { type: 'image/svg+xml' })
      const reopened = await window.editor.documents.openFile(file)
      const after = snapshotGeometry()
      const resaved = await window.editor.documents.saveAs({ suggestedName: 'browser-roundtrip-2.svg' })
      const secondDownload = window.__nanquimBrowserDownloads.at(-1)
      const secondSource = secondDownload ? await secondDownload.blob.text() : null
      const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
      let mismatchIndex = -1
      if (typeof secondSource === 'string') {
        const comparisonLength = Math.max(source.length, secondSource.length)
        for (let index = 0; index < comparisonLength; index += 1) {
          if (source[index] !== secondSource[index]) {
            mismatchIndex = index
            break
          }
        }
      }
      return {
        after,
        before,
        clean: window.editor.documentState?.isDirty === false,
        fileHandleIsNull: window.editor.documentState?.fileHandle == null,
        history: {
          redos: window.editor.history?.redos?.length,
          undos: window.editor.history?.undos?.length,
        },
        saved,
        reopened,
        resaved,
        firstDifference: mismatchIndex < 0 ? null : {
          index: mismatchIndex,
          first: source.slice(Math.max(0, mismatchIndex - 80), mismatchIndex + 160),
          second: secondSource.slice(Math.max(0, mismatchIndex - 80), mismatchIndex + 160),
        },
        roundtripByteStable: source === secondSource,
        secondSourceLength: secondSource?.length ?? null,
        sourceLength: source.length,
        schema: parsed.documentElement.getAttribute('data-nanquim-version'),
      }
    })
    trace('native-roundtrip', result)
    assert(result.saved?.ok && result.saved?.unverified, 'Portable Save As did not report an unverified download.')
    assert(result.reopened?.ok, 'The saved native SVG could not be reopened.')
    assert(result.resaved?.ok && result.resaved?.unverified, 'The reopened SVG could not be serialized again.')
    assert(result.sourceLength > 100, 'The saved SVG was unexpectedly empty.')
    assert(result.schema === '3', `Expected native schema 3, received ${result.schema}.`)
    assert(JSON.stringify(result.after) === JSON.stringify(result.before), 'Geometry or collection ownership changed after reopen.')
    assert(result.roundtripByteStable, 'The canonical SVG changed after save, reopen, and save again.')
    assert(result.history.undos === 0 && result.history.redos === 0, 'Reopen retained History from the prior session.')
    assert(result.clean, 'A current-schema native reopen did not produce a clean session.')
    assert(result.fileHandleIsNull, 'Portable reopen retained or adopted a stale writable handle.')

    const [profileSource, unsupportedSource, dxfSource] = await Promise.all([
      readFile(SVG_PROFILE_FIXTURE_PATH, 'utf8'),
      readFile(SVG_UNSUPPORTED_FIXTURE_PATH, 'utf8'),
      readFile(DXF_FIXTURE_PATH, 'utf8'),
    ])
    const exchange = await activePage.evaluate(async ({ dxf, profile, unsupported }) => {
      const terminalText = () => document.getElementById('terminalLog')?.textContent || ''
      const localReferenceReport = (roots, resolutionRoot) => {
        const references = new Set()
        roots.forEach((root) => {
          if (!root) return
          ;[root, ...root.querySelectorAll('*')].forEach((element) => {
            Array.from(element.attributes || []).forEach((attribute) => {
              const value = attribute.value.trim()
              if (attribute.localName.toLowerCase() === 'href' && value.startsWith('#')) {
                references.add(value.slice(1))
              }
              for (const match of value.matchAll(/url\(\s*["']?#([^"')\s]+)["']?\s*\)/g)) {
                references.add(match[1])
              }
            })
            if (element.localName?.toLowerCase() === 'style') {
              for (const match of (element.textContent || '').matchAll(/url\(\s*["']?#([^"')\s]+)["']?\s*\)/g)) {
                references.add(match[1])
              }
            }
          })
        })
        const ids = new Set(Array.from(resolutionRoot.querySelectorAll('[id]'), element => element.id))
        return {
          count: references.size,
          missing: Array.from(references).filter(id => !ids.has(id)),
        }
      }
      const openFixture = (source, name, type) => window.editor.documents.openFile(
        new File([source], name, { type }),
      )

      const profileLoaded = await openFixture(
        profile,
        'interoperability-profile.svg',
        'image/svg+xml',
      )
      const profileRoot = window.editor.drawing.node.querySelector('[data-nanquim-import-root="true"]')
      const profileAssets = Array.from(
        window.editor.svg.node.querySelectorAll('defs > [data-nanquim-import-assets="true"]'),
      )
      const profileReferences = localReferenceReport(
        [profileRoot, ...profileAssets],
        window.editor.svg.node,
      )
      const profileResult = {
        loaded: profileLoaded,
        dirty: window.editor.documentState?.isDirty,
        hasImportRoot: Boolean(profileRoot),
        counts: Object.fromEntries([
          'circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'rect', 'text', 'use',
        ].map(name => [
          name,
          [profileRoot, ...profileAssets].reduce(
            (count, root) => count + (root?.querySelectorAll(name).length || 0),
            0,
          ),
        ])),
        references: profileReferences,
        text: profileRoot?.querySelector('text')?.textContent || '',
        viewBox: window.editor.svg.viewbox(),
      }

      const svgTerminalStart = terminalText().length
      const unsupportedLoaded = await openFixture(
        unsupported,
        'interoperability-unsupported.svg',
        'image/svg+xml',
      )
      const unsupportedRoot = window.editor.drawing.node.querySelector('[data-nanquim-import-root="true"]')
      const unsupportedAssets = Array.from(
        window.editor.svg.node.querySelectorAll('defs > [data-nanquim-import-assets="true"]'),
      )
      const unsupportedScope = [unsupportedRoot, ...unsupportedAssets].filter(Boolean)
      const safeRect = Array.from(unsupportedRoot?.querySelectorAll('rect') || []).find(rect => (
        Number(rect.getAttribute('x')) === 2
        && Number(rect.getAttribute('y')) === 2
        && Number(rect.getAttribute('width')) === 20
        && Number(rect.getAttribute('height')) === 12
      ))
      const unsupportedResult = {
        loaded: unsupportedLoaded,
        dirty: window.editor.documentState?.isDirty,
        safeFallback: Boolean(safeRect),
        terminalSummary: terminalText().slice(svgTerminalStart),
        unsafeNodes: unsupportedScope.reduce((count, root) => count + root.querySelectorAll(
          'script, foreignObject, [onload], [onclick], [onerror]',
        ).length, 0),
        externalReferences: unsupportedScope.reduce((count, root) => count + Array.from(
          root.querySelectorAll('[href], [xlink\\:href]'),
        ).filter(element => /^(?:https?:|data:text\/html)/i.test(
          element.getAttribute('href') || element.getAttribute('xlink:href') || '',
        )).length, 0),
      }

      const dxfTerminalStart = terminalText().length
      const beforeDxfDownloads = window.__nanquimBrowserDownloads.length
      const dxfLoaded = await openFixture(
        dxf,
        'dxf-layers-units-r2000.dxf',
        'image/vnd.dxf',
      )
      const directCollections = Array.from(window.editor.drawing.node.children)
      const collectionStates = directCollections.map(collection => {
        const state = Array.from(window.editor.collections.values()).find(
          candidate => candidate.group?.node === collection,
        )
        return {
          name: collection.getAttribute('name'),
          visible: state?.visible,
          locked: state?.locked,
        }
      })
      const firstLine = directCollections[0]?.querySelector('line')
      const hiddenCircle = directCollections[1]?.querySelector('circle')
      const lockedLine = directCollections[2]?.querySelector('line')

      window.saveDXF()
      const dxfDownload = window.__nanquimBrowserDownloads.at(-1)
      const exportedSource = dxfDownload ? await dxfDownload.blob.text() : ''
      const lines = exportedSource.replace(/\r/g, '').split('\n')
      const pairs = []
      for (let index = 0; index + 1 < lines.length; index += 2) {
        pairs.push({ code: lines[index].trim(), value: lines[index + 1].trim() })
      }
      const exportedLayers = []
      for (let index = 0; index < pairs.length; index += 1) {
        if (pairs[index].code !== '0' || pairs[index].value !== 'LAYER') continue
        const layer = { name: '', flags: 0, color: 0 }
        for (let cursor = index + 1; cursor < pairs.length && pairs[cursor].code !== '0'; cursor += 1) {
          if (pairs[cursor].code === '2') layer.name = pairs[cursor].value
          if (pairs[cursor].code === '70') layer.flags = Number(pairs[cursor].value)
          if (pairs[cursor].code === '62') layer.color = Number(pairs[cursor].value)
        }
        exportedLayers.push(layer)
      }
      const insUnitsIndex = pairs.findIndex(pair => pair.code === '9' && pair.value === '$INSUNITS')
      const exportedEntities = []
      let inEntities = false
      for (let index = 0; index < pairs.length; index += 1) {
        const pair = pairs[index]
        if (
          pair.code === '0'
          && pair.value === 'SECTION'
          && pairs[index + 1]?.code === '2'
          && pairs[index + 1]?.value === 'ENTITIES'
        ) {
          inEntities = true
          continue
        }
        if (inEntities && pair.code === '0' && pair.value === 'ENDSEC') {
          inEntities = false
          continue
        }
        if (inEntities && pair.code === '0') exportedEntities.push(pair.value)
      }
      const dxfResult = {
        loaded: dxfLoaded,
        dirty: window.editor.documentState?.isDirty,
        fileHandleIsNull: window.editor.documentState?.fileHandle == null,
        directCollections: directCollections.every(
          collection => collection.getAttribute('data-collection') === 'true',
        ),
        hasForeignWrapper: Boolean(
          window.editor.drawing.node.querySelector('[data-nanquim-import-root="true"]'),
        ),
        collectionStates,
        viewBox: window.editor.svg.viewbox(),
        geometry: {
          firstLine: firstLine ? [
            firstLine.getAttribute('x1'), firstLine.getAttribute('y1'),
            firstLine.getAttribute('x2'), firstLine.getAttribute('y2'),
          ].map(Number) : null,
          hiddenCircle: hiddenCircle ? [
            hiddenCircle.getAttribute('cx'), hiddenCircle.getAttribute('cy'), hiddenCircle.getAttribute('r'),
          ].map(Number) : null,
          lockedLine: lockedLine ? [
            lockedLine.getAttribute('x1'), lockedLine.getAttribute('y1'),
            lockedLine.getAttribute('x2'), lockedLine.getAttribute('y2'),
          ].map(Number) : null,
        },
        download: {
          downloaded: window.__nanquimBrowserDownloads.length === beforeDxfDownloads + 1,
          name: dxfDownload?.name,
          type: dxfDownload?.blob?.type,
          size: dxfDownload?.blob?.size || 0,
        },
        exported: {
          entities: exportedEntities,
          insUnits: insUnitsIndex >= 0
            ? Number(pairs.slice(insUnitsIndex + 1).find(pair => pair.code === '70')?.value)
            : null,
          layers: exportedLayers,
        },
        terminalSummary: terminalText().slice(dxfTerminalStart),
      }

      return { profile: profileResult, unsupported: unsupportedResult, dxf: dxfResult }
    }, { dxf: dxfSource, profile: profileSource, unsupported: unsupportedSource })
    trace('exchange-qualification', exchange)

    assert(exchange.profile.loaded?.ok && exchange.profile.loaded?.kind === 'foreign-svg', 'The supported foreign SVG profile did not load.')
    assert(exchange.profile.dirty && exchange.profile.hasImportRoot, 'The foreign SVG was not adopted as a dirty imported collection.')
    assert(exchange.profile.counts.path >= 6 && exchange.profile.counts.use === 2, 'The foreign SVG lost supported vector elements.')
    assert(exchange.profile.references.count >= 5 && exchange.profile.references.missing.length === 0, 'The foreign SVG contains unresolved local references after import.')
    assert(exchange.profile.text === 'Room & curve <profile>', 'The foreign SVG text changed during import.')
    assertNear(exchange.profile.viewBox.x, 0, 1e-9, 'foreign SVG viewBox x')
    assertNear(exchange.profile.viewBox.y, 0, 1e-9, 'foreign SVG viewBox y')
    assertNear(exchange.profile.viewBox.width, 210, 1e-9, 'foreign SVG viewBox width')
    assertNear(exchange.profile.viewBox.height, 148, 1e-9, 'foreign SVG viewBox height')

    assert(exchange.unsupported.loaded?.ok && exchange.unsupported.loaded?.kind === 'foreign-svg', 'The sanitization SVG profile did not load.')
    assert(exchange.unsupported.loaded.diagnostics?.some(({ code }) => code === 'sanitized-content'), 'Foreign SVG sanitization did not return a diagnostic code.')
    assert(exchange.unsupported.safeFallback, 'Foreign SVG sanitization discarded the safe fallback geometry.')
    assert(exchange.unsupported.unsafeNodes === 0 && exchange.unsupported.externalReferences === 0, 'Foreign SVG sanitization retained active or external content.')
    assert(exchange.unsupported.terminalSummary.includes('Unsafe or unsupported SVG content was removed'), 'The foreign SVG sanitization summary was not shown in the terminal.')
    assert(exchange.unsupported.terminalSummary.includes('Opened: interoperability-unsupported.svg'), 'The sanitized foreign SVG did not report a completed open.')

    assert(exchange.dxf.loaded?.ok && exchange.dxf.loaded?.kind === 'dxf', 'The DXF qualification fixture did not load.')
    assert(exchange.dxf.loaded.diagnostics?.some(({ code }) => code === 'dxf-units-converted'), 'DXF unit conversion did not return a diagnostic code.')
    assert(exchange.dxf.dirty && exchange.dxf.fileHandleIsNull, 'DXF import incorrectly adopted a clean writable session.')
    assert(exchange.dxf.directCollections && !exchange.dxf.hasForeignWrapper, 'DXF layers were not imported as direct Model collections.')
    assert(JSON.stringify(exchange.dxf.collectionStates) === JSON.stringify([
      { name: 'A&B', visible: true, locked: false },
      { name: 'Hidden', visible: false, locked: false },
      { name: 'Locked', visible: true, locked: true },
    ]), 'DXF layer names, visibility, or lock state changed during import.')
    assert(JSON.stringify(exchange.dxf.geometry.firstLine) === JSON.stringify([1, -1, 9, -1]), 'DXF millimetre line coordinates were not converted to centimetres.')
    assert(exchange.dxf.geometry.hiddenCircle?.length === 3, 'DXF circle geometry was not imported.')
    ;[5, -4, 1.2].forEach((expected, index) => {
      assertNear(exchange.dxf.geometry.hiddenCircle[index], expected, 1e-9, `DXF circle coordinate ${index + 1}`)
    })
    assert(JSON.stringify(exchange.dxf.geometry.lockedLine) === JSON.stringify([0, 0, 0, -8]), 'DXF locked-layer geometry changed during import.')
    assertNear(exchange.dxf.viewBox.x, 0, 1e-9, 'DXF viewBox x')
    assertNear(exchange.dxf.viewBox.y, -8, 1e-9, 'DXF viewBox y')
    assertNear(exchange.dxf.viewBox.width, 9, 1e-9, 'DXF viewBox width')
    assertNear(exchange.dxf.viewBox.height, 8, 1e-9, 'DXF viewBox height')
    assert(exchange.dxf.download.downloaded && exchange.dxf.download.size > 100, 'DXF re-export did not produce a nonempty fallback download.')
    assert(exchange.dxf.download.name === 'drawing.dxf' && exchange.dxf.download.type === 'application/dxf', 'DXF re-export used the wrong filename or MIME type.')
    assert(exchange.dxf.exported.insUnits === 5, `Expected centimetre DXF units, received ${exchange.dxf.exported.insUnits}.`)
    assert(JSON.stringify(exchange.dxf.exported.entities.sort()) === JSON.stringify(['CIRCLE', 'LINE', 'LINE']), 'DXF re-export lost or duplicated vector entities.')
    const exportedLayerStates = exchange.dxf.exported.layers
      .filter(layer => ['A&B', 'Hidden', 'Locked'].includes(layer.name))
      .map(layer => ({ name: layer.name, hidden: layer.color < 0, locked: (layer.flags & 4) !== 0 }))
    assert(JSON.stringify(exportedLayerStates) === JSON.stringify([
      { name: 'A&B', hidden: false, locked: false },
      { name: 'Hidden', hidden: true, locked: false },
      { name: 'Locked', hidden: false, locked: true },
    ]), 'DXF re-export did not preserve layer hidden/locked state.')
    assert(exchange.dxf.terminalSummary.includes('DXF coordinates were converted to Nanquim centimeters.'), 'DXF import did not show its unit-conversion summary.')
    assert(exchange.dxf.terminalSummary.includes('DXF exported: drawing.dxf') && exchange.dxf.terminalSummary.includes('3 entities'), 'DXF export did not show its entity summary.')
  })

  await step('open and evaluate the representative Geometry Nodes fixture', async () => {
    const fixture = await readFile(FIXTURE_PATH, 'utf8')
    const result = await activePage.evaluate(async source => {
      const file = new File([source], 'native-v3.svg', { type: 'image/svg+xml' })
      const loaded = await window.editor.documents.openFile(file)
      const instances = Array.from(window.editor.geometryNodes.instances.values()).map(instance => ({
        id: instance.id,
        status: instance.status,
        outputChildren: instance.output?.node?.childElementCount || 0,
      }))
      return {
        loaded,
        instances,
        graphCount: window.editor.geometryNodes.graphs.size,
      }
    }, fixture)
    assert(result.loaded?.ok, 'The representative native-v3 fixture did not load.')
    assert(result.graphCount === 1, `Expected one Geometry Nodes graph, found ${result.graphCount}.`)
    assert(
      result.instances.some(instance => instance.id === 'modifier-valid-v3' && instance.status === 'ready' && instance.outputChildren > 0),
      'The valid Geometry Nodes fixture instance did not evaluate to visible output.',
    )
  })

  await step('create and export a Paper viewport', async () => {
    await activePage.evaluate(() => window.switchEditorMode('paper'))
    await activePage.waitForFunction(() => window.editor.mode === 'paper' && window.editor.paperSvg?.node?.isConnected)
    const annotationsStartedLocked = await activePage.evaluate(() => {
      const state = window.editor.collections?.get('paper-annotations')
      return state?.locked === true && state.group?.attr('data-locked') === 'true'
    })
    assert(annotationsStartedLocked, 'The representative fixture did not preserve its locked Paper annotations state.')
    const annotationsLockControl = await activePage.waitForSelector(
      '[data-paper-annotations-action="lock"][aria-label="Unlock annotations"]',
    )
    await annotationsLockControl.click()
    await annotationsLockControl.dispose()
    await activePage.waitForFunction(() => {
      const state = window.editor.collections?.get('paper-annotations')
      return state?.locked === false && state.group?.attr('data-locked') === 'false'
    })

    const before = await activePage.evaluate(() => window.editor.paperViewports.length)
    await runTerminalCommand(activePage, 'vp')
    await typeTerminalValue(activePage, '#1,1')
    await typeTerminalValue(activePage, '#8,6')
    await typeTerminalValue(activePage, '50')
    await activePage.waitForFunction(expected => window.editor.paperViewports.length === expected + 1, {}, before)

    await runTerminalCommand(activePage, 'l')
    await typeTerminalValue(activePage, '#2,2')
    await typeTerminalValue(activePage, '#6,2')
    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => (
      !window.editor.isDrawing
      && Array.from(document.querySelectorAll('#paper-annotations line')).some(line => (
        line.getAttribute('data-nanquim-transient') !== 'true'
        && Number(line.getAttribute('x1')) === 2
        && Number(line.getAttribute('x2')) === 6
      ))
    ))

    const annotationPoint = await activePage.evaluate(() => {
      const line = Array.from(document.querySelectorAll('#paper-annotations line'))
        .find(candidate => Number(candidate.getAttribute('x1')) === 2)
      const ctm = line?.getScreenCTM()
      if (!line || !ctm) return null
      const midpoint = new DOMPoint(
        (Number(line.getAttribute('x1')) + Number(line.getAttribute('x2'))) / 2,
        (Number(line.getAttribute('y1')) + Number(line.getAttribute('y2'))) / 2,
      ).matrixTransform(ctm)
      return { x: midpoint.x, y: midpoint.y }
    })
    assert(annotationPoint, 'Could not locate the Paper annotation for pointer selection.')
    await activePage.mouse.move(annotationPoint.x, annotationPoint.y)
    await activePage.waitForFunction(() => window.editor.hoveredElements?.some(
      element => element?.node?.parentElement?.id === 'paper-annotations',
    ))
    await activePage.mouse.click(annotationPoint.x, annotationPoint.y)
    await activePage.waitForFunction(() => (
      window.editor.selected?.some(
        element => element?.node?.parentElement?.id === 'paper-annotations',
      )
      || document.querySelector('.disambiguation-menu')
    ))
    const needsDisambiguation = await activePage.evaluate(() => !window.editor.selected?.some(
      element => element?.node?.parentElement?.id === 'paper-annotations',
    ))
    if (needsDisambiguation) {
      const items = await activePage.$$('.disambiguation-menu-item')
      let annotationItem = null
      for (const item of items) {
        const isAnnotation = await item.evaluate(element => (
          Boolean(element.querySelector('.icon-element-line'))
        ))
        if (isAnnotation && !annotationItem) annotationItem = item
        else await item.dispose()
      }
      assert(annotationItem, 'Paper pointer selection did not offer the annotation in its disambiguation menu.')
      await annotationItem.click()
      await annotationItem.dispose()
    }
    await activePage.waitForFunction(() => window.editor.selected?.some(
      element => element?.node?.parentElement?.id === 'paper-annotations',
    ))

    await runTerminalCommand(activePage, 'm')
    await typeTerminalValue(activePage, '#0,0')
    await typeTerminalValue(activePage, '@1,1')
    await activePage.waitForFunction(() => Array.from(
      document.querySelectorAll('#paper-annotations line'),
    ).some(line => Number(line.getAttribute('x1')) === 3 && Number(line.getAttribute('y1')) === 3))
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    await activePage.waitForFunction(() => Array.from(
      document.querySelectorAll('#paper-annotations line'),
    ).some(line => Number(line.getAttribute('x1')) === 2 && Number(line.getAttribute('y1')) === 2))
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    await activePage.waitForFunction(() => Array.from(
      document.querySelectorAll('#paper-annotations line'),
    ).some(line => Number(line.getAttribute('x1')) === 3 && Number(line.getAttribute('y1')) === 3))

    const exportResult = await activePage.evaluate(async () => {
      const paperNote = document.getElementById('paper-note-v3')
      if (paperNote) {
        paperNote.setAttribute('font-family', 'Inter')
        paperNote.setAttribute('font-size', '0.42')
        paperNote.setAttribute('font-weight', '700')
        paperNote.setAttribute('font-style', 'normal')
      }
      const liveBefore = {
        drawing: window.editor.drawing.node.outerHTML,
        paper: window.editor.paperSvg.node.outerHTML,
      }
      const beforeDownloads = window.__nanquimBrowserDownloads.length
      window.editor.paperEditor.exportSVG()
      const download = window.__nanquimBrowserDownloads.at(-1)
      const source = download ? await download.blob.text() : ''
      const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
      const root = parsed.documentElement
      const ids = Array.from(root.querySelectorAll('[id]'), element => element.id)
      const idSet = new Set(ids)
      const localReferences = new Set()
      ;[root, ...root.querySelectorAll('*')].forEach((element) => {
        Array.from(element.attributes || []).forEach((attribute) => {
          const value = attribute.value.trim()
          if (attribute.localName.toLowerCase() === 'href' && value.startsWith('#')) {
            localReferences.add(value.slice(1))
          }
          for (const match of value.matchAll(/url\(\s*["']?#([^"')\s]+)["']?\s*\)/g)) {
            localReferences.add(match[1])
          }
        })
        if (element.localName?.toLowerCase() === 'style') {
          for (const match of (element.textContent || '').matchAll(/url\(\s*["']?#([^"')\s]+)["']?\s*\)/g)) {
            localReferences.add(match[1])
          }
        }
      })
      const liveAfter = {
        drawing: window.editor.drawing.node.outerHTML,
        paper: window.editor.paperSvg.node.outerHTML,
      }
      return {
        annotationLines: parsed.querySelectorAll('#paper-annotations line').length,
        annotationStrokeWidth: Number.parseFloat(
          parsed.querySelector('#paper-annotations')?.style.strokeWidth || '',
        ),
        count: window.editor.paperViewports.length,
        config: {
          width: window.editor.paperConfig.width,
          height: window.editor.paperConfig.height,
          unitsPerCm: window.editor.paperConfig.unitsPerCm,
        },
        downloaded: window.__nanquimBrowserDownloads.length === beforeDownloads + 1,
        duplicateIds: ids.length - idSet.size,
        height: root.getAttribute('height'),
        isPaperDocument: root.getAttribute('data-nanquim-paper') === 'true',
        liveUnchanged: liveBefore.drawing === liveAfter.drawing && liveBefore.paper === liveAfter.paper,
        missingReferences: Array.from(localReferences).filter(id => !idSet.has(id)),
        modelStrokeWidth: Number.parseFloat(
          parsed.querySelector('#Collection > [data-collection="true"]')?.style.strokeWidth || '',
        ),
        name: download?.name,
        parserError: Boolean(parsed.querySelector('parsererror')),
        rasterImages: root.querySelectorAll('image').length,
        transientNodes: root.querySelectorAll([
          '#paper-background',
          '#paper-handlers',
          '.vp-frame',
          '.vp-label',
          '.selection-handler',
          '.elementHover',
          '.elementSelected',
          '.move-ghost',
          '.command-preview',
          '[data-nanquim-transient]',
          '[selected]',
        ].join(',')).length,
        type: download?.blob?.type,
        vectorElements: root.querySelectorAll('path, line, rect, circle, ellipse, polyline, polygon, use').length,
        viewBox: (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number),
        viewportUses: parsed.querySelectorAll('[data-paper-viewport="true"] use').length,
        width: root.getAttribute('width'),
      }
    })
    trace('paper-svg-qualification', exportResult)
    assert(exportResult.count === before + 1, 'Paper viewport count did not increase.')
    assert(exportResult.downloaded, 'Paper SVG export did not trigger a download.')
    assert(exportResult.name === 'paper-custom.svg' && exportResult.type === 'image/svg+xml', 'Paper SVG export used the wrong filename or MIME type.')
    assert(!exportResult.parserError && exportResult.isPaperDocument, 'Paper export was not a well-formed Paper SVG.')
    assert(exportResult.viewportUses > 0, 'Paper export omitted its model viewport reference.')
    assert(exportResult.annotationLines > 0, 'Paper export omitted the edited Paper annotation.')
    assert(exportResult.width === '500.5mm' && exportResult.height === '321.25mm', 'Paper SVG export lost its physical millimetre page size.')
    const expectedViewBox = [
      0,
      0,
      exportResult.config.width * exportResult.config.unitsPerCm / 10,
      exportResult.config.height * exportResult.config.unitsPerCm / 10,
    ]
    assert(exportResult.viewBox.length === 4, 'Paper SVG export emitted an invalid viewBox.')
    expectedViewBox.forEach((expected, index) => {
      assertNear(exportResult.viewBox[index], expected, 1e-9, `Paper SVG viewBox value ${index + 1}`)
    })
    assert(exportResult.vectorElements > 0 && exportResult.rasterImages === 0, 'Paper SVG export did not remain vector-only.')
    assert(exportResult.transientNodes === 0, `Paper SVG export retained ${exportResult.transientNodes} transient UI node(s).`)
    assert(exportResult.duplicateIds === 0 && exportResult.missingReferences.length === 0, 'Paper SVG export contains duplicate IDs or broken internal references.')
    assertNear(exportResult.annotationStrokeWidth, 0.18, 1e-9, 'Paper annotation stroke width')
    assertNear(exportResult.modelStrokeWidth, 0.2, 1e-9, 'Paper model stroke width')
    assert(exportResult.liveUnchanged, 'Paper SVG export mutated the live Model or Paper DOM.')

    const pdfFixture = await activePage.evaluate(() => {
      window.editor.signals.clearSelection.dispatch()
      const [retainedViewport, ...extraViewports] = window.editor.paperViewports
      extraViewports.forEach(viewport => window.editor.paperEditor.removeViewport(viewport.id, {
        notify: false,
        silent: true,
      }))
      retainedViewport.setVisible(true, { silent: true })
      retainedViewport.setModelOrigin(0, 0, { silent: true })
      retainedViewport.setScale(1, { silent: true })

      const svgNamespace = 'http://www.w3.org/2000/svg'
      const create = (name, attributes = {}) => {
        const element = document.createElementNS(svgNamespace, name)
        Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)))
        return element
      }
      window.editor.documentState.runWithoutTracking(() => {
        const collection = create('g', {
          id: 'browser-pdf-model',
          name: 'Browser PDF vectors',
          'data-collection': 'true',
          style: 'stroke:#112233;stroke-width:0.2;stroke-linecap:round;fill:transparent',
        })
        collection.appendChild(create('line', {
          id: 'browser-pdf-line',
          x1: 0.5,
          y1: 1,
          x2: 3.5,
          y2: 1,
        }))
        const dimension = create('g', {
          id: 'browser-pdf-dimension',
          'data-element-type': 'dimension',
        })
        dimension.appendChild(create('line', {
          id: 'browser-pdf-dimension-line',
          x1: 0.5,
          y1: 2,
          x2: 3.5,
          y2: 2,
        }))
        const modelText = create('text', {
          id: 'browser-pdf-dimension-text',
          x: 2,
          y: 1.8,
          'font-family': 'Inter',
          'font-size': 0.42,
          'font-weight': 700,
          'text-anchor': 'middle',
        })
        modelText.textContent = '3 cm'
        dimension.appendChild(modelText)
        collection.appendChild(dimension)
        window.editor.drawing.node.replaceChildren(collection)

        const annotations = window.editor.paperAnnotations.node
        const annotationLine = create('line', {
          id: 'browser-pdf-annotation-line',
          x1: 2,
          y1: 12,
          x2: 8,
          y2: 12,
        })
        const annotationText = create('text', {
          id: 'browser-pdf-annotation-text',
          x: 5,
          y: 11.5,
          'font-family': 'Inter',
          'font-size': 0.42,
          'font-weight': 700,
          'text-anchor': 'middle',
        })
        annotationText.textContent = 'Phase 3 PDF'
        annotations.replaceChildren(annotationLine, annotationText)
      })
      window.editor.signals.modelContentChanged.dispatch()
      return {
        annotations: window.editor.paperAnnotations.node.childElementCount,
        modelElements: window.editor.drawing.node.querySelectorAll('line, text').length,
        viewports: window.editor.paperViewports.length,
      }
    })
    trace('paper-pdf-controlled-fixture', pdfFixture)
    assert(
      pdfFixture.viewports === 1 && pdfFixture.modelElements === 3 && pdfFixture.annotations === 2,
      'The bounded Paper PDF qualification fixture was not prepared correctly.',
    )

    const pdfDownloadStart = await activePage.evaluate(() => window.__nanquimBrowserDownloads.length)
    await activePage.evaluate(() => window.editor.paperEditor.exportPDF())
    try {
      await activePage.waitForFunction(expected => (
        window.__nanquimBrowserDownloads.length > expected
      ), { timeout: 60000 }, pdfDownloadStart)
    } catch (error) {
      const diagnostic = await activePage.evaluate(() => ({
        downloads: window.__nanquimBrowserDownloads.length,
        terminal: (document.getElementById('terminalLog')?.textContent || '').slice(-512),
      }))
      trace('paper-pdf-timeout-diagnostic', diagnostic)
      throw new Error('Paper PDF did not produce an intercepted fallback download within 60 seconds.', {
        cause: error,
      })
    }
    const pdfResult = await activePage.evaluate(async (beforeDownloads) => {
      const terminalText = document.getElementById('terminalLog')?.textContent || ''
      const download = window.__nanquimBrowserDownloads.at(-1)
      const bytes = new Uint8Array(await download.blob.arrayBuffer())
      let source = ''
      const chunkSize = 8192
      for (let index = 0; index < bytes.length; index += chunkSize) {
        source += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
      }
      const mediaBox = source.match(/\/MediaBox\s*\[([^\]]+)\]/)?.[1]
        ?.trim().split(/\s+/).map(Number) || []
      const streams = Array.from(source.matchAll(/stream\r?\n([\s\S]*?)endstream/g), match => match[1])
      const vectorOperators = streams.reduce((count, stream) => count + (
        stream.match(/(?:^|\r?\n)-?(?:\d+(?:\.\d*)?|\.\d+)\s+-?(?:\d+(?:\.\d*)?|\.\d+)\s+m(?:\r?\n|\s)/g)?.length || 0
      ), 0)
      const fontLengths = Array.from(
        source.matchAll(/\/Length1\s+(\d+)/g),
        match => Number(match[1]),
      )
      return {
        downloaded: window.__nanquimBrowserDownloads.length === beforeDownloads + 1,
        embeddedFontLength: fontLengths.length > 0 ? Math.max(...fontLengths) : 0,
        hasEmbeddedFont: /\/FontFile2\s+\d+\s+0\s+R/.test(source),
        header: source.slice(0, 8),
        imageObjects: source.match(/\/Subtype\s*\/Image\b/g)?.length || 0,
        mediaBox,
        name: download?.name,
        pageObjects: source.match(/\/Type\s*\/Page\b/g)?.length || 0,
        size: bytes.length,
        terminalSummary: terminalText.slice(-512),
        type: download?.blob?.type,
        vectorOperators,
      }
    }, pdfDownloadStart)
    trace('paper-pdf-qualification', pdfResult)
    assert(pdfResult.downloaded && pdfResult.size > 1000, 'Paper PDF export did not produce a nonempty fallback download.')
    assert(pdfResult.name === 'paper-custom.pdf' && pdfResult.type === 'application/pdf', 'Paper PDF export used the wrong filename or MIME type.')
    assert(pdfResult.header.startsWith('%PDF-') && pdfResult.pageObjects >= 1, 'Paper PDF export did not produce a valid PDF page.')
    assert(pdfResult.mediaBox.length === 4, 'Paper PDF export did not expose a valid MediaBox.')
    const pointsPerMillimetre = 72 / 25.4
    const expectedMediaBox = [
      0,
      0,
      exportResult.config.width * pointsPerMillimetre,
      exportResult.config.height * pointsPerMillimetre,
    ]
    expectedMediaBox.forEach((expected, index) => {
      assertNear(pdfResult.mediaBox[index], expected, 0.02, `Paper PDF MediaBox value ${index + 1}`)
    })
    assert(pdfResult.vectorOperators > 0 && pdfResult.imageObjects === 0, 'Paper PDF export did not retain vector path content.')
    assert(pdfResult.hasEmbeddedFont && pdfResult.embeddedFontLength > 0, 'Paper PDF export did not embed a nonempty local TTF font.')
    assert(pdfResult.terminalSummary.includes('Paper exported as PDF: paper-custom.pdf'), 'Paper PDF export did not report its fallback download.')
    await activePage.evaluate(() => window.switchEditorMode('model'))
  })

  await step('search and keyboard-navigate Help', async () => {
    await activePage.keyboard.press('F1')
    await activePage.waitForSelector('#command-help-dialog[open]')
    await activePage.waitForFunction(() => document.activeElement?.id === 'command-help-search')
    await activePage.keyboard.type('two corners')
    await activePage.waitForFunction(() => (
      document.querySelectorAll('.command-help-card:not([hidden])').length === 1
      && document.getElementById('command-help-count')?.textContent?.startsWith('1 of ')
    ))
    await activePage.keyboard.press('Tab')
    const focused = await activePage.evaluate(() => ({
      tag: document.activeElement?.tagName,
      inside: Boolean(document.activeElement?.closest('#command-help-dialog')),
    }))
    assert(focused.inside && focused.tag === 'BUTTON', 'Help Tab navigation did not move to a dialog button.')
    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !document.getElementById('command-help-dialog')?.open)
  })

  await runCopySnapWorkflows(activePage)
  await runRectangleNearestSnapWorkflows(activePage)
  await runRectangleHatchWorkflows(activePage)
  await runSplineOrthoWorkflows(activePage)
  await runMirrorSnapWorkflows(activePage)
  await runArcAutoExtendWorkflows(activePage)
  await runArcOffsetWorkflows(activePage)
  await runPolylineOffsetWorkflows(activePage)
  await runFilletRepeatWorkflows(activePage)
  await runJoinWorkflows(activePage)
  await runDistanceMeasurementWorkflows(activePage)
  await runDimensionSecondPointPreviewWorkflows(activePage)
  await runSplineTrimBoundaryWorkflows(activePage)
  await runTrimBoundarySelectionWorkflows(activePage)
  await runImageImportWorkflows(activePage)
  await runImageCropWorkflows(activePage)
  await runOutlinerReorderWorkflows(activePage)
  await runOutlinerCollectionDropWorkflows(activePage)
  await runOutlinerMoveDialogWorkflows(activePage)
  await runOutlinerRangeSelectionWorkflows(activePage)
  await runWelcomeScreenWorkflows(activePage)
}

async function runRectangleHatchWorkflows(activePage) {
  await step('hatch a selected rounded rectangle with Undo/Redo', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"
        data-nanquim-version="3" data-element-index="942" data-active-collection-id="hatch-rectangles">
        <g id="hatch-rectangles" data-collection="true" name="Hatch rectangles"
          style="stroke:#ffffff;stroke-width:.3;fill:none">
          <rect id="941" name="Rounded rectangle" x="20" y="25" width="50" height="30" rx="6" ry="4"/>
        </g></svg>`
      const result = await window.editor.documents.openFile(
        new File([source], 'hatch-rectangles.svg', { type: 'image/svg+xml' }),
      )
      const editor = window.editor
      editor.lastHatchPattern = 'ANSI31'
      editor.lastHatchScale = 5
      editor.selected = [editor.drawing.findOne('[id="941"]')]
      editor.signals.updatedSelection.dispatch()
      return result
    })
    assert(loaded?.ok, 'Could not initialize the selected-rectangle HATCH fixture.')

    const readState = () => activePage.evaluate(() => {
      const editor = window.editor
      editor.documentState.flushObservedMutations()
      const source = editor.drawing.findOne('[id="941"]')
      const hatch = editor.drawing.findOne('.hatch-fill')
      return {
        fill: hatch?.attr('fill') || null,
        fillRule: hatch?.attr('fill-rule') || null,
        hatchData: hatch?.data('hatchData') || null,
        hatchId: hatch ? String(hatch.attr('id')) : null,
        hatchPath: hatch?.attr('d') || null,
        history: editor.history.undos.length,
        interacting: editor.isInteracting,
        revision: editor.documentState.revision,
        sourceConnected: Boolean(source?.node.isConnected),
      }
    })

    const before = await readState()
    await runTerminalCommand(activePage, 'h')
    await activePage.waitForFunction(() => (
      window.editor.history.undos.length === 1
      && Boolean(window.editor.drawing.findOne('.hatch-fill'))
      && !window.editor.isInteracting
    ))
    const hatched = await readState()
    const expectedPath = [
      'M 26 25',
      'H 64',
      'A 6 4 0 0 1 70 29',
      'V 51',
      'A 6 4 0 0 1 64 55',
      'H 26',
      'A 6 4 0 0 1 20 51',
      'V 29',
      'A 6 4 0 0 1 26 25',
      'Z',
    ].join(' ')
    assert(hatched.hatchPath === expectedPath,
      'HATCH did not preserve the selected rectangle rounded-corner geometry.')
    assert(/^url\(["']?#hatch-/.test(hatched.fill || '') && hatched.fillRule === 'nonzero',
      'HATCH did not apply the selected pattern and nonzero rectangle fill rule.')
    assert(hatched.hatchData?.patternType === 'ANSI31' && hatched.hatchData?.hatchScale === 5,
      'HATCH did not persist its selected rectangle pattern metadata.')
    assert(hatched.sourceConnected && hatched.history === before.history + 1
      && hatched.revision === before.revision + 1 && !hatched.interacting,
    'HATCH did not commit one mutation while retaining the source rectangle.')

    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    const undone = await readState()
    assert(!undone.hatchId && undone.sourceConnected,
      'Undo did not remove only the selected-rectangle hatch.')

    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    const redone = await readState()
    assert(redone.hatchId === hatched.hatchId && redone.hatchPath === expectedPath
      && redone.sourceConnected,
    'Redo did not restore the same selected-rectangle hatch.')
    trace('rectangle-hatch', { before, hatched, undone, redone })
  })

  await step('hatch an exact closed curve path with an even-odd hole', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 70"
        data-nanquim-version="3" data-element-index="944" data-active-collection-id="hatch-paths">
        <g id="hatch-paths" data-collection="true" name="Hatch paths"
          style="stroke:#ffffff;stroke-width:.3;fill:none">
          <path id="943" name="Closed curve" fill-rule="evenodd"
            d="M 15 35 C 15 12 65 12 70 35 A 28 18 0 0 1 15 35 Z M 35 31 A 7 5 0 1 0 49 31 A 7 5 0 1 0 35 31 Z"/>
        </g></svg>`
      const result = await window.editor.documents.openFile(
        new File([source], 'hatch-paths.svg', { type: 'image/svg+xml' }),
      )
      const editor = window.editor
      editor.lastHatchPattern = null
      editor.lastHatchScale = null
      editor.selected = [editor.drawing.findOne('[id="943"]')]
      editor.signals.updatedSelection.dispatch()
      return result
    })
    assert(loaded?.ok, 'Could not initialize the selected closed-path HATCH fixture.')

    const readState = () => activePage.evaluate(() => {
      const editor = window.editor
      editor.documentState.flushObservedMutations()
      const source = editor.drawing.findOne('[id="943"]')
      const hatch = editor.drawing.findOne('.hatch-fill')
      return {
        fill: hatch?.attr('fill') || null,
        fillRule: hatch?.attr('fill-rule') || null,
        hatchData: hatch?.data('hatchData') || null,
        hatchId: hatch ? String(hatch.attr('id')) : null,
        hatchPath: hatch?.array().map(segment => [...segment]) || null,
        history: editor.history.undos.length,
        revision: editor.documentState.revision,
        sourceConnected: Boolean(source?.node.isConnected),
        sourcePath: source?.array().map(segment => [...segment]) || null,
      }
    })

    const before = await readState()
    await runTerminalCommand(activePage, 'h')
    await activePage.waitForFunction(() => window.editor.history.undos.length === 1
      && window.editor.drawing.findOne('.hatch-fill')
      && !window.editor.isInteracting)
    const hatched = await readState()
    assert(JSON.stringify(hatched.hatchPath) === JSON.stringify(hatched.sourcePath),
      'HATCH flattened or changed the selected closed path commands.')
    assert(hatched.hatchPath.filter(segment => segment[0] === 'Z').length === 2
      && hatched.fillRule === 'evenodd',
    'HATCH did not retain both closed subpaths and their even-odd hole.')
    assert(/^url\(["']?#hatch-ansi31-/.test(hatched.fill || '')
      && hatched.hatchData?.patternType === 'ANSI31' && hatched.hatchData?.hatchScale === 10,
    'HATCH did not apply the visible first-use pattern to the selected closed path.')
    assert(hatched.sourceConnected && hatched.history === before.history + 1
      && hatched.revision === before.revision + 1,
    'Closed-path HATCH did not commit one mutation while retaining its source.')

    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    const undone = await readState()
    assert(!undone.hatchId && undone.sourceConnected,
      'Undo did not remove only the selected closed-path hatch.')

    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    const redone = await readState()
    assert(redone.hatchId === hatched.hatchId
      && JSON.stringify(redone.hatchPath) === JSON.stringify(hatched.hatchPath)
      && redone.sourceConnected,
    'Redo did not restore the same selected closed-path hatch.')
    trace('closed-path-hatch', { before, hatched, undone, redone })
  })

  await step('click inside a closed path to create a visible default hatch', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 70"
        data-nanquim-version="3" data-element-index="946" data-active-collection-id="hatch-click">
        <g id="hatch-click" data-collection="true" name="Click hatch"
          style="stroke:#d67d36;stroke-width:.3;fill:none">
          <path id="945" name="Boundary"
            d="M 20 10 H 80 A 10 10 0 0 1 90 20 V 50 Q 90 60 80 60 H 20 C 14 60 10 56 10 50 V 20 A 10 10 0 0 1 20 10 Z M 40 25 H 60 V 45 H 40 Z"/>
        </g></svg>`
      const result = await window.editor.documents.openFile(
        new File([source], 'hatch-click.svg', { type: 'image/svg+xml' }),
      )
      const editor = window.editor
      editor.lastHatchPattern = null
      editor.lastHatchScale = null
      editor.selected = []
      return result
    })
    assert(loaded?.ok, 'Could not initialize the click-inside HATCH fixture.')

    const inside = await activePage.evaluate(() => {
      const point = new DOMPoint(25, 35).matrixTransform(window.editor.svg.node.getScreenCTM())
      return { x: Math.round(point.x), y: Math.round(point.y) }
    })
    await runTerminalCommand(activePage, 'h')
    await activePage.waitForFunction(() => window.editor.isInteracting
      && window.editor.signals.pointCaptured.getNumListeners() > 0)
    await activePage.mouse.click(inside.x, inside.y)
    await activePage.waitForFunction(() => window.editor.history.undos.length === 1
      && window.editor.drawing.findOne('.hatch-fill')
      && !window.editor.isInteracting)

    const hatched = await activePage.evaluate(() => {
      const editor = window.editor
      editor.documentState.flushObservedMutations()
      const hatch = editor.drawing.findOne('.hatch-fill')
      const patternReference = hatch.attr('fill').match(/#([^\)"']+)/)?.[1] || null
      const pattern = patternReference ? editor.svg.defs().findOne(`[id="${patternReference}"]`) : null
      const line = pattern?.findOne('line')
      const hatchStyle = getComputedStyle(hatch.node)
      const lineStyle = line ? getComputedStyle(line.node) : null
      return {
        fill: hatch.attr('fill'),
        fillOpacity: Number(hatchStyle.fillOpacity),
        hatchData: hatch.data('hatchData'),
        history: editor.history.undos.length,
        pathSubpaths: hatch.array().filter(segment => segment[0] === 'M').length,
        lineStroke: lineStyle?.stroke || null,
        patternConnected: Boolean(pattern?.node.isConnected),
        revision: editor.documentState.revision,
        sourceConnected: Boolean(editor.drawing.findOne('[id="945"]')?.node.isConnected),
      }
    })
    assert(/^url\(["']?#hatch-ansi31-/.test(hatched.fill || '')
      && hatched.patternConnected && hatched.lineStroke !== 'none',
    'Click-inside HATCH did not render a visible ANSI31 pattern.')
    assert(hatched.hatchData?.patternType === 'ANSI31' && hatched.hatchData?.hatchScale === 10
      && hatched.fillOpacity === 1 && hatched.sourceConnected
      && hatched.pathSubpaths === 2 && hatched.history === 1 && hatched.revision === 1,
    'Click-inside HATCH did not retain the closed path hole or commit one mutation.')
    await activePage.screenshot({ path: join(artifactsDirectory, 'hatch-click-default-pattern.png') })
    trace('hatch-click-default', hatched)
  })
}

async function runJoinWorkflows(activePage) {
  await step('join connected lines and polylines with Undo/Redo', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 45 25"
        data-nanquim-version="3" data-element-index="984" data-active-collection-id="join-chain">
        <g id="join-chain" data-collection="true" name="Join chain"
          style="stroke:#ffffff;stroke-width:.25;fill:none">
          <circle id="980" name="Before" cx="-2" cy="0" r="1"/>
          <line id="981" name="First" x1="0" y1="0" x2="10" y2="0" stroke="#35d07f"/>
          <line id="982" name="Second" x1="20" y1="0" x2="10" y2="0"/>
          <polyline id="983" name="Third" points="30,10 25,5 20,0"/>
        </g></svg>`
      const result = await window.editor.documents.openFile(
        new File([source], 'join-chain.svg', { type: 'image/svg+xml' }),
      )
      const editor = window.editor
      editor.selected = ['983', '982', '981'].map(id => editor.drawing.findOne(`[id="${id}"]`))
      editor.signals.updatedSelection.dispatch()
      return result
    })
    assert(loaded?.ok, 'Could not initialize the JOIN fixture.')

    const readState = () => activePage.evaluate(() => {
      const editor = window.editor
      editor.documentState.flushObservedMutations()
      const collection = editor.drawing.findOne('[id="join-chain"]')
      const joined = collection.findOne('polyline')
      return {
        childIds: collection.children().map(element => String(element.attr('id'))),
        history: editor.history.undos.length,
        joinedId: joined ? String(joined.attr('id')) : null,
        joinedPoints: joined?.array().map(([x, y]) => [Number(x), Number(y)]) || null,
        joinedStroke: joined?.attr('stroke') || null,
        revision: editor.documentState.revision,
        selected: editor.selected.map(element => String(element.attr('id'))),
      }
    })

    const before = await readState()
    await runTerminalCommand(activePage, 'j')
    await activePage.waitForFunction(() => window.editor.history.undos.length === 1
      && window.editor.drawing.findOne('[id="join-chain"]').find('polyline').length === 1
      && !window.editor.drawing.findOne('[id="981"]'))
    const joined = await readState()
    assert(JSON.stringify(joined.joinedPoints) === JSON.stringify([
      [0, 0], [10, 0], [20, 0], [25, 5], [30, 10],
    ]), 'JOIN did not create the expected ordered polyline geometry.')
    assert(joined.joinedStroke === '#35d07f'
      && JSON.stringify(joined.childIds) === JSON.stringify(['980', joined.joinedId]),
    'JOIN did not preserve the leading segment style and document position.')
    assert(joined.history === before.history + 1 && joined.revision === before.revision + 1
      && joined.selected.length === 1 && joined.selected[0] === joined.joinedId,
    'JOIN did not commit one selected History result.')

    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    const undone = await readState()
    assert(JSON.stringify(undone.childIds) === JSON.stringify(['980', '981', '982', '983'])
      && undone.joinedId === '983',
    'Undo did not restore the original JOIN sources and order.')

    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    const redone = await readState()
    assert(redone.joinedId === joined.joinedId
      && JSON.stringify(redone.joinedPoints) === JSON.stringify(joined.joinedPoints),
    'Redo did not restore the same joined polyline identity and geometry.')
    trace('join', { before, joined, redone, undone })
  })

  await step('join lines, arcs, splines, and SVG paths without flattening curves', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 50 25"
        data-nanquim-version="3" data-element-index="994" data-active-collection-id="join-curves">
        <g id="join-curves" data-collection="true" name="Joined curves"
          style="stroke:#ffffff;stroke-width:.25;fill:none">
          <line id="990" name="Line" x1="0" y1="0" x2="10" y2="0"/>
          <path id="991" name="Arc" d="M 10.006 0.004 A 10 10 0 0 1 20 10"/>
          <path id="992" name="Spline" d="M 30 10 C 28 10 24 10 20.006 10.004"/>
          <path id="993" name="Imported path" d="M 30.006 10.004 Q 35 15 40 10"/>
        </g></svg>`
      const result = await window.editor.documents.openFile(
        new File([source], 'join-curves.svg', { type: 'image/svg+xml' }),
      )
      const editor = window.editor
      editor.selected = ['993', '992', '990', '991']
        .map(id => editor.drawing.findOne(`[id="${id}"]`))
      editor.signals.updatedSelection.dispatch()
      return result
    })
    assert(loaded?.ok, 'Could not initialize the mixed-curve JOIN fixture.')

    await runTerminalCommand(activePage, 'j')
    await activePage.waitForFunction(() => window.editor.history.undos.length === 1
      && window.editor.drawing.findOne('path[name^="Joined Path"]'))
    const joined = await activePage.evaluate(() => {
      const editor = window.editor
      const path = editor.drawing.findOne('path[name^="Joined Path"]')
      return {
        commands: path.array().map(segment => [...segment]),
        history: editor.history.undos.length,
        selected: editor.selected.map(element => String(element.attr('id'))),
        sourceCount: ['990', '991', '992', '993']
          .filter(id => editor.drawing.findOne(`[id="${id}"]`)).length,
      }
    })
    assert(JSON.stringify(joined.commands) === JSON.stringify([
      ['M', 0, 0],
      ['L', 10, 0],
      ['A', 10, 10, 0, 0, 1, 20, 10],
      ['C', 24, 10, 28, 10, 30, 10],
      ['Q', 35, 15, 40, 10],
    ]), 'JOIN changed or flattened mixed curve commands.')
    assert(joined.history === 1 && joined.selected.length === 1 && joined.sourceCount === 0,
      'Mixed-curve JOIN did not commit one selected replacement.')

    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    await activePage.waitForFunction(() => ['990', '991', '992', '993'].every(
      id => window.editor.drawing.findOne(`[id="${id}"]`),
    ))
    trace('join-curves', { joined })
  })
}

async function runDistanceMeasurementWorkflows(activePage) {
  await step('show DIST measurements in the viewport with optional overlays hidden', async () => {
    const initialized = await activePage.evaluate(async () => {
      const result = await window.editor.documents.newDocument()
      window.editor.svg.viewbox(0, 0, 100, 75)
      return result
    })
    assert(initialized?.ok, 'Could not initialize the DIST viewport fixture.')

    if (await activePage.$eval('#Overlays', node => getComputedStyle(node).display !== 'none')) {
      await activePage.keyboard.press('F3')
    }
    await activePage.waitForFunction(() => getComputedStyle(document.getElementById('Overlays')).display === 'none')

    const screenPoint = (x, y) => activePage.evaluate(point => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(window.editor.svg.node.getScreenCTM())
      return { x: Math.round(screen.x), y: Math.round(screen.y) }
    }, { x, y })
    const first = await screenPoint(20, 20)
    const second = await screenPoint(70, 50)

    await runTerminalCommand(activePage, 'dist')
    await activePage.mouse.click(first.x, first.y)
    await activePage.mouse.move(second.x, second.y)
    await activePage.waitForFunction(() => {
      const group = document.querySelector('.measure-ghost-group[data-nanquim-transient="true"]')
      const line = group?.querySelector('.measure-ghost')
      if (!group || !line || group.parentElement !== window.editor.svg.node) return false
      const style = getComputedStyle(line)
      const bounds = line.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden'
        && style.stroke !== 'none' && Number(style.opacity) > 0
        && (bounds.width > 0 || bounds.height > 0)
    })

    await activePage.mouse.click(second.x, second.y)
    await activePage.waitForFunction(() => !window.editor.isInteracting
      && document.querySelector('.measure-overlay[data-nanquim-transient="true"]'))
    const measurement = await activePage.evaluate(() => {
      const group = document.querySelector('.measure-overlay[data-nanquim-transient="true"]')
      const line = group.querySelector('.measure-line')
      const text = group.querySelector('.measure-text')
      const lineStyle = getComputedStyle(line)
      const textStyle = getComputedStyle(text)
      const lineBounds = line.getBoundingClientRect()
      const textBounds = text.getBoundingClientRect()
      return {
        lineVisible: lineStyle.display !== 'none' && lineStyle.visibility !== 'hidden'
          && lineStyle.stroke !== 'none' && Number(lineStyle.opacity) > 0
          && (lineBounds.width > 0 || lineBounds.height > 0),
        overlaysHidden: getComputedStyle(document.getElementById('Overlays')).display === 'none',
        parentIsViewport: group.parentElement === window.editor.svg.node,
        text: Number(text.textContent),
        textFill: textStyle.fill,
        textVisible: textStyle.display !== 'none' && textStyle.visibility !== 'hidden'
          && textStyle.fill !== 'none' && Number(textStyle.opacity) > 0
          && textBounds.width > 0 && textBounds.height > 0,
      }
    })
    assert(measurement.overlaysHidden && measurement.parentIsViewport,
      'DIST placed its result back inside the hidden optional overlay group.')
    assert(measurement.lineVisible && measurement.textVisible,
      'DIST created a result that was not visibly painted in the viewport.')
    assert(Math.abs(measurement.text - Math.hypot(50, 30)) < 0.2
      && measurement.textFill !== 'rgb(204, 204, 204)',
      'DIST did not show the expected theme-aware measurement label.')
    await activePage.screenshot({ path: join(artifactsDirectory, 'distance-measurement.png') })

    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !document.querySelector('.measure-overlay'))
    await activePage.keyboard.press('F3')
    await activePage.waitForFunction(() => getComputedStyle(document.getElementById('Overlays')).display !== 'none')
    trace('distance-measurement', measurement)
  })
}

async function runDimensionSecondPointPreviewWorkflows(activePage) {
  await step('apply dimension-style orientation and position to preview, placement, and redraw', async () => {
    const initialized = await activePage.evaluate(async () => {
      const result = await window.editor.documents.newDocument()
      window.editor.svg.viewbox(0, 0, 100, 75)
      window.editor.isSnapping = false
      window.editor.gridSnap = false
      window.editor.polarTracking = false
      window.editor.ortho = false
      return result
    })
    assert(initialized?.ok, 'Could not initialize the dimension preview fixture.')

    if (await activePage.$eval('#Overlays', node => getComputedStyle(node).display !== 'none')) {
      await activePage.keyboard.press('F3')
    }
    await activePage.waitForFunction(() => getComputedStyle(document.getElementById('Overlays')).display === 'none')

    const setDimensionStyleOption = async (label, property, value) => {
      await activePage.click('#tab-dimstyles')
      await activePage.evaluate(({ labelText, nextValue }) => {
        const accordion = document.querySelector('.prop-accordion')
        const body = accordion?.querySelector('.dim-style-body')
        if (body?.style.display === 'none') accordion.querySelector('.prop-accordion-header').click()
        const row = Array.from(document.querySelectorAll('.property-row'))
          .find(candidate => candidate.querySelector('.property-label')?.textContent === labelText)
        const select = row?.querySelector('select')
        if (!select) throw new Error(`Dimension style ${labelText} control was not rendered.`)
        select.value = nextValue
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }, { labelText: label, nextValue: value })
      await activePage.waitForFunction(({ expected, propertyName }) => (
        window.editor.dimensionManager.getActiveStyle().properties[propertyName] === expected
      ), {}, { expected: value, propertyName: property })
    }

    await setDimensionStyleOption('Orientation', 'orientation', 'vertical')
    await setDimensionStyleOption('Position', 'position', 'below')
    const baseline = await activePage.evaluate(() => ({
      history: window.editor.history.undos.length,
      revision: window.editor.documentState.revision,
    }))
    await activePage.click('#tab-transform')

    const screenPoint = (x, y) => activePage.evaluate(point => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(window.editor.svg.node.getScreenCTM())
      return { x: Math.round(screen.x), y: Math.round(screen.y) }
    }, { x, y })
    const first = await screenPoint(20, 20)
    const second = await screenPoint(70, 50)

    await runTerminalCommand(activePage, 'dm')
    await activePage.mouse.click(first.x, first.y)
    await activePage.mouse.move(second.x, second.y)
    await activePage.waitForFunction(() => {
      const group = document.querySelector('.dimension-second-point-preview[data-nanquim-transient="true"]')
      const line = group?.querySelector('.measure-ghost')
      const text = group?.querySelector('.measure-text')
      if (!group || !line || !text || group.parentElement !== window.editor.svg.node) return false
      const lineStyle = getComputedStyle(line)
      const textStyle = getComputedStyle(text)
      const lineBounds = line.getBoundingClientRect()
      const textBounds = text.getBoundingClientRect()
      return lineStyle.display !== 'none' && lineStyle.visibility !== 'hidden'
        && lineStyle.stroke !== 'none' && Number(lineStyle.opacity) > 0
        && (lineBounds.width > 0 || lineBounds.height > 0)
        && textStyle.display !== 'none' && textStyle.visibility !== 'hidden'
        && textStyle.fill !== 'none' && Number(textStyle.opacity) > 0
        && textBounds.width > 0 && textBounds.height > 0
        && Math.abs(Number(text.textContent)
          - Math.abs(Number(line.getAttribute('y2')) - Number(line.getAttribute('y1')))) < 0.011
    })
    const preview = await activePage.evaluate(() => {
      const group = document.querySelector('.dimension-second-point-preview[data-nanquim-transient="true"]')
      const line = group.querySelector('.measure-ghost')
      const text = group.querySelector('.measure-text')
      const transform = text.getAttribute('transform') || ''
      const translation = transform.match(/translate\(([^,]+),\s*([^\)]+)\)/)
      return {
        history: window.editor.history.undos.length,
        line: ['x1', 'y1', 'x2', 'y2'].map(attribute => Number(line.getAttribute(attribute))),
        overlaysHidden: getComputedStyle(document.getElementById('Overlays')).display === 'none',
        parentIsViewport: group.parentElement === window.editor.svg.node,
        revision: window.editor.documentState.revision,
        text: text.textContent,
        textPoint: translation ? [Number(translation[1]), Number(translation[2])] : null,
      }
    })
    assert(preview.overlaysHidden && preview.parentIsViewport,
      'DIMLINEAR placed its second-point preview inside the hidden optional overlays.')
    assert(Math.abs(Number(preview.text) - Math.abs(preview.line[3] - preview.line[1])) < 0.011
      && preview.history === baseline.history && preview.revision === baseline.revision,
    'The vertical dimension style did not drive the preview without mutating the document.')
    const previewDx = preview.line[2] - preview.line[0]
    const previewDy = preview.line[3] - preview.line[1]
    const previewLength = Math.hypot(previewDx, previewDy)
    const previewMidpoint = [
      (preview.line[0] + preview.line[2]) / 2,
      (preview.line[1] + preview.line[3]) / 2,
    ]
    const previewBelowOffset = preview.textPoint
      && (preview.textPoint[0] - previewMidpoint[0]) * (-previewDy / previewLength)
        + (preview.textPoint[1] - previewMidpoint[1]) * (previewDx / previewLength)
    assert(previewBelowOffset > 0,
      'The Below style did not place the live dimension value below its baseline.')
    await activePage.screenshot({ path: join(artifactsDirectory, 'dimension-second-point-preview.png') })

    await activePage.mouse.click(second.x, second.y)
    await activePage.waitForFunction(() => !document.querySelector('.dimension-second-point-preview'))
    const location = await screenPoint(80, 60)
    await activePage.mouse.move(location.x, location.y)
    await activePage.mouse.click(location.x, location.y)
    await activePage.waitForFunction(() => !window.editor.isInteracting
      && window.editor.drawing.findOne('[data-element-type="dimension"]'))
    const vertical = await activePage.evaluate(() => {
      const dimension = window.editor.drawing.findOne('[data-element-type="dimension"]')
      const main = dimension.findOne('.dim-main-line')
      return {
        data: JSON.parse(dimension.attr('data-dim-data')),
        line: ['x1', 'y1', 'x2', 'y2'].map(attribute => Number(main.attr(attribute))),
        text: dimension.findOne('.dim-text').text(),
        textPoint: ['x', 'y'].map(attribute => Number(dimension.findOne('.dim-text').attr(attribute))),
      }
    })
    assert(Math.abs(vertical.line[0] - vertical.line[2]) < 1e-5
      && Math.abs(Number(vertical.text) - Math.abs(vertical.data.p2.y - vertical.data.p1.y)) < 0.011
      && vertical.textPoint[0] < vertical.line[0],
      'The vertical dimension style did not create vertical dimension geometry.')

    await setDimensionStyleOption('Orientation', 'orientation', 'aligned')
    await activePage.waitForFunction(() => {
      const dimension = window.editor.drawing.findOne('[data-element-type="dimension"]')
      const main = dimension?.findOne('.dim-main-line')
      return main && Math.abs(Number(main.attr('x1')) - Number(main.attr('x2'))) > 1e-4
    })
    const aligned = await activePage.evaluate(() => {
      const dimension = window.editor.drawing.findOne('[data-element-type="dimension"]')
      const main = dimension.findOne('.dim-main-line')
      return {
        data: JSON.parse(dimension.attr('data-dim-data')),
        line: ['x1', 'y1', 'x2', 'y2'].map(attribute => Number(main.attr(attribute))),
        orientation: window.editor.dimensionManager.getActiveStyle().properties.orientation,
        position: window.editor.dimensionManager.getActiveStyle().properties.position,
        text: dimension.findOne('.dim-text').text(),
        textPoint: ['x', 'y'].map(attribute => Number(dimension.findOne('.dim-text').attr(attribute))),
      }
    })
    const alignedDx = aligned.line[2] - aligned.line[0]
    const alignedDy = aligned.line[3] - aligned.line[1]
    const measuredDx = aligned.data.p2.x - aligned.data.p1.x
    const measuredDy = aligned.data.p2.y - aligned.data.p1.y
    const measuredDistance = Math.hypot(measuredDx, measuredDy)
    const alignedMidpoint = [
      (aligned.line[0] + aligned.line[2]) / 2,
      (aligned.line[1] + aligned.line[3]) / 2,
    ]
    const alignedBelowOffset = (aligned.textPoint[0] - alignedMidpoint[0]) * (-measuredDy / measuredDistance)
      + (aligned.textPoint[1] - alignedMidpoint[1]) * (measuredDx / measuredDistance)
    assert(aligned.orientation === 'aligned' && aligned.position === 'below'
      && Math.abs(Number(aligned.text) - measuredDistance) < 0.01
      && Math.abs(alignedDx * measuredDy - alignedDy * measuredDx) < 1e-5
      && alignedBelowOffset > 0,
    'Aligned/Below did not redraw the existing dimension with the selected style placement.')
    await activePage.screenshot({ path: join(artifactsDirectory, 'dimension-style-orientation.png') })

    await activePage.keyboard.press('F3')
    await activePage.waitForFunction(() => getComputedStyle(document.getElementById('Overlays')).display !== 'none')
    trace('dimension-style-orientation', { aligned, baseline, preview, vertical })
  })
}

async function runFilletRepeatWorkflows(activePage) {
  await step('fillet a rectangle semantically with Undo/Redo', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 70"
        data-nanquim-version="3" data-element-index="976" data-active-collection-id="fillet-rectangle">
        <g id="fillet-rectangle" data-collection="true" name="Rectangle fillet"
          style="stroke:#ffffff;stroke-width:.25;fill:none">
          <rect id="975" name="Room" data-zone="A" x="20" y="15" width="50" height="30"/>
        </g></svg>`
      const result = await window.editor.documents.openFile(
        new File([source], 'fillet-rectangle.svg', { type: 'image/svg+xml' }),
      )
      window.editor.cmdParams.filletRadius = 6
      return result
    })
    assert(loaded?.ok, 'Could not initialize the rectangle FILLET fixture.')

    const readState = () => activePage.evaluate(() => {
      const editor = window.editor
      editor.documentState.flushObservedMutations()
      const rectangle = editor.drawing.findOne('[id="975"]')
      return {
        history: editor.history.undos.length,
        interacting: editor.isInteracting,
        name: rectangle?.attr('name') || null,
        revision: editor.documentState.revision,
        rx: rectangle?.node.hasAttribute('rx') ? Number(rectangle.attr('rx')) : null,
        ry: rectangle?.node.hasAttribute('ry') ? Number(rectangle.attr('ry')) : null,
        tag: rectangle?.type || null,
        zone: rectangle?.attr('data-zone') || null,
      }
    })

    const before = await readState()
    await runTerminalCommand(activePage, 'f')
    await activePage.waitForFunction(() => window.editor.isInteracting
      && window.editor.signals.toogledSelect.getNumListeners() > 0)
    await activePage.evaluate(() => {
      const editor = window.editor
      editor.lastClick = { x: 20, y: 15 }
      editor.signals.toogledSelect.dispatch(editor.drawing.findOne('[id="975"]'))
    })
    await activePage.waitForFunction(() => {
      const editor = window.editor
      const rectangle = editor.drawing.findOne('[id="975"]')
      return editor.history.undos.length === 1
        && Number(rectangle?.attr('rx')) === 6
        && Number(rectangle?.attr('ry')) === 6
        && editor.isInteracting && editor.selectSingleElement
    })
    const filleted = await readState()
    assert(filleted.tag === 'rect' && filleted.name === 'Room' && filleted.zone === 'A'
      && filleted.rx === 6 && filleted.ry === 6,
    'Rectangle FILLET did not preserve its semantic element and metadata.')
    assert(filleted.history === before.history + 1
      && filleted.revision === before.revision + 1 && filleted.interacting,
    'Rectangle FILLET did not create one mutation and remain active.')

    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !window.editor.isInteracting
      && !window.editor.selectSingleElement)
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    const undone = await readState()
    assert(undone.tag === 'rect' && undone.rx === null && undone.ry === null
      && undone.name === 'Room' && undone.zone === 'A',
    'Undo did not restore the exact square rectangle.')

    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    const redone = await readState()
    assert(redone.tag === 'rect' && redone.rx === 6 && redone.ry === 6
      && redone.name === 'Room' && redone.zone === 'A',
    'Redo did not restore the same semantic rectangle fillet.')
    trace('fillet-rectangle', { before, filleted, redone, undone })
  })

  await step('fillet separated lines using their full picked rays', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.1 -0.1 1.2 1.2"
        data-nanquim-version="3" data-element-index="972" data-active-collection-id="fillet-gap">
        <g id="fillet-gap" data-collection="true" name="Gapped fillet"
          style="stroke:#ffffff;stroke-width:.005;fill:none">
          <line id="970" name="Horizontal" x1=".01" y1="0" x2="1" y2="0"/>
          <line id="971" name="Vertical" x1="0" y1=".01" x2="0" y2="1"/>
        </g></svg>`
      const result = await window.editor.documents.openFile(
        new File([source], 'fillet-gap.svg', { type: 'image/svg+xml' }),
      )
      window.editor.cmdParams.filletRadius = 0.02
      return result
    })
    assert(loaded?.ok, 'Could not initialize the gapped FILLET fixture.')

    await runTerminalCommand(activePage, 'f')
    await activePage.waitForFunction(() => window.editor.isInteracting
      && window.editor.signals.toogledSelect.getNumListeners() > 0)
    await activePage.evaluate(() => {
      const editor = window.editor
      const select = (id, point) => {
        editor.lastClick = point
        editor.signals.toogledSelect.dispatch(editor.drawing.findOne(`[id="${id}"]`))
      }
      select('970', { x: 0.011, y: 0 })
      select('971', { x: 0, y: 0.011 })
    })
    await activePage.waitForFunction(() => window.editor.history.undos.length === 1
      && window.editor.drawing.findOne('path[name="Arc"]'))

    const filleted = await activePage.evaluate(() => {
      const editor = window.editor
      const line = id => ['x1', 'y1', 'x2', 'y2'].map(attribute => (
        Number(editor.drawing.findOne(`[id="${id}"]`).attr(attribute))
      ))
      const arc = editor.drawing.findOne('path[name="Arc"]')
      return {
        arcData: arc.data('arcData'),
        history: editor.history.undos.length,
        horizontal: line('970'),
        vertical: line('971'),
      }
    })
    assertNear(filleted.horizontal[0], 0.02, 1e-8, 'Gapped FILLET horizontal tangent')
    assertNear(filleted.vertical[1], 0.02, 1e-8, 'Gapped FILLET vertical tangent')
    assertNear(filleted.arcData.p1.x, 0.02, 1e-8, 'Gapped FILLET arc start x')
    assertNear(filleted.arcData.p3.y, 0.02, 1e-8, 'Gapped FILLET arc end y')
    assert(filleted.history === 1, 'Gapped FILLET did not create exactly one History mutation.')

    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !window.editor.isInteracting
      && !window.editor.selectSingleElement)
    trace('fillet-gap', { filleted })
  })

  await step('repeat FILLET pairs until Escape with independent Undo/Redo', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 40 40"
        data-nanquim-version="3" data-element-index="974" data-active-collection-id="fillet-repeat">
        <g id="fillet-repeat" data-collection="true" name="Repeated fillets"
          style="stroke:#ffffff;stroke-width:.25;fill:none">
          <line id="970" name="First horizontal" x1="2" y1="0" x2="10" y2="0"/>
          <line id="971" name="First vertical" x1="0" y1="2" x2="0" y2="10"/>
          <line id="972" name="Second horizontal" x1="22" y1="20" x2="30" y2="20"/>
          <line id="973" name="Second vertical" x1="20" y1="22" x2="20" y2="30"/>
        </g></svg>`
      const result = await window.editor.documents.openFile(
        new File([source], 'fillet-repeat.svg', { type: 'image/svg+xml' }),
      )
      window.editor.cmdParams.filletRadius = 0
      return result
    })
    assert(loaded?.ok, 'Could not initialize the repeated FILLET fixture.')

    const readState = () => activePage.evaluate(() => {
      const editor = window.editor
      editor.documentState.flushObservedMutations()
      const line = id => ['x1', 'y1', 'x2', 'y2'].map(attribute => (
        Number(editor.drawing.findOne(`[id="${id}"]`).attr(attribute))
      ))
      return {
        firstHorizontal: line('970'),
        firstVertical: line('971'),
        history: editor.history.undos.length,
        interacting: editor.isInteracting,
        revision: editor.documentState.revision,
        secondHorizontal: line('972'),
        secondVertical: line('973'),
        selecting: editor.selectSingleElement,
      }
    })

    await runTerminalCommand(activePage, 'f')
    await activePage.waitForFunction(() => window.editor.isInteracting
      && window.editor.signals.toogledSelect.getNumListeners() > 0)
    await activePage.evaluate(() => {
      const editor = window.editor
      const select = (id, point) => {
        editor.lastClick = point
        editor.signals.toogledSelect.dispatch(editor.drawing.findOne(`[id="${id}"]`))
      }
      select('970', { x: 8, y: 0 })
      select('971', { x: 0, y: 8 })
      select('972', { x: 28, y: 20 })
      select('973', { x: 20, y: 28 })
    })
    await activePage.waitForFunction(() => window.editor.history.undos.length === 2
      && window.editor.isInteracting && window.editor.selectSingleElement)

    const repeated = await readState()
    assert(JSON.stringify(repeated.firstHorizontal) === JSON.stringify([0, 0, 10, 0])
      && JSON.stringify(repeated.firstVertical) === JSON.stringify([0, 0, 0, 10]),
    'The first FILLET pair did not extend to its intersection.')
    assert(JSON.stringify(repeated.secondHorizontal) === JSON.stringify([20, 20, 30, 20])
      && JSON.stringify(repeated.secondVertical) === JSON.stringify([20, 20, 20, 30]),
    'The repeated FILLET pair did not extend to its intersection.')
    assert(repeated.history === 2 && repeated.revision === 2
      && repeated.interacting && repeated.selecting,
    'FILLET did not remain active with one History mutation per completed pair.')

    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !window.editor.isInteracting
      && !window.editor.selectSingleElement)
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    const onceUndone = await readState()
    assert(JSON.stringify(onceUndone.firstHorizontal) === JSON.stringify(repeated.firstHorizontal)
      && JSON.stringify(onceUndone.secondHorizontal) === JSON.stringify([22, 20, 30, 20]),
    'Undo did not isolate the most recent repeated FILLET pair.')

    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    const twiceUndone = await readState()
    assert(JSON.stringify(twiceUndone.firstHorizontal) === JSON.stringify([2, 0, 10, 0])
      && JSON.stringify(twiceUndone.firstVertical) === JSON.stringify([0, 2, 0, 10]),
    'The second Undo did not restore the first FILLET pair.')

    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    const redone = await readState()
    assert(JSON.stringify(redone.firstHorizontal) === JSON.stringify(repeated.firstHorizontal)
      && JSON.stringify(redone.secondHorizontal) === JSON.stringify(repeated.secondHorizontal),
    'Redo did not restore both repeated FILLET mutations.')
    trace('fillet-repeat', { onceUndone, redone, repeated, twiceUndone })
  })
}

async function runSplineTrimBoundaryWorkflows(activePage) {
  await step('trim a line against a selected spline boundary with Undo/Redo', async () => {
    const loaded = await activePage.evaluate(async () => {
      const points = [
        { x: 50, y: 0 },
        { x: 50, y: 10 },
        { x: 50, y: 20 },
        { x: 50, y: 30 },
      ]
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -5 100 40"
        data-nanquim-version="3" data-element-index="963" data-active-collection-id="trim-spline-boundary">
        <g id="trim-spline-boundary" data-collection="true" name="Spline trim boundary"
          style="stroke:#ffffff;stroke-width:.25;fill:none">
          <path id="960" name="Spline boundary" d="M 50 0 C 50 10, 50 20, 50 30"
            data-spline-data="${JSON.stringify({ points }).replaceAll('"', '&quot;')}"/>
          <line id="961" name="Trim target" x1="20" y1="15" x2="80" y2="15"/>
        </g></svg>`
      return window.editor.documents.openFile(new File([source], 'trim-spline-boundary.svg', { type: 'image/svg+xml' }))
    })
    assert(loaded?.ok, 'Could not initialize the spline TRIM boundary fixture.')

    const screenPoint = (x, y) => activePage.evaluate(point => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(window.editor.svg.node.getScreenCTM())
      return { x: Math.round(screen.x), y: Math.round(screen.y) }
    }, { x, y })
    const readState = () => activePage.evaluate(() => {
      const editor = window.editor
      editor.documentState.flushObservedMutations()
      const line = editor.drawing.findOne('[id="961"]')
      const spline = editor.drawing.findOne('[id="960"]')
      return {
        history: editor.history.undos.length,
        line: ['x1', 'y1', 'x2', 'y2'].map(attribute => Number(line.attr(attribute))),
        revision: editor.documentState.revision,
        spline: spline.data('splineData').points,
      }
    })
    const before = await readState()
    await activePage.evaluate(() => document.querySelector('[data-outliner-id="960"] .collection-name')?.click())
    await activePage.waitForFunction(() => window.editor.selected.some(element => element.node.id === '960'))
    await runTerminalCommand(activePage, 'tr')
    await activePage.waitForFunction(() => window.editor.isInteracting
      && window.editor.signals.toogledSelect.getNumListeners() > 0)

    const trimPoint = await screenPoint(68, 15)
    await activePage.mouse.move(trimPoint.x, trimPoint.y)
    await activePage.waitForFunction(() => window.editor.hoveredElements.some(element => element.node.id === '961'))
    await activePage.mouse.click(trimPoint.x, trimPoint.y)
    await activePage.waitForFunction(() => {
      const line = window.editor.drawing.findOne('[id="961"]')
      return window.editor.history.undos.length === 1 && Math.abs(Number(line.attr('x2')) - 50) < 1e-4
    })
    const trimmed = await readState()
    assert(trimmed.line.every((value, index) => Math.abs(value - [20, 15, 50, 15][index]) < 1e-4),
      'TRIM did not shorten the line at the selected spline boundary.')
    assert(JSON.stringify(trimmed.spline) === JSON.stringify(before.spline),
      'Using the spline as a TRIM boundary changed the spline.')
    assert(trimmed.history === before.history + 1 && trimmed.revision === before.revision + 1,
      'Spline-bounded TRIM did not commit one document mutation.')
    await activePage.screenshot({ path: join(artifactsDirectory, 'trim-spline-boundary.png') })

    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !window.editor.isInteracting)
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    const undone = await readState()
    assert(JSON.stringify(undone.line) === JSON.stringify(before.line),
      'Undo did not restore the spline-bounded line trim.')
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    const redone = await readState()
    assert(JSON.stringify(redone.line) === JSON.stringify(trimmed.line),
      'Redo changed the spline-bounded line trim.')
    trace('trim-spline-boundary', { before, trimmed, undone, redone })
  })
}

async function runArcAutoExtendWorkflows(activePage) {
  await step('auto-extend an arc to a finite arc boundary with Undo/Redo', async () => {
    const loaded = await activePage.evaluate(async () => {
      const root = Math.SQRT1_2 * 10
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -5 35 20"
        data-nanquim-version="3" data-element-index="953" data-active-collection-id="extend-arcs">
        <g id="extend-arcs" data-collection="true" name="Extend arcs"
          style="stroke:#ffffff;stroke-width:.25;fill:none">
          <path id="950" name="Target arc" d="M 10 0 A 10 10 0 0 1 0 10"
            data-arc-data="{&quot;p1&quot;:{&quot;x&quot;:10,&quot;y&quot;:0},&quot;p2&quot;:{&quot;x&quot;:${root},&quot;y&quot;:${root}},&quot;p3&quot;:{&quot;x&quot;:0,&quot;y&quot;:10}}"/>
          <path id="951" name="Boundary arc" d="M 0 0 A 10 10 0 0 1 -10 10"
            data-arc-data="{&quot;p1&quot;:{&quot;x&quot;:0,&quot;y&quot;:0},&quot;p2&quot;:{&quot;x&quot;:${-10 + root},&quot;y&quot;:${root}},&quot;p3&quot;:{&quot;x&quot;:-10,&quot;y&quot;:10}}"/>
        </g></svg>`
      return window.editor.documents.openFile(new File([source], 'extend-arcs.svg', { type: 'image/svg+xml' }))
    })
    assert(loaded?.ok, 'Could not initialize the arc Auto-Extend fixture.')

    const readState = () => activePage.evaluate(() => {
      const editor = window.editor
      editor.documentState.flushObservedMutations()
      const target = editor.drawing.findOne('[id="950"]')
      const data = target.data('arcData')
      const p1 = data.p1, p2 = data.p2, p3 = data.p3
      const area = p1.x * (p2.y - p3.y) - p1.y * (p2.x - p3.x)
        + p2.x * p3.y - p3.x * p2.y
      const b = (p1.x ** 2 + p1.y ** 2) * (p3.y - p2.y)
        + (p2.x ** 2 + p2.y ** 2) * (p1.y - p3.y)
        + (p3.x ** 2 + p3.y ** 2) * (p2.y - p1.y)
      const c = (p1.x ** 2 + p1.y ** 2) * (p2.x - p3.x)
        + (p2.x ** 2 + p2.y ** 2) * (p3.x - p1.x)
        + (p3.x ** 2 + p3.y ** 2) * (p1.x - p2.x)
      const cx = -b / (2 * area), cy = -c / (2 * area)
      return {
        data,
        history: editor.history.undos.length,
        radius: Math.hypot(p1.x - cx, p1.y - cy),
        revision: editor.documentState.revision,
      }
    })
    const before = await readState()
    await runTerminalCommand(activePage, 'ex')
    await activePage.keyboard.press('Enter')
    await waitForTerminalText(activePage, 'Auto-Extend Mode ON')
    await activePage.evaluate(() => {
      const editor = window.editor
      const target = editor.drawing.findOne('[id="950"]')
      editor.lastClick = { x: 0, y: 10 }
      editor.signals.toogledSelect.dispatch(target)
    })
    await activePage.waitForFunction(() => window.editor.history.undos.length === 1)
    const extended = await readState()
    assertNear(extended.data.p3.x, -5, 1e-5, 'Auto-extended arc endpoint x')
    assertNear(extended.data.p3.y, Math.sqrt(75), 1e-5, 'Auto-extended arc endpoint y')
    assertNear(extended.radius, 10, 1e-5, 'Auto-extended arc radius')
    assert(extended.history === before.history + 1 && extended.revision === before.revision + 1,
      'Arc Auto-Extend did not commit one document mutation.')
    await activePage.screenshot({ path: join(artifactsDirectory, 'extend-arc-auto.png') })

    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !window.editor.isInteracting)
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    const undone = await readState()
    assertNear(undone.data.p3.x, before.data.p3.x, 1e-7, 'Undone arc endpoint x')
    assertNear(undone.data.p3.y, before.data.p3.y, 1e-7, 'Undone arc endpoint y')
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    const redone = await readState()
    assertNear(redone.data.p3.x, extended.data.p3.x, 1e-7, 'Redone arc endpoint x')
    assertNear(redone.data.p3.y, extended.data.p3.y, 1e-7, 'Redone arc endpoint y')
    assertNear(redone.radius, extended.radius, 1e-7, 'Redone arc radius')
    trace('extend-arc-auto', { before, extended, undone, redone })
  })
}

async function runSplineOrthoWorkflows(activePage) {
  await step('constrain SPLINE fit points and its live preview with Ortho', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"
        data-nanquim-version="3" data-element-index="931" data-active-collection-id="spline-ortho">
        <g id="spline-ortho" data-collection="true" name="Spline Ortho"
          style="stroke:#ffffff;stroke-width:.25;fill:none"/>
      </svg>`
      const result = await window.editor.documents.openFile(new File([source], 'spline-ortho.svg', { type: 'image/svg+xml' }))
      const editor = window.editor
      editor.isSnapping = false
      editor.gridSnap = false
      editor.polarTracking = false
      editor.ortho = true
      return result
    })
    assert(loaded?.ok, 'Could not initialize the SPLINE Ortho fixture.')

    const pointerAt = (x, y) => activePage.evaluate(point => {
      const editor = window.editor
      const screen = new DOMPoint(point.x, point.y).matrixTransform(editor.svg.node.getScreenCTM())
      const pointer = { x: Math.round(screen.x), y: Math.round(screen.y) }
      const world = editor.svg.point(pointer.x, pointer.y)
      return { pointer, world: { x: world.x, y: world.y } }
    }, { x, y })
    const previewEnd = () => activePage.evaluate(() => {
      const path = window.editor.drawing.node.querySelector('path[data-nanquim-transient="true"]')
      if (!path) return null
      const point = path.getPointAtLength(path.getTotalLength())
      return { x: point.x, y: point.y }
    })
    const constrain = (point, reference) => {
      const dx = point.x - reference.x
      const dy = point.y - reference.y
      return Math.abs(dx) > Math.abs(dy)
        ? { x: point.x, y: reference.y }
        : { x: reference.x, y: point.y }
    }
    const assertPreview = async (expected, label) => {
      await activePage.waitForFunction(point => {
        const path = window.editor.drawing.node.querySelector('path[data-nanquim-transient="true"]')
        if (!path) return false
        const end = path.getPointAtLength(path.getTotalLength())
        return Math.abs(end.x - point.x) < 1e-4 && Math.abs(end.y - point.y) < 1e-4
      }, {}, expected)
      const actual = await previewEnd()
      assertNear(actual.x, expected.x, 1e-4, `${label} x`)
      assertNear(actual.y, expected.y, 1e-4, `${label} y`)
    }

    await runTerminalCommand(activePage, 'sp')
    const first = await pointerAt(20, 20)
    await activePage.mouse.click(first.pointer.x, first.pointer.y)
    const second = await pointerAt(47, 31)
    const constrainedSecond = constrain(second.world, first.world)
    await activePage.mouse.move(second.pointer.x, second.pointer.y)
    await assertPreview(constrainedSecond, 'Horizontal SPLINE Ortho preview')
    await activePage.mouse.click(second.pointer.x, second.pointer.y)

    const third = await pointerAt(52, 62)
    const constrainedThird = constrain(third.world, constrainedSecond)
    await activePage.mouse.move(third.pointer.x, third.pointer.y)
    await assertPreview(constrainedThird, 'Vertical SPLINE Ortho preview')
    await activePage.screenshot({ path: join(artifactsDirectory, 'spline-ortho-preview.png') })

    // F8 must redraw at the stationary pointer without requiring another move.
    await activePage.keyboard.press('F8')
    await assertPreview(third.world, 'Unconstrained stationary SPLINE preview')
    await activePage.keyboard.press('F8')
    await assertPreview(constrainedThird, 'Re-constrained stationary SPLINE preview')

    await activePage.mouse.click(third.pointer.x, third.pointer.y)
    await activePage.keyboard.press('Enter')
    await activePage.waitForFunction(() => !window.editor.isDrawing
      && !window.editor.drawing.node.querySelector('[data-nanquim-transient="true"]'))
    const state = await activePage.evaluate(() => {
      const editor = window.editor
      const spline = editor.drawing.findOne('path')
      return {
        history: editor.history.undos.length,
        points: spline?.data('splineData')?.points || [],
        revision: editor.documentState.revision,
      }
    })
    const expected = [first.world, constrainedSecond, constrainedThird]
    assert(state.points.length === expected.length, 'SPLINE did not retain all constrained fit points.')
    expected.forEach((point, index) => {
      assertNear(state.points[index].x, point.x, 1e-4, `Stored SPLINE point ${index + 1} x`)
      assertNear(state.points[index].y, point.y, 1e-4, `Stored SPLINE point ${index + 1} y`)
    })
    assert(state.history === 1 && state.revision === 1,
      'SPLINE Ortho did not commit exactly one document mutation.')
    trace('spline-ortho', { expected, state })
  })
}

async function runRectangleNearestSnapWorkflows(activePage) {
  await step('snap a line endpoint to the nearest point on a rectangle edge', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"
        data-nanquim-version="3" data-element-index="921" data-active-collection-id="rectangle-nearest">
        <g id="rectangle-nearest" data-collection="true" name="Rectangle nearest"
          style="stroke:#ffffff;stroke-width:.25;fill:none">
          <rect id="920" x="30" y="30" width="40" height="25"/>
        </g></svg>`
      const result = await window.editor.documents.openFile(new File([source], 'rectangle-nearest.svg', { type: 'image/svg+xml' }))
      const editor = window.editor
      editor.isSnapping = true
      editor.gridSnap = false
      editor.polarTracking = false
      editor.ortho = false
      for (const type of Object.keys(editor.snapTypes)) editor.snapTypes[type] = type === 'nearest'
      return result
    })
    assert(loaded?.ok, 'Could not initialize the rectangle nearest-snap fixture.')

    const screenPoint = (x, y) => activePage.evaluate(point => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(window.editor.svg.node.getScreenCTM())
      return { x: screen.x, y: screen.y }
    }, { x, y })
    await runTerminalCommand(activePage, 'l')
    const start = await screenPoint(12, 12)
    await activePage.mouse.click(start.x, start.y)
    const edge = await screenPoint(50, 30)
    await activePage.mouse.move(edge.x, edge.y - 6)
    await activePage.waitForFunction(() => {
      const editor = window.editor
      const marker = document.querySelector('#Snap > *')
      const bounds = marker?.getBoundingClientRect()
      return editor.snapPoint && Math.abs(editor.snapPoint.x - 50) < 1e-5
        && Math.abs(editor.snapPoint.y - 30) < 1e-5
        && bounds?.width > 0 && bounds.height > 0
    })
    await activePage.screenshot({ path: join(artifactsDirectory, 'rectangle-nearest-snap.png') })
    await activePage.mouse.click(edge.x, edge.y - 6)
    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !window.editor.isDrawing)

    const line = await activePage.evaluate(() => {
      const node = window.editor.drawing.node.querySelector('line')
      return node && {
        x1: node.x1.baseVal.value,
        y1: node.y1.baseVal.value,
        x2: node.x2.baseVal.value,
        y2: node.y2.baseVal.value,
      }
    })
    assert(line, 'LINE did not commit after snapping to the rectangle.')
    assertNear(line.x2, 50, 1e-5, 'Rectangle nearest-snap line end x')
    assertNear(line.y2, 30, 1e-5, 'Rectangle nearest-snap line end y')
    trace('rectangle-nearest-snap', { line })
  })

  await step('snap POLYLINE vertices and its live segment to endpoints', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"
        data-nanquim-version="3" data-element-index="924" data-active-collection-id="polyline-snap">
        <g id="polyline-snap" data-collection="true" name="Polyline snap"
          style="stroke:#ffffff;stroke-width:.25;fill:none">
          <line id="923" x1="70" y1="50" x2="80" y2="50"/>
        </g></svg>`
      const result = await window.editor.documents.openFile(
        new File([source], 'polyline-snap.svg', { type: 'image/svg+xml' }),
      )
      const editor = window.editor
      editor.isSnapping = true
      editor.gridSnap = false
      editor.polarTracking = false
      editor.ortho = false
      for (const type of Object.keys(editor.snapTypes)) editor.snapTypes[type] = type === 'endpoint'
      return result
    })
    assert(loaded?.ok, 'Could not initialize the POLYLINE snap fixture.')

    const pointerAt = async (x, y) => activePage.evaluate(point => {
      const transformed = new DOMPoint(point.x, point.y)
        .matrixTransform(window.editor.svg.node.getScreenCTM())
      return { x: transformed.x, y: transformed.y }
    }, { x, y })
    const pointerNear = async (x, y) => {
      const screen = await pointerAt(x, y)
      return { x: screen.x + 6, y: screen.y + 4 }
    }
    const moveNear = async (x, y) => {
      const pointer = await pointerNear(x, y)
      await activePage.mouse.move(pointer.x, pointer.y)
      await activePage.waitForFunction(point => (
        Math.abs(window.editor.snapPoint?.x - point.x) < 1e-5
        && Math.abs(window.editor.snapPoint?.y - point.y) < 1e-5
      ), {}, { x, y })
      return pointer
    }
    const rapidClick = async (pointer) => {
      await activePage.evaluate(({ clientX, clientY }) => {
        const svg = window.editor.svg.node
        svg.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, clientX, clientY,
        }))
        // Remain in the same task so requestAnimationFrame cannot resolve the
        // move before the click. Viewport must flush the pending snap itself.
        svg.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, button: 0, clientX, clientY,
        }))
      }, { clientX: pointer.x, clientY: pointer.y })
    }
    const rapidClickNear = async (x, y) => rapidClick(await pointerNear(x, y))

    await runTerminalCommand(activePage, 'pl')
    await rapidClick(await pointerAt(20, 20))
    const firstVertex = await activePage.evaluate(() => {
      const node = window.editor.drawing.node.querySelector('polyline[data-nanquim-transient="true"]')
      const point = node?.points.getItem(0)
      return point ? { x: point.x, y: point.y } : null
    })
    assert(firstVertex, 'POLYLINE did not retain its first in-progress vertex.')
    await moveNear(70, 50)
    await activePage.waitForFunction(() => {
      const node = window.editor.drawing.node.querySelector('polyline[data-nanquim-transient="true"]')
      if (!node || node.points.numberOfItems < 2) return false
      const end = node.points.getItem(node.points.numberOfItems - 1)
      return Math.abs(end.x - 70) < 1e-5 && Math.abs(end.y - 50) < 1e-5
    })
    await rapidClickNear(80, 50)
    await moveNear(firstVertex.x, firstVertex.y)
    await activePage.waitForFunction(first => {
      const node = window.editor.drawing.node.querySelector('polyline[data-nanquim-transient="true"]')
      if (!node || node.points.numberOfItems < 3) return false
      const end = node.points.getItem(node.points.numberOfItems - 1)
      return Math.abs(end.x - first.x) < 1e-5 && Math.abs(end.y - first.y) < 1e-5
    }, {}, firstVertex)
    await activePage.screenshot({ path: join(artifactsDirectory, 'polyline-self-close-snap-preview.png') })
    await rapidClickNear(firstVertex.x, firstVertex.y)
    await activePage.keyboard.press('Enter')
    await activePage.waitForFunction(() => !window.editor.isDrawing
      && !window.editor.drawing.node.querySelector('[data-nanquim-transient="true"]'))

    const result = await activePage.evaluate(() => {
      const polyline = window.editor.drawing.node.querySelector('polyline')
      return {
        history: window.editor.history.undos.length,
        points: polyline ? Array.from(
          { length: polyline.points.numberOfItems },
          (_, index) => {
            const point = polyline.points.getItem(index)
            return [point.x, point.y]
          },
        ) : [],
        revision: window.editor.documentState.revision,
      }
    })
    assert(result.points.length === 3,
      'POLYLINE did not commit all snapped endpoint coordinates.')
    assertNear(result.points[0][0], result.points[2][0], 1e-5, 'POLYLINE self-snap closing x')
    assertNear(result.points[0][1], result.points[2][1], 1e-5, 'POLYLINE self-snap closing y')
    assertNear(result.points[1][0], 80, 1e-5, 'POLYLINE external endpoint snap x')
    assertNear(result.points[1][1], 50, 1e-5, 'POLYLINE external endpoint snap y')
    assert(result.history === 1 && result.revision === 1,
      'POLYLINE snapping did not commit exactly one document mutation.')
    trace('polyline-endpoint-snap', result)
  })
}

async function runArcOffsetWorkflows(activePage) {
  await step('offset a circular arc with a visible preview and Undo/Redo', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"
        data-nanquim-version="3" data-element-index="901" data-active-collection-id="offset-arcs">
        <g id="offset-arcs" data-collection="true" name="Offset arcs" style="stroke:#ffffff;stroke-width:.3;fill:none">
          <path id="900" name="Source arc" d="M 20 50 A 20 20 0 0 1 60 50"
            data-arc-data="{&quot;p1&quot;:{&quot;x&quot;:20,&quot;y&quot;:50},&quot;p2&quot;:{&quot;x&quot;:40,&quot;y&quot;:30},&quot;p3&quot;:{&quot;x&quot;:60,&quot;y&quot;:50}}"/>
        </g></svg>`
      const result = await window.editor.documents.openFile(new File([source], 'offset-arcs.svg', { type: 'image/svg+xml' }))
      const editor = window.editor
      editor.isSnapping = false
      editor.gridSnap = false
      editor.polarTracking = false
      editor.ortho = false
      return result
    })
    assert(loaded?.ok, 'Could not initialize the arc OFFSET fixture.')

    const screenPoint = (x, y) => activePage.evaluate(point => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(window.editor.svg.node.getScreenCTM())
      return { x: Math.round(screen.x), y: Math.round(screen.y) }
    }, { x, y })
    const readState = () => activePage.evaluate(() => {
      const editor = window.editor
      editor.documentState.flushObservedMutations()
      const paths = []
      const collectPaths = (root, directPreview) => root.find('path').each((path) => {
        const data = path.data('arcData')
        if (!data) return
        paths.push({
          data,
          directPreview,
          id: path.attr('id') == null ? null : String(path.attr('id')),
          name: path.attr('name') ?? null,
          paint: (() => {
            const style = getComputedStyle(path.node)
            return {
              display: style.display,
              opacity: Number(style.opacity),
              stroke: style.stroke,
              strokeWidth: Number.parseFloat(style.strokeWidth),
              visibility: style.visibility,
            }
          })(),
        })
      })
      collectPaths(editor.drawing, false)
      collectPaths(editor.overlays, true)
      return {
        history: editor.history.undos.length,
        interacting: editor.isInteracting,
        paths,
        revision: editor.documentState.revision,
      }
    })
    const radius = data => {
      const p1 = data.p1, p2 = data.p2, p3 = data.p3
      const area = p1.x * (p2.y - p3.y) - p1.y * (p2.x - p3.x) + p2.x * p3.y - p3.x * p2.y
      const b = (p1.x ** 2 + p1.y ** 2) * (p3.y - p2.y)
        + (p2.x ** 2 + p2.y ** 2) * (p1.y - p3.y)
        + (p3.x ** 2 + p3.y ** 2) * (p2.y - p1.y)
      const c = (p1.x ** 2 + p1.y ** 2) * (p2.x - p3.x)
        + (p2.x ** 2 + p2.y ** 2) * (p3.x - p1.x)
        + (p3.x ** 2 + p3.y ** 2) * (p1.x - p2.x)
      const cx = -b / (2 * area), cy = -c / (2 * area)
      return Math.hypot(p1.x - cx, p1.y - cy)
    }

    const before = await readState()
    await runTerminalCommand(activePage, 'o')
    await typeTerminalValue(activePage, '5')
    const sourcePoint = await screenPoint(40, 30)
    await activePage.mouse.move(sourcePoint.x, sourcePoint.y)
    await activePage.waitForFunction(() => window.editor.hoveredElements.some(element => element.node.id === '900'))
    await activePage.mouse.click(sourcePoint.x, sourcePoint.y)
    await activePage.waitForFunction(() => window.editor.isInteracting)

    await activePage.waitForFunction(() => {
      const preview = window.editor.overlays.node.querySelector('path[data-nanquim-transient="true"]')
      if (!preview) return false
      const style = getComputedStyle(preview)
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) > 0 && style.stroke !== 'none'
        && Number.parseFloat(style.strokeWidth) > 0
    })
    const initialPreviewState = await readState()
    const initialPreview = initialPreviewState.paths.find(path => path.directPreview)
    assert(initialPreview, 'Arc OFFSET did not create a preview before side confirmation.')
    assert(initialPreview.paint.display !== 'none' && initialPreview.paint.visibility !== 'hidden'
      && initialPreview.paint.opacity > 0 && initialPreview.paint.stroke !== 'none'
      && initialPreview.paint.strokeWidth > 0,
    'Arc OFFSET preview was present but had no visible stroke before confirmation.')

    const outside = await screenPoint(40, 20)
    await activePage.mouse.move(outside.x, outside.y)
    await activePage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const previewState = await readState()
    const preview = previewState.paths.find(path => path.directPreview)
    assert(preview && preview.paint.display !== 'none' && preview.paint.visibility !== 'hidden'
      && preview.paint.opacity > 0 && preview.paint.stroke !== 'none'
      && preview.paint.strokeWidth > 0,
    'Arc OFFSET did not expose a visibly painted concentric preview.')
    assertNear(radius(preview.data), 25, 1e-5, 'Arc OFFSET preview radius')
    assertNear(preview.data.p2.y, 25, 1e-5, 'Arc OFFSET preview midpoint')
    assert(previewState.history === before.history && previewState.revision === before.revision,
      'Arc OFFSET preview changed History or dirtied the document.')
    await activePage.screenshot({ path: join(artifactsDirectory, 'offset-arc-preview.png') })

    await activePage.mouse.click(outside.x, outside.y)
    await activePage.waitForFunction(() => window.editor.history.undos.length === 1
      && window.editor.drawing.node.querySelectorAll('path').length === 2)
    const placed = await readState()
    const offset = placed.paths.find(path => path.id !== '900')
    assert(offset && !placed.paths.some(path => path.directPreview), 'Arc OFFSET left its preview attached after commit.')
    assertNear(radius(offset.data), 25, 1e-5, 'Committed arc OFFSET radius')
    assertNear(offset.data.p1.x, 15, 1e-5, 'Committed arc OFFSET start point')
    assertNear(offset.data.p2.y, 25, 1e-5, 'Committed arc OFFSET midpoint')
    assertNear(offset.data.p3.x, 65, 1e-5, 'Committed arc OFFSET end point')
    assert(offset.name === 'Source arc' && placed.history === before.history + 1,
      'Arc OFFSET did not preserve its name in one History mutation.')

    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !window.editor.isInteracting && !window.editor.selectSingleElement)
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    const undone = await readState()
    assert(undone.paths.length === 1 && undone.paths[0].id === '900', 'Undo did not remove the offset arc.')
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    const redone = await readState()
    const redoneOffset = redone.paths.find(path => path.id !== '900')
    assert(redoneOffset && Math.abs(radius(redoneOffset.data) - 25) < 1e-5,
      'Redo did not restore the same offset arc geometry.')
    trace('offset-arc', { before, initialPreviewState, previewState, placed, undone, redone })
  })
}

async function runPolylineOffsetWorkflows(activePage) {
  await step('offset a polyline with a visible mitered preview and Undo/Redo', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"
        data-nanquim-version="3" data-element-index="911" data-active-collection-id="offset-polylines">
        <g id="offset-polylines" data-collection="true" name="Offset polylines"
          style="stroke:#ffffff;stroke-width:.3;fill:none">
          <polyline id="910" name="Source polyline" points="20,50 50,50 50,80"/>
        </g></svg>`
      const result = await window.editor.documents.openFile(
        new File([source], 'offset-polylines.svg', { type: 'image/svg+xml' }),
      )
      const editor = window.editor
      editor.isSnapping = false
      editor.gridSnap = false
      editor.polarTracking = false
      editor.ortho = false
      return result
    })
    assert(loaded?.ok, 'Could not initialize the polyline OFFSET fixture.')

    const screenPoint = (x, y) => activePage.evaluate(point => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(window.editor.svg.node.getScreenCTM())
      return { x: Math.round(screen.x), y: Math.round(screen.y) }
    }, { x, y })
    const readState = () => activePage.evaluate(() => {
      const editor = window.editor
      editor.documentState.flushObservedMutations()
      const polylines = []
      const collect = (root, directPreview) => root.find('polyline').each((polyline) => {
        const style = getComputedStyle(polyline.node)
        polylines.push({
          directPreview,
          id: polyline.attr('id') == null ? null : String(polyline.attr('id')),
          name: polyline.attr('name') ?? null,
          paint: {
            display: style.display,
            opacity: Number(style.opacity),
            stroke: style.stroke,
            strokeWidth: Number.parseFloat(style.strokeWidth),
            visibility: style.visibility,
          },
          points: polyline.array().map(([x, y]) => [Number(x), Number(y)]),
        })
      })
      collect(editor.drawing, false)
      collect(editor.overlays, true)
      return {
        history: editor.history.undos.length,
        polylines,
        revision: editor.documentState.revision,
      }
    })
    const assertPoints = (actual, expected, label) => {
      assert(actual.length === expected.length, `${label} has the wrong point count.`)
      expected.forEach((point, index) => {
        assertNear(actual[index][0], point[0], 1e-5, `${label} point ${index + 1} x`)
        assertNear(actual[index][1], point[1], 1e-5, `${label} point ${index + 1} y`)
      })
    }

    const before = await readState()
    await runTerminalCommand(activePage, 'o')
    await typeTerminalValue(activePage, '5')
    const sourcePoint = await screenPoint(35, 50)
    await activePage.mouse.move(sourcePoint.x, sourcePoint.y)
    await activePage.waitForFunction(() => window.editor.hoveredElements.some(element => element.node.id === '910'))
    await activePage.mouse.click(sourcePoint.x, sourcePoint.y)
    await activePage.waitForFunction(() => window.editor.isInteracting)

    const outside = await screenPoint(35, 40)
    await activePage.mouse.move(outside.x, outside.y)
    await activePage.waitForFunction(() => {
      const preview = window.editor.overlays.node.querySelector('polyline[data-nanquim-transient="true"]')
      if (!preview) return false
      const style = getComputedStyle(preview)
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) > 0 && style.stroke !== 'none'
        && Number.parseFloat(style.strokeWidth) > 0
    })
    const previewState = await readState()
    const preview = previewState.polylines.find(polyline => polyline.directPreview)
    assert(preview, 'Polyline OFFSET did not create a preview before side confirmation.')
    assertPoints(preview.points, [[20, 45], [55, 45], [55, 80]], 'Polyline OFFSET preview')
    assert(previewState.history === before.history && previewState.revision === before.revision,
      'Polyline OFFSET preview changed History or dirtied the document.')
    await activePage.screenshot({ path: join(artifactsDirectory, 'offset-polyline-preview.png') })

    await activePage.mouse.click(outside.x, outside.y)
    await activePage.waitForFunction(() => window.editor.history.undos.length === 1
      && window.editor.drawing.node.querySelectorAll('polyline').length === 2)
    const placed = await readState()
    const offset = placed.polylines.find(polyline => !polyline.directPreview && polyline.id !== '910')
    assert(offset && !placed.polylines.some(polyline => polyline.directPreview),
      'Polyline OFFSET left its preview attached after commit.')
    assertPoints(offset.points, [[20, 45], [55, 45], [55, 80]], 'Committed polyline OFFSET')
    assert(offset.name === 'Source polyline' && placed.history === before.history + 1,
      'Polyline OFFSET did not preserve its name in one History mutation.')
    assertPoints(
      placed.polylines.find(polyline => polyline.id === '910').points,
      [[20, 50], [50, 50], [50, 80]],
      'Source polyline after OFFSET',
    )

    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !window.editor.isInteracting && !window.editor.selectSingleElement)
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    const undone = await readState()
    assert(undone.polylines.filter(polyline => !polyline.directPreview).length === 1,
      'Undo did not remove the offset polyline.')
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    const redone = await readState()
    const redoneOffset = redone.polylines.find(polyline => !polyline.directPreview && polyline.id !== '910')
    assert(redoneOffset, 'Redo did not restore the offset polyline.')
    assertPoints(redoneOffset.points, offset.points, 'Redone polyline OFFSET')
    trace('offset-polyline', { before, previewState, placed, undone, redone })
  })
}

async function runWelcomeScreenWorkflows(activePage) {
  await step('reopen Welcome from the Nanquim icon and read dated history without changing the drawing', async () => {
    const changelog = await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8')
    const expectedCommits = [...changelog.matchAll(/^\| (\d{4}-\d{2}-\d{2}) \| \[([a-f0-9]+)\]\((https:\/\/github\.com\/elschilling\/nanquim\/commit\/[a-f0-9]{40})\) \| (.+) \|$/gm)]
      .map(([, date, commit, href, summary]) => ({ date, commit, href, summary }))
    assert(expectedCommits.length > 0, 'The canonical changelog has no dated commit entries.')
    const originalPreferences = await activePage.evaluate(() => localStorage.getItem('nanquim-preferences'))
    const scenarios = browserName === 'chromium'
      ? [{ width: BROWSER_VIEWPORT.width, light: false }, { width: 720, light: true }, { width: 390, light: false }]
      : [{ width: BROWSER_VIEWPORT.width, light: false }, { width: BROWSER_VIEWPORT.width, light: true }]
    const initialized = await activePage.evaluate(() => window.editor.documents.newDocument())
    assert(initialized?.ok, 'Could not prepare a drawing for the Welcome workflow.')
    await runTerminalCommand(activePage, 'l')
    await typeTerminalValue(activePage, '#0,0')
    await typeTerminalValue(activePage, '#30,20')
    await activePage.keyboard.press('Escape')
    const lineId = await activePage.evaluate(() => window.editor.drawing.node.querySelector('line').id)
    await activePage.click(`[data-outliner-id="${lineId}"] .collection-name`)

    const readState = () => activePage.evaluate(() => {
      const editor = window.editor
      editor.documentState.flushObservedMutations()
      return {
        drawing: editor.drawing.node.outerHTML,
        undo: editor.history.undos.map(command => command.type),
        redo: editor.history.redos.map(command => command.type),
        revision: editor.documentState.revision,
        savedRevision: editor.documentState.savedRevision,
        dirty: editor.documentState.isDirty,
        session: editor.documentState.sessionId,
        name: editor.documentState.fileName,
        selected: editor.selected.map(element => element.node?.id),
        activeCollection: editor.activeCollection.node.id,
        mode: editor.mode,
        snapping: editor.isSnapping,
        drawingCommand: editor.isDrawing,
        interacting: editor.isInteracting,
        pointListeners: editor.signals.pointCaptured.getNumListeners(),
        helpOpen: Boolean(document.getElementById('command-help-dialog')?.open),
        terminal: document.getElementById('terminalInput').value,
        log: document.getElementById('terminalLog').textContent,
      }
    })

    try {
      for (const scenario of scenarios) {
        if (browserName === 'chromium') await activePage.setViewport({ ...BROWSER_VIEWPORT, width: scenario.width })
        await activePage.evaluate(({ light }) => {
          window.openPreferences()
          const background = document.getElementById('prefs-background-color')
          background.value = light ? '#f3f1ea' : '#20252a'
          background.dispatchEvent(new Event('input', { bubbles: true }))
          const accent = document.getElementById('prefs-accent-color')
          accent.value = light ? '#3456a1' : '#62a7e8'
          accent.dispatchEvent(new Event('input', { bubbles: true }))
          document.querySelector('.prefs-btn-save').click()
          document.getElementById('terminalInput').value = 'unfinished draft'
        }, scenario)
        await activePage.hover('#navbar-welcome-open')
        const before = await readState()
        assert(before.dirty && before.undo.length > 0 && before.selected.includes(lineId),
          'The Welcome fixture must contain a dirty drawing, selection, and undo history.')

        for (const [openWith, closeWith] of [['click', 'Escape'], ['Enter', 'backdrop'], ['Space', 'Close']]) {
          await activePage.focus('#navbar-welcome-open')
          if (openWith === 'click') await activePage.click('#navbar-welcome-open')
          else await activePage.keyboard.press(openWith === 'Space' ? ' ' : openWith)
          await activePage.waitForSelector('#ws-dialog')
          await activePage.waitForFunction(() => document.getElementById('ws-dialog')?.contains(document.activeElement))
          await activePage.waitForFunction(() => getComputedStyle(document.getElementById('ws-dialog')).opacity === '1'
            && getComputedStyle(document.getElementById('welcome-overlay')).opacity === '1')
          await activePage.evaluate(() => Promise.all([window.welcomeScreen.show(), window.welcomeScreen.show()]))
          const content = await activePage.evaluate(() => ({
            overlays: document.querySelectorAll('#welcome-overlay').length,
            label: document.getElementById('navbar-welcome-open').getAttribute('aria-label'),
            modal: document.getElementById('ws-dialog').getAttribute('aria-modal'),
            entries: [...document.querySelectorAll('#ws-changelog .ws-changelog-entry')].map(entry => ({
              date: entry.querySelector('time')?.getAttribute('datetime'),
              text: entry.textContent,
              links: [...entry.querySelectorAll('a')].map(link => ({
                href: link.href, text: link.textContent.trim(), target: link.target, rel: link.rel,
              })),
            })),
          }))
          assert(content.overlays === 1 && content.modal === 'true' && content.label === 'Open welcome screen',
            'The Nanquim icon did not open exactly one accessible Welcome modal.')
          for (const expected of expectedCommits) {
            const entry = content.entries.find(candidate => candidate.links.some(link => link.href === expected.href))
            const link = entry?.links.find(candidate => candidate.href === expected.href)
            assert(entry?.date === expected.date && entry.text.includes(expected.summary) && link.text === expected.commit,
              `Welcome history differs from the canonical changelog for ${expected.commit}.`)
            assert(link.target === '_blank' && link.rel.includes('noopener') && link.rel.includes('noreferrer'),
              `Welcome commit ${expected.commit} does not open safely in a new tab.`)
          }

          if (openWith === 'click') {
            const appearance = await activePage.evaluate(() => {
              const dialog = document.getElementById('ws-dialog')
              const history = document.getElementById('ws-changelog')
              const bounds = dialog.getBoundingClientRect()
              const style = getComputedStyle(dialog)
              const context = document.createElement('canvas').getContext('2d')
              const color = value => {
                context.clearRect(0, 0, 1, 1)
                context.fillStyle = value
                context.fillRect(0, 0, 1, 1)
                return '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
                  .map(channel => channel.toString(16).padStart(2, '0')).join('')
              }
              const backgroundOf = element => {
                while (element) {
                  const background = getComputedStyle(element).backgroundColor
                  if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') return background
                  element = element.parentElement
                }
                return '#ffffff'
              }
              return {
                fits: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
                visible: bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
                noHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth + 1 && history.scrollWidth <= history.clientWidth + 1,
                text: [...history.querySelectorAll('time, a, p')].map(element => ({
                  foreground: color(getComputedStyle(element).color), background: color(backgroundOf(element)),
                })),
                focusableCount: [...dialog.querySelectorAll('a[href], button, [tabindex="0"]')]
                  .filter(element => element.getBoundingClientRect().height > 0).length,
              }
            })
            assert(appearance.fits && appearance.visible && appearance.noHorizontalOverflow,
              `Welcome or its history overflows the ${scenario.width}px viewport.`)
            assert(appearance.text.length > 0 && appearance.text.every(value => themeColorContrast(value.foreground, value.background) >= 4.5),
              'Welcome history text has insufficient contrast against the custom theme.')
            await activePage.screenshot({ path: join(artifactsDirectory, `welcome-${scenario.width}-${scenario.light ? 'light' : 'dark'}.png`) })
            for (let index = 0; index <= appearance.focusableCount; index += 1) {
              await activePage.keyboard.press('Tab')
              assert(await activePage.evaluate(() => document.getElementById('ws-dialog').contains(document.activeElement)),
                'Tab escaped the Welcome dialog.')
            }
            await activePage.keyboard.down('Shift')
            for (let index = 0; index <= appearance.focusableCount; index += 1) {
              await activePage.keyboard.press('Tab')
              assert(await activePage.evaluate(() => document.getElementById('ws-dialog').contains(document.activeElement)),
                'Shift+Tab escaped the Welcome dialog.')
            }
            await activePage.keyboard.up('Shift')
            for (const key of ['KeyL', 'Delete', 'F1', 'F3']) await activePage.keyboard.press(key)
            await activePage.keyboard.down(controlKey())
            await activePage.keyboard.press('KeyZ')
            await activePage.keyboard.up(controlKey())
            assert(JSON.stringify(await readState()) === JSON.stringify(before),
              'Typing or an editor shortcut in Welcome changed the drawing, selection, terminal, or history.')
            if (scenario === scenarios[0]) {
              await activePage.evaluate(() => {
                window.__nanquimWelcomePickerCalls = 0
                window.showOpenFilePicker = async () => {
                  window.__nanquimWelcomePickerCalls += 1
                  throw new DOMException('Cancelled by the browser workflow.', 'AbortError')
                }
              })
              try {
                await activePage.keyboard.down(controlKey())
                await activePage.keyboard.press('KeyO')
                await activePage.keyboard.up(controlKey())
                await activePage.waitForFunction(() => window.__nanquimWelcomePickerCalls === 1)
                assert(await activePage.evaluate(() => Boolean(document.getElementById('ws-dialog'))),
                  'Cancelling the Welcome Open shortcut dismissed the dialog.')
                assert(JSON.stringify(await readState()) === JSON.stringify(before),
                  'Cancelling the Welcome Open shortcut changed the active document.')
              } finally {
                await activePage.evaluate(() => {
                  window.showOpenFilePicker = undefined
                  delete window.__nanquimWelcomePickerCalls
                })
              }
            }
            trace('welcome-appearance', { ...scenario, ...appearance })
          }

          if (closeWith === 'Escape') await activePage.keyboard.press('Escape')
          else if (closeWith === 'Close') await activePage.click('#ws-dismiss')
          else await activePage.mouse.click(2, 2)
          await activePage.waitForFunction(() => !document.getElementById('welcome-overlay'))
          assert(await activePage.evaluate(() => document.activeElement?.id === 'navbar-welcome-open'),
            `${closeWith} did not restore focus to the Nanquim icon.`)
          assert(JSON.stringify(await readState()) === JSON.stringify(before),
            `${openWith}/${closeWith} changed the active document or editor state.`)
        }
      }

      if (browserName === 'chromium') await activePage.setViewport(BROWSER_VIEWPORT)
      await runTerminalCommand(activePage, 'co')
      await activePage.waitForFunction(() => window.editor.isInteracting
        && window.editor.signals.pointCaptured.getNumListeners() > 0)
      await activePage.hover('#navbar-welcome-open')
      const copying = await readState()
      await activePage.click('#navbar-welcome-open')
      await activePage.waitForSelector('#ws-dialog')
      await activePage.keyboard.press('Escape')
      await activePage.waitForFunction(() => !document.getElementById('welcome-overlay'))
      assert(JSON.stringify(await readState()) === JSON.stringify(copying),
        'Escape from Welcome cancelled or changed the active COPY command.')
      const basePoint = await canvasScreenPoint(activePage, 0.4, 0.4)
      await activePage.mouse.click(basePoint.x, basePoint.y)
      await waitForTerminalText(activePage, 'Base point:')
      await activePage.keyboard.press('Escape')
      await activePage.waitForFunction(() => !window.editor.isInteracting
        && window.editor.signals.pointCaptured.getNumListeners() === 0)
    } finally {
      if (browserName === 'chromium') await activePage.setViewport(BROWSER_VIEWPORT)
      await activePage.evaluate(previous => {
        if (previous === null) localStorage.removeItem('nanquim-preferences')
        else localStorage.setItem('nanquim-preferences', previous)
      }, originalPreferences)
    }
  })
}

async function runMirrorSnapWorkflows(activePage) {
  await step('snap MIRROR axis points and previews with preselection, live toggles, Undo/Redo, and cancellation', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 90"
        data-nanquim-version="3" data-element-index="710" data-active-collection-id="browser-mirror-collection">
        <g id="browser-mirror-collection" data-collection="true" name="Mirror collection"
          style="stroke:#ffffff;stroke-width:0.2;fill:none">
          <line id="701" x1="20" y1="20" x2="50" y2="20"/>
          <line id="702" x1="80" y1="60" x2="110" y2="60"/>
          <circle id="703" cx="95" cy="25" r="8"/>
        </g>
      </svg>`
      const result = await window.editor.documents.openFile(new File([source], 'browser-mirror.svg', { type: 'image/svg+xml' }))
      const editor = window.editor
      editor.isSnapping = false
      editor.gridSnap = false
      editor.polarTracking = false
      editor.ortho = false
      for (const type of Object.keys(editor.snapTypes)) editor.snapTypes[type] = ['endpoint', 'center'].includes(type)
      return result
    })
    assert(loaded?.ok, 'Could not initialize the MIRROR snap fixture.')
    await activePage.keyboard.press('Escape')
    const screenPoint = (x, y) => activePage.evaluate(point => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(window.editor.svg.node.getScreenCTM())
      return { x: screen.x, y: screen.y }
    }, { x, y })
    const moveNear = async (x, y) => {
      const screen = await screenPoint(x, y)
      // Native MouseEvent page coordinates are whole CSS pixels in Chromium.
      const pointer = { x: Math.round(screen.x + 6), y: Math.round(screen.y + 4) }
      await activePage.mouse.move(pointer.x, pointer.y)
      await activePage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      return pointer
    }
    const selectSource = async () => {
      const middle = await screenPoint(35, 20)
      await activePage.mouse.move(middle.x, middle.y)
      await activePage.waitForFunction(() => window.editor.hoveredElements.some(element => element.node.id === '701'))
      await activePage.mouse.click(middle.x, middle.y)
      await activePage.waitForFunction(() => window.editor.selected.some(element => element.node.id === '701'))
    }
    const assertSnap = async (x, y) => activePage.waitForFunction(point => {
      const editor = window.editor
      const marker = document.querySelector('#Snap > *')
      if (!marker || !editor.isInteracting) return false
      const style = getComputedStyle(marker)
      const bounds = marker.getBoundingClientRect()
      return Math.abs(editor.snapPoint?.x - point.x) < 1e-5
        && Math.abs(editor.snapPoint?.y - point.y) < 1e-5
        && bounds.width > 0 && bounds.height > 0 && style.visibility === 'visible'
        && style.display !== 'none' && style.stroke !== 'none' && Number.parseFloat(style.strokeWidth) > 0
    }, {}, { x, y })
    const readState = () => activePage.evaluate(() => {
      const editor = window.editor
      editor.documentState.flushObservedMutations()
      const points = node => ['x1', 'y1', 'x2', 'y2'].map(name => Number(node.getAttribute(name)))
      const axis = editor.svg.node.querySelector('.mirror-axis-helper')
      const preview = [...editor.svg.node.querySelectorAll('line')].find(node =>
        node.closest('[data-nanquim-transient="true"]') && !node.matches('.mirror-axis-helper'))
      return {
        lines: [...editor.drawing.node.querySelectorAll('line')]
          .filter(node => !node.closest('[data-nanquim-transient="true"]'))
          .map(node => ({ id: node.id, points: points(node), parent: node.parentElement.id })),
        axis: axis && points(axis), preview: preview && points(preview),
        history: editor.history.undos.length, revision: editor.documentState.revision,
        interacting: editor.isInteracting, single: editor.selectSingleElement, suppressed: editor.suppressHandlers,
        selected: editor.selected.map(element => element.node.id), handlers: editor.handlers.node.childElementCount,
        pointListeners: editor.signals.pointCaptured.getNumListeners(), inputListeners: editor.signals.inputValue.getNumListeners(),
        coordinateListeners: editor.signals.updatedCoordinates.getNumListeners(),
        transient: editor.svg.node.querySelectorAll('[data-nanquim-transient="true"]').length,
      }
    })
    const assertAxis = async (base, end) => {
      const state = await readState()
      assert(state.axis, 'MIRROR did not expose its axis preview.')
      for (const [index, expected] of [base.x, base.y, end.x, end.y].entries()) {
        assertNear(state.axis[index], expected, 1e-5, `MIRROR axis coordinate ${index}`)
      }
      return state
    }
    const assertClean = state => {
      assert(!state.axis && !state.preview && !state.transient && !state.interacting
        && !state.single && !state.suppressed && !state.pointListeners && !state.inputListeners,
      'MIRROR left a preview, listener, or interaction flag active.')
      assert(state.coordinateListeners === original.coordinateListeners, 'MIRROR left its coordinate listener active.')
    }
    const assertIsolated = async phase => {
      const state = await readState()
      assert(state.interacting && state.suppressed && state.handlers === 0
        && JSON.stringify(state.selected) === '["701"]',
      `MIRROR ${phase} exposed grips or changed its source selection: ${JSON.stringify(state)}`)
    }
    const reflected = [20, 20, 410 / 13, 620 / 13]
    const base = { x: 20, y: 20 }
    const destination = { x: 80, y: 60 }
    const assertSnappedPreview = async () => {
      await assertSnap(destination.x, destination.y)
      const state = await assertAxis(base, destination)
      assert(state.preview, 'MIRROR did not create a reflected line preview.')
      reflected.forEach((value, index) => assertNear(state.preview[index], value, 1e-5, `MIRROR reflected preview coordinate ${index}`))
      return state
    }

    await selectSource()
    const original = await readState()
    await runTerminalCommand(activePage, 'mi')
    // Preselection must enter axis capture without an extra confirming Enter.
    await activePage.waitForFunction(() => window.editor.isInteracting && window.editor.signals.pointCaptured.getNumListeners() > 0)
    const firstPointer = await moveNear(base.x, base.y)
    await activePage.keyboard.press('F9')
    await assertSnap(base.x, base.y)
    await moveNear(destination.x, destination.y)
    await assertSnap(destination.x, destination.y)
    await moveNear(base.x, base.y)
    await assertSnap(base.x, base.y)
    await activePage.mouse.click(firstPointer.x, firstPointer.y)
    await assertIsolated('first axis point')
    const secondPointer = await moveNear(destination.x, destination.y)
    const snappedPreview = await assertSnappedPreview()
    assert(snappedPreview.history === original.history && snappedPreview.revision === original.revision,
      'A MIRROR preview changed History or dirtied the document.')

    // The stationary pointer must drive the axis and geometry when snap changes.
    await activePage.keyboard.press('F9')
    await activePage.waitForFunction(() => !window.editor.isSnapping && !window.editor.snapPoint)
    const rawPoint = await activePage.evaluate(pointer => {
      const point = window.editor.svg.point(pointer.x, pointer.y)
      return { x: point.x, y: point.y }
    }, secondPointer)
    const unsnappedPreview = await assertAxis(base, rawPoint)
    assert(JSON.stringify(unsnappedPreview.preview) !== JSON.stringify(snappedPreview.preview),
      'Disabling snap did not update the reflected geometry at the stationary pointer.')
    await activePage.focus('#object-snap-toggle')
    await activePage.keyboard.press(' ')
    await assertSnappedPreview()

    // Transient reflected endpoints must never become snap targets themselves.
    await moveNear(reflected[2], reflected[3])
    assert(await activePage.evaluate(() => !window.editor.snapPoint && document.querySelector('#Snap').childElementCount === 0),
      'MIRROR snapped to its own reflected preview.')
    await moveNear(destination.x, destination.y)
    await assertSnappedPreview()
    await activePage.mouse.click(secondPointer.x, secondPointer.y)
    await waitForTerminalText(activePage, 'Delete source objects?')
    await assertIsolated('second axis point')
    await typeTerminalValue(activePage, 'n')
    await activePage.waitForFunction(() => !window.editor.isInteracting && !window.editor.selectSingleElement)
    const placed = await readState()
    assertClean(placed)
    assert(placed.history === original.history + 1 && placed.lines.length === original.lines.length + 1,
      'MIRROR did not commit exactly one reflected copy and History entry.')
    const copy = placed.lines.find(line => !original.lines.some(source => source.id === line.id))
    assert(copy?.parent === 'browser-mirror-collection', 'MIRROR changed the copy collection.')
    reflected.forEach((value, index) => assertNear(copy.points[index], value, 1e-5, `MIRROR committed coordinate ${index}`))
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    assert(JSON.stringify((await readState()).lines) === JSON.stringify(original.lines), 'Undo did not restore the original MIRROR geometry.')
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    assert(JSON.stringify((await readState()).lines) === JSON.stringify(placed.lines), 'Redo changed the snapped MIRROR result.')

    await activePage.keyboard.press('Escape')
    const beforeCancel = await readState()
    await runTerminalCommand(activePage, 'mirror')
    assert(await activePage.evaluate(() => !window.editor.isInteracting && window.editor.selected.length === 0),
      'MIRROR without a preselection did not wait for selection.')
    await selectSource()
    await activePage.keyboard.press('Enter')
    await activePage.waitForFunction(() => window.editor.isInteracting)
    const circlePointer = await moveNear(95, 25)
    await assertSnap(95, 25)
    await activePage.mouse.click(circlePointer.x, circlePointer.y)
    await moveNear(50, 20)
    await assertSnap(50, 20)
    await assertAxis({ x: 95, y: 25 }, { x: 50, y: 20 })
    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !window.editor.isInteracting && !window.editor.selectSingleElement)
    const cancelled = await readState()
    assertClean(cancelled)
    assert(JSON.stringify(cancelled.lines) === JSON.stringify(beforeCancel.lines)
      && cancelled.history === beforeCancel.history && cancelled.revision === beforeCancel.revision,
    'Cancelling MIRROR changed permanent geometry, History, or the document revision.')

    const zoomDuringMirror = async deltaY => {
      const before = await activePage.evaluate(() => window.editor.svg.zoom())
      const pointer = await screenPoint(70, 45)
      await activePage.mouse.move(pointer.x, pointer.y)
      await activePage.mouse.wheel({ deltaY })
      await activePage.waitForFunction(previous => Math.abs(window.editor.svg.zoom() - previous) > 1e-6, {}, before)
      await activePage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    }
    const clickGeometry = async (x, y, id) => {
      const point = await screenPoint(x, y)
      await activePage.mouse.move(Math.round(point.x), Math.round(point.y))
      await activePage.waitForFunction(expected => window.editor.hoveredElements.some(element => element.node.id === expected), {}, id)
      await activePage.mouse.click(Math.round(point.x), Math.round(point.y))
    }
    await selectSource()
    await runTerminalCommand(activePage, 'mi')
    await zoomDuringMirror(-80)
    await assertIsolated('zoom before the first axis point')
    await clickGeometry(80, 60, '702')
    await assertIsolated('first axis point on another line')
    await zoomDuringMirror(80)
    await assertIsolated('zoom before the second axis point')
    await clickGeometry(103, 25, '703')
    await activePage.waitForFunction(() => window.editor.signals.inputValue.getNumListeners() > 0
      && window.editor.signals.pointCaptured.getNumListeners() === 0)
    await assertIsolated('second axis point on another circle')
    await zoomDuringMirror(-80)
    await assertIsolated('zoom during the source-deletion prompt')
    await clickGeometry(90, 60, '702')
    await assertIsolated('prompt click on another line')
    await clickGeometry(103, 25, '703')
    await assertIsolated('prompt click on another circle')
    await activePage.screenshot({ path: join(artifactsDirectory, 'mirror-handlers-suppressed.png') })
    // Zoom changes the saved viewBox; capture the revision after those changes.
    const beforePromptCancel = await readState()
    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !window.editor.isInteracting && !window.editor.selectSingleElement)
    const promptCancelled = await readState()
    assertClean(promptCancelled)
    assert(JSON.stringify(promptCancelled.lines) === JSON.stringify(beforePromptCancel.lines)
      && promptCancelled.history === beforePromptCancel.history && promptCancelled.revision === beforePromptCancel.revision,
    'Cancelling the MIRROR source-deletion prompt changed the drawing.')

    await selectSource()
    const beforeInvalid = await readState()
    await runTerminalCommand(activePage, 'mi')
    const coincidentPointer = await moveNear(80, 60)
    await assertSnap(80, 60)
    await activePage.mouse.click(coincidentPointer.x, coincidentPointer.y)
    await assertIsolated('first snapped point before an invalid axis')
    await activePage.mouse.click(coincidentPointer.x, coincidentPointer.y)
    await waitForTerminalText(activePage, 'Mirror axis requires two different points.')
    await activePage.waitForFunction(() => !window.editor.isInteracting && !window.editor.selectSingleElement)
    const invalid = await readState()
    assertClean(invalid)
    assert(JSON.stringify(invalid.selected) === JSON.stringify(beforeInvalid.selected),
      'Cancelling a zero-length MIRROR axis selected the element under the same click.')
    assert(JSON.stringify(invalid.lines) === JSON.stringify(beforeInvalid.lines)
      && invalid.history === beforeInvalid.history && invalid.revision === beforeInvalid.revision,
    'An invalid MIRROR axis changed geometry, History, or the document revision.')
    await activePage.screenshot({ path: join(artifactsDirectory, 'mirror-invalid-axis-selection.png') })
    await clickGeometry(90, 60, '702')
    await activePage.waitForFunction(() => window.editor.selected.some(element => element.node.id === '702')
      && window.editor.handlers.node.childElementCount > 0)
    await activePage.keyboard.press('Escape')
    trace('mirror-snap', { original, placed, cancelled, promptCancelled, invalid })
  })

  await step('mirror a spline preview and preserve its fit points through Undo/Redo', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"
        data-nanquim-version="3" data-element-index="941" data-active-collection-id="mirror-spline">
        <g id="mirror-spline" data-collection="true" name="Mirror spline"
          style="stroke:#ffffff;stroke-width:.25;fill:none">
          <path id="940" name="Source spline"
            d="M 20 20 C 23.333333333333332 23.333333333333332, 26.666666666666668 30, 30 30 C 33.333333333333336 30, 36.666666666666664 23.333333333333332, 40 20"
            data-spline-data="{&quot;points&quot;:[{&quot;x&quot;:20,&quot;y&quot;:20},{&quot;x&quot;:30,&quot;y&quot;:30},{&quot;x&quot;:40,&quot;y&quot;:20}]}"/>
        </g></svg>`
      const result = await window.editor.documents.openFile(new File([source], 'mirror-spline.svg', { type: 'image/svg+xml' }))
      const editor = window.editor
      editor.isSnapping = false
      editor.gridSnap = false
      editor.polarTracking = false
      editor.ortho = false
      return result
    })
    assert(loaded?.ok, 'Could not initialize the MIRROR spline fixture.')

    const screenPoint = (x, y) => activePage.evaluate(point => {
      const editor = window.editor
      const screen = new DOMPoint(point.x, point.y).matrixTransform(editor.svg.node.getScreenCTM())
      const pointer = { x: Math.round(screen.x), y: Math.round(screen.y) }
      const world = editor.svg.point(pointer.x, pointer.y)
      return { pointer, world: { x: world.x, y: world.y } }
    }, { x, y })
    const readState = () => activePage.evaluate(() => {
      const editor = window.editor
      editor.documentState.flushObservedMutations()
      const splines = []
      editor.drawing.find('path').each((path) => {
        const data = path.data('splineData')
        if (!data) return
        const length = path.node.getTotalLength()
        const start = path.node.getPointAtLength(0)
        const end = path.node.getPointAtLength(length)
        splines.push({
          end: { x: end.x, y: end.y },
          id: path.attr('id') == null ? null : String(path.attr('id')),
          points: data.points,
          start: { x: start.x, y: start.y },
          transient: path.attr('data-nanquim-transient') === 'true',
        })
      })
      return {
        history: editor.history.undos.length,
        revision: editor.documentState.revision,
        splines,
      }
    })
    const sourcePoints = [{ x: 20, y: 20 }, { x: 30, y: 30 }, { x: 40, y: 20 }]
    const before = await readState()
    await activePage.evaluate(() => document.querySelector('[data-outliner-id="940"] .collection-name')?.click())
    await activePage.waitForFunction(() => window.editor.selected.some(element => element.node.id === '940'))
    await runTerminalCommand(activePage, 'mi')
    await activePage.waitForFunction(() => window.editor.isInteracting
      && window.editor.signals.pointCaptured.getNumListeners() > 0)
    const first = await screenPoint(50, 10)
    const second = await screenPoint(50, 60)
    await activePage.mouse.click(first.pointer.x, first.pointer.y)
    await activePage.waitForFunction(() => document.querySelector('.mirror-axis-helper')
      && window.editor.drawing.node.querySelector('path[data-nanquim-transient="true"]'))
    await activePage.mouse.move(second.pointer.x, second.pointer.y)
    const reflectedPoints = sourcePoints.map(point => ({
      x: 2 * first.world.x - point.x,
      y: point.y,
    }))
    await activePage.waitForFunction(expected => {
      let preview = null
      window.editor.drawing.find('[data-nanquim-transient="true"]').each((element) => {
        if (!preview && element.data('splineData')) preview = element
      })
      if (!preview) return false
      const points = preview.data('splineData').points
      const start = preview.node.getPointAtLength(0)
      const end = preview.node.getPointAtLength(preview.node.getTotalLength())
      return points.length === expected.length
        && points.every((point, index) => Math.abs(point.x - expected[index].x) < 1e-4
          && Math.abs(point.y - expected[index].y) < 1e-4)
        && Math.abs(start.x - expected[0].x) < 1e-4
        && Math.abs(end.x - expected.at(-1).x) < 1e-4
    }, {}, reflectedPoints)
    const previewState = await readState()
    const preview = previewState.splines.find(spline => spline.transient)
    assert(preview, 'MIRROR did not expose a reflected spline preview.')
    assertNear(preview.start.x, reflectedPoints[0].x, 1e-4, 'Mirrored spline preview start x')
    assertNear(preview.end.x, reflectedPoints.at(-1).x, 1e-4, 'Mirrored spline preview end x')
    assert(previewState.history === before.history && previewState.revision === before.revision,
      'MIRROR spline preview changed History or dirtied the document.')
    await activePage.screenshot({ path: join(artifactsDirectory, 'mirror-spline-preview.png') })

    await activePage.mouse.click(second.pointer.x, second.pointer.y)
    await typeTerminalValue(activePage, 'n')
    await activePage.waitForFunction(() => !window.editor.isInteracting
      && !window.editor.drawing.node.querySelector('[data-nanquim-transient="true"]'))
    const placed = await readState()
    const copy = placed.splines.find(spline => spline.id !== '940')
    assert(copy && placed.splines.length === 2, 'MIRROR did not commit one spline copy.')
    reflectedPoints.forEach((point, index) => {
      assertNear(copy.points[index].x, point.x, 1e-4, `Mirrored spline fit point ${index + 1} x`)
      assertNear(copy.points[index].y, point.y, 1e-4, `Mirrored spline fit point ${index + 1} y`)
    })
    assertNear(copy.start.x, reflectedPoints[0].x, 1e-4, 'Committed mirrored spline start x')
    assertNear(copy.end.x, reflectedPoints.at(-1).x, 1e-4, 'Committed mirrored spline end x')
    assert(placed.history === before.history + 1 && placed.revision === before.revision + 1,
      'MIRROR spline did not commit one document mutation.')

    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    const undone = await readState()
    assert(undone.splines.length === 1 && undone.splines[0].id === '940',
      'Undo did not remove the mirrored spline copy.')
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    const redone = await readState()
    const redoneCopy = redone.splines.find(spline => spline.id !== '940')
    assert(redoneCopy && Math.abs(redoneCopy.start.x - copy.start.x) < 1e-4
      && Math.abs(redoneCopy.end.x - copy.end.x) < 1e-4,
    'Redo changed the mirrored spline geometry.')
    trace('mirror-spline', { before, previewState, placed, undone, redone })
  })

  await step('keep the MIRROR axis thin and readable across zoom levels and themes', async () => {
    const previous = await activePage.evaluate(() => ({ preferences: localStorage.getItem('nanquim-preferences'),
      nonScaling: window.editor.svg.node.classList.contains('non-scaling-stroke') }))
    try {
      for (const light of [false, true]) {
        const width = browserName === 'chromium' && light ? 720 : BROWSER_VIEWPORT.width
        if (browserName === 'chromium') await activePage.setViewport({ ...BROWSER_VIEWPORT, width })
        let nearScale
        for (const span of [8, 80]) {
          const loaded = await activePage.evaluate(async ({ light, span }) => {
            window.openPreferences()
            const background = document.getElementById('prefs-background-color')
            background.value = light ? '#f3f1ea' : '#20252a'
            background.dispatchEvent(new Event('input', { bubbles: true }))
            document.querySelector('.prefs-btn-save').click()
            const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span * .75}"
              data-nanquim-version="3" data-element-index="810" data-active-collection-id="mirror-style">
              <g id="mirror-style" data-collection="true" name="Mirror styles" style="stroke:#999999;stroke-width:.003;fill:none">
                <rect id="801" x="1" y="1" width="1" height="1" style="stroke:#999999;stroke-width:.003;fill:none"/>
                <circle id="802" cx="2.75" cy="1.5" r=".35" style="stroke:#999999;stroke-width:.003;fill:none"/>
              </g></svg>`
            const result = await window.editor.documents.openFile(new File([source], 'mirror-style.svg', { type: 'image/svg+xml' }))
            const editor = window.editor
            editor.isSnapping = false
            editor.gridSnap = false
            editor.polarTracking = false
            editor.ortho = false
            editor.svg.node.classList.remove('non-scaling-stroke')
            return result
          }, { light, span })
          assert(loaded?.ok, 'Could not load the MIRROR helper appearance fixture.')
          await activePage.click('[data-outliner-id="802"] .collection-name')
          // M belongs to the Outliner while the pointer is over its rows.
          await activePage.mouse.move(60, 80)
          await runTerminalCommand(activePage, 'mi')
          const points = await activePage.evaluate(() => [3, 6].map(x => {
            const point = new DOMPoint(x, 3).matrixTransform(window.editor.svg.node.getScreenCTM())
            return { x: Math.round(point.x), y: Math.round(point.y) }
          }))
          await activePage.mouse.click(points[0].x, points[0].y)
          await activePage.mouse.move(points[1].x, points[1].y)
          await activePage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
          const appearance = await activePage.evaluate(() => {
            const axis = document.querySelector('.mirror-axis-helper')
            if (!axis) return null
            const style = getComputedStyle(axis)
            const transform = axis.getScreenCTM()
            return { stroke: style.stroke, strokeWidth: parseFloat(style.strokeWidth), effect: style.vectorEffect,
              dashes: style.strokeDasharray.split(/[ ,]+/).map(parseFloat), pointerEvents: style.pointerEvents,
              opacity: Number(style.opacity), scale: Math.hypot(transform.a, transform.b),
              bounds: axis.getBoundingClientRect().toJSON() }
          })
          assert(appearance?.effect === 'non-scaling-stroke', 'The MIRROR axis stroke scales with drawing zoom.')
          assertNear(appearance.strokeWidth, 1.5, 1e-6, 'MIRROR helper screen stroke width')
          if (span === 8) nearScale = appearance.scale
          else assertNear(nearScale / appearance.scale, 10, 1e-5, 'MIRROR helper test zoom range')
          assert(JSON.stringify(appearance.dashes) === '[6,4]', 'MIRROR helper dashes do not use screen-space lengths.')
          assert(appearance.opacity > 0 && appearance.stroke !== 'none' && appearance.pointerEvents === 'none'
            && appearance.bounds.width > 10, 'The MIRROR axis is hidden or intercepts drawing input.')
          await activePage.screenshot({ path: join(artifactsDirectory, `mirror-axis-${width}-${light ? 'light' : 'dark'}-${span}.png`) })
          trace('mirror-axis-appearance', { width, light, span, ...appearance })
          await activePage.keyboard.press('Escape')
          await activePage.waitForFunction(() => !document.querySelector('.mirror-axis-helper') && !window.editor.isInteracting)
        }
      }
    } finally {
      if (browserName === 'chromium') await activePage.setViewport(BROWSER_VIEWPORT)
      await activePage.evaluate(previous => {
        window.editor.svg.node.classList.toggle('non-scaling-stroke', previous.nonScaling)
        if (previous.preferences === null) localStorage.removeItem('nanquim-preferences')
        else localStorage.setItem('nanquim-preferences', previous.preferences)
      }, previous)
    }
  })
}

async function runTrimBoundarySelectionWorkflows(activePage) {
  await step('box-select TRIM boundaries, trim with Undo/Redo, and cancel unfinished selection boxes', async () => {
    const loaded = await activePage.evaluate(async () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"
        data-nanquim-version="3" data-element-index="870" data-active-collection-id="trim-box">
        <g id="trim-box" data-collection="true" name="Trim boundaries" style="stroke:#aaaaaa;stroke-width:.2;fill:none">
          <line id="861" x1="40" y1="20" x2="40" y2="80"/>
          <line id="862" x1="80" y1="20" x2="80" y2="80"/>
          <line id="863" x1="10" y1="50" x2="110" y2="50"/>
        </g></svg>`
      const result = await window.editor.documents.openFile(new File([source], 'trim-box.svg', { type: 'image/svg+xml' }))
      const editor = window.editor
      editor.isSnapping = false
      editor.gridSnap = false
      editor.polarTracking = false
      editor.ortho = false
      return result
    })
    assert(loaded?.ok, 'Could not load the TRIM boundary selection fixture.')
    const screenPoint = (x, y) => activePage.evaluate(point => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(window.editor.svg.node.getScreenCTM())
      return { x: Math.round(screen.x), y: Math.round(screen.y) }
    }, { x, y })
    const readState = () => activePage.evaluate(() => {
      const editor = window.editor
      editor.documentState.flushObservedMutations()
      return { lines: [...editor.drawing.node.querySelectorAll('line')].map(node => ({
        id: node.id, parent: node.parentElement.id,
        points: ['x1', 'y1', 'x2', 'y2'].map(name => Number(node.getAttribute(name))),
      })), history: editor.history.undos.length, revision: editor.documentState.revision }
    })
    const assertBoundaries = async ids => activePage.waitForFunction(expected => {
      const selected = [...document.querySelectorAll('#trim-box > .elementSelected')].map(node => node.id).sort()
      return JSON.stringify(selected) === JSON.stringify(expected)
    }, {}, [...ids].sort())
    const selectOneBoundary = async () => {
      const point = await screenPoint(40, 35)
      await activePage.mouse.move(point.x, point.y)
      await activePage.waitForFunction(() => window.editor.hoveredElements.some(element => element.node.id === '861'))
      await activePage.mouse.click(point.x, point.y)
      await assertBoundaries(['861'])
    }
    const beginBox = async (crossing = false) => {
      const start = await screenPoint(crossing ? 85 : 35, crossing ? 25 : 15)
      const end = await screenPoint(crossing ? 35 : 85, crossing ? 30 : 85)
      await activePage.mouse.move(start.x, start.y)
      await activePage.waitForFunction(() => window.editor.hoveredElements.length === 0)
      // Viewport's rectangle tool uses two corner clicks and a moving preview.
      await activePage.mouse.click(start.x, start.y)
      await activePage.waitForSelector('.selectionRectangle')
      await activePage.mouse.move(end.x, end.y, { steps: 5 })
      await activePage.waitForFunction(expected => {
        const rectangle = document.querySelector('.selectionRectangle')
        const bounds = rectangle?.getBoundingClientRect()
        return bounds?.width > 0 && bounds.height > 0
          && rectangle.classList.contains('selectionRectangleRight') === expected
      }, {}, crossing)
      const visible = await activePage.$eval('.selectionRectangle', rectangle => {
        const style = getComputedStyle(rectangle)
        return style.display !== 'none' && style.visibility === 'visible'
          && style.stroke !== 'none' && Number.parseFloat(style.strokeWidth) > 0
      })
      assert(visible, 'TRIM boundary selection has no visible rectangle outline.')
      return end
    }
    const finishBox = async end => {
      await activePage.mouse.click(end.x, end.y)
      await activePage.waitForFunction(() => !document.querySelector('.selectionRectangle')
        && !window.editor.isSelecting && !window.editor.isDrawing)
      await assertBoundaries(['861', '862'])
    }
    const waitClean = async () => activePage.waitForFunction(() => {
      const editor = window.editor
      return !editor.isInteracting && !editor.isSelecting && !editor.isDrawing && !editor.selectSingleElement
        && !editor.suppressPolarTracking && !document.querySelector('.selectionRectangle')
        && !editor.svg.node.querySelector('.ghostLine') && !document.querySelector('#trim-box > .elementSelected')
    })
    const historyTravel = async redo => {
      await activePage.keyboard.down(controlKey())
      if (redo) await activePage.keyboard.down('Shift')
      await activePage.keyboard.press('KeyZ')
      if (redo) await activePage.keyboard.up('Shift')
      await activePage.keyboard.up(controlKey())
    }

    for (const crossing of [false, true]) {
      const before = await readState()
      await runTerminalCommand(activePage, 'tr')
      await selectOneBoundary()
      const end = await beginBox(crossing)
      await activePage.screenshot({ path: join(artifactsDirectory, `trim-boundary-${crossing ? 'crossing' : 'window'}.png`) })
      await finishBox(end)
      // Repeating a box adds its contents; it does not toggle prior boundaries.
      await finishBox(await beginBox(crossing))
      assert(JSON.stringify(await readState()) === JSON.stringify(before),
        'Selecting TRIM boundaries changed geometry, History, or the document revision.')
      const logLength = await activePage.$eval('#terminalLog', log => log.textContent.length)
      await activePage.keyboard.press('Enter')
      await activePage.waitForFunction(length => document.getElementById('terminalLog').textContent.slice(length)
        .includes('Selected 2 boundary elements.'), {}, logLength)
      await assertBoundaries([])
      const target = await screenPoint(25, 50)
      await activePage.mouse.move(target.x, target.y)
      await activePage.waitForFunction(() => window.editor.hoveredElements.some(element => element.node.id === '863'))
      await activePage.mouse.move(target.x + 1, target.y)
      await activePage.waitForFunction(() => [...window.editor.svg.node.querySelectorAll('line.ghostLine')]
        .some(node => getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0))
      await activePage.mouse.click(target.x + 1, target.y)
      await activePage.waitForFunction(() => Number(document.getElementById('863').getAttribute('x1')) === 40)
      await activePage.keyboard.press('Escape')
      await waitClean()
      const trimmed = await readState()
      assert(trimmed.history === before.history + 1 && trimmed.lines.length === 3,
        'TRIM did not record exactly one shortening operation.')
      assert(JSON.stringify(trimmed.lines.find(line => line.id === '863').points) === '[40,50,110,50]',
        'TRIM did not shorten the target to the selected cutting boundary.')
      assert(JSON.stringify(trimmed.lines.filter(line => line.id !== '863'))
        === JSON.stringify(before.lines.filter(line => line.id !== '863')), 'TRIM modified its cutting boundaries.')
      await historyTravel(false)
      assert(JSON.stringify((await readState()).lines) === JSON.stringify(before.lines), 'Undo did not restore the TRIM target.')
      await historyTravel(true)
      assert(JSON.stringify((await readState()).lines) === JSON.stringify(trimmed.lines), 'Redo changed the TRIM result.')
      await historyTravel(false)
      trace('trim-boundary-box', { crossing, before, trimmed })
    }

    for (const exit of ['Escape', 'right-click', 'Enter']) {
      const before = await readState()
      await runTerminalCommand(activePage, 'trim')
      await selectOneBoundary()
      const end = await beginBox()
      if (exit === 'right-click') await activePage.mouse.click(end.x, end.y, { button: 'right' })
      else await activePage.keyboard.press(exit)
      if (exit === 'Enter') {
        await activePage.waitForFunction(() => !document.querySelector('.selectionRectangle')
          && !window.editor.isSelecting && !window.editor.isDrawing && window.editor.isInteracting)
        await assertBoundaries([])
      } else await waitClean()
      // A removed draw-plugin element must not keep a mousemove listener alive.
      const empty = await screenPoint(15, 15)
      await activePage.mouse.move(empty.x, empty.y)
      if (exit === 'Enter') {
        await activePage.keyboard.press('Escape')
        await waitClean()
      }
      assert(JSON.stringify(await readState()) === JSON.stringify(before), `${exit} from an unfinished TRIM box changed the document.`)
      // Restart immediately to expose stale click.draw handlers as well.
      await runTerminalCommand(activePage, 'tr')
      await finishBox(await beginBox(true))
      await activePage.keyboard.press('Escape')
      await waitClean()
    }
  })
}

async function runCopySnapWorkflows(activePage) {
  await step('snap a newly drawn line immediately after starting COPY with a preselection', async () => {
    const initialized = await activePage.evaluate(async () => {
      const editor = window.editor
      const result = await editor.documents.newDocument()
      editor.isSnapping = false
      editor.gridSnap = false
      editor.polarTracking = false
      editor.ortho = false
      for (const type of Object.keys(editor.snapTypes)) editor.snapTypes[type] = type === 'endpoint'
      return result
    })
    assert(initialized?.ok, 'Could not create an empty drawing for the COPY regression.')
    await activePage.keyboard.press('Escape')

    // Build the source and target through the same LINE pointer workflow as a
    // user, retaining the exact coordinates generated by the drawing plugin.
    for (const [x1, y1, x2, y2] of [[0.32, 0.35, 0.48, 0.35], [0.58, 0.55, 0.74, 0.55]]) {
      await runTerminalCommand(activePage, 'l')
      const start = await canvasScreenPoint(activePage, x1, y1)
      const end = await canvasScreenPoint(activePage, x2, y2)
      await activePage.mouse.click(start.x, start.y)
      await activePage.mouse.move(end.x, end.y)
      await activePage.mouse.click(end.x, end.y)
      await activePage.keyboard.press('Escape')
    }
    const readLines = async () => activePage.evaluate(() => Array.from(
      window.editor.drawing.node.querySelectorAll('line:not([data-nanquim-transient])'),
      node => ({ id: node.id, x1: node.x1.baseVal.value, y1: node.y1.baseVal.value,
        x2: node.x2.baseVal.value, y2: node.y2.baseVal.value }),
    ))
    const original = await readLines()
    assert(original.length === 2, 'The LINE workflow did not create both permanent lines.')
    const [source, target] = original
    const screenPoint = async (x, y) => activePage.evaluate(point => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(window.editor.svg.node.getScreenCTM())
      return { x: screen.x, y: screen.y }
    }, { x, y })
    const moveNear = async (x, y) => {
      const point = await screenPoint(x, y)
      const pointer = { x: point.x + 6, y: point.y + 4 }
      await activePage.mouse.move(pointer.x, pointer.y)
      return pointer
    }
    const assertSnap = async (x, y, preview = false) => {
      await activePage.waitForFunction(point => {
        const editor = window.editor
        const marker = document.querySelector('#Snap > *')
        return editor.isInteracting && marker && marker.getBoundingClientRect().width > 0
          && Math.abs(editor.snapPoint?.x - point.x) < 1e-5
          && Math.abs(editor.snapPoint?.y - point.y) < 1e-5
      }, {}, { x, y })
      if (!preview) return
      const ghostStart = await activePage.evaluate(() => {
        const node = Array.from(window.editor.ghostNodes || [])[0]
        if (!node) return null
        const transform = window.editor.svg.node.getScreenCTM().inverse().multiply(node.getScreenCTM())
        const point = new DOMPoint(node.x1.baseVal.value, node.y1.baseVal.value).matrixTransform(transform)
        return { x: point.x, y: point.y }
      })
      assert(ghostStart, 'COPY did not create its preview from the drawn line.')
      assertNear(ghostStart.x, x, 1e-5, 'Drawn-line COPY preview x')
      assertNear(ghostStart.y, y, 1e-5, 'Drawn-line COPY preview y')
    }
    const midpoint = await screenPoint((source.x1 + source.x2) / 2, (source.y1 + source.y2) / 2)
    await activePage.mouse.move(midpoint.x, midpoint.y)
    await activePage.waitForFunction(id => window.editor.hoveredElements.some(element => element.node.id === id), {}, source.id)
    await activePage.mouse.click(midpoint.x, midpoint.y)
    await activePage.waitForFunction(id => window.editor.selected.some(element => element.node.id === id), {}, source.id)
    const historyDepth = await activePage.evaluate(() => window.editor.history.undos.length)
    await runTerminalCommand(activePage, 'co')
    // A preselection must enter base-point capture immediately, without a
    // second Enter that would mask the previously broken entry path.
    await activePage.waitForFunction(() => window.editor.isInteracting && !window.editor.ghostNodes?.size)
    await moveNear(source.x1, source.y1)
    await activePage.keyboard.press('F9')
    await assertSnap(source.x1, source.y1)
    await moveNear(target.x1, target.y1)
    await assertSnap(target.x1, target.y1)
    const base = await moveNear(source.x1, source.y1)
    await assertSnap(source.x1, source.y1)
    await activePage.mouse.click(base.x, base.y)
    await moveNear(source.x2, source.y2)
    await assertSnap(source.x2, source.y2, true)
    await activePage.click('#object-snap-toggle')
    await activePage.waitForFunction(() => !window.editor.isSnapping && !window.editor.snapPoint)
    await activePage.click('#object-snap-toggle')
    const destination = await moveNear(target.x1, target.y1)
    await assertSnap(target.x1, target.y1, true)
    await activePage.mouse.click(destination.x, destination.y)
    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !window.editor.isInteracting && !window.editor.ghostNodes?.size)
    const placed = await readLines()
    assert(placed.length === 3, 'COPY did not place exactly one copy of the drawn line.')
    const copy = placed.find(line => !original.some(originalLine => originalLine.id === line.id))
    assertNear(copy.x1, target.x1, 1e-5, 'Drawn-line COPY snapped start x')
    assertNear(copy.y1, target.y1, 1e-5, 'Drawn-line COPY snapped start y')
    assertNear(copy.x2, target.x1 + source.x2 - source.x1, 1e-5, 'Drawn-line COPY end x')
    assertNear(copy.y2, target.y1 + source.y2 - source.y1, 1e-5, 'Drawn-line COPY end y')
    assert(await activePage.evaluate(() => window.editor.history.undos.length) === historyDepth + 1,
      'COPY did not create one History entry after drawing the line.')
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    assert(JSON.stringify(await readLines()) === JSON.stringify(original), 'Undo did not restore the two drawn lines.')
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    assert(JSON.stringify(await readLines()) === JSON.stringify(placed), 'Redo changed the snapped copy of the drawn line.')
    trace('copy-drawn-line-snap', { original, placed })
  })

  await step('snap COPY base points, previews, and repeated placements with Undo/Redo', async () => {
    const loaded = await activePage.evaluate(async () => {
      const raster = document.createElement('canvas')
      raster.width = 2
      raster.height = 2
      raster.getContext('2d').fillRect(0, 0, 2, 2)
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 90"
        data-nanquim-version="3" data-element-index="610" data-active-collection-id="browser-copy-collection">
        <g id="browser-copy-collection" data-collection="true" name="Copy collection"
          style="stroke:#ffffff;stroke-width:0.2;fill:none">
          <line id="601" x1="20" y1="20" x2="50" y2="20"/>
          <line id="602" x1="80" y1="45" x2="110" y2="45"/>
          <image id="603" x="70" y="60" width="40" height="20"
            clip-path="inset(10% 20% 25% 15%) fill-box" transform="rotate(-12 90 70)"
            href="${raster.toDataURL('image/png')}"/>
        </g>
      </svg>`
      const result = await window.editor.documents.openFile(new File([source], 'browser-copy.svg', { type: 'image/svg+xml' }))
      const editor = window.editor
      editor.isSnapping = false
      editor.gridSnap = false
      editor.polarTracking = false
      editor.ortho = false
      for (const type of Object.keys(editor.snapTypes)) editor.snapTypes[type] = type === 'endpoint'
      return result
    })
    assert(loaded?.ok, 'Could not initialize the COPY snap fixture.')
    await activePage.keyboard.press('Escape')

    const screenPoint = async (x, y) => activePage.evaluate(point => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(window.editor.svg.node.getScreenCTM())
      return { x: screen.x, y: screen.y }
    }, { x, y })
    const selectSource = async () => {
      const middle = await screenPoint(35, 20)
      await activePage.mouse.move(middle.x, middle.y)
      await activePage.waitForFunction(() => window.editor.hoveredElements?.some(element => element.node.id === '601'))
      await activePage.mouse.click(middle.x, middle.y)
      await activePage.waitForFunction(() => window.editor.selected.some(element => element.node.id === '601'))
    }
    const moveNear = async (x, y) => {
      const screen = await screenPoint(x, y)
      // Offset the pointer so a raw-coordinate preview or placement cannot pass.
      const pointer = { x: screen.x + 6, y: screen.y + 4 }
      await activePage.mouse.move(pointer.x, pointer.y)
      await activePage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      return pointer
    }
    const assertSnap = async (x, y, preview = false, tolerance = 1e-6) => {
      await activePage.waitForFunction(point => {
        const marker = document.querySelector('#Snap > *')
        if (!marker) return false
        const bounds = marker.getBoundingClientRect()
        const style = getComputedStyle(marker)
        return Math.abs(window.editor.snapPoint?.x - point.x) < point.tolerance
          && Math.abs(window.editor.snapPoint?.y - point.y) < point.tolerance
          && bounds.width > 0 && bounds.height > 0
          && style.visibility === 'visible' && style.display !== 'none'
          && style.stroke !== 'none' && Number.parseFloat(style.strokeWidth) > 0
      }, {}, { x, y, tolerance })
      if (preview) {
        const ghost = await activePage.evaluate(() => {
          const node = Array.from(window.editor.ghostNodes || [])[0]
          if (!node) return null
          const transform = window.editor.svg.node.getScreenCTM().inverse().multiply(node.getScreenCTM())
          const start = new DOMPoint(node.x1.baseVal.value, node.y1.baseVal.value).matrixTransform(transform)
          return { x: start.x, y: start.y }
        })
        assert(ghost, 'COPY did not expose its moving preview.')
        assertNear(ghost.x, x, 1e-5, 'COPY snapped preview x coordinate')
        assertNear(ghost.y, y, 1e-5, 'COPY snapped preview y coordinate')
      }
    }
    const nearSnap = async (x, y, preview = false, tolerance = 1e-6) => {
      const pointer = await moveNear(x, y)
      await assertSnap(x, y, preview, tolerance)
      return pointer
    }
    const assertSnapOff = async () => activePage.waitForFunction(() => (
      !window.editor.isSnapping && !window.editor.snapPoint
      && document.querySelector('#Snap')?.childElementCount === 0
    ))
    const copyState = async () => activePage.evaluate(() => ({
      copies: Array.from(window.editor.drawing.node.querySelectorAll('line')).filter(node => !['601', '602'].includes(node.id)).map(node => ({
        x1: node.x1.baseVal.value, y1: node.y1.baseVal.value,
        x2: node.x2.baseVal.value, y2: node.y2.baseVal.value,
      })),
      historyDepth: window.editor.history.undos.length,
      interacting: window.editor.isInteracting,
      suppressed: window.editor.suppressHandlers,
      single: window.editor.selectSingleElement,
      ghosts: window.editor.ghostNodes?.size || 0,
      transient: window.editor.drawing.node.querySelectorAll('[data-nanquim-transient]').length,
    }))

    await selectSource()
    const original = await copyState()
    await runTerminalCommand(activePage, 'co')
    await activePage.waitForFunction(() => window.editor.isInteracting && !window.editor.ghostNodes?.size)
    const base = await moveNear(20, 20)
    await assertSnapOff()
    // F9 must update the active point immediately, without another mousemove.
    await activePage.keyboard.press('F9')
    await assertSnap(20, 20)
    await activePage.mouse.click(base.x, base.y)
    await activePage.waitForFunction(() => window.editor.ghostNodes?.size === 1)
    for (const [index, x, y] of [[0, 80, 45], [1, 50, 20]]) {
      await activePage.keyboard.press('F9')
      await assertSnapOff()
      let destination = await moveNear(x, y)
      if (index === 0) {
        // Native keyboard activation keeps the pointer on the destination.
        await activePage.focus('#object-snap-toggle')
        await activePage.keyboard.press(' ')
        await assertSnap(x, y, true)
      } else {
        // Mouse activation must preserve the command when returning to canvas.
        await activePage.click('#object-snap-toggle')
        destination = await nearSnap(x, y, true)
      }
      await activePage.mouse.click(destination.x, destination.y)
      await activePage.waitForFunction(() => window.editor.signals.pointCaptured.getNumListeners() > 0)
    }
    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !window.editor.isInteracting && !window.editor.selectSingleElement)
    const placed = await copyState()
    assert(placed.historyDepth === original.historyDepth + 1, 'COPY did not commit its placements in a single History entry.')
    assert(placed.copies.length === 2, 'COPY did not preserve both snapped placements.')
    for (const [index, x, y] of [[0, 80, 45], [1, 50, 20]]) {
      assertNear(placed.copies[index].x1, x, 1e-5, 'COPY placed start x coordinate')
      assertNear(placed.copies[index].y1, y, 1e-5, 'COPY placed start y coordinate')
      assertNear(placed.copies[index].x2, x + 30, 1e-5, 'COPY placed end x coordinate')
      assertNear(placed.copies[index].y2, y, 1e-5, 'COPY placed end y coordinate')
    }
    assert(!placed.interacting && !placed.suppressed && !placed.single && !placed.ghosts && !placed.transient,
      'Finishing COPY left previews or interaction state active.')
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    const undone = await copyState()
    assert(undone.copies.length === 0, 'Undo did not remove the whole COPY batch.')
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.down('Shift')
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up('Shift')
    await activePage.keyboard.up(controlKey())
    const redone = await copyState()
    assert(JSON.stringify(redone.copies) === JSON.stringify(placed.copies), 'Redo changed the snapped COPY placements.')

    await activePage.keyboard.press('Escape')
    await selectSource()
    await runTerminalCommand(activePage, 'co')
    await activePage.waitForFunction(() => window.editor.isInteracting && !window.editor.ghostNodes?.size)
    const cancelBase = await nearSnap(20, 20)
    await activePage.mouse.click(cancelBase.x, cancelBase.y)
    await nearSnap(80, 45, true)
    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !window.editor.isInteracting && !window.editor.selectSingleElement)
    const cancelled = await copyState()
    assert(JSON.stringify(cancelled.copies) === JSON.stringify(placed.copies), 'Cancelling COPY left an unplaced copy.')
    assert(cancelled.historyDepth === placed.historyDepth && !cancelled.ghosts && !cancelled.transient && !cancelled.suppressed,
      'Cancelling COPY changed History or left interaction helpers.')

    // Imported images expose their visible crop boundary in world coordinates.
    await selectSource()
    await runTerminalCommand(activePage, 'co')
    await activePage.waitForFunction(() => window.editor.isInteracting && !window.editor.ghostNodes?.size)
    const imageBase = await nearSnap(20, 20)
    await activePage.mouse.click(imageBase.x, imageBase.y)
    const imageTargets = []
    for (const [type, localX, localY] of [['endpoint', 76, 62], ['midpoint', 89, 62], ['center', 89, 68.5]]) {
      const target = await activePage.evaluate(({ type, localX, localY }) => {
        const editor = window.editor
        for (const name of Object.keys(editor.snapTypes)) editor.snapTypes[name] = name === type
        const image = document.getElementById('603')
        const transform = editor.svg.node.getScreenCTM().inverse().multiply(image.getScreenCTM())
        const point = new DOMPoint(localX, localY).matrixTransform(transform)
        return { x: point.x, y: point.y }
      }, { type, localX, localY })
      // Firefox's SVGMatrix arithmetic rounds the transformed target by ~2e-6.
      const destination = await nearSnap(target.x, target.y, true, 1e-5)
      await activePage.mouse.click(destination.x, destination.y)
      imageTargets.push(target)
    }
    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => !window.editor.isInteracting && !window.editor.selectSingleElement)
    const imagePlacements = await copyState()
    assert(imagePlacements.copies.length === placed.copies.length + 3, 'COPY did not place all image snap targets.')
    assert(imagePlacements.historyDepth === placed.historyDepth + 1, 'Image snap placements did not form a single COPY batch.')
    imageTargets.forEach((target, index) => {
      const copy = imagePlacements.copies[placed.copies.length + index]
      assertNear(copy.x1, target.x, 1e-5, 'COPY image snap start x coordinate')
      assertNear(copy.y1, target.y, 1e-5, 'COPY image snap start y coordinate')
    })
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    assert(JSON.stringify((await copyState()).copies) === JSON.stringify(placed.copies), 'Undo did not remove the COPY image snap batch.')
    trace('copy-snap', { placed, undone, redone, cancelled, imagePlacements, imageTargets })
  })
}

async function runOutlinerReorderWorkflows(activePage) {
  await step('reorganize Outliner elements, groups, and collections with Undo/Redo', async () => {
    const widths = browserName === 'chromium' ? [BROWSER_VIEWPORT.width, 720] : [BROWSER_VIEWPORT.width]
    const originalPreferences = await activePage.evaluate(() => localStorage.getItem('nanquim-preferences'))
    try {
      for (const width of widths) {
        if (width !== BROWSER_VIEWPORT.width) await activePage.setViewport({ ...BROWSER_VIEWPORT, width })
        await activePage.evaluate(light => {
          window.openPreferences()
          const background = document.getElementById('prefs-background-color')
          background.value = light ? '#f3f1ea' : '#20252a'
          background.dispatchEvent(new Event('input', { bubbles: true }))
          const accent = document.getElementById('prefs-accent-color')
          accent.value = light ? '#3456a1' : '#62a7e8'
          accent.dispatchEvent(new Event('input', { bubbles: true }))
          document.querySelector('.prefs-btn-save').click()
        }, width === 720)
        const loaded = await activePage.evaluate(async () => {
          const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"
            data-nanquim-version="3" data-element-index="110" data-active-collection-id="browser-tree-a">
            <g id="browser-tree-a" data-collection="true" name="First collection" transform="translate(5 5)"
              style="stroke:#ffffff;stroke-width:0.2;fill:none">
              <rect id="101" name="First rectangle" x="10" y="15" width="12" height="8" data-description="Keep this metadata"/>
              <rect id="102" name="Second rectangle" x="40" y="15" width="12" height="8"/>
              <g id="103" name="Outer group" data-group="true">
                <g id="104" name="Inner group" data-group="true">
                  <circle id="105" cx="20" cy="45" r="4"/>
                </g>
              </g>
            </g>
            <g id="browser-tree-b" data-collection="true" name="Second collection"
              transform="matrix(1.2 .15 -.1 .8 70 10)" style="stroke:#ff8833;stroke-width:0.2;fill:none">
              <rect id="106" name="Third rectangle" x="10" y="15" width="12" height="8"/>
              <g id="107" name="Locked group" data-group="true" data-locked="true"/>
            </g>
          </svg>`
          return window.editor.documents.openFile(new File([source], 'browser-outliner.svg', { type: 'image/svg+xml' }))
        })
        assert(loaded?.ok, 'Could not load the Outliner reorganization fixture.')
        await activePage.waitForSelector('[data-outliner-id="101"][draggable="true"]')

        const initial = await outlinerTreeState(activePage)
        await dropOutlinerRow(activePage, '102', '101', 'before')
        const reordered = await outlinerTreeState(activePage)
        assert(reordered.children['browser-tree-a'].join(',') === '102,101,103',
          'Dropping before a sibling did not change its SVG paint order.')
        assert(reordered.historyDepth === initial.historyDepth + 1, 'Sibling reordering did not create exactly one history entry.')
        await undoRedoOutlinerDrop(activePage, initial, reordered)

        const beforeMove = await outlinerTreeState(activePage)
        await dropOutlinerRow(activePage, '101', 'browser-tree-b', 'inside')
        const moved = await outlinerTreeState(activePage)
        assert(moved.elementParent === 'browser-tree-b', 'The Outliner did not move the element into the destination collection.')
        assert(moved.metadata === beforeMove.metadata, 'Moving between collections lost element metadata.')
        assert(moved.stroke === 'rgb(255, 136, 51)', 'Moving between collections did not adopt the destination collection style.')
        for (const key of ['x', 'y', 'width', 'height']) {
          assertNear(moved.bounds[key], beforeMove.bounds[key], 1e-4, `Reparented element drawing ${key}`)
        }
        assert(moved.historyDepth === beforeMove.historyDepth + 1, 'Moving between collections did not create exactly one history entry.')
        await undoRedoOutlinerDrop(activePage, beforeMove, moved)

        const beforeNest = await outlinerTreeState(activePage)
        await dropOutlinerRow(activePage, '102', '104', 'inside')
        const nested = await outlinerTreeState(activePage)
        assert(nested.children['104'].includes('102'), 'An element could not be nested inside an ordinary group.')
        await undoRedoOutlinerDrop(activePage, beforeNest, nested)

        const beforeCollections = await outlinerTreeState(activePage)
        await dropOutlinerRow(activePage, 'browser-tree-b', 'browser-tree-a', 'before')
        const collections = await outlinerTreeState(activePage)
        assert(collections.collections.join(',') === 'browser-tree-b,browser-tree-a', 'Outliner collection reordering did not update drawing order.')
        assert(collections.activeCollection === beforeCollections.activeCollection, 'Reordering collections changed the active drawing destination.')
        await undoRedoOutlinerDrop(activePage, beforeCollections, collections)

        if (browserName === 'chromium') {
          const beforePointer = await outlinerTreeState(activePage)
          await dragOutlinerWithMouse(activePage, '106', '101')
          const pointerMoved = await outlinerTreeState(activePage)
          assert(pointerMoved.children['browser-tree-b'].join(',') === '107,101,106',
            'A real mouse drag did not reorder the Outliner rows.')
          assert(pointerMoved.historyDepth === beforePointer.historyDepth + 1, 'A real mouse drag did not enter History once.')
          await undoRedoOutlinerDrop(activePage, beforePointer, pointerMoved)
        }

        const beforeKeyboard = await outlinerTreeState(activePage)
        await activePage.focus('[data-outliner-id="101"] .outliner-move-handle')
        await activePage.keyboard.press('Enter')
        await activePage.waitForSelector('[data-outliner-id="101"].outliner-drag-source')
        // Move down to the following collection with keyboard-only focus navigation.
        if (browserName === 'chromium') await activePage.keyboard.press('ArrowDown')
        await activePage.keyboard.press('ArrowDown')
        await activePage.keyboard.press('ArrowRight')
        await activePage.waitForSelector('[data-outliner-id="browser-tree-a"].outliner-drop-inside')
        trace('outliner-keyboard-before-drop', await outlinerInteractionState(activePage))
        await activePage.keyboard.press('Enter')
        trace('outliner-keyboard-after-drop', await outlinerInteractionState(activePage))
        await activePage.waitForFunction(() => document.getElementById('101').parentElement.id === 'browser-tree-a')
        const keyboardMoved = await outlinerTreeState(activePage)
        assert(keyboardMoved.elementParent === 'browser-tree-a', 'The keyboard move handle could not move into a collection.')
        assert(keyboardMoved.historyDepth === beforeKeyboard.historyDepth + 1, 'A keyboard move did not enter History once.')
        const restoredFocus = await activePage.evaluate(() => document.activeElement?.closest('[data-outliner-id]')?.dataset.outlinerId)
        assert(restoredFocus === '101', 'A keyboard Outliner move did not restore focus to its moved element.')
        await undoRedoOutlinerDrop(activePage, beforeKeyboard, keyboardMoved)

        for (const [source, target] of [['103', '104'], ['101', '107']]) {
          const beforeRejected = await outlinerTreeState(activePage)
          await dropOutlinerRow(activePage, source, target, 'inside', { accepted: false })
          const rejected = await outlinerTreeState(activePage)
          assertOutlinerState(beforeRejected, rejected)
          assert(rejected.revision === beforeRejected.revision, 'A rejected Outliner drop changed the document revision.')
        }

        const beforeCancel = await outlinerTreeState(activePage)
        await startOutlinerDrag(activePage, '101', 'browser-tree-b', 'inside')
        await activePage.keyboard.press('Escape')
        await finishOutlinerDrag(activePage, { drop: false })
        const cancelled = await outlinerTreeState(activePage)
        assertOutlinerState(beforeCancel, cancelled)
        assert(cancelled.revision === beforeCancel.revision, 'Cancelling an Outliner drag changed the document revision.')
        assert(cancelled.dragHighlights === 0, 'Cancelling an Outliner drag left a drop indicator or source highlight.')
        trace('outliner-drag-drop', { width, collections: collections.collections, elementParent: moved.elementParent })
      }
    } finally {
      await finishOutlinerDrag(activePage, { drop: false })
      if (browserName === 'chromium') await activePage.setViewport(BROWSER_VIEWPORT)
      await activePage.evaluate(previous => {
        if (previous === null) localStorage.removeItem('nanquim-preferences')
        else localStorage.setItem('nanquim-preferences', previous)
        window.openPreferences()
        document.querySelector('.prefs-btn-cancel').click()
      }, originalPreferences)
    }
  })
}

async function runOutlinerCollectionDropWorkflows(activePage) {
  await step('move a selected line into an empty collection across its entire header', async () => {
    const widths = browserName === 'chromium' ? [BROWSER_VIEWPORT.width, 720] : [BROWSER_VIEWPORT.width]
    try {
      for (const width of widths) {
        if (width !== BROWSER_VIEWPORT.width) await activePage.setViewport({ ...BROWSER_VIEWPORT, width })
        const initialized = await activePage.evaluate(() => window.editor.documents.newDocument())
        assert(initialized?.ok, 'Could not create an empty drawing for the Outliner collection regression.')
        await runTerminalCommand(activePage, 'l')
        await typeTerminalValue(activePage, '#0,0')
        await typeTerminalValue(activePage, '#30,20')
        await activePage.keyboard.press('Escape')
        await activePage.click('#btn-add-collection')
        const setup = await activePage.evaluate(() => {
          const line = window.editor.drawing.node.querySelector('line')
          return { sourceId: line.id, sourceCollection: line.parentElement.id,
            destination: [...window.editor.drawing.node.children].find(node =>
              node.getAttribute('data-collection') === 'true' && node.id !== line.parentElement.id).id }
        })
        const readState = () => activePage.evaluate(sourceId => {
          const editor = window.editor
          const line = document.getElementById(sourceId)
          return { parent: line.parentElement.id, geometry: ['x1', 'y1', 'x2', 'y2', 'transform'].map(name => line.getAttribute(name)),
            collections: [...editor.drawing.node.children].filter(node => node.getAttribute('data-collection') === 'true').map(node => node.id),
            activeCollection: editor.activeCollection.node.id, historyDepth: editor.history.undos.length,
            highlights: document.querySelectorAll('.outliner-drag-source, .outliner-drop-inside').length }
        }, setup.sourceId)
        const undo = async () => {
          await activePage.keyboard.down(controlKey())
          await activePage.keyboard.press('KeyZ')
          await activePage.keyboard.up(controlKey())
        }
        for (const [sourcePart, fraction] of [['name', 0.5], ['handle', 0.1], ['blank', 0.9]]) {
          // Collection activation selects its group. Selecting its line next
          // must not make dragging the line reorder the selected collection.
          await activePage.click(`[data-outliner-id="${setup.sourceCollection}"] .collection-name`)
          await activePage.click(`[data-outliner-id="${setup.sourceId}"] .collection-name`)
          const before = await readState()
          if (browserName === 'chromium') {
            await dragOutlinerWithMouse(activePage, setup.sourceId, setup.destination, { sourcePart, fraction, position: 'inside' })
          } else {
            // Firefox BiDi mouse.up currently omits native drop/dragend.
            // Keep the same UI selection and drop coordinates under test.
            const preview = await startOutlinerDrag(activePage, setup.sourceId, setup.destination, 'inside', fraction)
            assert(preview.accepted && preview.highlight, 'The entire collection header must accept its selected line.')
            await finishOutlinerDrag(activePage)
          }
          const moved = await readState()
          assert(moved.parent === setup.destination, 'Dragging the selected line moved its collection instead of the line.')
          assert(JSON.stringify(moved.collections) === JSON.stringify(before.collections), 'Dragging a line reordered its collections.')
          assert(JSON.stringify(moved.geometry) === JSON.stringify(before.geometry), 'Moving a line into a collection changed its geometry.')
          assert(moved.activeCollection === before.activeCollection, 'Moving a line changed the active drawing collection.')
          assert(moved.historyDepth === before.historyDepth + 1 && moved.highlights === 0, 'A collection drop did not commit once and clean up its indicators.')
          await undo()
          assert(JSON.stringify(await readState()) === JSON.stringify(before), 'Undo did not restore the line to its source collection.')
          await activePage.keyboard.down(controlKey())
          await activePage.keyboard.down('Shift')
          await activePage.keyboard.press('KeyZ')
          await activePage.keyboard.up('Shift')
          await activePage.keyboard.up(controlKey())
          assert(JSON.stringify(await readState()) === JSON.stringify(moved), 'Redo did not restore the line collection move.')
          await undo()
          trace('outliner-collection-header-drop', { width, native: browserName === 'chromium', sourcePart, fraction, before, moved })
        }
      }
    } finally {
      if (browserName === 'chromium') await activePage.setViewport(BROWSER_VIEWPORT)
    }
  })
}

async function runOutlinerMoveDialogWorkflows(activePage) {
  await step('move selected elements to an existing or new collection with the Outliner M dialog', async () => {
    const widths = browserName === 'chromium' ? [BROWSER_VIEWPORT.width, 720] : [BROWSER_VIEWPORT.width]
    const dialogSelector = 'dialog.outliner-move-dialog[open]'
    const originalPreferences = await activePage.evaluate(() => localStorage.getItem('nanquim-preferences'))
    try {
      for (const width of widths) {
        if (width !== BROWSER_VIEWPORT.width) await activePage.setViewport({ ...BROWSER_VIEWPORT, width })
        await activePage.evaluate(light => {
          window.openPreferences()
          const background = document.getElementById('prefs-background-color')
          background.value = light ? '#f3f1ea' : '#20252a'
          background.dispatchEvent(new Event('input', { bubbles: true }))
          const accent = document.getElementById('prefs-accent-color')
          accent.value = light ? '#3456a1' : '#62a7e8'
          accent.dispatchEvent(new Event('input', { bubbles: true }))
          document.querySelector('.prefs-btn-save').click()
        }, width === 720)
        const initialized = await activePage.evaluate(() => window.editor.documents.newDocument())
        assert(initialized?.ok, 'Could not create an empty drawing for the Outliner move dialog.')
        for (const [start, end] of [['#0,0', '#30,20'], ['#40,0', '#70,20']]) {
          await runTerminalCommand(activePage, 'l')
          await typeTerminalValue(activePage, start)
          await typeTerminalValue(activePage, end)
          await activePage.keyboard.press('Escape')
        }
        await activePage.click('#btn-add-collection')
        const setup = await activePage.evaluate(() => {
          const lines = [...window.editor.drawing.node.querySelectorAll('line')]
          const source = lines[0].parentElement.id
          return { lines: lines.map(line => line.id), source,
            destination: [...window.editor.drawing.node.children].find(node =>
              node.getAttribute('data-collection') === 'true' && node.id !== source).id }
        })
        const readState = () => activePage.evaluate(ids => {
          const editor = window.editor
          editor.documentState.flushObservedMutations()
          return {
            lines: ids.map(id => { const node = document.getElementById(id); return {
              id, parent: node.parentElement.id, geometry: ['x1', 'y1', 'x2', 'y2', 'transform'].map(name => node.getAttribute(name)),
            } }),
            collections: [...editor.drawing.node.children].filter(node => node.getAttribute('data-collection') === 'true')
              .map(node => ({ id: node.id, name: node.getAttribute('name') })),
            activeCollection: editor.activeCollection.node.id,
            historyDepth: editor.history.undos.length, revision: editor.documentState.revision,
          }
        }, setup.lines)
        const assertState = (expected, actual) => {
          for (const key of ['lines', 'collections', 'activeCollection', 'historyDepth']) {
            assert(JSON.stringify(actual[key]) === JSON.stringify(expected[key]), `Outliner move dialog did not restore ${key}.`)
          }
        }
        const historyTravel = async redo => {
          await activePage.keyboard.down(controlKey())
          if (redo) await activePage.keyboard.down('Shift')
          await activePage.keyboard.press('KeyZ')
          if (redo) await activePage.keyboard.up('Shift')
          await activePage.keyboard.up(controlKey())
        }
        const selectLines = async collection => {
          await activePage.click(`[data-outliner-id="${collection}"] .collection-name`)
          for (const id of setup.lines) await activePage.click(`[data-outliner-id="${id}"] .collection-name`)
        }
        let screenshotCaptured = false
        const openDialog = async () => {
          await activePage.focus('#terminalInput')
          const terminalDraft = await activePage.$eval('#terminalInput', input => input.value)
          await activePage.hover(`[data-outliner-id="${setup.lines[0]}"] .collection-name`)
          await activePage.keyboard.press('KeyM')
          await activePage.waitForSelector(dialogSelector)
          const appearance = await activePage.evaluate(selector => {
            const dialog = document.querySelector(selector)
            const bounds = dialog.getBoundingClientRect()
            const style = getComputedStyle(dialog)
            const context = document.createElement('canvas').getContext('2d')
            const color = value => {
              context.clearRect(0, 0, 1, 1)
              context.fillStyle = value
              context.fillRect(0, 0, 1, 1)
              return '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
                .map(channel => channel.toString(16).padStart(2, '0')).join('')
            }
            const focus = getComputedStyle(document.activeElement)
            return { fits: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
              visible: bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0,
              ownsFocus: dialog.contains(document.activeElement), terminal: document.getElementById('terminalInput').value,
              focusRing: focus.outlineStyle !== 'none' && Number.parseFloat(focus.outlineWidth) > 0,
              focusColor: color(focus.outlineColor), focusBackground: color(focus.backgroundColor),
              controls: [dialog, ...dialog.querySelectorAll('select, input, button')]
                .filter(element => element.getBoundingClientRect().height > 0).map(element => {
                  const computed = getComputedStyle(element)
                  const box = element.getBoundingClientRect()
                  return { foreground: color(computed.color), background: color(computed.backgroundColor),
                    fits: box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom }
                }) }
          }, dialogSelector)
          assert(appearance.fits && appearance.visible && appearance.ownsFocus, 'The Outliner move dialog is clipped, hidden, or missing keyboard focus.')
          assert(appearance.terminal === terminalDraft, 'The Outliner M shortcut changed the existing terminal draft.')
          assert(appearance.focusRing && themeColorContrast(appearance.focusColor, appearance.focusBackground) >= 3,
            'The Outliner move dialog has no visible keyboard focus ring.')
          assert(appearance.controls.every(control => control.fits && themeColorContrast(control.foreground, control.background) >= 4.5),
            'The Outliner move dialog has clipped controls or unreadable text against its theme.')
          if (!screenshotCaptured) {
            await activePage.screenshot({ path: join(artifactsDirectory, `outliner-move-${width}.png`) })
            screenshotCaptured = true
          }
        }

        // Pointer location decides whether M belongs to the terminal or the
        // Outliner, even when the terminal still owns keyboard focus.
        await activePage.focus('#terminalInput')
        await activePage.hover('#canvas > svg')
        await activePage.keyboard.press('KeyM')
        const outsideResult = await activePage.evaluate(() => ({ terminal: document.getElementById('terminalInput').value,
          modal: Boolean(document.querySelector('dialog.outliner-move-dialog[open]')) }))
        assert(outsideResult.terminal.toLowerCase() === 'm' && !outsideResult.modal, 'M outside the Outliner no longer belongs to the terminal.')
        await activePage.keyboard.press('Escape')

        // The legacy collection click rerenders its row before a native
        // double-click can reach rename. Enter the existing rename handler
        // directly here; the shortcut/text input under test remains native.
        await activePage.evaluate(source => document.querySelector(`[data-outliner-id="${source}"] .collection-name`)
          .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), setup.source)
        await activePage.hover('.collection-rename-input')
        await activePage.waitForSelector('.collection-rename-input')
        await activePage.keyboard.type('m')
        const renamed = await activePage.evaluate(() => ({ value: document.querySelector('.collection-rename-input')?.value,
          modal: Boolean(document.querySelector('dialog.outliner-move-dialog[open]')) }))
        assert(renamed.value === 'm' && !renamed.modal, 'Typing M into an Outliner rename field opened the move dialog.')
        const originalName = await activePage.evaluate(source => document.getElementById(source).getAttribute('name') || 'Collection', setup.source)
        await activePage.keyboard.down(controlKey())
        await activePage.keyboard.press('KeyA')
        await activePage.keyboard.up(controlKey())
        await activePage.keyboard.type(originalName)
        await activePage.focus('#terminalInput')

        await selectLines(setup.source)
        await activePage.focus('#terminalInput')
        await activePage.keyboard.type('co')
        const beforeCancel = await readState()
        await openDialog()
        for (let index = 0; index < 4; index += 1) {
          await activePage.keyboard.press('Tab')
          assert(await activePage.evaluate(selector => document.querySelector(selector)?.contains(document.activeElement), dialogSelector),
            'Tab escaped the Outliner move dialog.')
        }
        await activePage.keyboard.press('Escape')
        await activePage.waitForFunction(() => !document.querySelector('dialog.outliner-move-dialog[open]'))
        const cancelled = await readState()
        assertState(beforeCancel, cancelled)
        assert(cancelled.revision === beforeCancel.revision, 'Cancelling the Outliner dialog dirtied the drawing.')
        assert(await activePage.evaluate(() => document.activeElement?.id === 'terminalInput'), 'Escape from the Outliner dialog did not restore terminal focus.')

        await openDialog()
        await activePage.focus(`${dialogSelector} button[type="button"]`)
        await activePage.keyboard.press(' ')
        await activePage.waitForFunction(() => !document.querySelector('dialog.outliner-move-dialog[open]'))
        const spaceCancelled = await readState()
        assertState(beforeCancel, spaceCancelled)
        assert(spaceCancelled.revision === beforeCancel.revision, 'Space on Cancel changed the document revision.')

        await openDialog()
        await activePage.select(`${dialogSelector} select[name="collection"]`, setup.destination)
        await activePage.click(`${dialogSelector} button[type="submit"]`)
        await activePage.waitForFunction(() => !document.querySelector('dialog.outliner-move-dialog[open]'))
        const existing = await readState()
        assert(existing.lines.every(line => line.parent === setup.destination), 'The dialog did not move every selected line into the existing collection.')
        assert(JSON.stringify(existing.lines.map(line => line.geometry)) === JSON.stringify(beforeCancel.lines.map(line => line.geometry)), 'The dialog changed line geometry while moving collections.')
        assert(existing.collections.length === beforeCancel.collections.length && existing.historyDepth === beforeCancel.historyDepth + 1,
          'Moving into an existing collection did not create one history entry.')
        await historyTravel(false)
        assertState(beforeCancel, await readState())
        await historyTravel(true)
        assertState(existing, await readState())

        await selectLines(setup.destination)
        const beforeNew = await readState()
        await openDialog()
        await activePage.select(`${dialogSelector} select[name="collection"]`, 'new')
        await activePage.focus(`${dialogSelector} input[name="collection-name"]`)
        await activePage.keyboard.down(controlKey())
        await activePage.keyboard.press('KeyA')
        await activePage.keyboard.up(controlKey())
        await activePage.keyboard.type('Medidas & Referencias')
        await activePage.keyboard.press('Enter')
        await activePage.waitForFunction(() => !document.querySelector('dialog.outliner-move-dialog[open]'))
        const created = await readState()
        const collection = created.collections.find(item => item.name === 'Medidas & Referencias')
        assert(collection && created.lines.every(line => line.parent === collection.id), 'The dialog did not create a named collection containing the selected lines.')
        assert(created.collections.length === beforeNew.collections.length + 1 && created.historyDepth === beforeNew.historyDepth + 1,
          'Creating a destination and moving its elements did not form one history entry.')
        await historyTravel(false)
        assertState(beforeNew, await readState())
        await historyTravel(true)
        assertState(created, await readState())
        trace('outliner-move-dialog', { width, beforeCancel, cancelled, existing, created })
      }
    } finally {
      if (browserName === 'chromium') await activePage.setViewport(BROWSER_VIEWPORT)
      await activePage.evaluate(previous => {
        if (previous === null) localStorage.removeItem('nanquim-preferences')
        else localStorage.setItem('nanquim-preferences', previous)
        window.openPreferences()
        document.querySelector('.prefs-btn-cancel').click()
      }, originalPreferences)
    }
  })
}

async function runOutlinerRangeSelectionWorkflows(activePage) {
  await step('Shift-select visible Outliner ranges and move them between collections', async () => {
    const widths = browserName === 'chromium' ? [BROWSER_VIEWPORT.width, 720] : [BROWSER_VIEWPORT.width]
    try {
      for (const width of widths) {
        if (width !== BROWSER_VIEWPORT.width) await activePage.setViewport({ ...BROWSER_VIEWPORT, width })
        const loaded = await activePage.evaluate(() => {
          const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"
            data-nanquim-version="3" data-element-index="930" data-active-collection-id="range-a">
            <g id="range-a" data-collection="true" name="First collection" style="stroke:#ffffff;stroke-width:0.2;fill:none">
              <line id="901" name="First line" x1="10" y1="10" x2="20" y2="10"/>
              <line id="902" name="Anchor line" x1="10" y1="20" x2="20" y2="20"/>
              <line id="903" name="Hidden line" data-hidden="true" x1="10" y1="30" x2="20" y2="30"/>
              <line id="904" name="Locked line" data-locked="true" x1="10" y1="40" x2="20" y2="40"/>
              <g id="905" name="Collapsed group" data-group="true" data-collapsed="true">
                <line id="906" x1="30" y1="10" x2="40" y2="10"/>
              </g>
              <line id="907" name="Range end in first collection" x1="30" y1="20" x2="40" y2="20"/>
            </g>
            <g id="range-b" data-collection="true" name="Second collection" style="stroke:#ff8833;stroke-width:0.2;fill:none">
              <line id="908" name="Range end in second collection" x1="50" y1="10" x2="60" y2="10"/>
              <line id="909" name="Independent selection" x1="50" y1="20" x2="60" y2="20"/>
            </g>
            <g id="range-c" data-collection="true" name="Destination collection"/>
          </svg>`
          return window.editor.documents.openFile(new File([source], 'browser-outliner-ranges.svg', { type: 'image/svg+xml' }))
        })
        assert(loaded?.ok, 'Could not load the Outliner range selection fixture.')
        const clickRow = async (id, shift = false) => {
          if (shift) await activePage.keyboard.down('Shift')
          try {
            await activePage.click(`[data-outliner-id="${id}"] .collection-name`)
          } finally {
            if (shift) await activePage.keyboard.up('Shift')
          }
        }
        const assertSelection = async expected => {
          const state = await activePage.evaluate(() => ({
            selected: window.editor.selected.map(element => element.node?.id).sort(),
            highlighted: [...document.querySelectorAll('[data-outliner-id].outliner-selected')].map(row => row.dataset.outlinerId).sort(),
          }))
          const ids = [...expected].sort()
          assert(JSON.stringify(state.selected) === JSON.stringify(ids), `Expected Outliner range ${ids}, received ${state.selected}.`)
          assert(JSON.stringify(state.highlighted) === JSON.stringify(ids), `Outliner row highlights do not match its selected range: ${state.highlighted}.`)
        }
        const readTree = () => activePage.evaluate(() => {
          const editor = window.editor
          editor.documentState.flushObservedMutations()
          return { parents: Object.fromEntries(['901', '902', '903', '904', '905', '906', '907', '908', '909']
            .map(id => [id, document.getElementById(id).parentElement.id])),
          children: Object.fromEntries(['range-a', 'range-b', 'range-c'].map(id => [id, [...document.getElementById(id).children].map(node => node.id)])),
          historyDepth: editor.history.undos.length, revision: editor.documentState.revision }
        })
        const historyTravel = async redo => {
          await activePage.keyboard.down(controlKey())
          if (redo) await activePage.keyboard.down('Shift')
          await activePage.keyboard.press('KeyZ')
          if (redo) await activePage.keyboard.up('Shift')
          await activePage.keyboard.up(controlKey())
        }
        const assertTree = (expected, actual) => {
          for (const key of ['parents', 'children', 'historyDepth']) {
            assert(JSON.stringify(actual[key]) === JSON.stringify(expected[key]), `The Outliner range move did not restore ${key}.`)
          }
        }

        const beforeSelection = await readTree()
        await clickRow('909')
        await clickRow('902')
        await assertSelection(['909', '902'])
        await clickRow('908', true)
        const fullRange = ['909', '902', '905', '907', '908']
        await assertSelection(fullRange)
        await clickRow('907', true)
        await assertSelection(['909', '902', '905', '907'])
        await clickRow('901', true)
        await assertSelection(['909', '901', '902'])
        await clickRow('903', true)
        await clickRow('904', true)
        await assertSelection(['909', '901', '902'])
        await clickRow('908', true)
        await assertSelection(fullRange)
        assert(await activePage.$('[data-outliner-id="906"]') === null, 'The collapsed descendant should not have a selectable Outliner row.')
        const beforeMove = await readTree()
        assertTree(beforeSelection, beforeMove)
        assert(beforeMove.revision === beforeSelection.revision, 'Selecting an Outliner range dirtied the drawing.')

        await activePage.focus('#terminalInput')
        // Re-enter after the range selection replaces its rows. Firefox BiDi
        // can retain pointer state for the detached row after those clicks.
        await activePage.mouse.move(10, 10)
        await activePage.hover('[data-outliner-id="902"] .collection-name')
        await activePage.keyboard.press('KeyM')
        await activePage.waitForSelector('dialog.outliner-move-dialog[open]')
        await activePage.select('dialog.outliner-move-dialog select[name="collection"]', 'range-c')
        await activePage.click('dialog.outliner-move-dialog button[type="submit"]')
        await activePage.waitForFunction(() => !document.querySelector('dialog.outliner-move-dialog[open]'))
        const moved = await readTree()
        assert(moved.children['range-c'].join(',') === '902,905,907,908,909', 'M did not move the complete selected range in drawing order.')
        assert(moved.parents['901'] === 'range-a' && moved.parents['903'] === 'range-a' && moved.parents['904'] === 'range-a'
          && moved.parents['906'] === '905', 'Moving a visible range changed an excluded element or split its collapsed group.')
        assert(moved.historyDepth === beforeMove.historyDepth + 1, 'Moving the selected range did not create one history entry.')
        await historyTravel(false)
        assertTree(beforeMove, await readTree())
        await historyTravel(true)
        assertTree(moved, await readTree())
        await historyTravel(false)

        await clickRow('range-a')
        await clickRow('range-c', true)
        await assertSelection(['range-a', 'range-b', 'range-c'])
        await clickRow('range-b', true)
        await assertSelection(['range-a', 'range-b'])

        await activePage.evaluate(() => window.switchEditorMode('paper'))
        await activePage.waitForFunction(() => window.editor.mode === 'paper')
        for (const y of [2, 4, 6]) {
          await runTerminalCommand(activePage, 'l')
          await typeTerminalValue(activePage, `#2,${y}`)
          await typeTerminalValue(activePage, `#6,${y}`)
          await activePage.keyboard.press('Escape')
        }
        const annotations = await activePage.evaluate(() => [...window.editor.paperAnnotations.node.querySelectorAll('line')].map(node => node.id))
        assert(annotations.length === 3, 'Could not draw three Paper annotations for the range isolation check.')
        await clickRow(annotations[0])
        await clickRow(annotations[2], true)
        await assertSelection(annotations)
        await clickRow('901', true)
        await assertSelection(annotations)
        await activePage.evaluate(() => window.switchEditorMode('model'))
        await activePage.waitForFunction(() => window.editor.mode === 'model')
        await assertSelection([])
        await clickRow('908', true)
        await assertSelection(['908'])
        trace('outliner-range-selection', { width, fullRange, beforeMove, moved, annotations })
      }
    } finally {
      if (browserName === 'chromium') await activePage.setViewport(BROWSER_VIEWPORT)
    }
  })
}

async function dragOutlinerWithMouse(activePage, sourceId, targetId, { sourcePart = 'name', fraction = 0.9, position = 'after' } = {}) {
  const points = await activePage.evaluate(({ sourceId, targetId, sourcePart, fraction }) => {
    const source = document.querySelector(`[data-outliner-id="${sourceId}"]`)
    const target = document.querySelector(`[data-outliner-id="${targetId}"]`)
    source.scrollIntoView({ block: 'nearest' })
    target.scrollIntoView({ block: 'nearest' })
    const start = (sourcePart === 'handle' ? source.querySelector('.outliner-move-handle') : source).getBoundingClientRect()
    const end = target.getBoundingClientRect()
    return { start: { x: sourcePart === 'handle' ? start.left + start.width / 2 : sourcePart === 'blank' ? start.right - 70 : start.left + 75,
      y: start.top + start.height / 2 }, end: { x: end.left + 75, y: end.top + end.height * fraction } }
  }, { sourceId, targetId, sourcePart, fraction })
  await activePage.mouse.move(points.start.x, points.start.y)
  await activePage.mouse.down()
  try {
    await activePage.mouse.move(points.start.x + 12, points.start.y, { steps: 4 })
    await activePage.mouse.move(points.end.x, points.end.y, { steps: 12 })
    await activePage.waitForSelector(`[data-outliner-id="${targetId}"].outliner-drop-${position}`)
  } finally {
    await activePage.mouse.up()
  }
}

async function startOutlinerDrag(activePage, sourceId, targetId, position, fraction) {
  return activePage.evaluate(({ sourceId, targetId, position, fraction }) => {
    const source = document.querySelector(`[data-outliner-id="${sourceId}"]`)
    const target = document.querySelector(`[data-outliner-id="${targetId}"]`)
    if (!source || !target) throw new Error(`Missing Outliner drag row: ${sourceId} or ${targetId}`)
    source.scrollIntoView({ block: 'nearest' })
    const sourceBounds = source.getBoundingClientRect()
    const transfer = new DataTransfer()
    const start = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: sourceBounds.left + sourceBounds.width / 2, clientY: sourceBounds.top + sourceBounds.height / 2 })
    source.dispatchEvent(start)
    target.scrollIntoView({ block: 'nearest' })
    const bounds = target.getBoundingClientRect()
    const clientX = bounds.left + bounds.width / 2
    const clientY = bounds.top + bounds.height * (fraction ?? (position === 'before' ? 0.1 : position === 'after' ? 0.9 : 0.5))
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX, clientY })
    target.dispatchEvent(over)
    window.__nanquimOutlinerDrag = { source, target, transfer, clientX, clientY }
    const style = getComputedStyle(target)
    const rootStyle = getComputedStyle(document.documentElement)
    return {
      // Chromium keeps synthetic DataTransfer effects as "none"; the app's
      // actual accepted candidate is represented by its visible drop marker.
      accepted: over.defaultPrevented && ['before', 'inside', 'after'].some(value => target.classList.contains(`outliner-drop-${value}`)),
      highlight: target.classList.contains(`outliner-drop-${position}`),
      outline: style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0,
      shadow: style.boxShadow !== 'none',
      targetVisible: bounds.width > 0 && bounds.height > 0 && bounds.top < innerHeight && bounds.bottom > 0,
      background: rootStyle.getPropertyValue('--app-background-color').trim(),
      accent: rootStyle.getPropertyValue('--accent-color').trim(),
      dragstartPrevented: start.defaultPrevented,
      dragoverPrevented: over.defaultPrevented,
      effectAllowed: transfer.effectAllowed,
      dropEffect: transfer.dropEffect,
      status: document.querySelector('.outliner-move-status')?.textContent,
      flags: { drawing: window.editor.isDrawing, interacting: window.editor.isInteracting, editing: window.editor.isEditingVertex },
    }
  }, { sourceId, targetId, position, fraction })
}

async function finishOutlinerDrag(activePage, { drop = true } = {}) {
  await activePage.evaluate(shouldDrop => {
    const drag = window.__nanquimOutlinerDrag
    if (!drag) return
    const options = { bubbles: true, cancelable: true, dataTransfer: drag.transfer, clientX: drag.clientX, clientY: drag.clientY }
    if (shouldDrop) drag.target.dispatchEvent(new DragEvent('drop', options))
    drag.source.dispatchEvent(new DragEvent('dragend', options))
    delete window.__nanquimOutlinerDrag
  }, drop)
}

async function dropOutlinerRow(activePage, sourceId, targetId, position, { accepted = true } = {}) {
  const preview = await startOutlinerDrag(activePage, sourceId, targetId, position)
  trace('outliner-drop-preview', { sourceId, targetId, position, ...preview })
  assert(preview.accepted === accepted, `Outliner ${sourceId} → ${targetId} acceptance was ${preview.accepted}, expected ${accepted}.`)
  if (accepted) {
    assert(preview.highlight && preview.targetVisible, `Outliner ${position} drop target has no visible indicator.`)
    assert(preview.outline || preview.shadow, `Outliner ${position} drop indicator has no computed outline or shadow.`)
    assert(themeColorContrast(preview.accent, preview.background) >= 3, 'The Outliner drop indicator has insufficient contrast against the custom theme background.')
  }
  await finishOutlinerDrag(activePage)
  const state = await outlinerTreeState(activePage)
  assert(state.dragHighlights === 0, 'Finishing an Outliner drop left a source highlight or drop indicator.')
}

function themeColorContrast(first, second) {
  const luminance = color => {
    const channels = color.slice(1).match(/../g).map(value => Number.parseInt(value, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const values = [luminance(first), luminance(second)].sort((left, right) => left - right)
  return (values[1] + 0.05) / (values[0] + 0.05)
}

async function outlinerInteractionState(activePage) {
  return activePage.evaluate(() => ({
    focus: document.activeElement?.outerHTML,
    parent: document.getElementById('101')?.parentElement.id,
    selected: window.editor.selected.map(element => element.node.id),
    history: window.editor.history.undos.length,
    rawTransform: document.getElementById('101')?.getAttribute('transform'),
    computedTransform: getComputedStyle(document.getElementById('101')).transform,
    localMatrix: document.getElementById('101')?.instance.matrixify().toArray(),
    nativeScreenMatrix: (() => {
      const matrix = document.getElementById('101')?.getScreenCTM()
      return matrix && ['a', 'b', 'c', 'd', 'e', 'f'].map(key => matrix[key])
    })(),
    status: document.querySelector('.outliner-move-status')?.textContent,
    terminal: document.getElementById('terminalLog').textContent.slice(-1500),
    highlights: Array.from(document.querySelectorAll('.outliner-drop-before, .outliner-drop-after, .outliner-drop-inside, .outliner-drag-source'), row => ({ id: row.dataset.outlinerId, className: row.className })),
  }))
}

async function outlinerTreeState(activePage) {
  return activePage.evaluate(() => {
    const editor = window.editor
    editor.documentState.flushObservedMutations()
    const first = document.getElementById('101')
    // Narrow layouts may scroll horizontally when an Outliner row receives
    // focus. Compare native browser geometry in drawing coordinates so a
    // changed page scroll does not look like an edited SVG position.
    const local = first.getBBox()
    const matrix = editor.drawing.screenCTM().inverse().multiply(first.instance.screenCTM())
    const corners = [[local.x, local.y], [local.x + local.width, local.y],
      [local.x + local.width, local.y + local.height], [local.x, local.y + local.height]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix))
    const x = Math.min(...corners.map(point => point.x))
    const y = Math.min(...corners.map(point => point.y))
    const bounds = { x, y, width: Math.max(...corners.map(point => point.x)) - x,
      height: Math.max(...corners.map(point => point.y)) - y }
    return {
      collections: Array.from(editor.drawing.node.children).filter(child => child.getAttribute('data-collection') === 'true').map(child => child.id),
      children: Object.fromEntries(['browser-tree-a', 'browser-tree-b', '103', '104', '107']
        .map(id => [id, Array.from(document.getElementById(id).children, child => child.id)])),
      elementParent: first.parentElement.id,
      transform: first.getAttribute('transform'),
      metadata: first.getAttribute('data-description'),
      stroke: getComputedStyle(first).stroke,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      activeCollection: editor.activeCollection.attr('id'),
      historyDepth: editor.history.undos.length,
      revision: editor.documentState.revision,
      dragHighlights: document.querySelectorAll('.outliner-drop-before, .outliner-drop-after, .outliner-drop-inside, .outliner-drag-source').length,
    }
  })
}

function assertOutlinerState(expected, actual) {
  for (const field of ['collections', 'children', 'elementParent', 'transform', 'metadata', 'stroke', 'activeCollection', 'historyDepth']) {
    assert(JSON.stringify(actual[field]) === JSON.stringify(expected[field]), `Outliner ${field} changed unexpectedly.`)
  }
  for (const key of ['x', 'y', 'width', 'height']) assertNear(actual.bounds[key], expected.bounds[key], 1e-4, `Outliner element ${key}`)
}

async function undoRedoOutlinerDrop(activePage, before, after) {
  await activePage.keyboard.down(controlKey())
  await activePage.keyboard.press('KeyZ')
  await activePage.keyboard.up(controlKey())
  assertOutlinerState(before, await outlinerTreeState(activePage))
  await activePage.keyboard.down(controlKey())
  await activePage.keyboard.down('Shift')
  await activePage.keyboard.press('KeyZ')
  await activePage.keyboard.up('Shift')
  await activePage.keyboard.up(controlKey())
  assertOutlinerState(after, await outlinerTreeState(activePage))
}

async function runImageImportWorkflows(activePage) {
  await step('import an embedded raster image by command and cancel its preview', async () => {
    const initialized = await activePage.evaluate(async () => {
      const result = await window.editor.documents.newDocument()
      window.editor.svg.viewbox(-40, 15, 160, 100)
      const canvas = document.createElement('canvas')
      canvas.width = 24
      canvas.height = 16
      const context = canvas.getContext('2d')
      context.fillStyle = '#ed3156'
      context.fillRect(0, 0, canvas.width, canvas.height)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      window.__nanquimBrowserImageFile = new File([blob], 'browser-raster.png', { type: 'image/png' })
      window.__nanquimBrowserImagePickerClicks = 0
      const originalClick = HTMLInputElement.prototype.click
      HTMLInputElement.prototype.click = function () {
        if (!this.matches('input[type="file"][data-image-import]')) return originalClick.call(this)
        window.__nanquimBrowserImagePickerClicks += 1
        const transfer = new DataTransfer()
        transfer.items.add(window.__nanquimBrowserImageFile)
        this.files = transfer.files
        queueMicrotask(() => this.dispatchEvent(new Event('change', { bubbles: true })))
      }
      return result
    })
    assert(initialized?.ok, 'Could not initialize a clean image-import document.')
    await runTerminalCommand(activePage, 'image')
    await activePage.waitForSelector('image[data-nanquim-transient]')
    const preview = await activePage.evaluate(() => {
      const image = document.querySelector('image[data-nanquim-transient]')
      const style = getComputedStyle(image)
      const bounds = image.getBoundingClientRect()
      return {
        visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
          && bounds.width > 0 && bounds.height > 0,
        drawingImages: window.editor.drawing.node.querySelectorAll('image').length,
        historyDepth: window.editor.history.undos.length,
      }
    })
    assert(preview.visible, 'IMAGE did not expose a painted, nonzero preview.')
    assert(preview.drawingImages === 0 && preview.historyDepth === 0, 'IMAGE preview entered persistent drawing content or History.')
    await activePage.keyboard.press('F3')
    await activePage.waitForFunction(() => getComputedStyle(document.getElementById('Overlays')).display === 'none')
    const previewWithoutOverlays = await activePage.evaluate(() => {
      const image = document.querySelector('image[data-nanquim-transient]')
      const style = getComputedStyle(image)
      const bounds = image.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
        && bounds.width > 0 && bounds.height > 0
    })
    assert(previewWithoutOverlays, 'F3 hid the active IMAGE preview with viewport overlays.')
    await activePage.keyboard.press('F3')
    await activePage.keyboard.press('Escape')
    await activePage.waitForFunction(() => (
      !document.querySelector('image[data-nanquim-transient]')
      && !document.querySelector('input[data-image-import]')
      && !window.editor.isDrawing && !window.editor.isInteracting
    ))
    await runTerminalCommand(activePage, 'img')
    await activePage.waitForSelector('image[data-nanquim-transient]')
    await typeTerminalValue(activePage, '#10,35')
    await activePage.waitForFunction(() => (
      window.editor.drawing.node.querySelectorAll('image').length === 1
      && !document.querySelector('image[data-nanquim-transient]')
    ))
    const committed = await activePage.evaluate(() => {
      const image = window.editor.drawing.node.querySelector('image')
      return {
        x: Number(image.getAttribute('x')),
        y: Number(image.getAttribute('y')),
        width: Number(image.getAttribute('width')),
        height: Number(image.getAttribute('height')),
        href: image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
        activeCollection: image.parentElement === window.editor.activeCollection.node,
        dirty: window.editor.documentState.isDirty,
        historyDepth: window.editor.history.undos.length,
      }
    })
    assert(committed.x === 10 && committed.y === 35, 'IMAGE ignored the typed absolute insertion point.')
    assert(committed.width === 24 && committed.height === 16, 'IMAGE changed the fixture aspect ratio or small-image dimensions.')
    assert(committed.href?.startsWith('data:image/png;base64,'), 'IMAGE did not embed the raster bytes in the SVG.')
    assert(committed.activeCollection && committed.dirty && committed.historyDepth === 1, 'IMAGE did not commit once into the active collection through History.')
    await assertRasterPaint(activePage)
    const original = await activePage.evaluate(() => {
      const image = window.editor.drawing.node.querySelector('image')
      const bounds = image.getBoundingClientRect()
      return {
        id: image.id,
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
        width: bounds.width,
        height: bounds.height,
      }
    })
    await activePage.keyboard.press('Escape')
    await activePage.mouse.move(original.x, original.y)
    try {
      await activePage.waitForFunction(id => window.editor.hoveredElements.some(element => element.node.id === id), {}, original.id)
    } catch (error) {
      trace('raster-hover-diagnostic', await activePage.evaluate(({ id, x, y }) => ({
        image: document.getElementById(id)?.outerHTML,
        target: document.elementFromPoint(x, y)?.outerHTML?.slice(0, 512),
        coordinates: window.editor.coordinates,
        selected: window.editor.selected.map(element => element.node.id),
        hovered: window.editor.hoveredElements.map(element => element.node.id),
        indexed: window.editor.spatialIndex.tree.all().map(item => ({
          id: item.element.node.id, type: item.element.type,
          minX: item.minX, minY: item.minY, maxX: item.maxX, maxY: item.maxY,
        })),
        interacting: window.editor.isInteracting,
        drawing: window.editor.isDrawing,
      }), original))
      throw error
    }
    await activePage.mouse.click(original.x, original.y)
    await activePage.waitForFunction(id => window.editor.selected.some(element => element.node.id === id), {}, original.id)
    const imageHandlers = await activePage.evaluate(() => document.querySelectorAll('#Handlers .selection-handler').length)
    assert(imageHandlers === 9, `Expected four image resize corners, four crop sides, and a translation center, got ${imageHandlers} handlers.`)
    await runTerminalCommand(activePage, 'scale')
    await waitForTerminalText(activePage, 'Specify base point.')
    await activePage.mouse.click(original.x, original.y)
    await waitForTerminalText(activePage, 'Specify second point or enter a scale factor.')
    await typeTerminalValue(activePage, '0.5')
    await activePage.waitForFunction(({ id, width, height }) => {
      const bounds = document.getElementById(id)?.getBoundingClientRect()
      return bounds && Math.abs(bounds.width - width / 2) < 0.01 && Math.abs(bounds.height - height / 2) < 0.01
    }, {}, original)
    await activePage.keyboard.down(controlKey())
    await activePage.keyboard.press('KeyZ')
    await activePage.keyboard.up(controlKey())
    await activePage.waitForFunction(({ id, width, height }) => {
      const bounds = document.getElementById(id)?.getBoundingClientRect()
      return bounds && Math.abs(bounds.width - width) < 0.01 && Math.abs(bounds.height - height) < 0.01
    }, {}, original)
    await activePage.keyboard.press('Escape')
  })

  await step('resize and translate raster images with visible selection handlers', async () => {
    const widths = browserName === 'chromium' ? [BROWSER_VIEWPORT.width, 720] : [BROWSER_VIEWPORT.width]
    const fixture = await activePage.evaluate(() => {
      const editor = window.editor
      const image = editor.drawing.node.querySelector('image')
      return {
        id: image.id,
        transform: image.getAttribute('transform'),
        parentTransform: image.parentElement.getAttribute('transform'),
        isSnapping: editor.isSnapping,
        gridSnap: editor.gridSnap,
        polarTracking: editor.polarTracking,
        ortho: editor.ortho,
      }
    })
    try {
      for (const width of widths) {
        if (width !== BROWSER_VIEWPORT.width) await activePage.setViewport({ ...BROWSER_VIEWPORT, width })
        await activePage.evaluate(({ id, transformed }) => {
          const editor = window.editor
          const image = document.getElementById(id)
          editor.isSnapping = false
          editor.gridSnap = false
          editor.polarTracking = false
          editor.ortho = false
          image.setAttribute('transform', transformed ? 'rotate(18 22 43)' : 'translate(0 0)')
          image.parentElement.setAttribute('transform', transformed ? 'matrix(1.1 .1 .2 .9 -8 0)' : 'translate(0 0)')
          editor.spatialIndex.markDirty()
          editor.fullSpatialIndex.markDirty()
        }, { id: fixture.id, transformed: width === 720 || browserName === 'firefox' })
        await selectRasterImage(activePage, fixture.id)
        const initial = await rasterHandlerState(activePage, fixture.id)
        assertRasterHandlers(initial)

        // The center grip translates the image in its own coordinate system,
        // including when an image and its collection both have transforms.
        const movePoint = await rasterLocalScreenPoint(activePage, fixture.id,
          initial.x + initial.width / 2 + 8, initial.y + initial.height / 2 + 5)
        const centerHandler = initial.handlers.find(handler => handler.index === 8)
        await activePage.mouse.click(centerHandler.x, centerHandler.y)
        await activePage.waitForFunction(() => window.editor.isEditingVertex)
        await activePage.mouse.move(movePoint.x, movePoint.y)
        await activePage.waitForFunction(({ id, x }) => Number(document.getElementById(id).getAttribute('x')) > x + 1,
          {}, { id: fixture.id, x: initial.x })
        const movePreview = await rasterHandlerState(activePage, fixture.id)
        assert(movePreview.historyDepth === initial.historyDepth && movePreview.revision === initial.revision,
          'An image translation preview changed History or the document revision.')
        assertNear(movePreview.width, initial.width, 1e-5, 'Translated image width')
        assertNear(movePreview.height, initial.height, 1e-5, 'Translated image height')
        assertNear(movePreview.x, initial.x + 8, 0.2, 'Translated image x coordinate')
        assertNear(movePreview.y, initial.y + 5, 0.2, 'Translated image y coordinate')
        await activePage.mouse.click(movePoint.x, movePoint.y)
        await activePage.waitForFunction(() => !window.editor.isEditingVertex)
        let moved = await rasterHandlerState(activePage, fixture.id)
        assert(moved.historyDepth === initial.historyDepth + 1 && moved.revision > initial.revision,
          'An image center handler did not commit exactly once into History.')
        assertRasterIdentity(initial, moved)
        assertRasterHandlers(moved)
        await undoRedoRasterHandler(activePage, fixture.id, initial, moved)
        moved = await rasterHandlerState(activePage, fixture.id)

        // Move away from the corner after starting the grip to exercise live
        // paint and proportion-preserving resize before the finishing click.
        const resizePoint = await rasterLocalScreenPoint(activePage, fixture.id,
          moved.x + moved.width * 1.4, moved.y + moved.height * 1.4)
        await activePage.mouse.click(moved.handlers[2].x, moved.handlers[2].y)
        await activePage.waitForFunction(() => window.editor.isEditingVertex)
        await activePage.mouse.move(resizePoint.x, resizePoint.y)
        await activePage.waitForFunction(({ id, width }) => Number(document.getElementById(id).getAttribute('width')) > width * 1.2,
          {}, { id: fixture.id, width: moved.width })
        const resizePreview = await rasterHandlerState(activePage, fixture.id)
        assert(resizePreview.historyDepth === moved.historyDepth && resizePreview.revision === moved.revision,
          'An image resize preview changed History or the document revision.')
        assertNear(resizePreview.x, moved.x, 1e-5, 'Resized image fixed left corner')
        assertNear(resizePreview.y, moved.y, 1e-5, 'Resized image fixed top corner')
        assertNear(resizePreview.width / resizePreview.height, initial.width / initial.height, 1e-5,
          'Resized image aspect ratio')
        await activePage.mouse.click(resizePoint.x, resizePoint.y)
        await activePage.waitForFunction(() => !window.editor.isEditingVertex)
        const resized = await rasterHandlerState(activePage, fixture.id)
        assert(resized.historyDepth === moved.historyDepth + 1, 'An image resize did not commit exactly once into History.')
        assertRasterIdentity(initial, resized)
        assertRasterHandlers(resized)
        await undoRedoRasterHandler(activePage, fixture.id, moved, resized)
        await activePage.keyboard.press('Escape')
        const offImage = await canvasScreenPoint(activePage, 0.15, 0.15)
        await activePage.mouse.move(offImage.x, offImage.y)
        await assertRasterPaint(activePage, fixture.id)
        await selectRasterImage(activePage, fixture.id)

        const beforeCancel = await rasterHandlerState(activePage, fixture.id)
        const cancelPoint = await rasterLocalScreenPoint(activePage, fixture.id,
          beforeCancel.x - beforeCancel.width / 4, beforeCancel.y - beforeCancel.height / 4)
        await activePage.mouse.click(beforeCancel.handlers[0].x, beforeCancel.handlers[0].y)
        await activePage.waitForFunction(() => window.editor.isEditingVertex)
        await activePage.mouse.move(cancelPoint.x, cancelPoint.y)
        await activePage.waitForFunction(({ id, x }) => Number(document.getElementById(id).getAttribute('x')) < x - 1,
          {}, { id: fixture.id, x: beforeCancel.x })
        await activePage.keyboard.press('Escape')
        await activePage.waitForFunction(() => !window.editor.isEditingVertex)
        const cancelled = await rasterHandlerState(activePage, fixture.id)
        assertRasterGeometry(beforeCancel, cancelled)
        assertRasterIdentity(beforeCancel, cancelled)
        assert(cancelled.historyDepth === beforeCancel.historyDepth && cancelled.revision === beforeCancel.revision,
          'Cancelling an image resize changed History or the document revision.')
        assert(!cancelled.editing && !cancelled.interacting && !cancelled.drawing,
          'Cancelling an image resize left an interaction active.')
        trace('raster-handlers', { width, transformed: width === 720 || browserName === 'firefox',
          moved: { x: moved.x, y: moved.y }, resized: { width: resized.width, height: resized.height } })
      }
    } finally {
      await activePage.keyboard.press('Escape')
      await activePage.evaluate(saved => {
        const editor = window.editor
        const image = document.getElementById(saved.id)
        if (saved.transform === null) image.removeAttribute('transform')
        else image.setAttribute('transform', saved.transform)
        if (saved.parentTransform === null) image.parentElement.removeAttribute('transform')
        else image.parentElement.setAttribute('transform', saved.parentTransform)
        for (const name of ['isSnapping', 'gridSnap', 'polarTracking', 'ortho']) editor[name] = saved[name]
        editor.spatialIndex.markDirty()
        editor.fullSpatialIndex.markDirty()
      }, fixture)
      if (browserName === 'chromium') await activePage.setViewport(BROWSER_VIEWPORT)
    }
  })

  await step('drop raster files at viewport coordinates and Undo/Redo the insertion', async () => {
    // Firefox ESR cannot change Puppeteer's emulated orientation after launch.
    // Its desktop run covers drop semantics; Chromium also checks narrow layout.
    const widths = browserName === 'chromium' ? [BROWSER_VIEWPORT.width, 720] : [BROWSER_VIEWPORT.width]
    try {
      for (const width of widths) {
        if (width !== BROWSER_VIEWPORT.width) await activePage.setViewport({ ...BROWSER_VIEWPORT, width })
        const point = await canvasScreenPoint(activePage, 0.6, 0.6)
        const dropped = await activePage.evaluate(({ x, y }) => {
          const editor = window.editor
          const transfer = new DataTransfer()
          transfer.items.add(window.__nanquimBrowserImageFile)
          const before = editor.drawing.node.querySelectorAll('image').length
          const dragover = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y })
          editor.svg.node.dispatchEvent(dragover)
          const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y })
          const expected = new DOMPoint(drop.clientX, drop.clientY).matrixTransform(editor.drawing.node.getScreenCTM().inverse())
          editor.svg.node.dispatchEvent(drop)
          return { before, expectedX: expected.x, expectedY: expected.y, acceptedDrag: dragover.defaultPrevented }
        }, point)
        assert(dropped.acceptedDrag, 'The viewport did not accept a raster file drag.')
        await activePage.waitForFunction(expected => (
          window.editor.drawing.node.querySelectorAll('image').length === expected
        ), {}, dropped.before + 1)
        const image = await activePage.evaluate(() => {
          const image = Array.from(window.editor.drawing.node.querySelectorAll('image')).at(-1)
          return { id: image.id, x: Number(image.getAttribute('x')), y: Number(image.getAttribute('y')) }
        })
        // SVG.js compensates for Firefox's nested-SVG CTM behavior; its matrix
        // inversion can differ from native DOMPoint by a few millionths.
        assertNear(image.x, dropped.expectedX, 1e-5, 'Dropped image x coordinate')
        assertNear(image.y, dropped.expectedY, 1e-5, 'Dropped image y coordinate')
        await assertRasterPaint(activePage, image.id)
        await activePage.keyboard.down(controlKey())
        await activePage.keyboard.press('KeyZ')
        await activePage.keyboard.up(controlKey())
        await activePage.waitForFunction(id => !document.getElementById(id), {}, image.id)
        await activePage.keyboard.down(controlKey())
        await activePage.keyboard.down('Shift')
        await activePage.keyboard.press('KeyZ')
        await activePage.keyboard.up('Shift')
        await activePage.keyboard.up(controlKey())
        await activePage.waitForFunction(id => Boolean(window.editor.drawing.node.querySelector(`[id="${id}"]`)), {}, image.id)
        trace('raster-drop', { width, ...dropped, image })
      }
    } finally {
      if (browserName === 'chromium') await activePage.setViewport(BROWSER_VIEWPORT)
    }
  })

  await step('reopen embedded raster images and reject unsupported command imports', async () => {
    const roundtrip = await activePage.evaluate(async () => {
      const snapshot = () => Array.from(window.editor.drawing.node.querySelectorAll('image'), image => ({
        id: image.id,
        x: image.getAttribute('x'),
        y: image.getAttribute('y'),
        width: image.getAttribute('width'),
        height: image.getAttribute('height'),
        transform: image.getAttribute('transform'),
        href: image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
        collection: image.parentElement.id,
      }))
      const before = snapshot()
      const saved = await window.editor.documents.saveAs({ suggestedName: 'browser-images.svg' })
      const download = window.__nanquimBrowserDownloads.at(-1)
      const source = await download.blob.text()
      const reopened = await window.editor.documents.openFile(new File([source], download.name, { type: 'image/svg+xml' }))
      return { before, after: snapshot(), saved, reopened }
    })
    assert(roundtrip.saved?.ok && roundtrip.reopened?.ok, 'The embedded raster document could not be saved and reopened.')
    assert(JSON.stringify(roundtrip.before) === JSON.stringify(roundtrip.after), 'Embedded raster geometry, bytes, or collection ownership changed after reopen.')
    await assertRasterPaint(activePage)

    const beforeReject = await activePage.evaluate(() => {
      window.__nanquimBrowserImageFile = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'unsupported.svg', { type: 'image/svg+xml' })
      return {
        images: window.editor.drawing.node.querySelectorAll('image').length,
        historyDepth: window.editor.history.undos.length,
        revision: window.editor.documentState.revision,
        logLength: document.getElementById('terminalLog').textContent.length,
      }
    })
    await runTerminalCommand(activePage, 'imageattach')
    await activePage.waitForFunction(logLength => (
      !window.editor.isDrawing && !window.editor.isInteracting
      && !document.querySelector('input[data-image-import]')
      && document.getElementById('terminalLog').textContent.slice(logLength).includes('Image import failed:')
    ), {}, beforeReject.logLength)
    const rejected = await activePage.evaluate(() => ({
      images: window.editor.drawing.node.querySelectorAll('image').length,
      historyDepth: window.editor.history.undos.length,
      revision: window.editor.documentState.revision,
    }))
    assert(rejected.images === beforeReject.images && rejected.historyDepth === beforeReject.historyDepth
      && rejected.revision === beforeReject.revision, 'An unsupported SVG image import changed the document.')

    const pickerClicks = await activePage.evaluate(() => window.__nanquimBrowserImagePickerClicks)
    await activePage.evaluate(() => window.switchEditorMode('paper'))
    await runTerminalCommand(activePage, 'image')
    await waitForTerminalText(activePage, 'Command not available in Paper Space.')
    const guarded = await activePage.evaluate(() => ({
      pickerClicks: window.__nanquimBrowserImagePickerClicks,
      preview: Boolean(document.querySelector('image[data-nanquim-transient]')),
    }))
    assert(guarded.pickerClicks === pickerClicks && !guarded.preview, 'IMAGE opened a picker or preview in Paper Space.')
    await activePage.evaluate(() => window.switchEditorMode('model'))
  })
}

async function runImageCropWorkflows(activePage) {
  await step('crop raster image sides without stretching and preserve crops through Undo/Redo and reopen', async () => {
    const scenarios = browserName === 'chromium'
      ? [{ width: BROWSER_VIEWPORT.width, light: false }, { width: 720, light: true }]
      : [{ width: BROWSER_VIEWPORT.width, light: false }, { width: BROWSER_VIEWPORT.width, light: true }]
    const originalPreferences = await activePage.evaluate(() => localStorage.getItem('nanquim-preferences'))
    try {
      for (const scenario of scenarios) {
        if (scenario.width !== BROWSER_VIEWPORT.width) await activePage.setViewport({ ...BROWSER_VIEWPORT, width: scenario.width })
        const loaded = await activePage.evaluate(async ({ light }) => {
          window.openPreferences()
          const background = document.getElementById('prefs-background-color')
          background.value = light ? '#f3f1ea' : '#20252a'
          background.dispatchEvent(new Event('input', { bubbles: true }))
          document.querySelector('.prefs-btn-save').click()
          const canvas = document.createElement('canvas')
          canvas.width = 60
          canvas.height = 40
          const context = canvas.getContext('2d')
          context.fillStyle = '#ed3156'
          context.fillRect(0, 0, 30, 40)
          context.fillStyle = '#143ce6'
          context.fillRect(30, 0, 30, 40)
          const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 0 160 100"
            data-nanquim-version="3" data-element-index="510" data-active-collection-id="browser-crop-collection">
            <g id="browser-crop-collection" data-collection="true" name="Crop collection"
              transform="matrix(1.1 .1 .2 .9 -4 0)" style="stroke:#ffffff;stroke-width:0.2;fill:none">
              <image id="501" name="Crop fixture" x="30" y="25" width="60" height="40"
                transform="rotate(12 60 45)" href="${canvas.toDataURL()}"/>
            </g>
          </svg>`
          const opened = await window.editor.documents.openFile(new File([source], 'browser-crop.svg', { type: 'image/svg+xml' }))
          const editor = window.editor
          editor.isSnapping = false
          editor.gridSnap = false
          editor.polarTracking = false
          editor.ortho = true
          return opened
        }, scenario)
        assert(loaded?.ok, 'Could not initialize the transformed raster crop fixture.')
        await activePage.keyboard.press('Escape')
        const backgroundPixels = await rasterCropPixels(activePage, '501', true)
        const originalPixels = await rasterCropPixels(activePage, '501')
        assert(JSON.stringify(originalPixels[4]) === '[237,49,86,255]'
          && JSON.stringify(originalPixels[5]) === '[20,60,230,255]', 'The crop fixture did not paint its two original raster colors.')
        await selectRasterImage(activePage, '501')
        const original = await rasterHandlerState(activePage, '501')
        assertRasterHandlers(original)

        for (const [index, px, py, inset] of [[4, .5, .2, 0], [5, .8, .5, 1], [6, .5, .8, 2], [7, .2, .5, 3]]) {
          const before = await rasterHandlerState(activePage, '501')
          const handler = before.handlers.find(value => value.index === index)
          assert(handler.label?.startsWith('Crop image'), `Image crop side ${index} has no descriptive accessible label.`)
          const point = await rasterLocalScreenPoint(activePage, '501', original.x + original.width * px, original.y + original.height * py)
          await activePage.mouse.click(handler.x, handler.y)
          await activePage.waitForFunction(() => window.editor.isEditingVertex)
          await activePage.mouse.move(point.x, point.y)
          await activePage.waitForFunction(({ clip }) => document.getElementById('501').getAttribute('clip-path') !== clip, {}, before)
          const preview = await rasterHandlerState(activePage, '501')
          for (const name of ['x', 'y', 'width', 'height']) assertNear(preview[name], original[name], 1e-5, `Crop preview ${name}`)
          assertRasterIdentity(original, preview)
          assertNear(preview.crop[inset], 20, 1.5, `Crop side ${index} percentage`)
          assert(preview.historyDepth === before.historyDepth && preview.revision === before.revision,
            'A crop preview changed History or the document revision.')
          await activePage.mouse.click(point.x, point.y)
          await activePage.waitForFunction(() => !window.editor.isEditingVertex)
          const after = await rasterHandlerState(activePage, '501')
          assert(after.historyDepth === before.historyDepth + 1, 'A crop side did not commit exactly once into History.')
          assertRasterHandlers(after)
          await undoRedoRasterHandler(activePage, '501', before, after)
        }

        await activePage.keyboard.press('Escape')
        const offImage = await canvasScreenPoint(activePage, 0.1, 0.1)
        await activePage.mouse.move(offImage.x, offImage.y)
        const croppedPixels = await rasterCropPixels(activePage, '501')
        for (let index = 0; index < 4; index += 1) {
          assert(JSON.stringify(croppedPixels[index]) === JSON.stringify(backgroundPixels[index]),
            `Raster crop side ${index} did not reveal the exact viewport background: ${croppedPixels[index]}.`)
        }
        for (const index of [4, 5]) {
          assert(JSON.stringify(croppedPixels[index]) === JSON.stringify(originalPixels[index]),
            'Cropping stretched or recolored the retained image pixels.')
        }
        await selectRasterImage(activePage, '501')
        const cropped = await rasterHandlerState(activePage, '501')

        // Moving a crop side back toward the source edge reveals the original
        // embedded pixels; it never asks the user to reload the raster file.
        const restorePoint = await rasterLocalScreenPoint(activePage, '501', original.x, original.y + original.height / 2)
        const left = cropped.handlers.find(value => value.index === 7)
        await activePage.mouse.click(left.x, left.y)
        await activePage.waitForFunction(() => window.editor.isEditingVertex)
        await activePage.mouse.move(restorePoint.x, restorePoint.y)
        await activePage.mouse.click(restorePoint.x, restorePoint.y)
        await activePage.waitForFunction(() => !window.editor.isEditingVertex)
        const restored = await rasterHandlerState(activePage, '501')
        assertNear(restored.crop[3], 0, 1.5, 'Restored left crop percentage')
        assertRasterIdentity(original, restored)
        await undoRedoRasterHandler(activePage, '501', cropped, restored)
        await activePage.keyboard.down(controlKey())
        await activePage.keyboard.press('KeyZ')
        await activePage.keyboard.up(controlKey())

        const beforeCancel = await rasterHandlerState(activePage, '501')
        const top = beforeCancel.handlers.find(value => value.index === 4)
        const cancelPoint = await rasterLocalScreenPoint(activePage, '501', original.x + original.width / 2, original.y + original.height * .35)
        await activePage.mouse.click(top.x, top.y)
        await activePage.waitForFunction(() => window.editor.isEditingVertex)
        await activePage.mouse.move(cancelPoint.x, cancelPoint.y)
        await activePage.waitForFunction(clip => document.getElementById('501').getAttribute('clip-path') !== clip, {}, beforeCancel.clip)
        await activePage.keyboard.press('Escape')
        await activePage.waitForFunction(() => !window.editor.isEditingVertex)
        const cancelled = await rasterHandlerState(activePage, '501')
        assertRasterGeometry(beforeCancel, cancelled)
        assertRasterIdentity(beforeCancel, cancelled)
        assert(cancelled.historyDepth === beforeCancel.historyDepth && cancelled.revision === beforeCancel.revision,
          'Cancelling a crop changed History or the document revision.')
        assert(!cancelled.editing && !cancelled.interacting && !cancelled.drawing, 'Cancelling a crop left image interaction active.')

        await selectRasterImage(activePage, '501')
        await activePage.evaluate(() => window.editor.ortho = false)
        const beforeMove = await rasterHandlerState(activePage, '501')
        const centerX = beforeMove.x + beforeMove.width * (1 + (beforeMove.crop[3] - beforeMove.crop[1]) / 100) / 2
        const centerY = beforeMove.y + beforeMove.height * (1 + (beforeMove.crop[0] - beforeMove.crop[2]) / 100) / 2
        const movePoint = await rasterLocalScreenPoint(activePage, '501', centerX + 5, centerY + 4)
        const center = beforeMove.handlers.find(value => value.index === 8)
        await activePage.mouse.click(center.x, center.y)
        await activePage.waitForFunction(() => window.editor.isEditingVertex)
        await activePage.mouse.move(movePoint.x, movePoint.y)
        await activePage.mouse.click(movePoint.x, movePoint.y)
        await activePage.waitForFunction(() => !window.editor.isEditingVertex)
        const moved = await rasterHandlerState(activePage, '501')
        assertNear(moved.x, beforeMove.x + 5, .4, 'Cropped image translated x coordinate')
        assertNear(moved.y, beforeMove.y + 4, .4, 'Cropped image translated y coordinate')
        assert(moved.clip === beforeMove.clip, 'Translating a cropped image discarded its crop.')
        assertRasterIdentity(beforeMove, moved)
        await undoRedoRasterHandler(activePage, '501', beforeMove, moved)
        await activePage.evaluate(() => window.editor.ortho = true)

        const beforeResize = await rasterHandlerState(activePage, '501')
        const visibleLeft = beforeResize.x + beforeResize.width * beforeResize.crop[3] / 100
        const visibleTop = beforeResize.y + beforeResize.height * beforeResize.crop[0] / 100
        const visibleWidth = beforeResize.width * (1 - (beforeResize.crop[1] + beforeResize.crop[3]) / 100)
        const visibleHeight = beforeResize.height * (1 - (beforeResize.crop[0] + beforeResize.crop[2]) / 100)
        const resizePoint = await rasterLocalScreenPoint(activePage, '501', visibleLeft + visibleWidth * 1.2, visibleTop + visibleHeight * 1.2)
        const bottomRight = beforeResize.handlers.find(value => value.index === 2)
        await activePage.mouse.click(bottomRight.x, bottomRight.y)
        await activePage.waitForFunction(() => window.editor.isEditingVertex)
        await activePage.mouse.move(resizePoint.x, resizePoint.y)
        await activePage.mouse.click(resizePoint.x, resizePoint.y)
        await activePage.waitForFunction(() => !window.editor.isEditingVertex)
        const resized = await rasterHandlerState(activePage, '501')
        assert(resized.clip === beforeResize.clip, 'Resizing a cropped image discarded its crop.')
        assertNear(resized.width / resized.height, original.width / original.height, 1e-5, 'Cropped image resize aspect ratio')
        assertNear(resized.x + resized.width * resized.crop[3] / 100, visibleLeft, 1e-5, 'Cropped image resize fixed left edge')
        assertNear(resized.y + resized.height * resized.crop[0] / 100, visibleTop, 1e-5, 'Cropped image resize fixed top edge')
        assertRasterIdentity(original, resized)
        await undoRedoRasterHandler(activePage, '501', beforeResize, resized)

        const beforeReopen = await rasterHandlerState(activePage, '501')
        const roundtrip = await activePage.evaluate(async () => {
          const saved = await window.editor.documents.saveAs({ suggestedName: 'browser-cropped-image.svg' })
          if (!saved?.ok) return { saved, error: saved?.error?.message }
          const download = window.__nanquimBrowserDownloads.at(-1)
          const source = await download.blob.text()
          const reopened = await window.editor.documents.openFile(new File([source], download.name, { type: 'image/svg+xml' }))
          return { saved, reopened }
        })
        trace('raster-crop-roundtrip', roundtrip)
        assert(roundtrip.saved?.ok && roundtrip.reopened?.ok, `The cropped image could not be saved and reopened: ${roundtrip.error || ''}`)
        const reopened = await rasterHandlerState(activePage, '501')
        assertRasterGeometry(beforeReopen, reopened)
        assertRasterIdentity(beforeReopen, reopened)
        await selectRasterImage(activePage, '501')
        assertRasterHandlers(await rasterHandlerState(activePage, '501'))

        // A stylesheet can deliberately override the presentation crop. Keep
        // that rendering and expose only move/resize grips while CSS owns it.
        await activePage.keyboard.press('Escape')
        await activePage.mouse.move(offImage.x, offImage.y)
        await activePage.evaluate(() => {
          const style = document.createElement('style')
          style.dataset.browserCropOverride = 'true'
          style.textContent = '#Collection image[id="501"] { clip-path: none; }'
          document.head.appendChild(style)
        })
        try {
          const cssPixels = await rasterCropPixels(activePage, '501')
          assert(JSON.stringify(cssPixels[1]) === '[20,60,230,255]'
            && JSON.stringify(cssPixels[3]) === '[237,49,86,255]', 'The CSS crop override did not reveal the original image edges.')
          await selectRasterImage(activePage, '501')
          const cssOwned = await rasterHandlerState(activePage, '501')
          assert(cssOwned.handlers.length === 5 && cssOwned.handlers.every(handler => handler.index < 4 || handler.index === 8),
            'An image whose clip is owned by CSS exposed crop grips.')
          assertRasterGeometry(reopened, cssOwned)
          assertRasterIdentity(reopened, cssOwned)
        } finally {
          await activePage.evaluate(() => {
            document.querySelector('style[data-browser-crop-override]').remove()
            window.editor.signals.updatedSelection.dispatch()
          })
        }
        assertRasterHandlers(await rasterHandlerState(activePage, '501'))
        trace('raster-crop', { ...scenario, clip: reopened.clip, pixels: croppedPixels })
      }
    } finally {
      await activePage.keyboard.press('Escape')
      if (browserName === 'chromium') await activePage.setViewport(BROWSER_VIEWPORT)
      await activePage.evaluate(previous => {
        if (previous === null) localStorage.removeItem('nanquim-preferences')
        else localStorage.setItem('nanquim-preferences', previous)
      }, originalPreferences)
    }
  })
}

async function rasterCropPixels(activePage, id, hide = false) {
  const points = await activePage.evaluate(({ id, hide }) => {
    const image = document.getElementById(id)
    if (hide) {
      const style = document.createElement('style')
      style.dataset.browserCropBackground = 'true'
      style.textContent = `#Collection image[id="${id}"] { visibility: hidden !important; }`
      document.head.appendChild(style)
    }
    const x = Number(image.getAttribute('x'))
    const y = Number(image.getAttribute('y'))
    const width = Number(image.getAttribute('width'))
    const height = Number(image.getAttribute('height'))
    return [[.5, .1], [.9, .5], [.5, .9], [.1, .5], [.3, .4], [.7, .6]].map(([u, v]) => {
      const point = new DOMPoint(x + u * width, y + v * height).matrixTransform(image.instance.screenCTM())
      return { x: Math.floor(point.x), y: Math.floor(point.y) }
    })
  }, { id, hide })
  await activePage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const screenshot = await activePage.screenshot({ encoding: 'base64' })
  const pixels = await activePage.evaluate(async ({ screenshot, points }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${screenshot}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0)
    return points.map(point => Array.from(context.getImageData(point.x, point.y, 1, 1).data))
  }, { screenshot, points })
  if (hide) await activePage.evaluate(() => document.querySelector('style[data-browser-crop-background]').remove())
  return pixels
}

async function selectRasterImage(activePage, id) {
  await activePage.keyboard.press('Escape')
  const state = await rasterHandlerState(activePage, id)
  const center = state.points[8]
  const offGeometry = await canvasScreenPoint(activePage, 0.15, 0.15)
  await activePage.mouse.move(offGeometry.x, offGeometry.y)
  await activePage.mouse.move(center.x, center.y)
  await activePage.waitForFunction(imageId => window.editor.hoveredElements.some(element => element.node.id === imageId), {}, id)
  await activePage.mouse.click(center.x, center.y)
  await activePage.waitForFunction(imageId => window.editor.selected.some(element => element.node.id === imageId), {}, id)
}

async function rasterLocalScreenPoint(activePage, id, x, y) {
  return activePage.evaluate(({ id, x, y }) => {
    const image = document.getElementById(id)
    const point = new DOMPoint(x, y).matrixTransform(image.instance.screenCTM())
    return { x: Math.round(point.x), y: Math.round(point.y) }
  }, { id, x, y })
}

async function rasterHandlerState(activePage, id) {
  return activePage.evaluate(imageId => {
    const editor = window.editor
    const image = document.getElementById(imageId)
    const x = Number(image.getAttribute('x'))
    const y = Number(image.getAttribute('y'))
    const width = Number(image.getAttribute('width'))
    const height = Number(image.getAttribute('height'))
    const clip = image.getAttribute('clip-path')
    const clipValue = getComputedStyle(image).clipPath
    const insets = clipValue.match(/^inset\(([^)]+)\)/)?.[1].split(/\s+/).map(parseFloat) || [0]
    const crop = [insets[0], insets[1] ?? insets[0], insets[2] ?? insets[0], insets[3] ?? insets[1] ?? insets[0]]
    const left = x + width * crop[3] / 100
    const right = x + width * (1 - crop[1] / 100)
    const top = y + height * crop[0] / 100
    const bottom = y + height * (1 - crop[2] / 100)
    const matrix = image.instance.screenCTM()
    editor.documentState.flushObservedMutations()
    return {
      x, y, width, height, clip, crop,
      href: image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
      transform: image.getAttribute('transform'),
      parent: image.parentElement.id,
      parentTransform: image.parentElement.getAttribute('transform'),
      historyDepth: editor.history.undos.length,
      revision: editor.documentState.revision,
      editing: editor.isEditingVertex,
      interacting: editor.isInteracting,
      drawing: editor.isDrawing,
      points: [[left, top], [right, top], [right, bottom], [left, bottom],
        [(left + right) / 2, top], [right, (top + bottom) / 2],
        [(left + right) / 2, bottom], [left, (top + bottom) / 2], [(left + right) / 2, (top + bottom) / 2]]
        .map(([px, py]) => {
          const point = new DOMPoint(px, py).matrixTransform(matrix)
          return { x: point.x, y: point.y }
        }),
      handlers: Array.from(document.querySelectorAll('#Handlers .selection-handler'), handler => {
        const bounds = handler.getBoundingClientRect()
        const localBounds = handler.getBBox()
        const handlerMatrix = handler.getScreenCTM()
        const style = getComputedStyle(handler)
        return {
          index: Number(handler.dataset.imageGrip),
          label: handler.getAttribute('aria-label'),
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
          width: bounds.width,
          height: bounds.height,
          edgeWidth: localBounds.width * Math.hypot(handlerMatrix.a, handlerMatrix.b),
          edgeHeight: localBounds.height * Math.hypot(handlerMatrix.c, handlerMatrix.d),
          axis: { x: handlerMatrix.a, y: handlerMatrix.b },
          visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
            && (style.fill !== 'none' || style.stroke !== 'none') && bounds.width > 0 && bounds.height > 0,
        }
      }),
    }
  }, id)
}

function assertRasterHandlers(state) {
  assert(state.handlers.length === 9, `Expected nine image handlers, got ${state.handlers.length}.`)
  const size = state.handlers.find(handler => handler.index === 8).edgeWidth
  state.handlers.forEach(handler => {
    const index = handler.index
    assert(handler.visible, `Image handler ${index} has no visible painted appearance.`)
    assertNear(handler.x, state.points[index].x, 0.1, `Image handler ${index} screen x`)
    assertNear(handler.y, state.points[index].y, 0.1, `Image handler ${index} screen y`)
    const isCrop = index >= 4 && index <= 7
    assertNear(handler.edgeWidth, size * (isCrop ? 1.5 : 1), 0.1, `Image handler ${index} screen width`)
    assertNear(handler.edgeHeight, size * (isCrop ? 0.375 : 1), 0.1, `Image handler ${index} screen height`)
    if (isCrop) {
      const start = state.points[0]
      const end = state.points[index === 4 || index === 6 ? 1 : 3]
      const dx = end.x - start.x
      const dy = end.y - start.y
      const alignment = (handler.axis.x * dy - handler.axis.y * dx)
        / (Math.hypot(handler.axis.x, handler.axis.y) * Math.hypot(dx, dy))
      assertNear(alignment, 0, 0.001, `Image crop handler ${index} edge alignment`)
    }
  })
}

function assertRasterGeometry(expected, actual) {
  for (const name of ['x', 'y', 'width', 'height']) {
    assertNear(actual[name], expected[name], 1e-5, `Image ${name}`)
  }
  assert(actual.clip === expected.clip, 'Image crop changed unexpectedly.')
}

function assertRasterIdentity(expected, actual) {
  for (const name of ['href', 'transform', 'parent', 'parentTransform']) {
    assert(actual[name] === expected[name], `Image handlers changed the image ${name}.`)
  }
}

async function undoRedoRasterHandler(activePage, id, before, after) {
  await activePage.keyboard.down(controlKey())
  await activePage.keyboard.press('KeyZ')
  await activePage.keyboard.up(controlKey())
  const undone = await rasterHandlerState(activePage, id)
  assertRasterGeometry(before, undone)
  assertRasterIdentity(before, undone)
  assertRasterHandlers(undone)
  await activePage.keyboard.down(controlKey())
  await activePage.keyboard.down('Shift')
  await activePage.keyboard.press('KeyZ')
  await activePage.keyboard.up('Shift')
  await activePage.keyboard.up(controlKey())
  const redone = await rasterHandlerState(activePage, id)
  assertRasterGeometry(after, redone)
  assertRasterIdentity(after, redone)
  assertRasterHandlers(redone)
}

async function assertRasterPaint(activePage, id = null) {
  await activePage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const point = await activePage.evaluate((imageId) => {
    const image = imageId ? document.getElementById(imageId) : window.editor.drawing.node.querySelector('image')
    const bounds = image?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
    // Sample inside the image away from its center translation handler.
    const point = new DOMPoint(
      Number(image.getAttribute('x')) + Number(image.getAttribute('width')) / 4,
      Number(image.getAttribute('y')) + Number(image.getAttribute('height')) / 3,
    ).matrixTransform(image.instance.screenCTM())
    return { x: Math.floor(point.x), y: Math.floor(point.y) }
  }, id)
  assert(point, 'The imported image has no visible viewport bounds.')
  const screenshot = await activePage.screenshot({ clip: { ...point, width: 1, height: 1 }, encoding: 'base64' })
  const pixel = await activePage.evaluate(async (source) => {
    const image = new Image()
    image.src = `data:image/png;base64,${source}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return Array.from(context.getImageData(0, 0, 1, 1).data)
  }, screenshot)
  assert(pixel[0] === 237 && pixel[1] === 49 && pixel[2] === 86 && pixel[3] === 255,
    `The embedded raster did not paint its expected pixel in the viewport: ${pixel.join(', ')}.`)
}

async function installDeterministicBrowserCapabilities(activePage) {
  await activePage.evaluate(() => {
    window.showOpenFilePicker = undefined
    window.showSaveFilePicker = undefined
    window.__nanquimBrowserClipboard = ''
    window.__nanquimBrowserDownloads = []

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async readText() { return window.__nanquimBrowserClipboard },
        async writeText(value) { window.__nanquimBrowserClipboard = String(value) },
      },
    })

    const originalCreateObjectURL = URL.createObjectURL.bind(URL)
    const originalAnchorClick = HTMLAnchorElement.prototype.click
    const originalAnchorDispatchEvent = HTMLAnchorElement.prototype.dispatchEvent
    URL.createObjectURL = blob => {
      const url = originalCreateObjectURL(blob)
      window.__nanquimBrowserObjectUrls ||= new Map()
      window.__nanquimBrowserObjectUrls.set(url, blob)
      return url
    }
    const captureFallbackDownload = (anchor) => {
      if (!anchor.download || !window.__nanquimBrowserObjectUrls?.has(anchor.href)) return false
      window.__nanquimBrowserDownloads.push({
        blob: window.__nanquimBrowserObjectUrls.get(anchor.href),
        name: anchor.download,
      })
      return true
    }
    HTMLAnchorElement.prototype.click = function () {
      if (captureFallbackDownload(this)) return
      return originalAnchorClick.call(this)
    }
    HTMLAnchorElement.prototype.dispatchEvent = function (event) {
      if (event?.type === 'click' && captureFallbackDownload(this)) return true
      return originalAnchorDispatchEvent.call(this, event)
    }
  })
  const fileApiState = await activePage.evaluate(() => ({
    open: typeof window.showOpenFilePicker,
    save: typeof window.showSaveFilePicker,
  }))
  assert(
    fileApiState.open === 'undefined' && fileApiState.save === 'undefined',
    'The browser harness must not grant live file-system handles.',
  )
}

async function selectDimensionedRectangle(activePage) {
  const current = await activePage.evaluate((expectedWidth) => {
    const rect = Array.from(document.querySelectorAll('#Collection rect'))
      .find(candidate => Number(candidate.getAttribute('width')) === expectedWidth)
    if (!rect) return null
    const ctm = rect.getScreenCTM()
    if (!ctm) return null
    const topEdge = new DOMPoint(
      Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2,
      Number(rect.getAttribute('y')),
    ).matrixTransform(ctm)
    return {
      x: Number(rect.getAttribute('x')),
      y: Number(rect.getAttribute('y')),
      screenX: topEdge.x,
      screenY: topEdge.y,
    }
  }, TEST_RECTANGLE_WIDTH)
  assert(current, 'Could not locate the typed rectangle for pointer selection.')

  // Exercise the same deselect/hover/click path a user takes. This prevents a
  // command-created selection from making the workflow pass without testing
  // viewport hit-testing and the visible selection affordances.
  await activePage.keyboard.press('Escape')
  await activePage.waitForFunction((expectedWidth) => {
    const rect = Array.from(document.querySelectorAll('#Collection rect'))
      .find(candidate => Number(candidate.getAttribute('width')) === expectedWidth)
    return rect
      && !window.editor.selected?.some(element => element?.node === rect)
      && !rect.classList.contains('elementSelected')
  }, {}, TEST_RECTANGLE_WIDTH)

  const offGeometryPoint = await canvasScreenPoint(activePage, 0.15, 0.15)
  await activePage.mouse.move(offGeometryPoint.x, offGeometryPoint.y)
  await activePage.mouse.move(current.screenX, current.screenY)
  await activePage.waitForFunction((expectedWidth) => {
    const rect = Array.from(document.querySelectorAll('#Collection rect'))
      .find(candidate => Number(candidate.getAttribute('width')) === expectedWidth)
    return rect && window.editor.hoveredElements?.some(element => element?.node === rect)
  }, {}, TEST_RECTANGLE_WIDTH)
  await activePage.mouse.click(current.screenX, current.screenY)
  await activePage.waitForFunction((expectedWidth) => {
    const rect = Array.from(document.querySelectorAll('#Collection rect'))
      .find(candidate => Number(candidate.getAttribute('width')) === expectedWidth)
    return rect
      && window.editor.selected?.some(element => element?.node === rect)
      && rect.classList.contains('elementSelected')
      && document.querySelectorAll('#Handlers .selection-handler').length > 0
  }, {}, TEST_RECTANGLE_WIDTH)

  return { x: current.x, y: current.y }
}

async function drawingElementCount(activePage) {
  return activePage.evaluate(() => document.querySelectorAll('#Collection > [data-collection] > *').length)
}

async function transientCounts(activePage) {
  return activePage.evaluate(() => ({
    overlays: document.querySelector('#Overlays')?.childElementCount || 0,
    snap: document.querySelector('#Snap')?.childElementCount || 0,
    handlers: document.querySelector('#Handlers')?.childElementCount || 0,
    previews: document.querySelectorAll(
      '[data-nanquim-transient], [data-rectangle-preview], .move-ghost, .command-preview',
    ).length,
  }))
}

async function waitForRectanglePosition(activePage, x, y) {
  await activePage.waitForFunction(({ expectedWidth, expectedX, expectedY }) => {
    const rect = Array.from(document.querySelectorAll('#Collection rect'))
      .find(candidate => Number(candidate.getAttribute('width')) === expectedWidth)
    return rect && Number(rect.getAttribute('x')) === expectedX && Number(rect.getAttribute('y')) === expectedY
  }, {}, {
    expectedWidth: TEST_RECTANGLE_WIDTH,
    expectedX: x,
    expectedY: y,
  })
}

async function runTerminalCommand(activePage, command) {
  await activePage.focus('#terminalInput')
  await activePage.evaluate(() => { document.getElementById('terminalInput').value = '' })
  await activePage.keyboard.type(command)
  await activePage.keyboard.press('Enter')
}

async function typeTerminalValue(activePage, value) {
  await activePage.focus('#terminalInput')
  await activePage.keyboard.type(value)
  await activePage.keyboard.press('Enter')
}

async function waitForTerminalText(activePage, text) {
  await activePage.waitForFunction(expected => (
    document.getElementById('terminalLog')?.textContent?.includes(expected)
  ), {}, text)
}

async function canvasScreenPoint(activePage, xRatio, yRatio) {
  const point = await activePage.evaluate(({ x, y }) => {
    const canvas = document.querySelector('#canvas > svg')
    const rect = canvas?.getBoundingClientRect()
    return rect ? { x: rect.left + rect.width * x, y: rect.top + rect.height * y } : null
  }, { x: xRatio, y: yRatio })
  assert(point, 'Could not locate the Model Space SVG.')
  return point
}

function controlKey() {
  return process.platform === 'darwin' ? 'Meta' : 'Control'
}

async function step(name, callback) {
  const entry = {
    kind: 'step',
    name,
    status: 'running',
    startedAt: new Date().toISOString(),
  }
  actionTrace.push(entry)
  process.stdout.write(`- ${name} ... `)
  try {
    await callback()
    entry.status = 'passed'
    process.stdout.write('passed\n')
  } catch (error) {
    entry.status = 'failed'
    entry.error = { message: error.message, stack: error.stack }
    process.stdout.write('failed\n')
    throw error
  } finally {
    entry.finishedAt = new Date().toISOString()
  }
}

function trace(kind, detail) {
  actionTrace.push({ kind, at: new Date().toISOString(), detail })
}

function attachDiagnostics(activePage) {
  activePage.on('console', message => {
    consoleEntries.push({
      at: new Date().toISOString(),
      type: message.type(),
      text: message.text(),
      location: message.location(),
    })
  })
  activePage.on('pageerror', error => {
    pageErrors.push({ at: new Date().toISOString(), message: error.message, stack: error.stack })
  })
  activePage.on('requestfailed', request => {
    requestFailures.push({
      at: new Date().toISOString(),
      method: request.method(),
      url: request.url(),
      error: request.failure()?.errorText,
    })
  })
  activePage.on('response', response => {
    if (response.status() >= 400) {
      httpErrors.push({
        at: new Date().toISOString(),
        status: response.status(),
        url: response.url(),
      })
    }
  })
  activePage.on('dialog', async dialog => {
    trace('dialog', { type: dialog.type(), message: dialog.message() })
    await dialog.accept()
  })
}

async function assertNoRuntimeErrors() {
  const errorConsole = consoleEntries.filter(entry => entry.type === 'error')
  assert(pageErrors.length === 0, `Encountered ${pageErrors.length} uncaught page error(s).`)
  assert(requestFailures.length === 0, `Encountered ${requestFailures.length} failed request(s).`)
  assert(httpErrors.length === 0, `Encountered ${httpErrors.length} HTTP error response(s).`)
  assert(errorConsole.length === 0, `Encountered ${errorConsole.length} console error(s).`)
}

async function startPreviewServer(serverPort, outputDirectory) {
  await access(join(ROOT, 'dist/index.html'), fsConstants.R_OK).catch(() => {
    throw new Error('Production output is missing. Run `pnpm build` before the browser harness.')
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
  child.once('exit', code => trace('preview-exit', { code }))

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
  await writeFile(logPath, chunks.join(''), 'utf8')
  child.kill('SIGTERM')
  throw new Error('Timed out waiting for the Vite preview server.')
}

async function stopPreviewServer(preview) {
  const { child, chunks, logPath } = preview
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
  const configured = cli.executable || process.env.NANQUIM_BROWSER_EXECUTABLE
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
    } catch (_) { /* try next path */ }
  }
  throw new Error(
    `Could not find ${name}. Set NANQUIM_BROWSER_EXECUTABLE to a runnable browser binary.`,
  )
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertNear(actual, expected, tolerance, label) {
  assert(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `Expected ${label} to be ${expected} ± ${tolerance}, received ${actual}.`,
  )
}

function parseArguments(argumentsList) {
  return Object.fromEntries(argumentsList.map(argument => {
    const normalized = argument.replace(/^--/, '')
    const separator = normalized.indexOf('=')
    return separator < 0
      ? [normalized, true]
      : [normalized.slice(0, separator), normalized.slice(separator + 1)]
  }))
}
