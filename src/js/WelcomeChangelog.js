import changelog from '../../CHANGELOG.md?raw'

const CHANGELOG_URL = 'https://github.com/elschilling/nanquim/blob/master/CHANGELOG.md'
const COMMIT_URL = /^https:\/\/github\.com\/elschilling\/nanquim\/commit\/([a-f0-9]{40})$/

function validDate(date) {
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

// Only the canonical dated table and release-tag record are interpreted. The
// rest of the Markdown remains in the full changelog, never rendered as HTML.
function readEntries(source) {
  const entries = []
  const seen = new Set()
  const add = (date, commit, url, summary, status) => {
    const match = COMMIT_URL.exec(url)
    if (!match || !match[1].startsWith(commit) || !validDate(date) || seen.has(match[1])) return
    seen.add(match[1])
    entries.push({ date, commit, url, summary, status })
  }

  for (const section of source.split(/^## /m).slice(1)) {
    const heading = section.match(/^\[([^\]\n]+)\](?: - \d{4}-\d{2}-\d{2})?\r?\n/)
    if (!heading) continue
    const version = heading[1]
    const status = version === 'Unreleased' ? 'Unreleased' : `Released · v${version}`
    const rows = section.matchAll(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*\[([a-f0-9]{7,40})\]\(([^\s)]+)\)\s*\|\s*(.*?)\s*\|\s*$/gm)
    for (const [, date, commit, url, summary] of rows) {
      add(date, commit, url, summary, status)
    }

    if (version === 'Unreleased') continue
    const release = section.match(/^Release tag: `[^`\n]+`\. Commit:\s*\n\[([a-f0-9]{7,40})\]\(([^\s)]+)\)\s*\n\((\d{4}-\d{2}-\d{2})\)/m)
    if (!release) continue
    const [, commit, url, date] = release
    const firstAddition = section.match(/^### Added\s*\n+- ([^\n]+(?:\n[ \t]+[^\n]+)*)/m)
    const summary = firstAddition
      ? firstAddition[1].replace(/\s+/g, ' ').trim()
      : `Version ${version} release.`
    add(date, commit, url, summary, status)
  }

  return entries.sort((a, b) => b.date.localeCompare(a.date))
}

function element(document, tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function externalLink(document, className, text, href) {
  const link = element(document, 'a', className, text)
  link.href = href
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  return link
}

export function renderWelcomeChangelog(container, source = changelog) {
  const document = container.ownerDocument
  const heading = element(document, 'h2', 'ws-section-title', 'Changelog')
  const note = element(document, 'p', 'ws-changelog-note',
    'Dates identify commits, not releases. Unreleased changes may not yet be in a published version.')
  const list = element(document, 'ol', 'ws-changelog-list')

  for (const entry of readEntries(source)) {
    const item = element(document, 'li', 'ws-changelog-entry')
    const meta = element(document, 'p', 'ws-changelog-meta')
    const date = element(document, 'time', '', entry.date)
    date.dateTime = entry.date
    const status = element(document, 'span', '', entry.status)
    const commit = externalLink(document, '', entry.commit, entry.url)
    commit.setAttribute('aria-label', `View commit ${entry.commit} on GitHub (opens in a new tab)`)
    meta.append(date, ' · ', status, ' · ', commit)
    item.append(meta, element(document, 'p', 'ws-changelog-summary', entry.summary))
    list.append(item)
  }

  const fullHistory = externalLink(document, 'ws-changelog-source', 'Full changelog on GitHub', CHANGELOG_URL)
  fullHistory.setAttribute('aria-label', 'Full changelog on GitHub (opens in a new tab)')
  container.replaceChildren(heading, note, list, fullHistory)
}
