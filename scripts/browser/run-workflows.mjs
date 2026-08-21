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
      const beforeDownloads = window.__nanquimBrowserDownloads.length
      window.editor.paperEditor.exportSVG()
      const download = window.__nanquimBrowserDownloads.at(-1)
      const source = download ? await download.blob.text() : ''
      const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
      return {
        annotationLines: parsed.querySelectorAll('#paper-annotations line').length,
        count: window.editor.paperViewports.length,
        downloaded: window.__nanquimBrowserDownloads.length === beforeDownloads + 1,
        isPaperDocument: parsed.documentElement.getAttribute('data-nanquim-paper') === 'true',
        name: download?.name,
        parserError: Boolean(parsed.querySelector('parsererror')),
        type: download?.blob?.type,
        viewportUses: parsed.querySelectorAll('[data-paper-viewport="true"] use').length,
      }
    })
    assert(exportResult.count === before + 1, 'Paper viewport count did not increase.')
    assert(exportResult.downloaded, 'Paper SVG export did not trigger a download.')
    assert(/\.svg$/i.test(exportResult.name || ''), 'Paper export did not use an SVG filename.')
    assert(!exportResult.parserError && exportResult.isPaperDocument, 'Paper export was not a well-formed Paper SVG.')
    assert(exportResult.viewportUses > 0, 'Paper export omitted its model viewport reference.')
    assert(exportResult.annotationLines > 0, 'Paper export omitted the edited Paper annotation.')
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
    URL.createObjectURL = blob => {
      const url = originalCreateObjectURL(blob)
      window.__nanquimBrowserObjectUrls ||= new Map()
      window.__nanquimBrowserObjectUrls.set(url, blob)
      return url
    }
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && window.__nanquimBrowserObjectUrls?.has(this.href)) {
        window.__nanquimBrowserDownloads.push({
          blob: window.__nanquimBrowserObjectUrls.get(this.href),
          name: this.download,
        })
        return
      }
      return originalAnchorClick.call(this)
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

function parseArguments(argumentsList) {
  return Object.fromEntries(argumentsList.map(argument => {
    const normalized = argument.replace(/^--/, '')
    const separator = normalized.indexOf('=')
    return separator < 0
      ? [normalized, true]
      : [normalized.slice(0, separator), normalized.slice(separator + 1)]
  }))
}
