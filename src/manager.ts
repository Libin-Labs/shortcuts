import { keyFromEvent, parseShortcut, validateOptions, validatePlatform } from './parsing.js';
import type { ParsedCombo, Platform } from './parsing.js';

export type ConflictPolicy = 'first-wins' | 'last-wins' | 'error';

export interface ManagerOptions {
  readonly target?: EventTarget;
  readonly platform?: Platform;
  readonly sequenceTimeout?: number;
  readonly conflictPolicy?: ConflictPolicy;
  readonly capture?: boolean;
  readonly enabled?: boolean;
}

export interface RegistrationOptions {
  readonly scope?: string;
  readonly enabled?: boolean;
  readonly allowInEditable?: boolean;
  readonly allowRepeat?: boolean;
  readonly preventDefault?: boolean;
  readonly stopPropagation?: boolean;
}

export interface ShortcutContext {
  readonly event: KeyboardEvent;
  readonly shortcut: string;
  readonly scope: string;
  readonly id: number;
  readonly manager: ShortcutManager;
}

export type ShortcutHandler = (context: ShortcutContext) => void;

export interface ShortcutRegistration {
  readonly id: number;
  readonly shortcut: string;
  readonly scope: string;
  readonly enabled: boolean;
  readonly registered: boolean;
  enable(): void;
  disable(): void;
  unregister(): void;
}

interface Entry {
  readonly id: number;
  readonly shortcut: string;
  readonly combos: readonly ParsedCombo[];
  readonly scope: string;
  handler: ShortcutHandler | undefined;
  readonly allowInEditable: boolean;
  readonly allowRepeat: boolean;
  readonly preventDefault: boolean;
  readonly stopPropagation: boolean;
  enabled: boolean;
  registered: boolean;
}

interface Pending {
  readonly candidates: readonly Entry[];
  readonly position: number;
  readonly fallback: Entry | undefined;
  readonly fallbackEvent: KeyboardEvent | undefined;
}

function booleanOption(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
  return value;
}

function validateScope(scope: unknown): asserts scope is string {
  if (typeof scope !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]*$/.test(scope)) {
    throw new TypeError(
      'scope must start with an ASCII letter and contain only letters, digits, ., _, :, or -.',
    );
  }
}

function validateTarget(target: unknown): asserts target is EventTarget {
  if (
    typeof target !== 'object' ||
    target === null ||
    typeof (target as EventTarget).addEventListener !== 'function' ||
    typeof (target as EventTarget).removeEventListener !== 'function'
  ) {
    throw new TypeError('target must implement addEventListener and removeEventListener.');
  }
}

function isEditable(event: KeyboardEvent): boolean {
  // Structural checks work across realms and with SSR-friendly event mocks.
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  const nodes: unknown[] = [...path];
  const visited = new Set<unknown>();
  let node: unknown = event.target;
  while (node && !visited.has(node)) {
    visited.add(node);
    nodes.push(node);
    const element = node as { parentNode?: unknown; host?: unknown };
    node = element.parentNode ?? element.host;
  }
  for (const candidate of nodes) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const element = candidate as {
      tagName?: string;
      isContentEditable?: boolean;
      getAttribute?: (name: string) => string | null;
    };
    const tag = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : '';
    if (['input', 'textarea', 'select'].includes(tag) || element.isContentEditable === true)
      return true;
    if (typeof element.getAttribute === 'function') {
      const editable = element.getAttribute('contenteditable');
      if (editable !== null && ['', 'true', 'plaintext-only'].includes(editable.toLowerCase()))
        return true;
      const role = element.getAttribute('role');
      if (role !== null && role.toLowerCase().split(/\s+/).includes('textbox')) return true;
    }
  }
  return false;
}

function matches(combo: ParsedCombo | undefined, event: KeyboardEvent): boolean {
  return (
    combo !== undefined &&
    combo.key === keyFromEvent(event.key) &&
    combo.ctrl === !!event.ctrlKey &&
    combo.alt === !!event.altKey &&
    combo.shift === !!event.shiftKey &&
    combo.meta === !!event.metaKey
  );
}

export class ShortcutManager {
  readonly #platform: Platform;
  readonly #timeout: number;
  readonly #policy: ConflictPolicy;
  readonly #capture: boolean;
  readonly #entries = new Map<number, Entry>();
  #nextId = 1;
  #enabled: boolean;
  #disposed = false;
  #target: EventTarget | undefined;
  #scopes: readonly string[] = Object.freeze([]);
  #pending: Pending | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #composing = false;

