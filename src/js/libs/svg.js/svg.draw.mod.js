/*!
 * @svgdotjs/svg.draw.js - An extension for svg.js which allows to draw elements with mouse
 * @version 3.0.0
 * https://github.com/svgdotjs/svg.draw.js
 *
 * @copyright Ulrich-Matthias Schäfer
 * @license MIT
 *
 * BUILT: Fri Dec 29 2023 14:27:17 GMT-0300 (Brasilia Standard Time)
 */ ;(function (svg_js) {
  'use strict'

  function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError('Cannot call a class as a function')
    }
  }

  function _typeof(o) {
    '@babel/helpers - typeof'

    return (
      (_typeof =
        'function' == typeof Symbol && 'symbol' == typeof Symbol.iterator
          ? function (o) {
              return typeof o
            }
          : function (o) {
              return o && 'function' == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? 'symbol' : typeof o
            }),
      _typeof(o)
    )
  }

  function toPrimitive(t, r) {
    if ('object' != _typeof(t) || !t) return t
    var e = t[Symbol.toPrimitive]
    if (void 0 !== e) {
      var i = e.call(t, r || 'default')
      if ('object' != _typeof(i)) return i
      throw new TypeError('@@toPrimitive must return a primitive value.')
    }
    return ('string' === r ? String : Number)(t)
  }

  function toPropertyKey(t) {
    var i = toPrimitive(t, 'string')
    return 'symbol' == _typeof(i) ? i : String(i)
  }

  function _defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i]
      descriptor.enumerable = descriptor.enumerable || false
      descriptor.configurable = true
      if ('value' in descriptor) descriptor.writable = true
      Object.defineProperty(target, toPropertyKey(descriptor.key), descriptor)
    }
  }
  function _createClass(Constructor, protoProps, staticProps) {
    if (protoProps) _defineProperties(Constructor.prototype, protoProps)
    if (staticProps) _defineProperties(Constructor, staticProps)
    Object.defineProperty(Constructor, 'prototype', {
      writable: false,
    })
    return Constructor
  }

  var circle = {
    NAME: 'circle',
    init: function init(e) {
      var p = this.startPoint
      this.el.attr({
        cx: p.x,
        cy: p.y,
        r: 1,
      })
    },
    // We determine the radius by the cursor position
    calc: function calc(e) {
      var p = this.transformPoint(e.clientX, e.clientY)
      var circle = {
        cx: this.startPoint.x,
        cy: this.startPoint.y,
        // calculating the radius
        r: Math.sqrt((p.x - this.startPoint.x) * (p.x - this.startPoint.x) + (p.y - this.startPoint.y) * (p.y - this.startPoint.y)),
      }
      this.snapToGrid(circle)
      this.el.attr(circle)
    },
  }

  var ellipse = {
    NAME: 'ellipse',
    init: function init(e) {
      // We start with a circle with radius 1 at the position of the cursor
      var p = this.startPoint
      this.el.attr({
        cx: p.x,
        cy: p.y,
        rx: 1,
        ry: 1,
      })
    },
    calc: function calc(e) {
      var p = this.transformPoint(e.clientX, e.clientY)
      var ellipse = {
        cx: this.startPoint.x,
        cy: this.startPoint.y,
        rx: Math.abs(p.x - this.startPoint.x),
        ry: Math.abs(p.y - this.startPoint.y),
      }
      this.snapToGrid(ellipse)
      this.el.attr(ellipse)
    },
  }

  var lineable = {
    NAME: 'line polyline polygon',
    init: function init(e) {
      console.log('lineable', this.options.startPoint)
      // When we draw a polygon, we immediately need 2 points.
      // One start-point and one point at the mouse-position

      this.set = []
      var p = this.startPoint
      var arr = [
        [p.x, p.y],
        [p.x, p.y],
      ]
      this.el.plot(arr)

      // We draw little circles around each point
      // This can be disabled by setting { drawCircles: false } option
      if (this.options.drawCircles) {
        this.drawCircles()
      }
    },
    // The calc-function sets the position of the last point to the mouse-position (with offset ofc)
    calc: function calc(e) {
      var arr = this.el.array().valueOf()
      arr.pop()
      if (e) {
        var p = this.transformPoint(e.clientX, e.clientY)
        arr.push(this.snapToGrid([p.x, p.y]))
      }
      this.el.plot(arr)
      if (this.options.drawCircles) {
        this.drawCircles()
      } else {
        this.set.forEach(function (e) {
          return e.remove()
        })
        this.set = []
      }
    },
    point: function point(e) {
      var p = this.transformPoint(e.clientX, e.clientY)
      if (this.el.type.indexOf('poly') > -1) {
        // Add the new Point to the point-array
        var arr = this.el.array().valueOf()
        arr.push(this.snapToGrid([p.x, p.y]))
        this.el.plot(arr)
        if (this.options.drawCircles) {
          this.drawCircles()
        }

        // Fire the `drawpoint`-event, which holds the coords of the new Point
        this.el.fire('drawpoint', {
          event: e,
          p: {
            x: p.x,
            y: p.y,
          },
          m: this.m,
        })
        return
      }
      this.el.fire('drawpoint', {
        event: e,
        p: {
          x: p.x,
          y: p.y,
        },
        m: this.m,
      })

      // We are done, if the element is no polyline or polygon
      this.stop(e)
    },
    clean: function clean() {
      // Remove all circles
      this.set.forEach(function (e) {
        return e.remove()
      })
      this.set = []
      delete this.set
    },
    drawCircles: function drawCircles() {
      var array = this.el.array().valueOf()
      this.set.forEach(function (e) {
        return e.remove()
      })
      this.set = []
      for (var i = 0; i < array.length; ++i) {
        this.p.x = array[i][0]
        this.p.y = array[i][1]
        var p = this.p.matrixTransform(this.parent.node.getScreenCTM().inverse().multiply(this.el.node.getScreenCTM()))
        this.set.push(
          this.parent
            .circle(5)
            .stroke({
              width: 1,
            })
            .fill('#ccc')
            .center(p.x, p.y)
        )
      }
    },
    undo: function undo() {
      if (this.set.length) {
        this.set.splice(-2, 1)[0].remove()
        this.el.array().splice(-2, 1)
        this.el.plot(this.el.array())
        this.el.fire('undopoint')
      }
    },
  }

  var rectable = {
    NAME: 'rect image',
    init: function init(e) {
      var p = this.startPoint
      this.el.attr({
        x: p.x,
        y: p.y,
        height: 0,
        width: 0,
      })
    },
    calc: function calc(e) {
      var rect = {
        x: this.startPoint.x,
        y: this.startPoint.y,
      }
      var p = this.transformPoint(e.clientX, e.clientY)
      rect.width = p.x - rect.x
      rect.height = p.y - rect.y

      // Snap the params to the grid we specified
      this.snapToGrid(rect)

      // When width is less than zero, we have to draw to the left
      // which means we have to move the start-point to the left
      if (rect.width < 0) {
        rect.x = rect.x + rect.width
        rect.width = -rect.width
      }

      // ...same with height
      if (rect.height < 0) {
        rect.y = rect.y + rect.height
        rect.height = -rect.height
      }

      // draw the element
      this.el.attr(rect)
    },
  }

  // Our Object which manages drawing
  var PaintHandler = /*#__PURE__*/ (function () {
    function PaintHandler(el, event, options) {
      _classCallCheck(this, PaintHandler)
      el.remember('_paintHandler', this)
      this.el = el
      var _this = this
      var plugin = this.getPlugin()
      this.parent = el.root()
      this.p = this.parent.node.createSVGPoint() // Helping point for coord transformation
      this.m = null // transformation matrix. We get it when drawing starts
      this.startPoint = null
      this.lastUpdateCall = null
      this.options = {}
      this.set = []

      // Merge options and defaults
      for (var i in PaintHandler.defaults) {
        this.options[i] = PaintHandler.defaults[i]
        if (typeof options[i] !== 'undefined') {
          this.options[i] = options[i]
        }
      }
      if (plugin.point) {
        plugin.pointPlugin = plugin.point
        delete plugin.point
      }

      // Import all methods from plugin into object
      for (var _i in plugin) {
        this[_i] = plugin[_i]
      }

      // When we got an event, we use this for start, otherwise we use the click-event as default
      if (!event) {
        this.parent.on('click.draw', function (e) {
          _this.start(e)
        })
      }
    }
    _createClass(
      PaintHandler,
      [
        {
          key: 'transformPoint',
          value: function transformPoint(x, y) {
            this.p.x = x - (this.offset.x - window.scrollX)
            this.p.y = y - (this.offset.y - window.scrollY)
            return this.p.matrixTransform(this.m)
          },
        },
        {
          key: 'start',
          value: function start(event) {
            console.log('start', event)
            var _this = this

            // get the current transform matrix from screen to element (offset corrected)
            this.m = this.el.node.getScreenCTM().inverse()

            // we save the current scrolling-offset here
            this.offset = {
              x: window.scrollX,
              y: window.scrollY,
            }

            // we want to snap in screen-coords, so we have to scale the snapToGrid accordingly
            this.options.snapToGrid *= Math.sqrt(this.m.a * this.m.a + this.m.b * this.m.b)

            // save the startpoint
            this.startPoint = this.snapToGrid(this.transformPoint(event.clientX, event.clientY))

            // the plugin may do some initial work
            if (this.init) {
              this.init(event)
            }

            // Fire our `drawstart`-event. We send the offset-corrected cursor-position along
            this.el.fire('drawstart', {
              event: event,
              p: this.p,
              m: this.m,
            })

            // We need to bind the update-function to the mousemove event to keep track of the cursor
            svg_js.on(window, 'mousemove.draw', function (e) {
              _this.update(e)
            })

            // Every consecutive call to start should map to point now
            this.start = this.point
          },

          // This function draws a point if the element is a polyline or polygon
          // Otherwise it will just stop drawing the shape cause we are done
        },
        {
          key: 'point',
          value: function point(event) {
            if (this.point !== this.start) return this.start(event)
            if (this.pointPlugin) {
              return this.pointPlugin(event)
            }

            // If this function is not overwritten we just call stop
            this.stop(event)
          },

          // The stop-function does the cleanup work
        },
        {
          key: 'stop',
          value: function stop(event) {
            if (event) {
              this.update(event)
            }

            // Plugin may want to clean something
            if (this.clean) {
              this.clean()
            }

            // Unbind from all events
            svg_js.off(window, 'mousemove.draw')
            this.parent.off('click.draw')

            // remove Refernce to PaintHandler
            this.el.forget('_paintHandler')

            // overwrite draw-function since we never need it again for this element
            this.el.draw = function () {}

            // Fire the `drawstop`-event
            this.el.fire('drawstop')
          },

          // Updates the element while moving the cursor
        },
        {
          key: 'update',
          value: function update(event) {
            if (!event && this.lastUpdateCall) {
              event = this.lastUpdateCall
            }
            this.lastUpdateCall = event

            // Get the current transform matrix
            // it could have been changed since the start or the last update call
            this.m = this.el.node.getScreenCTM().inverse()

            // Call the calc-function which calculates the new position and size
            this.calc(event)

            // Fire the `drawupdate`-event
            this.el.fire('drawupdate', {
              event: event,
              p: this.p,
              m: this.m,
            })
          },

          // Called from outside. Finishs a poly-element
        },
        {
          key: 'done',
          value: function done() {
            this.calc()
            this.stop()
            this.el.fire('drawdone')
          },

          // Called from outside. Cancels a poly-element
        },
        {
          key: 'cancel',
          value: function cancel() {
            // stop drawing and remove the element
            this.stop()
            this.el.remove()
            this.el.fire('drawcancel')
          },

          // Calculate the corrected position when using `snapToGrid`
        },
        {
          key: 'snapToGrid',
          value: function snapToGrid(draw) {
            var temp = null

            // An array was given. Loop through every element
            if (draw.length) {
              temp = [draw[0] % this.options.snapToGrid, draw[1] % this.options.snapToGrid]
              draw[0] -= temp[0] < this.options.snapToGrid / 2 ? temp[0] : temp[0] - this.options.snapToGrid
              draw[1] -= temp[1] < this.options.snapToGrid / 2 ? temp[1] : temp[1] - this.options.snapToGrid
              return draw
            }

            // Properties of element were given. Snap them all
            for (var i in draw) {
              temp = draw[i] % this.options.snapToGrid
              draw[i] -=
                (temp < this.options.snapToGrid / 2 ? temp : temp - this.options.snapToGrid) + (temp < 0 ? this.options.snapToGrid : 0)
            }
            return draw
          },
        },
        {
          key: 'param',
          value: function param(key, value) {
            this.options[key] = value === null ? PaintHandler.defaults[key] : value
            this.update()
          },

          // Returns the plugin
        },
        {
          key: 'getPlugin',
          value: function getPlugin() {
            return PaintHandler.plugins[this.el.type]
          },
        },
      ],
      [
        {
          key: 'extend',
          value: function extend(name, obj) {
            var plugins = {}
            if (typeof name === 'string') {
              plugins[name] = obj
            } else {
              plugins = name
            }
            for (var shapes in plugins) {
              var shapesArr = shapes.trim().split(/\s+/)
              for (var i in shapesArr) {
                PaintHandler.plugins[shapesArr[i]] = plugins[shapes]
              }
            }
          },
        },
      ]
    )
    return PaintHandler
  })()
  // Default values. Can be changed for the whole project if needed
  PaintHandler.defaults = {
    snapToGrid: 1,
    // Snaps to a grid of `snapToGrid` px
    drawCircles: true, // Draw little circles around line/polyline/polygon points
  }
  // Container for all types not specified here
  PaintHandler.plugins = {}
  svg_js.extend(svg_js.Element, {
    // Draw element with mouse
    draw: function draw(event, options, value) {
      // sort the parameters
      if (!(event instanceof Event || typeof event === 'string')) {
        options = event
        event = null
      }

      // get the old Handler or create a new one from event and options
      var paintHandler = this.remember('_paintHandler') || new PaintHandler(this, event, options || {})

      // When we got an event we have to start/continue drawing
      if (event instanceof Event) {
        paintHandler.start(event)
      }

      // if event is located in our PaintHandler we handle it as method
      if (paintHandler[event]) {
        paintHandler[event](options, value)
      }
      return this
    },
  })
  PaintHandler.extend(rectable.NAME, rectable)
  PaintHandler.extend(lineable.NAME, lineable)
  PaintHandler.extend(ellipse.NAME, ellipse)
  PaintHandler.extend(circle.NAME, circle)
})(SVG)
//# sourceMappingURL=svg.draw.js.map
