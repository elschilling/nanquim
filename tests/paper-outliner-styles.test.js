import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

describe('Paper Outliner action styling', () => {
  test('shares the native button reset and icon states across annotation and viewport controls', async () => {
    const styles = await readFile(join(process.cwd(), 'src', 'styles', '_identity.sass'), 'utf8')
    const actionRule = styles.match(
      /button\.collection-icon\[data-paper-annotations-action\],\nbutton\.collection-icon\[data-paper-viewport-action\]\n([\s\S]*?)(?=\n\S)/,
    )

    expect(actionRule).not.toBeNull()
    expect(actionRule[1]).toContain('appearance: none')
    expect(actionRule[1]).toContain('padding: 0')
    expect(actionRule[1]).toContain('border: 0')
    expect(actionRule[1]).toContain('color: inherit')
    expect(actionRule[1]).toContain('background: transparent')
    expect(actionRule[1]).toContain('&:hover,')
    expect(actionRule[1]).toContain('&.icon-on')
    expect(actionRule[1]).toContain('background: var(--surface-4)')
  })
})