  readonly #keydown: EventListener = (event) => this.#onKeydown(event);
  readonly #compositionStart: EventListener = () => {
    this.#composing = true;
    this.#reset();
  };
  readonly #compositionEnd: EventListener = () => {
    this.#composing = false;
    this.#reset();
  };
  readonly #blur: EventListener = () => {
    this.#composing = false;
    this.#reset();
  };

  constructor(options: ManagerOptions = {}) {
    validateOptions(
      options,
      ['target', 'platform', 'sequenceTimeout', 'conflictPolicy', 'capture', 'enabled'],
      'manager',
    );
    const platform = options.platform === undefined ? 'other' : options.platform;
    validatePlatform(platform);
    this.#platform = platform;
    const timeout = options.sequenceTimeout === undefined ? 1000 : options.sequenceTimeout;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647) {
      throw new TypeError('sequenceTimeout must be an integer from 1 to 2147483647 milliseconds.');
    }
    this.#timeout = timeout;
    const policy = options.conflictPolicy === undefined ? 'last-wins' : options.conflictPolicy;
    if (!['first-wins', 'last-wins', 'error'].includes(policy)) {
      throw new TypeError('conflictPolicy must be "first-wins", "last-wins", or "error".');
    }
    this.#policy = policy;
    this.#capture = booleanOption(options.capture, false, 'capture');
    this.#enabled = booleanOption(options.enabled, true, 'enabled');
    if (options.target !== undefined) this.attach(options.target);
  }

  get enabled(): boolean {
    return this.#enabled;
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  get target(): EventTarget | undefined {
    return this.#target;
  }
  /** Additional active scopes, ordered from lowest to highest priority. */
  get scopes(): readonly string[] {
    return this.#scopes;
  }

  attach(target: EventTarget): this {
    this.#assertAlive();
    validateTarget(target);
    if (target === this.#target) return this;
    this.detach();
    const installed: [string, EventListener][] = [];
    try {
      for (const [type, listener] of this.#listeners()) {
        target.addEventListener(type, listener, { capture: this.#capture });
        installed.push([type, listener]);
      }
    } catch (error) {
      for (const [type, listener] of installed) {
        target.removeEventListener(type, listener, { capture: this.#capture });
      }
      throw error;
    }
    this.#target = target;
    return this;
  }

  detach(): this {
    this.#reset();
    this.#composing = false;
    if (this.#target) {
      for (const [type, listener] of this.#listeners()) {
        this.#target.removeEventListener(type, listener, { capture: this.#capture });
      }
      this.#target = undefined;
    }
    return this;
  }

  enable(): this {
    this.#assertAlive();
    this.#enabled = true;
    this.#reset();
    return this;
  }

  disable(): this {
    this.#assertAlive();
    this.#enabled = false;
    this.#reset();
    return this;
  }

  setScopes(scopes: readonly string[]): this {
    this.#assertAlive();
    if (!Array.isArray(scopes)) throw new TypeError('setScopes expects an array of scope names.');
    const seen = new Set<string>();
    for (const scope of scopes) {
      validateScope(scope);
      if (scope === 'global')
        throw new TypeError('The "global" scope is always active; omit it from setScopes.');
      if (seen.has(scope)) throw new TypeError(`Duplicate active scope "${scope}".`);
      seen.add(scope);
    }
    this.#scopes = Object.freeze([...scopes]);
    this.#reset();
    return this;
  }

  register(
    shortcut: string,
    handler: ShortcutHandler,
    options: RegistrationOptions = {},
  ): ShortcutRegistration {
    this.#assertAlive();
    validateOptions(
      options,
      ['scope', 'enabled', 'allowInEditable', 'allowRepeat', 'preventDefault', 'stopPropagation'],
      'registration',
    );
    if (typeof handler !== 'function') throw new TypeError('handler must be a function.');
    const combos = parseShortcut(shortcut, { platform: this.#platform });
    const normalized = combos.map((combo) => combo.normalized).join(' ');
    const scope = options.scope === undefined ? 'global' : options.scope;
    validateScope(scope);
    const entry: Entry = {
      id: this.#nextId,
      shortcut: normalized,
      combos,
      scope,
      handler,
      enabled: booleanOption(options.enabled, true, 'enabled'),
      allowInEditable: booleanOption(options.allowInEditable, false, 'allowInEditable'),
      allowRepeat: booleanOption(options.allowRepeat, false, 'allowRepeat'),
      preventDefault: booleanOption(options.preventDefault, false, 'preventDefault'),
      stopPropagation: booleanOption(options.stopPropagation, false, 'stopPropagation'),
      registered: true,
    };
    if (this.#policy === 'error') {
      for (const existing of this.#entries.values()) {
        if (existing.scope === scope && existing.shortcut === normalized) {
          throw new Error(
            `Shortcut "${normalized}" is already registered in scope "${scope}". Unregister it first.`,
          );
        }
      }
    }
    this.#nextId++;
    this.#entries.set(entry.id, entry);
    this.#reset();
    const changeEnabled = (enabled: boolean): void => {
      this.#assertAlive();
      if (!entry.registered) throw new Error('Shortcut registration has been unregistered.');
      entry.enabled = enabled;
      this.#reset();
    };
    return Object.freeze({
      id: entry.id,
      shortcut: entry.shortcut,
      scope: entry.scope,
      get enabled() {
        return entry.enabled;
      },
      get registered() {
        return entry.registered;
      },
      enable: () => changeEnabled(true),
      disable: () => changeEnabled(false),
      unregister: () => {
        if (!entry.registered) return;
        entry.registered = false;
        entry.enabled = false;
        entry.handler = undefined;
        this.#entries.delete(entry.id);
        this.#reset();
      },
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.detach();
    for (const entry of this.#entries.values()) {
      entry.registered = false;
      entry.enabled = false;
      entry.handler = undefined;
    }
    this.#entries.clear();
    this.#enabled = false;
    this.#disposed = true;
  }

  #assertAlive(): void {
    if (this.#disposed) throw new Error('ShortcutManager is disposed; create a new manager.');
  }

  #listeners(): [string, EventListener][] {
    return [
      ['keydown', this.#keydown],
      ['compositionstart', this.#compositionStart],
      ['compositionend', this.#compositionEnd],
      ['blur', this.#blur],
    ];
  }

  #reset(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#pending = undefined;
  }

  #rank(entry: Entry): number {
    return entry.scope === 'global' ? 0 : this.#scopes.indexOf(entry.scope) + 1;
  }

  #eligible(entry: Entry, event: KeyboardEvent, editable: boolean): boolean {
    return (
      entry.registered &&
      entry.enabled &&
      (entry.scope === 'global' || this.#scopes.includes(entry.scope)) &&
      (!event.repeat || entry.allowRepeat) &&
      (!editable || entry.allowInEditable)
    );
  }

  #winner(entries: readonly Entry[]): Entry | undefined {
    return this.#policy === 'first-wins' ? entries[0] : entries[entries.length - 1];
  }

  #invoke(entry: Entry, event: KeyboardEvent): void {
    entry.handler?.({
      id: entry.id,
      shortcut: entry.shortcut,
      scope: entry.scope,
      event,
      manager: this,
    });
  }

  #onKeydown(raw: Event): void {
    if (!this.#enabled || this.#disposed) return;
    const event = raw as KeyboardEvent;
    if (typeof event.key !== 'string') return;
    if (this.#composing || event.isComposing || event.keyCode === 229 || event.defaultPrevented) {
      this.#reset();
      return;
    }
    // AltGraph can appear as Ctrl+Alt on some layouts; never treat it as a shortcut.
    if (typeof event.getModifierState === 'function' && event.getModifierState('AltGraph')) {
      this.#reset();
      return;
    }
    if (
      ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock'].includes(
        event.key,
      )
    ) {
      return;
    }
    if (keyFromEvent(event.key) === undefined) {
      this.#reset();
      return;
    }
    const editable = isEditable(event);
    const pending = this.#pending;
    if (pending) {
      const eligible = pending.candidates.filter((entry) => this.#eligible(entry, event, editable));
      // Holding a prefix must not repeatedly restart its timer or invoke its fallback.
      if (event.repeat && eligible.length === 0) return;
      const matchesNext = eligible.filter((entry) =>
        matches(entry.combos[pending.position], event),
      );
      if (matchesNext.length > 0) {
        this.#accept(matchesNext, pending.position + 1, event, pending);
        return;
      }
      this.#reset();
      if (
        pending.fallback &&
        pending.fallbackEvent &&
        this.#eligible(pending.fallback, event, editable)
      ) {
        const target = this.#target;
        this.#invoke(pending.fallback, pending.fallbackEvent);
        if (!this.#enabled || this.#disposed || this.#target !== target || !this.#target) return;
      }
    }
    let candidates = [...this.#entries.values()].filter(
      (entry) => this.#eligible(entry, event, editable) && matches(entry.combos[0], event),
    );
    if (candidates.length === 0) return;
    const rank = candidates.reduce((highest, entry) => Math.max(highest, this.#rank(entry)), 0);
    candidates = candidates.filter((entry) => this.#rank(entry) === rank);
    this.#accept(candidates, 1, event);
  }

  #accept(
    entries: readonly Entry[],
    position: number,
    event: KeyboardEvent,
    previous?: Pending,
  ): void {
    this.#reset();
    const complete = entries.filter((entry) => entry.combos.length === position);
    const continuing = entries.filter((entry) => entry.combos.length > position);
    // Duplicate registrations contribute neither callbacks nor event effects unless they win.
    const unique = new Map<string, Entry[]>();
    for (const entry of entries) {
      const group = unique.get(entry.shortcut) ?? [];
      group.push(entry);
      unique.set(entry.shortcut, group);
    }
    const winners = [...unique.values()].map((group) => this.#winner(group)!);
    if (winners.some((entry) => entry.preventDefault)) event.preventDefault();
    if (winners.some((entry) => entry.stopPropagation)) event.stopPropagation();
    const completed = this.#winner(complete);
    if (continuing.length === 0) {
      if (completed) this.#invoke(completed, event);
      return;
    }
    const pending: Pending = {
      candidates: continuing,
      position,
      fallback: completed ?? previous?.fallback,
      fallbackEvent: completed ? event : previous?.fallbackEvent,
    };
    this.#pending = pending;
    this.#timer = setTimeout(() => {
      if (this.#pending !== pending) return;
      this.#reset();
      if (pending.fallback && pending.fallbackEvent)
        this.#invoke(pending.fallback, pending.fallbackEvent);
    }, this.#timeout);
  }
}

export function createShortcuts(options: ManagerOptions = {}): ShortcutManager {
  return new ShortcutManager(options);
}
