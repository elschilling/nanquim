export class DimensionStyle {
  constructor(id, name, config = {}) {
    this.id = id
    this.name = name
    
    // Default properties for a newly created style
    this.properties = {
      fontFamily: config.fontFamily || 'Inter',
      fontSize: config.fontSize !== undefined ? config.fontSize : 0.15,
      markerType: config.markerType || 'arrow', // 'arrow' | 'tick' | 'bullet'
      markerSize: config.markerSize !== undefined ? config.markerSize : 0.15,
      extensionLineOffset: config.extensionLineOffset !== undefined ? config.extensionLineOffset : 0.1,
      extensionLineExtend: config.extensionLineExtend !== undefined ? config.extensionLineExtend : 0.1,
      textOffset: config.textOffset !== undefined ? config.textOffset : 0.1,
      textColor: config.textColor || '#ffffff',
      lineColor: config.lineColor || '#ffffff',
      lineWidth: config.lineWidth !== undefined ? config.lineWidth : 0.01
    }
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      properties: this.properties
    }
  }

  static fromJSON(data) {
    const props = { ...data.properties }
    // Migrate old arrowSize/tickSize to markerType/markerSize
    if (props.markerType === undefined) {
      props.markerType = props.tickSize > 0 ? 'tick' : 'arrow'
      props.markerSize = props.tickSize > 0 ? props.tickSize : (props.arrowSize ?? 0.15)
      delete props.arrowSize
      delete props.tickSize
    }
    return new DimensionStyle(data.id, data.name, props)
  }
}

export class DimensionManager {
  constructor(editor) {
    this.editor = editor
    this.styles = new Map()
    this.activeStyleId = 'Standard'

    // Initialize with a default 'Standard' style
    this.createStyle('Standard', 'Standard', {})
  }

  createStyle(id, name, config) {
    const style = new DimensionStyle(id, name, config)
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
    if (this.styles.has(id)) {
      this.activeStyleId = id
    }
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
      this.editor.signals.refreshHandlers.dispatch() // This will also trigger redraws on dimensions
      this.redrawAllDimensionsUsingStyle(id)
    }
  }

  redrawAllDimensionsUsingStyle(styleId) {
    this.editor.drawing.children().each((group) => {
      // Dimensions are stored as groups or within collections
      const redrawIfDimension = (el) => {
        if (el.type === 'g' && el.attr('data-element-type') === 'dimension') {
          try {
            const dataStr = el.attr('data-dim-data')
            if (dataStr) {
              const data = JSON.parse(dataStr)
              if (data.styleId === styleId) {
                // Redraw logic: the command itself will provide a static redraw 
                // method since it holds the parsing logic, but we can emit a signal
                this.editor.signals.refreshDimensions.dispatch({ element: el, data })
              }
            }
          } catch(e) { /* ignore parse errors */ }
        }
        
        if (el.type === 'g' && el.attr('data-collection') === 'true') {
          el.children().each(redrawIfDimension)
        }
      }

      redrawIfDimension(group)
    })
  }

  toJSON() {
    const stylesArray = Array.from(this.styles.values()).map(s => s.toJSON())
    return {
      activeStyleId: this.activeStyleId,
      styles: stylesArray
    }
  }

  fromJSON(data) {
    try {
      if (!data || !data.styles) return
      this.styles.clear()
      data.styles.forEach(sData => {
        this.styles.set(sData.id, DimensionStyle.fromJSON(sData))
      })
      this.activeStyleId = data.activeStyleId || 'Standard'
      if (!this.styles.has('Standard')) {
        this.createStyle('Standard', 'Standard', {})
      }
    } catch(e) {
      console.warn("Error parsing DimensionManager data:", e)
      // fallback
      this.styles.clear()
      this.createStyle('Standard', 'Standard', {})
      this.activeStyleId = 'Standard'
    }
  }
}
