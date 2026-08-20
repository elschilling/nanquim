// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'

import { TEXT_STYLE_FONT_WEIGHTS } from '../src/js/Properties.js'

describe('text-style font weights', () => {
  test.each(['Inter', 'JetBrains Mono'])('%s exposes its bundled bold face', (family) => {
    expect(TEXT_STYLE_FONT_WEIGHTS[family]).toContainEqual(['700', 'Bold'])
  })
})
