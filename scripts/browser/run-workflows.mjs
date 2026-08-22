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
