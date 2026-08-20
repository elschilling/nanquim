// @vitest-environment jsdom

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import packageMetadata from '../package.json'
import commands from '../src/js/commands/_commands.js'

const projectPath = (...parts) => join(process.cwd(), ...parts)
const readProjectFile = (...parts) => readFile(projectPath(...parts), 'utf8')

describe('Phase 0 release metadata', () => {
  test('keeps package, changelog, release notes, and visible labels aligned', async () => {
    const version = packageMetadata.version
    const [changelog, releaseNotes, indexHtml, statusBar, versionModule] = await Promise.all([
      readProjectFile('CHANGELOG.md'),
      readProjectFile('docs', 'releases', `v${version}.md`),
      readProjectFile('index.html'),
      readProjectFile('src', 'templates', 'StatusBar.pug'),
      readProjectFile('src', 'js', 'applicationVersion.js'),
    ])

    expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
    expect(changelog).toContain(`## [${version}]`)
    expect(releaseNotes).toContain(`# Nanquim v${version}`)
    expect(indexHtml).toContain('<title data-application-version>nanquim</title>')
    expect(statusBar).toContain('li(data-application-version)')
    expect(versionModule).toContain('__NANQUIM_APP_VERSION__')
    expect(`${indexHtml}\n${statusBar}\n${versionModule}`).not.toContain('0.0.0')
  })

  test('keeps application and persisted-data version domains independent', async () => {
    const [documentSerializer, geometryNodeManager, nodeGraph] = await Promise.all([
      readProjectFile('src', 'js', 'document', 'DocumentSerializer.js'),
      readProjectFile('src', 'js', 'geometry-nodes', 'GeometryNodeManager.js'),
      readProjectFile('src', 'js', 'geometry-nodes', 'core', 'NodeGraph.js'),
    ])

    expect(documentSerializer).toContain('const DOCUMENT_SCHEMA_VERSION = 3')
    expect(geometryNodeManager).toContain('const SCHEMA_VERSION = 1')
    expect(nodeGraph).toContain('const GRAPH_SCHEMA_VERSION = 1')
    expect(`${documentSerializer}\n${geometryNodeManager}\n${nodeGraph}`).not.toContain(packageMetadata.version)
  })
})

describe('Phase 0 documentation sources of truth', () => {
  test('documents every registered command in README and the capability count', async () => {
    const [readme, capabilities] = await Promise.all([
      readProjectFile('README.md'),
      readProjectFile('docs', 'capabilities.md'),
    ])
    const commandSection = readme
      .split('## Commands and aliases')[1]
      ?.split('### Useful keys')[0]

    expect(commandSection).toBeTruthy()
    Object.keys(commands).forEach((name) => {
      expect(commandSection, name).toContain(`\`${name} (`)
    })
    expect(capabilities).toContain(`${Object.keys(commands).length} registered commands`)
  })

  test('uses only the inventoried bundled font files', async () => {
    const [indexHtml, mainStyles, fontStyles, exportPaper, provenance, publicEntries] = await Promise.all([
      readProjectFile('index.html'),
      readProjectFile('src', 'styles', 'main.sass'),
      readProjectFile('src', 'styles', '_fonts.sass'),
      readProjectFile('src', 'js', 'utils', 'ExportPaper.js'),
      readProjectFile('docs', 'asset-provenance.md'),
      readdir(projectPath('public'), { recursive: true }),
    ])

    const fontFiles = (await readdir(projectPath('public', 'fonts', 'generated')))
      .filter((name) => name.endsWith('.ttf'))
      .sort()
    const styledFontFiles = [...new Set(Array.from(
      fontStyles.matchAll(/['"]([^'"]+\.ttf)['"]/g),
      (match) => match[1],
    ))].sort()

    expect(indexHtml).not.toMatch(/fonts\.(googleapis|gstatic)\.com/)
    expect(mainStyles).toContain("@use 'fonts'")
    expect(styledFontFiles).toEqual(fontFiles)
    fontFiles.forEach((name) => expect(exportPaper, name).toContain(name))
    for (const family of ['Inter', 'DM Sans', 'Fira Code', 'JetBrains Mono']) {
      expect(provenance, family).toContain(family)
    }
    expect(publicEntries.some((entry) => /^tests(?:[\\/]|$)/.test(entry))).toBe(false)
  })

  test('records every retained public visual and browser-global library', async () => {
    const [provenance, notices] = await Promise.all([
      readProjectFile('docs', 'asset-provenance.md'),
      readProjectFile('THIRD_PARTY_NOTICES.md'),
    ])
    const retainedAssets = [
      'public/assets/img/nanquim-icons.svg',
      'public/assets/img/nanquim-logo.svg',
      'public/js/libs/signals.js',
      'public/js/libs/svg.js/svg.js',
      'public/js/libs/svg.js/svg.panzoom.js',
      'public/js/libs/svg.js/svg.draw.js',
      'public/js/libs/svg.js/svg.draw.js.map',
      'public/js/libs/svg.js/svg.select.js',
    ]

    retainedAssets.forEach((asset) => expect(provenance, asset).toContain(asset))
    expect(notices).toMatch(/SIL Open Font\s+License/)
    expect(notices).toContain('Vendored browser libraries')
  })
})
