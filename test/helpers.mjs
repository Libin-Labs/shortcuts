export class KeyEvent extends Event {
  constructor(key, options = {}) {
    super('keydown', { bubbles: true, cancelable: options.cancelable ?? true });
    Object.assign(this, {
      key,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      repeat: false,
      isComposing: false,
      keyCode: 0,
      stopped: false,
      altGraph: false,
    });
    const { target, path, cancelable: _cancelable, ...properties } = options;
    Object.assign(this, properties);
    if (target !== undefined) Object.defineProperty(this, 'target', { value: target });
    this.path = path;
  }

  composedPath() {
    return this.path ?? super.composedPath();
  }

  getModifierState(key) {
    return key === 'AltGraph' && this.altGraph;
  }

  stopPropagation() {
    this.stopped = true;
    super.stopPropagation();
  }
}

export class TrackedTarget extends EventTarget {
  listeners = new Map();
  additions = 0;
  removals = 0;

  addEventListener(type, listener, capture) {
    super.addEventListener(type, listener, capture);
    const captureValue = typeof capture === 'boolean' ? capture : !!capture?.capture;
    this.listeners.set(type, { listener, capture: captureValue });
    this.additions++;
  }

  removeEventListener(type, listener, capture) {
    const installed = this.listeners.get(type);
    const captureValue = typeof capture === 'boolean' ? capture : !!capture?.capture;
    if (installed?.listener === listener && installed.capture === captureValue)
      this.listeners.delete(type);
    super.removeEventListener(type, listener, capture);
    this.removals++;
  }
}

export function press(target, key, options) {
  const event = new KeyEvent(key, options);
  target.dispatchEvent(event);
  return event;
}

export function element(tagName, attributes = {}, parentNode) {
  return {
    tagName,
    parentNode,
    getAttribute(name) {
      return attributes[name] ?? null;
    },
  };
}
