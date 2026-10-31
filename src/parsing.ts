export type Platform = 'mac' | 'windows' | 'linux' | 'other';

export interface ParseOptions {
  readonly platform?: Platform;
}

export interface ParsedCombo {
  /** Lowercase KeyboardEvent.key, with Space represented as "space". */
  readonly key: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly normalized: string;
}

const namedKeys = new Map(
  [
    'Enter',
    'Escape',
    'Tab',
    'Space',
    'Backspace',
    'Delete',
    'Insert',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  ].map((key) => [key.toLowerCase(), key]),
);

export function validateOptions(value: unknown, allowed: readonly string[], label: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an options object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`Unknown ${label} option "${key}".`);
    }
  }
}

export function validatePlatform(platform: unknown): asserts platform is Platform {
  if (!['mac', 'windows', 'linux', 'other'].includes(platform as string)) {
    throw new TypeError('platform must be "mac", "windows", "linux", or "other".');
  }
}

function platformFrom(options: ParseOptions): Platform {
  validateOptions(options, ['platform'], 'parsing');
  const platform = options.platform === undefined ? 'other' : options.platform;
  validatePlatform(platform);
  return platform;
}

export function keyFromEvent(key: string): string | undefined {
  if (key === ' ') return 'space';
  if (key === '+') return '+';
  const lower = key.toLowerCase();
  if (namedKeys.has(lower)) return lower;
  if (/^[!-~]$/.test(key)) return lower;
  return undefined;
}

function parse(input: string, platform: Platform): ParsedCombo {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new TypeError('A combo must be a non-empty string, for example Mod+K.');
  }
  const text = input.trim();
  if (/\s/.test(text)) {
    throw new TypeError(`Combo "${text}" contains whitespace; use parseShortcut for sequences.`);
  }
  const tokens = text.split('+');
  const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
  let key: string | undefined;
  for (const token of tokens) {
    if (!token) throw new TypeError(`Empty token in "${text}"; use Plus for the + key.`);
    const lower = token.toLowerCase();
    const modifier = lower === 'mod' ? (platform === 'mac' ? 'meta' : 'ctrl') : lower;
    if (modifier === 'ctrl' || modifier === 'alt' || modifier === 'shift' || modifier === 'meta') {
      if (modifiers[modifier]) {
        throw new TypeError(`Duplicate modifier "${token}" in "${text}" after resolving Mod.`);
      }
      modifiers[modifier] = true;
      continue;
    }
    const parsedKey = lower === 'plus' ? '+' : keyFromEvent(token);
    if (!parsedKey) throw new TypeError(`Unsupported key "${token}" in "${text}".`);
    if (key !== undefined)
      throw new TypeError(`Combo "${text}" must contain exactly one non-modifier key.`);
    key = parsedKey;
  }
  if (key === undefined) throw new TypeError(`Combo "${text}" requires a non-modifier key.`);
  const displayKey = key === '+' ? 'Plus' : (namedKeys.get(key) ?? key.toUpperCase());
  const parts: string[] = [];
  if (modifiers.ctrl) parts.push('Ctrl');
  if (modifiers.alt) parts.push('Alt');
  if (modifiers.shift) parts.push('Shift');
  if (modifiers.meta) parts.push('Meta');
  parts.push(displayKey);
  return Object.freeze({ key, ...modifiers, normalized: parts.join('+') });
}

export function parseCombo(input: string, options: ParseOptions = {}): ParsedCombo {
  return parse(input, platformFrom(options));
}

export function normalizeCombo(input: string, options: ParseOptions = {}): string {
  return parseCombo(input, options).normalized;
}

export function parseShortcut(input: string, options: ParseOptions = {}): readonly ParsedCombo[] {
  const platform = platformFrom(options);
  if (typeof input !== 'string' || !input.trim()) {
    throw new TypeError('A shortcut must be a non-empty string, for example Mod+K Mod+C.');
  }
  return Object.freeze(
    input
      .trim()
      .split(/\s+/)
      .map((combo) => parse(combo, platform)),
  );
}

export function normalizeShortcut(input: string, options: ParseOptions = {}): string {
  return parseShortcut(input, options)
    .map((combo) => combo.normalized)
    .join(' ');
}
