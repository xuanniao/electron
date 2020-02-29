'use strict'

const { EventEmitter } = require('events')

let nextItemID = 1

class TouchBar extends EventEmitter {
  // Bind a touch bar to a window
  static _setOnWindow (touchBar, window) {
    if (window._touchBar != null) {
      window._touchBar._removeFromWindow(window)
    }

    if (touchBar == null) {
      window._setTouchBarItems([])
      return
    }

    if (Array.isArray(touchBar)) {
      touchBar = new TouchBar(touchBar)
    }
    touchBar._addToWindow(window)
  }

  constructor (options) {
    super()

    if (options == null) {
      throw new Error('Must specify options object as first argument')
    }

    let { items, escapeItem } = options

    if (!Array.isArray(items)) {
      items = []
    }

    this.changeListener = (item) => {
      this.emit('change', item.id, item.type)
    }

    this.windowListeners = {}
    this.items = {}
    this.ordereredItems = []
    this.escapeItem = escapeItem

    const registerItem = (item) => {
      this.items[item.id] = item
      item.on('change', this.changeListener)
      if (item.child instanceof TouchBar) {
        item.child.ordereredItems.forEach(registerItem)
      }
    }

    let hasOtherItemsProxy = false
    const idSet = new Set()
    items.forEach((item) => {
      if (!(item instanceof TouchBarItem)) {
        throw new Error('Each item must be an instance of TouchBarItem')
      }

      if (item.type === 'other_items_proxy') {
        if (!hasOtherItemsProxy) {
          hasOtherItemsProxy = true
        } else {
          throw new Error('Must only have one OtherItemsProxy per TouchBar')
        }
      }

      if (!idSet.has(item.id)) {
        idSet.add(item.id)
      } else {
        throw new Error('Cannot add a single instance of TouchBarItem multiple times in a TouchBar')
      }
    })

    // register in separate loop after all items are validated
    for (const item of items) {
      this.ordereredItems.push(item)
      registerItem(item)
    }
  }

  set escapeItem (item) {
    if (item != null && !(item instanceof TouchBarItem)) {
      throw new Error('Escape item must be an instance of TouchBarItem')
    }
    if (this.escapeItem != null) {
      this.escapeItem.removeListener('change', this.changeListener)
    }
    this._escapeItem = item
    if (this.escapeItem != null) {
      this.escapeItem.on('change', this.changeListener)
    }
    this.emit('escape-item-change', item)
  }

  get escapeItem () {
    return this._escapeItem
  }

  _addToWindow (window) {
    const { id } = window

    // Already added to window
    if (this.windowListeners.hasOwnProperty(id)) return

    window._touchBar = this

    const changeListener = (itemID) => {
      window._refreshTouchBarItem(itemID)
    }
    this.on('change', changeListener)

    const escapeItemListener = (item) => {
      window._setEscapeTouchBarItem(item != null ? item : {})
    }
    this.on('escape-item-change', escapeItemListener)

    const interactionListener = (event, itemID, details) => {
      let item = this.items[itemID]
      if (item == null && this.escapeItem != null && this.escapeItem.id === itemID) {
        item = this.escapeItem
      }
      if (item != null && item.onInteraction != null) {
        item.onInteraction(details)
      }
    }
    window.on('-touch-bar-interaction', interactionListener)

    const removeListeners = () => {
      this.removeListener('change', changeListener)
      this.removeListener('escape-item-change', escapeItemListener)
      window.removeListener('-touch-bar-interaction', interactionListener)
      window.removeListener('closed', removeListeners)
      window._touchBar = null
      delete this.windowListeners[id]
      const unregisterItems = (items) => {
        for (const item of items) {
          item.removeListener('change', this.changeListener)
          if (item.child instanceof TouchBar) {
            unregisterItems(item.child.ordereredItems)
          }
        }
      }
      unregisterItems(this.ordereredItems)
      if (this.escapeItem) {
        this.escapeItem.removeListener('change', this.changeListener)
      }
    }
    window.once('closed', removeListeners)
    this.windowListeners[id] = removeListeners

    window._setTouchBarItems(this.ordereredItems)
    escapeItemListener(this.escapeItem)
  }

  _removeFromWindow (window) {
    const removeListeners = this.windowListeners[window.id]
    if (removeListeners != null) removeListeners()
  }
}

class TouchBarItem extends EventEmitter {
  constructor () {
    super()
    this._addImmutableProperty('id', `${nextItemID++}`)
    this._parents = []
  }

  _addImmutableProperty (name, value) {
    Object.defineProperty(this, name, {
      get: function () {
        return value
      },
      set: function () {
        throw new Error(`Cannot override property ${name}`)
      },
      enumerable: true,
      configurable: false
    })
  }

  _addLiveProperty (name, initialValue) {
    const privateName = `_${name}`
    this[privateName] = initialValue
    Object.defineProperty(this, name, {
      get: function () {
        return this[privateName]
      },
      set: function (value) {
        this[privateName] = value
        this.emit('change', this)
      },
      enumerable: true
    })
  }

  _addParent (item) {
    const existing = this._parents.some(test => test.id === item.id)
    if (!existing) {
      this._parents.push({
        id: item.id,
        type: item.type
      })
    }
  }
}

