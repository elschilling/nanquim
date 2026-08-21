import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

function isWithin(parent, candidate) {
  const relation = relative(resolve(parent), resolve(candidate))
  return relation === '' || (
    relation !== '..'
    && !relation.startsWith(`..${sep}`)
    && !isAbsolute(relation)
  )
}

function assertSafeRunDirectory(candidate, {
  repositoryRoot,
  temporaryRoot,
} = {}) {
  if (!candidate || !repositoryRoot || !temporaryRoot) {
    throw new TypeError('Run, repository, and temporary directories are required.')
  }

  const runDirectory = resolve(candidate)
  const repositoryDirectory = resolve(repositoryRoot)
  const systemTemporaryDirectory = resolve(temporaryRoot)

  if (runDirectory === systemTemporaryDirectory || !isWithin(systemTemporaryDirectory, runDirectory)) {
    throw new RangeError('Browser run data must use a dedicated child of the system temporary directory.')
  }
  if (isWithin(repositoryDirectory, runDirectory)) {
    throw new RangeError('Browser run data must never be written inside the repository.')
  }
  if (!runDirectory.split(sep).at(-1)?.startsWith('nanquim-browser-')) {
    throw new RangeError('Browser run directories require the nanquim-browser- prefix.')
  }

  return runDirectory
}

async function assertSafeArtifactsDirectory(candidate, {
  artifactsRoot,
  repositoryRoot,
} = {}) {
  if (!candidate || !artifactsRoot || !repositoryRoot) {
    throw new TypeError('Artifact, artifact-root, and repository directories are required.')
  }

  const artifactDirectory = resolve(candidate)
  const artifactRootDirectory = resolve(artifactsRoot)
  const repositoryDirectory = resolve(repositoryRoot)

  if (
    artifactRootDirectory === repositoryDirectory
    || !isWithin(repositoryDirectory, artifactRootDirectory)
    || artifactDirectory === artifactRootDirectory
    || !isWithin(artifactRootDirectory, artifactDirectory)
  ) {
    throw new RangeError('Browser artifacts must use a strict child of test-results/browser.')
  }

  await assertNoSymlinkComponents(repositoryDirectory, artifactRootDirectory)
  await assertNoSymlinkComponents(repositoryDirectory, artifactDirectory)

  let existingAncestor = artifactDirectory
  while (true) {
    try {
      await lstat(existingAncestor)
      break
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const parent = dirname(existingAncestor)
      if (parent === existingAncestor || !isWithin(repositoryDirectory, parent)) {
        throw new RangeError('Browser artifacts have no safe ancestor below test-results/browser.')
      }
      existingAncestor = parent
    }
  }

  const realRepository = await realpath(repositoryDirectory)
  const realAncestor = await realpath(existingAncestor)
  if (!isWithin(realRepository, realAncestor)) {
    throw new RangeError('Browser artifacts must not escape test-results/browser through a symlink.')
  }

  return artifactDirectory
}

async function assertNoSymlinkComponents(base, target) {
  const relation = relative(resolve(base), resolve(target))
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new RangeError('Browser artifact paths must remain below the repository.')
  }

  let current = resolve(base)
  for (const component of relation.split(sep)) {
    current = join(current, component)
    try {
      const stats = await lstat(current)
      if (stats.isSymbolicLink()) {
        throw new RangeError('Browser artifacts must not escape test-results/browser through a symlink.')
      }
      if (!stats.isDirectory()) {
        throw new RangeError('Browser artifact path ancestors must be directories.')
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
  }
}

export { assertSafeArtifactsDirectory, assertSafeRunDirectory, isWithin }
