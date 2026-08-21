import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import {
  assertSafeArtifactsDirectory,
  assertSafeRunDirectory,
  isWithin,
} from '../scripts/browser/path-safety.mjs'

describe('browser harness path safety', () => {
  const repositoryRoot = '/workspace/nanquim'
  const temporaryRoot = '/tmp'

  test('accepts a dedicated per-run directory below the system temporary root', () => {
    expect(assertSafeRunDirectory('/tmp/nanquim-browser-a1b2c3', {
      repositoryRoot,
      temporaryRoot,
    })).toBe('/tmp/nanquim-browser-a1b2c3')
  })

  test.each([
    '/tmp',
    '/tmp/unrelated-run',
    '/workspace/nanquim',
    '/workspace/nanquim/public',
    '/workspace/nanquim/src',
    '/workspace/nanquim/tests',
    '/workspace/nanquim/tests/nanquim-browser-forbidden',
  ])('rejects unsafe browser state path %s', (candidate) => {
    expect(() => assertSafeRunDirectory(candidate, {
      repositoryRoot,
      temporaryRoot,
    })).toThrow()
  })

  test('does not confuse similarly prefixed sibling paths with descendants', () => {
    expect(isWithin('/workspace/nanquim', '/workspace/nanquim-copy')).toBe(false)
  })
})

describe('browser artifact cleanup safety', () => {
  const temporaryDirectories = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(path => (
      rm(path, { recursive: true, force: true })
    )))
  })

  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'nanquim-artifact-safety-'))
    temporaryDirectories.push(root)
    const repositoryRoot = join(root, 'repository')
    const artifactsRoot = join(repositoryRoot, 'test-results/browser')
    const outside = join(root, 'outside')
    await Promise.all([
      mkdir(artifactsRoot, { recursive: true }),
      mkdir(outside),
    ])
    return { artifactsRoot, outside, repositoryRoot }
  }

  test('accepts only a strict descendant of the real artifact root', async () => {
    const paths = await fixture()
    const candidate = join(paths.artifactsRoot, 'chromium')

    await expect(assertSafeArtifactsDirectory(candidate, paths)).resolves.toBe(candidate)
    await expect(assertSafeArtifactsDirectory(paths.artifactsRoot, paths)).rejects.toThrow(
      'strict child',
    )
    await expect(assertSafeArtifactsDirectory(paths.repositoryRoot, paths)).rejects.toThrow(
      'strict child',
    )
    await expect(assertSafeArtifactsDirectory(paths.outside, paths)).rejects.toThrow(
      'strict child',
    )
  })

  test('rejects an existing symlink and a missing child below a symlink escape', async () => {
    const paths = await fixture()
    const escape = join(paths.artifactsRoot, 'escape')
    await symlink(paths.outside, escape, 'dir')

    await expect(assertSafeArtifactsDirectory(escape, paths)).rejects.toThrow('symlink')
    await expect(assertSafeArtifactsDirectory(join(escape, 'future-run'), paths)).rejects.toThrow(
      'symlink',
    )
  })

  test('validates a missing artifact tree before the harness creates it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nanquim-artifact-missing-'))
    temporaryDirectories.push(root)
    const repositoryRoot = join(root, 'repository')
    const artifactsRoot = join(repositoryRoot, 'test-results/browser')
    const candidate = join(artifactsRoot, 'chromium')
    await mkdir(repositoryRoot)

    await expect(assertSafeArtifactsDirectory(candidate, {
      artifactsRoot,
      repositoryRoot,
    })).resolves.toBe(candidate)
  })

  test('rejects an artifact root symlink even when it resolves inside the repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nanquim-artifact-root-link-'))
    temporaryDirectories.push(root)
    const repositoryRoot = join(root, 'repository')
    const artifactsParent = join(repositoryRoot, 'test-results')
    const redirected = join(repositoryRoot, 'src')
    const artifactsRoot = join(artifactsParent, 'browser')
    await Promise.all([
      mkdir(artifactsParent, { recursive: true }),
      mkdir(redirected, { recursive: true }),
    ])
    await symlink(redirected, artifactsRoot, 'dir')

    await expect(assertSafeArtifactsDirectory(join(artifactsRoot, 'chromium'), {
      artifactsRoot,
      repositoryRoot,
    })).rejects.toThrow('symlink')
  })
})
