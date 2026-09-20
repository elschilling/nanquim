// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import changelog from '../CHANGELOG.md?raw'
import { renderWelcomeChangelog } from '../src/js/WelcomeChangelog.js'

const commitUrl = hash => `https://github.com/elschilling/nanquim/commit/${hash}`
const hashA = 'a'.repeat(40)
const hashB = 'b'.repeat(40)

describe('Welcome changelog', () => {
  let container

  beforeEach(() => {
    container = document.createElement('section')
    document.body.replaceChildren(container)
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  test('shows every canonical commit with its date and summary in newest-first order', () => {
    renderWelcomeChangelog(container)

    const expectedRows = changelog.split('\n').filter(line => /^\| \d{4}-\d{2}-\d{2} \|/.test(line))
    const items = [...container.querySelectorAll('.ws-changelog-entry')]
    expect(items).toHaveLength(expectedRows.length + 1)
    for (const [index, row] of expectedRows.entries()) {
      const [, date, linkedCommit, summary] = row.split('|').map(value => value.trim())
      const [, commit, url] = linkedCommit.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      expect(items[index].querySelector('time').dateTime).toBe(date)
      expect(items[index].querySelector('time').textContent).toBe(date)
      expect(items[index].querySelector('a').textContent).toBe(commit)
      expect(items[index].querySelector('a').href).toBe(url)
      expect(items[index].querySelector('.ws-changelog-summary').textContent).toBe(summary)
      expect(items[index].querySelector('.ws-changelog-meta').textContent).toContain('Unreleased')
    }

    const release = items.at(-1)
    expect(release.querySelector('.ws-changelog-meta').textContent).toContain('Released · v0.1.0-alpha.1')
    expect(release.querySelector('time').dateTime).toBe('2026-08-20')
    expect(release.querySelector('a').href).toBe(commitUrl('0715d22ad99e41a89a7ccca93588b5a04a59656c'))
    expect(release.querySelector('.ws-changelog-summary').textContent)
      .toBe('An initial versioned prerelease baseline for the browser-based SVG CAD editor.')
    const dates = items.map(item => item.querySelector('time').dateTime)
    expect(dates).toEqual([...dates].sort().reverse())
  })

  test('uses semantic headings and lists, explicit date meaning, and safe external commit links', () => {
    renderWelcomeChangelog(container)

    expect(container.querySelector('h2').textContent).toBe('Changelog')
    expect(container.querySelector('.ws-changelog-list').tagName).toBe('OL')
    expect(container.querySelector('.ws-changelog-note').textContent).toContain('commits, not releases')
    for (const link of container.querySelectorAll('a')) {
      expect(link.target).toBe('_blank')
      expect(link.relList.contains('noopener')).toBe(true)
      expect(link.relList.contains('noreferrer')).toBe(true)
      expect(link.getAttribute('aria-label')).toContain('opens in a new tab')
    }
    expect(container.querySelector('.ws-changelog-source').href)
      .toBe('https://github.com/elschilling/nanquim/blob/master/CHANGELOG.md')
  })

  test('keeps source order for same-day commits and uses the release commit date, not publication date', () => {
    renderWelcomeChangelog(container, `## [Unreleased]
| 2026-09-15 | [aaaaaaa](${commitUrl(hashA)}) | Latest change. |
| 2026-09-15 | [bbbbbbb](${commitUrl(hashB)}) | Earlier change. |
## [0.1.0] - 2026-09-17
Release tag: \`v0.1.0\`. Commit:
[ccccccc](${commitUrl('c'.repeat(40))})
(2026-09-14).
### Added

- Published baseline.
`)

    const items = [...container.querySelectorAll('li')]
    expect(items.map(item => item.querySelector('a').textContent)).toEqual(['aaaaaaa', 'bbbbbbb', 'ccccccc'])
    expect(items.at(-1).querySelector('time').dateTime).toBe('2026-09-14')
    expect(items.at(-1).textContent).toContain('Released · v0.1.0')
  })

  test('renders hostile summaries as inert text and rejects untrusted commit links and invalid dates', () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(1)</script> & edit'
    renderWelcomeChangelog(container, `## [Unreleased]
| 2026-09-17 | [aaaaaaa](${commitUrl(hashA)}) | ${hostile} |
| 2026-09-16 | [bbbbbbb](javascript:alert) | Unsafe scheme. |
| 2026-09-16 | [bbbbbbb](https://evil.example/commit/${hashB}) | Wrong host. |
| 2026-09-16 | [bbbbbbb](https://github.com/another/repository/commit/${hashB}) | Wrong repository. |
| 2026-09-16 | [bbbbbbb](${commitUrl(hashB)}?redirect=evil) | Unexpected query. |
| 2026-02-30 | [bbbbbbb](${commitUrl(hashB)}) | Invalid date. |
| 2026-09-16 | [ccccccc](${commitUrl(hashB)}) | Mismatched hash. |
`)

    expect(container.querySelectorAll('li')).toHaveLength(1)
    expect(container.querySelector('.ws-changelog-summary').textContent).toBe(hostile)
    expect(container.querySelector('img, script, [onerror]')).toBeNull()
  })

  test('re-rendering replaces the existing history without duplicate entries', () => {
    renderWelcomeChangelog(container)
    const count = container.querySelectorAll('li').length
    renderWelcomeChangelog(container)
    expect(container.querySelectorAll('li')).toHaveLength(count)
    expect(container.querySelectorAll('h2')).toHaveLength(1)
  })
})
