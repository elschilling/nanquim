// @vitest-environment jsdom

import { afterEach, describe, expect, test } from 'vitest'
import packageMetadata from '../package.json'
import {
  APPLICATION_VERSION,
  applyApplicationVersion,
  getApplicationLabel,
} from '../src/js/applicationVersion.js'

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

describe('application version', () => {
  test('is injected from package metadata', () => {
    expect(APPLICATION_VERSION).toBe(packageMetadata.version)
    expect(getApplicationLabel()).toBe(`nanquim v${packageMetadata.version}`)
  })

  test('updates the document title and every visible version marker', () => {
    document.head.innerHTML = '<title data-application-version>nanquim</title>'
    document.body.innerHTML = [
      '<span data-application-version>stale</span>',
      '<span data-application-version>stale</span>',
    ].join('')

    applyApplicationVersion(document)

    expect(document.title).toBe(`nanquim v${packageMetadata.version}`)
    expect(
      Array.from(document.querySelectorAll('[data-application-version]'))
        .map((element) => element.textContent),
    ).toEqual(Array(3).fill(`nanquim v${packageMetadata.version}`))
  })
})
