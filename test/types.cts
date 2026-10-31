import shortcuts = require('@lp-labs/shortcuts');

const manager: shortcuts.ShortcutManager = shortcuts.createShortcuts({ platform: 'linux' });
const handler: shortcuts.ShortcutHandler = ({ event }) => event.preventDefault();
const registration: shortcuts.ShortcutRegistration = manager.register('Mod+K', handler);
const parsed: readonly shortcuts.ParsedCombo[] = shortcuts.parseShortcut('G G');
shortcuts.normalizeCombo(parsed[0]!.normalized);
shortcuts.normalizeShortcut('Mod+K');
registration.unregister();
manager.dispose();
// @ts-expect-error event is a KeyboardEvent, not a string
const invalid: shortcuts.ShortcutHandler = ({ event }: { event: string }) => event.toUpperCase();
void invalid;