TouchBar.TouchBarButton = class TouchBarButton extends TouchBarItem {
  constructor (config) {
    super()
    if (config == null) config = {}
    this._addImmutableProperty('type', 'button')
    this._addLiveProperty('label', config.label)
    this._addLiveProperty('accessibilityLabel', config.accessibilityLabel)
    this._addLiveProperty('backgroundColor', config.backgroundColor)
    this._addLiveProperty('icon', config.icon)
    this._addLiveProperty('iconPosition', config.iconPosition)
    this._addLiveProperty('enabled', typeof config.enabled !== 'boolean' ? true : config.enabled)
    if (typeof config.click === 'function') {
      this._addImmutableProperty('onInteraction', () => {
        config.click()
      })
    }
  }
}

TouchBar.TouchBarColorPicker = class TouchBarColorPicker extends TouchBarItem {
  constructor (config) {
    super()
    if (config == null) config = {}
    this._addImmutableProperty('type', 'colorpicker')
    this._addLiveProperty('availableColors', config.availableColors)
    this._addLiveProperty('selectedColor', config.selectedColor)

    if (typeof config.change === 'function') {
      this._addImmutableProperty('onInteraction', (details) => {
        this._selectedColor = details.color
        config.change(details.color)
      })
    }
  }
}

TouchBar.TouchBarGroup = class TouchBarGroup extends TouchBarItem {
  constructor (config) {
    super()
    if (config == null) config = {}
    this._addImmutableProperty('type', 'group')
    const defaultChild = (config.items instanceof TouchBar) ? config.items : new TouchBar(config.items)
    this._addLiveProperty('child', defaultChild)
    this.child.ordereredItems.forEach((item) => item._addParent(this))
  }
}

TouchBar.TouchBarLabel = class TouchBarLabel extends TouchBarItem {
  constructor (config) {
    super()
    if (config == null) config = {}
    this._addImmutableProperty('type', 'label')
    this._addLiveProperty('label', config.label)
    this._addLiveProperty('accessibilityLabel', config.accessibilityLabel)
    this._addLiveProperty('textColor', config.textColor)
  }
}

TouchBar.TouchBarPopover = class TouchBarPopover extends TouchBarItem {
  constructor (config) {
    super()
    if (config == null) config = {}
    this._addImmutableProperty('type', 'popover')
    this._addLiveProperty('label', config.label)
    this._addLiveProperty('icon', config.icon)
    this._addLiveProperty('showCloseButton', config.showCloseButton)
    const defaultChild = (config.items instanceof TouchBar) ? config.items : new TouchBar(config.items)
    this._addLiveProperty('child', defaultChild)
    this.child.ordereredItems.forEach((item) => item._addParent(this))
  }
}

TouchBar.TouchBarSlider = class TouchBarSlider extends TouchBarItem {
  constructor (config) {
    super()
    if (config == null) config = {}
    this._addImmutableProperty('type', 'slider')
    this._addLiveProperty('label', config.label)
    this._addLiveProperty('minValue', config.minValue)
    this._addLiveProperty('maxValue', config.maxValue)
    this._addLiveProperty('value', config.value)

    if (typeof config.change === 'function') {
      this._addImmutableProperty('onInteraction', (details) => {
        this._value = details.value
        config.change(details.value)
      })
    }
  }
}

TouchBar.TouchBarSpacer = class TouchBarSpacer extends TouchBarItem {
  constructor (config) {
    super()
    if (config == null) config = {}
    this._addImmutableProperty('type', 'spacer')
    this._addImmutableProperty('size', config.size)
  }
}

TouchBar.TouchBarSegmentedControl = class TouchBarSegmentedControl extends TouchBarItem {
  constructor (config) {
    super()
    if (config == null) config = {}
    this._addImmutableProperty('type', 'segmented_control')
    this._addLiveProperty('segmentStyle', config.segmentStyle)
    this._addLiveProperty('segments', config.segments || [])
    this._addLiveProperty('selectedIndex', config.selectedIndex)
    this._addLiveProperty('mode', config.mode)

    if (typeof config.change === 'function') {
      this._addImmutableProperty('onInteraction', (details) => {
        this._selectedIndex = details.selectedIndex
        config.change(details.selectedIndex, details.isSelected)
      })
    }
  }
}

TouchBar.TouchBarScrubber = class TouchBarScrubber extends TouchBarItem {
  constructor (config) {
    super()
    if (config == null) config = {}
    let { select, highlight } = config
    this._addImmutableProperty('type', 'scrubber')
    this._addLiveProperty('items', config.items)
    this._addLiveProperty('selectedStyle', config.selectedStyle || null)
    this._addLiveProperty('overlayStyle', config.overlayStyle || null)
    this._addLiveProperty('showArrowButtons', config.showArrowButtons || false)
    this._addLiveProperty('mode', config.mode || 'free')

    const cont = typeof config.continuous === 'undefined' ? true : config.continuous
    this._addLiveProperty('continuous', cont)

    if (typeof select === 'function' || typeof highlight === 'function') {
      if (select == null) select = () => {}
      if (highlight == null) highlight = () => {}
      this._addImmutableProperty('onInteraction', (details) => {
        if (details.type === 'select' && typeof select === 'function') {
          select(details.selectedIndex)
        } else if (details.type === 'highlight' && typeof highlight === 'function') {
          highlight(details.highlightedIndex)
        }
      })
    }
  }
}

TouchBar.TouchBarOtherItemsProxy = class TouchBarOtherItemsProxy extends TouchBarItem {
  constructor (config) {
    super()
    this._addImmutableProperty('type', 'other_items_proxy')
  }
}

module.exports = TouchBar
