export class TextStyle {
  constructor(id, name, config = {}) {
    this.id = id
    this.name = name

    this.properties = {
      fontFamily:       config.fontFamily       || 'Inter',
      fontSize:         config.fontSize         !== undefined ? config.fontSize         : 0.15,
      fontWeight:       config.fontWeight       || 'normal',
      fontStyle:        config.fontStyle        || 'normal',
      textAnchor:       config.textAnchor       || 'start',
      dominantBaseline: config.dominantBaseline || 'auto',
      letterSpacing:    config.letterSpacing    !== undefined ? config.letterSpacing    : 0,
      textDecoration:   config.textDecoration   || 'none',
      fill:             config.fill             || '#ffffff',
    }
  }

  toJSON() {
    return { id: this.id, name: this.name, properties: this.properties }
  }

  static fromJSON(data) {
    return new TextStyle(data.id, data.name, data.properties || {})
  }
}

export class TextStyleManager {
  constructor(editor) {
    this.editor = editor
    this.styles = new Map()
    this.activeStyleId = 'Standard'
    this.createStyle('Standard', 'Standard', {})
  }

  createStyle(id, name, config) {
    const style = new TextStyle(id, name, config)
    this.styles.set(id, style)
    return style
  }

  getStyle(id) {
    return this.styles.get(id) || this.styles.get('Standard')
  }

  getActiveStyle() {
    return this.getStyle(this.activeStyleId)
  }

  setActiveStyle(id) {
    if (this.styles.has(id)) this.activeStyleId = id
  }

  deleteStyle(id) {
    if (id === 'Standard' || !this.styles.has(id)) return
    this.styles.delete(id)
    if (this.activeStyleId === id) this.activeStyleId = 'Standard'
    this.editor.signals.updatedProperties.dispatch()
  }

  renameStyle(id, newName) {
    const style = this.styles.get(id)
    if (style) {
      style.name = newName
      this.editor.signals.updatedProperties.dispatch()
    }
  }

  updateStyle(id, newProperties) {
    const style = this.styles.get(id)
    if (style) {
      Object.assign(style.properties, newProperties)
      this.editor.signals.updatedProperties.dispatch()
      this.refreshAllTextUsingStyle(id)
      // Redraw all dimension styles that reference this text style
      const dm = this.editor.dimensionManager
      dm.styles.forEach((dimStyle, dimStyleId) => {
        if ((dimStyle.properties.textStyleId || 'Standard') === id) {
          dm.redrawAllDimensionsUsingStyle(dimStyleId)
        }
      })
    }
  }

  refreshAllTextUsingStyle(styleId) {
    const style = this.getStyle(styleId)
    if (!style) return
    const p = style.properties

    const apply = (el) => {
      if (el.type === 'text' && el.attr('data-text-style-id') === styleId) {
        el.font({ family: p.fontFamily, size: p.fontSize, weight: p.fontWeight, style: p.fontStyle })
        el.attr({
          'text-anchor': p.textAnchor,
          'dominant-baseline': p.dominantBaseline,
          'letter-spacing': p.letterSpacing !== 0 ? p.letterSpacing : null,
          'text-decoration': p.textDecoration !== 'none' ? p.textDecoration : null,
        })
        if ((el.attr('data-fill-source') || 'textstyle') === 'textstyle') el.css('fill', p.fill)
      }
      if (el.children) el.children().each(apply)
    }

    this.editor.drawing.children().each(apply)
  }

  toJSON() {
    return {
      activeStyleId: this.activeStyleId,
      styles: Array.from(this.styles.values()).map(s => s.toJSON()),
    }
  }

  fromJSON(data) {
    try {
      if (!data || !data.styles) return
      this.styles.clear()
      data.styles.forEach(sData => {
        this.styles.set(sData.id, TextStyle.fromJSON(sData))
      })
      this.activeStyleId = data.activeStyleId || 'Standard'
      if (!this.styles.has('Standard')) this.createStyle('Standard', 'Standard', {})
    } catch (e) {
      console.warn('Error parsing TextStyleManager data:', e)
      this.styles.clear()
      this.createStyle('Standard', 'Standard', {})
      this.activeStyleId = 'Standard'
    }
  }
}
