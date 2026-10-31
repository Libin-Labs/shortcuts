export { parseCombo, parseShortcut, normalizeCombo, normalizeShortcut } from './parsing.js';
export type { ParsedCombo, ParseOptions, Platform } from './parsing.js';
export { ShortcutManager, createShortcuts } from './manager.js';
export type {
  ConflictPolicy,
  ManagerOptions,
  RegistrationOptions,
  ShortcutContext,
  ShortcutHandler,
  ShortcutRegistration,
} from './manager.js';
