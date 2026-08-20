// @vitest-environment jsdom

import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

const projectPath = (...parts) => join(process.cwd(), ...parts)

async function collectFiles(directory, extensions) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collectFiles(path, extensions)
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : []
  }))
  return nested.flat()
}

describe('Nanquim icon identity', () => {
  test('maps every live icon class to the project-authored mask sheet', async () => {
    const runtimeFiles = await collectFiles(projectPath('src'), ['.js', '.pug'])
    const [iconStyles, identityStyles, ...runtimeSources] = await Promise.all([
      readFile(projectPath('src', 'styles', 'components', '_icon.sass'), 'utf8'),
      readFile(projectPath('src', 'styles', '_identity.sass'), 'utf8'),
      ...runtimeFiles.map((path) => readFile(path, 'utf8')),
    ])
    const liveClasses = new Set(runtimeSources.flatMap((source) => (
      [...source.matchAll(/(?<![a-z0-9_-])(icon-[a-z][a-z0-9_-]*)/g)]
        .map((match) => match[1])
    )))

    liveClasses.delete('icon-off')
    liveClasses.delete('icon-on')

    const mappedClasses = new Set(
      [...iconStyles.matchAll(/&\.(icon-[a-z][a-z0-9_-]*)/g)]
        .map((match) => match[1]),
    )

    expect(liveClasses.size).toBeGreaterThan(20)
    expect([...liveClasses].filter((name) => !mappedClasses.has(name))).toEqual([])
    expect(iconStyles).toContain("mask-image: url('/assets/img/nanquim-icons.svg')")
    expect(iconStyles).toContain('background-color: currentColor')
    expect(iconStyles).toContain('--icon-glyph-size: var(--icon-size)')
    expect(iconStyles).toContain('--icon-hit-size: 24px')
    expect(iconStyles).toContain('--icon-hit-size: 28px')
    expect(identityStyles).toContain('flex: 0 0 36px')
    expect(iconStyles).not.toContain('blender_icons')
  })

  test('keeps a valid, uniquely named 8x8 SVG mask sheet', async () => {
    const [sprite, logo] = await Promise.all([
      readFile(projectPath('public', 'assets', 'img', 'nanquim-icons.svg'), 'utf8'),
      readFile(projectPath('public', 'assets', 'img', 'nanquim-logo.svg'), 'utf8'),
    ])
    const document = new DOMParser().parseFromString(sprite, 'image/svg+xml')
    const logoDocument = new DOMParser().parseFromString(logo, 'image/svg+xml')
    const root = document.documentElement
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)

    expect(document.querySelector('parsererror')).toBeNull()
    expect(logoDocument.querySelector('parsererror')).toBeNull()
    expect(logoDocument.querySelector('title')?.textContent).toBe('Nanquim')
    expect(root.getAttribute('viewBox')).toBe('0 0 192 192')
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining([
      'nib',
      'canvas',
      'line',
      'circle',
      'rectangle',
      'overlay',
      'collection-add',
      'dimensions',
      'text',
      'transform',
      'constraints',
    ]))
  })

  test('contains no active reference to the retired Blender-derived artwork', async () => {
    const auditedFiles = [
      projectPath('index.html'),
      projectPath('src', 'styles', 'components', '_icon.sass'),
      projectPath('docs', 'asset-provenance.md'),
      projectPath('THIRD_PARTY_NOTICES.md'),
    ]
    const sources = await Promise.all(auditedFiles.map((path) => readFile(path, 'utf8')))

    expect(sources.join('\n')).not.toMatch(/blender[_-]icons|properties-element\.svg|properties-textstyles\.svg/i)
    await Promise.all([
      projectPath('public', 'assets', 'img', 'blender_icons.svg'),
      projectPath('public', 'assets', 'img', 'icons', 'properties-element.svg'),
      projectPath('public', 'assets', 'img', 'icons', 'properties-textstyles.svg'),
    ].map(async (path) => {
      await expect(access(path)).rejects.toThrow()
    }))
  })
})
