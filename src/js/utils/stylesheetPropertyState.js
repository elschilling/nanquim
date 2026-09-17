function mediaMatches(media, view) {
  const query = String(media?.mediaText || media || '').trim()
  if (!query || query === 'all') return true
  if (typeof view?.matchMedia !== 'function') return null
  return Boolean(view.matchMedia(query).matches)
}

function nestedRuleIsActive(rule, view) {
  const type = rule?.constructor?.name
  if (type === 'CSSMediaRule') return mediaMatches(rule.media, view)
  if (type === 'CSSSupportsRule') {
    if (typeof view?.CSS?.supports !== 'function') return null
    return Boolean(view.CSS.supports(rule.conditionText))
  }
  if (type === 'CSSContainerRule') return null
  if (type === 'CSSImportRule') return mediaMatches(rule.media, view)
  return true
}

function rulesSetProperty(rules, node, view, properties) {
  for (const rule of Array.from(rules || [])) {
    const declared = properties.some(property => rule?.style?.getPropertyValue?.(property))
    if (declared && rule.selectorText) {
      try {
        if (node.matches(rule.selectorText)) return true
      } catch (_error) {
        // A selector unsupported by the current browser cannot match here.
      }
    }

    const active = nestedRuleIsActive(rule, view)
    if (active === null) return null
    if (!active) continue
    try {
      if (rule.cssRules) {
        const result = rulesSetProperty(rule.cssRules, node, view, properties)
        if (result !== false) return result
      }
      if (rule.styleSheet?.cssRules) {
        const result = rulesSetProperty(rule.styleSheet.cssRules, node, view, properties)
        if (result !== false) return result
      }
    } catch (_error) {
      return null
    }
  }
  return false
}

// Inspect authored declarations only at interaction boundaries, never on a
// pointer-move or spatial-index path. Computed values alone cannot distinguish
// an attribute from an equal-valued CSS rule that would override later edits.
function stylesheetPropertyState(node, property) {
  const view = node?.ownerDocument?.defaultView
  const properties = Array.isArray(property) ? property : [property]
  let inaccessible = false
  for (const sheet of Array.from(node?.ownerDocument?.styleSheets || [])) {
    if (sheet.disabled) continue
    const active = mediaMatches(sheet.media, view)
    if (active === null) {
      inaccessible = true
      continue
    }
    if (!active) continue
    try {
      const result = rulesSetProperty(sheet.cssRules, node, view, properties)
      if (result === true) return { inaccessible, matched: true }
      if (result === null) inaccessible = true
    } catch (_error) {
      inaccessible = true
    }
  }
  return { inaccessible, matched: false }
}

export { stylesheetPropertyState }
